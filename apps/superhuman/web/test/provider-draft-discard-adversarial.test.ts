import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.ts';
import { ProviderDraftDiscardController, checkedProviderDiscardResponse, providerDiscardStorageKey, type ProviderDiscardJournal } from '../src/provider-draft-discard.ts';
import type { ProviderDraftDiscardRequest, ProviderDraftDiscardResponse, ProviderDraftSnapshot } from '../../api/src/provider-draft-types.ts';

const scope={accountId:'account-a',draftId:'draft-a'},slot=providerDiscardStorageKey(scope),hash='3'.repeat(64),at='2026-10-28T20:00:00.000Z';
function storage(){const data=new Map<string,string>();return{data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}}
function hold<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{promise,resolve}}
const reviewed=():ProviderDraftSnapshot=>({...scope,ownership:'replica-new',revision:2,state:'queued',desiredRevision:4,desiredHash:hash,syncedRevision:null,syncedHash:null,providerDraftId:null,providerMessageId:null,providerThreadId:null,operation:null,error:null,deliveryBlocked:false});
const identity=()=>({draftRevision:4,contentHash:hash,providerDraft:reviewed()});
const request=(key='discard-a'):ProviderDraftDiscardRequest=>({accountId:scope.accountId,clientRequestId:key,expectedDraftRevision:4,expectedContentHash:hash,expectedSyncRevision:2});
function answer(terminal=false,key='discard-a'):ProviderDraftDiscardResponse{return{
  receipt:{...scope,id:'receipt-a',clientRequestId:key,operationId:'delete-a',draftRevision:4,contentHash:hash,acceptedSyncRevision:2,acceptedAt:at},resolution:terminal?'discarded':'pending',
  providerDraft:{...reviewed(),revision:terminal?6:3,state:terminal?'discarded':'discard_queued',deliveryBlocked:true,operation:terminal?{...scope,id:'delete-a',kind:'delete',state:'confirmed',draftRevision:4,contentHash:hash,providerDraftId:null,providerMessageId:null,providerThreadId:null,result:null,createdAt:at,issuedAt:null,completedAt:at,resolution:'target-unavailable',error:null}:null},
}}

test('malformed high-revision ACK cannot poison a later valid same-key recovery or leak returned mutable objects',async()=>{
  const s=storage(),bad=answer(true);bad.providerDraft.revision=99999;bad.providerDraft.operation!.contentHash='f'.repeat(64);let current=bad;const calls:string[]=[];
  const c=new ProviderDraftDiscardController({...scope,storage:s,makeKey:()=> 'discard-a',pollMs:0,request:async(path,_body,method)=>{calls.push(method+' '+path);return current}});
  assert.equal(await c.discard(identity()),false);assert.equal(c.getSnapshot().unknown,true);assert.equal(c.getSnapshot().settled,false);
  current=answer(true);assert.equal(await c.recover(),true);assert.equal(c.getSnapshot().response!.providerDraft.revision,6);
  current.receipt.id='mutated-after-response';current.providerDraft.operation!.id='mutated-after-response';
  assert.equal(c.getSnapshot().response!.receipt.id,'receipt-a');assert.equal(c.getSnapshot().response!.providerDraft.operation!.id,'delete-a');assert.equal(calls.filter(call=>call.startsWith('POST')).length,1);c.dispose();
});

test('a valid newer window journal survives deferred old recovery and cannot be adopted or exposed by that controller',async()=>{
  const s=storage(),gate=hold<unknown>(),calls:string[]=[];let wait=true;
  const c=new ProviderDraftDiscardController({...scope,storage:s,makeKey:()=> 'discard-a',pollMs:0,request:async(path,_body,method)=>{calls.push(method+' '+path);if(method==='POST')throw Error('Lost acknowledgement');return wait?gate.promise:answer(true)}});
  await c.discard(identity());const pending=c.recover();
  const replacement:ProviderDiscardJournal={version:1,draftId:scope.draftId,request:request('discard-b'),reviewed:reviewed(),accepted:null};const bytes=JSON.stringify(replacement);s.setItem(slot,bytes);gate.resolve(answer(true));
  assert.equal(await pending,false);assert.equal(c.getSnapshot().response,null);assert.equal(c.releaseTerminal(),false);assert.equal(s.getItem(slot),bytes);
  wait=false;assert.equal(await c.recover(),false);assert.equal(s.getItem(slot),bytes);assert.ok(calls.filter(call=>call.startsWith('GET')).every(call=>call.includes('/discard-a?')));assert.equal(await c.discard(identity()),false);c.dispose();
});

test('accepted-response storage failure remains locked and remount performs one historical GET without POST replay',async()=>{
  const s=storage();let writes=0,posts=0;const flaky={...s,setItem:(key:string,value:string)=>{if(++writes===1)s.setItem(key,value)}};
  const first=new ProviderDraftDiscardController({...scope,storage:flaky,makeKey:()=> 'discard-a',pollMs:0,request:async()=>{posts++;return answer(true)}});
  assert.equal(await first.discard(identity()),false);assert.equal(first.getSnapshot().unknown,true);assert.equal(first.getSnapshot().response,null);assert.equal(first.releaseTerminal(),false);assert.equal(JSON.parse(s.getItem(slot)!).accepted,null);first.dispose();
  const calls:string[]=[];const next=new ProviderDraftDiscardController({...scope,storage:s,pollMs:0,makeKey:()=>{throw Error('Never issue another intent')},request:async(path,_body,method)=>{calls.push(method+' '+path);return answer(true)}});
  assert.equal(next.getSnapshot().settled,false);assert.equal(await next.recover(),true);assert.equal(next.getSnapshot().settled,true);assert.equal(posts,1);assert.deepEqual(calls,['GET /draft-discard-operations/by-request/discard-a?accountId=account-a&draftId=draft-a']);next.dispose();
});

test('a definite refusal cannot clear another window intent replaced while the original POST was pending',async()=>{
  const s=storage(),gate=hold<unknown>();let posts=0;
  const c=new ProviderDraftDiscardController({...scope,storage:s,makeKey:()=> 'discard-a',pollMs:0,request:async()=>{posts++;return gate.promise}});
  const running=c.discard(identity()),replacement=JSON.stringify({version:1,draftId:scope.draftId,request:request('discard-b'),reviewed:reviewed(),accepted:null});s.setItem(slot,replacement);
  gate.resolve(Promise.reject(new ApiError('Reviewed revision changed',409,'provider_draft_revision_conflict')));
  assert.equal(await running,false);assert.equal(c.getSnapshot().blocked,true);assert.equal(c.getSnapshot().refused,false);assert.equal(s.getItem(slot),replacement);assert.equal(await c.discard(identity()),false);assert.equal(posts,1);c.dispose();
});

test('suspended recovery loses authority permanently for its old response, even after explicit reactivation',async()=>{
  const s=storage(),gate=hold<unknown>();let reads=0;
  const c=new ProviderDraftDiscardController({...scope,storage:s,makeKey:()=> 'discard-a',pollMs:0,request:async(_path,_body,method)=>{if(method==='POST')throw Error('Lost ACK');return ++reads===1?gate.promise:answer(true)}});
  await c.discard(identity());const old=c.recover();c.suspend();c.activate();gate.resolve(answer(true));assert.equal(await old,false);
  assert.equal(c.getSnapshot().response,null);assert.equal(c.getSnapshot().settled,false);assert.equal(c.releaseTerminal(),false);assert.equal(await c.recover(),true);assert.equal(reads,2);c.dispose();
});

test('terminal proofs bind issued status and the exact mapped versus never-issued local target',()=>{
  const valid=answer(true);assert.equal(checkedProviderDiscardResponse(valid,scope,request()).resolution,'discarded');
  for(const mutate of [
    (value:ProviderDraftDiscardResponse)=>{value.providerDraft.operation!.issuedAt=at},
    (value:ProviderDraftDiscardResponse)=>{value.providerDraft.operation!.draftRevision=3},
    (value:ProviderDraftDiscardResponse)=>{value.providerDraft.providerMessageId='unexpected-message';value.providerDraft.operation!.providerMessageId='unexpected-message'},
    (value:ProviderDraftDiscardResponse)=>{value.resolution='unavailable'},
  ]){const candidate=structuredClone(valid);mutate(candidate);assert.throws(()=>checkedProviderDiscardResponse(candidate,scope,request()))}
});

test('a released terminal lifecycle cannot rearm a fresh key or POST for the same permanently discarded draft',async()=>{
  const s=storage();let posts=0,keys=0;
  const c=new ProviderDraftDiscardController({...scope,storage:s,makeKey:()=> ++keys===1?'discard-a':'discard-b',pollMs:0,request:async()=>{posts++;return answer(true)}});
  assert.equal(await c.discard(identity()),true);assert.equal(c.releaseTerminal(),true);assert.equal(s.getItem(slot),null);
  assert.equal(await c.discard(identity()),false);assert.equal(posts,1);assert.equal(keys,1);assert.equal(s.getItem(slot),null);assert.equal(c.getSnapshot().released,true);c.dispose();
});
