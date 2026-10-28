import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiDraft,validAiDraftPreview } from '../src/ai-draft.ts';
import { ApiError } from '../src/api.ts';
import type { AiDraftPreview,AiDraftResponse } from '../../api/src/ai-draft-types.ts';
import type { AiDraftStorage } from '../src/ai-draft.ts';

const at='2026-10-28T12:00:00Z';
const preview=(accountId='a'):AiDraftPreview=>({id:'preview-'+accountId,accountId,sessionId:'session-'+accountId,turnId:'turn-'+accountId,kind:'draft-preview',payload:{to:[{email:'recipient@example.test',name:'Synthetic Recipient'}],cc:[],bcc:[],subject:'Synthetic Thursday review',body:'Three samples on Thursday.'},payloadHash:'a'.repeat(64),sourceIds:[],createdAt:at});
const empty=(p=preview()):AiDraftResponse=>({preview:p,creation:null,request:null,resolution:{availability:'unavailable',draftId:null},createGeneration:0});
function created(p=preview(),key='key-1',generation=0):AiDraftResponse{
 const suffix=generation?'-generation-'+generation:'',creation={id:'creation-'+p.id+suffix,accountId:p.accountId,sessionId:p.sessionId,turnId:p.turnId,previewId:p.id,payloadHash:p.payloadHash,draftId:'draft-'+p.accountId+suffix,generation,createdAt:at};
 return{preview:structuredClone(p),creation,request:{id:'receipt-'+key,clientRequestId:key,accountId:p.accountId,sessionId:p.sessionId,turnId:p.turnId,previewId:p.id,creationId:creation.id,generation,createdAt:at},createGeneration:null,resolution:{availability:'available',draftId:creation.draftId},draft:{id:creation.draftId,accountId:p.accountId,to:'Synthetic Recipient <recipient@example.test>',cc:'',bcc:'',subject:'User edited the subject',body:'User edits remain authoritative.',attachments:[],status:'draft',updatedAt:at}};
}
function gone(generation=0,key='old-key'):AiDraftResponse{const result=created(preview(),key,generation);result.resolution={availability:'unavailable',draftId:null};result.createGeneration=generation+1;delete result.draft;return result}
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
function memory(){const values=new Map<string,string>();const storage:AiDraftStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}};return{values,storage}}
type Call={path:string;body:any;method:string;signal?:AbortSignal};
function fixture(handler?:(call:Call)=>unknown|Promise<unknown>,saved=memory(),p=preview(),isCurrent=()=>true){
 const calls:Call[]=[];let next=0;
 const controller=createAiDraft({preview:p,storage:saved.storage,uuid:()=>`key-${++next}`,isCurrent,request:async(path,body,method='GET',options)=>{const call={path,body:body===undefined?undefined:structuredClone(body),method,signal:options?.signal};calls.push(call);const handled=await handler?.(call);if(handled!==undefined)return handled;if(method==='GET')return empty(p);throw new Error('Unexpected synthetic action: '+method+' '+path)}});
 return{controller,calls,...saved,ready:async()=>{controller.resume();await drain()},close:()=>controller.dispose()};
}

test('history restoration loads immutable preview/current edited draft without creating or reapplying its generated content',async()=>{
 const p=preview(),f=fixture(()=>created(p),memory(),p);try{await f.ready();const state=f.controller.getSnapshot();assert.equal(state.response?.draft?.subject,'User edited the subject');assert.equal(state.response?.draft?.body,'User edits remain authoritative.');assert.equal(state.preview.payload.body,'Three samples on Thursday.');await f.controller.create();assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.ok(f.calls.every(call=>call.method==='GET'))}finally{f.close()}
});

test('duplicate explicit create clicks share one durable request before its acknowledgement',async()=>{
 const ack=deferred<unknown>(),f=fixture(call=>call.method==='POST'?ack.promise:undefined);try{await f.ready();const first=f.controller.create();void f.controller.create();assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.controller.getSnapshot().creating,true);assert.equal(f.values.size,1);const call=f.calls.find(call=>call.method==='POST')!;assert.deepEqual(Object.keys(call.body).sort(),['accountId','clientRequestId','expectedGeneration','expectedPreviewHash','sessionId','turnId']);ack.resolve(created(preview(),call.body.clientRequestId));const result=await first;assert.equal(result?.creation?.draftId,'draft-a');assert.equal(f.values.size,0);await f.controller.create();assert.equal(f.calls.filter(call=>call.method==='POST').length,1)}finally{f.close()}
});

test('lost create acknowledgement and recovery404 stay locked across remount with no fresh POST or key',async()=>{
 const saved=memory();const handler=(call:Call)=>{if(call.method==='POST')throw new TypeError('Synthetic lost acknowledgement');if(call.path.includes('/by-request/'))throw new ApiError('Not found',404,'ai_draft_not_found')};
 const first=fixture(handler,saved);try{await first.ready();await first.controller.create();assert.equal(first.controller.getSnapshot().unknown,true);const original=first.calls.find(call=>call.method==='POST')!.body;assert.equal(saved.values.size,1);await first.controller.recover();assert.equal(first.controller.getSnapshot().unknown,true);await first.controller.create();assert.equal(first.calls.filter(call=>call.method==='POST').length,1);first.close();
  const restored=fixture(handler,saved);try{await restored.ready();assert.equal(restored.controller.getSnapshot().unknown,true);assert.ok(restored.calls[0].path.includes('/by-request/'+original.clientRequestId));assert.equal(restored.calls.some(call=>call.method==='POST'),false);await restored.controller.create();assert.equal(restored.calls.some(call=>call.method==='POST'),false);assert.equal(JSON.parse([...saved.values.values()][0]).request.clientRequestId,original.clientRequestId)}finally{restored.close()}
 }finally{first.close()}
});

test('a foreign or mismatched action acknowledgement never clears its journal or exposes a draft',async()=>{
 const mutations=[(r:AiDraftResponse)=>{r.preview.accountId='b'},(r:AiDraftResponse)=>{r.preview.sessionId='foreign'},(r:AiDraftResponse)=>{r.preview.payload.body='Substituted preview'},(r:AiDraftResponse)=>{r.creation!.previewId='different-preview'},(r:AiDraftResponse)=>{r.creation!.draftId='different-draft'},(r:AiDraftResponse)=>{r.request!.clientRequestId='different-key'},(r:AiDraftResponse)=>{r.request!.creationId='different-creation'},(r:AiDraftResponse)=>{r.draft!.accountId='b'}];
 for(const mutate of mutations){const f=fixture(call=>{if(call.method==='POST'){const response=created(preview(),call.body.clientRequestId);mutate(response);return response}});try{await f.ready();assert.equal(await f.controller.create(),null);assert.equal(f.controller.getSnapshot().unknown,true);assert.equal(f.controller.getSnapshot().response?.creation,null);assert.equal(f.values.size,1)}finally{f.close()}}
});

test('account/session loss and unmount fence a late successful creation without erasing its recovery key',async()=>{
 let current=true;const ack=deferred<unknown>(),f=fixture(call=>call.method==='POST'?ack.promise:undefined,memory(),preview(),()=>current);try{await f.ready();const pending=f.controller.create();const action=f.calls.find(call=>call.method==='POST')!;current=false;f.controller.suspend();assert.equal(action.signal?.aborted,true);ack.resolve(created(preview(),action.body.clientRequestId));assert.equal(await pending,null);assert.equal(f.controller.getSnapshot().response?.creation,null);assert.equal(f.values.size,1)}finally{f.close()}
});

test('late read-only status cannot regress a newer immutable creation mapping',async()=>{
 const old=deferred<unknown>();let reads=0;const f=fixture(call=>{if(call.method==='GET'){reads++;if(reads===2)return old.promise;if(reads===3)return created()}});try{await f.ready();const late=f.controller.load(),fresh=f.controller.load();await fresh;assert.equal(f.controller.getSnapshot().response?.creation?.draftId,'draft-a');old.resolve(empty());await late;assert.equal(f.controller.getSnapshot().response?.creation?.draftId,'draft-a');assert.equal(f.calls.some(call=>call.method==='POST'),false)}finally{f.close()}
});

test('storage write failure and corrupt saved intent fail closed before draft creation',async()=>{
 const failed=memory();failed.storage.setItem=()=>{throw new Error('Synthetic storage failure')};const f=fixture(undefined,failed);try{await f.ready();await f.controller.create();assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.match(f.controller.getSnapshot().error,/storage.*unavailable/i)}finally{f.close()}
 const corrupt=memory();corrupt.values.set('reconstruction.ai-draft.v1:'+JSON.stringify(['a','session-a','turn-a','preview-a']),'{broken');const g=fixture(undefined,corrupt);try{await g.ready();await g.controller.create();assert.equal(g.calls.length,0);assert.equal(g.controller.getSnapshot().unknown,true)}finally{g.close()}
});

test('an existing old-generation unavailable or locked mapping never silently creates a replacement',async()=>{
 for(const availability of ['unavailable','locked'] as const){const result=created();result.resolution={availability,draftId:null};delete result.draft;const f=fixture(()=>result);try{await f.ready();assert.equal(f.controller.getSnapshot().response?.resolution.availability,availability);await f.controller.create();assert.equal(f.calls.some(call=>call.method==='POST'),false)}finally{f.close()}}
});

test('preview validation rejects header injection and invalid neighbors without changing valid quoted mailbox intent',()=>{
 const p=preview();p.payload.to=[{email:'one@example.test',name:'Comma, "Quoted"'}];assert.equal(validAiDraftPreview(p,p),true);for(const mutate of [(v:AiDraftPreview)=>{v.payload.to.push({email:'not an address'})},(v:AiDraftPreview)=>{v.payload.subject='Review\r\nBcc: injected@example.test'},(v:AiDraftPreview)=>{v.payload.to[0].name='Name\0Hidden'},(v:AiDraftPreview)=>{v.payload.bcc=[{email:'b..c@example.test'}]}]){const wrong=structuredClone(p);mutate(wrong);assert.equal(validAiDraftPreview(wrong,wrong),false)}
});

test('a fresh explicit action for an advertised next generation creates its new mapping once',async()=>{
 const f=fixture(call=>call.method==='POST'?created(preview(),call.body.clientRequestId,1):gone());try{await f.ready();assert.equal(f.controller.getSnapshot().response?.createGeneration,1);const result=await f.controller.create();assert.equal(result?.creation?.generation,1);assert.equal(result?.creation?.draftId,'draft-a-generation-1');const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].body.expectedGeneration,1);await f.controller.create();assert.equal(f.calls.filter(call=>call.method==='POST').length,1)}finally{f.close()}
});

test('a same-key acknowledgement for the wrong generation remains unknown and cannot open its older draft',async()=>{
 const f=fixture(call=>call.method==='POST'?created(preview(),call.body.clientRequestId,0):gone());try{await f.ready();assert.equal(await f.controller.create(),null);assert.equal(f.calls.find(call=>call.method==='POST')?.body.expectedGeneration,1);assert.equal(f.controller.getSnapshot().unknown,true);assert.equal(f.controller.getSnapshot().response?.creation?.generation,0);assert.equal(f.controller.getSnapshot().response?.resolution.availability,'unavailable');assert.equal(f.values.size,1)}finally{f.close()}
});

test('a late older-generation read never replaces a newer created target or sends another action',async()=>{
 let reads=0;const f=fixture(call=>{if(call.method==='POST')return created(preview(),call.body.clientRequestId,1);return ++reads===1?gone():gone(0)});try{await f.ready();await f.controller.create();assert.equal(f.controller.getSnapshot().response?.creation?.generation,1);await f.controller.load();assert.equal(f.controller.getSnapshot().response?.creation?.generation,1);assert.equal(f.controller.getSnapshot().response?.creation?.draftId,'draft-a-generation-1');assert.equal(f.calls.filter(call=>call.method==='POST').length,1)}finally{f.close()}
});

test('recovery of a deleted old-generation action requires a second explicit click and a fresh generation-bound key',async()=>{
 let posts=0;const f=fixture(call=>{if(call.path.includes('/by-request/'))return gone(0,'key-1');if(call.method==='POST'){posts++;if(posts===1)throw new TypeError('Synthetic lost generation0 ACK');return created(preview(),call.body.clientRequestId,1)}});try{await f.ready();await f.controller.create();assert.equal(f.controller.getSnapshot().unknown,true);await f.controller.recover();assert.equal(f.controller.getSnapshot().unknown,false);assert.equal(posts,1,'Read-only recovery cannot activate the next generation');assert.equal(f.controller.getSnapshot().response?.createGeneration,1);const next=await f.controller.create();assert.equal(next?.creation?.generation,1);const actions=f.calls.filter(call=>call.method==='POST');assert.deepEqual(actions.map(call=>[call.body.clientRequestId,call.body.expectedGeneration]),[['key-1',0],['key-2',1]]);assert.equal(f.values.size,0)}finally{f.close()}
});

test('a delayed old-generation POST acknowledgement cannot clear the newer generation journal or retarget its mapping',async()=>{
 const oldAck=deferred<unknown>(),newAck=deferred<unknown>();let posts=0;
 const f=fixture(call=>{if(call.path.includes('/by-request/'))return gone(0,'key-1');if(call.method==='POST')return ++posts===1?oldAck.promise:newAck.promise});try{
  await f.ready();const old=f.controller.create();f.controller.suspend();f.controller.resume();await drain();assert.equal(f.controller.getSnapshot().unknown,false);assert.equal(f.controller.getSnapshot().response?.createGeneration,1);
  const next=f.controller.create();assert.equal(posts,2);assert.equal(JSON.parse([...f.values.values()][0]).request.clientRequestId,'key-2');oldAck.resolve(created(preview(),'key-1',0));assert.equal(await old,null);assert.equal(JSON.parse([...f.values.values()][0]).request.clientRequestId,'key-2','An old ACK cannot clear another generation request');
  newAck.resolve(created(preview(),'key-2',1));assert.equal((await next)?.creation?.draftId,'draft-a-generation-1');assert.equal(f.controller.getSnapshot().response?.creation?.generation,1);assert.equal(f.values.size,0);
 }finally{oldAck.resolve(created(preview(),'key-1',0));newAck.resolve(created(preview(),'key-2',1));f.close()}
});
