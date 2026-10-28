import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiDraftSend } from '../src/ai-draft-send.ts';
import { ApiError } from '../src/api.ts';
import type { AiDraftPreview,AiDraftRequest,AiDraftStorage } from '../src/ai-draft.ts';
import type { AiDraftSendSnapshot,AiDraftSendState as OperationState } from '../../api/src/ai-draft-send-types.ts';
const at='2026-10-28T12:00:00Z';
const preview=():AiDraftPreview=>({id:'preview-a',accountId:'a',sessionId:'session-a',turnId:'turn-a',kind:'draft-preview',payloadHash:'a'.repeat(64),sourceIds:[],createdAt:at,payload:{to:[{email:'recipient@example.test'}],cc:[],bcc:[],subject:'Synthetic immutable send',body:'Thursday, three samples.'}});
const eligible=():AiDraftSendSnapshot=>({preview:preview(),creation:null,operation:null,eligibility:{eligible:true,createGeneration:0,reason:'eligible'},serverNow:at,canCancel:false,latestGeneration:null});
function snapshot(state:OperationState='queued',revision=1,key='key-1'):AiDraftSendSnapshot{
 const p=preview(),scope={accountId:p.accountId,sessionId:p.sessionId,turnId:p.turnId},creation={id:'creation-a',...scope,previewId:p.id,payloadHash:p.payloadHash,draftId:'draft-a',generation:0,createdAt:at},claimed=['sending','sent','outcome_unknown'].includes(state);
 return{preview:p,creation,operation:{id:'operation-a',...scope,previewId:p.id,generation:0,creationId:creation.id,draftId:creation.draftId,clientRequestId:key,payloadHash:p.payloadHash,state,revision,createdAt:at,cancellableUntil:'2026-10-28T12:00:10Z',cancelledAt:state==='cancelled'?at:null,...(state==='cancelled'?{cancelledFromRevision:revision-1}:{}),startedAt:claimed?at:null,confirmedAt:state==='sent'?at:null,deliveryAttemptId:claimed?'attempt-a':null,providerMessageId:state==='sent'?'provider-ack-a':null,error:state==='outcome_unknown'?{code:'delivery_unknown',message:'Check Sent.',retry:'none',providerOutcome:'unknown'}:null},eligibility:{eligible:false,createGeneration:null,reason:'send_claimed'},serverNow:at,canCancel:state==='queued',latestGeneration:0};
}
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
function memory(){const values=new Map<string,string>();const storage:AiDraftStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}};return{values,storage}}
type Call={path:string;method:string;body:any;signal?:AbortSignal};
function fixture(handler?:(call:Call)=>unknown|Promise<unknown>,saved=memory(),options:{isCurrent?:()=>boolean;canSend?:()=>boolean;pollMs?:number}={}){
 const calls:Call[]=[];let next=0;const request:AiDraftRequest=async(path,body,method='GET',o)=>{const call={path,method,body:body===undefined?undefined:structuredClone(body),signal:o?.signal};calls.push(call);const value=await handler?.(call);if(value!==undefined)return value;if(method==='GET')return eligible();throw new Error('Unexpected synthetic action '+method+' '+path)};
 const controller=createAiDraftSend({preview:preview(),request,storage:saved.storage,uuid:()=>`key-${++next}`,pollMs:0,...options});return{controller,calls,...saved,ready:async()=>{controller.resume();await drain()},close:()=>controller.dispose()};
}

test('duplicate Send clicks persist one immutable generation key and no caller-authored draft fields',async()=>{
 const ack=deferred<unknown>(),f=fixture(call=>call.method==='POST'?ack.promise:undefined);try{await f.ready();const one=f.controller.send();void f.controller.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.values.size,1);const sent=f.calls.find(c=>c.method==='POST')!;assert.deepEqual(Object.keys(sent.body).sort(),['accountId','clientRequestId','expectedGeneration','expectedPreviewHash','sessionId','turnId']);ack.resolve(snapshot('queued',1,sent.body.clientRequestId));assert.equal((await one)?.operation?.state,'queued');await f.controller.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.values.size,0)}finally{f.close()}
});

test('lost ACK plus by-key404 stays locked across remount and never generates a replacement Send key',async()=>{
 const saved=memory(),handler=(call:Call)=>{if(call.method==='POST')throw new TypeError('Synthetic lost ACK');if(call.path.includes('/by-request/'))throw new ApiError('Not found',404,'ai_draft_send_not_found')};const one=fixture(handler,saved);try{await one.ready();await one.controller.send();assert.equal(one.controller.getSnapshot().unknown,true);await one.controller.recover();await one.controller.send();assert.equal(one.calls.filter(c=>c.method==='POST').length,1);one.close();const two=fixture(handler,saved);try{await two.ready();assert.equal(two.controller.getSnapshot().unknown,true);assert.ok(two.calls[0].path.includes('/by-request/key-1'));await two.controller.send();assert.equal(two.calls.some(c=>c.method==='POST'),false);assert.equal(JSON.parse([...saved.values.values()][0]).request.clientRequestId,'key-1')}finally{two.close()}}finally{one.close()}
});

test('foreign, wrong-key/generation and incomplete Sent acknowledgements retain the pending key without exposing success',async()=>{
 const variants=[(s:AiDraftSendSnapshot)=>{s.preview.accountId='b'},(s:AiDraftSendSnapshot)=>{s.operation!.sessionId='other-session'},(s:AiDraftSendSnapshot)=>{s.creation!.draftId='foreign-draft'},(s:AiDraftSendSnapshot)=>{s.operation!.clientRequestId='other-key'},(s:AiDraftSendSnapshot)=>{s.creation!.generation=1;s.operation!.generation=1},(s:AiDraftSendSnapshot)=>{s.operation!.state='sent';s.operation!.providerMessageId=null},(s:AiDraftSendSnapshot)=>{s.preview.payload.body='Substituted immutable body'}];
 for(const mutate of variants){const f=fixture(call=>{if(call.method==='POST'){const value=snapshot('queued',1,call.body.clientRequestId);mutate(value);return value}});try{await f.ready();assert.equal(await f.controller.send(),null);assert.equal(f.controller.getSnapshot().unknown,true);assert.equal(f.controller.getSnapshot().response?.operation,null);assert.equal(f.values.size,1)}finally{f.close()}}
});

test('new account/view loss aborts a pending acknowledgement without clearing its account-scoped durable key',async()=>{
 let current=true;const ack=deferred<unknown>(),f=fixture(call=>call.method==='POST'?ack.promise:undefined,memory(),{isCurrent:()=>current});try{await f.ready();const pending=f.controller.send(),sent=f.calls.find(c=>c.method==='POST')!;current=false;f.controller.suspend();assert.equal(sent.signal?.aborted,true);ack.resolve(snapshot('sent',3,sent.body.clientRequestId));assert.equal(await pending,null);assert.equal(f.controller.getSnapshot().response?.operation,null);assert.equal(f.values.size,1)}finally{f.close()}
});

test('the dynamic Create/unknown-action guard and unavailable browser storage prevent Send before any POST',async()=>{
 let canSend=true;const f=fixture(undefined,memory(),{canSend:()=>canSend});try{await f.ready();canSend=false;await f.controller.send();assert.equal(f.calls.some(c=>c.method==='POST'),false)}finally{f.close()}
 for(const mode of ['throws','silently-drops']as const){const saved=memory();saved.storage.setItem=()=>{if(mode==='throws')throw new Error('Synthetic storage failure')};const g=fixture(undefined,saved);try{await g.ready();await g.controller.send();assert.equal(g.calls.some(c=>c.method==='POST'),false,mode);assert.match(g.controller.getSnapshot().error,/storage.*unavailable/i)}finally{g.close()}}
});

test('late queued history never downgrades newer confirmed Sent or rearms the same preview',async()=>{
 const late=deferred<unknown>();let reads=0;const f=fixture(call=>{if(call.method==='GET'){reads++;if(reads===1)return snapshot('sending',2);if(reads===2)return late.promise;return snapshot('sent',4)}});try{await f.ready();const old=f.controller.load(),fresh=f.controller.load();await fresh;late.resolve(snapshot('queued',1));await old;assert.equal(f.controller.getSnapshot().response?.operation?.state,'sent');await f.controller.send();assert.equal(f.calls.some(c=>c.method==='POST'),false)}finally{f.close()}
});

test('a known delivery attempt and confirmed provider ID cannot be swapped by a later same-operation snapshot',async()=>{
 for(const field of ['attempt','provider']as const){let reads=0;const f=fixture(()=>{const first=snapshot(field==='attempt'?'sending':'sent',3);if(++reads===1)return first;const changed=snapshot('sent',4);if(field==='attempt')changed.operation!.deliveryAttemptId='different-attempt';else changed.operation!.providerMessageId='different-provider-ack';return changed});try{await f.ready();const before=structuredClone(f.controller.getSnapshot().response);assert.equal(await f.controller.load(),null,'Conflicting durable receipt identity must be rejected');assert.equal(f.controller.getSnapshot().response?.operation?.deliveryAttemptId,before!.operation!.deliveryAttemptId);assert.equal(f.controller.getSnapshot().response?.operation?.providerMessageId,before!.operation!.providerMessageId);assert.equal(f.calls.some(c=>c.method==='POST'),false)}finally{f.close()}}
});

test('reconciliation is explicit, uses only the saved operation scope, and cannot become another Send',async()=>{
 const ack=deferred<unknown>();const f=fixture(call=>call.method==='POST'?ack.promise:snapshot('outcome_unknown',3));try{await f.ready();const one=f.controller.reconcile();void f.controller.reconcile();const posts=f.calls.filter(c=>c.method==='POST');assert.equal(posts.length,1);assert.ok(posts[0].path.endsWith('/send-actions/operation-a/reconcile'));assert.deepEqual(posts[0].body,{accountId:'a',sessionId:'session-a',turnId:'turn-a'});ack.resolve(snapshot('sent',4));assert.equal((await one)?.operation?.state,'sent');await f.controller.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,1)}finally{f.close()}
});

test('an older ACK cannot erase another tab newer saved Send key',async()=>{
 const saved=memory(),ack=deferred<unknown>(),f=fixture(call=>call.method==='POST'?ack.promise:undefined,saved);try{await f.ready();const pending=f.controller.send(),storageKey=[...saved.values.keys()][0],newer=JSON.parse(saved.values.get(storageKey)!);newer.request.clientRequestId='another-tab-key';saved.values.set(storageKey,JSON.stringify(newer));ack.resolve(snapshot('queued'));await pending;assert.equal(JSON.parse(saved.values.get(storageKey)!).request.clientRequestId,'another-tab-key');assert.equal(f.controller.getSnapshot().unknown,true);await f.controller.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,1)}finally{f.close()}
});

test('a failed queued-status poll stops the timer instead of spinning or resending',async()=>{
 const set=globalThis.setTimeout,clear=globalThis.clearTimeout,jobs=new Map<number,()=>void>();let next=0,reads=0;
 globalThis.setTimeout=((callback:()=>void)=>{const id=++next;jobs.set(id,callback);return id})as unknown as typeof setTimeout;globalThis.clearTimeout=((id:number)=>{jobs.delete(id)})as unknown as typeof clearTimeout;
 const f=fixture(()=>{if(++reads===1)return snapshot('queued');throw new TypeError('Synthetic status outage')},memory(),{pollMs:5});try{await f.ready();assert.equal(jobs.size,1);const[id,callback]=[...jobs][0];jobs.delete(id);callback();await drain();assert.equal(reads,2);assert.equal(jobs.size,0);assert.match(f.controller.getSnapshot().error,/status outage/);await f.controller.send();assert.equal(f.calls.some(c=>c.method==='POST'),false)}finally{f.close();globalThis.setTimeout=set;globalThis.clearTimeout=clear}
});
