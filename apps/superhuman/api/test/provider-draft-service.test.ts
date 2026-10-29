import test from 'node:test';
import PostalMime from 'postal-mime';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ProviderDraftService, type ProviderDraftClock } from '../src/provider-drafts.ts';
import { providerDraftInputIdentity } from '../src/provider-draft-mime.ts';
import { ProviderDraftRepository } from '../src/provider-draft-store.ts';
import { OperationQueue } from '../src/operation-queue.ts';
import type { ProviderDraftTransport, GmailDraftResource } from '../src/provider-draft-transport.ts';
import type { Draft } from '../src/types.ts';
function hold(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return{promise,resolve}}
function fixture(options:{automatic?:boolean;createGate?:ReturnType<typeof hold>;queue?:OperationQueue;createUnknown?:boolean}={}){
  const store=new Store(':memory:',false);store.put('account','google',{id:'google',provider:'google',email:'self@example.test',name:'Synthetic',color:'#000'});
  let number=0;const remote=new Map<string,GmailDraftResource>(),calls={create:0,update:0,delete:0,profile:0,get:0,list:0,metadata:0};
  const timers=new Set<()=>void>();const clock:ProviderDraftClock={now:()=>Date.parse('2026-10-28T00:00:00.000Z'),schedule:callback=>{timers.add(callback);return{cancel:()=>{timers.delete(callback)}}}};
  const transport:ProviderDraftTransport={ready(){},async profile(){calls.profile++;return'self@example.test'},async create(_account,message){calls.create++;if(options.createGate)await options.createGate.promise;const n=++number,value={id:'draft-'+n,message:{id:'message-'+n,threadId:'thread-1',labelIds:['DRAFT'],raw:message.raw}};remote.set(value.id,value);if(options.createUnknown)throw Error('Controlled lost ACK');return value},async update(_account,id,message){calls.update++;const value={id,message:{id:'message-'+(++number),threadId:'thread-1',labelIds:['DRAFT'],raw:message.raw}};remote.set(id,value);return value},async get(_account,id){calls.get++;return remote.get(id)},async list(){calls.list++;return{drafts:[...remote.values()].map(value=>({id:value.id,message:{id:value.message.id,threadId:value.message.threadId}}))}},async metadata(_account,id){calls.metadata++;const resource=[...remote.values()].find(value=>value.message.id===id);if(!resource)throw Error('Missing mock message');const parsed=await PostalMime.parse(Buffer.from(resource.message.raw!,'base64url'));return{id,labelIds:['DRAFT'],payload:{headers:parsed.headers.map(header=>({name:header.originalKey,value:header.value}))}}},async delete(_account,id){calls.delete++;remote.delete(id)}};
  const service=new ProviderDraftService(store,transport,{clock,automatic:options.automatic??false,resume:false,queue:options.queue});
  return{store,service,transport,remote,calls,timers,fire(){for(const callback of [...timers]){timers.delete(callback);callback()}},newDraft(input:Partial<Draft>={}){return store.saveDraft({accountId:'google',subject:'Recipient-free synthetic',body:'Three fictional samples.',...input},'composer')},async close(){await service.close();store.close()}};
}
test('new-owned automatic create/update coalesces local edits while opening an empty or legacy draft produces no cloud request',async()=>{
  const f=fixture({automatic:true});try{
    const legacy=f.store.saveDraft({accountId:'google',body:'Legacy untouched'});assert.equal(f.service.status('google',legacy.id).ownership,'unmanaged');
    const empty=f.newDraft({subject:'',body:'',html:'<div><br></div>'});assert.equal(f.service.status('google',empty.id).state,'idle');assert.equal(f.timers.size,0);
    const draft=f.newDraft();f.store.saveDraft({id:draft.id,body:'Newest local before debounce'});f.fire();await Promise.all([...f.service.active.values()]);
    assert.equal(f.calls.create,1);assert.equal(f.calls.update,0);assert.equal(f.service.status('google',draft.id).state,'synced');
    const synced=f.store.required<Draft>('draft',draft.id);assert.equal(synced.body,'Newest local before debounce');assert.equal(synced.providerDraftId,'draft-1');
    f.store.saveDraft({id:draft.id,body:'Second local update'});f.fire();await Promise.all([...f.service.active.values()]);
    const current=f.service.status('google',draft.id);assert.equal(f.calls.create,1);assert.equal(f.calls.update,1);assert.equal(current.providerDraftId,'draft-1');assert.equal(current.providerMessageId,'message-2');assert.equal(current.desiredRevision,current.syncedRevision);assert.equal(current.desiredHash,current.syncedHash);
    f.store.saveDraft({id:draft.id,body:'Second local update'});assert.equal(f.service.status('google',draft.id).state,'synced');f.fire();await Promise.all([...f.service.active.values()]);assert.equal(f.calls.update,1);
    assert.equal(f.store.required<Draft>('draft',legacy.id).body,'Legacy untouched');
  }finally{await f.close()}
});
test('late cloud ACK preserves newer authored fields and attachment removal while immutable issued bytes remain retained',async()=>{
  const gate=hold(),f=fixture({createGate:gate});try{
    const draft=f.newDraft(),added=f.store.addAttachment(draft.id,{name:'sample.txt',mimeType:'text/plain',data:Buffer.from('Immutable bytes').toString('base64')});
    const running=f.service.flush('google',draft.id);await new Promise<void>(resolve=>setImmediate(resolve));
    const original=f.service.status('google',draft.id).operation!;assert.equal(original.state,'dispatching');const payload=f.service.repository.payload('google',draft.id,original.id);
    f.store.removeAttachment(draft.id,added.attachment.id);const edited=f.store.saveDraft({id:draft.id,subject:'Newer subject',body:'Newer body'});gate.resolve();await running;
    const current=f.store.required<Draft>('draft',draft.id),status=f.service.status('google',draft.id);assert.equal(current.subject,edited.subject);assert.equal(current.body,edited.body);assert.equal(current.revision,edited.revision);assert.deepEqual(current.attachments,[]);assert.equal(status.state,'queued');assert.equal(status.syncedRevision,added.draft.revision);assert.deepEqual(f.service.repository.payload('google',draft.id,original.id).raw,payload.raw);
    await f.service.flush('google',draft.id);assert.equal(f.calls.create,1);assert.equal(f.calls.update,1);assert.equal(f.service.status('google',draft.id).state,'synced');
  }finally{gate.resolve();await f.close()}
});
test('ambiguous create never retries; local edits remain while delivery, direct native send and deletion stay locked',async()=>{
  const f=fixture({createUnknown:true});try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);assert.equal(f.calls.create,1);assert.equal(f.service.status('google',draft.id).state,'outcome_unknown');
    const edited=f.store.saveDraft({id:draft.id,body:'Later local revision retained'});assert.equal(edited.body,'Later local revision retained');
    await f.service.flush('google',draft.id);assert.equal(f.calls.create,1);
    assert.throws(()=>f.store.beginDelivery(draft.id),{code:'provider_draft_unknown'});assert.equal(f.store.list('delivery').length,0);
    assert.throws(()=>f.store.assertProviderDraftNativeSend(edited),{code:'provider_draft_locked'});
    assert.throws(()=>f.store.deleteDraft(draft.id),{code:'provider_draft_deletion_requires_action'});
    assert.throws(()=>f.store.saveDraft({id:draft.id,accountId:'foreign'}));
  }finally{await f.close()}
});
test('a failed local acknowledgment commit becomes unknown without replacing edits or making another provider write',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();f.store.db.exec("CREATE TEMP TRIGGER fail_cloud_ack BEFORE UPDATE ON records WHEN NEW.kind='draft' AND json_extract(NEW.data,'$.providerDraftId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'controlled cloud ACK failure');END");
    await f.service.flush('google',draft.id);assert.equal(f.calls.create,1);assert.equal(f.remote.size,1);assert.equal(f.service.status('google',draft.id).state,'outcome_unknown');assert.equal(f.store.required<Draft>('draft',draft.id).providerDraftId,undefined);
    await f.service.flush('google',draft.id);assert.equal(f.calls.create,1);assert.equal(f.calls.delete,0);
  }finally{await f.close()}
});
test('an external remote message replacement blocks PUT rather than overwriting changed content',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const remote=f.remote.get('draft-1')!;f.remote.set(remote.id,{...remote,message:{...remote.message,id:'external-message'}});
    f.store.saveDraft({id:draft.id,body:'New local edit'});await f.service.flush('google',draft.id);
    assert.equal(f.calls.create,1);assert.equal(f.calls.update,0);assert.equal(f.service.status('google',draft.id).state,'remote_conflict');assert.equal(f.store.required<Draft>('draft',draft.id).body,'New local edit');
  }finally{await f.close()}
});
test('queued work behind account sync cannot claim or write after shutdown begins',async()=>{
  const queue=new OperationQueue(),gate=hold(),blocking=queue.run('google',()=>gate.promise),f=fixture({queue});try{
    const draft=f.newDraft(),running=f.service.flush('google',draft.id),closing=f.service.close();gate.resolve();await blocking;await running;await closing;
    assert.equal(f.calls.create,0);assert.equal(f.calls.profile,0);assert.equal(f.service.status('google',draft.id).state,'queued');assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM provider_draft_operations').get()!.n,0);
  }finally{gate.resolve();await f.close()}
});

test('positive unknown-create reconciliation reads only, then one later new-revision PUT uses a fresh operation',async()=>{
  const f=fixture({automatic:true,createUnknown:true});try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const original=f.service.status('google',draft.id).operation!;
    const later=f.store.saveDraft({id:draft.id,body:'Later authored revision while unknown'}),before=f.service.status('google',draft.id);
    const checked=await f.service.reconcile('google',draft.id,before.revision);
    assert.equal(checked.verification.issuedOutcome,'confirmed');assert.equal(checked.verification.content,'equivalent');assert.equal(checked.verification.operationId,original.id);assert.equal(checked.providerDraft.state,'queued');assert.equal(checked.providerDraft.desiredRevision,later.revision);assert.equal(checked.providerDraft.syncedRevision,draft.revision);assert.equal(checked.providerDraft.operation!.id,original.id);
    assert.equal(f.calls.create,1);assert.equal(f.calls.update,0);assert.equal(f.calls.delete,0);assert.ok(f.calls.get>0&&f.calls.metadata>0&&f.calls.list>0);
    f.fire();await Promise.all([...f.service.active.values()]);const after=f.service.status('google',draft.id);assert.equal(after.state,'synced');assert.notEqual(after.operation!.id,original.id);assert.equal(after.operation!.draftRevision,later.revision);assert.equal(f.calls.create,1);assert.equal(f.calls.update,1);
  }finally{await f.close()}
});
test('same-content revision churn reconciles without a redundant PUT; zero/duplicate scans stay unknown',async()=>{
  const f=fixture({automatic:true,createUnknown:true});try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const current=f.store.required<Draft>('draft',draft.id);const later=f.store.saveDraft({id:draft.id,body:current.body});
    const checked=await f.service.reconcile('google',draft.id,f.service.status('google',draft.id).revision);assert.equal(checked.providerDraft.state,'synced');assert.equal(checked.providerDraft.syncedRevision,later.revision);f.fire();await Promise.all([...f.service.active.values()]);assert.equal(f.calls.update,0);
  }finally{await f.close()}
  for(const kind of ['empty','duplicate']as const){const g=fixture({createUnknown:true});try{
    const draft=g.newDraft();await g.service.flush('google',draft.id);if(kind==='empty')g.remote.clear();else{const first=g.remote.get('draft-1')!;g.remote.set('duplicate-draft',{...first,id:'duplicate-draft',message:{...first.message,id:'duplicate-message'}})}
    const checked=await g.service.reconcile('google',draft.id,g.service.status('google',draft.id).revision);assert.equal(checked.providerDraft.state,'outcome_unknown');assert.equal(checked.verification.issuedOutcome,'unknown');assert.equal(checked.verification.matches,kind==='empty'?0:2);assert.equal(g.calls.create,1);assert.equal(g.calls.update,0);assert.equal(g.calls.delete,0);
  }finally{await g.close()}}
});
test('preserved draft markers with changed decoded content never confirm an ambiguous create',async()=>{
  const f=fixture({createUnknown:true});try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const remote=f.remote.get('draft-1')!,raw=Buffer.from(remote.message.raw!,'base64url').toString(),changed=raw.replace(Buffer.from(draft.body).toString('base64'),Buffer.from('Different valid body').toString('base64'));assert.notEqual(changed,raw);f.remote.set(remote.id,{...remote,message:{...remote.message,raw:Buffer.from(changed).toString('base64url')}});
    const result=await f.service.reconcile('google',draft.id,f.service.status('google',draft.id).revision);assert.equal(result.providerDraft.state,'outcome_unknown');assert.equal(result.verification.content,'different');assert.equal(result.verification.issuedOutcome,'unknown');assert.equal(f.calls.create,1);assert.equal(f.calls.update,0);
  }finally{await f.close()}
});
test('shutdown aborts an issued write conservatively and late transport completion cannot reopen its ledger',async()=>{
  const gate=hold(),f=fixture({createGate:gate});let closed=false;try{
    const draft=f.newDraft(),running=f.service.flush('google',draft.id);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(f.service.status('google',draft.id).operation!.state,'dispatching');
    await f.service.close();await running;assert.equal(f.service.status('google',draft.id).state,'outcome_unknown');assert.equal(f.calls.create,1);f.store.close();closed=true;gate.resolve();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(f.remote.size,1);
  }finally{gate.resolve();if(!closed)await f.close()}
});
function discardRequest(f:ReturnType<typeof fixture>,draftId:string,key='discard-once'){
  const draft=f.store.required<Draft>('draft',draftId),status=f.service.status('google',draftId);
  return{accountId:'google',clientRequestId:key,expectedDraftRevision:draft.revision!,expectedContentHash:status.desiredHash!,expectedSyncRevision:status.revision};
}
test('an explicit unsent local discard is atomic, keyed and historical without any provider write',async()=>{
  const f=fixture();try{
    const draft=f.newDraft(),input=discardRequest(f,draft.id),result=f.service.discard(draft.id,input);
    assert.equal(result.accepted,true);assert.equal(result.response.resolution,'discarded');assert.equal(result.response.providerDraft.state,'discarded');assert.equal(result.response.providerDraft.operation!.issuedAt,null);assert.equal(f.store.get('draft',draft.id),undefined);assert.equal(f.calls.create,0);assert.equal(f.calls.delete,0);
    assert.deepEqual(f.service.discardByRequest('google',draft.id,input.clientRequestId),result.response);assert.deepEqual(f.service.discard(draft.id,input),{accepted:false,response:result.response});
    assert.throws(()=>f.store.put('draft',draft.id,draft),{code:'provider_draft_locked'});assert.equal(f.store.get('draft',draft.id),undefined);
  }finally{await f.close()}
});
test('a verified mapped discard deletes exactly once and old keys never recreate or delete another draft',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const input=discardRequest(f,draft.id),accepted=f.service.discard(draft.id,input);assert.equal(accepted.response.resolution,'pending');const planned=accepted.response.receipt.operationId;
    await f.service.flush('google',draft.id);const result=f.service.discardByRequest('google',draft.id,input.clientRequestId);assert.equal(result.resolution,'discarded');assert.equal(result.providerDraft.operation!.id,planned);assert.equal(result.providerDraft.operation!.kind,'delete');assert.equal(result.providerDraft.operation!.state,'confirmed');assert.equal(f.calls.delete,1);assert.equal(f.remote.size,0);assert.equal(f.store.get('draft',draft.id),undefined);
    assert.equal(f.service.discard(draft.id,input).accepted,false);await f.service.flush('google',draft.id);assert.equal(f.calls.delete,1);assert.equal(f.calls.create,1);
    const fresh=f.newDraft({body:'Different owned draft'});assert.throws(()=>f.service.discard(fresh.id,{...input,expectedDraftRevision:fresh.revision!}),{code:'provider_draft_request_conflict'});assert.equal(f.store.required<Draft>('draft',fresh.id).body,'Different owned draft');
  }finally{await f.close()}
});
test('discard accepted during an in-flight create preserves its original receipt and waits for that exact owned mapping',async()=>{
  const gate=hold(),f=fixture({createGate:gate});try{
    const draft=f.newDraft(),running=f.service.flush('google',draft.id);await new Promise<void>(resolve=>setImmediate(resolve));
    const input=discardRequest(f,draft.id),accepted=f.service.discard(draft.id,input),createOp=accepted.response.providerDraft.operation!;assert.equal(accepted.response.resolution,'pending');assert.notEqual(createOp.id,accepted.response.receipt.operationId);assert.equal(f.calls.delete,0);
    assert.throws(()=>f.store.saveDraft({id:draft.id,body:'Too late edit'}),{code:'provider_draft_locked'});gate.resolve();await running;
    assert.equal(f.service.status('google',draft.id).state,'discard_queued');await f.service.flush('google',draft.id);const result=f.service.discardByRequest('google',draft.id,input.clientRequestId);assert.deepEqual(result.receipt,accepted.response.receipt);assert.equal(result.providerDraft.operation!.id,result.receipt.operationId);assert.equal(f.calls.create,1);assert.equal(f.calls.delete,1);assert.equal(f.store.get('draft',draft.id),undefined);
  }finally{gate.resolve();await f.close()}
});
test('unknown DELETE can settle exact target-unavailable while its issued execution outcome remains unknown',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const originalDelete=f.transport.delete;f.transport.delete=async(...args)=>{await originalDelete(...args);throw Error('Controlled DELETE lost ACK')};
    const input=discardRequest(f,draft.id);f.service.discard(draft.id,input);await f.service.flush('google',draft.id);const unknown=f.service.status('google',draft.id);assert.equal(unknown.state,'outcome_unknown');assert.equal(unknown.operation!.kind,'delete');assert.equal(f.calls.delete,1);assert.ok(f.store.get('draft',draft.id));
    const checked=await f.service.reconcile('google',draft.id,unknown.revision);assert.equal(checked.verification.target,'unavailable');assert.equal(checked.verification.issuedOutcome,'unknown');assert.equal(checked.providerDraft.state,'discarded');assert.equal(checked.providerDraft.operation!.state,'unknown');assert.equal(checked.providerDraft.operation!.resolution,'target-unavailable');assert.equal(f.store.get('draft',draft.id),undefined);
    assert.equal(f.service.discardByRequest('google',draft.id,input.clientRequestId).resolution,'unavailable');await f.service.flush('google',draft.id);assert.equal(f.calls.delete,1);assert.equal(f.calls.create,1);
  }finally{await f.close()}
});
test('unknown create with pending discard is not resolved by zero results; later exact proof allows only its planned deletion',async()=>{
  const f=fixture({createUnknown:true});try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const saved=f.remote.get('draft-1')!;const input=discardRequest(f,draft.id),accepted=f.service.discard(draft.id,input);f.remote.clear();
    const absent=await f.service.reconcile('google',draft.id,f.service.status('google',draft.id).revision);assert.equal(absent.providerDraft.state,'outcome_unknown');assert.equal(absent.verification.matches,0);assert.ok(f.store.get('draft',draft.id));assert.equal(f.service.discardByRequest('google',draft.id,input.clientRequestId).resolution,'pending');assert.equal(f.calls.delete,0);
    f.remote.set(saved.id,saved);const proof=await f.service.reconcile('google',draft.id,absent.providerDraft.revision);assert.equal(proof.verification.issuedOutcome,'confirmed');assert.equal(proof.providerDraft.state,'discard_queued');assert.equal(f.calls.delete,0);
    await f.service.flush('google',draft.id);const result=f.service.discardByRequest('google',draft.id,input.clientRequestId);assert.deepEqual(result.receipt,accepted.response.receipt);assert.equal(result.resolution,'discarded');assert.equal(f.calls.create,1);assert.equal(f.calls.update,0);assert.equal(f.calls.delete,1);
  }finally{await f.close()}
});
test('discard acceptance rollback preserves local data/bytes and later confirmed snapshots release only obsolete MIME BLOBs',async()=>{
  const f=fixture();try{
    const draft=f.newDraft();await f.service.flush('google',draft.id);const old=f.service.status('google',draft.id).operation!.id;
    f.store.saveDraft({id:draft.id,body:'New cloud revision'});await f.service.flush('google',draft.id);const current=f.service.status('google',draft.id).operation!.id;
    assert.equal(f.store.db.prepare('SELECT raw FROM provider_draft_operations WHERE id=?').get(old)!.raw,null);assert.ok(f.service.repository.payload('google',draft.id,current).raw.length>0);
    const input=discardRequest(f,draft.id),before=f.store.required<Draft>('draft',draft.id);f.store.db.exec("CREATE TEMP TRIGGER fail_discard_receipt BEFORE INSERT ON provider_draft_discards BEGIN SELECT RAISE(ABORT,'controlled discard receipt failure');END");
    assert.throws(()=>f.service.discard(draft.id,input),/controlled discard receipt failure/);assert.deepEqual(f.store.required<Draft>('draft',draft.id),before);assert.equal(f.service.status('google',draft.id).state,'synced');assert.equal(f.calls.delete,0);assert.throws(()=>f.service.discardByRequest('google',draft.id,input.clientRequestId),{code:'provider_draft_not_found'});
  }finally{await f.close()}
});
test('trusted never-issued local cleanup fences later timer calls while failed deletion rolls its tombstone back symmetrically',async()=>{
  const f=fixture({automatic:true});try{
    const draft=f.newDraft();assert.equal(f.timers.size,1);f.store.deleteDraft(draft.id);assert.equal(f.service.status('google',draft.id).state,'discarded');f.fire();await Promise.all([...f.service.active.values()]);assert.equal(f.calls.profile,0);assert.equal(f.calls.create,0);assert.equal(f.calls.delete,0);assert.equal(f.store.get('draft',draft.id),undefined);
    const retained=f.newDraft();const before=f.service.status('google',retained.id);f.store.db.exec("CREATE TEMP TRIGGER fail_local_discard BEFORE DELETE ON records WHEN OLD.kind='draft' BEGIN SELECT RAISE(ABORT,'controlled local discard failure');END");
    assert.throws(()=>f.store.deleteDraft(retained.id),/controlled local discard failure/);assert.deepEqual(f.service.status('google',retained.id),before);assert.ok(f.store.get('draft',retained.id));f.store.db.exec('DROP TRIGGER fail_local_discard');f.fire();await Promise.all([...f.service.active.values()]);assert.equal(f.calls.create,1);assert.equal(f.service.status('google',retained.id).state,'synced');
  }finally{await f.close()}
});

test('bounded startup refill resumes more than100 explicitly enrolled queued drafts without touching or enrolling legacy records',async()=>{
  const store=new Store(':memory:',false),account={id:'google',provider:'google' as const,email:'self@example.test',name:'Synthetic',color:'#000'};store.put('account',account.id,account);const repo=new ProviderDraftRepository(store);
  const legacy=store.saveDraft({accountId:account.id,body:'Legacy unchanged'}),legacyBytes=store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(legacy.id)!.data;
  for(let i=0;i<101;i++){const draft=store.saveDraft({accountId:account.id,subject:'Synthetic queued '+i,body:'Controlled samples.'});repo.enroll(draft,'composer');repo.desire(draft,providerDraftInputIdentity(store,draft,account).contentHash,true)}
  let creates=0;const timers=new Set<()=>void>(),transport:ProviderDraftTransport={ready(){},async profile(){return account.email},async create(){const id=++creates;return{id:'draft-'+id,message:{id:'message-'+id,threadId:'thread'}}},async update(){throw Error('Unexpected update')},async get(){throw Error('Unexpected read')},async list(){throw Error('Unexpected list')},async metadata(){throw Error('Unexpected metadata')},async delete(){throw Error('Unexpected delete')}};
  const service=new ProviderDraftService(store,transport,{automatic:true,clock:{now:()=>Date.parse('2026-10-28T00:00:00Z'),schedule:callback=>{timers.add(callback);return{cancel:()=>{timers.delete(callback)}}}}});
  try{
    assert.equal(timers.size,100);for(const timer of [...timers]){timers.delete(timer);timer()}await Promise.all([...service.active.values()]);assert.equal(creates,100);assert.equal(timers.size,1);
    for(const timer of [...timers]){timers.delete(timer);timer()}await Promise.all([...service.active.values()]);assert.equal(creates,101);assert.equal(timers.size,0);assert.equal(store.db.prepare("SELECT count(*) AS n FROM provider_draft_links WHERE json_extract(data,'$.state')='synced'").get()!.n,101);
    assert.equal(store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(legacy.id)!.data,legacyBytes);assert.equal(repo.snapshot(account.id,legacy.id).ownership,'unmanaged');
    const plan=store.db.prepare("EXPLAIN QUERY PLAN SELECT account_id,draft_id FROM provider_draft_links WHERE CASE WHEN json_valid(data) THEN json_extract(data,'$.state') END IN ('queued','discard_queued') LIMIT 100").all();assert.ok(plan.some(row=>String(row.detail).includes('provider_draft_pending')));
  }finally{await service.close();store.close()}
});
test('an older invalid-input preflight error cannot block a newer corrected authored revision',async()=>{
  const gate=hold(),f=fixture({automatic:true});try{
    f.transport.profile=async()=>{f.calls.profile++;await gate.promise;return'self@example.test'};
    const draft=f.newDraft({to:'unfinished <bad@example.test'}),running=f.service.flush('google',draft.id);await new Promise<void>(resolve=>setImmediate(resolve));
    const corrected=f.store.saveDraft({id:draft.id,to:'peer@example.test',body:'Corrected newest content'});gate.resolve();await running;
    assert.equal(f.service.status('google',draft.id).state,'queued');assert.equal(f.calls.create,0);f.fire();await Promise.all([...f.service.active.values()]);assert.equal(f.calls.create,1);assert.equal(f.service.status('google',draft.id).state,'synced');assert.equal(f.store.required<Draft>('draft',draft.id).body,corrected.body);
  }finally{gate.resolve();await f.close()}
});
