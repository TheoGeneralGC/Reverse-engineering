import type { Thread,ThreadListOptions,ThreadListPage,ThreadSummary } from './api.ts';
import type {SplitViewRef} from './split-inbox-client.ts';
import type {SplitCoverage} from '../../api/src/split-inbox-types.ts';
export type MailboxPage=Omit<ThreadListPage,'total'>&{total:number|null;viewIdentity?:{viewRef:SplitViewRef;settingsRevision:number;sourceGeneration:number;policyVersion:string};coverage?:SplitCoverage};
export type MailboxOptions=ThreadListOptions&Pick<MailboxContext,'viewRef'|'settingsRevision'|'policyVersion'>;

export type MailboxContext={accountId:string;folder:string;q:string;split:'important'|'other'|'calendar'|'all';limit:number;viewRef?:SplitViewRef;settingsRevision?:number;policyVersion?:string};
export type MailboxSnapshot={threads:ThreadSummary[];selectedId:string|null;total:number|null;viewIdentity?:MailboxPage['viewIdentity'];coverage?:SplitCoverage;counts:ThreadListPage['counts'];hasMore:boolean;nextCursor:string|null;loading:boolean;loadingMore:boolean;openingId:string|null;error:string;ready:boolean};
export const emptyMailbox=():MailboxSnapshot=>({threads:[],selectedId:null,total:0,counts:{inbox:0,important:0,other:0,calendar:0},hasMore:false,nextCursor:null,loading:false,loadingMore:false,openingId:null,error:'',ready:false});
export function mailboxKey(context:MailboxContext){return JSON.stringify([context.accountId,context.folder,context.q.trim(),context.split,context.limit,context.viewRef,context.settingsRevision,context.policyVersion])}
export function summaryPath(context:MailboxOptions){
 if(context.viewRef){if(context.q?.trim())throw Error('Search is not supported inside a custom Split view.');const query=new URLSearchParams({accountId:context.accountId,limit:String(context.limit||50)});if(context.cursor)query.set('cursor',context.cursor);return '/split-inboxes/views/'+encodeURIComponent(context.viewRef)+'/threads?'+query;}
 const query=new URLSearchParams({accountId:context.accountId,folder:context.folder||'inbox',q:(context.q||'').trim(),split:context.split||'all',limit:String(context.limit||50)});
 if(context.cursor)query.set('cursor',context.cursor);return '/thread-summaries?'+query;
}
// Match the API's SQLite BINARY tie-break rather than locale-dependent ordering.
const encoder=new TextEncoder();
function binaryCompare(a:string,b:string){const left=encoder.encode(a),right=encoder.encode(b);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];return left.length-right.length}
function positionCompare(a:ThreadSummary,b:ThreadSummary){return binaryCompare(a.lastMessageAt,b.lastMessageAt)||binaryCompare(a.id,b.id)}
function mergeSummaries(previous:ThreadSummary[],incoming:ThreadSummary[],accountId:string){const byId=new Map(previous.map(thread=>[thread.id,thread]));for(const thread of incoming)if(thread.accountId===accountId)byId.set(thread.id,thread);return [...byId.values()].sort((a,b)=>positionCompare(b,a))}

export function createMailboxList(context:MailboxContext,dependencies:{readPage:(options:MailboxOptions)=>Promise<MailboxPage>;readThread:(id:string)=>Promise<Thread>;onChange:(snapshot:MailboxSnapshot)=>void}){
 let state=emptyMailbox(),active=true,listRevision=0,detailRevision=0,selectionRevision=0;
 let refreshRequest:Promise<void>|null=null,moreRequest:Promise<void>|null=null,moves:Promise<ThreadSummary|undefined>=Promise.resolve(undefined);
 const publish=(patch:Partial<MailboxSnapshot>)=>{if(!active)return;state={...state,...patch};dependencies.onChange(state)};
 const checkPage=(page:MailboxPage,previous?:MailboxPage['viewIdentity'])=>{if(!context.viewRef)return;const id=page.viewIdentity;if(!id||id.viewRef!==context.viewRef||id.settingsRevision!==context.settingsRevision||id.policyVersion!==context.policyVersion||previous&&JSON.stringify(previous)!==JSON.stringify(id))throw Error('The Split Inbox changed while loading. Refresh conversations to load a consistent view.');};
 const current=()=>state.threads.find(thread=>thread.id===state.selectedId);
 const fail=(error:unknown)=>error instanceof Error?error.message:'Unable to load conversations';
 const cancelDetail=()=>{detailRevision++;if(state.openingId)publish({openingId:null})};
 const select=(id:string|null,manual=true)=>{if(!active)return;if(manual)selectionRevision++;if(id!==state.selectedId)cancelDetail();publish({selectedId:id&&state.threads.some(thread=>thread.id===id)?id:state.threads[0]?.id||null})};
 const refresh=()=>{
  if(!active)return Promise.resolve();
  const revision=++listRevision,oldRows=state.threads,oldBoundary=oldRows.at(-1),targetLength=oldRows.length;
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
   publish({threads:mergeSummaries(state.threads,page.threads,context.accountId),total:page.total,counts:page.counts,viewIdentity:page.viewIdentity,coverage:page.coverage,hasMore:page.hasMore,nextCursor:page.nextCursor,loadingMore:false,error:''});
  }).catch(error=>{if(active&&revision===listRevision){publish({loadingMore:false,error:fail(error)});throw error}}).finally(()=>{if(moreRequest===work)moreRequest=null});
  moreRequest=work;return work;
 };
 const move=(delta:number)=>{
  const intent=selectionRevision;
  const work=moves.catch(()=>undefined).then(async()=>{
   if(!active||intent!==selectionRevision)return;
   while(refreshRequest)await refreshRequest;if(!active||intent!==selectionRevision)return;
   let index=state.threads.findIndex(thread=>thread.id===state.selectedId);if(index<0)index=0;const destination=Math.max(0,index+delta);
   while(destination>=state.threads.length&&state.hasMore){await loadMore();if(!active||intent!==selectionRevision)return}
   const thread=state.threads[Math.min(destination,state.threads.length-1)];if(thread)select(thread.id,false);return thread;
  });moves=work;return work;
 };
 const readThread=async(id:string)=>{
  if(!active)return null;select(id,false);const revision=++detailRevision;publish({openingId:id});
  try{const thread=await dependencies.readThread(id);if(!active||revision!==detailRevision)return null;if(thread.accountId!==context.accountId)throw new Error('Conversation belongs to a different account');return thread}catch(error){if(!active||revision!==detailRevision)return null;throw error}
  finally{if(active&&revision===detailRevision)publish({openingId:null})}
 };
 const settleSelection=async():Promise<ThreadSummary|undefined>=>{const pending=moves;await pending;if(!active)return;if(pending!==moves)return settleSelection();return current()};
 return{getSnapshot:()=>state,current,refresh,loadMore,move,settleSelection,select,resetSelection:()=>select(state.threads[0]?.id||null),readThread,cancelDetail,
  updateSummary(id:string,patch:Partial<ThreadSummary>){publish({threads:state.threads.map(thread=>thread.id===id?{...thread,...patch}:thread)})},
  dispose(){active=false;listRevision++;detailRevision++;selectionRevision++},
 };
}
export type MailboxList=ReturnType<typeof createMailboxList>;
