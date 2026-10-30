import {ReminderRuntime,type ReminderRuntimeOptions} from './reminder-runtime.ts';
import type {Store} from './store.ts';
import type {GoogleProvider} from './google.ts';
import type {ReminderSnapshot} from './reminder-contract.ts';
import {HttpError} from './types.ts';

export type ReminderNativeConfiguration=Omit<ReminderRuntimeOptions,'now'>&{automatic?:boolean;googleFetch?:typeof fetch};
export type ReminderScheduler={now:()=>number;schedule:(callback:()=>void,delayMs:number)=>{cancel:()=>void}};
export function validateReminderNativeConfiguration(value:unknown):asserts value is ReminderNativeConfiguration{
 const v=value as ReminderNativeConfiguration;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['key','keyId','important','automatic','googleFetch'].includes(k))||!(v.key instanceof Uint8Array)||v.key.byteLength!==32||typeof v.keyId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(v.keyId)||v.important!==undefined&&typeof v.important!=='boolean'||v.automatic!==undefined&&typeof v.automatic!=='boolean'||v.googleFetch!==undefined&&typeof v.googleFetch!=='function')throw new TypeError('Invalid native reminder configuration');
}
/** Explicit injected owner. No file/env fallback, constructor IO or implicit
 * capability activation. Stop fences issue synchronously; wait drains all work. */
export class ReminderNativeOwner{
 private readonly runtime:ReminderRuntime;readonly service:ReminderRuntime['service'];
 private readonly pending=new Set<Promise<unknown>>();private stopped=false;private started=false;private timer?:{cancel:()=>void};private tickPromise?:Promise<void>;
 readonly store:Store;readonly scheduler:ReminderScheduler;readonly automatic:boolean;
 constructor(store:Store,google:GoogleProvider,scheduler:ReminderScheduler,automatic:boolean,options:ReminderRuntimeOptions){this.store=store;this.scheduler=scheduler;this.automatic=automatic;this.runtime=new ReminderRuntime(store,google,options);this.service=this.runtime.service}
 assertOpen(){if(this.stopped)throw new HttpError(503,'Reminders are stopping','reminder_stopping');this.service.assertOpen()}
 status(){return{configured:true,stopping:this.stopped,automatic:this.started,capabilities:{schedule:false,conditional:false,draftReminder:false,returnedOccurrences:false,followUpGeneration:false}}as const}
 work<T>(task:()=>Promise<T>):Promise<T>{this.assertOpen();const p=Promise.resolve().then(()=>{this.assertOpen();return task()});this.pending.add(p);void p.then(()=>this.pending.delete(p),()=>this.pending.delete(p));return p}
 adoptAccounts(){this.assertOpen();return this.runtime.adoptAccounts()}
 context(accountId:string,threadId:string){return this.work(()=>this.runtime.context(accountId,threadId))}
 schedule(value:unknown){return this.work(()=>this.runtime.schedule(value))}
 runDue(accountId:string,threadId:string){return this.work(()=>this.runtime.runDue(accountId,threadId))}
 continuePrepared(accountId:string,threadId:string,attemptRef:string){return this.work(()=>this.runtime.continuePrepared(accountId,threadId,attemptRef))}
 reconcile(accountId:string,threadId:string,attemptRef:string){return this.work(()=>this.runtime.reconcile(accountId,threadId,attemptRef))}
 start(){this.assertOpen();if(!this.automatic||this.started)return;this.adoptAccounts();this.started=true;this.scheduleTick()}
 private scheduleTick(){if(!this.stopped&&this.started)this.timer=this.scheduler.schedule(()=>{this.timer=undefined;if(this.stopped)return;void this.tick().catch(()=>{}).finally(()=>this.scheduleTick())},1000)}
 tick():Promise<void>{this.assertOpen();if(this.tickPromise)return this.tickPromise;const p=this.work(async()=>{
  const now=this.scheduler.now(),due=this.store.db.prepare("SELECT s.account_id,s.account_version,s.thread_id,s.data FROM reminder_slots s WHERE json_extract(s.data,'$.current.phase')='scheduled' AND json_extract(s.data,'$.current.triggerAt')<=? AND EXISTS(SELECT 1 FROM reminder_wake_attempts p JOIN reminder_wake_attempts o ON o.account_id=p.account_id AND o.account_version=p.account_version AND o.thread_id=p.thread_id AND json_extract(o.data,'$.attemptRef')=json_extract(p.data,'$.attemptRef') WHERE p.account_id=s.account_id AND p.account_version=s.account_version AND p.thread_id=s.thread_id AND p.reminder_ref=json_extract(s.data,'$.current.ref') AND json_extract(p.data,'$.purpose')='archive' AND json_extract(p.data,'$.stage')='prepared' AND json_extract(o.data,'$.stage')='observed') ORDER BY s.account_id,s.thread_id LIMIT 32").all(new Date(now).toISOString());
  for(const row of due){this.assertOpen();const snapshot=JSON.parse(String(row.data))as ReminderSnapshot;if(this.service.accounts.version(String(row.account_id))!==row.account_version||snapshot.accountVersion!==row.account_version)continue;const journals=this.service.nativePort().journals({accountId:String(row.account_id),accountVersion:String(row.account_version),threadId:String(row.thread_id)}),placement=journals.find(x=>x.record.stage==='prepared'&&x.record.purpose==='archive'&&x.record.reminderRef===snapshot.current?.ref);if(!placement||!journals.some(x=>x.record.attemptRef===placement.record.attemptRef&&x.record.stage==='observed'))continue;await this.runtime.runDue(String(row.account_id),String(row.thread_id));this.assertOpen()}
 });this.tickPromise=p;void p.then(()=>{this.tickPromise=undefined},()=>{this.tickPromise=undefined});return p}
 close(){if(this.stopped)return;this.stopped=true;this.timer?.cancel();this.timer=undefined;this.runtime.close()}
 async waitForIdle(){while(this.pending.size)await Promise.allSettled([...this.pending])}
 async closeAndWait(){this.close();await this.waitForIdle()}
}
