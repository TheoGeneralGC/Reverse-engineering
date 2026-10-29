import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ApiError} from '../src/api.ts';
import {createTrackingDelivery,trackingDeliveryJournalKey} from '../src/tracking/delivery.ts';
import type {TrackingDeliverySnapshot,TrackingDeliveryControlRequest,TrackingDeliveryControlResponse} from '../src/tracking/delivery-client.ts';
import type {TrackingRequest} from '../src/tracking/client.ts';
import {checkedTrackingDelivery} from '../src/tracking/delivery-client.ts';
const identity={accountId:'account-a',source:'composer' as const,operationId:'owned-send'};
const stable=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';
const digest=async(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
const snapshot=(patch:Partial<TrackingDeliverySnapshot>={}):TrackingDeliverySnapshot=>({...identity,version:1,policyVersion:'local-tracking-delivery-v1',draftId:'owned-draft',generation:0,revision:3,decision:{tracked:true,preferenceRevision:1,reason:'enabled'},phase:'held_before_gmail',mailOutcome:'not-issued',registration:'create-unknown',heldReason:'collector-unresolved',canReconcile:true,canContinue:false,reads:{availability:'unavailable',reason:'event-import-not-integrated',events:[],humanReadVerified:false,namedRecipientIdentity:false},...patch});
async function receipt(request:TrackingDeliveryControlRequest,state:'accepted'|'completed',s:TrackingDeliverySnapshot):Promise<TrackingDeliveryControlResponse>{return{state,historical:false,snapshot:structuredClone(s),receipt:{...identity,id:'receipt-'+request.clientRequestId,clientRequestId:request.clientRequestId,action:'reconcile',expectedRevision:request.expectedRevision,requestProtocol:'tracking-control-v1',requestFingerprint:await digest({protocol:'tracking-control-v1',request:{...identity,action:'reconcile',...request}}),acceptedAt:'2026-10-29T00:00:00.000Z'}}}
function storage(){const values=new Map<string,string>();return{values,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}}
const key=trackingDeliveryJournalKey(identity);

for(const status of [404,503])test('positive control acceptance survives a later current GET '+status+' without being relabelled preaccept refusal',async()=>{
 const store=storage();let accepted=false,posts=0;const request:TrackingRequest=async(_path,body,method='GET')=>{if(method==='POST'){posts++;accepted=true;return receipt(body as TrackingDeliveryControlRequest,'accepted',snapshot())}if(accepted)throw new ApiError('Synthetic later read unavailable',status,status===404?'tracking_delivery_not_found':'tracking_delivery_stopping');return snapshot()};
 const model=createTrackingDelivery({identity,request,storage:store,digest,uuid:()=> 'positive-key'});model.activate();try{await model.load();assert.equal(await model.control('reconcile'),null);assert.equal(store.values.has(key),true,'A later GET failure cannot delete a positively accepted action');assert.equal(model.getSnapshot().accepted,true);assert.equal(model.getSnapshot().unknown,true);assert.equal(await model.control('reconcile'),null);assert.equal(posts,1)}finally{model.dispose()}
});

test('remount recovery pins the reviewed draft and generation instead of accepting a retargeted same-operation receipt',async()=>{
 const store=storage();let posts=0;const first=createTrackingDelivery({identity,storage:store,digest,uuid:()=> 'lost-key',request:async(_p,_b,m='GET')=>{if(m==='POST'){posts++;throw Error('Synthetic accepted ACK loss')}return snapshot()}});first.activate();await first.load();await first.control('reconcile');first.dispose();const before=store.getItem(key)!;assert(before);
 const other=snapshot({draftId:'different-draft',generation:1,revision:4,registration:'prepared',canReconcile:false,canContinue:true});const response=await receipt({accountId:identity.accountId,clientRequestId:'lost-key',expectedRevision:3},'completed',other);
 const model=createTrackingDelivery({identity,storage:store,digest,request:async(path,_b,m='GET')=>{assert.equal(m,'GET');return path.includes('/requests/')?{...response,historical:true}:other}});model.activate();try{const value=await model.recover();assert.equal(value===null,true,'The original action cannot become a different draft/generation after remount');assert.equal(store.getItem(key),before);assert.equal(model.getSnapshot().snapshot,null);assert.equal(model.getSnapshot().unknown,true);assert.equal(posts,1)}finally{model.dispose()}
});

test('verified completed control snapshot is immutable across GET recovery after an independent current read failed',async()=>{
 const store=storage();let posts=0,failRead=true,known:TrackingDeliveryControlResponse|undefined;const complete=snapshot({revision:4,registration:'prepared',canReconcile:false,canContinue:true}),different=snapshot({revision:5,registration:'armed',canReconcile:false,canContinue:true});
 const request:TrackingRequest=async(path,body,method='GET')=>{if(method==='POST'){posts++;known=await receipt(body as TrackingDeliveryControlRequest,'completed',complete);return known}if(path.includes('/requests/'))return{...structuredClone(known!),snapshot:different,historical:true};if(known&&failRead)throw new ApiError('Synthetic current status read failure',500,'request_failed');return known?different:snapshot()};
 const model=createTrackingDelivery({identity,request,storage:store,digest,uuid:()=> 'completed-key'});model.activate();try{await model.load();assert.equal(await model.control('reconcile'),null);assert.equal(model.getSnapshot().receipt?.id,'receipt-completed-key');const before=store.getItem(key);assert(before);failRead=false;assert.equal(await model.recover()===null,true,'An already verified completed receipt cannot replace its immutable final snapshot');assert.equal(store.getItem(key),before);assert.equal(model.getSnapshot().unknown,true);assert.equal(posts,1)}finally{model.dispose()}
});

test('declared pre-native phases cannot claim unknown or issue-possible Gmail outcome, and issued phase cannot claim not-issued',()=>{
 const invalid:Partial<TrackingDeliverySnapshot>[]=[{phase:'issue_possible',mailOutcome:'not-issued',registration:'armed',heldReason:null,canReconcile:false},{phase:'queued',mailOutcome:'unknown',registration:'inactive',heldReason:null,canReconcile:false},{phase:'preparing',mailOutcome:'issue-possible',heldReason:null,canReconcile:false},{phase:'claimed',mailOutcome:'unknown',registration:'prepared',heldReason:null,canReconcile:false},{phase:'ready',mailOutcome:'unknown',registration:'armed',heldReason:null,canReconcile:false}];
 for(const patch of invalid)assert.throws(()=>checkedTrackingDelivery(snapshot(patch),identity),'A phase/outcome contradiction must not become a verified UI status');
});

test('invalid high revision cannot poison the current floor or block the next valid lower status',async()=>{
 const store=storage();let current:unknown=snapshot();const model=createTrackingDelivery({identity,storage:store,digest,request:async()=>current});model.activate();try{await model.load();current={...snapshot({revision:100}),reads:{...snapshot().reads,humanReadVerified:true}};assert.equal(await model.load(),null);assert.equal(model.getSnapshot().snapshot?.revision,3);current=snapshot({revision:4,registration:'prepared',canReconcile:false,canContinue:true});assert.equal((await model.load())?.revision,4);assert.equal(store.values.size,0)}finally{model.dispose()}
});

test('suspend during receipt digest cannot publish or clear an issued action; later recovery remains GET-only',async()=>{
 const store=storage();let resolve!:()=>void,entered!:()=>void,hashes=0,posts=0,known:TrackingDeliveryControlResponse|undefined;const waiting=new Promise<void>(ok=>{resolve=ok}),started=new Promise<void>(ok=>{entered=ok});const complete=snapshot({revision:4,registration:'prepared',canReconcile:false,canContinue:true});
 const slowDigest=async(v:unknown)=>{if(++hashes===2){entered();await waiting}return digest(v)};const calls:string[]=[];const request:TrackingRequest=async(path,body,method='GET')=>{calls.push(method);if(method==='POST'){posts++;known=await receipt(body as TrackingDeliveryControlRequest,'completed',complete);return known}return path.includes('/requests/')?{...known!,historical:true}:known?complete:snapshot()};
 const model=createTrackingDelivery({identity,storage:store,digest:slowDigest,uuid:()=> 'digest-key',request});model.activate();try{await model.load();const pending=model.control('reconcile');await started;const before=store.getItem(key);assert(before);model.suspend();resolve();assert.equal(await pending,null);assert.equal(model.getSnapshot().receipt,null);assert.equal(model.getSnapshot().snapshot?.revision,3);assert.equal(store.getItem(key),before);const count=calls.length;model.activate();assert.equal((await model.recover())?.state,'completed');assert(calls.slice(count).every(m=>m==='GET'));assert.equal(posts,1);assert.equal(store.values.size,0)}finally{model.dispose()}
});

test('failed journal removal retains the verified completed action and blocks another mutation',async()=>{
 const original=storage(),store={...original,removeItem:()=>{}};let posts=0,known:TrackingDeliveryControlResponse|undefined;const complete=snapshot({revision:4,registration:'prepared',canReconcile:false,canContinue:true});const model=createTrackingDelivery({identity,storage:store,digest,uuid:()=> 'clear-failed',request:async(_p,body,method='GET')=>{if(method==='POST'){posts++;known=await receipt(body as TrackingDeliveryControlRequest,'completed',complete);return known}return known?complete:snapshot()}});model.activate();try{await model.load();assert.equal(await model.control('reconcile'),null);assert.equal(model.getSnapshot().unknown,true);assert.equal(model.locked,true);assert.equal(model.getSnapshot().receipt?.id,'receipt-clear-failed');assert(original.values.has(key));assert.equal(await model.control('continue'),null);assert.equal(posts,1)}finally{model.dispose()}
});
