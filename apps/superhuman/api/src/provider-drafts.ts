import {generatedHash,type DraftWriteContext,type ProviderMetadataWriter} from './generated-draft-policy.ts';
import { addressParser } from 'postal-mime';
import { randomUUID } from 'node:crypto';
import type { Store, DraftLifecycleOrigin } from './store.ts';
import type { Account, Draft, Thread } from './types.ts';
import { HttpError } from './types.ts';
import { ProviderDraftRepository, providerDraftMissing, providerDraftInvalid, type ProviderDraftLink } from './provider-draft-store.ts';
import { createProviderDraftMime, providerDraftInputIdentity, equivalentProviderDraftMime, providerDraftHash, assertProviderDraftUnicode, type ProviderDraftMimeSnapshot } from './provider-draft-mime.ts';
import { validGmailDraft, type ProviderDraftTransport, type GmailDraftResource, type GmailDraftMetadata } from './provider-draft-transport.ts';
import type { ProviderDraftError, ProviderDraftOperation, ProviderDraftSnapshot, ProviderDraftReconcileResponse, ProviderDraftReconciliation, ProviderDraftDiscardRequest, ProviderDraftDiscardResponse, ProviderDraftDiscardReceipt } from './provider-draft-types.ts';
import { OperationQueue } from './operation-queue.ts';
import { deliveryActionKeyInUse } from './delivery-action-keys.ts';
import { parseFragment } from 'parse5';
export type ProviderDraftClock = { now: () => number; schedule: (callback: () => void, ms: number) => { cancel: () => void } };
const systemClock: ProviderDraftClock = { now: Date.now, schedule: (callback,ms) => { const timer=setTimeout(callback,ms);timer.unref();return{cancel:()=>clearTimeout(timer)}; } };
const owners = new Set<string>();
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const alive = (pid:number) => {try{process.kill(pid,0);return true}catch(error){return(error as NodeJS.ErrnoException).code==='EPERM'}};
const meaningful = (draft:Draft) => {
  if (draft.to.trim()||draft.cc.trim()||draft.bcc.trim()||draft.subject.trim()||draft.body.trim()||draft.attachments?.length) return true;
  const walk=(node:any):boolean=>node.nodeName==='#text'?!!node.value?.trim():['a','ul','ol','li','blockquote','pre','code','img','table'].includes(node.tagName)||!!node.childNodes?.some(walk);
  return !!draft.html && walk(parseFragment(draft.html));
};
export class ProviderDraftService {
  readonly store:Store;readonly repository:ProviderDraftRepository;readonly transport:ProviderDraftTransport;readonly clock:ProviderDraftClock;
  readonly owner=randomUUID();readonly active=new Map<string,Promise<void>>();
  private readonly timers=new Map<string,{cancel:()=>void}>();private readonly aborts=new Map<string,AbortController>();
  private readonly pendingReads=new Set<Promise<unknown>>();
  private closing=false;private readonly metadataWriter:ProviderMetadataWriter;private readonly automatic:boolean;
  private readonly queue:{run<T>(accountId:string,fn:()=>Promise<T>):Promise<T>};
  private readonly debounceMs:number;
  constructor(store:Store,transport:ProviderDraftTransport,options:{clock?:ProviderDraftClock;queue?:{run<T>(accountId:string,fn:()=>Promise<T>):Promise<T>};automatic?:boolean;resume?:boolean;debounceMs?:number;ownerAlive?:(pid:number)=>boolean}={}){
    this.store=store;this.transport=transport;this.clock=options.clock??systemClock;this.repository=new ProviderDraftRepository(store,this.clock.now);this.automatic=options.automatic??true;this.debounceMs=options.debounceMs??1000;
    if(!Number.isFinite(this.debounceMs)||this.debounceMs<0||this.debounceMs>60000)throw new TypeError('Invalid cloud draft debounce');
    this.queue=options.queue??new OperationQueue();
    this.metadataWriter=store.createProviderMetadataWriter((request,before)=>{
      if(this.closing)throw new HttpError(503,'Cloud draft service stopped','provider_draft_stopping');
      const op=this.repository.operation(request.accountId,request.draftId,request.operationId),link=this.repository.link(request.accountId,request.draftId),owner=store.db.prepare('SELECT owner FROM provider_draft_operations WHERE id=?').get(op.id);
      if(link?.generated)this.store.assertGeneratedEnrollment(before,link.generated.scope,link.generated.ownerFingerprint);
      if(!link||link.activeOperationId!==op.id||link.revision!==request.expectedLinkRevision||link.discardId||['consumed','discarded'].includes(link.state)||op.state!=='confirmed'||!['create','update'].includes(op.kind)||op.resolution!=='matching-snapshot'||!op.result||owner?.owner!==this.owner||op.result.providerDraftId!==request.patch.providerDraftId||op.completedAt!==request.patch.providerDraftSyncedAt||before.accountId!==op.accountId||before.id!==op.draftId)throw new HttpError(409,'Cloud metadata authority changed','provider_draft_revision_conflict');
    });
    this.recover(options.ownerAlive??alive);
    store.registerDraftLifecycleHooks({
      beforeWrite:(before,next,context)=>this.beforeWrite(before,next,context),
      written:(_before,next,context)=>{if(!store.isProviderMetadataContext(context))this.note(next)},
      created:(draft,origin,scope)=>{if(origin!=='auto-generated-local'&&this.repository.account(draft.accountId).provider==='google'){if(!this.repository.link(draft.accountId,draft.id))this.repository.enroll(draft,origin,scope);this.note(draft)}},
      beforeRemove:(draft,context)=>this.beforeRemove(draft,context),
      deliveryReadiness:draft=>this.deliveryReady(draft),
      beforeDelivery:draft=>this.suspendForDelivery(draft),
      beforeNativeSend:draft=>{const link=this.repository.link(draft.accountId,draft.id);if(!link)return;const current=this.repository.draft(draft.accountId,draft.id);if(link.state!=='suspended'||!current||current.status!=='sending'||draft.status!=='sending'||!draft.deliveryAttemptId||current.deliveryAttemptId!==draft.deliveryAttemptId||(draft.providerDraftId??null)!==link.providerDraftId)throw new HttpError(409,'Cloud-linked delivery requires its durable claimed snapshot','provider_draft_locked')},
    });
    owners.add(this.owner);
    if(options.resume!==false)this.resumeQueued();
  }

  private async io<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
    if(signal.aborted)throw new HttpError(503,'Cloud draft operation stopped','provider_draft_stopping');
    return new Promise<T>((resolve,reject)=>{const abort=()=>{cleanup();reject(new HttpError(503,'Cloud draft operation stopped or timed out','provider_draft_stopping'))};const cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});promise.then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)})});
  }
  private recover(isAlive:(pid:number)=>boolean){
    this.repository.transaction(()=>{
      for(const row of this.store.db.prepare("SELECT id,account_id,draft_id,owner,owner_pid FROM provider_draft_operations WHERE state='dispatching'").all()){
        const live=Number(row.owner_pid)===process.pid&&isAlive===alive?owners.has(String(row.owner)):isAlive(Number(row.owner_pid));if(live)continue;
        const op=this.repository.operation(String(row.account_id),String(row.draft_id),String(row.id)),link=this.repository.link(op.accountId,op.draftId);if(!link||link.activeOperationId!==op.id)continue;
        const error:ProviderDraftError={code:'provider_draft_interrupted',message:'A cloud write was interrupted. Check its outcome; it will not repeat automatically.',retry:'explicit-check'};
        this.repository.saveOperation({...op,state:'unknown',error});this.repository.saveLink({...link,state:'outcome_unknown',error});
      }
    });
  }
  private context(draft:Draft){
    const account=this.repository.account(draft.accountId),link=this.repository.link(draft.accountId,draft.id);
    if(link)return{account,previous:{internetMessageId:link.replyContext.internetMessageId??undefined,references:link.replyContext.references??undefined},providerThreadId:link.replyContext.providerThreadId??undefined};
    let thread:Thread|undefined;
    if(draft.threadId){const row=this.store.db.prepare("SELECT r.data FROM thread_summaries s JOIN records r ON r.kind='thread' AND r.id=s.id WHERE s.account_id=? AND s.id=?").get(draft.accountId,draft.threadId);if(!row)throw new HttpError(409,'The reply context changed account','provider_draft_scope_changed');thread=JSON.parse(String(row.data));}
    return{account,previous:draft.deliveryReplyContext??thread?.messages.at(-1),providerThreadId:draft.deliveryReplyContext?.providerThreadId??thread?.providerId};
  }
  private beforeWrite(before:Draft|undefined,next:Draft,context:DraftWriteContext){
    const metadata=this.store.isProviderMetadataContext(context);
    const row=this.store.db.prepare('SELECT account_id FROM provider_draft_links WHERE draft_id=?').get(next.id);if(!row)return;
    if(row.account_id!==next.accountId||before&&before.accountId!==next.accountId)throw new HttpError(409,'An owned cloud draft cannot change account','provider_draft_scope_changed');
    const link=this.repository.link(next.accountId,next.id)!;
    if(!metadata&&(link.discardId||['discarded','consumed'].includes(link.state)))throw new HttpError(409,'The owned draft has a terminal intent','provider_draft_locked');
    if(before&&!metadata){
      const authored=(value:Draft)=>({accountId:value.accountId,threadId:value.threadId??null,to:value.to,cc:value.cc,bcc:value.bcc,subject:value.subject,body:value.body,html:value.html??null,attachments:value.attachments??[]});
      if(before.threadId!==next.threadId)throw new HttpError(409,'Create a new draft to change the owned reply target','provider_draft_scope_changed');
      if((next.revision??0)<(before.revision??0)||(next.revision??0)===(before.revision??0)&&providerDraftHash(authored(before))!==providerDraftHash(authored(next)))throw new HttpError(409,'An authored draft revision cannot regress or change identity','provider_draft_revision_conflict');
    }
    if(!metadata&&before&&before.providerDraftId!==next.providerDraftId)throw new HttpError(409,'Cloud mapping metadata requires its owned ledger','provider_draft_locked');
  }
  private beforeRemove(draft:Draft,context?:{providerDiscardId?:string}){
    let link=this.repository.link(draft.accountId,draft.id);if(!link)return;
    if(context?.providerDiscardId===link.discardId&&link.state==='discarded')return;
    const issued=this.store.db.prepare("SELECT 1 FROM provider_draft_operations WHERE account_id=? AND draft_id=? AND (json_extract(data,'$.issuedAt') IS NOT NULL OR state IN ('dispatching','unknown')) LIMIT 1").get(draft.accountId,draft.id);
    if(context||link.providerDraftId||issued||link.discardId||!['draft','failed'].includes(draft.status)||draft.artifactSendId||draft.composerSendId||['discarded','consumed'].includes(link.state))throw new HttpError(409,'Use the exact owned cloud discard intent','provider_draft_deletion_requires_action');
    // Trusted Store cleanup can remove a purely local, never-issued draft. The
    // outer remove savepoint atomically fences timers/claims with a tombstone;
    // rollback leaves the queued timer able to service the retained draft.
    const values=this.context(draft),identity=providerDraftInputIdentity(this.store,draft,values.account,values.previous,values.providerThreadId);
    if(link.desiredHash!==identity.contentHash||link.desiredRevision!==draft.revision)link=this.repository.desire(draft,identity.contentHash,meaningful(draft))!;
    const receipt=this.repository.createDiscardReceipt(link,{accountId:draft.accountId,clientRequestId:'internal-'+randomUUID(),expectedDraftRevision:draft.revision!,expectedContentHash:identity.contentHash,expectedSyncRevision:link.revision});
    const queued=this.repository.saveLink({...link,discardId:receipt.id,state:'discard_queued'});this.repository.insertDeleteOperation(queued,receipt,null,this.owner,false);this.repository.pruneSnapshots(draft.accountId,draft.id,null);
  }
  note(draft:Draft){
    const link=this.repository.link(draft.accountId,draft.id);if(!link)return;
    if(draft.status==='sent'){
      this.repository.transaction(()=>{const fresh=this.repository.link(draft.accountId,draft.id)!;if(fresh.state==='consumed')return;if(fresh.activeOperationId&&['dispatching','unknown'].includes(this.repository.operation(draft.accountId,draft.id,fresh.activeOperationId).state))throw new HttpError(409,'Cloud write outcome must settle before delivery','provider_draft_busy');this.repository.saveLink({...fresh,state:'consumed',error:null});this.repository.pruneSnapshots(draft.accountId,draft.id,null)});return;
    }
    if(link.discardId||['discarded','consumed'].includes(link.state))return;
    const {account,previous,providerThreadId}=this.context(draft),identity=providerDraftInputIdentity(this.store,draft,account,previous,providerThreadId);
    const editable=['draft','failed'].includes(draft.status)&&!draft.artifactSendId&&!draft.composerSendId;
    const desired=this.repository.desire(draft,identity.contentHash,meaningful(draft));
    if(!desired)return;
    if(!editable&&desired.state!=='suspended'&&!['saving','outcome_unknown','remote_conflict'].includes(desired.state))this.repository.transaction(()=>this.repository.saveLink({...this.repository.link(draft.accountId,draft.id)!,state:'suspended'}));
    else if(editable&&desired.state==='queued')this.schedule(draft.accountId,draft.id);
  }
  private resumeQueued(){
    if(!this.automatic||this.closing)return;
    const rows=this.store.db.prepare("SELECT account_id,draft_id FROM provider_draft_links WHERE CASE WHEN json_valid(data) THEN json_extract(data,'$.state') END IN ('queued','discard_queued') LIMIT 100").all();
    for(const row of rows){const draftId=String(row.draft_id);if(!this.active.has(draftId)&&!this.timers.has(draftId))this.schedule(String(row.account_id),draftId)}
  }
  private schedule(accountId:string,draftId:string){
    this.timers.get(draftId)?.cancel();this.timers.delete(draftId);if(this.closing||!this.automatic)return;
    this.timers.set(draftId,this.clock.schedule(()=>{this.timers.delete(draftId);const run=()=>{void this.flush(accountId,draftId).catch(()=>{})};if(this.store.db.isTransaction)queueMicrotask(run);else run()},this.debounceMs));
  }
  status(accountId:string,draftId:string):ProviderDraftSnapshot{return this.repository.snapshot(accountId,draftId)}
  private deliveryReady(draft:Draft){
    const link=this.repository.link(draft.accountId,draft.id);if(!link)return;
    assertProviderDraftUnicode(draft);
    if(['saving','discard_queued','discarding','discarded','consumed','blocked'].includes(link.state))throw new HttpError(409,'The cloud draft is not ready for a delivery intent','provider_draft_busy');
    if(link.state==='outcome_unknown')throw new HttpError(409,'Check the unresolved cloud draft before delivery','provider_draft_unknown');
    if(link.state==='remote_conflict')throw new HttpError(409,'Review the changed remote draft before delivery','provider_draft_remote_conflict');
    if(link.activeOperationId&&['dispatching','unknown'].includes(this.repository.operation(draft.accountId,draft.id,link.activeOperationId).state))throw new HttpError(409,'Cloud write is already in progress','provider_draft_busy');
    const {account,previous,providerThreadId}=this.context(draft),identity=providerDraftInputIdentity(this.store,draft,account,previous,providerThreadId);
    if((draft.providerDraftId??null)!==link.providerDraftId||link.desiredHash!==identity.contentHash)throw new HttpError(409,'The reviewed cloud draft identity changed','provider_draft_revision_conflict');
  }
  suspendForDelivery(draft:Draft){
    this.deliveryReady(draft);const link=this.repository.link(draft.accountId,draft.id);if(!link)return;
    this.timers.get(draft.id)?.cancel();this.timers.delete(draft.id);
    if(link.state!=='suspended')this.repository.transaction(()=>this.repository.saveLink({...this.repository.link(draft.accountId,draft.id)!,state:'suspended'}));
  }
  private trackRead<T>(promise:Promise<T>):Promise<T>{this.pendingReads.add(promise);void promise.finally(()=>this.pendingReads.delete(promise)).catch(()=>{});return promise}
  checkBeforeDelivery(draft:Draft):Promise<void>{return this.trackRead(this.performDeliveryCheck(draft))}
  private async performDeliveryCheck(draft:Draft){
    if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');
    const link=this.repository.link(draft.accountId,draft.id);if(!link)return;
    if(!['suspended','queued','synced','idle'].includes(link.state))this.suspendForDelivery(draft);
    if(!link.providerDraftId)return;
    const account=this.repository.account(draft.accountId),controller=new AbortController(),deadline=this.clock.schedule(()=>controller.abort(),20000);this.aborts.set(draft.id,controller);
    try{
      if(link.generated)this.store.assertGeneratedEnrollment(draft,link.generated.scope,link.generated.ownerFingerprint);
      this.transport.ready(account);
      if((await this.io(this.transport.profile(account,controller.signal),controller.signal)).toLowerCase()!==account.email.toLowerCase())throw new HttpError(409,'Gmail identity changed','provider_draft_identity_unverified');
      const current=await this.io(this.transport.get(account,link.providerDraftId,false,controller.signal),controller.signal);
      if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');
      if(!validGmailDraft(current)||current.id!==link.providerDraftId||current.message.id!==link.providerMessageId){this.setFailure(link,'remote_conflict','provider_draft_remote_changed','The remote draft changed or is unavailable. Nothing was sent.');throw new HttpError(409,'Review the remote draft before sending','provider_draft_remote_conflict')}
    }finally{deadline.cancel();if(this.aborts.get(draft.id)===controller)this.aborts.delete(draft.id)}
  }
  flush(accountId:string,draftId:string):Promise<void>{
    if(this.closing)return Promise.reject(new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping'));
    const known=this.active.get(draftId);if(known)return known;
    const work=this.queue.run(accountId,async()=>{if(this.closing)return;await this.write(accountId,draftId)});
    this.active.set(draftId,work);void work.finally(()=>{if(this.active.get(draftId)===work)this.active.delete(draftId);this.resumeQueued()}).catch(()=>{});return work;
  }
  private setFailure(link:ProviderDraftLink,state:'blocked'|'remote_conflict',code:string,message:string){
    this.repository.transaction(()=>{const current=this.repository.link(link.accountId,link.draftId);if(!current||current.revision!==link.revision||['consumed','discarded'].includes(current.state)||current.activeOperationId&&['dispatching','unknown'].includes(this.repository.operation(current.accountId,current.draftId,current.activeOperationId).state))return;this.repository.saveLink({...current,state,error:{code,message,retry:'explicit-check'}})});
  }
  private async write(accountId:string,draftId:string){
    const link=this.repository.link(accountId,draftId);if(!link)return;if(link.state==='discard_queued'){await this.writeDiscard(link);return}if(link.state!=='queued'||link.discardId)return;
    const draft=this.repository.draft(accountId,draftId);if(!draft||!['draft','failed'].includes(draft.status)||draft.artifactSendId||draft.composerSendId){this.setFailure(link,'remote_conflict','provider_draft_local_unavailable','The owned local draft changed scope or is unavailable.');return}
    const {account,previous,providerThreadId}=this.context(draft),controller=new AbortController();this.aborts.set(draftId,controller);
    const deadline=this.clock.schedule(()=>controller.abort(),20000);
    let operation:ProviderDraftOperation|undefined;
    try{
      if(link.generated)this.store.assertGeneratedEnrollment(draft,link.generated.scope,link.generated.ownerFingerprint);
      this.transport.ready(account);
      if((await this.io(this.transport.profile(account,controller.signal),controller.signal)).toLowerCase()!==account.email.toLowerCase())throw new HttpError(409,'Gmail account identity changed','provider_draft_identity_unverified');
      if(link.providerDraftId){const remote=await this.io(this.transport.get(account,link.providerDraftId,false,controller.signal),controller.signal);if(!validGmailDraft(remote)||remote.id!==link.providerDraftId||remote.message.id!==link.providerMessageId){this.setFailure(link,'remote_conflict','provider_draft_remote_changed','The remote draft changed. Local edits are retained.');return}}
      const snapshot=await createProviderDraftMime(this.store,draft,account,{owner:link.ownerMarker,operationId:randomUUID(),revision:draft.revision!},previous,providerThreadId);
      if(snapshot.contentHash!==link.desiredHash){this.repository.desire(draft,snapshot.contentHash,meaningful(draft));this.schedule(accountId,draftId);return}
      operation=this.repository.transaction(()=>{
        if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');
        const current=this.repository.link(accountId,draftId),local=this.repository.draft(accountId,draftId);
        if(!current||!local||current.state!=='queued'||current.revision!==link.revision||local.revision!==draft.revision||!['draft','failed'].includes(local.status)||local.artifactSendId||local.composerSendId)throw new HttpError(409,'The pending snapshot changed before claim','provider_draft_revision_conflict');
        if(current.generated)this.store.assertGeneratedEnrollment(local,current.generated.scope,current.generated.ownerFingerprint);
        return this.repository.insertOperation(current,snapshot,current.providerDraftId?'update':'create',this.owner);
      });
      const value=operation.kind==='create'?await this.io(this.transport.create(account,{raw:snapshot.raw.toString('base64url'),...(snapshot.threadId?{threadId:snapshot.threadId}:{})},controller.signal),controller.signal):await this.io(this.transport.update(account,operation.providerDraftId!,{raw:snapshot.raw.toString('base64url'),...(snapshot.threadId?{threadId:snapshot.threadId}:{})},controller.signal),controller.signal);
      if(!validGmailDraft(value)||operation.providerDraftId&&value.id!==operation.providerDraftId||snapshot.threadId&&value.message.threadId!==snapshot.threadId)throw new HttpError(502,'Gmail returned an invalid owned draft acknowledgment','provider_draft_invalid_ack');
      this.acknowledge(operation,value);
    }catch(error){
      if(operation)this.markUnknown(operation);
      else if(this.closing)return;
      else if(error instanceof HttpError&&['provider_draft_revision_conflict','provider_draft_stopping'].includes(error.code)){const current=this.repository.link(accountId,draftId);if(current?.state==='queued')this.schedule(accountId,draftId)}
      else this.setFailure(link,'blocked',error instanceof HttpError?error.code:'provider_draft_preflight_failed','The local draft is saved, but cloud saving is blocked. Check configuration or input.');
    }finally{deadline.cancel();if(this.aborts.get(draftId)===controller)this.aborts.delete(draftId)}
  }
  private acknowledge(operation:ProviderDraftOperation,value:GmailDraftResource,reconciled=false){
    this.repository.transaction(()=>{
      const owner=this.store.db.prepare('SELECT owner FROM provider_draft_operations WHERE id=?').get(operation.id),op=this.repository.operation(operation.accountId,operation.draftId,operation.id),link=this.repository.link(operation.accountId,operation.draftId);
      if((reconciled?op.state!=='unknown':owner?.owner!==this.owner||op.state!=='dispatching')||!link||link.activeOperationId!==op.id)return;
      if(this.closing)return;
      // A reconciled proof is now owned by this reader; it never repeats a write.
      if(reconciled)this.store.db.prepare('UPDATE provider_draft_operations SET owner=?,owner_pid=? WHERE id=?').run(this.owner,process.pid,op.id);
      const result={providerDraftId:value.id,providerMessageId:value.message.id,providerThreadId:value.message.threadId},completedAt=new Date(this.clock.now()).toISOString();
      this.repository.saveOperation({...op,state:'confirmed',result,completedAt,resolution:'matching-snapshot',error:null});
      const local=this.repository.draft(op.accountId,op.draftId),editable=!!local&&!link.discardId&&['draft','failed'].includes(local.status)&&!local.artifactSendId&&!local.composerSendId;
      let applied=!editable,metadataFailure=false;
      if(local&&editable){try{applied=this.metadataWriter.write({accountId:op.accountId,draftId:op.draftId,operationId:op.id,expectedLinkRevision:link.revision,expectedCurrentRecordFingerprint:generatedHash(local),patch:{providerDraftId:value.id,providerDraftSyncedAt:completedAt}}).applied}catch{metadataFailure=true}}
      const same=link.desiredHash===op.contentHash,failed=metadataFailure||!applied;
      this.repository.saveLink({...link,providerDraftId:value.id,providerMessageId:value.message.id,providerThreadId:value.message.threadId,syncedRevision:same?link.desiredRevision:op.draftRevision,syncedHash:op.contentHash,state:link.discardId?'discard_queued':!local?'remote_conflict':!editable||failed?'suspended':same?'synced':'queued',error:failed?{code:'provider_draft_local_metadata_conflict',message:'The cloud result is confirmed; local mapping requires explicit review.',retry:'explicit-check'}:local?null:{code:'provider_draft_local_unavailable',message:'The owned local draft is unavailable; its cloud result is retained.',retry:'explicit-check'}});
      this.repository.pruneSnapshots(op.accountId,op.draftId,op.id);
    });
    const next=this.repository.link(operation.accountId,operation.draftId);if(next&&['queued','discard_queued'].includes(next.state))this.schedule(operation.accountId,operation.draftId);
  }
  discard(draftId:string,raw:unknown):{accepted:boolean;response:ProviderDraftDiscardResponse}{
    if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['accountId','clientRequestId','expectedDraftRevision','expectedContentHash','expectedSyncRevision'].includes(key)))providerDraftInvalid();
    const input=raw as ProviderDraftDiscardRequest;
    if(typeof input.clientRequestId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.clientRequestId)||!Number.isSafeInteger(input.expectedDraftRevision)||input.expectedDraftRevision<1||!Number.isSafeInteger(input.expectedSyncRevision)||input.expectedSyncRevision<0||typeof input.expectedContentHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedContentHash))providerDraftInvalid();
    return this.repository.transaction(()=>{
      this.repository.account(input.accountId);
      const fingerprint=this.repository.discardFingerprint(draftId,input),prior=this.store.db.prepare('SELECT draft_id,fingerprint FROM provider_draft_discards WHERE account_id=? AND client_key=?').get(input.accountId,input.clientRequestId);
      if(prior){if(prior.draft_id!==draftId||prior.fingerprint!==fingerprint)throw new HttpError(409,'This discard key belongs to another intent','provider_draft_request_conflict');return{accepted:false,response:this.repository.discardByRequest(input.accountId,draftId,input.clientRequestId)}}
      if(deliveryActionKeyInUse(this.store.db,input.accountId,input.clientRequestId))throw new HttpError(409,'This key belongs to another draft action','provider_draft_request_conflict');
      const link=this.repository.link(input.accountId,draftId),draft=this.repository.draft(input.accountId,draftId);if(!link||!draft)providerDraftMissing();
      if(link.revision!==input.expectedSyncRevision||draft.revision!==input.expectedDraftRevision)throw new HttpError(409,'The reviewed draft changed','provider_draft_revision_conflict');
      if(link.discardId||!['draft','failed'].includes(draft.status)||draft.artifactSendId||draft.composerSendId||this.store.artifactDeliveryId(draftId)||this.store.composerDeliveryId(draftId)||draft.deliveryAttemptId||['consumed','discarded','suspended'].includes(link.state))throw new HttpError(409,'The owned draft is locked','provider_draft_locked');
      const context=this.context(draft),identity=providerDraftInputIdentity(this.store,draft,context.account,context.previous,context.providerThreadId);
      if(identity.contentHash!==input.expectedContentHash||link.desiredHash!==input.expectedContentHash)throw new HttpError(409,'The reviewed discard content changed','provider_draft_revision_conflict');
      const receipt=this.repository.createDiscardReceipt(link,input),active=link.activeOperationId?this.repository.operation(input.accountId,draftId,link.activeOperationId):null;
      const waiting=!!active&&['dispatching','unknown'].includes(active.state);
      const next=this.repository.saveLink({...link,discardId:receipt.id,state:waiting?link.state:'discard_queued'});
      this.store.noteDraftIntent(draft,'discard');
      this.timers.get(draftId)?.cancel();this.timers.delete(draftId);
      if(!waiting&&!next.providerDraftId){this.repository.insertDeleteOperation(next,receipt,null,this.owner,false);this.removeDiscardedLocal(next.accountId,next.draftId,receipt.id);this.repository.pruneSnapshots(next.accountId,next.draftId,null)}
      else if(!waiting)this.schedule(input.accountId,draftId);
      return{accepted:true,response:this.repository.discardByRequest(input.accountId,draftId,input.clientRequestId)};
    });
  }
  discardByRequest(accountId:string,draftId:string,key:string){return this.repository.discardByRequest(accountId,draftId,key)}
  private removeDiscardedLocal(accountId:string,draftId:string,receiptId:string){
    const local=this.repository.draft(accountId,draftId);if(local)this.store.deleteDraft(draftId,{providerDiscardId:receiptId});
  }
  private async writeDiscard(link:ProviderDraftLink){
    const receipt=this.repository.currentDiscard(link);if(!link.providerDraftId||!link.activeOperationId)throw new HttpError(409,'The owned remote draft is unresolved','provider_draft_unknown');
    const source=this.repository.payload(link.accountId,link.draftId,link.activeOperationId),account=this.repository.account(link.accountId),controller=new AbortController(),deadline=this.clock.schedule(()=>controller.abort(),20000);this.aborts.set(link.draftId,controller);
    let op:ProviderDraftOperation|undefined;
    try{
      this.transport.ready(account);
      if((await this.io(this.transport.profile(account,controller.signal),controller.signal)).toLowerCase()!==account.email.toLowerCase())throw new HttpError(409,'Gmail identity changed','provider_draft_identity_unverified');
      const current=await this.io(this.transport.get(account,link.providerDraftId,true,controller.signal),controller.signal);
      if(current&&(!validGmailDraft(current,true)||current.id!==link.providerDraftId||current.message.id!==link.providerMessageId||!await equivalentProviderDraftMime(source,Buffer.from(current.message.raw!,'base64url'),account.email))){this.setFailure(link,'remote_conflict','provider_draft_remote_changed','The remote draft changed. No deletion was performed.');return}
      op=this.repository.transaction(()=>{
        if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');const fresh=this.repository.link(link.accountId,link.draftId);if(!fresh||fresh.revision!==link.revision||fresh.state!=='discard_queued'||fresh.discardId!==receipt.id)throw new HttpError(409,'Discard ownership changed before claim','provider_draft_revision_conflict');
        const operation=this.repository.insertDeleteOperation(fresh,receipt,source,this.owner,!!current);
        if(!current){this.removeDiscardedLocal(link.accountId,link.draftId,receipt.id);this.repository.pruneSnapshots(link.accountId,link.draftId,null)}return operation;
      });
      if(!current)return;
      await this.io(this.transport.delete(account,link.providerDraftId,controller.signal),controller.signal);this.finishDiscard(op,true);
    }catch(error){if(op&&op.state==='dispatching')this.markUnknown(op);else if(!this.closing)this.setFailure(link,'remote_conflict',error instanceof HttpError?error.code:'provider_draft_discard_blocked','The local discard remains pending. Check the owned remote draft.')}
    finally{deadline.cancel();if(this.aborts.get(link.draftId)===controller)this.aborts.delete(link.draftId)}
  }
  private finishDiscard(operation:ProviderDraftOperation,acknowledged:boolean){
    this.repository.transaction(()=>{
      const op=this.repository.operation(operation.accountId,operation.draftId,operation.id),link=this.repository.link(operation.accountId,operation.draftId);
      if(!link||link.activeOperationId!==op.id||!link.discardId||op.kind!=='delete'||!['dispatching','unknown'].includes(op.state))return;
      const receipt=this.repository.currentDiscard(link);if(receipt.operationId!==op.id)throw new HttpError(500,'Discard receipt identity changed','provider_draft_corrupt');
      this.repository.saveOperation({...op,state:acknowledged?'confirmed':'unknown',resolution:'target-unavailable',completedAt:new Date(this.clock.now()).toISOString(),error:acknowledged?null:op.error});
      this.repository.saveLink({...link,state:'discarded',error:null});this.removeDiscardedLocal(op.accountId,op.draftId,receipt.id);this.repository.pruneSnapshots(op.accountId,op.draftId,null);
    });
  }
  async reconcile(accountId:string,draftId:string,expectedSyncRevision:number):Promise<ProviderDraftReconcileResponse>{
    if(!Number.isSafeInteger(expectedSyncRevision)||expectedSyncRevision<0)providerDraftInvalid();
    if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');
    const work=this.queue.run(accountId,async()=>{
      if(this.closing)throw new HttpError(503,'Cloud draft service is stopping','provider_draft_stopping');
      const link=this.repository.link(accountId,draftId);if(!link)providerDraftMissing();
      if(link.revision!==expectedSyncRevision)throw new HttpError(409,'The cloud draft status changed','provider_draft_revision_conflict');
      const op=link.activeOperationId?this.repository.operation(accountId,draftId,link.activeOperationId):null;
      if(op?.state==='dispatching')throw new HttpError(409,'A cloud write is still in progress','provider_draft_busy');
      const verification:ProviderDraftReconciliation={operationId:op?.id??null,matches:0,scanComplete:false,target:'unknown',content:'unverified',issuedOutcome:op?.issuedAt?op.state==='confirmed'?'confirmed':'unknown':'not-issued'};
      const answer=():ProviderDraftReconcileResponse=>{const snapshot=this.repository.snapshot(accountId,draftId);if((snapshot.operation?.id??null)!==(op?.id??null))throw new HttpError(409,'The checked cloud operation changed','provider_draft_revision_conflict');return{providerDraft:snapshot,verification}};
      if(['consumed','discarded'].includes(link.state)){if(link.state==='discarded')verification.target='unavailable';return answer()}
      if(!op||!['unknown','confirmed'].includes(op.state))return answer();
      const snapshot=this.repository.payload(accountId,draftId,op.id),account=this.repository.account(accountId),controller=new AbortController();
      this.aborts.set(draftId,controller);const deadline=this.clock.schedule(()=>controller.abort(),20000);
      try{
        this.transport.ready(account);
        if((await this.io(this.transport.profile(account,controller.signal),controller.signal)).toLowerCase()!==account.email.toLowerCase())return answer();
        let candidate:GmailDraftResource|undefined;
        if(op.providerDraftId||link.providerDraftId){
          const id=op.providerDraftId??link.providerDraftId!;
          candidate=await this.io(this.transport.get(account,id,true,controller.signal),controller.signal);
          verification.scanComplete=true;verification.target=candidate?'present':'unavailable';
          if(!candidate){if(op.kind==='delete'&&op.state==='unknown'&&op.providerDraftId&&link.providerDraftId===op.providerDraftId&&link.discardId){this.finishDiscard(op,false);verification.target='unavailable'}return answer()}
          if(!validGmailDraft(candidate,true)||candidate.id!==id)return answer();
          verification.matches=1;
        }else{
          let pageToken:string|undefined;const seen=new Set<string>(),matches:{id:string;messageId:string}[]=[];
          for(let page=0;page<2;page++){
            const listing=await this.io(this.transport.list(account,pageToken,controller.signal),controller.signal);
            if(!listing||!Array.isArray(listing.drafts)||listing.drafts.length>25||listing.nextPageToken!==undefined&&(typeof listing.nextPageToken!=='string'||listing.nextPageToken.length>4096))return answer();
            for(const item of listing.drafts){
              if(!item||!validId(item.id)||!item.message||!validId(item.message.id)||seen.has(item.id))return answer();seen.add(item.id);
              const metadata=await this.io(this.transport.metadata(account,item.message.id,controller.signal),controller.signal);
              if(this.metadataMatches(metadata,item.message.id,snapshot,account))matches.push({id:item.id,messageId:item.message.id});
            }
            pageToken=listing.nextPageToken;if(!pageToken){verification.scanComplete=true;break}
          }
          verification.matches=matches.length;if(!verification.scanComplete||matches.length!==1)return answer();
          candidate=await this.io(this.transport.get(account,matches[0].id,true,controller.signal),controller.signal);
          if(!validGmailDraft(candidate,true)||candidate.id!==matches[0].id||candidate.message.id!==matches[0].messageId)return answer();verification.target='present';
        }
        const raw=Buffer.from(candidate.message.raw!,'base64url');
        const equal=await equivalentProviderDraftMime(snapshot,raw,account.email);verification.content=equal?'equivalent':'different';
        if(!equal)return answer();
        if(op.kind==='delete')return answer();
        if(op.state==='unknown'){
          this.acknowledge(op,candidate,true);verification.issuedOutcome='confirmed';
        }else if(link.state==='remote_conflict'&&candidate.id===link.providerDraftId&&candidate.message.id===link.providerMessageId){
          const local=this.repository.draft(accountId,draftId);
          if(local)this.repository.transaction(()=>{const fresh=this.repository.link(accountId,draftId)!;this.repository.saveLink({...fresh,state:fresh.desiredHash===fresh.syncedHash?'synced':'queued',error:null})});
          if(this.repository.link(accountId,draftId)?.state==='queued')this.schedule(accountId,draftId);
        }
        return answer();
      }catch{return answer()}
      finally{deadline.cancel();if(this.aborts.get(draftId)===controller)this.aborts.delete(draftId)}
    });
    return this.trackRead(work);
  }
  private metadataMatches(value:GmailDraftMetadata,id:string,snapshot:ProviderDraftMimeSnapshot,account:Account):boolean{
    if(!value||value.id!==id||!Array.isArray(value.labelIds)||!value.labelIds.includes('DRAFT')||!value.payload||!Array.isArray(value.payload.headers)||value.payload.headers.length>100)return false;
    const headers=value.payload.headers;if(headers.some(h=>!h||typeof h.name!=='string'||typeof h.value!=='string'||h.value.length>16384))return false;
    const single=(name:string)=>{const values=headers.filter(h=>h.name.toLowerCase()===name).map(h=>h.value.replace(/\r\n[ \t]+/g,' ').trim());return values.length===1?values[0]:undefined};
    const from=single('from');if(!from)return false;const senders=addressParser(from);if(senders.length!==1||'group'in senders[0]||senders[0].address.toLowerCase()!==account.email.toLowerCase())return false;
    return single('x-reconstruction-draft-owner')===snapshot.marker.owner&&single('x-reconstruction-draft-operation')===snapshot.marker.operationId&&single('x-reconstruction-draft-revision')===String(snapshot.marker.revision)&&single('x-reconstruction-draft-content-sha256')===snapshot.contentHash;
  }
  private markUnknown(operation:ProviderDraftOperation){
    this.repository.transaction(()=>{
      const owner=this.store.db.prepare('SELECT owner FROM provider_draft_operations WHERE id=?').get(operation.id),op=this.repository.operation(operation.accountId,operation.draftId,operation.id),link=this.repository.link(operation.accountId,operation.draftId);
      if(owner?.owner!==this.owner||op.state!=='dispatching'||!link||link.activeOperationId!==op.id||['discarded','consumed'].includes(link.state))return;
      const error:ProviderDraftError={code:'provider_draft_write_unknown',message:'The cloud write outcome is unknown. Check it before another provider action; it will not repeat automatically.',retry:'explicit-check'};
      this.repository.saveOperation({...op,state:'unknown',error});this.repository.saveLink({...link,state:'outcome_unknown',error});
    });
  }
  async close(){
    if(this.closing){await Promise.allSettled([...this.active.values(),...this.pendingReads]);return}this.closing=true;this.metadataWriter.close();
    for(const timer of this.timers.values())timer.cancel();this.timers.clear();for(const controller of this.aborts.values())controller.abort();
    await Promise.allSettled([...this.active.values(),...this.pendingReads]);owners.delete(this.owner);
  }
}
