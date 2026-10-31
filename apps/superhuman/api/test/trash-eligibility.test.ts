import './archive-network-deny.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../src/store.ts';
import {AccountIncarnationAuthority} from '../src/account-incarnation.ts';
import {ProviderDraftRepository} from '../src/provider-draft-store.ts';
import {AutoDraftFoundation,type FoundationBasis} from '../src/auto-drafts-foundation.ts';
import {threadInputVersion} from '../src/auto-drafts-mutation-guard.ts';
import {trashDraftEligibility,draftAffectedThreadIds,type TrashEligibilityScope} from '../src/trash-eligibility.ts';
import type {Draft,Thread,DeliveryAttempt} from '../src/types.ts';
import type {ProviderDraftOperation} from '../src/provider-draft-types.ts';
import type {IngressVersion} from '../src/auto-drafts-generation-contract.ts';

if(!(globalThis as Record<symbol,unknown>)[Symbol.for('rea.generated-cloud.network-denied')])throw Error('preload_required');
after(()=>assert.equal((globalThis as Record<symbol,{attempts:number}>)[Symbol.for('rea.generated-cloud.network-denied')].attempts,0));
const stamp=Date.parse('2026-10-30T01:00:00.000Z'),at=new Date(stamp).toISOString(),h='a'.repeat(64);
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const store=new Store(':memory:',false),authority=new AccountIncarnationAuthority(store);
 store.put('account','a',{id:'a',provider:'google',email:'own@example.test',name:'Synthetic',color:'#000'});
 store.put('account','b',{id:'b',provider:'demo',email:'other@example.test',name:'Other',color:'#000'});
 const thread=(id:string,providerId:string,accountId='a'):Thread=>({id,accountId,providerId,subject:'Fictional thread',snippet:'Fictional',sender:{name:'Other',email:'other@example.test'},participants:[],lastMessageAt:at,unread:true,starred:false,important:false,folder:'inbox',labels:[],messages:[{id:'message-'+id,sender:{name:'Other',email:'other@example.test'},to:[{name:'Own',email:'own@example.test'}],date:at,text:'Fictional question.',attachments:[]}]});
 const t=thread('t','p'),u=thread('u','q'),b=thread('b-thread','b-provider','b');for(const v of[t,u,b])store.put('thread',v.id,v);
 const scope:TrashEligibilityScope={accountId:'a',accountVersion:authority.version('a'),threadId:'t',providerThreadId:'p'};
 const draft=(extra:Partial<Draft>={}):Draft=>({id:randomUUID(),accountId:'a',threadId:'t',to:'other@example.test',cc:'',bcc:'',subject:'Fictional reply',body:'',status:'draft',revision:1,updatedAt:at,...extra});
 return{store,authority,t,u,scope,draft,close(){store.close()}};
}
type Fixture=ReturnType<typeof fixture>;
function snapshot(store:Store){
 const schema=store.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
 const tables=store.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>String(r.name));
 return{changes:store.db.prepare('SELECT total_changes() AS n').get()!.n,schema,rows:tables.map(table=>[table,store.db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row,(_key,v)=>typeof v==='bigint'?{integer:v.toString()}:v)).sort()])};
}
function readonly<T>(f:Fixture,run:()=>T):T{
 const before=snapshot(f.store);f.store.db.exec('PRAGMA query_only=ON');
 let result:T;try{result=run()}finally{f.store.db.exec('PRAGMA query_only=OFF')}
 assert.deepEqual(snapshot(f.store),before,'predicate cannot seed schema, recover, allocate IDs or change rows');return result!;
}
function putDraft(f:Fixture,d:Draft){f.store.put('draft',d.id,d);return d}
function sent(f:Fixture,extra:Partial<Draft>={}){
 const d=f.draft({status:'sent',deliveryAttemptId:'attempt',providerMessageId:'sent-message',...extra});
 const a:DeliveryAttempt={id:'attempt',draftId:d.id,status:'sent',messageId:'<fictional@example.test>',startedAt:at,completedAt:at,providerMessageId:'sent-message'};
 putDraft(f,d);f.store.put('delivery',a.id,a);return d;
}
function insertOp(f:Fixture,op:ProviderDraftOperation){f.store.db.prepare('INSERT INTO provider_draft_operations(id,account_id,draft_id,state,owner,owner_pid,data,raw,raw_hash,decoded_hash) VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL)').run(op.id,op.accountId,op.draftId,op.state,'synthetic-owner',process.pid,JSON.stringify(op))}
function op(draftId:string,extra:Partial<ProviderDraftOperation>={}):ProviderDraftOperation{return{id:'cloud-operation',accountId:'a',draftId,kind:'create',state:'unknown',draftRevision:1,contentHash:h,providerDraftId:null,providerMessageId:null,providerThreadId:'p',result:null,createdAt:at,issuedAt:at,completedAt:null,resolution:'unverified',error:null,...extra}}
function sendSchema(f:Fixture){f.store.db.exec(`CREATE TABLE draft_send_operations(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,draft_id TEXT NOT NULL,generation INTEGER NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,content_hash TEXT NOT NULL,draft_revision INTEGER NOT NULL,sender_email TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key),UNIQUE(draft_id,generation));
 CREATE TABLE draft_send_cancellations(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,account_id TEXT NOT NULL,draft_id TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key));
 CREATE TABLE ai_draft_sends(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,preview_id TEXT NOT NULL,creation_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,content_hash TEXT NOT NULL,sender_email TEXT NOT NULL,generation INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key),UNIQUE(preview_id,generation));`)}
function composerOp(f:Fixture,draftId:string,state:string,extra:Record<string,unknown>={}){
 const value={id:'send-operation',accountId:'a',draftId,generation:1,mode:'immediate',scheduledAt:null,clientRequestId:'send-key',draftRevision:1,contentHash:h,state,revision:1,createdAt:at,startedAt:null,confirmedAt:null,cancellableUntil:at,cancelledAt:null,deliveryAttemptId:null,providerMessageId:null,error:null,...extra};
 f.store.db.prepare('INSERT INTO draft_send_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(value.id,value.accountId,value.draftId,value.generation,value.clientRequestId,h,value.state,'synthetic-owner',process.pid,h,1,'own@example.test',JSON.stringify(value));return value;
}

test('empty scope and unrelated new-message/forward stay usable, without a schema or ID write',()=>{
 const f=fixture();try{
  for(const d of[f.draft({threadId:undefined,subject:'Same subject',body:'Quoted fictional thread'}),f.draft({threadId:'u'}),f.draft({accountId:'b',threadId:'b-thread'})])putDraft(f,d);
  assert.deepEqual(readonly(f,()=>trashDraftEligibility(f.store,f.scope)),{eligible:true,reason:'clear'});
  assert.deepEqual(readonly(f,()=>draftAffectedThreadIds(f.store,undefined,f.draft({threadId:undefined,body:'Quoted fictional thread'}))),[]);
  assert(!f.store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='provider_draft_links'").get(),'read cannot install provider schema');
 }finally{f.close()}
});

test('every editable/claimed/held/uncertain Draft status blocks even with no body or recipients',()=>{
 for(const status of ['draft','failed','send_queued','scheduled','sending','delivery_held','delivery_unknown']as const){const f=fixture();try{
  putDraft(f,f.draft({to:'',body:'',status}));assert.deepEqual(readonly(f,()=>trashDraftEligibility(f.store,f.scope)),{eligible:false,reason:'draft'},status);
 }finally{f.close()}}
});

test('same-thread Draft created after clear invalidates the result while Thread bytes remain identical',()=>{
 const f=fixture();try{const before=f.store.required<Thread>('thread','t');assert(trashDraftEligibility(f.store,f.scope).eligible);putDraft(f,f.draft());assert.deepEqual(f.store.required('thread','t'),before);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'draft')}finally{f.close()}
});

test('old and next local/provider targets are both returned; quoted text creates no relationship',()=>{
 const f=fixture();try{
  const before=f.draft({deliveryReplyContext:{providerThreadId:'q'}}),next={...before,threadId:'u',deliveryReplyContext:{providerThreadId:'p'}};
  assert.deepEqual(readonly(f,()=>draftAffectedThreadIds(f.store,before,next)),[{accountId:'a',threadId:'t'},{accountId:'a',threadId:'u'}]);
  const d=f.draft({threadId:undefined,deliveryReplyContext:{providerThreadId:'p'}});putDraft(f,d);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'draft');
 }finally{f.close()}
});

test('idle and queued managed ownership block even when the local Draft was removed',()=>{
 for(const state of ['idle','queued','outcome_unknown','remote_conflict','suspended']as const){const f=fixture();try{
  const repo=new ProviderDraftRepository(f.store,()=>stamp),d=putDraft(f,f.draft()),link=repo.enroll(d,'reply')!;repo.transaction(()=>repo.saveLink({...link,state}));
  f.store.db.prepare("DELETE FROM records WHERE kind='draft' AND id=?").run(d.id);assert.deepEqual(readonly(f,()=>trashDraftEligibility(f.store,f.scope)),{eligible:false,reason:'cloud'},state);
 }finally{f.close()}}
});

test('orphan pending or unknown provider work retains its exact immutable target lock',()=>{
 for(const state of ['queued','dispatching','unknown']as const){const f=fixture();try{new ProviderDraftRepository(f.store,()=>stamp);insertOp(f,op('missing-draft',{state,issuedAt:state==='queued'?null:at}));assert.deepEqual(readonly(f,()=>trashDraftEligibility(f.store,f.scope)),{eligible:false,reason:'cloud'},state)}finally{f.close()}}
});

test('associated corrupt account scope fails closed while unrelated cloud work stays usable',()=>{
 const f=fixture();try{const repo=new ProviderDraftRepository(f.store,()=>stamp),d=putDraft(f,f.draft({threadId:'u'})),link=repo.enroll(d,'reply')!;
  assert(trashDraftEligibility(f.store,f.scope).eligible);
  f.store.db.prepare('UPDATE provider_draft_links SET data=? WHERE account_id=? AND draft_id=?').run(JSON.stringify({...link,accountId:'b',replyContext:{...link.replyContext,providerThreadId:'p'}}),'a',d.id);
  assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');assert.throws(()=>readonly(f,()=>draftAffectedThreadIds(f.store,d)),/authority is unavailable/);
 }finally{f.close()}
});

test('bare sent flags and mismatched proof refuse; positive matching Sent history is eligible',()=>{
 const f=fixture();try{
  const d=putDraft(f,f.draft({status:'sent'}));assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');f.store.db.prepare("DELETE FROM records WHERE kind='draft'").run();
  const proof=sent(f);assert(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).eligible);
  f.store.put('delivery','attempt',{...f.store.required<DeliveryAttempt>('delivery','attempt'),providerMessageId:'different-message'});assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');assert.notEqual(d.id,proof.id);
 }finally{f.close()}
});

test('consumed cloud history needs its exact active confirmed result; unknown work is never waived',()=>{
 const f=fixture();try{const repo=new ProviderDraftRepository(f.store,()=>stamp),d=putDraft(f,f.draft()),link=repo.enroll(d,'reply')!;
  const current=sent(f,{id:d.id,providerDraftId:'remote-draft'}),ack=op(d.id,{state:'confirmed',completedAt:at,resolution:'matching-snapshot',result:{providerDraftId:'remote-draft',providerMessageId:'remote-message',providerThreadId:'p'}});insertOp(f,ack);
  repo.transaction(()=>repo.saveLink({...link,state:'consumed',activeOperationId:ack.id,providerDraftId:'remote-draft',providerMessageId:'remote-message',providerThreadId:'p'}));
  assert(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).eligible);
  f.store.db.prepare('UPDATE provider_draft_operations SET state=?,data=? WHERE id=?').run('unknown',JSON.stringify({...ack,state:'unknown',result:null,resolution:'unverified',completedAt:null}),ack.id);
  assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'cloud');
  f.store.db.prepare('DELETE FROM provider_draft_operations WHERE id=?').run(ack.id);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');assert.equal(current.id,d.id);
 }finally{f.close()}
});

test('a discarded cloud tombstone passes only with the exact confirmed no-remote-delete lineage',()=>{
 const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp),repo=new ProviderDraftRepository(f.store,()=>stamp);try{
  const d=f.store.saveDraft({accountId:'a',threadId:'t',body:'Fictional'}),link=repo.enroll(d,'reply')!;repo.transaction(()=>{const receipt=repo.createDiscardReceipt(link,{accountId:'a',clientRequestId:'discard-key',expectedDraftRevision:d.revision!,expectedContentHash:h,expectedSyncRevision:link.revision}),queued=repo.saveLink({...link,state:'discard_queued',discardId:receipt.id});repo.insertDeleteOperation(queued,receipt,null,'synthetic-owner',false)});f.store.deleteDraft(d.id);
  assert(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).eligible);f.store.db.prepare('UPDATE provider_draft_discards SET fingerprint=?').run('b'.repeat(64));assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
 }finally{engine.close()}}finally{f.close()}
});

test('unknown Delivery is blocked after local removal through the retained exact generated guard',()=>{
 const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp);try{const d=f.store.saveDraft({accountId:'a',threadId:'t',body:'Fictional'});f.store.put('delivery','unknown-attempt',{id:'unknown-attempt',draftId:d.id,status:'unknown',messageId:'<fictional@example.test>',startedAt:at});f.store.db.prepare("DELETE FROM records WHERE kind='draft' AND id=?").run(d.id);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'delivery')}finally{engine.close()}}finally{f.close()}
});

test('composer and artifact pending/uncertain ownership block after local removal, without disabling another thread',()=>{
 for(const state of ['queued','held_before_provider','sending','outcome_unknown'])for(const table of ['draft_send_operations','ai_draft_sends']as const){const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp);try{sendSchema(f);const d=f.store.saveDraft({accountId:'a',threadId:'t',body:'Fictional'});f.store.db.prepare("DELETE FROM records WHERE kind='draft' AND id=?").run(d.id);
  const value={id:'artifact-send',accountId:'a',sessionId:'session',turnId:'turn',previewId:'preview',creationId:'creation',draftId:d.id,clientRequestId:'artifact-key',payloadHash:h,state,generation:1,revision:1,createdAt:at,startedAt:null,confirmedAt:null,deliveryAttemptId:null,providerMessageId:null,error:null,cancellableUntil:at,cancelledAt:null};
  if(table==='draft_send_operations')composerOp(f,d.id,state);else f.store.db.prepare('INSERT INTO ai_draft_sends VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(value.id,'a',value.sessionId,value.turnId,value.previewId,value.creationId,d.id,value.clientRequestId,h,state,'synthetic-owner',process.pid,h,'own@example.test',1,JSON.stringify(value));
  assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'delivery',table+' '+state);assert(readonly(f,()=>trashDraftEligibility(f.store,{...f.scope,threadId:'u',providerThreadId:'q'})).eligible);
 }finally{engine.close()}}finally{f.close()}}
});

test('a terminal composer Sent operation must match the same Draft, attempt and provider ACK',()=>{
 const f=fixture();try{sendSchema(f);const d=sent(f,{composerSendId:'send-operation'});composerOp(f,d.id,'sent',{deliveryAttemptId:'attempt',providerMessageId:'sent-message',startedAt:at,confirmedAt:at});assert(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).eligible);
  const row=f.store.db.prepare('SELECT data FROM draft_send_operations').get()!,value=JSON.parse(String(row.data));f.store.db.prepare('UPDATE draft_send_operations SET data=?').run(JSON.stringify({...value,deliveryAttemptId:'different-attempt'}));assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
 }finally{f.close()}
});

test('cancelled history needs an exact committed receipt; cancelled state and loose error strings are insufficient',()=>{
 const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp);try{sendSchema(f);const d=f.store.saveDraft({accountId:'a',threadId:'t',body:'Fictional'});f.store.deleteDraft(d.id);const value=composerOp(f,d.id,'cancelled',{cancelledAt:at,cancelledFromRevision:0});
  assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
  const c={id:'cancel-receipt',operationId:value.id,accountId:'a',draftId:d.id,clientRequestId:'cancel-key',createdAt:at},fingerprint=sha({kind:'composer-cancel',accountId:'a',operationId:value.id,expectedRevision:0});f.store.db.prepare('INSERT INTO draft_send_cancellations VALUES(?,?,?,?,?,?,?)').run(c.id,c.operationId,'a',d.id,c.clientRequestId,fingerprint,JSON.stringify(c));
  assert(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).eligible);f.store.db.prepare('UPDATE draft_send_cancellations SET fingerprint=?').run('b'.repeat(64));assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
 }finally{engine.close()}}finally{f.close()}
});

test('active genuine admitted generation blocks; a genuine terminal nonpublishing result does not',()=>{
 const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp);try{
  const sourceRef=randomUUID(),threadRef=randomUUID(),input:IngressVersion={version:1,id:randomUUID(),accountId:'a',accountVersion:f.scope.accountVersion,sequence:1,sourceRef,inputVersion:h,providerInternalDate:at,committedAt:at,origin:'google-live-history-message-added',history:{entryId:'11',afterCursor:'10',throughCursor:'100',addedSourceRefs:[sourceRef]},baselineVersion:h,immutableFactsHash:h};
  engine.commitIngress(f.t,input);const basis:FoundationBasis={accountId:'a',activationId:randomUUID(),activationEpoch:1,preferences:{settingsId:randomUUID(),revision:1,fingerprint:h},accountVersion:f.scope.accountVersion,configurationVersion:h,sourceRef,inputVersion:h,threadId:'t',target:engine.guard.capture('a','t',{threadRef,threadInputVersion:threadInputVersion(f.t),replyMetadataVersion:h,sourceFactsVersion:h})};
  const j=engine.admit(input.id,basis);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'generation');assert(readonly(f,()=>trashDraftEligibility(f.store,{...f.scope,threadId:'u',providerThreadId:'q'})).eligible);const claimed=engine.claim('a',j.id,j.revision);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'generation');engine.issue('a',j.id,claimed.leaseId!,'{}');assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'generation');engine.terminal('a',j.id,claimed.leaseId!,'no-draft',h);assert(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).eligible);
  f.store.db.prepare("UPDATE auto_draft_job_acceptance SET data=json_set(data,'$.basis.threadId','u') WHERE id=?").run(j.id);assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
 }finally{engine.close()}}finally{f.close()}
});

test('genuine local publications retain original scope through rebind and require their immutable proof, including legacy format',()=>{
 for(const modern of [false,true]){const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp);try{
  const sourceRef=randomUUID(),threadRef=randomUUID(),input:IngressVersion={version:1,id:randomUUID(),accountId:'a',accountVersion:f.scope.accountVersion,sequence:1,sourceRef,inputVersion:h,providerInternalDate:at,committedAt:at,origin:'google-live-history-message-added',history:{entryId:'11',afterCursor:'10',throughCursor:'100',addedSourceRefs:[sourceRef]},baselineVersion:h,immutableFactsHash:h};engine.commitIngress(f.t,input);
  const basis:FoundationBasis={accountId:'a',activationId:randomUUID(),activationEpoch:1,preferences:{settingsId:randomUUID(),revision:1,fingerprint:h},accountVersion:f.scope.accountVersion,configurationVersion:h,sourceRef,inputVersion:h,threadId:'t',target:engine.guard.capture('a','t',{threadRef,threadInputVersion:threadInputVersion(f.t),replyMetadataVersion:h,sourceFactsVersion:h})},job=engine.admit(input.id,basis),claim=engine.claim('a',job.id,job.revision),issued=engine.issue('a',job.id,claim.leaseId!,'{}');
  f.store.db.exec('CREATE TABLE auto_draft_worker_publications(target_ref TEXT PRIMARY KEY,account_id TEXT NOT NULL,job_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,integrity TEXT NOT NULL);CREATE TABLE auto_draft_worker_publication_proofs(job_id TEXT PRIMARY KEY,digest TEXT NOT NULL)');let draft!:Draft;
  engine.publish('a',job.id,claim.leaseId!,()=>{draft=f.store.createGeneratedLocalDraft({accountId:'a',threadId:'t',to:'other@example.test',subject:'Fictional',body:'Fictional',html:'<p>Fictional</p>',deliveryReplyContext:{providerThreadId:'p'}});const guardVersion=engine.guard.guard('a',draft.id)!.version,targetRef=randomUUID(),authoredHash=sha(draft),contentHash=sha({body:draft.body}),identityPolicy='generated-authoring-v1',targetVersion=modern?sha({draftId:draft.id,guardVersion,identityPolicy,authoredHash}):sha({draftId:draft.id,guardVersion,authoredHash}),p={jobId:job.id,accountId:'a',targetRef,targetVersion,draftId:draft.id,guardVersion,authoredHash,contentHash,...(modern?{identityPolicy,publicationScope:{accountId:'a',threadId:'t',generationId:job.id,accountVersion:f.scope.accountVersion,leaseId:claim.leaseId!,attemptRef:issued.attempt!.ref},cloudEnrollment:null}:{})},integrity=sha(p);f.store.db.prepare('INSERT INTO auto_draft_worker_publications VALUES(?,?,?,?,?)').run(targetRef,'a',job.id,JSON.stringify(p),integrity);f.store.db.prepare('INSERT INTO auto_draft_worker_publication_proofs VALUES(?,?)').run(job.id,integrity);return{publication:{targetRef,targetVersion,publishedAt:at,contentHash},resultHash:h}});
  assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'draft');assert.deepEqual(readonly(f,()=>draftAffectedThreadIds(f.store,{...draft,threadId:'u',deliveryReplyContext:undefined})),[{accountId:'a',threadId:'t'},{accountId:'a',threadId:'u'}]);f.store.db.prepare('UPDATE auto_draft_worker_publication_proofs SET digest=?').run('b'.repeat(64));assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
 }finally{engine.close()}}finally{f.close()}}
});

test('a changed account incarnation is unavailable, not absence',()=>{
 const f=fixture();try{const engine=new AutoDraftFoundation(f.store,()=>stamp);try{
  f.store.put('account','a',{id:'a',provider:'google',email:'replacement@example.test',name:'Replacement',color:'#000'});assert.equal(readonly(f,()=>trashDraftEligibility(f.store,f.scope)).reason,'unverifiable');
 }finally{engine.close()}}finally{f.close()}
});
