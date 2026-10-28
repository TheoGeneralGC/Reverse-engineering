import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { AiChatRepository } from '../src/ai-chat-store.ts';
import { AiDraftService } from '../src/ai-drafts.ts';
import type { AiDraftPreview,AiDraftScope } from '../src/ai-draft-types.ts';
import type { AiSourceReceipt } from '../src/ai-chat-types.ts';
import type { Draft } from '../src/types.ts';

const fixed=Date.parse('2026-10-28T12:00:00Z');
const payload=()=>({to:[{email:'first@example.test',name:'Comma, "Quoted"'}],cc:[{email:'cc@example.test'}],bcc:[{email:'bcc@example.test'}],subject:'Synthetic Thursday review',body:'Three samples on Thursday.'});
const code=(expected:string)=>(error:unknown)=>{assert.equal((error as {code?:string}).code,expected);return true};
function fixture(databasePath=':memory:'){
 const store=new Store(databasePath,false);
 for(const id of ['a','b'])store.put('account',id,{id,provider:'demo',name:'Synthetic '+id,email:id+'@example.test'});
 const repository=new AiChatRepository(store.db,()=>fixed,()=>true),locked=new Set<string>(),drafts=new AiDraftService(store,repository,()=>fixed,id=>locked.has(id));
 const begin=(accountId='a')=>{const session=repository.createSession(accountId),turn=repository.accept(session.id,{accountId,clientRequestId:randomUUID(),expectedRevision:0,prompt:'Write a synthetic draft preview only',context:{resources:[]}},'synthetic-model').turn;repository.update(turn.id,current=>{current.state='running'});return{scope:{accountId,sessionId:session.id,turnId:turn.id} as AiDraftScope,turnId:turn.id}};
 const complete=(preview:AiDraftPreview)=>repository.update(preview.turnId,turn=>{turn.state='completed';turn.phase='finished';turn.answer={markdown:'Synthetic preview ready.',plainText:'Synthetic preview ready.',citations:[],sourceIds:[],finishReason:'end_turn',truncated:false};turn.previews=[preview]},[],false,turn=>drafts.commitPreview(turn,preview));
 const prepared=()=>{const context=begin(),preview=drafts.propose(context.turnId,payload());complete(preview);return{...context,preview}};
 const create=(scope:AiDraftScope,preview:AiDraftPreview,key:string=randomUUID(),expectedGeneration=0)=>drafts.create(preview.id,{...scope,clientRequestId:key,expectedPreviewHash:preview.payloadHash,expectedGeneration});
 const count=(table:string)=>Number(store.db.prepare('SELECT count(*) AS n FROM '+table).get()!.n);
 const records=()=>store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all();
 return{store,repository,drafts,locked,begin,complete,prepared,create,count,records,close:()=>store.close()};
}

test('model proposal alone writes no draft/artifact; rich/plain canonical content and all recipient groups agree on explicit create',()=>{
 const f=fixture();try{
  f.store.put('draft','existing',{id:'existing',accountId:'a',to:'owner@example.test',cc:'',bcc:'',subject:'User subject',body:'Keep existing user body',html:'<div>Keep existing user body</div>',attachments:[],status:'draft',updatedAt:'2026-10-27T00:00:00Z'} satisfies Draft);const before=f.records(),{scope,turnId}=f.begin();
  const preview=f.drafts.propose(turnId,{...payload(),body:'Conflicting model plain text',html:'<div>Canonical <b>rich</b> body</div><script>alert(1)</script><img src="https://example.test/tracker.png">'});
  assert.deepEqual(f.records(),before);assert.equal(f.count('ai_draft_previews'),0);assert.equal(f.count('ai_draft_creations'),0);assert.equal(f.count('ai_draft_requests'),0);assert.equal(preview.payload.body,'Canonical rich body');assert.match(preview.payload.html??'',/<b>rich<\/b>/);assert.doesNotMatch(preview.payload.html??'',/<script|<img|tracker\.png|alert\(/i);
  f.complete(preview);const result=f.create(scope,preview);assert.equal(result.created,true);assert.equal(result.result.draft?.to,'"Comma, \\"Quoted\\"" <first@example.test>');assert.equal(result.result.draft?.cc,'cc@example.test');assert.equal(result.result.draft?.bcc,'bcc@example.test');assert.equal(result.result.draft?.body,preview.payload.body);assert.equal(result.result.draft?.html,preview.payload.html);assert.equal(result.result.draft?.status,'draft');assert.deepEqual(result.result.draft?.attachments,[]);for(const field of ['threadId','scheduledAt','deliveryAttemptId','providerDraftId','providerMessageId'])assert.equal((result.result.draft as Record<string,unknown>)[field],undefined);assert.deepEqual(f.records().filter(row=>row.id==='existing'),before.filter(row=>row.id==='existing'));
 }finally{f.close()}
});

test('unsupported action fields, malformed neighbors, header injection and oversized structured input never make an artifact',()=>{
 const f=fixture();try{const {turnId}=f.begin();const invalid=[{...payload(),accountId:'b'},{...payload(),draftId:'existing'},{...payload(),send:true},{...payload(),threadId:'foreign'},{...payload(),attachments:[]},{...payload(),to:[{email:'first@example.test'},{email:'not an address'}]},{...payload(),subject:'Review\r\nBcc: injected@example.test'},{...payload(),to:[{email:'first@example.test',name:'Invisible\0Name'}]},{...payload(),body:'x'.repeat(12000),html:'<div>'+'y'.repeat(12000)+'</div>'}];for(const raw of invalid)assert.throws(()=>f.drafts.propose(turnId,raw),code('ai_draft_invalid_preview'));assert.equal(f.count('ai_draft_previews'),0);assert.equal(f.store.list('draft').length,0)}finally{f.close()}
});

test('only offered same-turn source receipts can support a proposal',()=>{
 const f=fixture();try{const {turnId,scope}=f.begin(),receipt:AiSourceReceipt={id:'receipt-synthetic',number:1,...scope,target:{kind:'mail',accountId:'a',threadId:'synthetic-thread',messageIds:['synthetic-message']},basis:'mail-text',label:'Synthetic source',secondaryLabel:'Synthetic sender',excerpt:'Thursday, three samples',snapshotHash:'synthetic',sourceUpdatedAt:null,fetchedAt:new Date(fixed).toISOString(),truncated:false,partial:false};f.repository.update(turnId,turn=>{turn.sources=[receipt]});assert.throws(()=>f.drafts.propose(turnId,{...payload(),sourceNumbers:[1]}),code('ai_draft_not_found'));f.repository.dispatch(turnId,[receipt.id],{synthetic:true});const proposed=f.drafts.propose(turnId,{...payload(),sourceNumbers:[1]});assert.deepEqual(proposed.sourceIds,[receipt.id]);assert.throws(()=>f.drafts.propose(turnId,{...payload(),sourceNumbers:[2]}),code('ai_draft_not_found'));assert.equal(f.count('ai_draft_previews'),0);assert.equal(f.store.list('draft').length,0)}finally{f.close()}
});

test('incomplete/cancelled/unknown turns and uncommitted previews cannot activate draft creation',()=>{
 for(const terminal of ['cancelled','outcome_unknown','failed','interrupted'] as const){const f=fixture();try{const {scope,turnId}=f.begin(),preview=f.drafts.propose(turnId,payload());assert.throws(()=>f.create(scope,preview),code('ai_draft_not_found'));assert.throws(()=>f.drafts.commitPreview(f.repository.rawTurn(turnId),preview),/completed chat transaction/);f.repository.update(turnId,turn=>{turn.state=terminal;turn.answer=null;turn.previews=[preview]});assert.throws(()=>f.create(scope,preview),code('ai_draft_not_found'));assert.equal(f.store.list('draft').length,0)}finally{f.close()}}
});

test('same-key replay and different-key activations recover one draft without overwriting subsequent user edits',()=>{
 const f=fixture();try{const {scope,preview}=f.prepared(),first=f.create(scope,preview,'action-one'),id=first.result.draft!.id;const edited={...first.result.draft!,to:'Changed <changed@example.test>',subject:'User revised subject',body:'User revised body',html:'<div>User revised body</div>',updatedAt:'2026-10-28T13:00:00Z'};f.store.put('draft',id,edited);const replay=f.create(scope,preview,'action-one');assert.equal(replay.created,false);assert.equal(replay.result.request!.id,first.result.request!.id);assert.deepEqual(replay.result.draft,edited);const other=f.create(scope,preview,'action-two');assert.equal(other.created,false);assert.equal(other.result.creation!.draftId,id);assert.equal(other.result.request!.clientRequestId,'action-two');assert.notEqual(other.result.request!.id,first.result.request!.id);assert.deepEqual(other.result.draft,edited);assert.equal(f.count('ai_draft_creations'),1);assert.equal(f.count('ai_draft_requests'),2);assert.equal(f.store.list('draft').length,1)}finally{f.close()}
});

test('one account action key cannot silently create a second preview/session draft',()=>{
 const f=fixture();try{const one=f.prepared();f.create(one.scope,one.preview,'shared-action-key');const two=f.prepared();assert.throws(()=>f.create(two.scope,two.preview,'shared-action-key'),code('ai_draft_request_conflict'));assert.equal(f.count('ai_draft_creations'),1);assert.equal(f.store.list('draft').length,1);assert.throws(()=>f.drafts.create(one.preview.id,{...one.scope,clientRequestId:'shared-action-key',expectedPreviewHash:'b'.repeat(64),expectedGeneration:0}),code('ai_draft_request_conflict'))}finally{f.close()}
});

test('receipt insertion failure rolls back draft and mapping, then the exact original key can safely succeed',()=>{
 const f=fixture();try{const {scope,preview}=f.prepared();f.store.db.exec("CREATE TEMP TRIGGER fail_ai_draft_receipt BEFORE INSERT ON ai_draft_requests BEGIN SELECT RAISE(ABORT,'synthetic receipt failure');END");assert.throws(()=>f.create(scope,preview,'atomic-action'),/synthetic receipt failure/);assert.equal(f.store.list('draft').length,0);assert.equal(f.count('ai_draft_creations'),0);assert.equal(f.count('ai_draft_requests'),0);f.store.db.exec('DROP TRIGGER fail_ai_draft_receipt');const recovered=f.create(scope,preview,'atomic-action');assert.equal(recovered.created,true);assert.equal(f.count('ai_draft_creations'),1);assert.equal(f.drafts.byRequest(scope,preview.id,'atomic-action').creation?.draftId,recovered.result.draft!.id)}finally{f.close()}
});

test('foreign scopes and moved targets fail before parsing any foreign draft body',()=>{
 const f=fixture();const originalParse=JSON.parse;let foreignBodyReads=0;try{const {scope,preview}=f.prepared(),first=f.create(scope,preview,'owned'),other=f.repository.createSession('b');f.store.put('draft',first.result.draft!.id,{...first.result.draft!,accountId:'b',body:'FOREIGN_DRAFT_BODY_SENTINEL'});JSON.parse=((text:string,reviver?:Parameters<typeof JSON.parse>[1])=>{if(text.includes('FOREIGN_DRAFT_BODY_SENTINEL')){foreignBodyReads++;throw new Error('Foreign body must not be parsed')}return originalParse(text,reviver)}) as typeof JSON.parse;for(const read of [()=>f.drafts.get({accountId:'b',sessionId:other.id,turnId:scope.turnId},preview.id),()=>f.drafts.byRequest({accountId:'b',sessionId:other.id,turnId:scope.turnId},preview.id,'owned'),()=>f.drafts.get({...scope,turnId:'absent'},preview.id)])assert.throws(read,code('ai_draft_not_found'));const own=f.drafts.get(scope,preview.id);assert.equal(own.resolution.availability,'unavailable');assert.equal(own.draft,undefined);assert.equal(f.create(scope,preview,'new-key-after-move').result.resolution.availability,'unavailable');assert.equal(foreignBodyReads,0);assert.equal(f.count('ai_draft_creations'),1)}finally{JSON.parse=originalParse;f.close()}
});

test('an old action key never resurrects its deleted target; delivery-locked targets keep their status',()=>{
 for(const status of ['deleted','scheduled','sending','delivery_unknown','sent','external-lock'] as const){const f=fixture();try{const {scope,preview}=f.prepared(),first=f.create(scope,preview,'first'),id=first.result.draft!.id;if(status==='deleted')f.store.remove('draft',id);else if(status==='external-lock')f.locked.add(id);else f.store.put('draft',id,{...first.result.draft!,status});const result=f.create(scope,preview,status==='deleted'?'first':'second');assert.equal(result.created,false);assert.equal(result.result.creation!.draftId,id);assert.equal(result.result.draft,undefined);assert.ok(['unavailable','locked'].includes(result.result.resolution.availability));assert.equal(f.count('ai_draft_creations'),1);assert.equal(f.store.list('draft').length,status==='deleted'?0:1);if(status!=='deleted'&&status!=='external-lock')assert.equal(f.store.get<Draft>('draft',id)!.status,status)}finally{f.close()}}
});

test('a second isolated SQLite owner recovers the original action and maps a new key to that same draft',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rea-ai-draft-owner-')),databasePath=join(directory,'isolated.sqlite');const first=fixture(databasePath);let second:ReturnType<typeof fixture>|undefined;try{const {scope,preview}=first.prepared(),created=first.create(scope,preview,'lost-ack-action');second=fixture(databasePath);const recovered=second.drafts.byRequest(scope,preview.id,'lost-ack-action');assert.equal(recovered.creation!.draftId,created.result.draft!.id);assert.equal(recovered.request!.id,created.result.request!.id);const next=second.create(scope,preview,'second-owner-action');assert.equal(next.created,false);assert.equal(next.result.creation!.draftId,created.result.draft!.id);assert.equal(first.count('ai_draft_creations'),1);assert.equal(first.store.list('draft').length,1)}finally{second?.close();first.close();rmSync(directory,{recursive:true,force:true})}
});

test('explicit next-generation creation maps fresh keys once while every old receipt remains bound to the deleted draft',()=>{
 const f=fixture();try{
  const {scope,preview}=f.prepared(),zero=f.create(scope,preview,'generation-zero',0),oldId=zero.result.draft!.id;assert.equal(zero.result.creation!.generation,0);assert.equal(zero.result.request!.generation,0);f.store.remove('draft',oldId);
  const before={creations:f.count('ai_draft_creations'),requests:f.count('ai_draft_requests'),records:f.records()},available=f.drafts.get(scope,preview.id);assert.equal(available.createGeneration,1);assert.equal(available.creation!.draftId,oldId);assert.equal(available.resolution.availability,'unavailable');assert.deepEqual({creations:f.count('ai_draft_creations'),requests:f.count('ai_draft_requests'),records:f.records()},before,'Advertising the next explicit generation is read-only');
  const oldReplay=f.create(scope,preview,'generation-zero',0);assert.equal(oldReplay.created,false);assert.equal(oldReplay.result.creation!.draftId,oldId);assert.equal(f.store.list('draft').length,0);
  const one=f.create(scope,preview,'generation-one-a',1),secondKey=f.create(scope,preview,'generation-one-b',1);assert.equal(one.created,true);assert.equal(one.result.creation!.generation,1);assert.equal(one.result.request!.generation,1);assert.notEqual(one.result.draft!.id,oldId);assert.equal(secondKey.created,false);assert.equal(secondKey.result.creation!.draftId,one.result.draft!.id);assert.equal(f.store.list('draft').length,1);assert.equal(f.count('ai_draft_creations'),2);assert.equal(f.drafts.get(scope,preview.id).createGeneration,null);
  const recovered=f.drafts.byRequest(scope,preview.id,'generation-zero');assert.equal(recovered.creation!.draftId,oldId);assert.equal(recovered.request!.generation,0);assert.equal(recovered.resolution.availability,'unavailable');assert.equal(recovered.draft,undefined);const late=f.create(scope,preview,'generation-zero',0);assert.equal(late.result.creation!.draftId,oldId);assert.equal(late.result.resolution.availability,'unavailable');assert.equal(f.store.list('draft').length,1);
  assert.throws(()=>f.create(scope,preview,'generation-zero',1),code('ai_draft_request_conflict'));assert.throws(()=>f.create(scope,preview,'stale-new-key',0),code('ai_draft_generation_changed'));assert.equal(f.store.list('draft').length,1);
 }finally{f.close()}
});

test('two owners observing the same deleted generation converge; a later delete rejects a stale fresh action',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rea-ai-draft-generation-')),databasePath=join(directory,'isolated.sqlite'),one=fixture(databasePath);let two:ReturnType<typeof fixture>|undefined;try{
  const {scope,preview}=one.prepared(),first=one.create(scope,preview,'original',0),oldId=first.result.draft!.id;two=fixture(databasePath);two.store.remove('draft',oldId);assert.equal(one.drafts.get(scope,preview.id).createGeneration,1);assert.equal(two.drafts.get(scope,preview.id).createGeneration,1);
  const created=one.create(scope,preview,'first-writer',1),same=two.create(scope,preview,'second-writer',1);assert.equal(same.created,false);assert.equal(same.result.creation!.draftId,created.result.draft!.id);assert.equal(one.store.list('draft').length,1);two.store.remove('draft',oldId);assert.equal(one.store.get<Draft>('draft',created.result.draft!.id)!.id,created.result.draft!.id,'A stale deletion of generation0 cannot remove generation1');
  two.store.remove('draft',created.result.draft!.id);assert.equal(one.drafts.get(scope,preview.id).createGeneration,2);assert.throws(()=>one.create(scope,preview,'stale-third-writer',1),code('ai_draft_generation_changed'));assert.equal(one.store.list('draft').length,0);const old=two.create(scope,preview,'first-writer',1);assert.equal(old.created,false);assert.equal(old.result.creation!.draftId,created.result.draft!.id);assert.equal(old.result.resolution.availability,'unavailable');assert.equal(one.count('ai_draft_creations'),2);assert.equal(one.store.list('draft').length,0);
 }finally{two?.close();one.close();rmSync(directory,{recursive:true,force:true})}
});

test('only actual target absence advertises a new generation; malformed or stale generation intent cannot bypass it',()=>{
 for(const state of ['moved','sent','scheduled','sending','delivery_unknown','locked'] as const){const f=fixture();try{const {scope,preview}=f.prepared(),created=f.create(scope,preview,'original',0),id=created.result.draft!.id;if(state==='moved')f.store.put('draft',id,{...created.result.draft!,accountId:'b'});else if(state==='locked')f.locked.add(id);else f.store.put('draft',id,{...created.result.draft!,status:state});assert.equal(f.drafts.get(scope,preview.id).createGeneration,null);assert.throws(()=>f.create(scope,preview,'incorrect-next',1),code('ai_draft_generation_changed'));assert.equal(f.count('ai_draft_creations'),1);assert.equal(f.store.list('draft').length,1)}finally{f.close()}}
 const f=fixture();try{const {scope,preview}=f.prepared();for(const generation of [-1,0.5,'0',null,undefined,Number.NaN,Number.POSITIVE_INFINITY])assert.throws(()=>f.drafts.create(preview.id,{...scope,clientRequestId:randomUUID(),expectedPreviewHash:preview.payloadHash,expectedGeneration:generation}),code('ai_draft_invalid_preview'));assert.equal(f.store.list('draft').length,0);assert.equal(f.count('ai_draft_creations'),0)}finally{f.close()}
});
