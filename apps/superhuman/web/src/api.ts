import type { Account, Draft, Label, Preferences, Thread, ThreadSummary, ThreadListOptions, ThreadListPage } from '../../api/src/types.ts';
export type { Account, Draft, Label, Preferences, Thread, ThreadSummary, ThreadListOptions, ThreadListPage };
export type Bootstrap={archiveAccountVersions?:Record<string,string|null>;accounts:Account[];activeAccountId:string;threads:Thread[];labels:Label[];drafts:Draft[];preferences:Preferences;providerStatus:Record<string,unknown>};
export type AccountSync={phase:'not-started'|'initial'|'history';partial:boolean;status?:'idle'|'queued'|'running'|'ready'|'error';lastCompletedAt?:string;resultSizeEstimate?:number;updatedAt?:string;code?:string;error?:string;nextSyncAt?:string;failureCount?:number;lastErrorAt?:string;lastSuccessAt?:string;requiresReconnect?:boolean;catchupAt?:string;catchupPending?:number;lastResetReason?:string};
export class ApiError extends Error{code?:string;status:number;constructor(message:string,status:number,code?:string){super(message);this.name='ApiError';this.status=status;this.code=code}}
export async function api<T=any>(path:string,body?:unknown,method=body===undefined?'GET':'POST',options:{signal?:AbortSignal}={}):Promise<T>{
  const response=await fetch('/api'+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:options.signal});
  const result=await response.json();if(!response.ok)throw new ApiError(result.error?.message||result.message||(typeof result.error==='string'?result.error:undefined)||`Request failed (${response.status})`,response.status,result.error?.code);return result;
}
