import { useCallback,useLayoutEffect,useRef,useState } from 'react';
import { api } from './api.ts';
import type { Thread,ThreadListPage } from './api.ts';
import {checkedSplitPage} from './split-inbox-client.ts';
import { browserMailboxContext,createMailboxList,emptyMailbox,mailboxKey,summaryPath } from './mailbox-list.ts';
import type { MailboxContext,MailboxList,MailboxSnapshot } from './mailbox-list.ts';

export default function useMailbox(input:MailboxContext|null){
 const context=browserMailboxContext(input);
 const key=context?mailboxKey(context):'',list=useRef<MailboxList|null>(null);
 const [snapshot,setSnapshot]=useState<{key:string;state:MailboxSnapshot}>({key:'',state:emptyMailbox()});
 useLayoutEffect(()=>{
  if(!context)return;const controller=new AbortController();const next=createMailboxList(context,{readPage:async options=>{const raw=await api<ThreadListPage>(summaryPath(options),undefined,'GET',{signal:controller.signal});if(!context.viewRef)return raw;const page=checkedSplitPage(raw,{accountId:context.accountId,viewRef:context.viewRef,settingsRevision:context.settingsRevision!,policyVersion:context.policyVersion!});return{threads:page.threads,total:page.total,counts:{inbox:0,important:0,other:0,calendar:0},hasMore:page.hasMore,nextCursor:page.nextCursor,viewIdentity:{viewRef:page.viewRef,settingsRevision:page.settingsRevision,sourceGeneration:page.sourceGeneration,policyVersion:page.policyVersion},coverage:page.coverage};},readThread:async(id,detailSignal,onCached)=>{const signal=AbortSignal.any([controller.signal,detailSignal]),thread=(await api<{thread:Thread}>(`/threads/${encodeURIComponent(id)}`,undefined,'GET',{signal})).thread;if(thread.accountId!==context.accountId)throw Error('Conversation belongs to a different account');if(!thread.reminderPresentation?.requiresHydration)return thread;onCached(thread);return(await api<{thread:Thread}>(`/threads/${encodeURIComponent(id)}/hydrate`,{accountId:context.accountId,expectedVersion:thread.reminderPresentation.versionHash},'POST',{signal})).thread},onChange:state=>setSnapshot({key,state})});
  list.current=next;void next.refresh().catch(()=>{});return()=>{controller.abort();next.dispose();if(list.current===next)list.current=null};
 },[key]);
 const refresh=useCallback(()=>list.current?.refresh()||Promise.resolve(),[]),loadMore=useCallback(()=>list.current?.loadMore()||Promise.resolve(),[]),move=useCallback((delta:number)=>list.current?.move(delta)||Promise.resolve(undefined),[]),select=useCallback((id:string)=>list.current?.select(id),[]),resetSelection=useCallback(()=>list.current?.resetSelection(),[]),readThread=useCallback((id:string,onCached?:(thread:Thread)=>void)=>list.current?.readThread(id,onCached)||Promise.resolve(null),[]),cancelDetail=useCallback(()=>list.current?.cancelDetail(),[]),updateSummary=useCallback((id:string,patch:Parameters<MailboxList['updateSummary']>[1])=>list.current?.updateSummary(id,patch),[]);
 const reserveDone=useCallback((requestId:string,id?:string,fallback?:import('./api.ts').ThreadSummary,onReserved?:(r:import('./mailbox-list.ts').DoneReservation)=>void)=>list.current?.reserveDone(requestId,id,fallback,onReserved)||Promise.resolve(null),[]),finishDone=useCallback((reservation:Parameters<MailboxList['finishDone']>[0],outcome:Parameters<MailboxList['finishDone']>[1])=>list.current?.finishDone(reservation,outcome)??false,[]),hasDone=useCallback((id:string,sourceIdentity?:string)=>list.current?.hasDone(id,sourceIdentity)??false,[]);
 const reserveDismissal=useCallback((...args:Parameters<MailboxList['reserveDismissal']>)=>list.current?.reserveDismissal(...args)||Promise.resolve(null),[]);
 const discardDismissal=useCallback((...args:Parameters<MailboxList['discardDismissal']>)=>list.current?.discardDismissal(...args)??false,[]);
 const restoreDone=useCallback((reservation:Parameters<MailboxList['restoreDone']>[0],detail?:Thread)=>list.current?.restoreDone(reservation,detail)??false,[]);
 const beginUndoProjection=useCallback((...args:Parameters<MailboxList['beginUndoProjection']>)=>list.current?.beginUndoProjection(...args)??false,[]),settleUndoProjection=useCallback((...args:Parameters<MailboxList['settleUndoProjection']>)=>list.current?.settleUndoProjection(...args)??false,[]),getOwner=useCallback(()=>list.current?.getOwner()??null,[]);
 const getSnapshot=useCallback(()=>list.current?.getSnapshot(),[]),settleSelection=useCallback(()=>list.current?.settleSelection()||Promise.resolve(undefined),[]);
 return{getSnapshot,getOwner,beginUndoProjection,settleUndoProjection,settleSelection,discardDismissal,...(snapshot.key===key?snapshot.state:emptyMailbox()),refresh,loadMore,move,select,resetSelection,readThread,cancelDetail,updateSummary,reserveDone,reserveDismissal,finishDone,restoreDone,hasDone};
}
