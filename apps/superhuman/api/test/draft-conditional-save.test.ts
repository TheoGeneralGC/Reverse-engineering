import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/server.ts';
import {AutoDraftMutationGuard} from '../src/auto-drafts-mutation-guard.ts';
import type {Draft,Thread} from '../src/types.ts';
import type {ProviderDraftTransport} from '../src/provider-draft-transport.ts';

function fixture(databasePath=':memory:',seed=true){
 let native=0,model=0;const denied=async()=>{native++;throw Error('Provider forbidden in conditional save')};
 const transport:ProviderDraftTransport={ready(){native++;throw Error('Provider forbidden')},profile:denied,create:denied,update:denied,get:denied,list:denied,metadata:denied,delete:denied};
 const app=createApp({databasePath,env:{DATABASE_PATH:databasePath,WEB_ORIGIN:'http://127.0.0.1:5199'},seed:false,runJobs:false,providerDraftAutomatic:false,providerDraftTransport:transport,aiFetch:async()=>{model++;throw Error('Model forbidden')}});
 app.google.fetcher=denied;const guard=new AutoDraftMutationGuard(app.store);
 const thread:Thread={id:'a:thread',accountId:'a',providerId:'thread',subject:'Fictional Cedar',snippet:'Fictional source',sender:{name:'Sender',email:'sender@example.test'},participants:[],lastMessageAt:'2026-10-29T20:00:00.000Z',unread:true,starred:false,important:true,folder:'inbox',labels:[],messages:[{id:'source',sender:{name:'Sender',email:'sender@example.test'},to:[{name:'Self',email:'self@example.test'}],date:'2026-10-29T20:00:00.000Z',text:'Fictional source',attachments:[]}]};
 if(seed){app.store.put('account','a',{id:'a',provider:'google',email:'self@example.test',name:'Self',color:'#000'});app.store.put('account','b',{id:'b',provider:'google',email:'other@example.test',name:'Other',color:'#000'});app.store.put('thread',thread.id,thread);app.store.put('thread','b:thread',{...thread,id:'b:thread',accountId:'b'})}
 const request=(method:string,url:string,value?:unknown)=>new Promise<{status:number;body:any}>((resolve,reject)=>{const r=Object.assign(Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]),{method,url,headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:5199','content-type':'application/json'}})as IncomingMessage;const response=new EventEmitter()as ServerResponse;let status=0;response.setHeader=(()=>response)as typeof response.setHeader;response.writeHead=((n:number)=>{status=n;return response})as typeof response.writeHead;response.end=((data:unknown)=>{try{resolve({status,body:JSON.parse(String(data))})}catch(e){reject(e)}return response})as typeof response.end;app.server.emit('request',r,response)});
 return{app,guard,thread,request,transport,newDraft(managed=false){return app.store.saveDraft({accountId:'a',threadId:thread.id,to:'sender@example.test',cc:'',bcc:'',subject:'Re: Fictional Cedar',body:'Reply.\n\nOn source:\n> Quoted source',html:'<div>Reply.</div><blockquote>Quoted source</blockquote>'},managed?'composer':'auto-generated-local')},state(id:string){return{draft:app.store.get<Draft>('draft',id),guard:guard.guard('a',id),version:guard.version('a',thread.id),links:app.store.db.prepare('SELECT * FROM provider_draft_links ORDER BY draft_id').all()}},calls:()=>({native,model}),async close(){guard.close();await app.close()}};
}
const claim=(d:Draft)=>({accountId:d.accountId,threadId:d.threadId,expectedRevision:d.revision??0,action:'claim'});

test('serialized empty claim preserves all canonical bytes and advances normal revision/authoring guard atomically without enrollment or transport',async()=>{
 const f=fixture();try{const d=f.newDraft(),before=f.state(d.id),result=await f.request('PATCH','/api/drafts/'+d.id,claim(d));assert.equal(result.status,200);assert.deepEqual(Object.keys(result.body).sort(),['draft','providerDraft']);const saved=result.body.draft as Draft;assert.equal(saved.revision,d.revision!+1);for(const k of ['accountId','threadId','to','cc','bcc','subject','body','html','attachments','status']as const)assert.deepEqual(saved[k],d[k]);assert.equal(f.guard.guard('a',d.id)!.version,before.guard!.version+1);assert.equal(f.guard.version('a',f.thread.id),before.version+1);assert.equal(f.app.store.hasProviderDraftLink(d.id),false);assert.deepEqual(f.calls(),{native:0,model:0})}finally{await f.close()}
});

test('authored CAS accepts current values, stale/foreign/deleted scopes refuse before any draft/guard/ledger write',async()=>{
 const f=fixture();try{const d=f.newDraft(),edited=await f.request('PATCH','/api/drafts/'+d.id,{accountId:'a',threadId:d.threadId,expectedRevision:d.revision,body:'New current authored bytes'});assert.equal(edited.status,200);assert.equal(edited.body.draft.body,'New current authored bytes');assert.equal(edited.body.draft.html,undefined);const before=f.state(d.id),changes=f.app.store.db.prepare('SELECT total_changes() n').get()!.n;
  for(const [id,value,code]of [[d.id,claim(d),'draft_revision_conflict'],[d.id,{...claim(edited.body.draft),accountId:'b'},'draft_scope_conflict'],[d.id,{...claim(edited.body.draft),threadId:'b:thread'},'draft_scope_conflict'],['missing',claim(edited.body.draft),'draft_scope_conflict']]as const){const r=await f.request('PATCH','/api/drafts/'+id,value);assert.equal(r.status,409);assert.equal(r.body.error.code,code);assert.deepEqual(f.state(d.id),before);assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n,changes)}
  assert.deepEqual(f.calls(),{native:0,model:0});
 }finally{await f.close()}
});

test('conditional mutation refuses scheduled/queued/held/unknown/sent/attempt/artifact and accepted discard locks with zero persisted changes',async()=>{
 const f=fixture();try{
  for(const status of ['scheduled','send_queued','delivery_held','delivery_unknown','sending','sent']as const){const d=f.newDraft();f.app.store.put('draft',d.id,{...d,status});const before=f.state(d.id),r=await f.request('PATCH','/api/drafts/'+d.id,claim(d));assert.equal(r.status,409);assert.equal(r.body.error.code,'draft_locked');assert.deepEqual(f.state(d.id),before)}
  for(const patch of [{deliveryAttemptId:'pending-attempt'},{artifactSendId:'pending-artifact'}]){const d=f.newDraft();f.app.store.put('draft',d.id,{...d,...patch});const before=f.state(d.id),r=await f.request('PATCH','/api/drafts/'+d.id,claim(d));assert.equal(r.status,409);assert(['draft_locked','artifact_delivery_locked'].includes(r.body.error.code));assert.deepEqual(f.state(d.id),before)}
  const d=f.newDraft(true);let fakeCreate=0;f.transport.ready=()=>{};f.transport.profile=async()=> 'self@example.test';f.transport.create=async()=>{fakeCreate++;throw Error('Synthetic unresolved create ACK')};await f.app.providerDrafts.flush('a',d.id);assert.equal(fakeCreate,1);const s=f.app.providerDrafts.status('a',d.id);assert.equal(s.state,'outcome_unknown');f.app.providerDrafts.discard(d.id,{accountId:'a',clientRequestId:'owned-discard',expectedDraftRevision:d.revision!,expectedContentHash:s.desiredHash!,expectedSyncRevision:s.revision});const before=f.state(d.id),r=await f.request('PATCH','/api/drafts/'+d.id,claim(d));assert.equal(r.status,409);assert.equal(r.body.error.code,'provider_draft_locked');assert.deepEqual(f.state(d.id),before);assert.deepEqual(f.calls(),{native:0,model:0});
 }finally{await f.close()}
});

test('late normal-hook failure rolls back conditional draft/revision/thread and authoring guard together',async()=>{
 const f=fixture();try{const d=f.newDraft(),before=f.state(d.id),unregister=f.app.store.registerDraftLifecycleHooks({written(){throw Error('Controlled final observer failure')}});const r=await f.request('PATCH','/api/drafts/'+d.id,claim(d));unregister();assert.equal(r.status,500);assert.deepEqual(f.state(d.id),before);const retry=await f.request('PATCH','/api/drafts/'+d.id,claim(d));assert.equal(retry.status,200);assert.equal(retry.body.draft.revision,d.revision!+1);assert.equal(f.guard.guard('a',d.id)!.version,before.guard!.version+1);assert.deepEqual(f.calls(),{native:0,model:0})}finally{await f.close()}
});

test('two actual isolated SQLite owners race one revision: one claim accepted and stale author cannot overwrite its current content',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'draft-cas-')),path=join(dir,'owned.sqlite'),a=fixture(path),b=fixture(path,false);try{const d=a.newDraft(),before=a.state(d.id),results=await Promise.all([a.request('PATCH','/api/drafts/'+d.id,claim(d)),b.request('PATCH','/api/drafts/'+d.id,{accountId:'a',threadId:d.threadId,expectedRevision:d.revision,body:'Contending human bytes'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results.find(r=>r.status===200)!.body.draft as Draft;assert.deepEqual(a.app.store.required<Draft>('draft',d.id),winner);assert.deepEqual(b.app.store.required<Draft>('draft',d.id),winner);assert.equal(winner.revision,d.revision!+1);assert.equal(a.guard.guard('a',d.id)!.version,before.guard!.version+1);assert.equal(a.guard.version('a',a.thread.id),before.version+1);assert.deepEqual(a.calls(),{native:0,model:0});assert.deepEqual(b.calls(),{native:0,model:0})}finally{await b.close();await a.close();rmSync(dir,{recursive:true,force:true})}
});

test('strict conditional shape rejects incomplete/context/extra/authored claims and exhausted revision before writes',async()=>{
 const f=fixture();try{const d=f.newDraft(),before=f.state(d.id),changes=f.app.store.db.prepare('SELECT total_changes() n').get()!.n;for(const value of [{action:'claim'},{...claim(d),body:d.body},{...claim(d),extra:true},{...claim(d),expectedRevision:null},{...claim(d),expectedRevision:-1},{...claim(d),action:'other'},{accountId:'a',threadId:d.threadId,expectedRevision:'1'},{accountId:'a',expectedRevision:d.revision}]){const r=await f.request('PATCH','/api/drafts/'+d.id,value);assert.equal(r.status,400);assert.equal(r.body.error.code,'draft_invalid_request');assert.deepEqual(f.state(d.id),before);assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n,changes)}
  f.app.store.put('draft',d.id,{...d,revision:Number.MAX_SAFE_INTEGER});const exhausted=f.state(d.id),r=await f.request('PATCH','/api/drafts/'+d.id,{...claim(d),expectedRevision:Number.MAX_SAFE_INTEGER});assert.equal(r.status,409);assert.equal(r.body.error.code,'draft_revision_conflict');assert.deepEqual(f.state(d.id),exhausted);
 }finally{await f.close()}
});

test('unknown claim ACK is reconciled by canonical GET without implicit resubmit; legacy authored PATCH remains unchanged',async()=>{
 const f=fixture();try{const d=f.newDraft(),calls:string[]=[];const lost=await f.request('PATCH','/api/drafts/'+d.id,claim(d));calls.push('PATCH');assert.equal(lost.status,200);const current=await f.request('GET','/api/drafts/'+d.id);calls.push('GET');assert.equal(current.status,200);assert.equal(current.body.draft.revision,d.revision!+1);assert.equal(current.body.draft.body,d.body);assert.deepEqual(calls,['PATCH','GET']);
  const legacy=await f.request('PATCH','/api/drafts/'+d.id,{body:'Legacy normal authored save'});assert.equal(legacy.status,200);assert.equal(legacy.body.draft.body,'Legacy normal authored save');assert.equal(legacy.body.draft.revision,current.body.draft.revision+1);assert.deepEqual(f.calls(),{native:0,model:0});
 }finally{await f.close()}
});
