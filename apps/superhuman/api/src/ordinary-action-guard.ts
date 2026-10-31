import type {Store} from './store.ts';
import type {Draft,Thread,Account,DeliveryAttempt} from './types.ts';
import {HttpError} from './types.ts';
import {trashHash,trashFail,trashRequestFingerprint} from './trash-action-contract.ts';
import {draftAffectedThreadIds} from './trash-eligibility.ts';

export type OrdinaryOwner={kind:'archive'|'trash';accountId:string;accountVersion:string;key:string;integrity?:string;purpose?:'forward'|'inverse'|'rollback'};
type Lock=OrdinaryOwner&{threadId:string;locked:boolean;undoId:string|null;integrity:string};
const terminal=['confirmed','refused'];
/** Persisted conflict checks, independent of account FIFO and optional owners.
 * Synchronous permits cannot span an await and can bypass only their own row. */
export class OrdinaryActionGuard{
 private permits:OrdinaryOwner[]=[];
 private readonly observations=new WeakMap<object,{threadId:string;fingerprint:string}>();
 readonly store:Store;
 constructor(store:Store){this.store=store}
 private table(name:string){return !!this.store.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)}
 private locks(threadId?:string):Lock[]{
  const out:Lock[]=[];
  for(const kind of ['archive','trash'] as const){const table=kind==='archive'?'archive_action_operations':'trash_action_operations';if(!this.table(table))continue;
   const rows=threadId===undefined?this.store.db.prepare(`SELECT * FROM ${table}`).all():this.store.db.prepare(`SELECT * FROM ${table} WHERE thread_id=?`).all(threadId);
   for(const row of rows){let r:any;try{r=JSON.parse(String(row.data))}catch{trashFail('trash_corrupt',500)}
    if(!r||kind==='trash'&&(!['accepted','prepared','issued','confirmed','unknown','refused'].includes(r.stage)||r.revision!==row.revision||r.sequence!==row.sequence||r.fingerprint!==trashRequestFingerprint(r.threadId,r.request)||r.undo?.request.clientRequestId!==(row.undo_request_id??undefined))||trashHash(r)!==row.integrity||r.threadId!==row.thread_id||r.request?.accountId!==row.account_id||r.request?.accountVersion!==row.account_version||r.request?.clientRequestId!==row.request_id)trashFail('trash_corrupt',500);
    const phase=kind==='archive'?r.state:r.stage,u=kind==='archive'?r.undo?.state:r.undo?.stage;
    const locked=kind==='archive'?['pending','issued','unknown'].includes(phase)||phase==='refused'&&r.undoId!==null||u&&['pending','issued','unknown'].includes(u):!terminal.includes(phase)||phase==='refused'&&r.undoId!==null||u&&!terminal.includes(u);
    out.push({kind,accountId:String(row.account_id),accountVersion:String(row.account_version),key:String(row.request_id),threadId:String(row.thread_id),locked:!!locked,undoId:r.undoId??null,integrity:String(row.integrity)});
   }
  }
  return out;
 }
 private owns(lock:Lock){return this.permits.some(p=>p.kind===lock.kind&&p.accountId===lock.accountId&&p.accountVersion===lock.accountVersion&&p.key===lock.key&&(lock.kind!=='trash'||p.integrity===lock.integrity))}
 run<T>(owner:OrdinaryOwner,work:()=>T):T{this.permits.push({...owner});try{const result=work();if(result&&typeof(result as any).then==='function')throw Error('Ordinary mutation permits must be synchronous');return result}finally{this.permits.pop()}}
 /** Genuine provider read publication may invalidate an operation's source, but
  * cannot admit a Draft/native mutation or clear the persisted lock. */
 registerObservationProducer(){const mint=(threadId:string,value:Thread|null)=>{const permit={};this.observations.set(permit,{threadId,fingerprint:trashHash(value)});return permit};return{publish:(thread:Thread)=>mint(thread.id,thread),missing:(threadId:string)=>mint(threadId,null)}}
 assertAvailable(threadId:string){if(this.locks(threadId).some(l=>l.locked&&!this.owns(l)))throw new HttpError(409,'A conversation action is unconfirmed','ordinary_action_locked')}
 assertTrashAvailable(threadId:string){if(this.locks(threadId).some(l=>l.kind==='trash'&&l.locked&&!this.owns(l)))throw new HttpError(409,'Trash owns this conversation until its outcome is known','ordinary_action_locked')}
 ownsTrashUndo(id:string){return this.locks().some(l=>l.kind==='trash'&&l.undoId===id)}
 assertUndo(id:string){const linked=this.locks().find(l=>l.kind==='trash'&&l.undoId===id);if(linked&&(!this.owns(linked)||!this.permits.some(p=>p.kind==='trash'&&p.key===linked.key&&p.integrity===linked.integrity&&['inverse','rollback'].includes(p.purpose??''))))throw new HttpError(409,'Use the scoped Trash Undo','trash_keyed_undo_required')}
 assertAccount(before:Account|undefined,next:Account|undefined){if(!before)return;if(next&&before.id===next.id&&before.provider===next.provider&&before.email.toLowerCase()===next.email.toLowerCase())return;if(this.locks().some(l=>l.kind==='trash'&&l.accountId===before.id&&l.locked&&!this.owns(l)))throw new HttpError(409,'An unresolved Trash operation owns this account identity','ordinary_action_locked')}
 assertThread(before:Thread|undefined,next:Thread|undefined,permit?:object){const observation=permit?this.observations.get(permit):undefined;if(permit)this.observations.delete(permit);if(observation&&observation.threadId===(next?.id??before?.id)&&observation.fingerprint===trashHash(next??null))return;const ids=new Set([before?.id,next?.id].filter((v):v is string=>!!v));for(const id of ids){if(!this.locks(id).some(l=>l.kind==='trash'&&l.locked&&!this.owns(l)))continue;const relevant=(t:Thread|undefined)=>t?{id:t.id,accountId:t.accountId,providerId:t.providerId,folder:t.folder,providerLabels:[...(t.providerLabels??[])].sort(),labels:[...t.labels].sort(),snoozedUntil:t.snoozedUntil,snoozeRetryAt:t.snoozeRetryAt,snoozeError:t.snoozeError,messages:t.messages.map(m=>({id:m.id,date:m.date,from:m.sender.email,to:m.to.map(p=>p.email),cc:m.cc?.map(p=>p.email),internetMessageId:m.internetMessageId,references:m.references,text:m.text,html:m.html,attachments:m.attachments}))}:null;
   if(trashHash(relevant(before))!==trashHash(relevant(next)))this.assertTrashAvailable(id);
  }}
 private safetySettlement(before:Draft|undefined,next:Draft){
  if(!before||before.id!==next.id||before.accountId!==next.accountId||before.threadId!==next.threadId||before.artifactSendId!==next.artifactSendId||before.composerSendId!==next.composerSendId||before.deliveryAttemptId!==next.deliveryAttemptId)return false;
  const authored=(d:Draft)=>({id:d.id,accountId:d.accountId,threadId:d.threadId,to:d.to,cc:d.cc,bcc:d.bcc,subject:d.subject,body:d.body,html:d.html,attachments:d.attachments,providerDraftId:d.providerDraftId,deliveryReplyContext:d.deliveryReplyContext,revision:d.revision});
  if(trashHash(authored(before))!==trashHash(authored(next)))return false;
  if(next.status==='sent'&&['sending','delivery_unknown','delivery_held','sent'].includes(before.status)&&next.deliveryAttemptId&&next.providerMessageId){const a=this.store.get<DeliveryAttempt>('delivery',next.deliveryAttemptId);return !!a&&a.draftId===next.id&&a.status==='sent'&&a.providerMessageId===next.providerMessageId&&!!a.completedAt}
  return next.status==='delivery_unknown'&&['sending','delivery_unknown','delivery_held'].includes(before.status)||next.status==='delivery_held'&&['send_queued','scheduled','sending','delivery_held'].includes(before.status);
 }
 private assertDraftThread(threadId:string){if(this.locks(threadId).some(l=>l.kind==='trash'&&l.locked))throw new HttpError(409,'Trash owns this conversation until its outcome is known','ordinary_action_locked')}
 assertDraft(before:Draft|undefined,next:Draft){if(!this.locks().some(l=>l.kind==='trash'&&l.locked))return;if(this.safetySettlement(before,next))return;for(const scope of draftAffectedThreadIds(this.store,before,next))this.assertDraftThread(scope.threadId)}
 assertDraftActivation(draft:Draft){if(!this.locks().some(l=>l.kind==='trash'&&l.locked))return;for(const scope of draftAffectedThreadIds(this.store,undefined,draft))this.assertDraftThread(scope.threadId)}
 assertDelivery(before:DeliveryAttempt|undefined,next:DeliveryAttempt){if(next.status==='dispatching'&&before?.status!=='dispatching'){const d=this.store.get<Draft>('draft',next.draftId);if(d)this.assertDraftActivation(d)}}
 assertGeneration(accountId:string,threadId:string){const t=this.store.get<Thread>('thread',threadId);if(t?.accountId===accountId)this.assertDraftThread(threadId)}
}
