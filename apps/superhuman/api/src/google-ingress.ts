import {messageSourceValue} from './reminder-message-projection.ts';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from './store.ts';
import {HttpError,type Account,type Message,type Thread} from './types.ts';
import {decimalCounter,compareCounters,parseIngressVersion} from './auto-drafts-generation-contract.ts';
import type {IngressVersion} from './auto-drafts-generation-contract.ts';

// Server-only producer boundary. No competing browser DTO or model context.
export type GoogleAddedMessage={id:string;threadId:string};
export type GoogleHistoryPage={historyId:string;nextPageToken?:string;history?:{id?:string;messages?:GoogleAddedMessage[];messagesAdded?:{message:GoogleAddedMessage}[];messagesDeleted?:{message:GoogleAddedMessage}[];labelsAdded?:{message:GoogleAddedMessage}[];labelsRemoved?:{message:GoogleAddedMessage}[]}[]};
export type GooglePageProof={id:string;accountId:string;accountVersion:string;baselineVersion:string;origin:'live'|'catchup'|'repair';afterCursor:string;throughCursor:string;entries:{id:string;added:GoogleAddedMessage[]}[]};
export type GoogleReadLease={accountId:string;accountVersion:string;owner:string;id:string;epoch:number;expiresAt:number};
export type GooglePublication={accountId:string;accountVersion:string;origin:'live'|'initial'|'catchup'|'repair';thread:Thread;occurrences:IngressVersion[];history:GooglePageProof|null};
export type GoogleReplyMetadata={headersComplete:boolean;replyTo:string|null};
export type GoogleSourceVersion={accountId:string;accountVersion:string;sourceRef:string;inputVersion:string;providerMessageId:string;providerThreadId:string;message:Message;replyMetadata:GoogleReplyMetadata;immutableFactsHash:string};
export type GoogleIngressOptions={
  // MUST be independently maintained durable account incarnation, not a hash
  // of current email bytes. In particular delete/readd ABA must change it.
  accountVersion:(account:Account)=>string;
  onPublication?:(publication:GooglePublication)=>void;
  now?:()=>number;leaseMs?:number;ownerAlive?:(owner:string,pid:number)=>boolean;
};
type Meta={account_id:string;account_version:string;epoch:number;baseline_version:string;anchored:number;complete:number;cursor:string|null;sequence:number;completed_at:string|null;owner:string|null;pid:number|null;lease_id:string|null;expires_at:number|null;stamp:number};
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v);
const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const next=(n:number)=>{if(!safe(n)||n===Number.MAX_SAFE_INTEGER)throw new HttpError(500,'Gmail ingress counter unavailable','google_ingress_corrupt');return n+1};
function fail(code='google_ingress_stale',status=409):never{throw new HttpError(status,'Gmail synchronization ownership changed',code)}
const alive=(_owner:string,pid:number)=>{try{process.kill(pid,0);return true}catch(e){return(e as NodeJS.ErrnoException).code!=='ESRCH'}};

/** Opt-in provenance adapter. A caller installs this explicitly; constructors
 * and status/barrier reads never fetch, admit a job or activate preferences. */
export class GoogleIngressAdapter{
 readonly owner=randomUUID();private serial=0;private closed=false;
 readonly now:()=>number;readonly leaseMs:number;readonly store:Store;readonly options:GoogleIngressOptions;
 constructor(store:Store,options:GoogleIngressOptions){
  this.store=store;this.options=options;
  this.now=options.now??Date.now;this.leaseMs=options.leaseMs??120000;
  if(!safe(this.leaseMs)||this.leaseMs<1000||this.leaseMs>600000)fail('google_ingress_invalid_request',400);
  store.db.exec(`CREATE TABLE IF NOT EXISTS google_ingress_meta(account_id TEXT PRIMARY KEY,account_version TEXT NOT NULL,epoch INTEGER NOT NULL,baseline_version TEXT NOT NULL,anchored INTEGER NOT NULL,complete INTEGER NOT NULL,cursor TEXT,sequence INTEGER NOT NULL,completed_at TEXT,owner TEXT,pid INTEGER,lease_id TEXT,expires_at INTEGER,stamp INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS google_ingress_pages(id TEXT PRIMARY KEY,data TEXT NOT NULL,integrity TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS google_ingress_sources(account_id TEXT NOT NULL,account_version TEXT NOT NULL,provider_message_id TEXT NOT NULL,provider_thread_id TEXT NOT NULL,source_ref TEXT NOT NULL UNIQUE,PRIMARY KEY(account_id,account_version,provider_message_id));
   CREATE TABLE IF NOT EXISTS google_ingress_versions(source_ref TEXT NOT NULL,input_version TEXT NOT NULL,data TEXT NOT NULL,integrity TEXT NOT NULL,PRIMARY KEY(source_ref,input_version));
   CREATE TABLE IF NOT EXISTS google_ingress_occurrences(account_id TEXT NOT NULL,account_version TEXT NOT NULL,source_ref TEXT NOT NULL,input_version TEXT NOT NULL,data TEXT NOT NULL,integrity TEXT NOT NULL,PRIMARY KEY(account_id,account_version,source_ref,input_version));`);
 }
 private tx<T>(work:()=>T):T{const name=`google_ingress_${++this.serial}`;this.store.db.exec(`SAVEPOINT ${name}`);try{const value=work();this.store.db.exec(`RELEASE ${name}`);return value}catch(e){this.store.db.exec(`ROLLBACK TO ${name};RELEASE ${name}`);throw e}}
 private account(accountId:string){const a=this.store.get<Account>('account',accountId);if(!a||a.id!==accountId||a.provider!=='google')fail();const version=this.options.accountVersion(structuredClone(a));if(!hash(version))fail('google_ingress_corrupt',500);return{a,version}}
 private row(accountId:string):Meta|undefined{return this.store.db.prepare('SELECT * FROM google_ingress_meta WHERE account_id=?').get(accountId) as Meta|undefined}
 private stamp(row?:Meta){const n=this.now();if(!safe(n)||n>8640000000000000||row&&n<row.stamp)fail('google_ingress_corrupt',500);return n}
 begin(accountId:string):GoogleReadLease{
  if(this.closed)fail('google_ingress_closed');return this.tx(()=>{
   const {version}=this.account(accountId),old=this.row(accountId),stamp=this.stamp(old);
   if(old?.lease_id&&old.expires_at!>stamp&&this.store.ownerLiveness(old.owner===this.owner,()=>(this.options.ownerAlive??alive)(old.owner!,old.pid!)))fail('google_ingress_busy');
   const epoch=next(old?.epoch??0),leaseId=randomUUID(),baseline=old&&old.account_version===version?old.baseline_version:sha(randomUUID());
   const same=old?.account_version===version;
   this.store.db.prepare(`INSERT INTO google_ingress_meta VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET account_version=excluded.account_version,epoch=excluded.epoch,baseline_version=excluded.baseline_version,anchored=excluded.anchored,complete=0,cursor=excluded.cursor,sequence=excluded.sequence,completed_at=excluded.completed_at,owner=excluded.owner,pid=excluded.pid,lease_id=excluded.lease_id,expires_at=excluded.expires_at,stamp=excluded.stamp`).run(accountId,version,epoch,baseline,same?old!.anchored:0,0,same?old!.cursor:null,old?.sequence??0,same?old!.completed_at:null,this.owner,process.pid,leaseId,stamp+this.leaseMs,stamp);
   return{accountId,accountVersion:version,owner:this.owner,id:leaseId,epoch,expiresAt:stamp+this.leaseMs};
  });
 }
 assert(lease:GoogleReadLease){
  if(this.closed)fail('google_ingress_closed');const row=this.row(lease.accountId),{version}=this.account(lease.accountId),stamp=this.stamp(row);
  if(!row||version!==lease.accountVersion||row.account_version!==lease.accountVersion||row.owner!==lease.owner||row.lease_id!==lease.id||row.epoch!==lease.epoch||row.expires_at!==lease.expiresAt||stamp>=lease.expiresAt)fail();return row;
 }
 unit<T>(lease:GoogleReadLease,work:()=>T):T{return this.tx(()=>{this.assert(lease);const value=work();this.assert(lease);this.store.db.prepare('UPDATE google_ingress_meta SET stamp=? WHERE account_id=?').run(this.stamp(this.row(lease.accountId)),lease.accountId);return value})}
 finish(lease:GoogleReadLease,success:boolean){
  // A replaced/closed owner never writes even cleanup metadata.
  const row=this.row(lease.accountId);if(!row||row.owner!==lease.owner||row.lease_id!==lease.id||row.epoch!==lease.epoch)return;
  this.tx(()=>{const state=this.store.get<{phase:string;partial:boolean;historyId:string;pending?:unknown;catchup?:unknown}>('sync',lease.accountId);let valid=false;try{this.assert(lease);valid=true}catch{/* failure clears only this still-owned lease */}
   const complete=valid&&success&&state?.phase==='history'&&!state.partial&&!state.pending&&!state.catchup;
   if(complete)decimalCounter(state.historyId);
   this.store.db.prepare('UPDATE google_ingress_meta SET owner=NULL,pid=NULL,lease_id=NULL,expires_at=NULL,complete=?,anchored=?,cursor=?,completed_at=? WHERE account_id=? AND lease_id=?').run(complete?1:0,complete?1:row.anchored,complete?state!.historyId:row.cursor,complete?new Date(this.now()).toISOString():row.completed_at,lease.accountId,lease.id);
  });
 }
 invalidate(lease:GoogleReadLease){return this.unit(lease,()=>{this.store.db.prepare('UPDATE google_ingress_meta SET baseline_version=?,anchored=0,complete=0,cursor=NULL,completed_at=NULL WHERE account_id=?').run(sha(randomUUID()),lease.accountId)})}
 readiness(accountId:string){const {version}=this.account(accountId),r=this.row(accountId),state=this.store.get<{phase:string;partial:boolean;pending?:unknown;catchup?:unknown}>('sync',accountId);const ready=!!r&&r.account_version===version&&r.anchored===1&&r.complete===1&&!r.lease_id&&state?.phase==='history'&&!state.partial&&!state.pending&&!state.catchup;return{accountVersion:version,ready,pendingRead:!!r?.lease_id,baselineVersion:r?.baseline_version??null,sequence:r?.sequence??0,historyId:r?.cursor??null,completedAt:r?.completed_at??null}}
 captureBarrier(accountId:string){if(!this.store.db.isTransaction)fail('google_ingress_barrier_transaction_required');const r=this.readiness(accountId);return r.ready?{accountVersion:r.accountVersion,sequence:r.sequence,internalDateAfter:new Date(this.now()).toISOString(),baselineVersion:r.baselineVersion!,historyId:r.historyId!}:null}
 page(lease:GoogleReadLease,after:string,page:GoogleHistoryPage,requested:'live'|'catchup'|'repair'):GooglePageProof{
  return this.unit(lease,()=>{
   decimalCounter(after);decimalCounter(page.historyId);if(compareCounters(after,page.historyId)>0||!Array.isArray(page.history??[])||(page.history?.length??0)>1000)fail('invalid_google_history',502);
   const r=this.assert(lease),entries=(page.history??[]).map(entry=>{decimalCounter(entry.id);if(compareCounters(after,entry.id!)>=0||compareCounters(entry.id!,page.historyId)>0)fail('invalid_google_history',502);const added=(entry.messagesAdded??[]).map(item=>{if(!id(item.message?.id)||!id(item.message.threadId))fail('invalid_google_history',502);return{id:item.message.id,threadId:item.message.threadId}});if(added.length>1000||new Set(added.map(m=>m.id)).size!==added.length)fail('invalid_google_history',502);return{id:entry.id!,added}});
   const proof:GooglePageProof={id:randomUUID(),accountId:lease.accountId,accountVersion:lease.accountVersion,baselineVersion:r.baseline_version,origin:requested==='live'&&r.anchored===1?'live':requested==='catchup'?'catchup':'repair',afterCursor:after,throughCursor:page.historyId,entries};
   this.store.db.prepare('INSERT INTO google_ingress_pages VALUES(?,?,?)').run(proof.id,JSON.stringify(proof),sha(proof));return proof;
  });
 }
 private source(lease:GoogleReadLease,providerMessageId:string,providerThreadId:string){
  if(!id(providerMessageId)||!id(providerThreadId))fail('invalid_google_message',502);
  let row=this.store.db.prepare('SELECT source_ref,provider_thread_id FROM google_ingress_sources WHERE account_id=? AND account_version=? AND provider_message_id=?').get(lease.accountId,lease.accountVersion,providerMessageId);
  if(!row){const ref=randomUUID();this.store.db.prepare('INSERT INTO google_ingress_sources VALUES(?,?,?,?,?)').run(lease.accountId,lease.accountVersion,providerMessageId,providerThreadId,ref);row={source_ref:ref,provider_thread_id:providerThreadId}}
  if(row.provider_thread_id!==providerThreadId)fail('google_ingress_source_conflict');return String(row.source_ref);
 }
 sourceVersion(accountId:string,sourceRef:string,inputVersion:string):GoogleSourceVersion{
  const {version}=this.account(accountId),row=this.store.db.prepare('SELECT s.provider_message_id,s.provider_thread_id,v.data,v.integrity FROM google_ingress_sources s JOIN google_ingress_versions v ON v.source_ref=s.source_ref WHERE s.account_id=? AND s.account_version=? AND s.source_ref=? AND v.input_version=?').get(accountId,version,sourceRef,inputVersion);
  if(!row)fail('google_ingress_source_not_found',404);
  try{const value=JSON.parse(String(row.data)) as GoogleSourceVersion;if(sha(value)!==row.integrity||value.accountId!==accountId||value.accountVersion!==version||value.sourceRef!==sourceRef||value.inputVersion!==inputVersion||value.providerMessageId!==row.provider_message_id||value.providerThreadId!==row.provider_thread_id||value.message.id!==value.providerMessageId||sha({message:value.message,replyMetadata:value.replyMetadata})!==inputVersion||sha({providerThreadId:value.providerThreadId,message:value.message,replyMetadata:value.replyMetadata})!==value.immutableFactsHash)throw Error();return structuredClone(value)}catch{return fail('google_ingress_corrupt',500)}
 }
 publish(lease:GoogleReadLease,thread:Thread,proof:GooglePageProof|undefined,origin:'initial'|'repair'='repair',headers:Map<string,GoogleReplyMetadata>=new Map()){
  if(!this.store.db.isTransaction)fail('google_ingress_publication_transaction_required');const r=this.assert(lease);if(thread.accountId!==lease.accountId||!thread.providerId||thread.id!==`${lease.accountId}:${thread.providerId}`)fail();
  if(proof){const stored=this.store.db.prepare('SELECT data,integrity FROM google_ingress_pages WHERE id=?').get(proof.id);if(!stored||stored.data!==JSON.stringify(proof)||stored.integrity!==sha(proof)||proof.accountId!==lease.accountId||proof.accountVersion!==lease.accountVersion||proof.baselineVersion!==r.baseline_version)fail('google_ingress_corrupt',500)}
  const occurrences:IngressVersion[]=[];let sequence=r.sequence;
  for(const message of thread.messages){
   const sourceRef=this.source(lease,message.id,thread.providerId),content=messageSourceValue(message),replyMetadata=headers.get(message.id)??{headersComplete:false,replyTo:null};
   const inputVersion=sha({message:content,replyMetadata}),facts=sha({providerThreadId:thread.providerId,message:content,replyMetadata});
   const source:GoogleSourceVersion={accountId:lease.accountId,accountVersion:lease.accountVersion,sourceRef,inputVersion,providerMessageId:message.id,providerThreadId:thread.providerId,message:content,replyMetadata,immutableFactsHash:facts};
   this.store.db.prepare('INSERT INTO google_ingress_versions VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(sourceRef,inputVersion,JSON.stringify(source),sha(source));
   const committed=this.sourceVersion(lease.accountId,sourceRef,inputVersion);if(sha(committed)!==sha(source))fail('google_ingress_source_conflict');
   if(proof?.origin!=='live')continue;
   const entries=proof.entries.filter(e=>e.added.some(m=>m.id===message.id&&m.threadId===thread.providerId));if(!entries.length)continue;
   const prior=this.store.db.prepare('SELECT data,integrity FROM google_ingress_occurrences WHERE account_id=? AND account_version=? AND source_ref=? AND input_version=?').get(lease.accountId,lease.accountVersion,sourceRef,inputVersion);
   let occurrence:IngressVersion;
   if(prior){
    try{occurrence=parseIngressVersion(JSON.parse(String(prior.data)),{accountId:lease.accountId,accountVersion:lease.accountVersion});
     if(sha(occurrence)!==prior.integrity||occurrence.accountId!==committed.accountId||occurrence.accountVersion!==committed.accountVersion||occurrence.sourceRef!==committed.sourceRef||occurrence.inputVersion!==committed.inputVersion||occurrence.immutableFactsHash!==committed.immutableFactsHash||occurrence.providerInternalDate!==committed.message.date)throw Error();
    }catch{return fail('google_ingress_corrupt',500)}
   }
   else{const entry=entries[0];sequence=next(sequence);occurrence=parseIngressVersion({version:1,id:randomUUID(),accountId:lease.accountId,accountVersion:lease.accountVersion,sequence,sourceRef,inputVersion,providerInternalDate:message.date,committedAt:new Date(this.now()).toISOString(),origin:'google-live-history-message-added',history:{entryId:entry.id,afterCursor:proof.afterCursor,throughCursor:proof.throughCursor,addedSourceRefs:entry.added.map(m=>this.source(lease,m.id,m.threadId))},baselineVersion:r.baseline_version,immutableFactsHash:facts},{accountId:lease.accountId,accountVersion:lease.accountVersion});this.store.db.prepare('INSERT INTO google_ingress_occurrences VALUES(?,?,?,?,?,?)').run(lease.accountId,lease.accountVersion,sourceRef,inputVersion,JSON.stringify(occurrence),sha(occurrence))}
   occurrences.push(occurrence);
  }
  this.store.db.prepare('UPDATE google_ingress_meta SET sequence=? WHERE account_id=?').run(sequence,lease.accountId);
  const result=this.options.onPublication?.(structuredClone({accountId:lease.accountId,accountVersion:lease.accountVersion,origin:proof?.origin??origin,thread,occurrences,history:proof??null}));if(result&&typeof(result as Promise<unknown>).then==='function')fail('google_ingress_async_observer_forbidden',500);
 }
 close(){if(this.closed)return;this.closed=true;this.store.db.prepare('UPDATE google_ingress_meta SET lease_id=NULL,owner=NULL,pid=NULL,expires_at=NULL,complete=0 WHERE owner=?').run(this.owner)}
}
