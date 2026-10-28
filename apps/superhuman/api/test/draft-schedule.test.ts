import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import { DraftSendService } from '../src/draft-send.ts';
import type { Draft } from '../src/types.ts';
const env={DATABASE_PATH:':memory:',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),APPROVED_TEST_SENDERS:'sender@example.test',APPROVED_TEST_RECIPIENTS:'recipient@example.test'};
function fixture(path=':memory:'){
 let now=Date.parse('2026-10-28T20:00:00Z');const timers:{at:number;callback:()=>void;cancelled:boolean}[]=[];
 const schedule=(callback:()=>void,ms:number)=>{const t={at:now+ms,callback,cancelled:false};timers.push(t);return{cancel:()=>{t.cancelled=true}}};
 const app=createApp({databasePath:path,env:{...env,DATABASE_PATH:path},runJobs:false,undoWindowMs:10000,scheduler:{now:()=>now,schedule}}),accountId='synthetic';
 app.store.put('account',accountId,{id:accountId,provider:'google',email:'sender@example.test',name:'Synthetic',color:'#000000'});app.store.put('googleGrant','mail:'+accountId,{accountId,service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});app.store.db.prepare('INSERT OR REPLACE INTO secrets VALUES(?,?)').run(accountId,'synthetic-never-decrypted');
 app.google.fetcher=(async()=>{throw Error('No live calls permitted')})as typeof fetch;let sends=0;app.google.send=async()=>{sends++;return{id:'synthetic-scheduled-ack'}};app.google.acknowledgedDeliveryMetadata=async()=>undefined;
 const draft=app.store.saveDraft({accountId,to:'recipient@example.test',subject:'Fictional scheduled message',html:'<p>Three <strong>fictional</strong> samples.</p>'});
 const request=(key='schedule-once',at=new Date(now+60000).toISOString())=>{const s=app.draftSend.current(accountId,draft.id);return{accountId,clientRequestId:key,expectedDraftRevision:s.draftRevision,expectedContentHash:s.contentHash,expectedGeneration:s.eligibility.generation!,scheduledAt:at}};
 return{app,accountId,draft,request,timers,sends:()=>sends,now:()=>now,advance:(ms:number)=>{now+=ms;for(const t of timers)if(!t.cancelled&&t.at<=now){t.cancelled=true;t.callback()}},close:()=>app.close()};
}

test('keyed schedule keeps same draft and sends exactly once only when due without a long timer',async()=>{
 const f=fixture();try{const request=f.request(),result=f.app.draftSend.submit(f.draft.id,request),op=result.snapshot.operation!;assert.equal(op.mode,'scheduled');assert.equal(op.scheduledAt,request.scheduledAt);assert.equal(f.app.store.required<Draft>('draft',f.draft.id).status,'scheduled');await f.app.draftSend.execute(op.id,f.app.deliverComposer);assert.equal(f.timers.length,0);assert.equal(f.sends(),0);await f.app.runJobs();assert.equal(f.sends(),0);f.advance(59999);await f.app.runJobs();assert.equal(f.sends(),0);f.advance(1);await f.app.runJobs();await f.app.draftSend.waitForIdle();assert.equal(f.sends(),1);assert.equal(f.app.draftSend.current(f.accountId,f.draft.id).operation?.state,'sent');assert.equal(f.app.draftSend.submit(f.draft.id,request).accepted,false);await f.app.runJobs();assert.equal(f.sends(),1);}finally{await f.close()}
});

test('Undo then keyed Schedule is a new generation; old Send/cancel keys cannot rearm or overwrite',async()=>{
 const f=fixture();try{const scheduled=f.request(),{scheduledAt,...immediate}=scheduled;const op=f.app.draftSend.submit(f.draft.id,immediate).snapshot.operation!;const receipt=f.app.draftSend.cancel(op.id,{accountId:f.accountId,clientRequestId:'undo-immediate',expectedRevision:0});f.app.store.saveDraft({id:f.draft.id,body:'Human changed after Undo'});const request=f.request('schedule-after-undo'),next=f.app.draftSend.submit(f.draft.id,request).snapshot.operation!;assert.equal(next.generation,1);assert.equal(next.draftId,op.draftId);assert.equal(next.mode,'scheduled');assert.equal(f.app.draftSend.submit(f.draft.id,immediate).snapshot.operation!.id,op.id);assert.equal(f.app.draftSend.byCancelRequest(f.accountId,op.id,'undo-immediate').cancellation.id,receipt.cancellation.id);assert.equal(f.app.draftSend.byCancelRequest(f.accountId,op.id,'undo-immediate').draft,undefined);f.advance(60000);await f.app.runJobs();await f.app.draftSend.waitForIdle();assert.equal(f.sends(),1);assert.equal(f.app.store.required<Draft>('draft',f.draft.id).body,'Human changed after Undo');}finally{await f.close()}
});

test('scheduled cancellation stays possible after due while account queue is blocked, until claim',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);f.app.google.sync=async()=>{entered();await blocked;return{imported:0,pages:0,partial:false,phase:'history',resultSizeEstimate:0,scope:'synthetic'}};
 try{const op=f.app.draftSend.submit(f.draft.id,f.request()).snapshot.operation!,sync=f.app.requestSync(f.accountId);await started;f.advance(60000);assert.equal(f.app.draftSend.runScheduled(f.app.deliverComposer),1);await Promise.resolve();assert.equal(f.app.draftSend.current(f.accountId,f.draft.id).canCancel,true);const result=f.app.draftSend.cancel(op.id,{accountId:f.accountId,clientRequestId:'cancel-due',expectedRevision:0});assert.equal(result.draft?.id,f.draft.id);assert.equal(result.draft?.scheduledAt,undefined);release();await sync;await f.app.draftSend.waitForIdle();assert.equal(f.sends(),0);assert.equal(f.app.store.list('delivery').length,0);}finally{release?.();await f.close()}
});

test('unclaimed scheduled intent survives graceful close and dead-owner restart, with no constructor dispatch',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'scheduled-restart-')),path=join(directory,'synthetic.sqlite'),f=fixture(path);let next:ReturnType<typeof createApp>|undefined;
 try{const raw=f.request(),op=f.app.draftSend.submit(f.draft.id,raw).snapshot.operation!;await f.close();let sends=0;next=createApp({databasePath:path,env:{...env,DATABASE_PATH:path},runJobs:false,scheduler:{now:()=>Date.parse(raw.scheduledAt),schedule:()=>({cancel(){}})}});next.google.fetcher=(async()=>{throw Error('No network')})as typeof fetch;next.google.send=async()=>{sends++;return{id:'restart-ack'}};next.google.acknowledgedDeliveryMetadata=async()=>undefined;assert.equal(next.draftSend.current(f.accountId,f.draft.id).operation?.id,op.id);assert.equal(next.draftSend.current(f.accountId,f.draft.id).operation?.state,'queued');assert.equal(sends,0);await next.runJobs();await next.draftSend.waitForIdle();assert.equal(sends,1);assert.equal(next.draftSend.submit(f.draft.id,raw).accepted,false);await next.runJobs();assert.equal(sends,1);}finally{await next?.close();await f.close();rmSync(directory,{recursive:true,force:true})}
});

test('scheduled payload validates calendar time and fingerprint, while far future creates no timer',async()=>{
 const f=fixture();try{for(const at of [null,42,'2026-10-30','2026-10-30T10:00:00','2026-02-30T12:00:00Z','2026-10-28T20:00:00Z','2026-10-28T19:59:59Z','2026-10-30T10:00:00.1234Z','2026-10-30T10:00:60Z'])assert.throws(()=>f.app.draftSend.submit(f.draft.id,{...f.request(),scheduledAt:at}),{code:'draft_schedule_invalid_time'});assert.equal(f.app.store.db.prepare('SELECT count(*)as n FROM draft_send_operations').get()!.n,0);const raw=f.request('far','9999-12-31T23:59:59Z'),op=f.app.draftSend.submit(f.draft.id,raw).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);assert.equal(f.timers.length,0);assert.equal(f.app.draftSend.submit(f.draft.id,{...raw,scheduledAt:'9999-12-31T23:59:59.000+00:00'}).accepted,false);assert.throws(()=>f.app.draftSend.submit(f.draft.id,{...raw,scheduledAt:'9999-12-31T23:59:58Z'}),{code:'draft_send_conflict'});assert.equal(f.sends(),0);}finally{await f.close()}
});

test('schedule unknown response is never automatically retried after due jobs or owner restart',async()=>{
 const f=fixture();let sends=0;f.app.google.send=async()=>{sends++;throw Error('Ambiguous outcome')};let replacement:DraftSendService|undefined;
 try{const op=f.app.draftSend.submit(f.draft.id,f.request()).snapshot.operation!;f.advance(60000);await f.app.runJobs();await f.app.draftSend.waitForIdle();assert.equal(f.app.draftSend.current(f.accountId,f.draft.id).operation?.state,'outcome_unknown');replacement=new DraftSendService(f.app.store,f.app.google,f.now,()=>false);assert.equal(replacement.runScheduled(f.app.deliverComposer),0);await f.app.runJobs();assert.equal(sends,1);assert.equal(f.app.store.list('delivery').length,1);assert.equal(f.app.store.required<Draft>('draft',op.draftId).status,'delivery_unknown');}finally{await replacement?.close();await f.close()}
});

test('347 immediate prototype migrates mode metadata without changing identity or old key recovery',async()=>{
 const f=fixture();let replacement:DraftSendService|undefined;try{const{scheduledAt,...raw}=f.request(),op=f.app.draftSend.submit(f.draft.id,raw).snapshot.operation!;f.app.draftSend.cancel(op.id,{accountId:f.accountId,clientRequestId:'undo',expectedRevision:0});const fingerprint=f.app.store.db.prepare('SELECT fingerprint FROM draft_send_operations WHERE id=?').get(op.id)!.fingerprint;f.app.store.db.prepare("UPDATE draft_send_operations SET data=json_remove(data,'$.mode','$.scheduledAt') WHERE id=?").run(op.id);replacement=new DraftSendService(f.app.store,f.app.google,f.now);const result=replacement.submit(f.draft.id,raw);assert.equal(result.accepted,false);assert.equal(result.snapshot.operation!.id,op.id);assert.equal(result.snapshot.operation!.mode,'immediate');assert.equal(result.snapshot.operation!.scheduledAt,null);assert.equal(f.app.store.db.prepare('SELECT fingerprint FROM draft_send_operations WHERE id=?').get(op.id)!.fingerprint,fingerprint);assert.equal(f.sends(),0);}finally{await replacement?.close();await f.close()}
});
