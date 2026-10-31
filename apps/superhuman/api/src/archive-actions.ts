import type {Store} from './store.ts';
import type {GoogleProvider} from './google.ts';
import {OperationQueue} from './operation-queue.ts';
import {HttpError,type Thread,type Account,type ThreadListPage} from './types.ts';
import {readArchiveSummaryPage} from './archive-summary-basis.ts';
import {currentAccountIncarnation,AccountIncarnationAuthority} from './account-incarnation.ts';
import {initializeArchiveBasis,actionBasis,verifiedActionBasis} from './archive-action-basis.ts';
import {archiveHash,archiveStable,archiveKey,archiveId,archiveHex,parseArchiveRequest,parseArchiveUndo,type ArchiveRequest,type ArchiveReceipt,type ArchiveUndoStatus,type ArchiveState} from './archive-action-contract.ts';
import {googleArchiveAction,type ArchiveNativeInput,type ArchiveNativeGuard} from './archive-action-google.ts';
type InternalState=ArchiveState|'issued';
type UndoRecord={request:{accountId:string;
accountVersion:string;
clientRequestId:string};
fingerprint:string;
state:InternalState;
reason:string|null;
sourceVersion:string;
issuedAt:string|null;
ack:{providerThreadId:string;
at:string}|null};
type RecordValue={version:1;
threadId:string;
request:ArchiveRequest;
fingerprint:string;
state:InternalState;
reason:string|null;
undoId:string|null;
acceptedSourceVersion:string|null;
grantVersion:string|null;
createdAt:string;
issuedAt:string|null;
ack:{providerThreadId:string;
at:string}|null;
undo:UndoRecord|null};
type Envelope={thread?:Thread;
undoId:string|null;
receipt:ArchiveReceipt;
undo:ArchiveUndoStatus|null};
type Native=(input:ArchiveNativeInput,guard:ArchiveNativeGuard)=>Promise<unknown>;
function fail(code:string,status=409):never{throw new HttpError(status,'This Archive operation is unavailable',code)}
export class ArchiveActionService{
 private readonly versions=new WeakMap<RecordValue,string>();
private stopped=false;
private readonly abort=new AbortController();
 readonly adoptedAccounts:string[]=[];
readonly store:Store;
readonly queue:OperationQueue;
readonly native:Native;
readonly now:()=>number;
 constructor(store:Store,google:GoogleProvider,queue:OperationQueue,options:{native?:Native;
now?:()=>number}={}){this.store=store;
this.queue=queue;
this.native=options.native??((input,guard)=>googleArchiveAction(google,input,guard));
this.now=options.now??Date.now;
store.db.exec('SAVEPOINT archive_service_schema');
try{const authority=new AccountIncarnationAuthority(store);
for(const account of store.list<Account>('account')){if(!this.eligible(account.id))continue;
const existing=store.db.prepare('SELECT 1 FROM auto_draft_ready_accounts WHERE account_id=?').get(account.id);
try{if(existing)authority.version(account.id);
else{authority.adoptAccount(account.id);
this.adoptedAccounts.push(account.id)}
}
catch{/* Existing corrupt identity is never reset or adopted. */}
}
initializeArchiveBasis(store);
store.db.exec(`CREATE TABLE IF NOT EXISTS archive_action_operations(account_id TEXT NOT NULL,account_version TEXT NOT NULL,request_id TEXT NOT NULL,thread_id TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,integrity TEXT NOT NULL,PRIMARY KEY(account_id,account_version,request_id));CREATE INDEX IF NOT EXISTS archive_action_scope ON archive_action_operations(thread_id);`);
store.db.exec('RELEASE archive_service_schema')}
catch(error){store.db.exec('ROLLBACK TO archive_service_schema;RELEASE archive_service_schema');
throw error}
}
 close(){this.stopped=true;
this.abort.abort()}
 private eligible(accountId:string){const a=this.store.get<Account>('account',accountId);
if(!a||a.id!==accountId)return false;
if(a.provider==='demo')return true;
if(a.provider!=='google')return false;
const g=this.store.get<any>('googleGrant','mail:'+accountId);
return !!g&&g.accountId===accountId&&g.service==='mail'&&['granted','partial'].includes(g.outcome)&&['response','requested','token-cache'].includes(g.scopeSource)&&Array.isArray(g.grantedScopes)&&g.grantedScopes.length<=128&&g.grantedScopes.every((x:unknown)=>typeof x==='string')&&g.grantedScopes.some((x:string)=>x==='https://www.googleapis.com/auth/gmail.modify'||x==='https://mail.google.com/')}
 accountVersions(){return Object.fromEntries(this.store.list<Account>('account').map(a=>{let version:string|null=null;
if(this.eligible(a.id))try{version=currentAccountIncarnation(this.store,a.id)}
catch{}
return[a.id,version]}
))}
 basis(threadId:string,accountId:string){return this.eligible(accountId)?actionBasis(this.store,threadId,accountId):null}
 summaryPage(read:()=>ThreadListPage){return readArchiveSummaryPage(this.store,read,accountId=>this.eligible(accountId),wire=>this.annotate(wire))}
 annotate(value:unknown):unknown{if(!value||typeof value!=='object'||value instanceof Date||value instanceof Uint8Array)return value;
if(Array.isArray(value))return value.map(x=>this.annotate(x));
const v=value as Record<string,unknown>,out=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,this.annotate(x)]));
if(typeof v.id==='string'&&typeof v.accountId==='string'&&typeof v.folder==='string'&&typeof v.subject==='string'&&(Array.isArray(v.messages)||typeof v.messageCount==='number'))out.archiveBasis=this.basis(v.id,v.accountId);
return out}
 private owned<T>(r:RecordValue,work:()=>T):T{return this.store.ordinaryActions.run({kind:'archive',accountId:r.request.accountId,accountVersion:r.request.accountVersion,key:r.request.clientRequestId},work)}
 private stamp(){return new Date(this.now()).toISOString()}
 private assertOpen(){if(this.stopped)fail('archive_stopping',503)}
 private row(accountId:string,accountVersion:string,key:string):RecordValue|null{const row=this.store.db.prepare('SELECT * FROM archive_action_operations WHERE account_id=? AND account_version=? AND request_id=?').get(accountId,accountVersion,key);
if(!row)return null;
const value=JSON.parse(String(row.data))as RecordValue;
if(archiveHash(value)!==row.integrity||value.request.accountId!==accountId||value.request.accountVersion!==accountVersion||value.request.clientRequestId!==key||value.threadId!==row.thread_id||value.fingerprint!==archiveHash({threadId:value.threadId,request:value.request})||value.undo&&value.undo.fingerprint!==archiveHash(value.undo.request))fail('archive_corrupt',500);
this.versions.set(value,String(row.integrity));
return value}
 private save(value:RecordValue,insert=false){const r=value.request,data=archiveStable(value),integrity=archiveHash(value);
if(insert){const sequence=Number(this.store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM archive_action_operations WHERE account_id=?').get(r.accountId)!.n);
if(!Number.isSafeInteger(sequence)||sequence<1)fail('archive_order_exhausted');
this.store.db.prepare('INSERT INTO archive_action_operations VALUES(?,?,?,?,?,?,?)').run(r.accountId,r.accountVersion,r.clientRequestId,value.threadId,sequence,data,integrity)}
else{const previous=this.versions.get(value);
if(!previous||this.store.db.prepare('UPDATE archive_action_operations SET data=?,integrity=? WHERE account_id=? AND account_version=? AND request_id=? AND integrity=?').run(data,integrity,r.accountId,r.accountVersion,r.clientRequestId,previous).changes!==1)fail('archive_operation_changed')}
this.versions.set(value,integrity)}
 private code(error:unknown){return error instanceof HttpError&&/^archive_[a-z_]+$/.test(error.code)?error.code:'archive_preissue_refused'}
 private identity(r:RecordValue){const account=this.store.required<Account>('account',r.request.accountId),thread=this.store.required<Thread>('thread',r.threadId);
if(currentAccountIncarnation(this.store,account.id)!==r.request.accountVersion||thread.accountId!==account.id||thread.id!==r.threadId||!['google','demo'].includes(account.provider))fail('archive_account_changed');
return{account,thread}}
 private grant(accountId:string){const account=this.store.required<Account>('account',accountId);
if(account.provider==='demo')return null;
const g=this.store.get<any>('googleGrant','mail:'+accountId);
if(!g||g.accountId!==accountId||g.service!=='mail'||!['granted','partial'].includes(g.outcome)||!['response','requested','token-cache'].includes(g.scopeSource)||!Array.isArray(g.grantedScopes)||g.grantedScopes.length>128||g.grantedScopes.some((x:unknown)=>typeof x!=='string')||!g.grantedScopes.some((s:unknown)=>s==='https://www.googleapis.com/auth/gmail.modify'||s==='https://mail.google.com/'))fail('archive_grant_unavailable');
return archiveHash({accountId,service:'mail',outcome:g.outcome,scopes:[...new Set(g.grantedScopes)].sort(),scopeSource:g.scopeSource})}
 private publicState(value:InternalState):ArchiveState{return value==='issued'?'unknown':value}
 private envelope(r:RecordValue):Envelope{let thread:Thread|undefined;
const t=this.store.get<Thread>('thread',r.threadId);
try{if(t?.accountId===r.request.accountId&&currentAccountIncarnation(this.store,r.request.accountId)===r.request.accountVersion)thread=t}
catch{}
return{...(thread?{thread}:{}),undoId:r.undoId,receipt:{version:1,clientRequestId:r.request.clientRequestId,accountId:r.request.accountId,accountVersion:r.request.accountVersion,threadId:r.threadId,action:'archive',state:this.publicState(r.state),undoId:r.undoId,reason:r.reason??(r.state==='issued'?'archive_native_unconfirmed':null)},undo:r.undo?{version:1,clientRequestId:r.undo.request.clientRequestId,state:this.publicState(r.undo.state),reason:r.undo.reason??(r.undo.state==='issued'?'archive_native_unconfirmed':null)}:null}}
 get(threadId:string,accountId:string,accountVersion:string,key:string){if(!archiveId(threadId)||!archiveId(accountId)||!archiveHex(accountVersion)||!archiveKey(key))fail('archive_invalid_request',400);
const r=this.row(accountId,accountVersion,key);
if(!r||r.threadId!==threadId)fail('archive_not_found',404);
return this.envelope(r)}
 ownsUndo(id:string){return!!this.store.db.prepare("SELECT 1 FROM archive_action_operations WHERE json_extract(data,'$.undoId')=? LIMIT 1").get(id)}
 assertNotLocked(threadId:string){for(const row of this.store.db.prepare('SELECT account_id,account_version,request_id FROM archive_action_operations WHERE thread_id=?').all(threadId)){const r=this.row(String(row.account_id),String(row.account_version),String(row.request_id))!;
if(r.state==='pending'||r.state==='issued'||r.state==='unknown'||r.state==='refused'&&r.undoId!==null||r.undo&&['pending','issued','unknown'].includes(r.undo.state))fail('archive_unknown_locked')}
}
 private current(r:RecordValue,sourceVersion:string){this.store.ordinaryActions.run({kind:'archive',accountId:r.request.accountId,accountVersion:r.request.accountVersion,key:r.request.clientRequestId},()=>this.store.ordinaryActions.assertAvailable(r.threadId));const value=this.identity(r),basis=verifiedActionBasis(this.store,r.threadId,r.request.accountId);
if(!basis||basis.sourceVersion!==sourceVersion)fail('archive_source_changed');
if(this.grant(r.request.accountId)!==r.grantVersion)fail('archive_grant_changed');
return value}
 private create(threadId:string,request:ArchiveRequest):RecordValue{return{version:1,threadId,request,fingerprint:archiveHash({threadId,request}),state:'pending',reason:null,undoId:null,acceptedSourceVersion:null,grantVersion:null,createdAt:this.stamp(),issuedAt:null,ack:null,undo:null}}
 async archive(threadId:string,value:unknown):Promise<Envelope>{const request=parseArchiveRequest(value);
if(!archiveId(threadId))fail('archive_invalid_request',400);
return this.queue.run(request.accountId,()=>this.archiveNow(threadId,request))}
 private async archiveNow(threadId:string,request:ArchiveRequest):Promise<Envelope>{this.assertOpen();
const existing=this.row(request.accountId,request.accountVersion,request.clientRequestId);
if(existing){if(existing.fingerprint!==archiveHash({threadId,request}))fail('archive_key_conflict');
return this.envelope(existing)}
const r=this.create(threadId,request);
let before:Thread|undefined,accepted=false;
  try{this.identity(r);
this.assertNotLocked(threadId);this.store.ordinaryActions.assertTrashAvailable(threadId);
const basis=verifiedActionBasis(this.store,threadId,request.accountId);
if(!basis||basis.accountVersion!==request.accountVersion||basis.sourceVersion!==request.expectedSourceVersion)fail('archive_source_changed');
r.grantVersion=this.grant(request.accountId);
const prepared=this.store.prepareAction(threadId,'archive');
before=prepared.before;
this.store.commitAction(prepared.before,prepared.thread,result=>{r.undoId=result.undoId;
r.acceptedSourceVersion=verifiedActionBasis(this.store,threadId,request.accountId)?.sourceVersion??null;
if(!r.acceptedSourceVersion)fail('archive_context_unavailable');
this.save(r,true)}
,()=>{this.identity(r);
this.assertNotLocked(threadId);this.store.ordinaryActions.assertTrashAvailable(threadId);
const current=verifiedActionBasis(this.store,threadId,request.accountId);
if(!current||current.sourceVersion!==request.expectedSourceVersion||this.grant(request.accountId)!==r.grantVersion)fail('archive_source_changed');
const fresh=this.store.prepareAction(threadId,'archive');
before=fresh.before;
return fresh}
);
accepted=true;
   const{account,thread}=this.current(r,r.acceptedSourceVersion!);
const removeInbox=(before.providerLabels??(before.folder==='inbox'?['INBOX']:[])).includes('INBOX');
if(account.provider==='google'&&removeInbox){if(!thread.providerId)fail('archive_native_scope');
await this.native({accountId:request.accountId,providerThreadId:thread.providerId,addInbox:false,removeInbox:true},{signal:this.abort.signal,beforeIssue:()=>{this.assertOpen();
this.current(r,r.acceptedSourceVersion!);
const live=this.row(request.accountId,request.accountVersion,request.clientRequestId);
if(live?.state!=='pending'||live.issuedAt)fail('archive_already_issued');
r.state='issued';
r.issuedAt=this.stamp();
this.save(r)}
,onAck:ack=>{r.ack={...ack,at:this.stamp()};
this.save(r)}
});
if(!r.issuedAt||!r.ack)fail('archive_native_unknown')}
   this.current(r,r.acceptedSourceVersion!);
this.assertOpen();
r.state='confirmed';
r.reason=null;
this.save(r);
return this.envelope(r);
  }
catch(e){if(r.issuedAt){r.state='unknown';
r.reason='archive_native_unconfirmed';
this.save(r)}
else if(accepted){r.state='refused';
r.reason=this.code(e);
try{this.identity(r);
const undo=this.owned(r,()=>this.store.pendingUndo(r.undoId!));
this.owned(r,()=>this.store.commitUndo(r.undoId!,undo,()=>{r.undoId=null;
this.save(r)}
))}
catch{r.reason='archive_refused_local_conflict';
this.save(r)}
}
else{r.state='refused';
r.reason=this.code(e);
r.undoId=null;
r.acceptedSourceVersion=null;
this.save(r,true)}
return this.envelope(r)}
 }
 async undo(threadId:string,archiveKeyValue:string,value:unknown):Promise<Envelope>{const request=parseArchiveUndo(value);
if(!archiveId(threadId)||!archiveKey(archiveKeyValue))fail('archive_invalid_request',400);
return this.queue.run(request.accountId,async()=>{this.assertOpen();
const r=this.row(request.accountId,request.accountVersion,archiveKeyValue);
if(!r||r.threadId!==threadId)fail('archive_not_found',404);
if(r.undo){if(r.undo.fingerprint!==archiveHash(request))fail('archive_key_conflict');
return this.envelope(r)}
if(r.state!=='confirmed'||!r.undoId)fail('archive_undo_unavailable');
const u:UndoRecord={request,fingerprint:archiveHash(request),state:'pending',reason:null,sourceVersion:'',issuedAt:null,ack:null};
r.undo=u;
  try{this.store.ordinaryActions.run({kind:'archive',accountId:r.request.accountId,accountVersion:r.request.accountVersion,key:r.request.clientRequestId},()=>this.store.ordinaryActions.assertAvailable(r.threadId));const{account,thread}=this.identity(r),basis=verifiedActionBasis(this.store,threadId,request.accountId);
if(!basis)fail('archive_context_unavailable');
u.sourceVersion=basis.sourceVersion;
const target=this.owned(r,()=>this.store.pendingUndo(r.undoId!));
this.save(r);
const beforeInbox=(thread.providerLabels??(thread.folder==='inbox'?['INBOX']:[])).includes('INBOX'),afterInbox=(target.providerLabels??(target.folder==='inbox'?['INBOX']:[])).includes('INBOX');
if(account.provider==='google'&&beforeInbox!==afterInbox){if(!thread.providerId)fail('archive_native_scope');
await this.native({accountId:request.accountId,providerThreadId:thread.providerId,addInbox:afterInbox,removeInbox:!afterInbox},{signal:this.abort.signal,beforeIssue:()=>{this.assertOpen();
this.current(r,u.sourceVersion);
this.owned(r,()=>this.store.pendingUndo(r.undoId!));
const live=this.row(request.accountId,request.accountVersion,archiveKeyValue);
if(live?.undo?.request.clientRequestId!==u.request.clientRequestId||live.undo.state!=='pending'||live.undo.issuedAt||u.issuedAt)fail('archive_already_issued');
u.state='issued';
u.issuedAt=this.stamp();
this.save(r)}
,onAck:ack=>{u.ack={...ack,at:this.stamp()};
this.save(r)}
});
if(!u.issuedAt||!u.ack)fail('archive_native_unknown')}
   this.assertOpen();
this.current(r,u.sourceVersion);
const current=this.owned(r,()=>this.store.pendingUndo(r.undoId!));
this.owned(r,()=>this.store.commitUndo(r.undoId!,current,()=>{u.state='confirmed';
u.reason=null;
this.save(r)}
));
return this.envelope(r);
  }
catch(e){u.state=u.issuedAt?'unknown':'refused';
u.reason=u.issuedAt?'archive_native_unconfirmed':this.code(e);
this.save(r);
return this.envelope(r)}
}
)}
}
