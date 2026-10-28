import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.ts';
import { createDeliveryAcceleration, deliveryOperationIdentity, validDeliveryDeadline, validDeliveryDeadlineTransition } from '../src/delivery-acceleration.ts';
import type { DeliverySnapshot, DeliveryOperation } from '../src/delivery-acceleration.ts';
import type { AiDraftRequest, AiDraftStorage } from '../src/ai-draft.ts';
import type { DeliveryControlScope } from '../../api/src/delivery-control-types.ts';
import type { DraftSendOperation, DraftSendSnapshot } from '../../api/src/draft-send-types.ts';

const at='2026-10-28T22:00:00.000Z', now='2026-10-28T22:00:01.000Z', deadline='2026-10-28T22:00:10.000Z';
const op=():DraftSendOperation=>({id:'owned-op',accountId:'owned-account',draftId:'owned-draft',generation:2,mode:'immediate',scheduledAt:null,clientRequestId:'original-send-key',draftRevision:4,contentHash:'a'.repeat(64),state:'queued',revision:0,createdAt:at,startedAt:null,confirmedAt:null,cancellableUntil:deadline,cancelledAt:null,deliveryAttemptId:null,providerMessageId:null,error:null});
const scope=():DeliveryControlScope=>({source:'composer',accountId:'owned-account',operationId:'owned-op'});
const snapshot=(operation:DraftSendOperation=op()):DraftSendSnapshot=>({operation,latestGeneration:2,draftRevision:4,contentHash:'a'.repeat(64),serverNow:now,canCancel:!operation.accelerationId,eligibility:{eligible:false,generation:null,reason:'locked'},resolution:{availability:'locked',draftId:null}});
function response(key='accelerate-key',operation:DeliveryOperation=op(),source:DeliveryControlScope=scope()){
 return{source:source.source,snapshot:{...snapshot(),operation:{...operation,revision:1,cancellableUntil:now,originalCancellableUntil:deadline,accelerationId:'acceleration-receipt',acceleratedAt:now},canCancel:false},acceleration:{id:'acceleration-receipt',source:source.source,accountId:source.accountId,operationId:source.operationId,clientRequestId:key,priorRevision:0,createdAt:now,originalDeadlineAt:deadline,effectiveDeadlineAt:now}};
}
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}};
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
function memory(){const values=new Map<string,string>();const storage:AiDraftStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}};return{storage,values}}
type Call={path:string;body:any;method:string;signal?:AbortSignal};
function fixture(handler:(call:Call)=>unknown|Promise<unknown>,saved=memory(),extra:{isCurrent?:()=>boolean;canAccelerate?:()=>boolean;operation?:DeliveryOperation;scope?:DeliveryControlScope}={}){
 const calls:Call[]=[],request:AiDraftRequest=async(path,body,method='GET',options)=>{const call={path,body:body===undefined?undefined:structuredClone(body),method,signal:options?.signal};calls.push(call);return handler(call)};
 const model=createDeliveryAcceleration({operation:extra.operation??op(),scope:extra.scope??scope(),request,storage:saved.storage,uuid:()=> 'accelerate-key',isCurrent:extra.isCurrent,canAccelerate:extra.canAccelerate});return{model,calls,...saved};
}

test('unavailable or silently dropped durable storage prevents every acceleration POST',async()=>{
 for(const failure of ['throw','drop','readback']as const){const saved=memory();if(failure==='throw')saved.storage.setItem=()=>{throw Error('Synthetic storage unavailable')};if(failure==='drop')saved.storage.setItem=()=>{};if(failure==='readback')saved.storage.getItem=()=>null;
  const f=fixture(()=>response(),saved);try{f.model.resume();assert.equal(await f.model.accelerate(snapshot()),null);assert.equal(f.calls.length,0,failure);assert.match(f.model.getSnapshot().error,/storage.*unavailable/i)}finally{f.model.dispose()}
 }
});

test('dynamic account/view and cross-action guards prevent a new action, while a synchronous duplicate gets one durable key',async()=>{
 let current=true,allowed=true;const ack=deferred<unknown>(),f=fixture(()=>ack.promise,memory(),{isCurrent:()=>current,canAccelerate:()=>allowed});try{
  await f.model.accelerate(snapshot());assert.equal(f.calls.length,0);f.model.resume();allowed=false;await f.model.accelerate(snapshot());current=false;allowed=true;await f.model.accelerate(snapshot());assert.equal(f.calls.length,0);current=true;
  const pending=f.model.accelerate(snapshot());await f.model.accelerate(snapshot());assert.equal(f.calls.length,1);assert.equal(f.values.size,1);assert.deepEqual(f.calls[0].body,{...scope(),clientRequestId:'accelerate-key',expectedRevision:0});ack.resolve(response());await pending;assert.equal(f.model.getSnapshot().receipt?.id,'acceleration-receipt');await f.model.accelerate(snapshot());assert.equal(f.calls.length,1);
 }finally{f.model.dispose()}
});

test('scope, Send key, generation, draft, hash and every receipt/deadline binding must agree before success',async()=>{
 const variants:((r:ReturnType<typeof response>)=>void)[]=[r=>{r.source='artifact'},r=>{r.snapshot.operation.accountId='foreign-account'},r=>{r.snapshot.operation.clientRequestId='foreign-send-key'},r=>{r.snapshot.operation.generation=3},r=>{r.snapshot.operation.draftId='foreign-draft'},r=>{(r.snapshot.operation as DraftSendOperation).contentHash='b'.repeat(64)},r=>{r.acceleration.clientRequestId='foreign-accelerate-key'},r=>{r.acceleration.priorRevision=1},r=>{r.acceleration.originalDeadlineAt=now},r=>{r.acceleration.effectiveDeadlineAt=at},r=>{r.snapshot.operation.accelerationId='foreign-receipt'},r=>{r.snapshot.operation.revision=0},r=>{r.snapshot.canCancel=true},r=>{r.snapshot.serverNow=at}];
 for(const mutate of variants){const f=fixture(()=>{const r=response();mutate(r);return r});try{f.model.resume();assert.equal(await f.model.accelerate(snapshot()),null);assert.equal(f.model.getSnapshot().receipt,null);assert.equal(f.model.getSnapshot().unknown,true);assert.equal(f.values.size,1);await f.model.accelerate(snapshot());assert.equal(f.calls.length,1)}finally{f.model.dispose()}}
});

test('artifact acceleration carries exact account/session/turn identity and never includes preview payload or a delivery command',async()=>{
 const operation={...op(),sessionId:'owned-session',turnId:'owned-turn',previewId:'owned-preview',creationId:'owned-creation',payloadHash:'c'.repeat(64)} as DeliveryOperation;
 const owned:DeliveryControlScope={source:'artifact',accountId:operation.accountId,operationId:operation.id,sessionId:'owned-session',turnId:'owned-turn'};
 const f=fixture(()=>response('accelerate-key',operation,owned),memory(),{operation,scope:owned});try{f.model.resume();await f.model.accelerate({...snapshot(),operation} as DeliverySnapshot);assert.deepEqual(f.calls[0].body,{...owned,clientRequestId:'accelerate-key',expectedRevision:0});assert.equal(f.calls[0].path,'/delivery-accelerations');assert.equal(f.calls[0].method,'POST');assert.equal(f.model.getSnapshot().receipt?.source,'artifact');assert.equal(f.calls.length,1)}finally{f.model.dispose()}
 assert.throws(()=>fixture(()=>null,memory(),{operation,scope:{...owned,sessionId:'foreign-session'}}),/identity/);
});

test('lost acknowledgement survives unmount and404 recovery with the original key, GET only and no replacement action',async()=>{
 const saved=memory(),first=fixture(()=>{throw Error('Synthetic lost acknowledgement')},saved);try{first.model.resume();await first.model.accelerate(snapshot());assert.equal(first.model.getSnapshot().unknown,true)}finally{first.model.dispose()}
 const before=[...saved.values],second=fixture(()=>{throw new ApiError('Not visible',404,'delivery_control_not_found')},saved);try{second.model.resume();await drain();await second.model.recover();await second.model.accelerate(snapshot());assert.ok(second.calls.length>=1);assert.ok(second.calls.every(c=>c.method==='GET'&&c.path.includes('/by-request/accelerate-key?')));assert.deepEqual([...saved.values],before);assert.equal(second.model.getSnapshot().unknown,true)}finally{second.model.dispose()}
});

test('deferred old-key recovery preserves a replacement journal without adopting or reading its new key',async()=>{
 const saved=memory(),first=fixture(()=>{throw Error('Synthetic lost ACK')},saved);first.model.resume();await first.model.accelerate(snapshot());first.model.dispose();
 const ack=deferred<unknown>(),f=fixture(()=>ack.promise,saved);try{f.model.resume();assert.equal(f.calls.length,1);const storageKey=[...saved.values.keys()][0],replacement=JSON.parse(saved.values.get(storageKey)!);replacement.request.clientRequestId='other-tab-key';const bytes=JSON.stringify(replacement);saved.values.set(storageKey,bytes);
  ack.resolve(response());await drain();assert.equal(f.model.getSnapshot().receipt?.id,'acceleration-receipt');assert.equal(f.model.getSnapshot().unknown,false);assert.equal(saved.values.get(storageKey),bytes);await f.model.recover();await f.model.accelerate(snapshot());assert.equal(f.calls.length,1);assert.ok(f.calls.every(c=>c.path.includes('accelerate-key')));assert.equal(saved.values.get(storageKey),bytes);
 }finally{f.model.dispose()}
});

test('suspension aborts a pending request and rejects late success without deleting its durable intent',async()=>{
 let current=true;const ack=deferred<unknown>(),f=fixture(()=>ack.promise,memory(),{isCurrent:()=>current});try{f.model.resume();const pending=f.model.accelerate(snapshot());const before=[...f.values];current=false;f.model.suspend();assert.equal(f.calls[0].signal?.aborted,true);ack.resolve(response());assert.equal(await pending,null);assert.equal(f.model.getSnapshot().receipt,null);assert.deepEqual([...f.values],before);assert.equal(f.model.getSnapshot().unknown,true)}finally{f.model.dispose()}
});

test('known pre-acceptance conflicts release only their key; network/server failures remain unresolved',async()=>{
 for(const refusal of [true,false]){const f=fixture(()=>{throw new ApiError('Synthetic refusal',refusal?409:500,refusal?'delivery_control_conflict':'internal_error')});try{f.model.resume();await f.model.accelerate(snapshot());assert.equal(f.model.getSnapshot().unknown,!refusal);assert.equal(f.values.size,refusal?0:1);assert.equal(f.model.getSnapshot().receipt,null)}finally{f.model.dispose()}}
});

test('all acceleration metadata must form one shortening transition and remain immutable thereafter',()=>{
 const old=op(),next=response().snapshot.operation;
 for(const patch of [{accelerationId:'receipt'}, {acceleratedAt:now}, {originalCancellableUntil:deadline},{accelerationId:'receipt',acceleratedAt:now,originalCancellableUntil:deadline},{accelerationId:'receipt',acceleratedAt:deadline,originalCancellableUntil:deadline,cancellableUntil:deadline},{...next,mode:'scheduled'}])assert.equal(validDeliveryDeadline({...old,...patch},now),false);
 assert.equal(validDeliveryDeadlineTransition(old,next,now),true);assert.equal(validDeliveryDeadlineTransition(next,{...next,revision:3},now),true);
 for(const patch of [{accelerationId:undefined,acceleratedAt:undefined,originalCancellableUntil:undefined},{originalCancellableUntil:'2026-10-28T22:00:11.000Z'},{cancellableUntil:at,acceleratedAt:at},{accelerationId:'new-receipt'}])assert.equal(validDeliveryDeadlineTransition(next,{...next,...patch},now),false);
 assert.notEqual(deliveryOperationIdentity(old),deliveryOperationIdentity({...old,clientRequestId:'another-send'}));
});
