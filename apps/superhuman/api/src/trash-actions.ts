import type {Store} from './store.ts';
import type {GoogleProvider} from './google.ts';
import {OperationQueue} from './operation-queue.ts';
import {credentialGrantMutationEpoch} from './google-credential-maintenance.ts';
import {currentAccountIncarnation} from './account-incarnation.ts';
import {verifiedActionBasis} from './archive-action-basis.ts';
import {HttpError,type Thread,type Account} from './types.ts';
import {trashDraftEligibility} from './trash-eligibility.ts';
import {parseTrashRequest,parseTrashUndo,trashFail,trashHash,trashStable,trashRequestFingerprint,trashUndoFingerprint,trashHex,trashKey,trashId,type TrashRequest,type TrashUndoRequest,type TrashEnvelope,type TrashState,type TrashReason,type TrashNativeStatus} from './trash-action-contract.ts';
import {googleTrashNative,trashCachedMessages,trashLabelSet,validateTrashObservation,type TrashNative,type TrashObservation,type TrashObservedMessage,type TrashNativeInput} from './trash-action-google.ts';

type Stage='accepted'|'prepared'|'issued'|'confirmed'|'unknown'|'refused';
type Plan={before:TrashObservedMessage[];after:TrashObservedMessage[];add:string[];remove:string[]};
type Evidence={issuedAt:string|null;ack:{providerThreadId:string;at:string}|null;effect:TrashObservation|null};
type Inverse=Evidence&{request:TrashUndoRequest;fingerprint:string;stage:Stage;reason:TrashReason|null;sourceVersion:string;plan:Plan|null};
type RecordValue=Evidence&{version:1;threadId:string;request:TrashRequest;fingerprint:string;stage:Stage;reason:TrashReason|null;revision:number;sequence:number;createdAt:string;undoId:string|null;undoProof:string|null;sourceVersion:string|null;providerThreadId:string|null;grantVersion:string|null;mode:'google'|'local';cached:TrashObservedMessage[];plan:Plan|null;undo:Inverse|null};
const stages=['accepted','prepared','issued','confirmed','unknown','refused'];
const reasonCodes:TrashReason[]=['trash_source_changed','trash_account_changed','trash_grant_changed','trash_ineligible','trash_source_limit','trash_no_change','trash_native_scope','trash_native_unconfirmed','trash_effect_unconfirmed','trash_local_conflict','trash_stopping','trash_undo_expired','trash_undo_unavailable'];
const terminal=(s:Stage)=>s==='confirmed'||s==='refused';
const state=(s:Stage):TrashState=>s==='issued'?'unknown':terminal(s)||s==='unknown'?s:'pending';
const stamp=(n:number)=>new Date(n).toISOString();
const sameSource=(a:TrashObservedMessage[],b:TrashObservedMessage[])=>trashHash(a.map(m=>({id:m.id,sourceHash:m.sourceHash})))===trashHash(b.map(m=>({id:m.id,sourceHash:m.sourceHash})));
const sameLabels=(a:TrashObservedMessage[],b:TrashObservedMessage[])=>trashHash(a)===trashHash(b);
function applyLabels(before:TrashObservedMessage[],add:string[],remove:string[]){return before.map(m=>({...m,labels:trashLabelSet([...m.labels.filter(l=>!remove.includes(l)),...add])}))}
function uniform(messages:TrashObservedMessage[],label:string){const values=messages.map(m=>m.labels.includes(label));if(values.some(x=>x!==values[0]))trashFail('trash_native_scope');return values[0]!}
function noDraft(messages:TrashObservedMessage[]){if(messages.some(m=>m.labels.includes('DRAFT')))trashFail('trash_ineligible')}

/** Separate keyed Trash protocol. Construction only creates its empty ledger.
 * No dispatch/recovery loop; a saved pending/unknown key is observation-only. */
export class TrashActionService{
 readonly store:Store;readonly queue:OperationQueue;readonly native:TrashNative;readonly now:()=>number;
 private stopped=false;private readonly abort=new AbortController();private readonly versions=new WeakMap<RecordValue,{revision:number;integrity:string}>();
 constructor(store:Store,google:GoogleProvider,queue:OperationQueue,options:{native?:TrashNative;now?:()=>number}={}){
  this.store=store;this.queue=queue;this.native=options.native??googleTrashNative(google,store,options.now??Date.now);this.now=options.now??Date.now;
  store.db.exec('SAVEPOINT trash_service_schema');try{store.db.exec(`CREATE TABLE IF NOT EXISTS trash_action_operations(account_id TEXT NOT NULL,account_version TEXT NOT NULL CHECK(length(account_version)=64),request_id TEXT NOT NULL,thread_id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>0 AND sequence<=9007199254740991),revision INTEGER NOT NULL CHECK(revision>0 AND revision<=9007199254740991),undo_request_id TEXT,data TEXT NOT NULL CHECK(json_valid(data)),integrity TEXT NOT NULL CHECK(length(integrity)=64),PRIMARY KEY(account_id,account_version,request_id),UNIQUE(account_id,sequence),UNIQUE(account_id,account_version,undo_request_id));CREATE INDEX IF NOT EXISTS trash_action_scope ON trash_action_operations(thread_id);`);store.db.exec('RELEASE trash_service_schema')}catch(error){store.db.exec('ROLLBACK TO trash_service_schema;RELEASE trash_service_schema');throw error}
 }
 close(){this.stopped=true;this.abort.abort()}
 private open(){if(this.stopped)trashFail('trash_stopping',503)}
 private owner(r:RecordValue){return{kind:'trash' as const,accountId:r.request.accountId,accountVersion:r.request.accountVersion,key:r.request.clientRequestId}}
 private own<T>(r:RecordValue,work:()=>T,purpose:'forward'|'inverse'|'rollback'='forward'):T{return this.store.ordinaryActions.run({...this.owner(r),integrity:this.versions.get(r)?.integrity,purpose},work)}
 private tx<T>(work:()=>T):T{this.store.db.exec('SAVEPOINT trash_transition');try{const v=work();this.store.db.exec('RELEASE trash_transition');return v}catch(e){this.store.db.exec('ROLLBACK TO trash_transition;RELEASE trash_transition');throw e}}
 private row(accountId:string,accountVersion:string,key:string):RecordValue|null{
  const row=this.store.db.prepare('SELECT * FROM trash_action_operations WHERE account_id=? AND account_version=? AND request_id=?').get(accountId,accountVersion,key);if(!row)return null;
  try{const r=JSON.parse(String(row.data)) as RecordValue;parseTrashRequest(r.request);if(r.version!==1||r.threadId!==row.thread_id||r.request.accountId!==accountId||r.request.accountVersion!==accountVersion||r.request.clientRequestId!==key||r.fingerprint!==trashRequestFingerprint(r.threadId,r.request)||trashHash(r)!==row.integrity||r.revision!==row.revision||r.sequence!==row.sequence||!Number.isSafeInteger(r.revision)||!Number.isSafeInteger(r.sequence)||!stages.includes(r.stage)||!['google','local'].includes(r.mode)||r.undoId!==null&&!trashKey(r.undoId)||r.sourceVersion!==null&&!trashHex(r.sourceVersion)||r.undoProof!==null&&!trashHex(r.undoProof)||r.reason!==null&&!reasonCodes.includes(r.reason)||!Array.isArray(r.cached)||r.undo?.request.clientRequestId!==(row.undo_request_id??undefined))throw Error();
   if(r.undo){parseTrashUndo(r.undo.request);if(r.undo.request.accountId!==accountId||r.undo.request.accountVersion!==accountVersion||r.undo.fingerprint!==trashUndoFingerprint(r.threadId,r.request.clientRequestId,r.undo.request)||!stages.includes(r.undo.stage)||r.undo.reason!==null&&!reasonCodes.includes(r.undo.reason))throw Error()}
   for(const e of [r,...r.undo?[r.undo]:[]]){if(e.issuedAt!==null&&!Number.isFinite(Date.parse(e.issuedAt))||e.ack&&(!e.issuedAt||e.ack.providerThreadId!==r.providerThreadId||!Number.isFinite(Date.parse(e.ack.at)))||e.effect&&(!e.ack||!e.issuedAt)||e.stage==='issued'&&!e.issuedAt||e.stage==='unknown'&&!e.issuedAt)throw Error()}
   if(r.mode==='local'&&(r.plan!==null||r.issuedAt!==null||r.ack!==null||r.effect!==null||r.cached.length!==0))throw Error();
   if(r.sourceVersion!==null&&r.undoProof===null||r.sourceVersion===null&&r.undoProof!==null||r.undo&&!r.undoId||r.sourceVersion===null&&(r.undoId!==null||r.stage!=='refused')||r.issuedAt!==null&&(r.sourceVersion===null||!r.undoId||!r.plan))throw Error();
   const checked=(messages:TrashObservedMessage[])=>{const v=validateTrashObservation({providerThreadId:r.providerThreadId!,messages,profileEmail:null,observedAt:r.createdAt},{accountId,providerThreadId:r.providerThreadId!}).messages;if(trashHash(v)!==trashHash(messages))throw Error();return v};
   if(r.mode==='google'&&r.cached.length)checked(r.cached);
   for(const e of [r,...r.undo?[r.undo]:[]]){
    if(e.plan){checked(e.plan.before);checked(e.plan.after);if(!sameSource(e.plan.before,e.plan.after)||trashHash(applyLabels(e.plan.before,e.plan.add,e.plan.remove))!==trashHash(e.plan.after)||e.plan.add.some(l=>!['INBOX','TRASH'].includes(l))||e.plan.remove.some(l=>!['INBOX','TRASH'].includes(l))||e.plan.add.some(l=>e.plan!.remove.includes(l)))throw Error()}
    if(e.effect){validateTrashObservation(e.effect,{accountId,providerThreadId:r.providerThreadId!});if(!e.plan||!sameLabels(e.effect.messages,e.plan.after))throw Error()}
    if(r.mode==='google'&&e.stage==='confirmed'&&(!e.ack||!e.effect||!e.plan))throw Error();
   }
   if(r.plan&&(trashHash(r.plan.before)!==trashHash(r.cached)||trashHash(r.plan.add)!==trashHash(['TRASH'])||trashHash(r.plan.remove)!==trashHash(uniform(r.plan.before,'INBOX')?['INBOX']:[])||uniform(r.plan.before,'TRASH')||uniform(r.plan.before,'SPAM')))throw Error();
   if(r.undo?.plan&&(!r.plan||!sameSource(r.undo.plan.before,r.plan.after)||trashHash(r.undo.plan.add)!==trashHash(r.plan.remove)||trashHash(r.undo.plan.remove)!==trashHash(r.plan.add)))throw Error();
   this.versions.set(r,{revision:r.revision,integrity:String(row.integrity)});return r;
  }catch{trashFail('trash_corrupt',500)}
 }
 private save(r:RecordValue,insert=false):void{if(insert&&!this.store.db.isTransaction){this.tx(()=>this.save(r,true));return}const q=r.request;
  if(insert){r.sequence=Number(this.store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM trash_action_operations WHERE account_id=?').get(q.accountId)!.n);if(!Number.isSafeInteger(r.sequence)||r.sequence<1)trashFail('trash_order_exhausted');r.revision=1;this.store.db.prepare('INSERT INTO trash_action_operations VALUES(?,?,?,?,?,?,?,?,?)').run(q.accountId,q.accountVersion,q.clientRequestId,r.threadId,r.sequence,r.revision,r.undo?.request.clientRequestId??null,trashStable(r),trashHash(r))}
  else{const v=this.versions.get(r),old=this.row(q.accountId,q.accountVersion,q.clientRequestId);if(!v||!old||old.revision!==v.revision||trashHash(old)!==v.integrity||v.revision>=Number.MAX_SAFE_INTEGER)trashFail('trash_operation_changed');
   for(const key of ['version','threadId','request','fingerprint','sequence','createdAt','undoProof','sourceVersion','providerThreadId','grantVersion','mode','cached'] as const)if(trashHash(old[key])!==trashHash(r[key]))trashFail('trash_operation_changed');
   const immutableEvidence=(before:Evidence&{plan:Plan|null},after:Evidence&{plan:Plan|null})=>{for(const key of ['plan','issuedAt','ack','effect'] as const)if(before[key]!==null&&trashHash(before[key])!==trashHash(after[key]))trashFail('trash_operation_changed')};immutableEvidence(old,r);
   if(old.undo){if(!r.undo||old.undo.fingerprint!==r.undo.fingerprint||trashHash(old.undo.request)!==trashHash(r.undo.request)||old.undo.sourceVersion!==r.undo.sourceVersion)trashFail('trash_operation_changed');immutableEvidence(old.undo,r.undo)}
   if(old.undoId!==r.undoId&&!(old.undoId!==null&&r.undoId===null&&r.stage==='refused'&&r.issuedAt===null&&r.undo===null))trashFail('trash_operation_changed');
   r.revision=v.revision+1;if(this.store.db.prepare('UPDATE trash_action_operations SET revision=?,undo_request_id=?,data=?,integrity=? WHERE account_id=? AND account_version=? AND request_id=? AND revision=? AND integrity=?').run(r.revision,r.undo?.request.clientRequestId??null,trashStable(r),trashHash(r),q.accountId,q.accountVersion,q.clientRequestId,v.revision,v.integrity).changes!==1)trashFail('trash_operation_changed')}
  this.versions.set(r,{revision:r.revision,integrity:trashHash(r)});
 }
 private latest(r:RecordValue){const current=this.row(r.request.accountId,r.request.accountVersion,r.request.clientRequestId),v=this.versions.get(r);if(!current||!v||current.revision!==v.revision||trashHash(current)!==v.integrity)trashFail('trash_operation_changed');return current}
 private grant(account:Account){if(account.provider==='demo')return null;if(account.provider!=='google')trashFail('trash_account_changed');const g=this.store.get<any>('googleGrant','mail:'+account.id);if(!g||g.accountId!==account.id||g.service!=='mail'||!['granted','partial'].includes(g.outcome)||!['response','requested','token-cache'].includes(g.scopeSource)||!Array.isArray(g.grantedScopes)||g.grantedScopes.length>128||g.grantedScopes.some((s:unknown)=>typeof s!=='string')||!g.grantedScopes.some((s:string)=>s==='https://www.googleapis.com/auth/gmail.modify'||s==='https://mail.google.com/'))trashFail('trash_grant_changed');return trashHash({accountId:account.id,service:'mail',epoch:credentialGrantMutationEpoch(this.store,'mail:'+account.id),outcome:g.outcome,scopeSourceValid:true,scopes:[...new Set(g.grantedScopes)].sort()})}
 private identity(r:RecordValue){const account=this.store.get<Account>('account',r.request.accountId),thread=this.store.get<Thread>('thread',r.threadId);if(!account||!thread||thread.id!==r.threadId||thread.accountId!==account.id||currentAccountIncarnation(this.store,account.id)!==r.request.accountVersion||!['google','demo'].includes(account.provider)||r.providerThreadId!==null&&thread.providerId!==r.providerThreadId)trashFail('trash_account_changed');return{account,thread}}
 private eligible(r:RecordValue,thread:Thread){if(thread.snoozedUntil||thread.snoozeRetryAt||thread.snoozeError||thread.folder==='spam'||(thread.providerLabels??[]).some(l=>l==='SPAM'||l==='DRAFT'))trashFail('trash_ineligible');const canonical=this.store.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='reminder_slots'").get();if(canonical&&this.store.db.prepare('SELECT 1 FROM reminder_slots WHERE account_id=? AND thread_id=? LIMIT 1').get(r.request.accountId,r.threadId))trashFail('trash_ineligible');const e=trashDraftEligibility(this.store,{accountId:r.request.accountId,accountVersion:r.request.accountVersion,threadId:r.threadId,providerThreadId:thread.providerId??null});if(!e.eligible)trashFail('trash_ineligible')}
 private checkUndo(r:RecordValue){if(!r.undoId||!r.undoProof)trashFail('trash_undo_unavailable');const row=this.store.db.prepare('SELECT thread_id,data,after_data FROM undo WHERE id=?').get(r.undoId);if(!row||row.thread_id!==r.threadId||trashHash(row)!==r.undoProof)trashFail('trash_undo_unavailable');return row}
 private current(r:RecordValue,version:string){return this.own(r,()=>{this.store.ordinaryActions.assertAvailable(r.threadId);const v=this.identity(r),b=verifiedActionBasis(this.store,r.threadId,r.request.accountId);if(!b||b.sourceVersion!==version)trashFail('trash_source_changed');if(this.grant(v.account)!==r.grantVersion)trashFail('trash_grant_changed');this.eligible(r,v.thread);if(r.undoId&&r.undo?.stage!=='confirmed')this.checkUndo(r);return v})}
 private nativeStatus(r:RecordValue,e:Evidence):TrashNativeStatus{return{mode:r.mode,issuePossible:e.issuedAt!==null,ackKnown:e.ack!==null,effectVerified:e.effect!==null||r.mode==='local'&&('stage' in e)&&e.stage==='confirmed'}}
 private envelope(r:RecordValue):TrashEnvelope{let thread:Thread|undefined;try{const t=this.store.get<Thread>('thread',r.threadId);if(t?.accountId===r.request.accountId&&currentAccountIncarnation(this.store,r.request.accountId)===r.request.accountVersion)thread=t}catch{}const locked=!terminal(r.stage)||r.stage==='refused'&&r.undoId!==null||!!r.undo&&!terminal(r.undo.stage);return{version:1,scopeCurrent:!!thread,...thread?{thread}:{},receipt:{version:1,action:'trash',clientRequestId:r.request.clientRequestId,accountId:r.request.accountId,accountVersion:r.request.accountVersion,threadId:r.threadId,state:state(r.stage),undoId:r.undoId,locked,reason:r.reason??(r.stage==='issued'?'trash_native_unconfirmed':null),native:this.nativeStatus(r,r)},undo:r.undo?{version:1,clientRequestId:r.undo.request.clientRequestId,state:state(r.undo.stage),reason:r.undo.reason??(r.undo.stage==='issued'?'trash_native_unconfirmed':null),native:this.nativeStatus(r,r.undo)}:null}}
 get(threadId:string,accountId:string,accountVersion:string,key:string){if(!trashId(threadId)||!trashId(accountId)||!trashHex(accountVersion)||!trashKey(key))trashFail('trash_invalid_request',400);const r=this.row(accountId,accountVersion,key);if(!r||r.threadId!==threadId)trashFail('trash_not_found',404);return this.envelope(r)}
 private reason(error:unknown):TrashReason{if(error instanceof HttpError){if(error.code==='ordinary_action_locked')return'trash_ineligible';if(error.code==='undo_conflict')return'trash_local_conflict';if(error.code==='undo_expired')return'trash_undo_expired';if(error.code==='google_refresh_superseded')return'trash_grant_changed'}return error instanceof HttpError&&reasonCodes.includes(error.code as TrashReason)?error.code as TrashReason:'trash_native_unconfirmed'}
 private newRecord(threadId:string,request:TrashRequest):RecordValue{return{version:1,threadId,request:structuredClone(request),fingerprint:trashRequestFingerprint(threadId,request),stage:'accepted',reason:null,revision:0,sequence:0,createdAt:stamp(this.now()),undoId:null,undoProof:null,sourceVersion:null,providerThreadId:null,grantVersion:null,mode:'local',cached:[],plan:null,issuedAt:null,ack:null,effect:null,undo:null}}
 private read(r:RecordValue,phase:'required'|'if-stale'|'none',signal:AbortSignal,version:string){const input={accountId:r.request.accountId,providerThreadId:r.providerThreadId!};return this.native.read(input,phase,{signal,check:()=>{this.open();this.current(r,version);this.latest(r)}}).then(v=>{this.open();this.current(r,version);this.latest(r);const observed=validateTrashObservation(v,input);if(phase==='required'&&observed.profileEmail!==this.identity(r).account.email.toLowerCase())trashFail('trash_account_changed');return observed})}
 private planForward(r:RecordValue,observation:TrashObservation):Plan{noDraft(observation.messages);if(!sameLabels(r.cached,observation.messages))trashFail('trash_source_changed');if(uniform(observation.messages,'TRASH'))trashFail('trash_no_change');if(uniform(observation.messages,'SPAM'))trashFail('trash_ineligible');const inbox=uniform(observation.messages,'INBOX'),add=['TRASH'],remove=inbox?['INBOX']:[];return{before:observation.messages,after:applyLabels(observation.messages,add,remove),add,remove}}
 private async issue(r:RecordValue,e:RecordValue|Inverse,version:string,signal:AbortSignal){const plan=e.plan!;await this.native.modify({accountId:r.request.accountId,providerThreadId:r.providerThreadId!,addLabelIds:[...plan.add],removeLabelIds:[...plan.remove]},{signal,check:()=>{this.open();this.current(r,version);this.latest(r)},beforeIssue:()=>this.tx(()=>{this.open();this.current(r,version);this.latest(r);if(e!==r)this.own(r,()=>this.store.pendingUndo(r.undoId!),'inverse');if(e.stage!=='prepared'||e.issuedAt)trashFail('trash_operation_changed');e.stage='issued';e.issuedAt=stamp(this.now());this.save(r)}),onAck:id=>this.tx(()=>{this.latest(r);if(!e.issuedAt||e.ack||id!==r.providerThreadId)trashFail('trash_native_unconfirmed');e.ack={providerThreadId:id,at:stamp(this.now())};this.save(r)})});if(!e.issuedAt||!e.ack)trashFail('trash_native_unconfirmed')}
 private rollback(r:RecordValue){this.own(r,()=>{this.identity(r);this.checkUndo(r);this.eligible(r,this.identity(r).thread);this.store.ordinaryActions.assertAvailable(r.threadId);const pending=this.store.pendingUndo(r.undoId!);this.store.commitUndo(r.undoId!,pending,thread=>{this.eligible(r,thread);r.undoId=null;this.save(r)})},'rollback')}
 async trash(threadId:string,input:unknown):Promise<TrashEnvelope>{const request=structuredClone(parseTrashRequest(input));if(!trashId(threadId))trashFail('trash_invalid_request',400);return this.queue.run(request.accountId,()=>this.trashNow(threadId,request))}
 private async trashNow(threadId:string,request:TrashRequest):Promise<TrashEnvelope>{this.open();const old=this.row(request.accountId,request.accountVersion,request.clientRequestId);if(old){if(old.fingerprint!==trashRequestFingerprint(threadId,request))trashFail('trash_key_conflict');return this.envelope(old)}const r=this.newRecord(threadId,request);let accepted=false;
  try{const {account,thread}=this.identity(r);r.mode=account.provider==='google'?'google':'local';r.providerThreadId=thread.providerId??null;this.store.ordinaryActions.assertAvailable(threadId);this.eligible(r,thread);const basis=verifiedActionBasis(this.store,threadId,account.id);if(!basis||basis.sourceVersion!==request.expectedSourceVersion)trashFail('trash_source_changed');r.grantVersion=this.grant(account);if(thread.folder==='trash'||thread.providerLabels?.includes('TRASH'))trashFail('trash_no_change');r.cached=r.mode==='google'?trashCachedMessages(thread):[];noDraft(r.cached);if(r.mode==='google'&&!r.providerThreadId)trashFail('trash_native_scope');
   const prepared=this.store.prepareAction(threadId,'trash');this.own(r,()=>this.store.commitAction(prepared.before,prepared.thread,result=>{this.eligible(r,result.thread);r.undoId=result.undoId;r.undoProof=trashHash(this.store.db.prepare('SELECT thread_id,data,after_data FROM undo WHERE id=?').get(r.undoId));r.sourceVersion=verifiedActionBasis(this.store,threadId,request.accountId)?.sourceVersion??null;if(!r.sourceVersion)trashFail('trash_source_changed');this.save(r,true)},()=>{this.current(r,request.expectedSourceVersion);return this.store.prepareAction(threadId,'trash')}));accepted=true;
   const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)]);this.current(r,r.sourceVersion!);
   if(r.mode==='google'){const before=await this.read(r,'required',signal,r.sourceVersion!);this.tx(()=>{this.current(r,r.sourceVersion!);this.latest(r);r.plan=this.planForward(r,before);r.stage='prepared';this.save(r)});await this.issue(r,r,r.sourceVersion!,signal);const after=await this.read(r,'none',signal,r.sourceVersion!);if(!sameLabels(after.messages,r.plan!.after))trashFail('trash_effect_unconfirmed');this.tx(()=>{this.current(r,r.sourceVersion!);this.latest(r);r.effect=after;r.stage='confirmed';this.save(r)})}
   else this.tx(()=>{this.open();this.current(r,r.sourceVersion!);this.latest(r);r.stage='confirmed';this.save(r)});
  }catch(error){if(!accepted){r.cached=[];r.undoId=null;r.undoProof=null;r.sourceVersion=null;r.stage='refused';r.reason=this.reason(error);this.save(r,true)}else if(r.issuedAt){r.stage='unknown';r.reason=this.reason(error);this.save(r)}else{r.stage='refused';r.reason=this.reason(error);try{this.rollback(r)}catch{r.reason='trash_local_conflict';this.save(r)}}}return this.envelope(r);
 }
 async undo(threadId:string,key:string,input:unknown):Promise<TrashEnvelope>{const request=structuredClone(parseTrashUndo(input));if(!trashId(threadId)||!trashKey(key))trashFail('trash_invalid_request',400);return this.queue.run(request.accountId,()=>this.undoNow(threadId,key,request))}
 /** First-inverse decision is one synchronous SQL unit. Existing accepted
  * history wins before current-account checks; it is never accepted again. */
 private acceptInverse(threadId:string,key:string,request:TrashUndoRequest){return this.tx(()=>{
  this.open();const r=this.row(request.accountId,request.accountVersion,key);
  if(!r||r.threadId!==threadId)trashFail('trash_not_found',404);
  if(r.undo){if(r.undo.fingerprint!==trashUndoFingerprint(threadId,key,request))trashFail('trash_key_conflict');return{r,dispatch:false}}
  if(r.stage!=='confirmed'||!r.undoId)trashFail('trash_undo_unavailable');
  const scoped=()=>{try{return this.identity(r)}catch(error){if(error instanceof HttpError&&[404,409].includes(error.status))trashFail('trash_undo_unavailable');throw error}};
  scoped();
  const linked=()=>{const row=this.store.db.prepare('SELECT thread_id,expires FROM undo WHERE id=?').get(r.undoId!);if(!row||row.thread_id!==threadId||!Number.isSafeInteger(row.expires))trashFail('trash_undo_unavailable');this.checkUndo(r);return row};
  const raw=linked(),u:Inverse={request,fingerprint:trashUndoFingerprint(threadId,key,request),stage:'accepted',reason:null,sourceVersion:'',plan:null,issuedAt:null,ack:null,effect:null};
  r.undo=u;
  if(Number(raw.expires)<Date.now()){
   // Positive expiry grants no inverse authority. It precedes a new Draft or
   // grant check and leaves all Thread/Draft/cloud/ordinary-Undo rows intact.
   u.stage='refused';u.reason='trash_undo_expired';scoped();this.latest(r);this.save(r);return{r,dispatch:false};
  }
  let failure:unknown;
  try{this.own(r,()=>{
   this.store.ordinaryActions.assertAvailable(threadId);const{thread,account}=scoped();this.eligible(r,thread);
   if(this.grant(account)!==r.grantVersion)trashFail('trash_grant_changed');
   const basis=verifiedActionBasis(this.store,threadId,request.accountId);if(!basis)trashFail('trash_source_changed');u.sourceVersion=basis.sourceVersion;
   this.store.pendingUndo(r.undoId!);this.current(r,u.sourceVersion);
  },'inverse')}catch(error){failure=error}
  // pendingUndo uses410 for absence as well as expiry. Re-read the exact linked
  // footprint/expiry and current scope in this same transaction: only positive
  // expiry outranks a busy-state refusal, including a clock crossing in hooks.
  scoped();this.latest(r);const final=linked();
  if(Number(final.expires)<Date.now()){u.stage='refused';u.reason='trash_undo_expired'}
  else if(failure!==undefined){
   if(failure instanceof HttpError&&failure.code==='undo_expired')trashFail('trash_undo_unavailable');
   u.stage='refused';u.reason=this.reason(failure);
  }
  this.save(r);return{r,dispatch:u.stage==='accepted'};
 })}
 private async undoNow(threadId:string,key:string,request:TrashUndoRequest):Promise<TrashEnvelope>{
  const{r,dispatch}=this.acceptInverse(threadId,key,request);if(!dispatch)return this.envelope(r);const u=r.undo!;
  try{
   const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)]);
   if(r.mode==='google'){const before=await this.read(r,'if-stale',signal,u.sourceVersion),original=r.plan!;if(!sameSource(before.messages,original.after)||!uniform(before.messages,'TRASH')||uniform(before.messages,'INBOX'))trashFail('trash_source_changed');const add=[...original.remove],remove=[...original.add];u.plan={before:before.messages,after:applyLabels(before.messages,add,remove),add,remove};this.tx(()=>{this.current(r,u.sourceVersion);this.latest(r);u.stage='prepared';this.save(r)});await this.issue(r,u,u.sourceVersion,signal);const after=await this.read(r,'none',signal,u.sourceVersion);if(!sameLabels(after.messages,u.plan.after))trashFail('trash_effect_unconfirmed');u.effect=after}
   this.own(r,()=>{this.open();this.current(r,u.sourceVersion);this.latest(r);const target=this.store.pendingUndo(r.undoId!);this.store.commitUndo(r.undoId!,target,thread=>{this.eligible(r,thread);u.stage='confirmed';u.reason=null;this.save(r)})},'inverse');
  }catch(error){u.stage=u.issuedAt?'unknown':'refused';u.reason=this.reason(error);this.save(r)}return this.envelope(r);
 }
}
