import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.ts';
import { AiDraftSendService } from '../src/ai-draft-send.ts';
import { citationAnswer } from '../src/ai-citations.ts';
import type { Draft,DeliveryAttempt } from '../src/types.ts';
import type { AiDraftScope } from '../src/ai-draft-types.ts';
const account={id:'synthetic-send-a',provider:'google' as const,name:'Synthetic A',email:'sender@example.test'};
const env={DATABASE_PATH:':memory:',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),APPROVED_TEST_SENDERS:'sender@example.test,other@example.test',APPROVED_TEST_RECIPIENTS:'recipient@example.test'};
function fixture(){
 const app=createApp({databasePath:':memory:',env:{...env},runJobs:false,undoWindowMs:0});app.store.put('account',account.id,account);app.store.put('googleGrant','mail:'+account.id,{accountId:account.id,service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run(account.id,'synthetic-never-decrypted-token');
 let providerCalls=0;app.google.fetcher=(async()=>{throw new Error('Live provider requests are forbidden')})as typeof fetch;app.google.send=async()=>{providerCalls++;return{id:'synthetic-ack'}};app.google.acknowledgedDeliveryMetadata=async()=>undefined;
 const seed=(accountId=account.id)=>{const session=app.aiChat.createSession(accountId),turn=app.aiChat.repository.accept(session.id,{accountId,clientRequestId:randomUUID(),expectedRevision:0,prompt:'Propose a synthetic email only',context:{resources:[]}},'synthetic-model').turn;app.aiChat.repository.update(turn.id,t=>{t.state='running'});const preview=app.aiChat.drafts.propose(turn.id,{to:[{email:'recipient@example.test'}],subject:'Synthetic immutable send',body:'Thursday, three samples.'});app.aiChat.repository.update(turn.id,t=>{t.state='completed';t.answer=citationAnswer('Synthetic preview.',[],false);t.previews=[preview]},[],false,t=>app.aiChat.drafts.commitPreview(t,preview));const scope:AiDraftScope={accountId,sessionId:session.id,turnId:turn.id};return{preview,scope,request:{...scope,clientRequestId:randomUUID(),expectedPreviewHash:preview.payloadHash,expectedGeneration:0}}};
 const initial=seed(),count=(table:string)=>Number(app.store.db.prepare('SELECT count(*) AS n FROM '+table).get()!.n);
 return{app,...initial,seed,count,providerCalls:()=>providerCalls,close:()=>app.close()};
}
const code=(expected:string)=>(error:unknown)=>{assert.equal((error as {code?:string}).code,expected);return true};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}};

test('foreign operation/preview/request lookups share missing behavior and never parse another account preview body',async()=>{
 const f=fixture(),original=JSON.parse;let privateParses=0;try{const accepted=f.app.aiSend.submit(f.preview.id,f.request),operation=accepted.snapshot.operation!;f.app.store.put('account','b',{id:'b',provider:'demo',email:'b@example.test',name:'Synthetic B'});const b=f.seed('b');f.app.store.db.prepare("UPDATE ai_draft_previews SET data=json_set(data,'$.payload.body','FOREIGN_PREVIEW_BODY_SENTINEL') WHERE id=?").run(f.preview.id);JSON.parse=((text:string,reviver?:Parameters<typeof JSON.parse>[1])=>{if(text.includes('FOREIGN_PREVIEW_BODY_SENTINEL')){privateParses++;throw new Error('Foreign body must not be parsed')}return original(text,reviver)})as typeof JSON.parse;
  for(const id of[f.preview.id,'missing'])assert.throws(()=>f.app.aiSend.get(b.scope,id),(error:unknown)=>Number((error as{status?:number}).status)===404);
  for(const id of[operation.id,'missing'])assert.throws(()=>f.app.aiSend.scopedOperation(b.scope,id),code('ai_draft_send_not_found'));assert.throws(()=>f.app.aiSend.byRequest(b.scope,f.preview.id,f.request.clientRequestId),(error:unknown)=>Number((error as{status?:number}).status)===404);assert.equal(privateParses,0);assert.equal(f.providerCalls(),0);
 }finally{JSON.parse=original;await f.close()}
});

test('concurrent execute callbacks share one claimed attempt and provider acknowledgement',async()=>{
 const f=fixture(),entered=deferred<void>(),ack=deferred<{id:string}>();let calls=0;f.app.google.send=async()=>{calls++;entered.resolve();return ack.promise};try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!,one=f.app.aiSend.execute(operation.id,f.app.deliver),two=f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(one,two);await entered.promise;assert.equal(calls,1);assert.equal(f.app.store.list('delivery').length,1);await assert.rejects(()=>f.app.deliver(operation.draftId,operation.id),code('delivery_in_progress'));ack.resolve({id:'synthetic-one-ack'});await one;await f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(calls,1);assert.equal(f.app.aiSend.get(f.scope,f.preview.id).operation?.state,'sent')}finally{ack.resolve({id:'synthetic-one-ack'});await f.close()}
});

test('sender drift remains forbidden even when both old and replacement addresses are approved',async()=>{
 const f=fixture();try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!;f.app.store.put('account',account.id,{...account,email:'other@example.test'});await f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(f.providerCalls(),0);assert.equal(f.app.store.list('delivery').length,0);assert.equal(f.app.aiSend.get(f.scope,f.preview.id).operation?.state,'not_dispatched');assert.equal(f.app.store.required<Draft>('draft',operation.draftId).deliveryAttemptId,undefined)}finally{await f.close()}
});

test('mail grant and secret checks fail closed without treating a Calendar grant as Send permission',async()=>{
 for(const missing of['mail-grant','mail-secret']as const){const f=fixture();try{if(missing==='mail-grant'){f.app.store.remove('googleGrant','mail:'+account.id);f.app.store.put('googleGrant','calendar:'+account.id,{accountId:account.id,service:'calendar',grantedScopes:['https://www.googleapis.com/auth/gmail.modify']})}else f.app.store.db.prepare('DELETE FROM secrets WHERE account_id=?').run(account.id);const before=f.app.store.list('draft');assert.throws(()=>f.app.aiSend.submit(f.preview.id,f.request));assert.deepEqual(f.app.store.list('draft'),before);assert.equal(f.count('ai_draft_sends'),0);assert.equal(f.count('ai_draft_creations'),0);assert.equal(f.providerCalls(),0)}finally{await f.close()}}
});

test('claim-transaction failure cannot persist half an attempt or call the provider',async()=>{
 const f=fixture();try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!;f.app.store.db.exec("CREATE TEMP TRIGGER fail_send_claim BEFORE UPDATE ON ai_draft_sends WHEN NEW.state='sending' BEGIN SELECT RAISE(ABORT,'synthetic claim failure');END");await f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(f.providerCalls(),0);assert.equal(f.app.store.list('delivery').length,0);assert.equal(f.app.aiSend.get(f.scope,f.preview.id).operation?.state,'not_dispatched');assert.equal(f.app.store.required<Draft>('draft',operation.draftId).deliveryAttemptId,undefined)}finally{await f.close()}
});

test('ACK-ledger commit failure leaves every linked record unknown rather than half-confirmed or redispatched',async()=>{
 const f=fixture();try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!;f.app.store.db.exec("CREATE TEMP TRIGGER fail_send_ack BEFORE UPDATE ON ai_draft_sends WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'synthetic ACK ledger failure');END");await f.app.aiSend.execute(operation.id,f.app.deliver);const current=f.app.aiSend.get(f.scope,f.preview.id).operation!,draft=f.app.store.required<Draft>('draft',operation.draftId),attempt=f.app.store.required<DeliveryAttempt>('delivery',draft.deliveryAttemptId!);assert.equal(f.providerCalls(),1);assert.equal(current.state,'outcome_unknown');assert.equal(draft.status,'delivery_unknown');assert.equal(attempt.status,'unknown');assert.equal(current.providerMessageId,null);assert.equal(f.app.aiSend.submit(f.preview.id,f.request).accepted,false);await f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(f.providerCalls(),1)}finally{await f.close()}
});

test('dead-owner recovery after claim fences late completion; confirmed reconciliation cannot be downgraded by stale unknown callbacks',async()=>{
 const f=fixture();let recovery:AiDraftSendService|undefined;try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!,pending=f.app.store.beginDelivery(operation.draftId,{artifactOperationId:operation.id});recovery=new AiDraftSendService(f.app.store,f.app.aiChat.drafts,f.app.google,Date.now,()=>false);assert.equal(recovery.get(f.scope,f.preview.id).operation?.state,'outcome_unknown');await recovery.execute(operation.id,async()=>{throw new Error('Recovered action must not auto-dispatch')});assert.equal(f.providerCalls(),0);assert.throws(()=>f.app.store.completeDelivery(pending.id,'late-provider-ack',undefined,undefined,{artifactOperationId:operation.id}),code('ai_draft_send_conflict'));const confirmed=f.app.store.completeDelivery(pending.id,'verified-provider-ack',undefined,true,{artifactOperationId:operation.id,reconciliation:true});assert.equal(confirmed.status,'sent');f.app.store.unknownDelivery(pending.id,'stale unknown callback',{artifactOperationId:operation.id});assert.equal(recovery.get(f.scope,f.preview.id).operation?.state,'sent');assert.equal(f.app.store.required<Draft>('draft',pending.id).status,'sent');assert.equal(f.providerCalls(),0)}finally{await recovery?.close();await f.close()}
});

test('a Send tombstone prevents Create or fresh-key Send even after intentional raw deletion of its dedicated draft',async()=>{
 const f=fixture();try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!;f.app.store.db.prepare("DELETE FROM records WHERE kind='draft' AND id=?").run(operation.draftId);await f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(f.providerCalls(),0);assert.equal(f.app.aiSend.get(f.scope,f.preview.id).operation?.state,'not_dispatched');assert.throws(()=>f.app.aiSend.submit(f.preview.id,{...f.request,clientRequestId:randomUUID(),expectedGeneration:1}),code('ai_draft_send_conflict'));assert.throws(()=>f.app.aiChat.drafts.create(f.preview.id,{...f.request,clientRequestId:randomUUID(),expectedGeneration:1}),code('ai_draft_action_conflict'));assert.equal(f.app.store.list('draft').length,0);assert.equal(f.count('ai_draft_sends'),1)}finally{await f.close()}
});

test('action-key namespace is shared across Create and Send even for different previews',async()=>{
 const f=fixture();try{const other=f.seed();f.app.aiChat.drafts.create(other.preview.id,{...other.request,clientRequestId:'cross-action-key'});assert.throws(()=>f.app.aiSend.submit(f.preview.id,{...f.request,clientRequestId:'cross-action-key'}),code('ai_draft_send_conflict'));const accepted=f.app.aiSend.submit(f.preview.id,{...f.request,clientRequestId:'opposite-key'});assert.equal(accepted.accepted,true);assert.throws(()=>f.app.aiChat.drafts.create(other.preview.id,{...other.request,clientRequestId:'opposite-key'}));assert.equal(f.count('ai_draft_sends'),1);assert.equal(f.providerCalls(),0)}finally{await f.close()}
});

test('malformed provider ACK remains unknown while later metadata failure cannot downgrade an acknowledged operation',async()=>{
 for(const result of[null,{}, {id:''},{id:'bad\nack'}]){const f=fixture();let calls=0;f.app.google.send=async()=>{calls++;return result as any};try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!;await f.app.aiSend.execute(operation.id,f.app.deliver);assert.equal(calls,1);assert.equal(f.app.aiSend.get(f.scope,f.preview.id).operation?.state,'outcome_unknown');assert.equal(f.app.store.required<Draft>('draft',operation.draftId).status,'delivery_unknown')}finally{await f.close()}}
 const f=fixture();f.app.google.acknowledgedDeliveryMetadata=async()=>{throw new Error('Synthetic metadata read failure')};try{const operation=f.app.aiSend.submit(f.preview.id,f.request).snapshot.operation!;await f.app.aiSend.execute(operation.id,f.app.deliver);await f.app.aiSend.waitForIdle();assert.equal(f.app.aiSend.get(f.scope,f.preview.id).operation?.state,'sent');assert.equal(f.providerCalls(),1)}finally{await f.close()}
});
