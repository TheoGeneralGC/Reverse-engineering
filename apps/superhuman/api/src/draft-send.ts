import type { DeliveryAccelerationReceipt } from './delivery-control-types.ts';
import { Temporal } from '@js-temporal/polyfill';
import { randomUUID,createHash } from 'node:crypto';
import type { Store,DeliveryContext } from './store.ts';
import type { GoogleProvider } from './google.ts';
import { HttpError,type Draft,type Account,type Thread,type DeliveryAttempt } from './types.ts';
import { identifier,strictObject,hash } from './ai-chat-store.ts';
import { deliveryActionKeyInUse } from './delivery-action-keys.ts';
import { deliveryDeadline,beforeDeliveryDeadline,atOrAfterDeliveryDeadline,waitForMutableDeliveryDeadline,type DeliveryClock } from './delivery-delay.ts';
import type { DraftSendOperation,DraftSendSnapshot,DraftSendCancellation,DraftSendCancelResponse } from './draft-send-types.ts';
function missing():never{
  throw new HttpError(404,'Draft delivery resource not found','draft_send_not_found')
}
function conflict(message='The draft delivery identity changed'):never{
  throw new HttpError(409,message,'draft_send_conflict')
}
const ownerAlive=(pid:number)=>{
  try{
    process.kill(pid,0);
    return true
  }
  catch(error){
    return(error as NodeJS.ErrnoException).code==='EPERM'
  }
};
function scheduleInstant(value:unknown,now:number,allowPast=false):string|null {
  if(value===undefined)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new HttpError(400,'Use an explicit-offset ISO schedule time','draft_schedule_invalid_time');
  try { const at=Number(Temporal.Instant.from(value).epochMilliseconds);if(!allowPast&&at<=now)throw Error();return new Date(at).toISOString(); } catch { throw new HttpError(400,'Choose a valid future schedule time','draft_schedule_invalid_time'); }
}
const owners=new Set<string>(),terminal=new Set(['sent','cancelled','not_dispatched','outcome_unknown']);
export class DraftSendService{
  readonly store:Store;
  readonly google:GoogleProvider;
  readonly now:()=>number;
  readonly clock:DeliveryClock;
  readonly windowMs:number;
  readonly owner=randomUUID();
  readonly active=new Map<string,Promise<void>>();
  private waiting=new Map<string,AbortController>(); private deadlineWakes=new Map<string,()=>void>();
  private closing=false;
  private isDraftLocked:(id:string)=>boolean;
  constructor(store:Store,google:GoogleProvider,now=Date.now,liveness=ownerAlive,timing:{
    windowMs?:number;schedule?:DeliveryClock['schedule'];isDraftLocked?:(id:string)=>boolean
  }
  ={}){
    this.store=store;
    this.google=google;
    this.isDraftLocked=timing.isDraftLocked??(()=>false);
    this.now=now;
    this.windowMs=timing.windowMs??10000;
    deliveryDeadline(now(),this.windowMs);
    this.clock={
      now,schedule:timing.schedule??((cb,ms)=>{
        const timer=setTimeout(cb,ms);timer.unref();return{
          cancel:()=>clearTimeout(timer)
        }
      })
    };
    store.db.exec('BEGIN IMMEDIATE');
    try { store.db.exec(`
   CREATE TABLE IF NOT EXISTS draft_send_operations(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,draft_id TEXT NOT NULL,generation INTEGER NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,content_hash TEXT NOT NULL,draft_revision INTEGER NOT NULL,sender_email TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key),UNIQUE(draft_id,generation));
   CREATE UNIQUE INDEX IF NOT EXISTS draft_send_active ON draft_send_operations(draft_id) WHERE state<>'cancelled';
   CREATE INDEX IF NOT EXISTS draft_send_scope ON draft_send_operations(account_id,draft_id,generation DESC);
   CREATE INDEX IF NOT EXISTS draft_send_due ON draft_send_operations(state,json_extract(data,'$.mode'),json_extract(data,'$.scheduledAt'));
   UPDATE draft_send_operations SET data=json_set(data,'$.mode','immediate','$.scheduledAt',NULL) WHERE json_type(data,'$.mode') IS NULL;
   CREATE TABLE IF NOT EXISTS draft_send_cancellations(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,account_id TEXT NOT NULL,draft_id TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key));`); if(!store.db.prepare('PRAGMA table_info(draft_send_operations)').all().some(r=>r.name==='tracking_required'))store.db.exec('ALTER TABLE draft_send_operations ADD COLUMN tracking_required INTEGER NOT NULL DEFAULT 0 CHECK(tracking_required IN (0,1))');store.db.exec('COMMIT'); } catch(error) { store.db.exec('ROLLBACK'); throw error; }
    store.composerDeliveryHooks={
      claim:(d,a,c)=>this.claim(d,a,c),complete:(d,a,c)=>this.complete(d,a,c),unknown:(d,c)=>this.unknown(d,c),held:(d,c)=>this.held(d,c),resume:(d,c)=>this.resume(d,c),native:(d,c)=>this.native(d,c)
    };
    for(const row of store.db.prepare("SELECT id,owner,owner_pid,data FROM draft_send_operations WHERE state IN ('queued','sending')").all()){
      const live=liveness===ownerAlive&&Number(row.owner_pid)===process.pid?owners.has(String(row.owner)):liveness(Number(row.owner_pid));
      if(live)continue;
      this.transaction(()=>{
        const fresh=store.db.prepare('SELECT owner,owner_pid,data FROM draft_send_operations WHERE id=?').get(String(row.id));if(!fresh)return;
        const op=JSON.parse(String(fresh.data))as DraftSendOperation;if(!['queued','sending'].includes(op.state))return;
        const freshLive=liveness===ownerAlive&&Number(fresh.owner_pid)===process.pid?owners.has(String(fresh.owner)):liveness(Number(fresh.owner_pid));if(freshLive)return;
        const draft=this.ownedDraft(op.accountId,op.draftId),attempt=op.deliveryAttemptId?store.get<DeliveryAttempt>('delivery',op.deliveryAttemptId):undefined;
        if(draft&&store.trackingNeverIssued(draft,{composerOperationId:op.id})){store.holdTrackedDelivery(draft.id,{composerOperationId:op.id});return;}
        let resumable=false;try{resumable=op.mode==='scheduled'&&op.state==='queued'&&!op.deliveryAttemptId&&draft?.status==='scheduled'&&!draft.deliveryAttemptId&&draft.composerSendId===op.id&&draft.scheduledAt===op.scheduledAt&&op.cancellableUntil===op.scheduledAt&&Number.isFinite(Date.parse(op.scheduledAt??''))&&(draft.revision??0)===op.draftRevision&&this.contentIdentity(draft)===op.contentHash}catch{/* Invalid queued content is not dispatched. */}
        if(resumable){store.db.prepare('UPDATE draft_send_operations SET owner=?,owner_pid=? WHERE id=?').run(this.owner,process.pid,op.id);return;}
        if(draft?.status==='sent'&&draft.composerSendId===op.id&&draft.deliveryAttemptId===op.deliveryAttemptId&&attempt?.draftId===draft.id&&attempt.status==='sent'&&draft.providerMessageId&&attempt.providerMessageId===draft.providerMessageId)this.save({
          ...op,state:'sent',providerMessageId:draft.providerMessageId,confirmedAt:attempt.completedAt??new Date(now()).toISOString(),error:null
        });
        else{
          const claimed=op.deliveryAttemptId!==null||!!draft?.deliveryAttemptId||op.state==='sending';this.save({
            ...op,state:claimed?'outcome_unknown':'not_dispatched',error:{
              code:'draft_send_interrupted',message:claimed?'Interrupted delivery must be reconciled; it will not be retried.':'Interrupted before claim; this operation will not queue automatically.',retry:'none',providerOutcome:claimed?'unknown':'not_dispatched'
            }
          })
        }
      });
    }
    owners.add(this.owner);
  }
  ownsLiveDelivery(draftId:string):boolean{
    const row=this.store.db.prepare("SELECT owner,owner_pid FROM draft_send_operations WHERE draft_id=? AND state IN ('queued','sending')").get(draftId);
    if(!row)return false;
    return Number(row.owner_pid)===process.pid?owners.has(String(row.owner)):ownerAlive(Number(row.owner_pid))
  }
  private transaction<T>(fn:()=>T):T{
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
      const value=fn();
      this.store.db.exec('COMMIT');
      return value
    }
    catch(error){
      this.store.db.exec('ROLLBACK');
      throw error
    }
  }
  private account(id:string){
    identifier(id);
    if(!this.store.db.prepare("SELECT 1 FROM records WHERE kind='account' AND id=?").get(id))missing()
  }
  private ownedDraft(accountId:string,draftId:string):Draft|undefined{
    const row=this.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(draftId,accountId);
    return row?JSON.parse(String(row.data)):undefined
  }
  private raw(id:string):DraftSendOperation{
    const row=this.store.db.prepare('SELECT data FROM draft_send_operations WHERE id=?').get(id);
    if(!row)missing();
    return JSON.parse(String(row.data))
  }
  operation(accountId:string,id:string):DraftSendOperation{
    this.account(accountId);
    identifier(id);
    const row=this.store.db.prepare('SELECT data FROM draft_send_operations WHERE id=? AND account_id=?').get(id,accountId);
    if(!row)missing();
    return JSON.parse(String(row.data))
  }
  private latest(accountId:string,draftId:string):DraftSendOperation|null{
    const row=this.store.db.prepare('SELECT data FROM draft_send_operations WHERE account_id=? AND draft_id=? ORDER BY generation DESC LIMIT 1').get(accountId,draftId);
    return row?JSON.parse(String(row.data)):null
  }
  private save(op:DraftSendOperation){
    if(!this.store.db.isTransaction)throw Error('Delivery transition requires a transaction');
    op={
      ...op,revision:op.revision+1
    };
    this.store.db.prepare('UPDATE draft_send_operations SET state=?,data=? WHERE id=?').run(op.state,JSON.stringify(op),op.id);
    return op
  }
  private replyContext(draft:Draft):NonNullable<Draft['deliveryReplyContext']>{
    if(draft.deliveryReplyContext)return draft.deliveryReplyContext;
    const thread=draft.threadId?this.store.get<Thread>('thread',draft.threadId):undefined;
    if(draft.threadId&&(!thread||thread.accountId!==draft.accountId))conflict('Reply context is unavailable in this account');
    const last=thread?.messages.at(-1);
    return last?{
      id:last.id,internetMessageId:last.internetMessageId,references:last.references,providerThreadId:thread?.providerId
    }:{
    }
  }
  private contentIdentity(draft:Draft):string{
    const sender=this.store.required<Account>('account',draft.accountId).email.toLowerCase(),reply=this.replyContext(draft);
    const attachments=(draft.attachments??[]).map(a=>{
      const row=this.store.db.prepare('SELECT name,mime_type,size,data FROM draft_attachments WHERE id=? AND draft_id=?').get(a.id,draft.id);if(!row||row.name!==a.name||row.mime_type!==a.mimeType||Number(row.size)!==a.size)throw new HttpError(409,'Attachment content is unavailable','draft_send_attachment_unavailable');const bytes=Buffer.from(row.data as Uint8Array);if(bytes.length!==a.size)conflict('Attachment size changed');return{
        id:a.id,name:a.name,mimeType:a.mimeType,size:a.size,sha256:createHash('sha256').update(bytes).digest('hex')
      }
    });
    return hash({
      accountId:draft.accountId,sender,to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,body:draft.body,html:draft.html??null,threadId:draft.threadId??null,providerDraftId:draft.providerDraftId??null,reply:reply.id?{
        id:reply.id,internetMessageId:reply.internetMessageId??null,references:reply.references??null,providerThreadId:reply.providerThreadId??null
      }:null,attachments
    });
  }
  private policy(draft:Draft){
    const account=this.store.required<Account>('account',draft.accountId);
    if(account.provider!=='google')throw new HttpError(409,'Demo accounts cannot deliver email','demo_delivery_disabled');
    if(!this.google.status().configured)throw new HttpError(503,'Configure Google before sending','provider_not_configured');
    if(!this.store.db.prepare('SELECT 1 FROM secrets WHERE account_id=?').get(account.id))throw new HttpError(401,'Reconnect this Gmail account','reconnect_required');
    if(!this.google.grant(account.id,'mail')?.grantedScopes.some(s=>['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.send','https://mail.google.com/'].includes(s)))throw new HttpError(403,'No recorded send grant','insufficient_google_scope');
    this.google.validateDelivery(draft)
  }
  private snapshot(accountId:string,draftId:string,op:DraftSendOperation|null):DraftSendSnapshot{
    const current=this.latest(accountId,draftId),draft=this.ownedDraft(accountId,draftId),historical=!!op&&current?.id!==op.id;
    let editable=!!draft&&['draft','failed'].includes(draft.status)&&!draft.deliveryAttemptId&&!this.store.artifactDeliveryId(draftId)&&!this.store.composerDeliveryId(draftId)&&!draft.artifactSendId&&!draft.composerSendId&&!historical&&!this.isDraftLocked(draftId);
    const revision=draft?.revision??op?.draftRevision??0;
    let contentHash=op?.contentHash??'',reason=historical?'historical_operation':!draft?'draft_unavailable':!editable?'draft_locked':'eligible',eligible=editable;
    if(editable&&this.store.db.prepare('SELECT 1 FROM draft_send_operations WHERE draft_id=? AND account_id<>? LIMIT 1').get(draftId,accountId)){eligible=false;reason='draft_send_scope_changed'}
    if(editable)try{
      contentHash=this.contentIdentity(draft!);
      this.policy(draft!)
    }
    catch(error){
      eligible=false;
      reason=error instanceof HttpError?error.code:'draft_unavailable'
    }
    const latestGeneration=current?.generation??null,generation=editable?(current?current.generation+1:0):null;
    const result:DraftSendSnapshot={
      tracking:op?this.store.trackingDeliveryIdentity(accountId,'composer',op.id):undefined,operation:op,latestGeneration,draftRevision:revision,contentHash,serverNow:new Date(this.now()).toISOString(),canCancel:!!op&&!historical&&op.state==='queued'&&!op.deliveryAttemptId&&(op.mode==='scheduled'||beforeDeliveryDeadline(op.cancellableUntil,this.now())),eligibility:{
        eligible,generation,reason
      },resolution:{
        availability:!draft?'unavailable':editable?'available':'locked',draftId:editable?draftId:null
      }
    };
    if(editable)result.draft=draft;
    return result;
  }
  current(accountId:string,draftId:string):DraftSendSnapshot{
    this.account(accountId);
    identifier(draftId);
    const op=this.latest(accountId,draftId);
    if(!op&&!this.ownedDraft(accountId,draftId))missing();
    return this.snapshot(accountId,draftId,op)
  }
  byRequest(accountId:string,draftId:string,key:string):DraftSendSnapshot{
    this.account(accountId);
    identifier(draftId);
    identifier(key);
    const row=this.store.db.prepare('SELECT data FROM draft_send_operations WHERE account_id=? AND draft_id=? AND client_key=?').get(accountId,draftId,key);
    if(!row)missing();
    return this.snapshot(accountId,draftId,JSON.parse(String(row.data)))
  }
  submit(draftId:string,raw:unknown):{
    accepted:boolean;
    snapshot:DraftSendSnapshot
  }
  {
    if(this.closing)throw new HttpError(503,'Delivery service is stopping','draft_send_stopping');
    identifier(draftId);
    const v=strictObject(raw,['accountId','clientRequestId','expectedDraftRevision','expectedContentHash','expectedGeneration','scheduledAt']),accountId=identifier(v.accountId),key=identifier(v.clientRequestId);
    this.account(accountId);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(key)||typeof v.expectedContentHash!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedContentHash)||typeof v.expectedDraftRevision!=='number'||!Number.isSafeInteger(v.expectedDraftRevision)||v.expectedDraftRevision<0||typeof v.expectedGeneration!=='number'||!Number.isSafeInteger(v.expectedGeneration)||v.expectedGeneration<0||v.expectedGeneration>1000000)throw new HttpError(400,'Invalid draft send identity','draft_send_invalid_request');
    return this.transaction(()=>{
      let scheduledAt=scheduleInstant(v.scheduledAt,this.now(),true);
      const fingerprint=hash({
        kind:scheduledAt?'composer-schedule':'composer-send',accountId,draftId,expectedDraftRevision:v.expectedDraftRevision,expectedContentHash:v.expectedContentHash,expectedGeneration:v.expectedGeneration,...(scheduledAt?{scheduledAt}:{})
      }),prior=this.store.db.prepare('SELECT fingerprint,data FROM draft_send_operations WHERE account_id=? AND client_key=?').get(accountId,key);if(prior){
        if(prior.fingerprint!==fingerprint)conflict('This key belongs to another send intent');const old=JSON.parse(String(prior.data))as DraftSendOperation;return{
          accepted:false,snapshot:this.snapshot(accountId,old.draftId,old)
        }
      }
      scheduledAt=scheduleInstant(v.scheduledAt,this.now());
      if(deliveryActionKeyInUse(this.store.db,accountId,key))conflict('This key belongs to another action');
      const snapshot=this.current(accountId,draftId),draft=this.ownedDraft(accountId,draftId);if(!draft)missing();if(!snapshot.eligibility.eligible||snapshot.eligibility.generation!==v.expectedGeneration)conflict('The current draft cannot accept this generation');if((draft.revision??0)!==v.expectedDraftRevision||this.contentIdentity(draft)!==v.expectedContentHash)conflict('The reviewed draft revision or content changed');this.policy(draft);
      const id=randomUUID(),at=new Date(this.now()).toISOString(),op:DraftSendOperation={
        id,accountId,draftId,generation:v.expectedGeneration as number,mode:scheduledAt?'scheduled':'immediate',scheduledAt,clientRequestId:key,draftRevision:v.expectedDraftRevision as number,contentHash:v.expectedContentHash as string,state:'queued',revision:0,createdAt:at,startedAt:null,confirmedAt:null,cancellableUntil:scheduledAt??deliveryDeadline(this.now(),this.windowMs),cancelledAt:null,deliveryAttemptId:null,providerMessageId:null,error:null
      };
      this.store.db.prepare('INSERT INTO draft_send_operations(id,account_id,draft_id,generation,client_key,fingerprint,state,owner,owner_pid,content_hash,draft_revision,sender_email,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,accountId,draftId,op.generation,key,fingerprint,'queued',this.owner,process.pid,op.contentHash,op.draftRevision,this.store.required<Account>('account',accountId).email.toLowerCase(),JSON.stringify(op));const locked=this.store.lockComposerDraft(draftId,id,this.replyContext(draft));this.store.keyedDeliveryAccepted({source:'composer',accountId,operationId:id,generation:op.generation,draftId,draftRevision:op.draftRevision,authoredHash:op.contentHash},locked);return{
        accepted:true,snapshot:this.snapshot(accountId,draftId,op)
      };
    });
  }
  cancel(operationId:string,raw:unknown):DraftSendCancelResponse{
    const v=strictObject(raw,['accountId','clientRequestId','expectedRevision']),accountId=identifier(v.accountId),key=identifier(v.clientRequestId);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(key)||typeof v.expectedRevision!=='number'||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0)throw new HttpError(400,'Invalid cancellation identity','draft_send_invalid_request');
    const result=this.transaction(()=>{
      let op=this.operation(accountId,operationId);const fingerprint=hash({
        kind:'composer-cancel',accountId,operationId,expectedRevision:v.expectedRevision
      }),prior=this.store.db.prepare('SELECT fingerprint,data FROM draft_send_cancellations WHERE account_id=? AND client_key=?').get(accountId,key);if(prior){
        if(prior.fingerprint!==fingerprint)conflict('This cancellation key changed');return{
          ...this.snapshot(accountId,op.draftId,op),cancellation:JSON.parse(String(prior.data))
        }
      }
      if(deliveryActionKeyInUse(this.store.db,accountId,key))conflict('This key belongs to another action');
      const at=new Date(this.now()).toISOString();if(op.state==='cancelled'){
        if(v.expectedRevision!==op.cancelledFromRevision&&v.expectedRevision!==op.revision)conflict('The cancellation revision changed')
      }
      else{
        if(op.state!=='queued'||op.deliveryAttemptId||(op.mode!=='scheduled'&&!beforeDeliveryDeadline(op.cancellableUntil,this.now())))throw new HttpError(409,'The cancellation deadline closed or delivery was claimed','draft_send_not_cancellable');if(v.expectedRevision!==op.revision)conflict();const draft=this.ownedDraft(accountId,op.draftId);if(!draft)throw new HttpError(409,'The draft is unavailable','draft_send_not_cancellable');this.linked(draft,{
          composerOperationId:op.id
        });op=this.save({
          ...op,state:'cancelled',cancelledAt:at,cancelledFromRevision:op.revision,error:null
        });const restored=this.store.restoreCancelledComposerDraft(op.draftId,op.id,at);this.store.keyedDeliveryCancelled({source:'composer',accountId,operationId:op.id,generation:op.generation,draftId:op.draftId,draftRevision:op.draftRevision,authoredHash:op.contentHash},restored)
      }
      const cancellation:DraftSendCancellation={
        id:randomUUID(),operationId,accountId,draftId:op.draftId,clientRequestId:key,createdAt:at
      };this.store.db.prepare('INSERT INTO draft_send_cancellations VALUES(?,?,?,?,?,?,?)').run(cancellation.id,operationId,accountId,op.draftId,key,fingerprint,JSON.stringify(cancellation));return{
        ...this.snapshot(accountId,op.draftId,op),cancellation
      };
    });
    this.waiting.get(operationId)?.abort(new Error('cancelled'));
    return result;
  }
  byCancelRequest(accountId:string,operationId:string,key:string):DraftSendCancelResponse{
    const op=this.operation(accountId,operationId);
    identifier(key);
    const row=this.store.db.prepare('SELECT data FROM draft_send_cancellations WHERE account_id=? AND operation_id=? AND client_key=?').get(accountId,operationId,key);
    if(!row)missing();
    return{
      ...this.snapshot(accountId,op.draftId,op),cancellation:JSON.parse(String(row.data))
    }
  }
  private linked(draft:Draft,context:DeliveryContext,checkContent=true){
    if(!draft.composerSendId||draft.composerSendId!==context.composerOperationId||context.artifactOperationId)conflict('This draft requires its exact composer operation');
    const row=this.store.db.prepare('SELECT owner,data,sender_email FROM draft_send_operations WHERE id=? AND account_id=? AND draft_id=?').get(draft.composerSendId,draft.accountId,draft.id);
    if(!row)missing();
    const op=JSON.parse(String(row.data))as DraftSendOperation;
    if(checkContent&&((draft.revision??0)!==op.draftRevision||this.contentIdentity(draft)!==op.contentHash||this.store.required<Account>('account',draft.accountId).email.toLowerCase()!==row.sender_email))conflict('The immutable reviewed draft changed');
    return{
      op,owner:String(row.owner)
    }
  }
  private claim(draft:Draft,attempt:DeliveryAttempt,context:DeliveryContext){
    if(this.closing)throw new HttpError(503,'Delivery owner is shutting down','draft_send_stopping');
    const{
      op,owner
    }
    =this.linked(draft,context);
    if(owner!==this.owner||op.state!=='queued'||op.deliveryAttemptId)conflict('The accepted operation cannot claim another attempt');
    if(op.mode==='scheduled'&&(draft.status!=='sending'||draft.scheduledAt!==op.scheduledAt||op.cancellableUntil!==op.scheduledAt||!atOrAfterDeliveryDeadline(op.scheduledAt??'',this.now())))conflict('The scheduled draft identity changed');
    if(!atOrAfterDeliveryDeadline(op.cancellableUntil,this.now()))throw new HttpError(409,'The Undo deadline has not elapsed','draft_send_undo_window');
    this.policy(draft);
    this.save({
      ...op,state:'sending',startedAt:attempt.startedAt,deliveryAttemptId:attempt.id,error:null
    })
  }
  private complete(draft:Draft,attempt:DeliveryAttempt,context:DeliveryContext){
    const{
      op,owner
    }
    =this.linked(draft,context);
    if((!context.reconciliation&&(owner!==this.owner||op.state!=='sending'))||(context.reconciliation&&!['sending','outcome_unknown'].includes(op.state))||op.deliveryAttemptId!==attempt.id||!draft.providerMessageId||draft.providerMessageId!==attempt.providerMessageId)conflict('Delivery proof belongs to another operation');
    this.save({
      ...op,state:'sent',providerMessageId:draft.providerMessageId,confirmedAt:draft.updatedAt,error:null
    })
  }
  private native(draft:Draft,context:DeliveryContext){const {op,owner}=this.linked(draft,context);if(this.closing||owner!==this.owner||op.state!=='sending'||op.deliveryAttemptId!==draft.deliveryAttemptId)conflict('The native claim no longer belongs to this live owner')}
  private held(draft:Draft,context:DeliveryContext){
    const {op}=this.linked(draft,context,false);if(!['queued','sending','held_before_provider'].includes(op.state))conflict('This operation cannot become a never-issued hold');
    this.save({...op,state:'held_before_provider',error:{code:'tracking_delivery_held',message:'Tracking requires review before Gmail issue; no native Send was issued.',retry:'none',providerOutcome:'not_dispatched'}});
  }
  private resume(draft:Draft,context:DeliveryContext){
    const {op,owner}=this.linked(draft,context);const row=this.store.db.prepare('SELECT owner_pid FROM draft_send_operations WHERE id=?').get(op.id);
    if(this.closing||op.state!=='held_before_provider'||owner!==this.owner&&(Number(row?.owner_pid)===process.pid?owners.has(owner):ownerAlive(Number(row?.owner_pid))))conflict('Another live owner holds this operation');
    this.policy(draft);this.store.db.prepare('UPDATE draft_send_operations SET owner=?,owner_pid=? WHERE id=?').run(this.owner,process.pid,op.id);
    this.save({...op,state:op.deliveryAttemptId?'sending':'queued',error:null});
  }
  private unknown(draft:Draft,context:DeliveryContext){
    const{
      op
    }
    =this.linked(draft,context,false);
    if(op.state==='sent')return;
    if(op.deliveryAttemptId!==draft.deliveryAttemptId)conflict('The unknown attempt changed');
    this.save({
      ...op,state:'outcome_unknown',error:{
        code:'delivery_requires_reconciliation',message:'Delivery outcome is unknown; Check Sent. It will not be retried.',retry:'none',providerOutcome:'unknown'
      }
    })
  }
  accelerateWithinTransaction(id:string,expectedRevision:number,receipt:DeliveryAccelerationReceipt):void {
    if(!this.store.db.isTransaction)throw Error('Acceleration requires a receipt transaction');
    const op=this.raw(id),row=this.store.db.prepare('SELECT owner FROM draft_send_operations WHERE id=?').get(id);
    if(this.closing||row?.owner!==this.owner||op.mode!=='immediate'||op.scheduledAt!==null||op.state!=='queued'||op.deliveryAttemptId||op.revision!==expectedRevision||op.accelerationId||!beforeDeliveryDeadline(op.cancellableUntil,this.now()))conflict('This owned queued immediate Send cannot accelerate');
    const recorded=this.store.db.prepare("SELECT data FROM delivery_accelerations WHERE id=? AND source='composer' AND account_id=? AND operation_id=?").get(receipt.id,op.accountId,id);
    if(!recorded||recorded.data!==JSON.stringify(receipt)||receipt.originalDeadlineAt!==op.cancellableUntil||!Number.isFinite(Date.parse(receipt.effectiveDeadlineAt))||Date.parse(receipt.effectiveDeadlineAt)>this.now())conflict('Acceleration receipt identity changed');
    const draft=this.ownedDraft(op.accountId,op.draftId);if(!draft||draft.status!=='send_queued'||draft.scheduledAt!==undefined||draft.artifactSendId||this.store.artifactDeliveryId(op.draftId))conflict('The owned immediate draft is unavailable');this.linked(draft,{composerOperationId:id});this.policy(draft);
    this.save({...op,originalCancellableUntil:op.cancellableUntil,cancellableUntil:receipt.effectiveDeadlineAt,accelerationId:receipt.id,acceleratedAt:receipt.createdAt});
  }
  wakeAcceleration(id:string){this.deadlineWakes.get(id)?.();}
  execute(id:string,dispatcher:(draftId:string,operationId:string)=>Promise<unknown>):Promise<void>{
    const current=this.active.get(id);
    if(current)return current;
    const row=this.store.db.prepare('SELECT owner,data FROM draft_send_operations WHERE id=?').get(id);
    if(!row||row.owner!==this.owner||this.closing)return Promise.resolve();
    const op=JSON.parse(String(row.data))as DraftSendOperation;
    if(op.state!=='queued'||(op.mode==='scheduled'&&!atOrAfterDeliveryDeadline(op.cancellableUntil,this.now())))return Promise.resolve();
    const controller=new AbortController();
    this.waiting.set(id,controller);
    const failed=(error:unknown)=>{
      const value=this.raw(id);
      if(value.state==='held_before_provider'||terminal.has(value.state)||(this.closing&&value.mode==='scheduled'&&value.state==='queued'&&!value.deliveryAttemptId))return;
      if(this.store.holdTrackedDelivery(value.draftId,{composerOperationId:id}))return;
      if(value.deliveryAttemptId){
        this.store.unknownDelivery(value.draftId,'Composer delivery could not be confirmed',{
          composerOperationId:id
        });
        return
      }
      this.transaction(()=>{
        const latest=this.raw(id);if(terminal.has(latest.state)||latest.deliveryAttemptId)return;this.save({
          ...latest,state:'not_dispatched',error:{
            code:error instanceof HttpError?error.code:'draft_send_not_dispatched',message:'No delivery attempt was claimed; this operation will not queue automatically.',retry:'none',providerOutcome:'not_dispatched'
          }
        })
      })
    };
    const promise=Promise.resolve().then(async()=>{
      const wait=waitForMutableDeliveryDeadline(()=>this.raw(id).cancellableUntil,this.clock,controller.signal);this.deadlineWakes.set(id,wait.wake);await wait.promise;if(this.closing||this.raw(id).state!=='queued')return;await dispatcher(op.draftId,id);if(this.raw(id).state==='queued')failed(new Error('No attempt claimed'))
    }).catch(failed).finally(()=>{
      this.deadlineWakes.delete(id);this.waiting.delete(id);this.active.delete(id)
    });
    this.active.set(id,promise);
    return promise;
  }
  hasDueScheduled(accountId:string,by=this.now()):boolean{return!!this.store.db.prepare("SELECT 1 FROM draft_send_operations WHERE account_id=? AND state='queued' AND json_extract(data,'$.mode')='scheduled' AND json_extract(data,'$.scheduledAt')<=? LIMIT 1").get(accountId,new Date(by).toISOString())}
  runScheduled(dispatcher:(draftId:string,operationId:string)=>Promise<unknown>,now=this.now()):number{
    if(this.closing)return 0;let launched=0;
    for(const row of this.store.db.prepare("SELECT id FROM draft_send_operations WHERE owner=? AND state='queued' AND json_extract(data,'$.mode')='scheduled' AND json_extract(data,'$.scheduledAt')<=? ORDER BY json_extract(data,'$.scheduledAt'),id LIMIT 20").all(this.owner,new Date(now).toISOString())){const id=String(row.id);if(this.active.has(id))continue;launched++;void this.execute(id,dispatcher).catch(()=>{});}
    return launched;
  }
  async waitForIdle(){
    await Promise.allSettled([...this.active.values()])
  }
  async close(){
    if(!this.closing){
      this.closing=true;
      this.transaction(()=>{
        for(const row of this.store.db.prepare("SELECT data FROM draft_send_operations WHERE owner=? AND state='queued'").all(this.owner)){
          const op=JSON.parse(String(row.data))as DraftSendOperation;if(op.mode==='scheduled')continue;if(!op.deliveryAttemptId)this.save({
            ...op,state:'not_dispatched',error:{
              code:'draft_send_shutdown',message:'Stopped before claim; no automatic queue resume.',retry:'none',providerOutcome:'not_dispatched'
            }
          })
        }
      });
      for(const c of this.waiting.values())c.abort(new Error('shutdown'))
    }
    await this.waitForIdle();
    owners.delete(this.owner)
  }
}
