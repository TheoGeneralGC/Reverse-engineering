import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiChat } from '../src/ai-chat.ts';
import { ApiError } from '../src/api.ts';
import type { AiChatRequest,AiChatStorage } from '../src/ai-chat.ts';
import type { AiChatSession,AiChatTurn,AiChatStatus,AiSourceReceipt } from '../../api/src/ai-chat-types.ts';
const at='2026-10-28T12:00:00Z';
const session=(accountId='a',id='session-'+accountId,patch:Partial<AiChatSession>={}):AiChatSession=>({id,accountId,title:'Synthetic '+id,createdAt:at,updatedAt:at,revision:0,turnCount:0,activeTurnId:null,...patch});
const status:AiChatStatus={implemented:true,configured:true,provider:'anthropic',model:'synthetic-model',missing:[],capabilities:['persistent-chat','streaming','local-mail-retrieval','source-citations','cancel'],policyVersion:'synthetic',coverage:[],limitations:[]};
const turn=(patch:Partial<AiChatTurn>={}):AiChatTurn=>({id:'turn-a',sessionId:'session-a',accountId:'a',seq:1,clientRequestId:'key-1',prompt:'Synthetic question',context:{resources:['mail']},state:'running',phase:'responding',revision:1,lastEventSeq:0,createdAt:at,provider:'anthropic',model:'synthetic-model',providerRequestIds:[],dispatchCount:1,partial:{markdown:'',thinkingSummary:null},answer:null,sources:[],usage:{inputTokens:1,outputTokens:0},limits:{providerRounds:1,toolCalls:0,summaryHits:0,fullThreadReads:0,contextBytes:1,outputTokens:0,exhausted:[]},coverage:[],error:null,cancellation:{requestedAt:null,localStoppedAt:null,providerOutcome:'unknown'},...patch});
const receipt=(id='source-1',number=1):AiSourceReceipt=>({id,number,accountId:'a',sessionId:'session-a',turnId:'turn-a',target:{kind:'mail',accountId:'a',threadId:'thread-'+id,messageIds:['message-'+id]},basis:'mail-text',label:'Synthetic '+id,secondaryLabel:'Sender',excerpt:'Synthetic fact',snapshotHash:id,fetchedAt:at,sourceUpdatedAt:at,truncated:false,partial:false});
const complete=(patch:Partial<AiChatTurn>={}):AiChatTurn=>turn({state:'completed',phase:'finished',revision:3,answer:{markdown:'Synthetic answer',plainText:'Synthetic answer',citations:[],sourceIds:[],finishReason:'end_turn',truncated:false},...patch});
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
function memory(){const values=new Map<string,string>();const storage:AiChatStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}};return{values,storage}}
type Call={path:string;body:any;method:string;signal?:AbortSignal};
function fixture(handler?:(call:Call)=>unknown|Promise<unknown>,saved=memory(),keyPrefix='key-'){
 const calls:Call[]=[],jobs=new Map<number,()=>void>();let nextJob=0,nextKey=0;
 const request:AiChatRequest=async(path,body,method='GET',options)=>{
  const call={path,body,method,signal:options?.signal};calls.push(call);const handled=await handler?.(call);if(handled!==undefined)return handled;
  const url=new URL(path,'http://synthetic.test'),accountId=url.searchParams.get('accountId')??(body as any)?.accountId??'a';
  if(url.pathname==='/ai/chat/status')return{status};
  if(url.pathname==='/ai/chat/sessions'&&method==='GET')return{sessions:[session(accountId)],nextCursor:null,hasMore:false};
  const detail=url.pathname.match(/^\/ai\/chat\/sessions\/([^/]+)$/);if(detail&&method==='GET')return{session:session(accountId,detail[1]),turns:[],nextBeforeSeq:null,hasMore:false};
  throw new Error('Unexpected synthetic route: '+method+' '+url.pathname);
 };
 const controller=createAiChat({request,storage:saved.storage,uuid:()=>`${keyPrefix}${++nextKey}`,schedule:fn=>{const id=++nextJob;jobs.set(id,fn);return id},cancelSchedule:handle=>{jobs.delete(handle as number)}});
 return{controller,calls,jobs,...saved,ready:async(accountId='a')=>{controller.setContext({accountId,visible:true});await drain()},close:()=>controller.dispose()};
}

test('late account list/status responses and unsent prompts remain isolated across accounts and sessions',async()=>{
 const oldStatus=deferred<unknown>(),oldSessions=deferred<unknown>();let hold=true;
 const f=fixture(call=>{const u=new URL(call.path,'http://synthetic.test');if(hold&&u.searchParams.get('accountId')==='a'){if(u.pathname.endsWith('/status'))return oldStatus.promise;if(u.pathname==='/ai/chat/sessions')return oldSessions.promise}});
 try{
  f.controller.setContext({accountId:'a',visible:true});await drain();f.controller.setContext({accountId:'b',visible:true});await drain();assert.equal(f.controller.getSnapshot().sessionId,'session-b');assert.ok(f.calls.filter(call=>call.path.includes('accountId=a')).every(call=>call.signal?.aborted));
  oldStatus.resolve({status:{...status,model:'A_PRIVATE_MODEL'}});oldSessions.resolve({sessions:[session('a','A_PRIVATE_SESSION')],nextCursor:null,hasMore:false});await drain();assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot()),/A_PRIVATE/);
  hold=false;await f.ready('a');f.controller.setPrompt('A unsent');await f.ready('b');assert.equal(f.controller.getSnapshot().prompt,'');f.controller.setPrompt('B unsent');await f.ready('a');assert.equal(f.controller.getSnapshot().prompt,'A unsent');
  await f.controller.selectSession('session-a-two');assert.equal(f.controller.getSnapshot().prompt,'');f.controller.setPrompt('A second session');await f.controller.selectSession('session-a');assert.equal(f.controller.getSnapshot().prompt,'A unsent');
 }finally{f.close()}
});

test('an unknown POST plus by-request404 keeps its durable key locked across reload and explicit replay preserves the exact request',async()=>{
 const post=deferred<unknown>();let postCount=0;const saved=memory();
 const handler=(call:Call)=>{if(call.method==='POST'&&call.path.endsWith('/turns')){postCount++;if(postCount===1)return post.promise;return{session:session('a','session-a',{revision:1,turnCount:1,activeTurnId:'turn-a'}),turn:turn({clientRequestId:call.body.clientRequestId,prompt:call.body.prompt,context:call.body.context})}}if(call.path.includes('/by-request/'))throw new ApiError('Not found',404,'ai_chat_not_found')};
 const f=fixture(handler,saved);try{
  await f.ready();f.controller.setPrompt('Original immutable question');const pending=f.controller.submit();void f.controller.submit();assert.equal(f.calls.filter(call=>call.method==='POST').length,1);post.reject(new TypeError('Synthetic lost ACK'));await pending;
  assert.ok(f.controller.getSnapshot().pending);assert.equal(f.controller.getSnapshot().uncertain,true);f.controller.setPrompt('Next unsent question');await f.controller.submit();assert.equal(postCount,1);
  const original=f.calls.find(call=>call.method==='POST')!.body;f.close();const restored=fixture(handler,saved,'would-be-new-key-');try{await restored.ready();assert.ok(restored.controller.getSnapshot().pending);assert.equal(restored.controller.getSnapshot().uncertain,true);await restored.controller.submit();assert.equal(postCount,1);await restored.controller.replayPending();assert.equal(postCount,2);assert.deepEqual(restored.calls.find(call=>call.method==='POST')?.body,original);assert.equal(restored.controller.getSnapshot().prompt,'Next unsent question')}finally{restored.close()}
 }finally{f.close()}
});

test('mismatched recovery prompt is rejected before rendering an answer or clearing the saved key',async()=>{
 const recovery=deferred<unknown>();const f=fixture(call=>{if(call.method==='POST'&&call.path.endsWith('/turns'))throw new TypeError('Synthetic lost ACK');if(call.path.includes('/by-request/'))return recovery.promise});
 try{
  await f.ready();f.controller.setPrompt('Expected immutable question');const submit=f.controller.submit();await drain();const key=f.controller.getSnapshot().pending!.request.clientRequestId;
  recovery.resolve({session:session('a','session-a',{revision:2,turnCount:1}),turn:complete({clientRequestId:key,prompt:'Different question',answer:{markdown:'WRONG_PRIVATE_ANSWER',plainText:'WRONG_PRIVATE_ANSWER',citations:[],sourceIds:[],finishReason:'end_turn',truncated:false}})});await submit;
  assert.ok(f.controller.getSnapshot().pending,'Invalid recovery must retain the durable key');assert.equal(f.controller.getSnapshot().uncertain,true);assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot().turns),/WRONG_PRIVATE_ANSWER/);assert.ok([...f.values.keys()].some(key=>key.includes(':pending:')));
 }finally{f.close()}
});

test('a late running recovery cannot regress a completed turn or its newer parent session revision',async()=>{
 const lookups:ReturnType<typeof deferred<unknown>>[]=[];const f=fixture(call=>{if(call.method==='POST'&&call.path.endsWith('/turns'))return{session:session('a','session-a',{revision:1,turnCount:1,activeTurnId:'turn-a'}),turn:turn({prompt:call.body.prompt,clientRequestId:call.body.clientRequestId})};if(call.path.includes('/by-request/')){const next=deferred<unknown>();lookups.push(next);return next.promise}});
 try{
  await f.ready();f.controller.setPrompt('Synthetic question');await f.controller.submit();const old=f.controller.recover(),fresh=f.controller.recover();await drain();assert.equal(lookups.length,2);
  lookups[1].resolve({session:session('a','session-a',{revision:2,turnCount:1}),turn:complete()});await fresh;lookups[0].resolve({session:session('a','session-a',{revision:1,turnCount:1,activeTurnId:'turn-a'}),turn:turn({revision:2})});await old;
  assert.equal(f.controller.getSnapshot().session?.revision,2);assert.equal(f.controller.getSnapshot().session?.activeTurnId,null);assert.equal(f.controller.getSnapshot().turns[0].state,'completed');assert.equal(f.controller.getSnapshot().pending,null);
 }finally{f.close()}
});

test('late source resolution cannot clear newer source progress or navigate a different target under the same account',async()=>{
 const first=deferred<unknown>(),second=deferred<unknown>(),one=receipt(),two=receipt('source-2',2),done=complete({sources:[one,two],answer:{markdown:'Facts [cite:1] [cite:2]',plainText:'Facts [1] [2]',citations:[{number:1,sourceId:one.id},{number:2,sourceId:two.id}],sourceIds:[one.id,two.id],finishReason:'end_turn',truncated:false}});
 const f=fixture(call=>{if(call.path.startsWith('/ai/chat/sessions/session-a?'))return{session:session('a','session-a',{revision:2,turnCount:1}),turns:[done],nextBeforeSeq:null,hasMore:false};if(call.path.startsWith('/ai/chat/sources/source-1?'))return first.promise;if(call.path.startsWith('/ai/chat/sources/source-2?'))return second.promise});
 try{
  await f.ready();const old=f.controller.resolveSource(done.id,one.id),fresh=f.controller.resolveSource(done.id,two.id);first.resolve({source:one,resolution:{availability:'available',target:one.target}});assert.equal(await old,null);assert.equal(f.controller.getSnapshot().resolving,two.id);
  second.resolve({source:two,resolution:{availability:'available',target:{...two.target,threadId:'different-unrelated-thread'}}});assert.equal(await fresh,null);assert.deepEqual(f.controller.getSnapshot().resolved,{});assert.match(f.controller.getSnapshot().error,/Unexpected/);
 }finally{f.close()}
});

test('an old account session-creation response cannot auto-submit its captured question into the new account',async()=>{
 const created=deferred<unknown>();const f=fixture(call=>{if(call.path==='/ai/chat/sessions'&&call.method==='POST')return created.promise;if(call.path.startsWith('/ai/chat/sessions?')&&call.path.includes('accountId=a'))return{sessions:[],nextCursor:null,hasMore:false}});
 try{
  await f.ready();f.controller.setPrompt('A_PRIVATE_PENDING_QUESTION');const pending=f.controller.submit();await drain();await f.ready('b');f.controller.setPrompt('B unsent');created.resolve({session:session('a','new-a')});await pending;
  assert.equal(f.controller.getSnapshot().context.accountId,'b');assert.equal(f.controller.getSnapshot().prompt,'B unsent');assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/turns')).length,0);
 }finally{f.close()}
});

test('unavailable or corrupted durable storage blocks dispatch instead of risking an untracked paid request',async()=>{
 for(const corrupt of [false,true]){
  const saved=memory();if(corrupt)saved.values.set('reconstruction.ask-ai.v1:pending:a:account','{');else saved.storage.setItem=()=>{throw new Error('Synthetic storage unavailable')};const f=fixture(undefined,saved);
  try{await f.ready();f.controller.setPrompt('Synthetic question');await f.controller.submit();assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.ok(f.controller.getSnapshot().recoveryBlocked||f.controller.getSnapshot().error)}finally{f.close()}
 }
});

test('malformed or inconsistent completed citation maps never publish a grounded answer or clear its pending key',async()=>{
 const one=receipt();
 const variants=[
  {sources:[one],citations:[null],sourceIds:[one.id]},
  {sources:[one],citations:[{number:1,sourceId:'unoffered-source'}],sourceIds:['unoffered-source']},
  {sources:[one],citations:[{number:2,sourceId:one.id}],sourceIds:[one.id]},
  {sources:[one,{...one,number:2}],citations:[{number:1,sourceId:one.id}],sourceIds:[one.id]},
 ];
 for(const variant of variants){
  const f=fixture(call=>{if(call.path.includes('/by-request/'))throw new ApiError('Not found',404,'ai_chat_not_found');if(call.method==='POST'&&call.path.endsWith('/turns'))return{session:session('a','session-a',{revision:2,turnCount:1}),turn:complete({prompt:call.body.prompt,clientRequestId:call.body.clientRequestId,sources:variant.sources,answer:{markdown:'FALSE_GROUNDED [cite:1]',plainText:'FALSE_GROUNDED [1]',citations:variant.citations as any,sourceIds:variant.sourceIds,finishReason:'end_turn',truncated:false}})}});
  try{await f.ready();f.controller.setPrompt('Synthetic question');await f.controller.submit();assert.ok(f.controller.getSnapshot().pending);assert.equal(f.controller.getSnapshot().uncertain,true);assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot().turns),/FALSE_GROUNDED/)}finally{f.close()}
 }
});

test('a visible-thread change affects only future questions and cannot retarget an already journaled request',async()=>{
 const post=deferred<unknown>();const f=fixture(call=>{if(call.method==='POST'&&call.path.endsWith('/turns'))return post.promise});
 try{
  await f.ready();f.controller.setContext({accountId:'a',visible:true,selectedThreadId:'thread-one'});f.controller.setPrompt('Synthetic question');const pending=f.controller.submit();const sent=f.calls.find(call=>call.method==='POST')!;
  assert.equal(sent.body.context.selectedThreadId,'thread-one');f.controller.setContext({accountId:'a',visible:true,selectedThreadId:'thread-two'});f.controller.setResources([]);assert.equal(sent.signal?.aborted,false);assert.equal(f.controller.getSnapshot().pending?.request.context.selectedThreadId,'thread-one');assert.deepEqual(f.controller.getSnapshot().pending?.request.context.resources,['mail']);
  post.resolve({session:session('a','session-a',{revision:1,turnCount:1,activeTurnId:'turn-a'}),turn:turn({context:sent.body.context})});await pending;
  assert.equal(f.controller.getSnapshot().context.selectedThreadId,'thread-two');assert.equal(f.controller.getSnapshot().turns[0].context.selectedThreadId,'thread-one');assert.deepEqual(f.controller.getSnapshot().resources,[]);
 }finally{f.close()}
});
