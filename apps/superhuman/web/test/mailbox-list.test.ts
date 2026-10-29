import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxList,summaryPath } from '../src/mailbox-list.ts';
import type { MailboxContext,MailboxSnapshot } from '../src/mailbox-list.ts';
import type { Thread,ThreadListOptions,ThreadListPage,ThreadSummary } from '../src/api.ts';
const context:MailboxContext={accountId:'a',folder:'inbox',q:'',split:'important',limit:2};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const summary=(id:string,position:number,accountId='a'):ThreadSummary=>({id,accountId,subject:id,snippet:'Synthetic snippet',sender:{name:id,email:id+'@example.test'},participants:[],lastMessageAt:new Date(Date.UTC(2026,9,27,12,0,-position)).toISOString(),unread:false,starred:false,important:true,folder:'inbox',labels:[],messageCount:1,hasAttachments:false});
const detail=(item:ThreadSummary):Thread=>({...item,messages:[{id:'m-'+item.id,sender:item.sender,to:[],date:item.lastMessageAt,text:'Synthetic full body '+item.id,attachments:[]}]});
const page=(threads:ThreadSummary[],total=threads.length,nextCursor:string|null=null):ThreadListPage=>({threads,total,counts:{inbox:1234,important:1000,other:234,calendar:7},hasMore:!!nextCursor,nextCursor});
function setup(readPage:(options:ThreadListOptions)=>Promise<ThreadListPage>,readThread:(id:string)=>Promise<Thread>=async id=>detail(summary(id,0))){let state!:MailboxSnapshot;const list=createMailboxList(context,{readPage,readThread,onChange:value=>state=value});return{list,state:()=>state}}

test('summary query includes context, encodes keyset cursor and preserves server counts independent of page size',async()=>{
 const url=new URL(summaryPath({...context,q:' from:alex & team ',cursor:'cursor/+=?'}),'https://local.example.test');assert.equal(url.pathname,'/thread-summaries');assert.equal(url.searchParams.get('q'),'from:alex & team');assert.equal(url.searchParams.get('cursor'),'cursor/+=?');assert.equal(url.searchParams.get('split'),'important');
 const s=setup(async options=>{assert.equal(options.split,'important');return page([summary('one',1),summary('two',2)],1000,'next')});await s.list.refresh();assert.equal(s.state().total,1000);assert.equal(s.state().counts.inbox,1234);assert.equal(s.state().threads.length,2);assert.equal('messages' in s.state().threads[0],false);s.list.dispose();
});

test('keyboard movement beyond the loaded edge queues safely and coalesces one next-page request',async()=>{
 const second=deferred<ThreadListPage>();let more=0;const s=setup(async options=>{if(options.cursor){more++;return second.promise}return page([summary('one',1),summary('two',2)],5,'next')});await s.list.refresh();s.list.select('two');const moves=[s.list.move(1),s.list.move(1),s.list.move(1)];await Promise.resolve();await Promise.resolve();assert.equal(more,1);second.resolve(page([summary('three',3),summary('four',4),summary('five',5)],5));await Promise.all(moves);assert.equal(s.state().selectedId,'five');assert.equal(more,1);s.list.dispose();
});

test('refresh preserves selected thread identity across new arrivals and pages until its prior range is covered',async()=>{
 let rows=[summary('one',1),summary('two',2),summary('three',3),summary('four',4)];let reads=0;
 const s=setup(async options=>{reads++;const start=options.cursor?rows.findIndex(item=>item.id===options.cursor)+1:0;const items=rows.slice(start,start+2);return page(items,rows.length,start+2<rows.length?items.at(-1)!.id:null)});
 await s.list.refresh();await s.list.loadMore();s.list.select('four');rows=[summary('new',0),...rows];await s.list.refresh();assert.equal(s.state().selectedId,'four');assert.deepEqual(s.state().threads.map(item=>item.id),['new','one','two','three','four']);assert.equal(reads,5);s.list.dispose();
});

test('new mail above an existing keyset cursor appears on refresh, and appended IDs are deduplicated',async()=>{
 let refresh=0;const s=setup(async options=>options.cursor?page([summary('two',2),summary('three',3)],4):page(refresh++?[summary('new',0),summary('one',1)]:[summary('one',1),summary('two',2)],4,'next'));
 await s.list.refresh();await s.list.loadMore();assert.deepEqual(s.state().threads.map(item=>item.id),['one','two','three']);await s.list.refresh();assert.equal(s.state().threads[0].id,'new');assert.equal(new Set(s.state().threads.map(item=>item.id)).size,s.state().threads.length);s.list.dispose();
});

test('refresh stops near a removed selection instead of walking the rest of the mailbox',async()=>{
 let removed=false,reads=0;const s=setup(async()=>{reads++;return removed?page([summary('one',1),summary('three',3)],999,'later'):page([summary('one',1),summary('two',2)],1000,'later')});await s.list.refresh();s.list.select('two');removed=true;await s.list.refresh();assert.equal(s.state().selectedId,'three');assert.equal(reads,2);s.list.dispose();
});

test('disposed account/folder/query requests cannot publish late rows or failures into a new list',async()=>{
 const old=deferred<ThreadListPage>();let latest!:MailboxSnapshot;
 const first=createMailboxList(context,{readPage:()=>old.promise,readThread:async()=>detail(summary('old',1)),onChange:value=>latest=value});const pending=first.refresh();first.dispose();
 const second=createMailboxList({...context,accountId:'b',folder:'all',q:'new query'},{readPage:async()=>page([summary('new-account',1,'b')]),readThread:async()=>detail(summary('new-account',1,'b')),onChange:value=>latest=value});await second.refresh();old.resolve(page([summary('old-account',1)]));await pending;assert.equal(latest.threads[0].accountId,'b');assert.equal(latest.threads[0].id,'new-account');second.dispose();
});

test('lazy detail results are sequenced, account checked and discarded when context is disposed',async()=>{
 const pending=new Map<string,ReturnType<typeof deferred<Thread>>>();const s=setup(async()=>page([summary('one',1),summary('two',2)]),id=>{const work=deferred<Thread>();pending.set(id,work);return work.promise});await s.list.refresh();const one=s.list.readThread('one'),two=s.list.readThread('two');pending.get('two')!.resolve(detail(summary('two',2)));assert.equal((await two)?.id,'two');pending.get('one')!.resolve(detail(summary('one',1)));assert.equal(await one,null);
 const late=s.list.readThread('one');s.list.dispose();pending.get('one')!.resolve(detail(summary('one',1)));assert.equal(await late,null);
 const guarded=setup(async()=>page([]),async()=>detail(summary('foreign',1,'b')));await assert.rejects(guarded.list.readThread('foreign'),/different account/);guarded.list.dispose();
});

test('next-page failures keep already loaded summaries and a retryable error',async()=>{
 let fail=true;const s=setup(async options=>{if(options.cursor&&fail)throw new Error('Synthetic next-page failure');return options.cursor?page([summary('two',2)]):page([summary('one',1)],2,'next')});await s.list.refresh();await assert.rejects(s.list.loadMore(),/Synthetic next-page failure/);assert.equal(s.state().threads[0].id,'one');assert.equal(s.state().hasMore,true);assert.equal(s.state().loadingMore,false);assert.match(s.state().error,/next-page failure/);fail=false;await s.list.loadMore();assert.equal(s.state().threads.length,2);assert.equal(s.state().error,'');s.list.dispose();
});

test('manual selection cancels queued navigation while a page is loading',async()=>{
 const next=deferred<ThreadListPage>();const s=setup(async options=>options.cursor?next.promise:page([summary('one',1),summary('two',2)],3,'next'));await s.list.refresh();s.list.select('two');const move=s.list.move(1);await Promise.resolve();await Promise.resolve();s.list.select('one');next.resolve(page([summary('three',3)],3));await move;assert.equal(s.state().selectedId,'one');s.list.dispose();
});

test('equal-date summary ties follow the backend UTF-8 ordering for non-ASCII IDs',async()=>{
 const bmp=summary('thread-\ue000',1),astral=summary('thread-\u{10000}',1);const s=setup(async()=>page([bmp,astral]));await s.list.refresh();assert.deepEqual(s.state().threads.map(item=>item.id),[astral.id,bmp.id]);s.list.dispose();
});

test('custom view route binds account/view and rejects search instead of bypassing membership',()=>{const c={...context,viewRef:'custom:stable-id' as const,settingsRevision:2,policyVersion:'local-v1'};const url=new URL(summaryPath({...c,cursor:'opaque'}),'https://local.example.test');assert.equal(url.pathname,'/split-inboxes/views/custom%3Astable-id/threads');assert.equal(url.searchParams.get('accountId'),'a');assert.equal(url.searchParams.has('q'),false);assert.throws(()=>summaryPath({...c,q:'subject:any'}),/not supported/);});
test('custom page generation mismatch preserves rows and selection rather than mixing snapshots',async()=>{const c={...context,viewRef:'custom:stable-id' as const,settingsRevision:2,policyVersion:'local-v1'},identity={viewRef:c.viewRef,settingsRevision:2,sourceGeneration:1,policyVersion:'local-v1'};let state!:MailboxSnapshot;const list=createMailboxList(c,{readPage:async options=>({...page([summary(options.cursor?'two':'one',1)],2,options.cursor?null:'next'),viewIdentity:{...identity,sourceGeneration:options.cursor?2:1}}),readThread:async()=>detail(summary('one',1)),onChange:value=>state=value});await list.refresh();await assert.rejects(list.loadMore(),/changed while loading/);assert.deepEqual(state.threads.map(x=>x.id),['one']);assert.equal(state.selectedId,'one');assert.equal(state.viewIdentity?.sourceGeneration,1);assert.equal(state.hasMore,true);list.dispose();});
test('partial custom count stays null while returned rows remain usable',async()=>{const c={...context,viewRef:'custom:stable-id' as const,settingsRevision:2,policyVersion:'local-v1'};let state!:MailboxSnapshot;const list=createMailboxList(c,{readPage:async()=>({...page([summary('one',1)]),total:null,viewIdentity:{viewRef:c.viewRef,settingsRevision:2,sourceGeneration:1,policyVersion:'local-v1'},coverage:{scope:'local-imported-metadata',status:'pending',pendingHeaders:1,reason:'Waiting for imported metadata'}}),readThread:async()=>detail(summary('one',1)),onChange:value=>state=value});await list.refresh();assert.equal(state.total,null);assert.equal(state.coverage?.status,'pending');assert.equal(state.threads.length,1);list.dispose();});
