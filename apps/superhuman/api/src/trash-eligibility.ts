import type {Store} from './store.ts';
import type {Draft,Thread,DeliveryAttempt} from './types.ts';
import {currentAccountIncarnation} from './account-incarnation.ts';
import {ProviderDraftRepository,type ProviderDraftLink} from './provider-draft-store.ts';
import {AutoDraftFoundation} from './auto-drafts-foundation.ts';
import type {ProviderDraftOperation} from './provider-draft-types.ts';
import {generatedScopeValid,GENERATED_AUTHORED_POLICY} from './generated-draft-policy.ts';
import {createHash} from 'node:crypto';

export type TrashEligibilityScope={accountId:string;accountVersion:string;threadId:string;providerThreadId:string|null};
export type TrashEligibility={eligible:boolean;reason:'clear'|'draft'|'cloud'|'delivery'|'generation'|'unverifiable'};
type Json=Record<string,any>;
type Row={id?:unknown;account_id?:unknown;draft_id?:unknown;revision?:unknown;state?:unknown;data?:unknown;[key:string]:unknown};
const object=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=2048&&!/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v);
const providerId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v);
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const revision=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const parse=(v:unknown):Json|null=>{try{const x=JSON.parse(String(v));return object(x)?x:null}catch{return null}};
const exists=(s:Store,t:string)=>!!s.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(t);
const rows=(s:Store,t:string,accountId:string):Row[]=>exists(s,t)?s.db.prepare(`SELECT * FROM ${t} WHERE account_id=?`).all(accountId):[];
const no=(reason:TrashEligibility['reason']):TrashEligibility=>({eligible:false,reason});
const yes:TrashEligibility=Object.freeze({eligible:true,reason:'clear'});
const sameProvider=(value:unknown,scope:TrashEligibilityScope)=>scope.providerThreadId!==null&&value===scope.providerThreadId;
const relates=(v:Json|null,scope:TrashEligibilityScope)=>!!v&&(v.accountId===scope.accountId||v.account_id===scope.accountId)&&(
 v.threadId===scope.threadId||sameProvider(v.deliveryReplyContext?.providerThreadId,scope)||sameProvider(v.replyContext?.providerThreadId,scope)||sameProvider(v.providerThreadId,scope)||sameProvider(v.result?.providerThreadId,scope)||v.generated?.scope?.threadId===scope.threadId||v.publicationScope?.threadId===scope.threadId);

/** Read-only facades deliberately bypass constructors, which install schema or
 * recovery. Only the existing reviewed read validators listed here are used:
 * ProviderDraftRepository.link/operation/currentDiscard/discardByRequest and
 * AutoDraftFoundation.job/basis. No mutator, constructor, clock or recovery is called. */
function readers(store:Store){return{
 cloud:Object.assign(Object.create(ProviderDraftRepository.prototype),{store,now:Date.now}) as ProviderDraftRepository,
 generation:Object.assign(Object.create(AutoDraftFoundation.prototype),{store}) as AutoDraftFoundation,
}}
function publicationThread(store:Store,row:Row,value:Json,accountId:string):string{
 const read=readers(store),job=read.generation.job(accountId,String(row.job_id)),basis=read.generation.basis(accountId,String(row.job_id));
 const proof=exists(store,'auto_draft_worker_publication_proofs')?store.db.prepare('SELECT digest FROM auto_draft_worker_publication_proofs WHERE job_id=?').get(row.job_id as string):null;
 if(row.integrity!==hash(value)||proof?.digest!==row.integrity||row.account_id!==accountId||value.accountId!==accountId||row.job_id!==value.jobId||row.target_ref!==value.targetRef||!id(value.draftId)||!id(basis.threadId)||!revision(value.guardVersion)||value.guardVersion<1||!['targetVersion','authoredHash','contentHash'].every(key=>/^[a-f0-9]{64}$/.test(value[key]))||job.state!=='published'||value.targetRef!==job.publication?.targetRef||value.targetVersion!==job.publication?.targetVersion||value.contentHash!==job.publication?.contentHash)throw Error('Associated draft authority is unavailable');
 if(value.identityPolicy!==undefined){const scope=value.publicationScope,persisted=store.db.prepare('SELECT proof FROM auto_draft_jobs WHERE account_id=? AND id=?').get(accountId,job.id),owned=persisted?parse(persisted.proof):null;if(value.identityPolicy!==GENERATED_AUTHORED_POLICY||!generatedScopeValid(scope)||scope.accountId!==accountId||scope.accountVersion!==basis.accountVersion||scope.threadId!==basis.threadId||scope.generationId!==job.id||scope.attemptRef!==job.attempt?.ref||scope.leaseId!==owned?.leaseId||value.targetVersion!==hash({draftId:value.draftId,guardVersion:value.guardVersion,identityPolicy:value.identityPolicy,authoredHash:value.authoredHash})||value.cloudEnrollment!==null&&(!object(value.cloudEnrollment)||!/^[a-f0-9]{64}$/.test(value.cloudEnrollment.ownerFingerprint)))throw Error('Associated draft authority is unavailable')}
 else if(value.publicationScope!==undefined||value.cloudEnrollment!==undefined)throw Error('Associated draft authority is unavailable');
 return basis.threadId;
}
function draftValid(d:Json,rowId:string,accountId:string):d is Draft{
 return d.id===rowId&&d.accountId===accountId&&id(d.id)&&
  (d.threadId===undefined||id(d.threadId))&&
  ['draft','failed','send_queued','scheduled','sending','delivery_held','delivery_unknown','sent'].includes(d.status)&&
  (d.revision===undefined||revision(d.revision))&&iso(d.updatedAt)&&
  ['artifactSendId','composerSendId','deliveryAttemptId'].every(k=>d[k]===undefined||id(d[k]))&&
  (d.providerDraftId===undefined||providerId(d.providerDraftId))&&
  (d.deliveryReplyContext===undefined||object(d.deliveryReplyContext)&&(d.deliveryReplyContext.providerThreadId===undefined||providerId(d.deliveryReplyContext.providerThreadId)));
}
function guardValid(v:Json,row:Row,accountId:string):boolean{
 return v.draftId===row.draft_id&&v.accountId===accountId&&id(v.draftId)&&(v.threadId===null||id(v.threadId))&&revision(v.version)&&v.version>=1&&[null,'removed','discard-intent','delivery-owned'].includes(v.fence)&&iso(v.at);
}
function sendValid(row:Row,v:Json,accountId:string){
 return v.id===row.id&&v.accountId===accountId&&v.draftId===row.draft_id&&v.state===row.state&&id(v.id)&&id(v.draftId)&&
  ['queued','held_before_provider','sending','sent','not_dispatched','outcome_unknown','cancelled'].includes(v.state)&&
  revision(v.revision)&&revision(v.generation)&&v.generation===row.generation&&id(row.owner)&&Number.isSafeInteger(row.owner_pid)&&Number(row.owner_pid)>0&&v.clientRequestId===row.client_key&&id(v.clientRequestId)&&
  /^[a-f0-9]{64}$/.test(String(row.fingerprint))&&/^[a-f0-9]{64}$/.test(String(row.content_hash))&&typeof row.sender_email==='string'&&row.sender_email.length>0&&iso(v.createdAt)&&
  (row.draft_revision===undefined||row.draft_revision===v.draftRevision&&v.contentHash===row.content_hash)&&
  ['sessionId','turnId','previewId','creationId'].every(key=>row[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]===undefined||v[key]===row[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]&&id(v[key]))&&
  (v.startedAt===null||iso(v.startedAt))&&(v.confirmedAt===null||iso(v.confirmedAt))&&
  (v.deliveryAttemptId===null||id(v.deliveryAttemptId))&&(v.providerMessageId===null||providerId(v.providerMessageId));
}
function attemptValid(value:Json,rowId:string,draftId:string):value is DeliveryAttempt{
 return value.id===rowId&&value.draftId===draftId&&id(value.id)&&['not_issued','dispatching','unknown','sent'].includes(value.status)&&iso(value.startedAt)&&
  (value.completedAt===undefined||iso(value.completedAt)&&Date.parse(value.completedAt)>=Date.parse(value.startedAt))&&(value.providerMessageId===undefined||providerId(value.providerMessageId));
}
function sentDraft(store:Store,draft:Draft,sendRows:Row[],cloud:ProviderDraftLink|undefined):boolean{
 if(draft.status!=='sent'||!id(draft.deliveryAttemptId)||!providerId(draft.providerMessageId))return false;
 const raw=store.db.prepare("SELECT data FROM records WHERE kind='delivery' AND id=?").get(draft.deliveryAttemptId),attempt=raw?parse(raw.data):null;
 if(!attempt||!attemptValid(attempt,draft.deliveryAttemptId,draft.id)||attempt.status!=='sent'||attempt.providerMessageId!==draft.providerMessageId||!iso(attempt.completedAt)||attempt.completedAt!==draft.updatedAt)return false;
 for(const key of ['composerSendId','artifactSendId']as const){const expected=draft[key];if(!expected)continue;const row=sendRows.find(r=>r.id===expected),op=row?parse(row.data):null;if(!row||!op||!sendValid(row,op,draft.accountId)||op.state!=='sent'||op.deliveryAttemptId!==attempt.id||op.providerMessageId!==draft.providerMessageId||op.confirmedAt!==attempt.completedAt||op.startedAt!==attempt.startedAt||Date.parse(op.createdAt)>Date.parse(attempt.startedAt))return false}
 return !cloud||cloud.state==='consumed';
}
function terminalNoSend(store:Store,table:'draft_send_operations'|'ai_draft_sends',row:Row,value:Json):boolean{
 if(value.deliveryAttemptId!==null||value.providerMessageId!==null||value.startedAt!==null||value.confirmedAt!==null)return false;
 if(value.state==='not_dispatched')return value.cancelledAt===null&&object(value.error)&&typeof value.error.code==='string'&&typeof value.error.message==='string'&&value.error.providerOutcome==='not_dispatched'&&value.error.retry==='none';
 if(value.state!=='cancelled'||!iso(value.cancelledAt)||!revision(value.cancelledFromRevision))return false;
 const cancellations=table==='draft_send_operations'?'draft_send_cancellations':'ai_draft_send_cancellations';
 if(!exists(store,cancellations))return false;
 return store.db.prepare(`SELECT * FROM ${cancellations} WHERE operation_id=? AND account_id=?`).all(row.id as string,row.account_id as string).some(r=>{const c=parse(r.data);if(!c||c.id!==r.id||!id(c.id)||c.operationId!==value.id||c.accountId!==value.accountId||c.clientRequestId!==r.client_key||!id(c.clientRequestId)||!iso(c.createdAt))return false;const scope=table==='ai_draft_sends'?{accountId:value.accountId,sessionId:value.sessionId,turnId:value.turnId}:{accountId:value.accountId};if(table==='ai_draft_sends'?(c.sessionId!==value.sessionId||c.turnId!==value.turnId||r.session_id!==value.sessionId||r.turn_id!==value.turnId):(c.draftId!==value.draftId||r.draft_id!==value.draftId))return false;return[value.cancelledFromRevision,value.revision].some(expectedRevision=>r.fingerprint===hash({kind:table==='ai_draft_sends'?'cancel':'composer-cancel',...scope,operationId:value.id,expectedRevision}))});
}

/** Current local ownership predicate only. Every SQL statement is a read; a true
 * result is intentionally not a permission that can be cached across an await. */
export function trashDraftEligibility(store:Store,scope:TrashEligibilityScope):TrashEligibility{
 try{
  const thread=store.get<Thread>('thread',scope.threadId);
  if(!id(scope.accountId)||!id(scope.threadId)||scope.providerThreadId!==null&&!providerId(scope.providerThreadId)||!/^([a-f0-9]{64})$/.test(scope.accountVersion)||currentAccountIncarnation(store,scope.accountId)!==scope.accountVersion||!thread||thread.id!==scope.threadId||thread.accountId!==scope.accountId||(thread.providerId??null)!==scope.providerThreadId)return no('unverifiable');
  const read=readers(store),draftRows=store.db.prepare("SELECT id,data FROM records WHERE kind='draft'").all(),drafts=new Map<string,{row:Row;value:Json|null}>();
  for(const row of draftRows)drafts.set(String(row.id),{row,value:parse(row.data)});
  const links=rows(store,'provider_draft_links',scope.accountId),operations=rows(store,'provider_draft_operations',scope.accountId),guards=rows(store,'auto_draft_mutation_guards',scope.accountId),publications=rows(store,'auto_draft_worker_publications',scope.accountId);
  const sends=[...rows(store,'draft_send_operations',scope.accountId).map(row=>({row,table:'draft_send_operations' as const})),...rows(store,'ai_draft_sends',scope.accountId).map(row=>({row,table:'ai_draft_sends' as const}))],related=new Set<string>();
  for(const[key,{value}]of drafts)if(relates(value,scope))related.add(key);
  for(const row of [...links,...operations,...guards,...publications]){const v=parse(row.data);if(relates(v?{...v,account_id:row.account_id}:null,scope)&&id(row.draft_id??v?.draftId))related.add(String(row.draft_id??v!.draftId))}
  const jobs=exists(store,'auto_draft_jobs')?store.db.prepare(`SELECT j.id,a.data AS acceptance,i.id AS ingress_id,i.thread_id AS ingress_thread FROM auto_draft_jobs j LEFT JOIN auto_draft_job_acceptance a ON a.id=j.id LEFT JOIN auto_draft_ingress i ON i.account_id=j.account_id AND i.account_version=j.account_version AND i.source_ref=j.source_ref AND i.input_version=j.input_version WHERE j.account_id=? AND (i.thread_id=? OR CASE WHEN json_valid(a.data) THEN json_extract(a.data,'$.basis.threadId') END=?)`).all(scope.accountId,scope.threadId,scope.threadId):[];
  for(const row of jobs){const g=read.generation.job(scope.accountId,String(row.id)),acceptance=parse(row.acceptance);if(!acceptance||acceptance.basis?.threadId!==row.ingress_thread||acceptance.ingressId!==row.ingress_id)return no('unverifiable');if(['queued','claimed','dispatch-issued'].includes(g.state))return no('generation');if(g.state==='published'){const pub=publications.find(r=>r.job_id===row.id),v=pub?parse(pub.data):null;if(!pub||!v||publicationThread(store,pub,v,scope.accountId)!==row.ingress_thread)return no('unverifiable');related.add(v.draftId)}}
  for(const draftId of related){
   const entry=drafts.get(draftId),draft=entry?.value;
   for(const row of publications){const v=parse(row.data);if(v?.draftId===draftId)publicationThread(store,row,v,scope.accountId)}
   if(draft&&(!entry||!draftValid(draft,String(entry.row.id),scope.accountId)))return no('unverifiable');
   const guardRow=guards.find(r=>r.draft_id===draftId),guard=guardRow?parse(guardRow.data):null;
   if(guardRow&&(!guard||!guardValid(guard,guardRow,scope.accountId)))return no('unverifiable');
   const linkRow=links.find(r=>r.draft_id===draftId),link=linkRow?read.cloud.link(scope.accountId,draftId):undefined;
   const ops:ProviderDraftOperation[]=[];for(const row of operations.filter(r=>r.draft_id===draftId)){const op=read.cloud.operation(scope.accountId,draftId,String(row.id));ops.push(op);if(['queued','dispatching','unknown'].includes(op.state)||op.issuedAt!==null&&!['confirmed'].includes(op.state))return no('cloud')}
   if(link?.activeOperationId&&!ops.some(op=>op.id===link.activeOperationId))return no('unverifiable');
   if(link?.state==='consumed'&&(link.providerDraftId!==null||link.providerMessageId!==null||link.providerThreadId!==null)){const active=ops.find(op=>op.id===link.activeOperationId);if(!active||active.state!=='confirmed'||!['create','update'].includes(active.kind)||active.resolution!=='matching-snapshot'||!active.result||active.result.providerDraftId!==link.providerDraftId||active.result.providerMessageId!==link.providerMessageId||active.result.providerThreadId!==link.providerThreadId||draft?.providerDraftId!==link.providerDraftId)return no('unverifiable')}
   if(link&&!['consumed','discarded'].includes(link.state))return no('cloud');
   const ownedSends=sends.filter(({row})=>row.draft_id===draftId);
   for(const{row,table}of ownedSends){const op=parse(row.data);if(!op||!sendValid(row,op,scope.accountId))return no('unverifiable');if(['queued','held_before_provider','sending','outcome_unknown'].includes(op.state))return no('delivery');if(op.state==='sent'){if(!draft||!sentDraft(store,draft as Draft,ownedSends.map(v=>v.row),link)||op.deliveryAttemptId!==draft.deliveryAttemptId||op.providerMessageId!==draft.providerMessageId)return no('unverifiable')}else if(!terminalNoSend(store,table,row,op))return no('unverifiable')}
   const attempts=store.db.prepare("SELECT id,data FROM records WHERE kind='delivery' AND CASE WHEN json_valid(data) THEN json_extract(data,'$.draftId') END=?").all(draftId);
   for(const row of attempts){const a=parse(row.data);if(!a||!attemptValid(a,String(row.id),draftId))return no('unverifiable');if(a.status!=='sent')return no('delivery');if(!draft||!sentDraft(store,draft as Draft,ownedSends.map(v=>v.row),link)||a.id!==draft.deliveryAttemptId||a.providerMessageId!==draft.providerMessageId)return no('unverifiable')}
   if(draft){if(draft.status!=='sent')return no('draft');if(!sentDraft(store,draft as Draft,ownedSends.map(v=>v.row),link))return no('unverifiable')}
   else if(entry)return no('unverifiable');
   else if(link?.state==='discarded'){
    if(!link.discardId||!exists(store,'provider_draft_discards'))return no('unverifiable');
    const receipt=read.cloud.currentDiscard(link),result=read.cloud.discardByRequest(scope.accountId,draftId,receipt.clientRequestId);
    if(result.resolution==='pending'||!ops.some(op=>op.id===receipt.operationId&&op.kind==='delete'&&op.state==='confirmed'&&op.resolution==='target-unavailable'))return no('unverifiable');
   }else if(!guard||guard.fence!=='removed'||link)return no('unverifiable');
  }
  return yes;
 }catch{return no('unverifiable')}
}

/** Exact reciprocal-lock targets for a Draft insertion, rebind or metadata
 * publication. Both old and next identities matter; content similarity does not. */
export function draftAffectedThreadIds(store:Store,before?:Draft,next?:Draft):Array<{accountId:string;threadId:string}>{
 const targets=new Map<string,{accountId:string;threadId:string}>();
 const add=(accountId:unknown,threadId:unknown)=>{if(id(accountId)&&id(threadId))targets.set(JSON.stringify([accountId,threadId]),{accountId,threadId})};
 const provider=(accountId:string,value:unknown)=>{if(value===undefined||value===null)return;if(!providerId(value))throw Error('Associated draft authority is unavailable');for(const row of store.db.prepare("SELECT id FROM records WHERE kind='thread' AND CASE WHEN json_valid(data) THEN json_extract(data,'$.accountId') END=? AND CASE WHEN json_valid(data) THEN json_extract(data,'$.providerId') END=?").all(accountId,value))add(accountId,row.id)};
 const read=readers(store);
 for(const draft of [before,next]){if(!draft)continue;if(!id(draft.accountId)||!id(draft.id)||draft.threadId!==undefined&&!id(draft.threadId)||draft.deliveryReplyContext!==undefined&&!object(draft.deliveryReplyContext))throw Error('Associated draft authority is unavailable');add(draft.accountId,draft.threadId);provider(draft.accountId,draft.deliveryReplyContext?.providerThreadId);
  for(const table of ['provider_draft_links','provider_draft_operations','auto_draft_mutation_guards'])if(exists(store,table))for(const row of store.db.prepare(`SELECT * FROM ${table} WHERE account_id=? AND draft_id=?`).all(draft.accountId,draft.id)){const v=parse(row.data);if(!v||v.accountId!==draft.accountId||v.draftId!==draft.id)throw Error('Associated draft authority is unavailable');try{if(table==='provider_draft_links')read.cloud.link(draft.accountId,draft.id);else if(table==='provider_draft_operations')read.cloud.operation(draft.accountId,draft.id,String(row.id));else if(!guardValid(v,row,draft.accountId))throw Error()}catch{throw Error('Associated draft authority is unavailable')}add(draft.accountId,v.threadId);add(draft.accountId,v.generated?.scope?.threadId);provider(draft.accountId,v.replyContext?.providerThreadId);provider(draft.accountId,v.providerThreadId);provider(draft.accountId,v.result?.providerThreadId)}
  if(exists(store,'auto_draft_worker_publications'))for(const row of store.db.prepare('SELECT * FROM auto_draft_worker_publications WHERE account_id=?').all(draft.accountId)){const v=parse(row.data);if(v?.draftId===draft.id)add(draft.accountId,publicationThread(store,row,v,draft.accountId))}
 }
 return [...targets.values()].sort((a,b)=>a.accountId.localeCompare(b.accountId)||a.threadId.localeCompare(b.threadId));
}
