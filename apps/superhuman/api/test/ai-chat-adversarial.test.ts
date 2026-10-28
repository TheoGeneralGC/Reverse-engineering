import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { AiChatRepository,clip } from '../src/ai-chat-store.ts';
import { AiRetrieval,initializeAiMailIndex,refreshAiMailIndex } from '../src/ai-retrieval.ts';
import { citationAnswer } from '../src/ai-citations.ts';
import { CalendarStore } from '../src/calendar-store.ts';
import { CALENDAR_SCOPES } from '../src/google-scopes.ts';
import { AiChatService } from '../src/ai-chat.ts';
import type { AiChatSubmit,AiProgressPayload } from '../src/ai-chat-types.ts';
import type { Thread } from '../src/types.ts';

const fixed=Date.parse('2026-10-28T12:00:00Z');
function fixture(){
 const store=new Store(':memory:',false);
 for(const id of ['account-a','account-b'])store.put('account',id,{id,provider:'demo',name:'Synthetic '+id,email:id+'@example.test'});
 const repository=new AiChatRepository(store.db,()=>fixed,()=>true);
 return{store,repository,close:()=>store.close()};
}
const request=(accountId='account-a',patch:Partial<AiChatSubmit>={}):AiChatSubmit=>({accountId,clientRequestId:randomUUID(),expectedRevision:0,prompt:'Synthetic question',context:{resources:[]},...patch});
const code=(expected:string)=>(error:unknown)=>{assert.equal((error as {code?:string}).code,expected);return true};
const mail=(id:string,accountId='account-a'):Thread=>({id,accountId,subject:'Synthetic original fact',snippet:'Synthetic preview',sender:{name:'Sender',email:'sender@example.test'},participants:[],lastMessageAt:new Date(fixed).toISOString(),unread:false,starred:false,important:false,folder:'inbox',labels:[],messages:[{id:id+'-message',sender:{name:'Sender',email:'sender@example.test'},to:[],date:new Date(fixed).toISOString(),text:'Synthetic original body',attachments:[],providerLabels:['INBOX']}]});
function modelReply(text:string,tools:{id:string;name:string;input:Record<string,unknown>}[]=[]){
 const frames:Record<string,unknown>[]=[{type:'message_start',message:{id:'msg_synthetic',type:'message',role:'assistant',model:'synthetic-model',content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}}];let index=0;
 if(text){frames.push({type:'content_block_start',index,content_block:{type:'text',text:''}},{type:'content_block_delta',index,delta:{type:'text_delta',text}},{type:'content_block_stop',index});index++}
 for(const tool of tools){frames.push({type:'content_block_start',index,content_block:{type:'tool_use',id:tool.id,name:tool.name,input:{}}},{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}},{type:'content_block_stop',index});index++}
 frames.push({type:'message_delta',delta:{stop_reason:tools.length?'tool_use':'end_turn'},usage:{output_tokens:10}},{type:'message_stop'});
 return new Response(frames.map(frame=>`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
function serviceFixture(fetcher:typeof fetch,now=()=>fixed){
 const f=fixture(),service=new AiChatService(f.store,{DATABASE_PATH:':memory:',ANTHROPIC_API_KEY:'synthetic-key',ANTHROPIC_MODEL:'synthetic-model'},fetcher,{autoRun:false,now});
 return{...f,service,close:async()=>{await service.close();f.close()}};
}

test('repository account/session/turn/event identities fail closed with one not-found shape',()=>{
 const f=fixture();try{
  const a=f.repository.createSession('account-a'),b=f.repository.createSession('account-b'),turn=f.repository.accept(a.id,request(),'synthetic-model').turn;
  const lookups=[()=>f.repository.session('account-b',a.id),()=>f.repository.session('account-b','absent'),()=>f.repository.turn('account-b',b.id,turn.id),()=>f.repository.turn('account-a',a.id,'absent'),()=>f.repository.events('account-b',b.id,turn.id),()=>f.repository.byRequest('account-b',b.id,turn.clientRequestId)];
  for(const read of lookups)assert.throws(read,error=>{assert.equal((error as {status?:number}).status,404);assert.equal((error as Error).message,'Chat resource not found');return code('ai_chat_not_found')(error)});
  assert.deepEqual(f.repository.sessionDetail('account-b',b.id).turns,[]);
 }finally{f.close()}
});

test('same-key replay recovers the original turn before revision/capacity checks; changed immutable fields conflict',()=>{
 const f=fixture();try{
  const session=f.repository.createSession('account-a'),input=request(),first=f.repository.accept(session.id,input,'synthetic-model');
  const replay=f.repository.accept(session.id,input,'synthetic-model');assert.equal(first.accepted,true);assert.equal(replay.accepted,false);assert.equal(replay.turn.id,first.turn.id);assert.equal(f.repository.session('account-a',session.id).turnCount,1);
  for(const patch of [{prompt:'Different question'},{expectedRevision:1},{context:{resources:['mail'] as const}}])assert.throws(()=>f.repository.accept(session.id,{...input,...patch} as AiChatSubmit,'synthetic-model'),code('ai_chat_request_conflict'));
  assert.throws(()=>f.repository.accept(session.id,request('account-a',{expectedRevision:1}),'synthetic-model'),code('ai_chat_turn_in_progress'));
  assert.equal(f.repository.sessionDetail('account-a',session.id).turns.length,1);
 }finally{f.close()}
});

test('a second SQLite owner can recover the accepted key but cannot mutate or redispatch another live owner turn',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rea-ai-two-owner-')),databasePath=join(directory,'isolated.sqlite');
 const one=new Store(databasePath,false),two=new Store(databasePath,false);
 try{
  one.put('account','account-a',{id:'account-a',provider:'demo',name:'Synthetic A',email:'a@example.test'});
  const first=new AiChatRepository(one.db,()=>fixed,()=>true),session=first.createSession('account-a'),input=request(),accepted=first.accept(session.id,input,'synthetic-model').turn;
  first.update(accepted.id,turn=>{turn.state='running';turn.dispatchCount=1});
  const second=new AiChatRepository(two.db,()=>fixed,()=>true),replay=second.accept(session.id,input,'synthetic-model');assert.equal(replay.accepted,false);assert.equal(replay.turn.id,accepted.id);
  const result=second.update(accepted.id,turn=>{turn.dispatchCount++;turn.partial.markdown='FOREIGN_OWNER_MARKER'},[{kind:'text_delta',text:'FOREIGN_OWNER_MARKER'}]);
  assert.equal(result.dispatchCount,1);assert.equal(result.partial.markdown,'');assert.equal(first.events('account-a',session.id,accepted.id).events.length,0);
  const another=second.createSession('account-a');assert.throws(()=>second.accept(another.id,request(),'synthetic-model'),code('ai_chat_capacity'));
 }finally{two.close();one.close();rmSync(directory,{recursive:true,force:true})}
});

test('dead-owner recovery distinguishes undispatched interruption from unknown dispatched outcome and fences late completion',()=>{
 for(const dispatched of [false,true]){
  const f=fixture();try{
   const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request(),'synthetic-model').turn;
   if(dispatched)f.repository.update(turn.id,current=>{current.state='running';current.dispatchCount=1});
   const recovered=new AiChatRepository(f.store.db,()=>fixed,()=>false).turn('account-a',session.id,turn.id);
   assert.equal(recovered.state,dispatched?'outcome_unknown':'interrupted');assert.equal(recovered.error?.providerOutcome,dispatched?'unknown':'not_dispatched');assert.equal(recovered.answer,null);assert.equal(recovered.dispatchCount,dispatched?1:0);assert.equal(f.repository.session('account-a',session.id).activeTurnId,null);
   const late=f.repository.update(turn.id,current=>{current.state='completed';current.partial.markdown='LATE_COMPLETION_MARKER'},[{kind:'text_delta',text:'LATE_COMPLETION_MARKER'}]);assert.equal(late.state,recovered.state);assert.equal(late.partial.markdown,'');
   const events=f.repository.events('account-a',session.id,turn.id);assert.equal(events.terminal,true);assert.equal(events.events.at(-1)?.payload.kind,'terminal');assert.doesNotMatch(JSON.stringify(events),/LATE_COMPLETION_MARKER/);
  }finally{f.close()}
 }
});

test('session cursors stay account-bound across equal dates and new arrivals while UTF-8 clipping keeps complete code points',()=>{
 const f=fixture();try{
  const sessions=Array.from({length:4},()=>f.repository.createSession('account-a'));f.repository.createSession('account-b');
  const head=f.repository.listSessions('account-a',2);assert.equal(head.sessions.length,2);assert.equal(head.hasMore,true);assert.ok(head.nextCursor);
  f.repository.createSession('account-a');const tail=f.repository.listSessions('account-a',2,head.nextCursor);
  assert.equal(new Set([...head.sessions,...tail.sessions].map(session=>session.id)).size,4);assert.ok(tail.sessions.every(session=>session.accountId==='account-a'));
  assert.throws(()=>f.repository.listSessions('account-b',2,head.nextCursor),code('ai_chat_invalid_cursor'));
  assert.throws(()=>f.repository.listSessions('account-a',2,'x'.repeat(5000)),code('ai_chat_invalid_cursor'));
  assert.equal(clip('a😀b',4),'a');assert.equal(clip('a😀b',5),'a😀');assert.equal(clip('éé',3),'é');assert.ok(sessions.every(session=>session.accountId==='account-a'));
 }finally{f.close()}
});

test('event-count overflow terminates locally with a bounded terminal event instead of silently discarding progress',()=>{
 const f=fixture();try{
  const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request(),'synthetic-model').turn;
  const payloads=Array.from({length:1023},():AiProgressPayload=>({kind:'text_delta',text:'x'}));f.repository.update(turn.id,current=>{current.state='running'},payloads);
  const result=f.repository.update(turn.id,()=>{},[{kind:'text_delta',text:'y'},{kind:'text_delta',text:'z'}]);
  assert.ok(['failed','cancelled','interrupted','outcome_unknown'].includes(result.state),'Overflow must terminate rather than leave a running turn with missing progress');assert.equal(result.answer,null);assert.ok(result.limits.exhausted.includes('events'));assert.ok(result.lastEventSeq<=1024);
  assert.equal(f.repository.session('account-a',session.id).activeTurnId,null);const rows=f.store.db.prepare('SELECT data FROM ai_events WHERE turn_id=? ORDER BY seq').all(turn.id);assert.ok(rows.length<=1024);assert.equal(JSON.parse(String(rows.at(-1)?.data)).payload.kind,'terminal');
 }finally{f.close()}
});

test('event-byte budget measures complete stored envelopes and ends before its serialized log exceeds one MiB',()=>{
 const f=fixture();try{
  const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request(),'synthetic-model').turn;
  const envelope={accountId:'account-a',sessionId:session.id,turnId:turn.id,seq:1,revision:1,createdAt:new Date(fixed).toISOString(),payload:{kind:'text_delta',text:''}};
  const remaining=1_048_576-Buffer.byteLength(JSON.stringify(envelope),'utf8');
  // The bare payload fits; its complete durable envelope exceeds the ceiling.
  const result=f.repository.update(turn.id,current=>{current.state='running'},[{kind:'text_delta',text:'X'.repeat(remaining+1)}]);
  assert.ok(['failed','cancelled','interrupted','outcome_unknown'].includes(result.state));assert.equal(result.answer,null);assert.ok(result.limits.exhausted.includes('events'));
  const bytes=f.store.db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM ai_events WHERE turn_id=?').get(turn.id);assert.ok(Number(bytes?.n)<=1_048_576);assert.equal(f.repository.events('account-a',session.id,turn.id).events.at(-1)?.payload.kind,'terminal');
 }finally{f.close()}
});

test('source resolution and body reads reject foreign accounts, turns and invented source IDs',()=>{
 const f=fixture();try{
  initializeAiMailIndex(f.store.db);const a=f.repository.createSession('account-a'),b=f.repository.createSession('account-b');
  f.store.put('thread','thread-a',mail('thread-a'));f.store.put('thread','thread-b',mail('thread-b','account-b'));
  const turnA=f.repository.accept(a.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,turnB=f.repository.accept(b.id,request('account-b',{context:{resources:['mail']}}),'synthetic-model').turn;
  const readA=new AiRetrieval(f.store,f.repository,turnA.id,()=>fixed),readB=new AiRetrieval(f.store,f.repository,turnB.id,()=>fixed),source=readA.readThread('thread-a','selected-thread').source;
  assert.throws(()=>readA.readThread('thread-b','mail-text'),code('ai_chat_not_found'));
  assert.throws(()=>readB.read({sourceIds:[source.id]}),code('ai_chat_not_found'));
  for(const lookup of [()=>readB.resolve('account-b',b.id,turnB.id,source.id),()=>readA.resolve('account-a',a.id,turnA.id,'invented-source'),()=>readB.resolve('account-b',a.id,turnA.id,source.id)])assert.throws(lookup,code('ai_chat_not_found'));
  assert.equal(readA.resolve('account-a',a.id,turnA.id,source.id).resolution.target?.accountId,'account-a');
 }finally{f.close()}
});

test('a source changed under the same message date is disclosed while its historical receipt stays immutable',()=>{
 const f=fixture();try{
  initializeAiMailIndex(f.store.db);const session=f.repository.createSession('account-a'),original=mail('changed-thread');f.store.put('thread',original.id,original);refreshAiMailIndex(f.store,'account-a');
  const turn=f.repository.accept(session.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,retrieval=new AiRetrieval(f.store,f.repository,turn.id,()=>fixed),source=retrieval.readThread(original.id,'selected-thread').source;
  assert.equal(retrieval.resolve('account-a',session.id,turn.id,source.id).resolution.availability,'available');
  const changed={...original,subject:'Synthetic corrected fact',messages:[{...original.messages[0],text:'Synthetic corrected body'}]};f.store.put('thread',original.id,changed);
  const resolved=retrieval.resolve('account-a',session.id,turn.id,source.id);assert.equal(resolved.resolution.availability,'changed');assert.equal(resolved.source.label,'Synthetic original fact');assert.match(resolved.source.excerpt,/Synthetic original body/);assert.doesNotMatch(JSON.stringify(resolved.source),/Synthetic corrected/);
  f.store.db.prepare("DELETE FROM records WHERE kind='thread' AND id=?").run(original.id);const absent=retrieval.resolve('account-a',session.id,turn.id,source.id);assert.equal(absent.resolution.availability,'unavailable');assert.equal(absent.resolution.target,null);assert.equal(absent.source.snapshotHash,source.snapshotHash);
 }finally{f.close()}
});

test('a received source that becomes draft-only loses its current navigation target without losing its historical receipt',()=>{
 const f=fixture();try{
  initializeAiMailIndex(f.store.db);const session=f.repository.createSession('account-a'),original=mail('received-to-draft');f.store.put('thread',original.id,original);refreshAiMailIndex(f.store,'account-a');
  const turn=f.repository.accept(session.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,retrieval=new AiRetrieval(f.store,f.repository,turn.id,()=>fixed),source=retrieval.readThread(original.id,'selected-thread').source;
  f.store.put('thread',original.id,{...original,messages:[{...original.messages[0],providerLabels:['DRAFT']}]});
  assert.throws(()=>retrieval.readThread(original.id,'mail-text'),code('ai_chat_not_found'));
  const resolved=retrieval.resolve('account-a',session.id,turn.id,source.id);assert.equal(resolved.resolution.availability,'unavailable');assert.equal(resolved.resolution.target,null);assert.equal(resolved.source.id,source.id);assert.match(resolved.source.excerpt,/Synthetic original body/);
 }finally{f.close()}
});

test('a read batch that exceeds its remaining budget creates no partially offered full-text receipts',()=>{
 const f=fixture();try{
  initializeAiMailIndex(f.store.db);for(const id of ['batch-a','batch-b'])f.store.put('thread',id,mail(id));refreshAiMailIndex(f.store,'account-a');
  const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,retrieval=new AiRetrieval(f.store,f.repository,turn.id,()=>fixed);
  const summaries=retrieval.search({query:'Synthetic'}).sources;assert.equal(summaries.length,2);f.repository.update(turn.id,t=>{t.state='running'});f.repository.dispatch(turn.id,summaries.map(source=>source.id),{synthetic:'dispatch'});retrieval.reserve('fullThreadReads',7,8);
  assert.throws(()=>retrieval.read({sourceIds:summaries.map(source=>source.id)}),code('ai_chat_invalid_request'));
  const after=f.repository.turn('account-a',session.id,turn.id);assert.equal(after.limits.fullThreadReads,7);assert.deepEqual(after.sources.map(source=>source.id),summaries.map(source=>source.id));assert.deepEqual([...f.repository.offered(turn.id)].sort(),summaries.map(source=>source.id).sort());
 }finally{f.close()}
});

test('dispatch receipts and attempts commit atomically and reject invented sources without advancing a paid-attempt counter',()=>{
 const f=fixture();try{
  initializeAiMailIndex(f.store.db);f.store.put('thread','dispatch-thread',mail('dispatch-thread'));
  const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,retrieval=new AiRetrieval(f.store,f.repository,turn.id,()=>fixed),source=retrieval.readThread('dispatch-thread','selected-thread').source;
  f.repository.update(turn.id,t=>{t.state='running'});assert.throws(()=>f.repository.dispatch(turn.id,[source.id,'invented-source'],{synthetic:'dispatch'}),code('ai_chat_invalid_request'));
  assert.equal(f.repository.turn('account-a',session.id,turn.id).dispatchCount,0);assert.equal(f.repository.offered(turn.id).size,0);assert.equal(Number(f.store.db.prepare('SELECT COUNT(*) AS n FROM ai_dispatches WHERE turn_id=?').get(turn.id)?.n),0);
  const dispatched=f.repository.dispatch(turn.id,[source.id],{synthetic:'dispatch'});assert.equal(dispatched.dispatchCount,1);assert.equal(f.repository.offered(turn.id).has(source.id),true);
 }finally{f.close()}
});

test('server citation extraction agrees that HTML literals are not grounded prose citations',()=>{
 const f=fixture();try{
  initializeAiMailIndex(f.store.db);f.store.put('thread','citation-thread',mail('citation-thread'));
  const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,source=new AiRetrieval(f.store,f.repository,turn.id,()=>fixed).readThread('citation-thread','selected-thread').source;
  const text='<span title="[cite:1]">literal</span> <!-- [cite:1] -->';
  const answer=citationAnswer(text,[source],false);assert.deepEqual(answer.citations,[]);assert.deepEqual(answer.sourceIds,[]);assert.match(answer.plainText,/\[cite:1\]/);
 }finally{f.close()}
});

test('cached all-day retrieval uses its calendar IANA day boundaries rather than UTC midnight',()=>{
 const f=fixture();try{
  const calendars=new CalendarStore(f.store.db),calendarId='synthetic-calendar',zone='America/Los_Angeles';
  f.store.put('googleGrant','calendar:account-a',{accountId:'account-a',service:'calendar',requestedScopes:[CALENDAR_SCOPES.read],grantedScopes:[CALENDAR_SCOPES.read],scopeSource:'response',outcome:'granted',updatedAt:new Date(fixed).toISOString()});
  calendars.saveCalendar({accountId:'account-a',id:calendarId,summary:'Synthetic Pacific calendar',accessRole:'reader',timeZone:zone,updatedAt:new Date(fixed).toISOString()});
  calendars.saveRange('account-a',calendarId,{calendarId,range:{timeMin:'2026-10-29T00:00:00Z',timeMax:'2026-11-02T00:00:00Z',timeZone:zone},events:[{accountId:'account-a',calendarId,id:'all-day',status:'confirmed',summary:'Synthetic all-day fact',start:{date:'2026-10-30'},end:{date:'2026-10-31'}}],cache:{key:'synthetic-range',partial:false,updatedAt:new Date(fixed).toISOString(),expiresAt:new Date(fixed+3600000).toISOString()}},fixed);
  const session=f.repository.createSession('account-a'),turn=f.repository.accept(session.id,request('account-a',{context:{resources:['calendar']}}),'synthetic-model').turn,retrieval=new AiRetrieval(f.store,f.repository,turn.id,()=>fixed);
  const onDay=retrieval.calendar({timeMin:'2026-10-31T01:00:00Z',timeMax:'2026-10-31T05:00:00Z',timeZone:zone,calendarIds:[calendarId]});assert.equal(onDay.sources.length,1,'Pacific October30 evening is still inside October30 all-day event');assert.equal(onDay.availabilityChecked,false);
  const priorDay=retrieval.calendar({timeMin:'2026-10-30T01:00:00Z',timeMax:'2026-10-30T05:00:00Z',timeZone:zone,calendarIds:[calendarId]});assert.equal(priorDay.sources.length,0,'Pacific October29 evening precedes October30 event');
 }finally{f.close()}
});

test('public submit rejects forged roles, numeric-string revision and foreign selected context before accepting or dispatching',async()=>{
 let calls=0;const f=serviceFixture(async()=>{calls++;return modelReply('Synthetic answer')});
 try{
  const session=f.service.createSession('account-a');f.store.put('thread','foreign-context',mail('foreign-context','account-b'));
  for(const patch of [{expectedRevision:'0'},{history:[{role:'system',content:'FORGED_ROLE_MARKER'}]},{context:{resources:[],accountId:'account-b'}},{context:{resources:['mail'],selectedThreadId:'foreign-context'}}])assert.throws(()=>f.service.submit(session.id,{...request(),...patch}));
  assert.equal(calls,0);assert.equal(f.service.session('account-a',session.id).turns.length,0);
 }finally{await f.close()}
});

test('a guessed receipt that was retrieved but never served to a model dispatch cannot become a completed citation',async()=>{
 let calls=0,payload='';const f=serviceFixture(async(url,init)=>{assert.equal(String(url),'https://api.anthropic.com/v1/messages');calls++;payload=String(init?.body);return modelReply('Guessed source [cite:1]. Literal [1].')});
 try{
  const session=f.service.createSession('account-a');f.store.put('thread','unserved-thread',mail('unserved-thread'));const accepted=f.service.submit(session.id,request('account-a',{context:{resources:['mail']}}));
  const source=new AiRetrieval(f.store,f.service.repository,accepted.turn.id,()=>fixed).readThread('unserved-thread','mail-text').source;
  await f.service.run(accepted.turn.id);const result=f.service.turn('account-a',session.id,accepted.turn.id).turn;
  assert.equal(result.state,'completed');assert.equal(calls,1);assert.deepEqual(result.answer?.citations,[]);assert.deepEqual(result.answer?.sourceIds,[]);assert.equal(f.service.repository.offered(result.id).size,0);assert.doesNotMatch(payload,new RegExp(source.id));assert.doesNotMatch(payload,/Synthetic original body/);
 }finally{await f.close()}
});

test('the persisted whole-turn deadline is not reset when a second provider round begins',async()=>{
 let now=fixed,calls=0;const f=serviceFixture(async()=>{calls++;now=fixed+(calls===1?59000:60001);return calls===1?modelReply('',[{id:'search-after-wait',name:'mail_search',input:{query:'Absent'}}]):modelReply('Must not complete after deadline')},()=>now);
 try{
  const session=f.service.createSession('account-a'),accepted=f.service.submit(session.id,request('account-a',{context:{resources:['mail']}}));await f.service.run(accepted.turn.id);const result=f.service.turn('account-a',session.id,accepted.turn.id).turn;
  assert.equal(result.deadlineAt,new Date(fixed+60000).toISOString());assert.equal(calls,2);assert.equal(result.dispatchCount,2);assert.notEqual(result.state,'completed');assert.equal(result.answer,null);assert.ok(result.limits.exhausted.includes('deadline'));
 }finally{await f.close()}
});

test('changed prior sources omit old assistant facts from history and a second account receives none of that session',async()=>{
 const requests:Record<string,any>[]=[];const f=serviceFixture(async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return modelReply(requests.length===1?'A_PRIVATE_FACT [cite:1]':'Synthetic new answer')});
 try{
  const session=f.service.createSession('account-a'),original=mail('history-source');f.store.put('thread',original.id,original);f.service.refreshIndex('account-a');
  const first=f.service.submit(session.id,request('account-a',{prompt:'A_PRIVATE_QUESTION',context:{resources:[],selectedThreadId:original.id}}));await f.service.run(first.turn.id);assert.equal(f.service.turn('account-a',session.id,first.turn.id).turn.state,'completed');
  f.store.put('thread',original.id,{...original,subject:'Corrected source'});
  const second=f.service.submit(session.id,request('account-a',{expectedRevision:f.service.session('account-a',session.id).session.revision,prompt:'A_SECOND_QUESTION'}));await f.service.run(second.turn.id);
  assert.doesNotMatch(JSON.stringify(requests[1]),/A_PRIVATE_FACT|A_PRIVATE_QUESTION/);const question=JSON.parse(requests[1].messages.at(-1).content);assert.equal(question.omittedHistoryTurns,1);assert.equal(f.service.turn('account-a',session.id,second.turn.id).turn.answer?.truncated,true);
  const other=f.service.createSession('account-b'),third=f.service.submit(other.id,request('account-b',{prompt:'B_QUESTION'}));await f.service.run(third.turn.id);assert.doesNotMatch(JSON.stringify(requests[2]),/A_PRIVATE|A_SECOND|history-source|Synthetic original body/);
 }finally{await f.close()}
});

test('a completion transaction failure leaves no completed answer and key recovery never redispatches it',async()=>{
 let calls=0;const f=serviceFixture(async()=>{calls++;return modelReply('Synthetic full answer')});
 try{
  const session=f.service.createSession('account-a'),input=request(),originalUpdate=f.service.repository.update.bind(f.service.repository);
  f.service.repository.update=(id,change,payloads=[],allowOtherOwner=false)=>originalUpdate(id,turn=>{change(turn);if(turn.state==='completed')throw new Error('SYNTHETIC_COMMIT_FAILURE')},payloads,allowOtherOwner);
  const accepted=f.service.submit(session.id,input);await f.service.run(accepted.turn.id);const result=f.service.turn('account-a',session.id,accepted.turn.id).turn;
  assert.equal(result.state,'failed');assert.equal(result.answer,null);assert.equal(result.dispatchCount,1);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result.error),/SYNTHETIC_COMMIT_FAILURE/);assert.equal(f.service.submit(session.id,input).turn.id,result.id);assert.equal(f.service.byRequest('account-a',session.id,input.clientRequestId).turn.state,'failed');assert.equal(calls,1);assert.ok(f.service.events('account-a',session.id,result.id).events.every(event=>event.payload.kind!=='terminal'||event.payload.state!=='completed'));
 }finally{await f.close()}
});

test('a plain SQLite REPLACE with recursive triggers disabled removes old indexed text before rebuilding',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rea-ai-replace-')),databasePath=join(directory,'isolated.sqlite'),store=new Store(databasePath,false);let legacy:DatabaseSync|undefined;
 try{
  store.put('account','account-a',{id:'account-a',provider:'demo',name:'Synthetic A',email:'a@example.test'});initializeAiMailIndex(store.db);
  const original={...mail('replace-thread'),snippet:'OLD_REPLACED_PREVIEW',messages:[{...mail('replace-thread').messages[0],text:'OLD_REPLACED_BODY'}]};store.put('thread',original.id,original);refreshAiMailIndex(store,'account-a');
  const repository=new AiChatRepository(store.db,()=>fixed),session=repository.createSession('account-a'),turn=repository.accept(session.id,request('account-a',{context:{resources:['mail']}}),'synthetic-model').turn,retrieval=new AiRetrieval(store,repository,turn.id,()=>fixed);
  assert.equal(retrieval.search({query:'OLD_REPLACED_BODY'}).sources.length,1);
  legacy=new DatabaseSync(databasePath);legacy.exec('PRAGMA recursive_triggers=OFF; PRAGMA foreign_keys=OFF');
  const replacement={...original,snippet:'NEW_REPLACED_PREVIEW',messages:[{...original.messages[0],text:'NEW_REPLACED_BODY'}]};legacy.prepare('INSERT OR REPLACE INTO records(kind,id,data) VALUES(?,?,?)').run('thread',original.id,JSON.stringify(replacement));
  assert.equal(retrieval.search({query:'OLD_REPLACED_BODY'}).sources.length,0,'Old body must be inaccessible as soon as the original row is replaced');assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS n FROM ai_mail_pending WHERE thread_id=?').get(original.id)?.n),1);assert.equal(retrieval.search({query:'NEW_REPLACED_BODY'}).sources.length,0);
  refreshAiMailIndex(store,'account-a');const current=retrieval.search({query:'NEW_REPLACED_BODY'}).sources;assert.equal(current.length,1);assert.equal(current[0].excerpt,'NEW_REPLACED_PREVIEW');assert.doesNotMatch(JSON.stringify(current),/OLD_REPLACED/);
  assert.equal(store.db.prepare("SELECT data FROM records WHERE kind='thread' AND id=?").get(original.id)?.data,JSON.stringify(replacement));
 }finally{legacy?.close();store.close();rmSync(directory,{recursive:true,force:true})}
});
