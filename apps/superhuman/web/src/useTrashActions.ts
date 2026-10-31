import {useEffect,useRef,useState} from 'react';
import {mailFetch} from './mail-fetch.ts';
import type {ThreadSummary} from './api.ts';
import {archiveBasis} from './archive-actions.ts';
import {createTrashQueue,type TrashQueue,type TrashRecord,type TrashResult} from './trash-actions.ts';
import type {ActionAdmission,ActionTicket} from './action-admission.ts';
import type {DismissalReservation} from './mailbox-list.ts';
import type {OrdinaryNotice,NotificationState} from './notifications.ts';
import type useMailbox from './useMailbox.ts';
import type {useDoneMotion} from './done-motion.tsx';

type Props={currentNotice:()=>Readonly<NotificationState>|null;accountId:string|undefined;accountVersion:string|null;scope:string;admission:ActionAdmission;mailbox:ReturnType<typeof useMailbox>;motion:ReturnType<typeof useDoneMotion>;canLeave:(row:ThreadSummary)=>boolean;isTargetBlocked:(id:string)=>boolean;notify:(text:string)=>void;notifyOrdinary:(notice:OrdinaryNotice)=>void;refresh:()=>Promise<void>;captureUndoGuard:()=>()=>boolean};
type Binding={scope:string;reservation:DismissalReservation|null;summary:ThreadSummary;projectionKey?:string;canProject?:()=>boolean;settled:boolean};
const pending=(r:TrashRecord)=>['queued','issue-possible','pending','unknown'].includes(r.phase)||!!r.receipt?.locked||!!r.undoDispatch&&r.undoDispatch.state!=='settled';
async function transport(path:string,body?:unknown,method?:string){const response=await mailFetch('/api'+path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(65000),redirect:'error'});if(!response.ok)throw Error('Trash status is unavailable');return response.json()}

/** Separate keyed Trash owner; no Archive receipt or legacy Undo is substituted. */
export function useTrashActions(props:Props){
 const current=useRef(props);current.current=props;
 const queues=useRef(new Map<string,TrashQueue>()),bindings=useRef(new Map<string,Binding>()),latest=useRef<{accountId:string;key:string}|null>(null),starts=useRef(new Set<string>()),checks=useRef(new Map<string,number>()),onEvent=useRef<(r:TrashRecord,v?:TrashResult)=>void>(()=>{});
 const [status,setStatus]=useState<{accountId:string;accountVersion:string;requestId:string|null;text:string}|null>(null);
 const queue=(accountId:string)=>{let q=queues.current.get(accountId);if(!q){q=createTrashQueue(accountId,{storage:window.localStorage,transport,admission:current.current.admission,onChange:(r,v)=>onEvent.current(r,v)});queues.current.set(accountId,q)}return q};
 useEffect(()=>()=>{for(const q of queues.current.values())q.dispose();queues.current.clear()},[]);
 useEffect(()=>{const accountId=props.accountId,version=props.accountVersion;if(!accountId||!version)return;const q=queue(accountId),record=[...q.all()].reverse().find(r=>r.intent.accountVersion===version&&pending(r));if(q.blocked()){setStatus({accountId,accountVersion:version,requestId:null,text:q.blocked()!});return}if(record){latest.current={accountId,key:record.intent.clientRequestId};setStatus({accountId,accountVersion:version,requestId:record.intent.clientRequestId,text:'Saved Trash status needs checking.'})}},[props.accountId,props.accountVersion]);
 const notice=(r:TrashRecord,text:string,undo?:string,explicit=false)=>{const p=current.current,identity=JSON.stringify(['trash',r.intent.accountId,r.intent.accountVersion,r.intent.clientRequestId,r.undo?.clientRequestId??'forward',checks.current.get(r.intent.clientRequestId)??0]),start=explicit||r.phase==='queued'&&!r.restored||r.undo?.state==='pending'&&r.undoDispatch?.state==='not-issued',mode=start&&!starts.current.has(identity)?'start':'update';if(mode==='start')starts.current.add(identity);p.notifyOrdinary({identity,mode,text,undo})};
 const errorNotice=(r:TrashRecord,text:string)=>{const p=current.current,identity=JSON.stringify(['trash',r.intent.accountId,r.intent.accountVersion,r.intent.clientRequestId,r.undo?.clientRequestId??'forward',checks.current.get(r.intent.clientRequestId)??0]),active=p.currentNotice();if(active?.kind==='ordinary'&&active.identity===identity)p.notify(text)};
 const unresolved=(r:TrashRecord,text:string)=>{setStatus({accountId:r.intent.accountId,accountVersion:r.intent.accountVersion,requestId:r.intent.clientRequestId,text});errorNotice(r,text)};
 onEvent.current=(r,value)=>{
  const p=current.current,key=r.intent.clientRequestId;
  if(!r.scopeCurrent){
   const binding=bindings.current.get(key);if(binding?.scope===p.scope&&binding.reservation)p.mailbox.discardDismissal(binding.reservation);bindings.current.delete(key);
   if(latest.current?.accountId===r.intent.accountId&&latest.current.key===key)latest.current=null;
   setStatus(old=>old?.accountId===r.intent.accountId&&old.accountVersion===r.intent.accountVersion&&old.requestId===key?null:old);
   const active=p.currentNotice(),identity=JSON.stringify(['trash',r.intent.accountId,r.intent.accountVersion,key,r.undo?.clientRequestId??'forward',checks.current.get(key)??0]);
   if(active?.kind==='ordinary'&&active.identity===identity&&active.undo==='trash:'+key)p.notifyOrdinary({identity,mode:'update',text:active.text});
   return;
  }
  if(r.intent.accountId!==p.accountId||r.intent.accountVersion!==p.accountVersion)return;
  const b=bindings.current.get(key),bound=b?.scope===p.scope,binding=bound?b:undefined,owned=latest.current?.key===key;
  if(r.undo){
   if(r.undo.state==='pending'){
    if(binding?.reservation&&(!binding.canProject||binding.canProject())&&p.mailbox.beginUndoProjection(binding.reservation,r.undo.clientRequestId)){binding.projectionKey=r.undo.clientRequestId;const row=p.mailbox.getSnapshot()?.threads.find(t=>t.id===binding.summary.id);if(row)p.motion.restore(row)}
    if(r.phase==='confirmed'&&binding?.reservation)p.mailbox.finishDone(binding.reservation,'confirmed');
    if(owned)notice(r,'Undoing Trash…');return;
   }
   if(r.undo.state==='unknown'||r.undo.state==='refused'&&r.localReason){
    if(binding?.reservation&&binding.projectionKey)p.mailbox.settleUndoProjection(binding.reservation,r.undo.clientRequestId,'unknown');
    if(owned)unresolved(r,r.localReason==='trash-not-confirmed'?'Trash is not confirmed. Check its status before continuing Undo.':'Trash Undo status is unconfirmed.');return;
   }
   if(r.undo.state==='confirmed'){
    if(binding&&!binding.settled){binding.settled=true;if(binding.reservation){if(binding.projectionKey)p.mailbox.settleUndoProjection(binding.reservation,r.undo.clientRequestId,'confirmed',value?.thread);else if(p.mailbox.restoreDone(binding.reservation,value?.thread)){const row=p.mailbox.getSnapshot()?.threads.find(t=>t.id===binding.summary.id);if(row)p.motion.restore(row)}}void p.refresh().catch(()=>{})}
    if(owned){setStatus(null);notice(r,'Trash undone')}return;
   }
   if(r.undo.state==='refused'){
    if(binding?.reservation&&binding.projectionKey)p.mailbox.settleUndoProjection(binding.reservation,r.undo.clientRequestId,'refused');
    if(owned){if(r.receipt?.locked)unresolved(r,'Trash remains locked. Check its status.');else{setStatus(null);errorNotice(r,r.undo.reason==='trash_undo_expired'?'Trash Undo expired.':'Trash Undo is unavailable.')}}
    if(bound)void p.refresh().catch(()=>{});return;
   }
  }
  if(r.phase==='confirmed'){
   if(binding?.reservation)p.mailbox.finishDone(binding.reservation,'confirmed');if(bound)void p.refresh().catch(()=>{});
   if(owned){setStatus(null);notice(r,'Moved to Trash','trash:'+key)}
  }else if(r.phase==='unknown'||r.phase==='refused'){
   if(binding?.reservation){const outcome=r.phase==='unknown'||r.receipt?.locked?'unknown':'refused';if(p.mailbox.finishDone(binding.reservation,outcome)){const row=p.mailbox.getSnapshot()?.threads.find(t=>t.id===binding.summary.id);if(row)p.motion.restore(row)}}
   if(owned){if(r.phase==='unknown'||r.receipt?.locked)unresolved(r,'Trash status is unconfirmed.');else{setStatus(null);errorNotice(r,'Could not move to Trash. The conversation is still here.')}}
  }else if(owned)notice(r,'Moving to Trash…','trash:'+key);
 };
 const trash=(ids:(string|undefined)[],fallback:ThreadSummary|undefined,options:{isCurrent:()=>boolean;onAccepted:(r:DismissalReservation|null,id:string)=>void})=>{
  const p=current.current,accountId=p.accountId,scope=p.scope;if(!accountId)return;
  const tickets=ids.map(()=>p.admission.reserve(accountId)),rows=p.mailbox.getSnapshot()?.threads??[],initial=ids.map(id=>id?rows.find(t=>t.id===id)??(fallback?.id===id?fallback:undefined):rows.find(t=>t.id===p.mailbox.getSnapshot()?.selectedId)),animate=initial.every(Boolean)&&initial.filter(row=>row&&p.canLeave(row)).length<30;
  const accept=(row:ThreadSummary,ticket:ActionTicket,reservation:DismissalReservation|null,commit?:()=>void)=>{
   const basis=archiveBasis(row);if(!options.isCurrent()||current.current.scope!==scope||!basis||basis.accountVersion!==p.accountVersion||p.isTargetBlocked(row.id)){ticket.cancel();return false}
   const q=queue(accountId),existing=q.all().find(r=>r.intent.accountVersion===basis.accountVersion&&r.intent.threadId===row.id&&pending(r));if(existing){ticket.cancel();latest.current={accountId,key:existing.intent.clientRequestId};unresolved(existing,'Check the pending Trash status before trying again.');return false}
   const key=reservation?.requestId??crypto.randomUUID(),intent={version:1 as const,action:'trash' as const,accountId,accountVersion:basis.accountVersion,expectedSourceVersion:basis.sourceVersion,threadId:row.id,clientRequestId:key};
   const work=q.submit(intent,{ticket,canIssue:()=>options.isCurrent()&&current.current.scope===scope,onAccepted:()=>{bindings.current.set(key,{scope,reservation,summary:row,settled:false});latest.current={accountId,key};commit?.();options.onAccepted(reservation,row.id);if(reservation&&animate)p.motion.dismiss([{requestId:key,thread:row}])}});
   void work.catch(()=>{if(current.current.scope===scope)setStatus({accountId,accountVersion:basis.accountVersion,requestId:q.get(key)?key:null,text:'Trash could not be saved safely. Nothing new was submitted.'})});return !!q.get(key);
  };
  const tasks=ids.map((id,index)=>{
   const ticket=tickets[index],row=id?p.mailbox.getSnapshot()?.threads.find(t=>t.id===id)??(fallback?.id===id?fallback:undefined):p.mailbox.getSnapshot()?.threads.find(t=>t.id===p.mailbox.getSnapshot()?.selectedId);
   if(row&&p.canLeave(row))return p.mailbox.reserveDismissal('trash',crypto.randomUUID(),id,fallback,(r,commit)=>accept(r.thread,ticket,r,commit)).then(r=>{if(!r)ticket.cancel()}).catch(()=>{ticket.cancel()});
   return (async()=>{const target=row??await p.mailbox.settleSelection();if(!target||!options.isCurrent()||current.current.scope!==scope){ticket.cancel();return}accept(target,ticket,null)})().catch(()=>{ticket.cancel()});
  });
  void Promise.allSettled(tasks);
 };
 const undo=async(key:string)=>{
  const p=current.current,target=latest.current;if(!target||target.accountId!==p.accountId||target.key!==key)return;const q=queue(target.accountId),r=q.get(key);if(!r||r.intent.accountVersion!==p.accountVersion||!r.scopeCurrent)return;
  const owner=p.mailbox.getOwner(),scope=p.scope,guard=p.captureUndoGuard(),accountVersion=p.accountVersion,valid=()=>current.current.accountId===target.accountId&&current.current.accountVersion===accountVersion&&current.current.scope===scope&&p.mailbox.getOwner()===owner&&guard(),binding=bindings.current.get(key);if(binding)binding.canProject=valid;
  const ticket=p.admission.reserve(target.accountId);try{await q.undo(key,crypto.randomUUID(),valid,ticket)}catch{if(current.current.scope===scope)unresolved(r,'Trash Undo could not be saved safely. Nothing new was submitted.')}
 };
 const recover=async()=>{const p=current.current;if(!status?.requestId||status.accountId!==p.accountId||status.accountVersion!==p.accountVersion)return;const q=queue(status.accountId),r=q.get(status.requestId);if(!r)return;checks.current.set(status.requestId,(checks.current.get(status.requestId)??0)+1);notice(r,'Checking Trash status…',undefined,true);const recovered=await q.recover(status.requestId);if(recovered.scopeCurrent&&!recovered.restored&&current.current.scope===p.scope)void p.refresh().catch(()=>{})};
 return{trash,undo,recover,isPending:(id:string)=>!!props.accountId&&!!queues.current.get(props.accountId)?.all().some(r=>r.intent.accountVersion===props.accountVersion&&r.intent.threadId===id&&pending(r)),status:status&&status.accountId===props.accountId&&status.accountVersion===props.accountVersion?status:null};
}
