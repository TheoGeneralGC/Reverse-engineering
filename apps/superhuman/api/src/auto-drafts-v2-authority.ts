import {AutoDraftReadinessAuthority,type AutoDraftModelProfileInput} from './auto-drafts-readiness.ts';
import {GoogleSendAsCache} from './google-send-as-cache.ts';
import {AutoDraftsV2} from './auto-drafts-v2.ts';
import type {AutoDraftRuntimeOptions} from './auto-drafts-runtime.ts';
import type {SyncLimits} from './google.ts';
import type {Store} from './store.ts';
import {HttpError} from './types.ts';

export type AutoDraftsV2AuthorityOptions=Pick<AutoDraftRuntimeOptions,'processing'|'replyTimeZone'|'model'|'googleEnvironment'|'googleFetch'|'now'|'schedule'|'settledPause'>&{cursorKey:Uint8Array;webOrigin?:string;maximumIdentityAgeMs?:number;identityLeaseMs?:number};

/** Private explicit composition. One GoogleProvider owns sync and authenticated
 * identity reads. Construction installs only local schema; it does not adopt
 * accounts, load configuration, read identities, sync or dispatch a model. */
export class AutoDraftsV2Authority{
 readonly authority:AutoDraftReadinessAuthority;readonly facade:AutoDraftsV2;readonly cache:GoogleSendAsCache;
 private closed=false;private readonly processing:boolean;
 constructor(store:Store,options:AutoDraftsV2AuthorityOptions){
  this.processing=options.processing===true;let facade:AutoDraftsV2|undefined;
  this.authority=new AutoDraftReadinessAuthority(store,{ingress:id=>{if(!facade)throw Error('Automatic draft composition not ready');return facade.runtime.producer.readiness(id)},now:options.now,maxIdentityAgeMs:options.maximumIdentityAgeMs});
  const authority=this.authority;
  this.facade=facade=new AutoDraftsV2(store,{...options,accountVersion:authority.accountVersion,configuration:id=>this.processing?authority.configuration(id):null,identity:id=>authority.identity(id),readinessAuthority:id=>{const r=authority.readiness(id);return this.processing?r:{...r,configuration:null}},observeReadinessAuthority:id=>{authority.observeIdentityFreshness(id);authority.observeIngress(id)},authorityWitness:id=>authority.latestEvent(id)});
  this.cache=new GoogleSendAsCache(authority,{leaseMs:options.identityLeaseMs,read:(id,path,read)=>this.facade.runtime.google.request(id,path,{method:read.method,signal:read.signal},undefined,{signal:read.signal,beforeIssue:read.beforeIssue})});
 }
 private open(){if(this.closed)throw new HttpError(503,'Automatic draft authority stopped','auto_draft_generation_stopping')}
 /** Explicit network-free startup adoption, never a GET or constructor effect. */
 adoptAccounts(){this.open();return this.authority.adoptAccounts()}
 async install(accountId:string){this.open();return this.facade.install(accountId)}
 async settle(accountId:string){this.open();this.facade.runtime.observeReadiness(accountId);return this.facade.status.flush(accountId)}
 async observeModelProfile(accountId:string,input:AutoDraftModelProfileInput){this.open();const profile=this.authority.observeModelProfile(accountId,this.processing?input:{...input,credentialAvailable:false});await this.settle(accountId);return profile}
 /** Explicit internal authenticated read; no HTTP route or automatic timer. */
 async refreshIdentity(accountId:string){this.open();const value=await this.cache.refresh(accountId);this.open();await this.settle(accountId);return value}
 async sync(accountId:string,limits:SyncLimits={}){this.open();return this.facade.sync(accountId,limits)}
 run(accountId:string,id:string){this.open();return this.facade.run(accountId,id)}
 handle(request:Request){return this.facade.handle(request)}
 close(){if(this.closed)return;this.closed=true;this.cache.close();this.facade.close()}
}
