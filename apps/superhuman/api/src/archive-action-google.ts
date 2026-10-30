import type {GoogleProvider} from './google.ts';
import {HttpError} from './types.ts';
export type ArchiveNativeInput={accountId:string;
providerThreadId:string;
addInbox:boolean;
removeInbox:boolean};
export type ArchiveNativeGuard={signal:AbortSignal;
beforeIssue:()=>void;
onAck:(value:{providerThreadId:string})=>void};
function race<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(signal.reason);
return new Promise((resolve,reject)=>{const stop=()=>{signal.removeEventListener('abort',stop);
reject(signal.reason)}
;
signal.addEventListener('abort',stop,{once:true});
promise.then(value=>{signal.removeEventListener('abort',stop);
resolve(value)}
,error=>{signal.removeEventListener('abort',stop);
reject(error)}
)}
)}
/** Dedicated ordinary label mutation. No Reminder command/transport or retry. */
export async function googleArchiveAction(google:GoogleProvider,input:ArchiveNativeInput,guard:ArchiveNativeGuard){
 if(!/^[A-Za-z0-9_-]{1,256}$/.test(input.providerThreadId)||input.addInbox===input.removeInbox)throw new HttpError(409,'Archive target is unavailable','archive_native_scope');
 const signal=AbortSignal.any([guard.signal,AbortSignal.timeout(20000)]),tokens=await race(google.tokens(input.accountId),signal);
signal.throwIfAborted();
 const url=`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.providerThreadId)}/modify`,body=JSON.stringify({addLabelIds:input.addInbox?['INBOX']:[],removeLabelIds:input.removeInbox?['INBOX']:[]});
 signal.throwIfAborted();
guard.beforeIssue();
 const pending=google.fetcher(url,{method:'POST',body,headers:{authorization:`Bearer ${tokens.access_token}`,'content-type':'application/json'},signal,redirect:'manual',credentials:'omit'});
 void pending.then(response=>{if(signal.aborted)void response.body?.cancel().catch(()=>{}
)}
,()=>{}
);
 const response=await race(pending,signal);
let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
 try{
  if(response.redirected||response.status!==200)throw new HttpError(502,'Archive response is unconfirmed','archive_native_unknown');
  const length=response.headers.get('content-length');
if(length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)>262144))throw new HttpError(502,'Archive response is too large','archive_native_unknown');
  reader=response.body?.getReader();
if(!reader)throw new HttpError(502,'Archive response is empty','archive_native_unknown');
const parts:Uint8Array[]=[];
let size=0;
  for(;
;
){const next=await race(reader.read(),signal);
if(next.done){complete=true;
break}
size+=next.value.byteLength;
if(size>262144)throw new HttpError(502,'Archive response is too large','archive_native_unknown');
parts.push(next.value)}
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
if(!result||result.id!==input.providerThreadId)throw new HttpError(502,'Archive response target changed','archive_native_unknown');
  // Preserve a decoded positive ACK before any later Stop/source refusal.
  guard.onAck({providerThreadId:result.id});
signal.throwIfAborted();
return{providerThreadId:result.id};
 }
finally{if(reader){if(!complete)void reader.cancel().catch(()=>{}
);
try{reader.releaseLock()}
catch{}
}
else void response.body?.cancel().catch(()=>{}
)}
}
