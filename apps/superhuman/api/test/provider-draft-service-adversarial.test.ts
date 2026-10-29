import test from 'node:test';
import assert from 'node:assert/strict';
import PostalMime from 'postal-mime';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { ProviderDraftService, type ProviderDraftClock } from '../src/provider-drafts.ts';
import type { GmailDraftResource, ProviderDraftTransport } from '../src/provider-draft-transport.ts';
import type { Draft } from '../src/types.ts';
import { checkedProviderDiscardResponse } from '../../web/src/provider-draft-discard.ts';

function deferred<T=void>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done}); return{promise,resolve}; }
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(path=':memory:') {
  const store=new Store(path,false);
  for(const id of ['own','foreign'])store.put('account',id,{id,provider:'google',email:id+'@example.test',name:'Synthetic',color:'#123'});
  const remote=new Map<string,GmailDraftResource>();
  const calls={profile:0,create:0,update:0,delete:0,get:0,list:0,metadata:0}; let serial=0;
  const clock:ProviderDraftClock={now:()=>Date.parse('2026-10-28T20:00:00.000Z'),schedule:()=>({cancel(){}})};
  const transport:ProviderDraftTransport={
    ready(){},async profile(account){calls.profile++;return account.email},
    async create(_account,message){calls.create++;const n=++serial,value={id:'cloud-'+n,message:{id:'message-'+n,threadId:'cloud-thread',labelIds:['DRAFT'],raw:message.raw}};remote.set(value.id,value);return value},
    async update(_account,id,message){calls.update++;const value={id,message:{id:'message-'+(++serial),threadId:'cloud-thread',labelIds:['DRAFT'],raw:message.raw}};remote.set(id,value);return value},
    async get(_account,id){calls.get++;return remote.get(id)},
    async list(){calls.list++;return{drafts:[...remote.values()].map(value=>({id:value.id,message:{id:value.message.id}}))}},
    async metadata(_account,id){calls.metadata++;const value=[...remote.values()].find(value=>value.message.id===id)!;const parsed=await PostalMime.parse(Buffer.from(value.message.raw!,'base64url'));return{id,labelIds:['DRAFT'],payload:{headers:parsed.headers.map(header=>({name:header.originalKey,value:header.value}))}}},
    async delete(_account,id){calls.delete++;remote.delete(id)},
  };
  const service=new ProviderDraftService(store,transport,{clock,automatic:false,resume:false});
  return{store,service,transport,remote,calls,clock,newDraft(){return store.saveDraft({accountId:'own',subject:'Independent recipient-free fixture',body:'Cedar has three fictional samples.'},'composer')},
    request(draftId:string,key='discard-owned'){const draft=store.required<Draft>('draft',draftId),status=service.status('own',draftId);return{accountId:'own',clientRequestId:key,expectedDraftRevision:draft.revision!,expectedContentHash:status.desiredHash!,expectedSyncRevision:status.revision}},
    async close(){await service.close();store.close()}};
}

test('foreign scope cannot parse a corrupt owned mapping, operation or draft and performs no transport',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('own',draft.id);const operation=f.service.status('own',draft.id).operation!;
    f.store.db.prepare("UPDATE records SET data='not-json' WHERE kind='draft' AND id=?").run(draft.id);
    f.store.db.prepare("UPDATE provider_draft_links SET data='not-json' WHERE draft_id=?").run(draft.id);
    f.store.db.prepare("UPDATE provider_draft_operations SET data='not-json' WHERE id=?").run(operation.id);
    const before={...f.calls};assert.throws(()=>f.service.status('foreign',draft.id),{code:'provider_draft_not_found'});
    await assert.rejects(f.service.reconcile('foreign',draft.id,0),{code:'provider_draft_not_found'});
    assert.throws(()=>f.service.discardByRequest('foreign',draft.id,'unknown'),{code:'provider_draft_not_found'});
    assert.deepEqual(f.calls,before);
  }finally{await f.close()}
});

test('a matching receipt in an incomplete bounded scan never confirms or retries an ambiguous create',async()=>{
  const f=fixture();try{
    const create=f.transport.create;f.transport.create=async(...args)=>{await create(...args);throw Error('Synthetic lost acknowledgement')};
    const draft=f.newDraft();await f.service.flush('own',draft.id);const before=f.service.status('own',draft.id),original=before.operation!.id;
    f.transport.list=async(_account,page)=>{f.calls.list++;return{drafts:page?[]:[...f.remote.values()].map(value=>({id:value.id,message:{id:value.message.id}})),nextPageToken:page?'still-more':'page-two'}};
    const checked=await f.service.reconcile('own',draft.id,before.revision);
    assert.equal(checked.verification.matches,1);assert.equal(checked.verification.scanComplete,false);assert.equal(checked.verification.issuedOutcome,'unknown');
    assert.equal(checked.providerDraft.state,'outcome_unknown');assert.equal(checked.providerDraft.operation!.id,original);assert.equal(f.calls.list,2);
    await f.service.flush('own',draft.id);assert.deepEqual([f.calls.create,f.calls.update,f.calls.delete],[1,0,0]);
  }finally{await f.close()}
});

test('duplicate ownership headers and mismatched profile cannot create positive reconciliation evidence',async()=>{
  for(const mode of ['duplicate-header','profile-mismatch'] as const){const f=fixture();try{
    const create=f.transport.create;f.transport.create=async(...args)=>{await create(...args);throw Error('Synthetic lost acknowledgement')};
    const draft=f.newDraft();await f.service.flush('own',draft.id);const before=f.service.status('own',draft.id);
    if(mode==='profile-mismatch')f.transport.profile=async()=>{f.calls.profile++;return'foreign@example.test'};
    else {const metadata=f.transport.metadata;f.transport.metadata=async(...args)=>{const value=await metadata(...args);value.payload.headers.push({...value.payload.headers.find(header=>header.name.toLowerCase()==='x-reconstruction-draft-owner')!});return value}}
    const checked=await f.service.reconcile('own',draft.id,before.revision);
    assert.equal(checked.providerDraft.state,'outcome_unknown');assert.equal(checked.verification.issuedOutcome,'unknown');assert.equal(checked.verification.matches,0);
    assert.deepEqual([f.calls.create,f.calls.update,f.calls.delete],[1,0,0]);
  }finally{await f.close()}}
});

test('claim persistence failure prevents any provider write and leaves the authored draft intact',async()=>{
  const f=fixture();try{
    const draft=f.newDraft(),before=f.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(draft.id)!.data;
    f.store.db.exec("CREATE TEMP TRIGGER fail_claim BEFORE INSERT ON provider_draft_operations BEGIN SELECT RAISE(ABORT,'controlled claim failure');END");
    await f.service.flush('own',draft.id);
    assert.equal(f.calls.create,0);assert.equal(f.calls.update,0);assert.equal(f.calls.delete,0);assert.equal(f.service.status('own',draft.id).state,'blocked');
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM provider_draft_operations').get()!.n,0);
    assert.equal(f.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(draft.id)!.data,before);
  }finally{await f.close()}
});

test('owned discard preserves externally changed content even when remote draft and message IDs stay identical',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('own',draft.id);const input=f.request(draft.id),remote=f.remote.values().next().value!;
    const raw=Buffer.from(remote.message.raw!,'base64url').toString();
    const changed=raw.replace(Buffer.from(draft.body).toString('base64'),Buffer.from('External fictional changes.').toString('base64'));assert.notEqual(changed,raw);
    f.remote.set(remote.id,{...remote,message:{...remote.message,raw:Buffer.from(changed).toString('base64url')}});
    f.service.discard(draft.id,input);await f.service.flush('own',draft.id);
    assert.equal(f.calls.delete,0);assert.equal(f.service.status('own',draft.id).state,'remote_conflict');assert.equal(f.service.discardByRequest('own',draft.id,input.clientRequestId).resolution,'pending');
    assert.equal(f.store.required<Draft>('draft',draft.id).body,draft.body);assert.ok(f.remote.has(remote.id));
  }finally{await f.close()}
});

test('dead-owner recovery fences a delayed old ACK while a live independent owner remains dispatching',async()=>{
  for(const live of [true,false]){
    const dir=mkdtempSync(join(tmpdir(),'provider-owner-')),path=join(dir,'isolated.sqlite'),f=fixture(path),gate=deferred();let second:Store|undefined,next:ProviderDraftService|undefined;
    try{
      const create=f.transport.create;f.transport.create=async(...args)=>{await gate.promise;return create(...args)};
      const draft=f.newDraft(),running=f.service.flush('own',draft.id);await tick();const original=f.service.status('own',draft.id).operation!;assert.equal(original.state,'dispatching');
      second=new Store(path,false);next=new ProviderDraftService(second,f.transport,{clock:f.clock,automatic:false,resume:false,ownerAlive:()=>live});
      assert.equal(next.status('own',draft.id).operation!.state,live?'dispatching':'unknown');assert.equal(f.calls.create,0);
      gate.resolve();await running;const recovered=next.status('own',draft.id);
      assert.equal(recovered.state,live?'synced':'outcome_unknown');assert.equal(recovered.operation!.id,original.id);
      if(!live){assert.equal(recovered.providerDraftId,null);assert.equal(second.required<Draft>('draft',draft.id).providerDraftId,undefined);await next.flush('own',draft.id)}
      assert.equal(f.calls.create,1);assert.equal(f.calls.update,0);assert.equal(f.calls.delete,0);
    }finally{gate.resolve();await next?.close();second?.close();await f.close();rmSync(dir,{recursive:true,force:true})}
  }
});

test('closing during a held reconciliation aborts the read and ignores its delayed positive proof',async()=>{
  const f=fixture(),gate=deferred();try{
    const create=f.transport.create;f.transport.create=async(...args)=>{await create(...args);throw Error('Synthetic lost acknowledgement')};
    const draft=f.newDraft();await f.service.flush('own',draft.id);const before=f.service.status('own',draft.id),listing=f.transport.list;
    f.transport.list=async(...args)=>{await gate.promise;return listing(...args)};
    const read=f.service.reconcile('own',draft.id,before.revision);await tick();await f.service.close();const result=await read;
    assert.equal(result.providerDraft.state,'outcome_unknown');assert.equal(result.providerDraft.operation!.state,'unknown');
    gate.resolve();await tick();assert.equal(f.service.status('own',draft.id).state,'outcome_unknown');assert.deepEqual([f.calls.create,f.calls.update,f.calls.delete],[1,0,0]);
  }finally{gate.resolve();await f.close()}
});

test('terminal discard receipts reject persisted operation kind, target and source-hash substitutions',async()=>{
  for(const mutation of [{kind:'update'},{providerDraftId:'unrelated-cloud'},{contentHash:'f'.repeat(64)}]){const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('own',draft.id);const input=f.request(draft.id);
    f.service.discard(draft.id,input);await f.service.flush('own',draft.id);
    const response=f.service.discardByRequest('own',draft.id,input.clientRequestId);assert.equal(response.resolution,'discarded');
    const operation=response.providerDraft.operation!,row=f.store.db.prepare('SELECT data FROM provider_draft_operations WHERE id=?').get(operation.id)!;
    f.store.db.prepare('UPDATE provider_draft_operations SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(String(row.data)),...mutation}),operation.id);
    assert.throws(()=>f.service.discardByRequest('own',draft.id,input.clientRequestId),{code:'provider_draft_corrupt'});
    assert.equal(f.calls.delete,1);assert.equal(f.calls.create,1);assert.equal(f.store.get('draft',draft.id),undefined);
  }finally{await f.close()}}
});

test('a never-mapped local discard cannot acquire a fabricated issued provider attempt in its historical receipt',async()=>{
  const f=fixture();try{
    const draft=f.newDraft(),input=f.request(draft.id),result=f.service.discard(draft.id,input);assert.equal(result.response.resolution,'discarded');
    const operation=result.response.providerDraft.operation!;assert.equal(operation.providerDraftId,null);assert.equal(operation.issuedAt,null);
    f.store.db.prepare('UPDATE provider_draft_operations SET data=? WHERE id=?').run(JSON.stringify({...operation,issuedAt:operation.createdAt}),operation.id);
    assert.throws(()=>f.service.discardByRequest('own',draft.id,input.clientRequestId),{code:'provider_draft_corrupt'});
    assert.deepEqual([f.calls.create,f.calls.update,f.calls.delete],[0,0,0]);
  }finally{await f.close()}
});

test('actual never-mapped and mapped terminal service receipts satisfy the published browser boundary',async()=>{
  for(const mapped of [false,true]){const f=fixture();try{
    const draft=f.newDraft();if(mapped)await f.service.flush('own',draft.id);
    const input=f.request(draft.id);f.service.discard(draft.id,input);if(mapped)await f.service.flush('own',draft.id);
    const result=f.service.discardByRequest('own',draft.id,input.clientRequestId);
    assert.deepEqual(checkedProviderDiscardResponse(result,{accountId:'own',draftId:draft.id},input),result);
    assert.equal(result.resolution,'discarded');assert.equal(f.calls.delete,mapped?1:0);assert.equal(f.store.get('draft',draft.id),undefined);
  }finally{await f.close()}}
});
