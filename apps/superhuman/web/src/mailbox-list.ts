import type {SelectionOrigin,SelectionPresentation} from './selection-highlight.ts';
import {visibleMessages} from '../../api/src/message-presentation.ts';
import type { Thread,ThreadListOptions,ThreadListPage,ThreadSummary } from './api.ts';
import type {SplitViewRef} from './split-inbox-client.ts';
import type {SplitCoverage} from '../../api/src/split-inbox-types.ts';
export function summaryFromThread(thread:Thread):ThreadSummary{const visible=visibleMessages(thread);return{id:thread.id,accountId:thread.accountId,providerId:thread.providerId,subject:thread.subject,snippet:thread.snippet,sender:thread.sender,participants:thread.participants,lastMessageAt:thread.lastMessageAt,unread:thread.unread,starred:thread.starred,important:thread.important,folder:thread.folder,labels:thread.labels,providerLabels:thread.providerLabels,snoozedUntil:thread.snoozedUntil,snoozeRetryAt:thread.snoozeRetryAt,snoozeError:thread.snoozeError,split:thread.split,muted:thread.muted,messageCount:visible.length,hasAttachments:visible.some(m=>m.attachments.length>0),...{archiveBasis:'archiveBasis' in thread?thread.archiveBasis:null}}}
export type MailboxPage=Omit<ThreadListPage,'total'>&{total:number|null;viewIdentity?:{viewRef:SplitViewRef;settingsRevision:number;sourceGeneration:number;policyVersion:string};coverage?:SplitCoverage};
export type MailboxOptions=ThreadListOptions&Pick<MailboxContext,'viewRef'|'settingsRevision'|'policyVersion'>;

export type MailboxContext={accountId:string;accountVersion?:string|null;folder:string;q:string;split:'important'|'other'|'calendar'|'all';limit:number;viewRef?:SplitViewRef;settingsRevision?:number;policyVersion?:string;timeZone?:string};
export type DoneReservation={kind?:'archive'|'trash';requestId:string;owner:string;thread:ThreadSummary;sourceIdentity:string;selectedBefore:string|null;selectedAfter:string|null;manualRevision:number;ordinal:number;counterRevision:number;countDelta:ThreadListPage['counts'];phase:'pending'|'confirmed'|'unknown';confirmedRead:number|null};
const doneCountDelta=(t:ThreadSummary)=>{const inbox=(t.providerLabels?t.providerLabels.includes('INBOX'):t.folder==='inbox')&&!t.snoozedUntil?1:0;return{inbox,important:inbox&&t.important?1:0,other:inbox&&!t.important?1:0,calendar:inbox&&t.labels.some(v=>v.toLowerCase().includes('calendar'))?1:0}};
const adjustCounts=(counts:ThreadListPage['counts'],delta:ThreadListPage['counts'],direction:1|-1)=>Object.fromEntries(Object.keys(counts).map(k=>[k,Math.max(0,counts[k as keyof typeof counts]+direction*delta[k as keyof typeof delta])]))as ThreadListPage['counts'];
export type DismissalReservation=DoneReservation;
const reservationKey=(r:DoneReservation)=>(r.kind??'archive')+':'+r.requestId;
const doneSourceIdentity=(t:ThreadSummary)=>{const b=(t as ThreadSummary&{archiveBasis?:{sourceVersion?:unknown}}).archiveBasis;return typeof b?.sourceVersion==='string'?b.sourceVersion:JSON.stringify([t.id,t.accountId,t.providerId,t.lastMessageAt])};
export type MailboxSnapshot={selectionPresentation?:SelectionPresentation;threads:ThreadSummary[];selectedId:string|null;total:number|null;viewIdentity?:MailboxPage['viewIdentity'];coverage?:SplitCoverage;counts:ThreadListPage['counts'];hasMore:boolean;nextCursor:string|null;loading:boolean;loadingMore:boolean;openingId:string|null;error:string;ready:boolean};
export const emptyMailbox=():MailboxSnapshot=>({threads:[],selectedId:null,total:0,counts:{inbox:0,important:0,other:0,calendar:0},hasMore:false,nextCursor:null,loading:false,loadingMore:false,openingId:null,error:'',ready:false});
// Clone caller context so one list's date boundary cannot change during paging.
export function browserMailboxContext(context:MailboxContext|null):MailboxContext|null{return context?{...context,...(context.q.trim()?{timeZone:context.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone}:{})}:null}
export function mailboxKey(context:MailboxContext){return JSON.stringify([context.accountId,...('accountVersion' in context?[context.accountVersion??null]:[]),context.folder,context.q.trim(),context.split,context.limit,context.viewRef,context.settingsRevision,context.policyVersion,...(context.timeZone===undefined?[]:[context.timeZone])])}
export function summaryPath(context:MailboxOptions){
 if(context.viewRef){if(context.q?.trim())throw Error('Search is not supported inside a custom Split view.');const query=new URLSearchParams({accountId:context.accountId,limit:String(context.limit||50)});if(context.cursor)query.set('cursor',context.cursor);return '/split-inboxes/views/'+encodeURIComponent(context.viewRef)+'/threads?'+query;}
 const query=new URLSearchParams({accountId:context.accountId,folder:context.folder||'inbox',q:(context.q||'').trim(),split:context.split||'all',limit:String(context.limit||50)});
 if(context.cursor)query.set('cursor',context.cursor);if(context.timeZone!==undefined)query.set('timeZone',context.timeZone);return '/thread-summaries?'+query;
}
// Match the API's SQLite BINARY tie-break rather than locale-dependent ordering.
const encoder=new TextEncoder();
function binaryCompare(a:string,b:string){const left=encoder.encode(a),right=encoder.encode(b);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];return left.length-right.length}
export function positionCompare(a:ThreadSummary,b:ThreadSummary){return binaryCompare(a.lastMessageAt,b.lastMessageAt)||binaryCompare(a.id,b.id)}
function mergeSummaries(previous:ThreadSummary[],incoming:ThreadSummary[],accountId:string){const byId=new Map(previous.map(thread=>[thread.id,thread]));for(const thread of incoming)if(thread.accountId===accountId)byId.set(thread.id,thread);return [...byId.values()].sort((a,b)=>positionCompare(b,a))}

export function createMailboxList(context:MailboxContext,dependencies:{readPage:(options:MailboxOptions)=>Promise<MailboxPage>;readThread:(id:string,signal:AbortSignal,onCached:(thread:Thread)=>void)=>Promise<Thread>;onChange:(snapshot:MailboxSnapshot)=>void}){
 const owner=crypto.randomUUID(),done=new Map<string,DoneReservation>(),inverses=new Map<string,{key:string;phase:'pending'|'unknown';selectionBefore:string|null;manualRevision:number}>(),revokedInverses=new Set<string>();let reservationOrdinal=0,serverRead=0,counterRevision=0,movementPending=0;
 let state=emptyMailbox(),active=true,listRevision=0,detailRevision=0,selectionRevision=0,manualNavigationRevision=0,presentationRevision=0,detailAbort:AbortController|null=null;
 let refreshRequest:Promise<void>|null=null,moreRequest:Promise<void>|null=null,moves:Promise<ThreadSummary|undefined>=Promise.resolve(undefined);
 const suppressed=(row:ThreadSummary)=>[...done.values()].some(r=>r.phase!=='unknown'&&r.thread.id===row.id&&r.sourceIdentity===doneSourceIdentity(row));
 const rowsVisible=(rows:ThreadSummary[])=>{const visible=rows.filter(row=>!suppressed(row)||[...inverses.keys()].some(key=>done.get(key)?.thread.id===row.id));for(const[key]of inverses){const r=done.get(key);if(!r)continue;const current=visible.find(row=>row.id===r.thread.id);if(current&&doneSourceIdentity(current)!==r.sourceIdentity){inverses.delete(key);revokedInverses.add(key);done.delete(key);continue}if(!current)visible.push(r.thread)}return visible.sort((a,b)=>positionCompare(b,a))};
 const publish=(patch:Partial<MailboxSnapshot>,origin?:SelectionOrigin)=>{if(!active)return;const moved=patch.selectedId!==undefined&&patch.selectedId!==state.selectedId;state={...state,...patch,...(moved||origin==='pointer'?{selectionPresentation:Object.freeze({owner,revision:++presentationRevision,origin:origin??'layout'})}:{})};dependencies.onChange(state)};
 const checkPage=(page:MailboxPage,previous?:MailboxPage['viewIdentity'])=>{if(!context.viewRef)return;const id=page.viewIdentity;if(!id||id.viewRef!==context.viewRef||id.settingsRevision!==context.settingsRevision||id.policyVersion!==context.policyVersion||previous&&JSON.stringify(previous)!==JSON.stringify(id))throw Error('The Split Inbox changed while loading. Refresh conversations to load a consistent view.');};
 const current=()=>state.threads.find(thread=>thread.id===state.selectedId);
 const fail=(error:unknown)=>error instanceof Error?error.message:'Unable to load conversations';
 const cancelDetail=()=>{detailRevision++;detailAbort?.abort();detailAbort=null;if(state.openingId)publish({openingId:null})};
 const select=(id:string|null,manual=true,origin:SelectionOrigin='layout')=>{if(!active)return;if(manual){selectionRevision++;manualNavigationRevision++}if(id!==state.selectedId)cancelDetail();publish({selectedId:id&&state.threads.some(thread=>thread.id===id)?id:state.threads[0]?.id||null},origin)};
 const refresh=()=>{
  if(!active)return Promise.resolve();
  const revision=++listRevision,read=++serverRead,oldRows=state.threads,oldBoundary=oldRows.at(-1),targetLength=oldRows.length;
  publish({loading:true,loadingMore:false,error:''});moreRequest=null;
  const work=(async()=>{
   let rows:ThreadSummary[]=[],cursor:string|null=null,page:MailboxPage,identity:MailboxPage['viewIdentity'];
   const seenCursors=new Set<string>();
   do{
    page=await dependencies.readPage({...context,cursor});if(!active||revision!==listRevision)return;checkPage(page,identity);identity=page.viewIdentity;
    rows=mergeSummaries(rows,page.threads,context.accountId);
    const selectedMissing=!!state.selectedId&&!rows.some(thread=>thread.id===state.selectedId);
    const coveredBoundary=!oldBoundary||!!rows.at(-1)&&positionCompare(rows.at(-1)!,oldBoundary)<=0;
    if(!page.hasMore||!page.nextCursor||(rows.length>=targetLength&&(!selectedMissing||coveredBoundary)))break;
    if(seenCursors.has(page.nextCursor))throw new Error('Mailbox pagination did not advance');seenCursors.add(page.nextCursor);cursor=page.nextCursor;
   }while(true);
   for(const[key,reservation]of done)if(!inverses.has(key)&&reservation.phase==='confirmed'&&reservation.confirmedRead!==null&&read>reservation.confirmedRead)done.delete(key);
   rows=rowsVisible(rows);counterRevision++;
   const oldIndex=oldRows.findIndex(thread=>thread.id===state.selectedId),selectedId=rows.some(thread=>thread.id===state.selectedId)?state.selectedId:rows[Math.max(0,Math.min(oldIndex,rows.length-1))]?.id||null;
   publish({threads:rows,selectedId,total:page.total,counts:page.counts,viewIdentity:page.viewIdentity,coverage:page.coverage,hasMore:page.hasMore,nextCursor:page.nextCursor,loading:false,ready:true,error:''});
  })().catch(error=>{if(active&&revision===listRevision){publish({loading:false,loadingMore:false,error:fail(error)});throw error}}).finally(()=>{if(refreshRequest===work)refreshRequest=null});
  refreshRequest=work;return work;
 };
 const loadMore=():Promise<void>=>{
  if(!active)return Promise.resolve();if(refreshRequest)return refreshRequest.then(()=>loadMore());if(moreRequest)return moreRequest;
  if(!state.hasMore||!state.nextCursor)return Promise.resolve();const cursor=state.nextCursor,revision=listRevision;publish({loadingMore:true,error:''});
  const work=dependencies.readPage({...context,cursor}).then(page=>{
   if(!active||revision!==listRevision)return;checkPage(page,state.viewIdentity);
   if(page.hasMore&&page.nextCursor===cursor)throw new Error('Mailbox pagination did not advance');
   const merged=rowsVisible(mergeSummaries(state.threads,page.threads,context.accountId));counterRevision++;publish({threads:merged,selectedId:merged.some(t=>t.id===state.selectedId)?state.selectedId:merged[0]?.id??null,total:page.total,counts:page.counts,viewIdentity:page.viewIdentity,coverage:page.coverage,hasMore:page.hasMore,nextCursor:page.nextCursor,loadingMore:false,error:''});
  }).catch(error=>{if(active&&revision===listRevision){publish({loadingMore:false,error:fail(error)});throw error}}).finally(()=>{if(moreRequest===work)moreRequest=null});
  moreRequest=work;return work;
 };
 const move=(delta:number)=>{
  if(active)manualNavigationRevision++;
  const intent=selectionRevision;movementPending++;
  const work=moves.catch(()=>undefined).then(async()=>{
   if(!active||intent!==selectionRevision)return;
   while(refreshRequest)await refreshRequest;if(!active||intent!==selectionRevision)return;
   let index=state.threads.findIndex(thread=>thread.id===state.selectedId);if(index<0)index=0;const destination=Math.max(0,index+delta);
   while(destination>=state.threads.length&&state.hasMore){await loadMore();if(!active||intent!==selectionRevision)return}
   const thread=state.threads[Math.min(destination,state.threads.length-1)];if(thread)select(thread.id,false,'keyboard');return thread;
  });moves=work;void work.then(()=>movementPending--,()=>movementPending--);return work;
 };
 const reserveNow=(requestId:string,id?:string,fallback?:ThreadSummary,onReserved?:(r:DoneReservation)=>void,kind:'archive'|'trash'='archive',beforePublish?:(r:DoneReservation,commit:()=>void)=>boolean):DoneReservation|null=>{
  if(!active||done.has(kind+':'+requestId))return null;const thread=id?state.threads.find(t=>t.id===id)??(fallback?.id===id&&fallback.accountId===context.accountId?fallback:undefined):current();if(!thread||[...done.values()].some(r=>r.thread.id===thread.id&&r.sourceIdentity===doneSourceIdentity(thread)))return null;
  const index=state.threads.findIndex(t=>t.id===thread.id),rows=state.threads.filter(t=>t.id!==thread.id),selectedBefore=state.selectedId,selectedAfter=selectedBefore===thread.id?rows[Math.min(index,rows.length-1)]?.id??null:selectedBefore;
  const reservation:DoneReservation={kind,requestId,owner,thread,sourceIdentity:doneSourceIdentity(thread),selectedBefore,selectedAfter,manualRevision:manualNavigationRevision,ordinal:++reservationOrdinal,counterRevision,countDelta:doneCountDelta(thread),phase:'pending',confirmedRead:null};let committed=false;const commit=()=>{if(committed)return;committed=true;done.set(reservationKey(reservation),reservation);cancelDetail();publish({threads:rows,selectedId:selectedAfter,counts:adjustCounts(state.counts,reservation.countDelta,-1),total:state.total===null?null:Math.max(0,state.total-(index>=0?1:0))})};if(beforePublish&&!beforePublish(reservation,commit))return null;commit();onReserved?.(reservation);return reservation;
 };
 const reserveDone=(requestId:string,id?:string,fallback?:ThreadSummary,onReserved?:(r:DoneReservation)=>void,kind:'archive'|'trash'='archive',beforePublish?:(r:DoneReservation,commit:()=>void)=>boolean):Promise<DoneReservation|null>=>{
  if(!active)return Promise.resolve(null);if(movementPending===0&&!refreshRequest&&(id||current()))return Promise.resolve(reserveNow(requestId,id,fallback,onReserved,kind,beforePublish));
  const intent=selectionRevision;movementPending++;let reservation:DoneReservation|null=null;
  const work=moves.catch(()=>undefined).then(async()=>{while(refreshRequest)await refreshRequest;if(!active||intent!==selectionRevision)return;while(!id&&!current()&&state.hasMore){await loadMore();if(!active||intent!==selectionRevision)return}reservation=reserveNow(requestId,id,fallback,onReserved,kind,beforePublish);return current()});moves=work;return work.then(()=>reservation).finally(()=>movementPending--);
 };
 const finishDone=(reservation:DoneReservation,outcome:'confirmed'|'refused'|'unknown')=>{
  if(!active||reservation.owner!==owner||done.get(reservationKey(reservation))!==reservation)return false;
  if(inverses.has(reservationKey(reservation))&&outcome!=='refused'){reservation.phase=outcome;reservation.confirmedRead=outcome==='confirmed'?serverRead:null;return true}
  if(outcome==='confirmed'){reservation.phase='confirmed';reservation.confirmedRead=serverRead;const index=state.threads.findIndex(t=>t.id===reservation.thread.id&&doneSourceIdentity(t)===reservation.sourceIdentity);if(index>=0){const rows=state.threads.filter((_,i)=>i!==index);publish({threads:rows,selectedId:state.selectedId===reservation.thread.id?rows[Math.min(index,rows.length-1)]?.id??null:state.selectedId})}return true}
  if(outcome==='unknown')reservation.phase='unknown';else done.delete(reservationKey(reservation));if([...done.values()].some(r=>r.thread.id===reservation.thread.id&&r.ordinal>reservation.ordinal))return true;const exists=state.threads.some(t=>t.id===reservation.thread.id),rows=exists?state.threads:mergeSummaries(state.threads,[reservation.thread],context.accountId),selectedId=outcome==='refused'&&(!exists||doneSourceIdentity(state.threads.find(t=>t.id===reservation.thread.id)!)===reservation.sourceIdentity)&&reservation.ordinal===reservationOrdinal&&reservation.manualRevision===manualNavigationRevision&&state.selectedId===reservation.selectedAfter?reservation.selectedBefore:state.selectedId;
  publish({threads:rows,selectedId:rows.some(t=>t.id===selectedId)?selectedId:state.selectedId,counts:!exists&&counterRevision===reservation.counterRevision?adjustCounts(state.counts,reservation.countDelta,1):state.counts,total:state.total===null?null:!exists&&counterRevision===reservation.counterRevision?state.total+1:state.total});return true;
 };
 const restoreDone=(reservation:DoneReservation,detail?:Thread)=>{if(!active||reservation.owner!==owner||reservation.thread.accountId!==context.accountId||detail&&detail.accountId!==context.accountId||revokedInverses.has(reservationKey(reservation)))return false;done.delete(reservationKey(reservation));const old=state.threads.find(t=>t.id===reservation.thread.id),summary=detail?summaryFromThread(detail):reservation.thread,rows=old?state.threads:mergeSummaries(state.threads,[summary],context.accountId),selectedId=reservation.ordinal===reservationOrdinal&&reservation.manualRevision===manualNavigationRevision&&state.selectedId===reservation.selectedAfter?reservation.thread.id:state.selectedId;publish({threads:rows,selectedId});return true};
 const beginUndoProjection=(r:DoneReservation,key:string)=>{if(!active||r.owner!==owner||r.thread.accountId!==context.accountId||revokedInverses.has(reservationKey(r))||inverses.has(reservationKey(r)))return false;const existing=state.threads.find(t=>t.id===r.thread.id);if(existing&&doneSourceIdentity(existing)!==r.sourceIdentity){revokedInverses.add(reservationKey(r));return false}done.set(reservationKey(r),r);inverses.set(reservationKey(r),{key,phase:'pending',selectionBefore:state.selectedId,manualRevision:manualNavigationRevision});const selectedId=r.ordinal===reservationOrdinal&&r.manualRevision===manualNavigationRevision&&state.selectedId===r.selectedAfter?r.thread.id:state.selectedId;publish({threads:rowsVisible([...state.threads]),selectedId});return true};
 const settleUndoProjection=(r:DoneReservation,key:string,outcome:'confirmed'|'refused'|'unknown',detail?:Thread)=>{const inverse=inverses.get(reservationKey(r));if(!active||r.owner!==owner||inverse?.key!==key||detail&&(detail.id!==r.thread.id||detail.accountId!==context.accountId))return false;if(outcome==='unknown'){inverse.phase='unknown';return true}inverses.delete(reservationKey(r));done.delete(reservationKey(r));const existing=state.threads.find(t=>t.id===r.thread.id),owned=existing&&doneSourceIdentity(existing)===r.sourceIdentity;if(outcome==='confirmed'){if(detail&&(detail.id!==r.thread.id||detail.accountId!==context.accountId))return false;const summary=detail?summaryFromThread(detail):r.thread,rows=owned?state.threads.map(t=>t.id===r.thread.id?summary:t):existing?state.threads:mergeSummaries(state.threads,[summary],context.accountId);publish({threads:rows});return true}const rows=owned?state.threads.filter(t=>t.id!==r.thread.id):state.threads;let selectedId=state.selectedId;if(owned&&selectedId===r.thread.id)selectedId=inverse.manualRevision===manualNavigationRevision&&rows.some(t=>t.id===inverse.selectionBefore)?inverse.selectionBefore:rows[0]?.id??null;publish({threads:rows,selectedId});return true};
 // Revocation releases only this owner's suppression/projection. It cannot
 // restore the captured Thread or certify a noncurrent receipt in this view.
 const discardDismissal=(r:DoneReservation)=>{const key=reservationKey(r);if(!active||r.owner!==owner||done.get(key)!==r)return false;const inverse=inverses.get(key);if(inverse)settleUndoProjection(r,inverse.key,'refused');else done.delete(key);revokedInverses.add(key);return true};
 const readThread=async(id:string,onCached?:(thread:Thread)=>void)=>{
  if(!active)return null;select(id,false);detailAbort?.abort();const controller=new AbortController();detailAbort=controller;const revision=++detailRevision;publish({openingId:id});
  const cached=(thread:Thread)=>{if(active&&revision===detailRevision&&!controller.signal.aborted&&thread.accountId===context.accountId)onCached?.(thread)};
  try{const thread=await dependencies.readThread(id,controller.signal,cached);if(!active||revision!==detailRevision)return null;if(thread.accountId!==context.accountId)throw new Error('Conversation belongs to a different account');const summary=summaryFromThread(thread);publish({threads:state.threads.map(row=>row.id===thread.id?{...row,...summary}:row)});return thread}catch(error){if(!active||revision!==detailRevision)return null;throw error}
  finally{if(detailAbort===controller)detailAbort=null;if(active&&revision===detailRevision)publish({openingId:null})}
 };
 const settleSelection=async():Promise<ThreadSummary|undefined>=>{const pending=moves;await pending;if(!active)return;if(pending!==moves)return settleSelection();return current()};
 return{getSnapshot:()=>state,getOwner:()=>active?owner:null,current,refresh,loadMore,move,settleSelection,select,resetSelection:()=>select(state.threads[0]?.id||null),readThread,cancelDetail,reserveDone,reserveDismissal:(kind:'archive'|'trash',requestId:string,id:string|undefined,fallback:ThreadSummary|undefined,beforePublish:(r:DoneReservation,commit:()=>void)=>boolean)=>reserveDone(requestId,id,fallback,undefined,kind,beforePublish),finishDone,restoreDone,beginUndoProjection,settleUndoProjection,discardDismissal,hasDone:(id:string,sourceIdentity?:string)=>[...done.values()].some(r=>r.thread.id===id&&(sourceIdentity===undefined||r.sourceIdentity===sourceIdentity)),
  updateSummary(id:string,patch:Partial<ThreadSummary>){publish({threads:state.threads.map(thread=>thread.id===id?{...thread,...patch}:thread)})},
  dispose(){detailAbort?.abort();detailAbort=null;active=false;listRevision++;detailRevision++;selectionRevision++;manualNavigationRevision++},
 };
}
export type MailboxList=ReturnType<typeof createMailboxList>;
