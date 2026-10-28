import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import { AiDraftSendService } from '../src/ai-draft-send.ts';
import { citationAnswer } from '../src/ai-citations.ts';
const baseEnv={GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),APPROVED_TEST_SENDERS:'sender@example.test',APPROVED_TEST_RECIPIENTS:'recipient@example.test'};
function fixture(databasePath=':memory:'){
 const env={...baseEnv,DATABASE_PATH:databasePath},app=createApp({databasePath,env,runJobs:false,undoWindowMs:10000});
 app.google.fetcher=(async()=>{throw Error('No provider request is allowed');})as typeof fetch;
 app.store.put('account','synthetic',{id:'synthetic',provider:'google',email:'sender@example.test',name:'Synthetic',color:'#000000'});app.store.put('googleGrant','mail:synthetic',{accountId:'synthetic',service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('synthetic','unread-synthetic-token');
 const session=app.aiChat.createSession('synthetic'),turn=app.aiChat.repository.accept(session.id,{accountId:'synthetic',clientRequestId:'seed',expectedRevision:0,prompt:'Fictional content',context:{resources:[]}},'synthetic-model').turn;app.aiChat.repository.update(turn.id,t=>{t.state='running'});const preview=app.aiChat.drafts.propose(turn.id,{to:[{email:'recipient@example.test'}],subject:'Synthetic generation',body:'Three fictional samples.'});app.aiChat.repository.update(turn.id,t=>{t.state='completed';t.answer=citationAnswer('Ready.',[],false);t.previews=[preview]},[],false,t=>app.aiChat.drafts.commitPreview(t,preview));
 const scope={accountId:'synthetic',sessionId:session.id,turnId:turn.id},request={...scope,clientRequestId:'send-zero',expectedGeneration:0,expectedPreviewHash:preview.payloadHash},operation=app.aiSend.submit(preview.id,request).snapshot.operation!,cancel=app.aiSend.cancel(operation.id,{...scope,clientRequestId:'cancel-zero',expectedRevision:0});
 return{app,env,preview,scope,request,operation,cancel};
}
function prototypeSchema(f:ReturnType<typeof fixture>){
 f.app.store.db.exec(`ALTER TABLE ai_draft_sends RENAME TO synthetic_generation_ledger;
 CREATE TABLE ai_draft_sends(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,preview_id TEXT NOT NULL UNIQUE,creation_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,content_hash TEXT NOT NULL,sender_email TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key));
 INSERT INTO ai_draft_sends SELECT id,account_id,session_id,turn_id,preview_id,creation_id,draft_id,client_key,fingerprint,state,owner,owner_pid,content_hash,sender_email,data FROM synthetic_generation_ledger;
 DROP TABLE synthetic_generation_ledger;
 CREATE INDEX ai_draft_send_scope ON ai_draft_sends(account_id,session_id,turn_id,preview_id);`);
}
const records=(f:ReturnType<typeof fixture>)=>f.app.store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all();

test('317 single-Send prototype migrates atomically, preserving mail/operation/cancel receipt bytes and old identities',async()=>{
 const f=fixture();try{
  prototypeSchema(f);const before=records(f),operationData=f.app.store.db.prepare('SELECT data FROM ai_draft_sends').get()!.data,receiptData=f.app.store.db.prepare('SELECT data FROM ai_draft_send_cancellations').get()!.data;
  const upgraded=new AiDraftSendService(f.app.store,f.app.aiChat.drafts,f.app.google);try{
   assert.ok(f.app.store.db.prepare('PRAGMA table_info(ai_draft_sends)').all().some(x=>x.name==='generation'));assert.equal(f.app.store.db.prepare('SELECT generation FROM ai_draft_sends').get()!.generation,0);assert.equal(f.app.store.db.prepare('SELECT data FROM ai_draft_sends').get()!.data,operationData);assert.equal(f.app.store.db.prepare('SELECT data FROM ai_draft_send_cancellations').get()!.data,receiptData);assert.deepEqual(records(f),before);
   assert.equal(upgraded.byRequest(f.scope,f.preview.id,'send-zero').operation?.id,f.operation.id);assert.equal(upgraded.byCancelRequest(f.scope,f.operation.id,'cancel-zero').cancellation.id,f.cancel.cancellation.id);
   f.app.store.deleteDraft(f.operation.draftId);const next=upgraded.submit(f.preview.id,{...f.request,clientRequestId:'send-one',expectedGeneration:1});assert.equal(next.snapshot.operation?.generation,1);assert.notEqual(next.snapshot.operation?.id,f.operation.id);assert.notEqual(next.snapshot.operation?.draftId,f.operation.draftId);assert.equal(upgraded.byRequest(f.scope,f.preview.id,'send-zero').operation?.id,f.operation.id);assert.equal(upgraded.byRequest(f.scope,f.preview.id,'send-zero').eligibility.reason,'historical_operation');assert.equal(upgraded.byRequest(f.scope,f.preview.id,'send-zero').latestGeneration,1);
   const rows=f.app.store.db.prepare('SELECT id,data FROM ai_draft_sends ORDER BY generation').all(),second=new AiDraftSendService(f.app.store,f.app.aiChat.drafts,f.app.google);try{assert.deepEqual(f.app.store.db.prepare('SELECT id,data FROM ai_draft_sends ORDER BY generation').all(),rows);assert.equal(second.get(f.scope,f.preview.id).operation?.state,'queued');}finally{await second.close()}
  }finally{await upgraded.close()}
 }finally{await f.app.close()}
});

test('malformed legacy generation rolls back table/index migration and leaves source mail and receipts unchanged',async()=>{
 for(const invalid of [null,'0',-1,1000001]){const f=fixture();try{prototypeSchema(f);f.app.store.db.prepare("UPDATE ai_draft_sends SET data=json_set(data,'$.generation',?)").run(invalid);const before=records(f),oldRows=f.app.store.db.prepare('SELECT * FROM ai_draft_sends').all(),oldReceipt=f.app.store.db.prepare('SELECT * FROM ai_draft_send_cancellations').all();assert.throws(()=>new AiDraftSendService(f.app.store,f.app.aiChat.drafts,f.app.google),/Legacy Send generation is invalid/);assert.ok(!f.app.store.db.prepare('PRAGMA table_info(ai_draft_sends)').all().some(x=>x.name==='generation'));assert.equal(f.app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='ai_draft_sends_legacy'").get(),undefined);assert.ok(f.app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='ai_draft_send_scope'").get());assert.deepEqual(f.app.store.db.prepare('SELECT * FROM ai_draft_sends').all(),oldRows);assert.deepEqual(f.app.store.db.prepare('SELECT * FROM ai_draft_send_cancellations').all(),oldReceipt);assert.deepEqual(records(f),before);}finally{await f.app.close()}}
});

test('two owners observing the same cancelled missing generation can commit at most one fresh Send',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'send-generation-owners-')),databasePath=join(directory,'synthetic.sqlite'),f=fixture(databasePath);try{f.app.store.deleteDraft(f.operation.draftId);const second=createApp({databasePath,env:{...f.env,DATABASE_PATH:databasePath},seed:false,runJobs:false,undoWindowMs:10000});try{assert.equal(f.app.aiSend.get(f.scope,f.preview.id).eligibility.createGeneration,1);assert.equal(second.aiSend.get(f.scope,f.preview.id).eligibility.createGeneration,1);const first=f.app.aiSend.submit(f.preview.id,{...f.request,clientRequestId:'owner-one',expectedGeneration:1});assert.throws(()=>second.aiSend.submit(f.preview.id,{...f.request,clientRequestId:'owner-two',expectedGeneration:1}),{code:'ai_draft_send_conflict'});const same=second.aiSend.submit(f.preview.id,{...f.request,clientRequestId:'owner-one',expectedGeneration:1});assert.equal(same.accepted,false);assert.equal(same.snapshot.operation?.id,first.snapshot.operation?.id);assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM ai_draft_sends').get()!.n,2);assert.equal(second.aiSend.byCancelRequest(f.scope,f.operation.id,'cancel-zero').operation?.id,f.operation.id);assert.equal(second.aiSend.get(f.scope,f.preview.id).operation?.id,first.snapshot.operation?.id);}finally{await second.close()}}finally{await f.app.close();rmSync(directory,{recursive:true,force:true})}
});
