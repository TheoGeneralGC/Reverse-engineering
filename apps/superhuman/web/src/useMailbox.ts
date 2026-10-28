import { useCallback,useLayoutEffect,useRef,useState } from 'react';
import { api } from './api.ts';
import type { Thread,ThreadListPage } from './api.ts';
import { createMailboxList,emptyMailbox,mailboxKey,summaryPath } from './mailbox-list.ts';
import type { MailboxContext,MailboxList,MailboxSnapshot } from './mailbox-list.ts';

export default function useMailbox(context:MailboxContext|null){
 const key=context?mailboxKey(context):'',list=useRef<MailboxList|null>(null);
 const [snapshot,setSnapshot]=useState<{key:string;state:MailboxSnapshot}>({key:'',state:emptyMailbox()});
 useLayoutEffect(()=>{
  if(!context)return;const next=createMailboxList(context,{readPage:options=>api<ThreadListPage>(summaryPath(options)),readThread:async id=>(await api<{thread:Thread}>(`/threads/${encodeURIComponent(id)}`)).thread,onChange:state=>setSnapshot({key,state})});
  list.current=next;void next.refresh().catch(()=>{});return()=>{next.dispose();if(list.current===next)list.current=null};
 },[key]);
 const refresh=useCallback(()=>list.current?.refresh()||Promise.resolve(),[]),loadMore=useCallback(()=>list.current?.loadMore()||Promise.resolve(),[]),move=useCallback((delta:number)=>list.current?.move(delta)||Promise.resolve(undefined),[]),select=useCallback((id:string)=>list.current?.select(id),[]),resetSelection=useCallback(()=>list.current?.resetSelection(),[]),readThread=useCallback((id:string)=>list.current?.readThread(id)||Promise.resolve(null),[]),cancelDetail=useCallback(()=>list.current?.cancelDetail(),[]),updateSummary=useCallback((id:string,patch:Parameters<MailboxList['updateSummary']>[1])=>list.current?.updateSummary(id,patch),[]);
 const getSnapshot=useCallback(()=>list.current?.getSnapshot(),[]),settleSelection=useCallback(()=>list.current?.settleSelection()||Promise.resolve(undefined),[]);
 return{getSnapshot,settleSelection,...(snapshot.key===key?snapshot.state:emptyMailbox()),refresh,loadMore,move,select,resetSelection,readThread,cancelDetail,updateSummary};
}
