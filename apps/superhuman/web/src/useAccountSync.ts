import { useCallback,useEffect,useRef,useState } from 'react';
import { api } from './api.ts';
import type { AccountSync } from './api.ts';
import { createSyncMonitor,syncFailure } from './sync-state.ts';

export default function useAccountSync(accountId:string|undefined,provider:string|undefined,onChange:()=>void){
 const [snapshot,setSnapshot]=useState<{accountId:string;sync:AccountSync}|null>(null),[retryingAccount,setRetryingAccount]=useState<string|null>(null);
 const callback=useRef(onChange),monitor=useRef<ReturnType<typeof createSyncMonitor>|null>(null),active=useRef(accountId),retrying=useRef(new Set<string>());
 callback.current=onChange;active.current=accountId;
 useEffect(()=>{
  if(!accountId||provider!=='google')return;
  const next=createSyncMonitor({read:async()=>{const result=await api<{sync:AccountSync}>(`/accounts/${encodeURIComponent(accountId)}/sync`);return result.sync},onStatus:sync=>setSnapshot({accountId,sync}),onChange:()=>callback.current()});
  monitor.current=next;void next.check();return()=>{next.stop();if(monitor.current===next)monitor.current=null};
 },[accountId,provider]);
 const retry=useCallback(async()=>{
  if(!accountId||provider!=='google'||retrying.current.has(accountId))return;
  retrying.current.add(accountId);setRetryingAccount(accountId);
  setSnapshot(previous=>({accountId,sync:{phase:'not-started',partial:true,...(previous?.accountId===accountId?previous.sync:{}),status:'queued',error:undefined,code:undefined}}));
  try{await api(`/accounts/${encodeURIComponent(accountId)}/sync`,{});if(active.current===accountId){await monitor.current?.check();callback.current()}}
  catch(error){if(active.current===accountId)setSnapshot(previous=>({accountId,sync:syncFailure(error,previous?.accountId===accountId?previous.sync:null)}))}
  finally{retrying.current.delete(accountId);setRetryingAccount(previous=>previous===accountId?null:previous)}
 },[accountId,provider]);
 return{sync:accountId&&snapshot?.accountId===accountId?snapshot.sync:null,retrying:retryingAccount===accountId,retry};
}
