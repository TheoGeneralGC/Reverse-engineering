import type {GoogleProvider} from './google.ts';
import type {Store} from './store.ts';
import type {Account,Message,Thread} from './types.ts';
import {currentAccountIncarnation} from './account-incarnation.ts';
import {credentialGrantMutationEpoch} from './google-credential-maintenance.ts';
import {trashFail,trashHash,trashId} from './trash-action-contract.ts';

export type TrashObservedMessage={id:string;sourceHash:string;labels:string[]};
export type TrashObservation={providerThreadId:string;messages:TrashObservedMessage[];profileEmail:string|null;observedAt:string};
export type TrashNativeInput={accountId:string;providerThreadId:string};
export type TrashReadGuard={signal:AbortSignal;check:()=>void};
export type TrashWriteGuard=TrashReadGuard&{beforeIssue:()=>void;onAck:(providerThreadId:string)=>void};
export type TrashNative={
 read:(input:TrashNativeInput,profile:'required'|'if-stale'|'none',guard:TrashReadGuard)=>Promise<TrashObservation>;
 modify:(input:TrashNativeInput&{addLabelIds:string[];removeLabelIds:string[]},guard:TrashWriteGuard)=>Promise<void>;
};
export const trashLabelSet=(values:string[])=>[...new Set(values)].sort();
const people=(values:Message['to'])=>values.map(p=>p.email.toLowerCase());
export function trashMessageHash(m:Message){return trashHash({id:m.id,from:m.sender.email.toLowerCase(),to:people(m.to),cc:people(m.cc??[]),date:m.date,internetMessageId:m.internetMessageId??null,references:m.references??null,text:m.text,html:m.html??null,attachments:m.attachments.map(a=>({id:a.id,name:a.name,mimeType:a.mimeType,size:a.size,partId:a.partId??null,contentId:a.contentId??null}))})}
export function trashCachedMessages(thread:Thread):TrashObservedMessage[]{
 if(!Array.isArray(thread.messages)||thread.messages.length<1||thread.messages.length>50)trashFail('trash_source_limit');
 return thread.messages.map(m=>{if(!trashId(m.id)||!Array.isArray(m.providerLabels))trashFail('trash_native_scope');return{id:m.id,sourceHash:trashMessageHash(m),labels:trashLabelSet(m.providerLabels)}}).sort((a,b)=>a.id.localeCompare(b.id));
}
function race<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(signal.reason);return new Promise((resolve,reject)=>{const stop=()=>{signal.removeEventListener('abort',stop);reject(signal.reason)};signal.addEventListener('abort',stop,{once:true});work.then(v=>{signal.removeEventListener('abort',stop);resolve(v)},e=>{signal.removeEventListener('abort',stop);reject(e)})})}
function labels(value:unknown):string[]{if(!Array.isArray(value)||value.length>1000||value.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(x))||new Set(value).size!==value.length)trashFail('trash_native_scope');return trashLabelSet(value)}
export function validateTrashObservation(value:TrashObservation,input:TrashNativeInput):TrashObservation{
 if(!value||value.providerThreadId!==input.providerThreadId||!Array.isArray(value.messages)||value.messages.length<1||value.messages.length>50||new Set(value.messages.map(m=>m.id)).size!==value.messages.length||!Number.isFinite(Date.parse(value.observedAt)))trashFail('trash_native_scope');
 for(const m of value.messages)if(!trashId(m.id)||!/^[a-f0-9]{64}$/.test(m.sourceHash)||labels(m.labels).includes('DRAFT'))trashFail('trash_ineligible');
 return structuredClone({...value,messages:value.messages.map(m=>({...m,labels:labels(m.labels)})).sort((a,b)=>a.id.localeCompare(b.id))});
}

/** Dedicated ordinary MAIL adapter. No generic retry, Reminder or Send route. */
export function googleTrashNative(google:GoogleProvider,store:Store,now=Date.now):TrashNative{
 const identity=new Map<string,{sealed:string;version:string;at:number;email:string}>();
 const credential=async(input:TrashNativeInput,guard:TrashReadGuard)=>{
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(input.providerThreadId))trashFail('trash_native_scope');
  const signal=guard.signal;guard.check();const token=await race(google.tokens(input.accountId),signal);guard.check();signal.throwIfAborted();
  const account=store.required<Account>('account',input.accountId),version=currentAccountIncarnation(store,input.accountId),sealed=store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(input.accountId)?.value,grant=store.get<unknown>('googleGrant','mail:'+input.accountId),epoch=credentialGrantMutationEpoch(store,'mail:'+input.accountId);
  if(account.provider!=='google'||typeof sealed!=='string')trashFail('trash_grant_changed');const grantHash=trashHash(grant);
  const check=()=>{signal.throwIfAborted();guard.check();const a=store.required<Account>('account',input.accountId);if(a.provider!=='google'||a.email.toLowerCase()!==account.email.toLowerCase()||currentAccountIncarnation(store,input.accountId)!==version||store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(input.accountId)?.value!==sealed||trashHash(store.get('googleGrant','mail:'+input.accountId))!==grantHash||credentialGrantMutationEpoch(store,'mail:'+input.accountId)!==epoch)trashFail('trash_grant_changed')};
  check();return{token,account,version,sealed,check};
 };
 const json=async(url:string,init:RequestInit,signal:AbortSignal,check:()=>void,max:number,onAck?:(v:any)=>void)=>{
  check();const pending=google.fetcher(url,{...init,signal,redirect:'manual',credentials:'omit'});void pending.then(r=>{if(signal.aborted)void r.body?.cancel().catch(()=>{})},()=>{});const response=await race(pending,signal);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
  try{if(response.redirected||response.status!==200)trashFail('trash_native_unconfirmed');const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d{1,12}$/.test(declared)||Number(declared)>max))trashFail('trash_source_limit');reader=response.body?.getReader();if(!reader)trashFail('trash_native_unconfirmed');const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await race(reader.read(),signal);if(part.done){complete=true;break}size+=part.value.byteLength;if(size>max)trashFail('trash_source_limit');chunks.push(part.value)}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));onAck?.(value);check();return value}
  finally{if(reader){if(!complete)void reader.cancel().catch(()=>{});try{reader.releaseLock()}catch{}}else void response.body?.cancel().catch(()=>{})}
 };
 return{
  async read(input,profile,guard){input=structuredClone(input);
   const signal=AbortSignal.any([guard.signal,AbortSignal.timeout(20000)]),g={...guard,signal},c=await credential(input,g),cached=identity.get(input.accountId);let email:string|null=null;
   const headers={authorization:`Bearer ${c.token.access_token}`};
   if(profile==='required'||profile==='if-stale'&&(!cached||cached.sealed!==c.sealed||cached.version!==c.version||now()-cached.at>60000)){
    await race(google.paceOrdinaryActionRead(input.accountId,'profile',{signal,check:c.check}),signal);c.check();const value=await json('https://gmail.googleapis.com/gmail/v1/users/me/profile',{method:'GET',headers},signal,c.check,262144);
    if(typeof value?.emailAddress!=='string'||value.emailAddress.toLowerCase()!==c.account.email.toLowerCase())trashFail('trash_account_changed');email=value.emailAddress.toLowerCase();identity.set(input.accountId,{sealed:c.sealed,version:c.version,at:now(),email:email!});
   }
   await race(google.paceOrdinaryActionRead(input.accountId,'thread',{signal,check:c.check}),signal);c.check();const value=await json(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.providerThreadId)}?format=full`,{method:'GET',headers},signal,c.check,4194304);
   if(value?.id!==input.providerThreadId||!Array.isArray(value.messages)||value.messages.length<1||value.messages.length>50)trashFail('trash_source_limit');
   const messages=value.messages.map((raw:any)=>{if(raw?.threadId!==input.providerThreadId||!trashId(raw.id)||!Number.isFinite(Number(raw.internalDate)))trashFail('trash_native_scope');const seen=new Set<object>();let parts=0;const complete=(part:any,depth=0)=>{if(!part||typeof part!=='object'||seen.has(part)||depth>20||++parts>500)trashFail('trash_native_scope');seen.add(part);if(/^text\//.test(part.mimeType??'')&&Number(part.body?.size)>0&&typeof part.body?.data!=='string')trashFail('trash_native_scope');for(const p of part.parts??[])complete(p,depth+1)};complete(raw.payload);return{id:raw.id,sourceHash:trashMessageHash(google.normalizeMessage(raw)),labels:labels(raw.labelIds)}});
   return validateTrashObservation({providerThreadId:value.id,messages,profileEmail:email,observedAt:new Date(now()).toISOString()},input);
  },
  async modify(input,guard){input=structuredClone(input);
   const add=labels(input.addLabelIds),remove=labels(input.removeLabelIds);if(add.some(v=>!['INBOX','TRASH'].includes(v))||remove.some(v=>!['INBOX','TRASH'].includes(v))||add.some(v=>remove.includes(v))||add.length+remove.length===0)trashFail('trash_native_scope');
   const signal=AbortSignal.any([guard.signal,AbortSignal.timeout(20000)]),g={...guard,signal},c=await credential(input,g);const verified=identity.get(input.accountId);if(!verified||verified.sealed!==c.sealed||verified.version!==c.version||now()-verified.at>60000)trashFail('trash_account_changed');c.check();guard.beforeIssue();signal.throwIfAborted();
   // The durable issue guard is immediately adjacent to the sole fetch. No
   // observer publication, await or retry occurs between it and invocation.
   await json(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.providerThreadId)}/modify`,{method:'POST',headers:{authorization:`Bearer ${c.token.access_token}`,'content-type':'application/json'},body:JSON.stringify({addLabelIds:add,removeLabelIds:remove})},signal,()=>{signal.throwIfAborted()},262144,value=>{if(value?.id!==input.providerThreadId)trashFail('trash_native_unconfirmed');guard.onAck(value.id)});
   c.check();
  }
 };
}
