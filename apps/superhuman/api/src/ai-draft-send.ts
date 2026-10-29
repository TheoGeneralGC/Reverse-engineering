import type { DeliveryAccelerationReceipt } from './delivery-control-types.ts';
import { deliveryActionKeyInUse } from './delivery-action-keys.ts';
import { randomUUID } from 'node:crypto';
import { HttpError, type Account, type Draft, type DeliveryAttempt } from './types.ts';
import type { Store, DeliveryContext } from './store.ts';
import type { GoogleProvider } from './google.ts';
import { hash, identifier, strictObject } from './ai-chat-store.ts';
import { AiDraftService, draftPreviewHeaders } from './ai-drafts.ts';
import type { AiDraftScope, AiDraftPreview, AiDraftCreation } from './ai-draft-types.ts';
import { deliveryDeadline, beforeDeliveryDeadline, atOrAfterDeliveryDeadline, waitForMutableDeliveryDeadline, type DeliveryClock } from './delivery-delay.ts';
import type { AiDraftSendCancellation, AiDraftSendCancelResponse } from './ai-draft-send-types.ts';
import type { AiDraftSendOperation, AiDraftSendSnapshot, AiDraftSendEligibility } from './ai-draft-send-types.ts';

function missing(): never { throw new HttpError(404, 'Artifact Send resource not found', 'ai_draft_send_not_found'); }
function conflict(message = 'The artifact action or generation changed; reload its state'): never { throw new HttpError(409, message, 'ai_draft_send_conflict'); }
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
// Same-process service replacement can distinguish a closed owner from another
// live server using its nonce; across processes we conservatively check the PID.
const liveOwners = new Set<string>();
const finalStates = new Set(['sent', 'not_dispatched', 'outcome_unknown', 'cancelled']);

export class AiDraftSendService {
  readonly store: Store; readonly drafts: AiDraftService; readonly google: GoogleProvider; readonly now: () => number;
  readonly owner = randomUUID(); readonly active = new Map<string, Promise<void>>(); private closing = false; readonly clock: DeliveryClock; readonly windowMs: number; private waiting = new Map<string,AbortController>(); private deadlineWakes=new Map<string,()=>void>();
  constructor(store: Store, drafts: AiDraftService, google: GoogleProvider, now = Date.now, ownerAlive = alive, timing: {windowMs?:number;schedule?:DeliveryClock['schedule']} = {}) {
    this.store=store;this.drafts=drafts;this.google=google;this.now=now;this.windowMs=timing.windowMs??10000;deliveryDeadline(now(),this.windowMs);this.clock={now,schedule:timing.schedule??((callback,ms)=>{const timer=setTimeout(callback,ms);timer.unref();return{cancel:()=>clearTimeout(timer)}})};
    const createSendTable=`CREATE TABLE IF NOT EXISTS ai_draft_sends(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,preview_id TEXT NOT NULL,creation_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,content_hash TEXT NOT NULL,sender_email TEXT NOT NULL,generation INTEGER NOT NULL CHECK(typeof(generation)='integer' AND generation>=0 AND generation<=1000000),data TEXT NOT NULL,UNIQUE(account_id,client_key),UNIQUE(preview_id,generation));`;
    store.db.exec('BEGIN IMMEDIATE');
    try{
      store.db.exec(createSendTable);
      // The317 prototype allowed one Send for the entire preview. Upgrade only
      // its derived ledger schema; all operation/receipt IDs and mail JSON stay.
      if(!store.db.prepare('PRAGMA table_info(ai_draft_sends)').all().some(row=>row.name==='generation')){
        store.db.exec('ALTER TABLE ai_draft_sends RENAME TO ai_draft_sends_legacy');
        if(store.db.prepare("SELECT 1 FROM ai_draft_sends_legacy WHERE json_type(data,'$.generation') IS NOT 'integer' OR json_extract(data,'$.generation')<0 OR json_extract(data,'$.generation')>1000000 LIMIT 1").get())throw new Error('Legacy Send generation is invalid');
        store.db.exec(createSendTable);
        store.db.exec("INSERT INTO ai_draft_sends SELECT id,account_id,session_id,turn_id,preview_id,creation_id,draft_id,client_key,fingerprint,state,owner,owner_pid,content_hash,sender_email,json_extract(data,'$.generation'),data FROM ai_draft_sends_legacy; DROP TABLE ai_draft_sends_legacy;");
      }
      store.db.exec(`CREATE INDEX IF NOT EXISTS ai_draft_send_scope ON ai_draft_sends(account_id,session_id,turn_id,preview_id,generation DESC);
        CREATE TABLE IF NOT EXISTS ai_draft_send_cancellations(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,account_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key));
        UPDATE ai_draft_sends SET data=json_set(data,'$.cancellableUntil',json_extract(data,'$.createdAt'),'$.cancelledAt',NULL) WHERE json_type(data,'$.cancellableUntil') IS NULL;`);
      store.db.exec('COMMIT');
    }catch(error){store.db.exec('ROLLBACK');throw error;}
    store.deliveryHooks = { claim: (draft, attempt, context) => this.claim(draft, attempt, context), complete: (draft, attempt, context) => this.complete(draft, attempt, context), unknown: (draft, context) => this.unknown(draft, context) };
    for (const row of store.db.prepare("SELECT id,owner,owner_pid,data FROM ai_draft_sends WHERE state IN ('queued','sending')").all()) {
      const live = ownerAlive === alive && Number(row.owner_pid) === process.pid ? liveOwners.has(String(row.owner)) : ownerAlive(Number(row.owner_pid));
      if (live) continue;
      this.drafts.chat.transaction(() => {
        const operation = this.raw(String(row.id)); const draft = this.store.get<Draft>('draft', operation.draftId);
        const attempt = operation.deliveryAttemptId ? this.store.get<DeliveryAttempt>('delivery', operation.deliveryAttemptId) : undefined;
        if (draft?.status === 'sent' && draft.accountId === operation.accountId && draft.artifactSendId === operation.id && draft.deliveryAttemptId === operation.deliveryAttemptId && attempt?.draftId === draft.id && attempt.status === 'sent' && draft.providerMessageId && draft.providerMessageId === attempt.providerMessageId) {
          this.save({ ...operation, state: 'sent', confirmedAt: attempt.completedAt ?? new Date(this.now()).toISOString(), providerMessageId: draft.providerMessageId, error: null });
        } else {
          const dispatched = operation.deliveryAttemptId !== null || !!draft?.deliveryAttemptId || operation.state === 'sending';
          this.save({ ...operation, state: dispatched ? 'outcome_unknown' : 'not_dispatched', error: { code: 'ai_draft_send_interrupted', message: dispatched ? 'Delivery was interrupted after an attempt was claimed. Check Sent; it will not be retried.' : 'The accepted action was interrupted before a delivery attempt. It will not be queued automatically.', retry: 'none', providerOutcome: dispatched ? 'unknown' : 'not_dispatched' } });
        }
      });
    }
    liveOwners.add(this.owner);
  }
  ownsLiveDelivery(draftId:string):boolean { const row=this.store.db.prepare("SELECT owner,owner_pid FROM ai_draft_sends WHERE draft_id=? AND state IN ('queued','sending')").get(draftId); if(!row)return false;return Number(row.owner_pid)===process.pid?liveOwners.has(String(row.owner)):alive(Number(row.owner_pid)); }
  private preview(scope: AiDraftScope, previewId: string): AiDraftPreview { try { return this.drafts.readPreview(scope, previewId); } catch (error) { if (error instanceof HttpError && error.status === 404) missing(); throw error; } }
  private raw(id: string): AiDraftSendOperation { const row = this.store.db.prepare('SELECT data FROM ai_draft_sends WHERE id=?').get(id); if (!row) missing(); return JSON.parse(String(row.data)); }
  private save(operation: AiDraftSendOperation) { if (!this.store.db.isTransaction) throw new Error('Artifact Send state requires a transaction'); operation = { ...operation, revision: operation.revision + 1 }; this.store.db.prepare('UPDATE ai_draft_sends SET state=?,data=? WHERE id=?').run(operation.state, JSON.stringify(operation), operation.id); return operation; }
  private latest(scope: AiDraftScope, previewId: string, generation: number) { const row = this.store.db.prepare('SELECT data FROM ai_draft_sends WHERE account_id=? AND session_id=? AND turn_id=? AND preview_id=? AND generation=?').get(scope.accountId, scope.sessionId, scope.turnId, previewId, generation); return row ? JSON.parse(String(row.data)) as AiDraftSendOperation : null; }
  private creation(operation: AiDraftSendOperation): AiDraftCreation { const row = this.store.db.prepare('SELECT data FROM ai_draft_creations WHERE id=? AND account_id=? AND session_id=? AND turn_id=? AND preview_id=? AND generation=?').get(operation.creationId, operation.accountId, operation.sessionId, operation.turnId, operation.previewId, operation.generation); if (!row) conflict('The Send creation identity is unavailable'); return JSON.parse(String(row.data)); }
  private candidate(preview: AiDraftPreview): Draft { return { id: 'unpersisted', accountId: preview.accountId, ...draftPreviewHeaders(preview.payload), subject: preview.payload.subject, body: preview.payload.body, ...(preview.payload.html !== undefined ? { html: preview.payload.html } : {}), attachments: [], status: 'draft', updatedAt: '' }; }
  private policy(draft: Draft) {
    const account = this.store.required<Account>('account', draft.accountId);
    if (account.provider !== 'google') throw new HttpError(409, 'Demo accounts cannot send email', 'demo_delivery_disabled');
    if (!this.google.status().configured) throw new HttpError(503, 'Configure the Google provider before sending', 'provider_not_configured');
    const grant = this.google.grant(account.id, 'mail');
    if (!this.store.db.prepare('SELECT 1 FROM secrets WHERE account_id=?').get(account.id)) throw new HttpError(401, 'Reconnect the selected Gmail account', 'reconnect_required');
    if (!grant?.grantedScopes.some(scope => ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'].includes(scope))) throw new HttpError(403, 'The selected account has no recorded mail-send grant', 'insufficient_google_scope');
    this.google.validateDelivery(draft);
  }
  private eligibility(preview: AiDraftPreview, creation: AiDraftCreation | null, operation: AiDraftSendOperation | null): AiDraftSendEligibility {
    const latest=this.drafts.latestCreation(preview,preview.id);
    if(operation&&operation.generation!==latest?.generation)return{eligible:false,createGeneration:null,reason:'historical_operation'};
    if(this.drafts.hasSendClaim(preview.id))return{eligible:false,createGeneration:null,reason:'send_claimed'};
    if(operation&&operation.state!=='cancelled')return{eligible:false,createGeneration:null,reason:'send_claimed'};
    const exists=creation&&this.store.db.prepare("SELECT 1 FROM records WHERE kind='draft' AND id=?").get(creation.draftId);
    if(exists)return{eligible:false,createGeneration:null,reason:'already_created'};
    const generation=creation?creation.generation+1:0;
    try{this.policy(this.candidate(preview));return{eligible:true,createGeneration:generation,reason:'eligible'}}
    catch(error){return{eligible:false,createGeneration:generation,reason:error instanceof HttpError?error.code:'delivery_unavailable'}}
  }
  private snapshot(preview: AiDraftPreview, operation: AiDraftSendOperation | null): AiDraftSendSnapshot {
    const creation=operation?this.creation(operation):this.drafts.latestCreation(preview,preview.id);
    const snapshot:AiDraftSendSnapshot={preview,creation,operation,latestGeneration:this.drafts.latestCreation(preview,preview.id)?.generation??null,eligibility:this.eligibility(preview,creation,operation),serverNow:new Date(this.now()).toISOString(),canCancel:!!operation&&operation.state==='queued'&&!operation.deliveryAttemptId&&beforeDeliveryDeadline(operation.cancellableUntil,this.now())};
    if(operation?.state==='cancelled'){
      const row=this.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(operation.draftId,operation.accountId);
      if(!row)snapshot.restoredResolution={availability:'unavailable',draftId:null};
      else{const draft=JSON.parse(String(row.data)) as Draft;const editable=['draft','failed'].includes(draft.status)&&!this.store.artifactDeliveryId(draft.id);snapshot.restoredResolution={availability:editable?'available':'locked',draftId:editable?draft.id:null};if(editable)snapshot.restoredDraft=draft;}
    }
    return snapshot;
  }
  get(scope: AiDraftScope, previewId: string): AiDraftSendSnapshot { const preview = this.preview(scope, previewId); const current=this.drafts.latestCreation(scope,previewId); return this.snapshot(preview,current?this.latest(scope,previewId,current.generation):null); }
  byRequest(scope: AiDraftScope, previewId: string, key: string): AiDraftSendSnapshot { const preview = this.preview(scope, previewId); identifier(key); const row = this.store.db.prepare('SELECT data FROM ai_draft_sends WHERE account_id=? AND session_id=? AND turn_id=? AND preview_id=? AND client_key=?').get(scope.accountId, scope.sessionId, scope.turnId, previewId, key); if (!row) missing(); return this.snapshot(preview, JSON.parse(String(row.data))); }
  scopedOperation(scope: AiDraftScope, operationId: string): AiDraftSendOperation { identifier(operationId); try { this.drafts.chat.turn(scope.accountId, scope.sessionId, scope.turnId); } catch (error) { if (error instanceof HttpError && error.status === 404) missing(); throw error; } const row = this.store.db.prepare('SELECT data FROM ai_draft_sends WHERE id=? AND account_id=? AND session_id=? AND turn_id=?').get(operationId, scope.accountId, scope.sessionId, scope.turnId); if (!row) missing(); const operation = JSON.parse(String(row.data)) as AiDraftSendOperation; this.drafts.readPreview(scope, operation.previewId); return operation; }
  submit(previewId: string, raw: unknown): { accepted: boolean; snapshot: AiDraftSendSnapshot } {
    if (this.closing) throw new HttpError(503, 'Artifact Send service is stopping', 'ai_draft_send_stopping');
    const value = strictObject(raw, ['accountId','sessionId','turnId','clientRequestId','expectedPreviewHash','expectedGeneration']);
    const scope = { accountId: identifier(value.accountId), sessionId: identifier(value.sessionId), turnId: identifier(value.turnId) }; const key = identifier(value.clientRequestId);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key) || typeof value.expectedPreviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedPreviewHash) || typeof value.expectedGeneration !== 'number' || !Number.isSafeInteger(value.expectedGeneration) || value.expectedGeneration < 0 || value.expectedGeneration > 1000000) throw new HttpError(400,'Invalid artifact Send key/hash/generation','ai_draft_send_invalid_request');
    return this.drafts.chat.transaction(() => {
      const preview = this.preview(scope, previewId); const fingerprint = hash({ kind: 'send', ...scope, previewId, expectedPreviewHash: value.expectedPreviewHash, expectedGeneration: value.expectedGeneration });
      const prior = this.store.db.prepare('SELECT fingerprint,data FROM ai_draft_sends WHERE account_id=? AND client_key=?').get(scope.accountId,key);
      if (prior) { if (prior.fingerprint !== fingerprint) conflict('This action key belongs to another immutable Send request'); return { accepted:false, snapshot:this.snapshot(preview,JSON.parse(String(prior.data))) }; }
      if(deliveryActionKeyInUse(this.store.db,scope.accountId,key,['ai_draft_requests','ai_draft_sends','ai_draft_send_cancellations']))conflict('This key belongs to another delivery action');
      if (this.store.db.prepare('SELECT 1 FROM ai_draft_send_cancellations WHERE account_id=? AND client_key=?').get(scope.accountId,key)) conflict('This key belongs to an Undo action');
      if (this.store.db.prepare('SELECT 1 FROM ai_draft_requests WHERE account_id=? AND client_key=?').get(scope.accountId,key)) conflict('This key belongs to a Create Draft action');
      if (preview.payloadHash !== value.expectedPreviewHash) conflict('The preview hash changed');
      const current = this.get(scope, previewId); if (['already_created','send_claimed','historical_operation'].includes(current.eligibility.reason)) conflict('This generation already belongs to another artifact action');
      if (current.eligibility.createGeneration !== value.expectedGeneration) conflict();
      // Throw the actual sanitized policy error, before any records are inserted.
      const candidate = this.candidate(preview); this.policy(candidate);
      const id=randomUUID(), draftId=randomUUID(), creationId=randomUUID(), at=new Date(this.now()).toISOString();
      const draft=this.store.saveDraft({ ...candidate, id:draftId, status:'send_queued', artifactSendId:id }, 'ai-send');
      const sender=this.store.required<Account>('account',scope.accountId).email.toLowerCase();
      if(this.contentHash(draft,sender)!==this.contentHash(candidate,sender))conflict('The current content policy changes this preview; generate a newly reviewed preview before sending');
      const creation:AiDraftCreation={id:creationId,...scope,previewId,payloadHash:preview.payloadHash,draftId,generation:value.expectedGeneration as number,createdAt:at};
      this.store.db.prepare('INSERT INTO ai_draft_creations VALUES(?,?,?,?,?,?,?,?)').run(creation.id,previewId,scope.accountId,scope.sessionId,scope.turnId,draftId,creation.generation,JSON.stringify(creation));
      const operation:AiDraftSendOperation={id,...scope,previewId,generation:creation.generation,creationId,draftId,clientRequestId:key,payloadHash:preview.payloadHash,state:'queued',revision:0,createdAt:at,startedAt:null,confirmedAt:null,deliveryAttemptId:null,providerMessageId:null,error:null,cancellableUntil:deliveryDeadline(this.now(),this.windowMs),cancelledAt:null};
      this.store.db.prepare('INSERT INTO ai_draft_sends VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,scope.accountId,scope.sessionId,scope.turnId,previewId,creationId,draftId,key,fingerprint,'queued',this.owner,process.pid,this.contentHash(draft,sender),sender,operation.generation,JSON.stringify(operation));
      return {accepted:true,snapshot:this.snapshot(preview,operation)};
    });
  }
  cancel(operationId:string,raw:unknown):AiDraftSendCancelResponse {
    const value=strictObject(raw,['accountId','sessionId','turnId','clientRequestId','expectedRevision']);
    const scope={accountId:identifier(value.accountId),sessionId:identifier(value.sessionId),turnId:identifier(value.turnId)},key=identifier(value.clientRequestId);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(key)||typeof value.expectedRevision!=='number'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0)throw new HttpError(400,'Invalid Undo key/revision','ai_draft_send_invalid_request');
    const result=this.drafts.chat.transaction(()=>{
      let operation=this.scopedOperation(scope,operationId);const preview=this.preview(scope,operation.previewId),fingerprint=hash({kind:'cancel',...scope,operationId,expectedRevision:value.expectedRevision});
      const prior=this.store.db.prepare('SELECT fingerprint,data FROM ai_draft_send_cancellations WHERE account_id=? AND client_key=?').get(scope.accountId,key);
      if(prior){if(prior.fingerprint!==fingerprint)conflict('This key belongs to another Undo request');return{...this.snapshot(preview,operation),cancellation:JSON.parse(String(prior.data))};}
      if(this.store.db.prepare('SELECT 1 FROM ai_draft_sends WHERE account_id=? AND client_key=?').get(scope.accountId,key)||this.store.db.prepare('SELECT 1 FROM ai_draft_requests WHERE account_id=? AND client_key=?').get(scope.accountId,key))conflict('This key belongs to another action');
      if(deliveryActionKeyInUse(this.store.db,scope.accountId,key,['ai_draft_requests','ai_draft_sends','ai_draft_send_cancellations']))conflict('This key belongs to another delivery action');
      const at=new Date(this.now()).toISOString();
      if(operation.state==='cancelled'){
        if(value.expectedRevision!==operation.cancelledFromRevision&&value.expectedRevision!==operation.revision)conflict('The cancelled operation revision changed');
      }else{
        if(operation.state!=='queued'||operation.deliveryAttemptId||!beforeDeliveryDeadline(operation.cancellableUntil,this.now()))throw new HttpError(409,'The Undo window closed or a delivery attempt was claimed','ai_draft_send_not_cancellable');
        if(value.expectedRevision!==operation.revision)conflict('The Send revision changed');
        const draftRow=this.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(operation.draftId,operation.accountId);if(!draftRow)throw new HttpError(409,'The owned queued draft is unavailable','ai_draft_send_not_cancellable');const draft=JSON.parse(String(draftRow.data))as Draft;this.linked(draft,{artifactOperationId:operation.id});
        operation=this.save({...operation,state:'cancelled',cancelledAt:at,cancelledFromRevision:operation.revision,error:null});
        this.store.restoreCancelledArtifactDraft(operation.draftId,operation.id,at);
      }
      const cancellation:AiDraftSendCancellation={id:randomUUID(),operationId,...scope,clientRequestId:key,createdAt:at};
      this.store.db.prepare('INSERT INTO ai_draft_send_cancellations VALUES(?,?,?,?,?,?,?,?)').run(cancellation.id,operationId,scope.accountId,scope.sessionId,scope.turnId,key,fingerprint,JSON.stringify(cancellation));
      return{...this.snapshot(preview,operation),cancellation};
    });
    this.waiting.get(operationId)?.abort(new Error('cancelled'));return result;
  }
  byCancelRequest(scope:AiDraftScope,operationId:string,key:string):AiDraftSendCancelResponse {
    const operation=this.scopedOperation(scope,operationId),preview=this.preview(scope,operation.previewId);identifier(key);
    const row=this.store.db.prepare('SELECT data FROM ai_draft_send_cancellations WHERE account_id=? AND session_id=? AND turn_id=? AND operation_id=? AND client_key=?').get(scope.accountId,scope.sessionId,scope.turnId,operationId,key);if(!row)missing();return{...this.snapshot(preview,operation),cancellation:JSON.parse(String(row.data))};
  }
  private contentHash(draft:Draft,sender:string) { return hash({accountId:draft.accountId,to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,body:draft.body,html:draft.html??null,attachments:draft.attachments??[],threadId:draft.threadId??null,providerDraftId:draft.providerDraftId??null,sender}); }
  private linked(draft:Draft,context:DeliveryContext,checkContent=true) {
    if (!draft.artifactSendId || context.artifactOperationId!==draft.artifactSendId) conflict('This immutable delivery requires its exact artifact operation');
    const row=this.store.db.prepare('SELECT owner,content_hash,sender_email,data FROM ai_draft_sends WHERE id=? AND draft_id=? AND account_id=?').get(draft.artifactSendId,draft.id,draft.accountId); if(!row)missing();
    const operation=JSON.parse(String(row.data)) as AiDraftSendOperation; this.drafts.readPreview(operation,operation.previewId);
    const sender=this.store.required<Account>('account',draft.accountId).email.toLowerCase(); if(checkContent&&(sender!==row.sender_email||this.contentHash(draft,sender)!==row.content_hash))conflict('The immutable artifact payload or sender changed');
    return {operation,owner:String(row.owner)};
  }
  private claim(draft:Draft,attempt:DeliveryAttempt,context:DeliveryContext) { const {operation,owner}=this.linked(draft,context); if(owner!==this.owner||operation.state!=='queued'||operation.deliveryAttemptId)conflict('This Send operation cannot claim another attempt'); if(!atOrAfterDeliveryDeadline(operation.cancellableUntil,this.now()))throw new HttpError(409,'Delivery cannot claim an attempt before its Undo deadline','ai_draft_send_undo_window'); this.policy(draft); this.save({...operation,state:'sending',startedAt:attempt.startedAt,deliveryAttemptId:attempt.id,error:null}); }
  private complete(draft:Draft,attempt:DeliveryAttempt,context:DeliveryContext) { const {operation,owner}=this.linked(draft,context); if((!context.reconciliation&&(owner!==this.owner||operation.state!=='sending'))||(context.reconciliation&&!['sending','outcome_unknown'].includes(operation.state))||operation.deliveryAttemptId!==attempt.id||!draft.providerMessageId||draft.providerMessageId!==attempt.providerMessageId)conflict('Delivery proof does not belong to the accepted operation'); this.save({...operation,state:'sent',confirmedAt:draft.updatedAt,providerMessageId:draft.providerMessageId,error:null}); }
  private unknown(draft:Draft,context:DeliveryContext) { const {operation}=this.linked(draft,context,false); if(operation.state==='sent')return; if(operation.deliveryAttemptId!==draft.deliveryAttemptId)conflict('Unknown delivery attempt identity changed'); this.save({...operation,state:'outcome_unknown',error:{code:'delivery_requires_reconciliation',message:'Delivery outcome is unknown. Check Sent; this message will not be retried.',retry:'none',providerOutcome:'unknown'}}); }
  accelerateWithinTransaction(id:string,expectedRevision:number,receipt:DeliveryAccelerationReceipt):void {
    if(!this.store.db.isTransaction)throw Error('Acceleration requires a receipt transaction');
    const operation=this.raw(id),row=this.store.db.prepare('SELECT owner FROM ai_draft_sends WHERE id=?').get(id);
    if(this.closing||row?.owner!==this.owner||operation.state!=='queued'||operation.deliveryAttemptId||operation.revision!==expectedRevision||operation.accelerationId||!beforeDeliveryDeadline(operation.cancellableUntil,this.now()))conflict('This owned queued Send cannot accelerate');
    const recorded=this.store.db.prepare("SELECT data FROM delivery_accelerations WHERE id=? AND source='artifact' AND account_id=? AND operation_id=?").get(receipt.id,operation.accountId,id);
    if(!recorded||recorded.data!==JSON.stringify(receipt)||receipt.originalDeadlineAt!==operation.cancellableUntil||!Number.isFinite(Date.parse(receipt.effectiveDeadlineAt))||Date.parse(receipt.effectiveDeadlineAt)>this.now())conflict('Acceleration receipt identity changed');
    const draftRow=this.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(operation.draftId,operation.accountId);if(!draftRow)conflict('The owned queued draft is unavailable');const draft=JSON.parse(String(draftRow.data))as Draft;if(draft.status!=='send_queued'||draft.scheduledAt!==undefined||draft.composerSendId||this.store.composerDeliveryId(draft.id))conflict('The owned immediate artifact draft is unavailable');this.linked(draft,{artifactOperationId:id});this.policy(draft);
    this.save({...operation,originalCancellableUntil:operation.cancellableUntil,cancellableUntil:receipt.effectiveDeadlineAt,accelerationId:receipt.id,acceleratedAt:receipt.createdAt});
  }
  wakeAcceleration(id:string){this.deadlineWakes.get(id)?.();}
  deliveryContext(draft:Draft,reconciliation=false):DeliveryContext { return draft.artifactSendId?{artifactOperationId:draft.artifactSendId,reconciliation}:{}; }
  execute(operationId:string,dispatcher:(draftId:string,operationId:string)=>Promise<unknown>):Promise<void> {
    const active=this.active.get(operationId);if(active)return active;
    const row=this.store.db.prepare('SELECT owner,data FROM ai_draft_sends WHERE id=?').get(operationId);if(!row||row.owner!==this.owner||this.closing)return Promise.resolve();const operation=JSON.parse(String(row.data))as AiDraftSendOperation;if(operation.state!=='queued')return Promise.resolve();
    const controller=new AbortController();this.waiting.set(operationId,controller);
    const failed=(error:unknown)=>{
      const current=this.raw(operationId);if(finalStates.has(current.state))return;
      if(current.deliveryAttemptId){this.store.unknownDelivery(current.draftId,'The artifact delivery could not be confirmed.',{artifactOperationId:current.id});return;}
      this.drafts.chat.transaction(()=>{const latest=this.raw(operationId);if(finalStates.has(latest.state)||latest.deliveryAttemptId)return;this.save({...latest,state:'not_dispatched',error:{code:error instanceof HttpError?error.code:'ai_draft_send_not_dispatched',message:'The accepted action did not claim a delivery attempt. It will not be queued automatically.',retry:'none',providerOutcome:'not_dispatched'}})});
    };
    const promise=Promise.resolve().then(async()=>{
      // Waiting here must never occupy the account queue. Both this callback and
      // the later atomic claim re-read state; a confirmed cancel wins forever.
      const wait=waitForMutableDeliveryDeadline(()=>this.raw(operationId).cancellableUntil,this.clock,controller.signal);this.deadlineWakes.set(operationId,wait.wake);await wait.promise;
      if(this.closing||this.raw(operationId).state!=='queued')return;
      await dispatcher(operation.draftId,operation.id);
      if(this.raw(operationId).state==='queued')failed(new Error('Dispatcher did not claim a delivery attempt'));
    }).catch(failed).finally(()=>{this.deadlineWakes.delete(operationId);this.waiting.delete(operationId);this.active.delete(operationId)});
    this.active.set(operationId,promise);return promise;
  }
  async waitForIdle(){await Promise.allSettled([...this.active.values()]);}
  async close(){
    if(!this.closing){this.closing=true;this.drafts.chat.transaction(()=>{for(const row of this.store.db.prepare("SELECT data FROM ai_draft_sends WHERE owner=? AND state='queued'").all(this.owner)){const op=JSON.parse(String(row.data))as AiDraftSendOperation;if(!op.deliveryAttemptId)this.save({...op,state:'not_dispatched',error:{code:'ai_draft_send_shutdown',message:'The service stopped before a delivery attempt. It will not queue automatically.',retry:'none',providerOutcome:'not_dispatched'}})}});for(const controller of this.waiting.values())controller.abort(new Error('shutdown'));}
    await this.waitForIdle();liveOwners.delete(this.owner);
  }
}
