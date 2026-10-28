import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readClaudeStream,AiStreamError } from '../src/ai-stream.ts';
import type { ClaudeProgress } from '../src/ai-stream.ts';

type Json=Record<string,unknown>;
const frame=(name:string,value:Json,eol='\n')=>`event: ${name}${eol}data: ${JSON.stringify(value)}${eol}${eol}`;
const start=(eol='\n')=>frame('message_start',{type:'message_start',message:{id:'msg_synthetic',type:'message',role:'assistant',content:[],usage:{input_tokens:7}}},eol);
const block=(type:string,extra:Json={},index=0,eol='\n')=>frame('content_block_start',{type:'content_block_start',index,content_block:{type,...extra}},eol);
const delta=(type:string,extra:Json={},index=0,eol='\n')=>frame('content_block_delta',{type:'content_block_delta',index,delta:{type,...extra}},eol);
const stop=(index=0,eol='\n')=>frame('content_block_stop',{type:'content_block_stop',index},eol);
const finish=(reason='end_turn',eol='\n')=>frame('message_delta',{type:'message_delta',delta:{stop_reason:reason},usage:{output_tokens:9}},eol)+frame('message_stop',{type:'message_stop'},eol);
const textRound=(text='Café 😀',eol='\n')=>start(eol)+block('text',{text:''},0,eol)+delta('text_delta',{text},0,eol)+stop(0,eol)+finish('end_turn',eol);
function response(text:string,chunkSize?:number){
 const bytes=new TextEncoder().encode(text),chunks=chunkSize?Array.from({length:Math.ceil(bytes.length/chunkSize)},(_,index)=>bytes.subarray(index*chunkSize,(index+1)*chunkSize)):[bytes];
 return new Response(new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close()}}),{headers:{'content-type':'text/event-stream; charset=utf-8'}});
}
const parse=(text:string,chunkSize?:number,progress:ClaudeProgress[]=[])=>readClaudeStream(response(text,chunkSize),new AbortController().signal,value=>progress.push(value));
const invalid=(error:unknown)=>{assert.ok(error instanceof AiStreamError);assert.match(error.code,/^ai_chat_/);return true};

test('one-byte UTF-8 and CRLF fragmentation preserves exact text and one genuine lifecycle',async()=>{
 const progress:ClaudeProgress[]=[];
 const result=await parse(': synthetic comment\r\n\r\n'+frame('ping',{type:'ping'},'\r\n')+textRound('Café 😀 — mañana','\r\n'),1,progress);
 assert.equal(result.id,'msg_synthetic');assert.equal(result.stopReason,'end_turn');assert.deepEqual(result.blocks,[{type:'text',text:'Café 😀 — mañana'}]);assert.equal(result.inputTokens,7);assert.equal(result.outputTokens,9);
 assert.deepEqual(progress.filter(item=>item.kind==='text').map(item=>item.text),['Café 😀 — mañana']);assert.equal(progress.filter(item=>item.kind==='request_id').length,1);
 const whole=await parse(textRound('Whole CRLF frame','\r\n'));assert.equal(whole.blocks[0]?.type,'text');assert.equal(whole.stopReason,'end_turn');
});

test('CR-only final boundaries and multiline data fields obey SSE framing without a following chunk',async()=>{
 const eol='\r',ping='event: ping\rdata: {"type":\rdata: "ping"}\r\r';
 const result=await parse(ping+textRound('CR-only complete',eol));assert.equal(result.blocks[0]?.type,'text');assert.equal(result.stopReason,'end_turn');
});

test('fragmented tool input becomes a structured object only after its block closes',async()=>{
 const json='{"query":"Café \\"quoted\\" 😀","limit":2}';
 const wire=start()+block('tool_use',{id:'call_synthetic',name:'mail_search',input:{}})+delta('input_json_delta',{partial_json:json.slice(0,19)})+delta('input_json_delta',{partial_json:json.slice(19)})+stop()+finish('tool_use');
 const progress:ClaudeProgress[]=[];const result=await parse(wire,3,progress);assert.equal(result.stopReason,'tool_use');assert.deepEqual(result.blocks,[{type:'tool_use',id:'call_synthetic',name:'mail_search',input:JSON.parse(json)}]);assert.equal(progress.some(item=>item.kind==='text'),false);
});

test('unfinished, array-valued, malformed and duplicate-ID tool blocks never return an executable tool result',async()=>{
 for(const wire of [
  start()+block('tool_use',{id:'call_one',name:'mail_search',input:{}})+delta('input_json_delta',{partial_json:'{"query":'})+finish('tool_use'),
  start()+block('tool_use',{id:'call_one',name:'mail_search',input:{}})+delta('input_json_delta',{partial_json:'[]'})+stop()+finish('tool_use'),
  start()+block('tool_use',{id:'call_one',name:'mail_search',input:{}})+delta('input_json_delta',{partial_json:'{"query":}'})+stop()+finish('tool_use'),
  start()+block('tool_use',{id:'call_one',name:'mail_search',input:{}})+stop()+block('tool_use',{id:'call_one',name:'mail_search',input:{}},1)+stop(1)+finish('tool_use'),
 ])await assert.rejects(parse(wire),invalid);
});

test('transport EOF, missing stop reason and open blocks cannot impersonate complete end_turn',async()=>{
 for(const wire of [
  start()+block('text',{text:'partial'}),
  start()+block('text',{text:'partial'})+stop()+frame('message_stop',{type:'message_stop'}),
  start()+block('text',{text:'partial'})+stop()+frame('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}}),
  start()+block('text',{text:'partial'})+finish(),
 ])await assert.rejects(parse(wire),invalid);
 const limited=await parse(start()+block('text',{text:'partial'})+stop()+finish('max_tokens'));assert.equal(limited.stopReason,'max_tokens');
});

test('event/type disagreement, out-of-order blocks and unsupported deltas fail without leaking provider diagnostics',async()=>{
 for(const wire of [
  frame('message_start',{type:'message_stop'}),
  block('text',{text:'before start'}),
  start()+block('text',{text:''})+delta('input_json_delta',{partial_json:'{}'})+stop()+finish(),
  start()+block('text',{text:''})+stop()+delta('text_delta',{text:'late'})+finish(),
  start()+block('text',{text:''})+block('text',{text:'duplicate index'})+stop()+finish(),
 ])await assert.rejects(parse(wire),invalid);
 const secret='SYNTHETIC_PROVIDER_DIAGNOSTIC_NEVER_RETURN';
 await assert.rejects(parse(frame('error',{type:'error',error:{type:'overloaded_error',message:secret}})),error=>{invalid(error);assert.doesNotMatch((error as Error).message,new RegExp(secret));return true});
});

test('pre-abort and abort during a stalled read reject promptly and cancel the owned reader',async()=>{
 const reason=new DOMException('Synthetic stop','AbortError'),already=new AbortController();already.abort(reason);
 await assert.rejects(readClaudeStream(response(textRound()),already.signal,()=>{}),error=>error===reason);
 let entered!:()=>void,cancelled=false;const waiting=new Promise<void>(resolve=>{entered=resolve});
 const controller=new AbortController(),body=new ReadableStream<Uint8Array>({pull(){entered();return new Promise<void>(()=>{})},cancel(){cancelled=true}});
 const pending=readClaudeStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),controller.signal,()=>{throw new Error('No progress expected')});await waiting;controller.abort(reason);await assert.rejects(pending,error=>error===reason);await Promise.resolve();assert.equal(cancelled,true);
});

test('initial content and delta paths enforce the same per-block byte ceilings',async()=>{
 for(const wire of [
  start()+block('text',{text:'x'.repeat(32769)})+stop()+finish(),
  start()+block('text',{text:''})+delta('text_delta',{text:'x'.repeat(32769)})+stop()+finish(),
  start()+block('thinking',{thinking:'x'.repeat(65537),signature:''})+stop()+finish(),
  start()+block('thinking',{thinking:'',signature:'x'.repeat(16385)})+stop()+finish(),
  start()+block('redacted_thinking',{data:'x'.repeat(65537)})+stop()+finish(),
  start()+block('tool_use',{id:'call_large',name:'mail_search',input:{query:'x'.repeat(16385)}})+stop()+finish('tool_use'),
 ])await assert.rejects(parse(wire),invalid);
});

test('a coalesced valid transport chunk is parsed before the unfinished-frame backlog limit is applied',async()=>{
 const wire=frame('ping',{type:'ping'}).repeat(4000)+textRound('One coalesced network chunk');assert.ok(Buffer.byteLength(wire)>128000);assert.ok(Buffer.byteLength(wire)<1000000);
 const result=await parse(wire);assert.equal(result.stopReason,'end_turn');assert.deepEqual(result.blocks,[{type:'text',text:'One coalesced network chunk'}]);
});

test('initial tool input and streamed replacement JSON cannot ambiguously select different arguments',async()=>{
 await assert.rejects(parse(start()+block('tool_use',{id:'call_ambiguous',name:'mail_search',input:{query:'original'}})+delta('input_json_delta',{partial_json:'{"query":"replacement"}'})+stop()+finish('tool_use')),invalid);
 const result=await parse(start()+block('tool_use',{id:'call_initial',name:'mail_search',input:{query:'complete initial input'}})+stop()+finish('tool_use'));assert.deepEqual(result.blocks,[{type:'tool_use',id:'call_initial',name:'mail_search',input:{query:'complete initial input'}}]);
});

test('the UTF-8 text allowance is shared across multiple blocks instead of resetting at each new block',async()=>{
 const first='é'.repeat(8192),second='é'.repeat(8192),exact=start()+block('text',{text:first})+stop()+block('text',{text:second},1)+stop(1);
 const complete=await parse(exact+finish());assert.equal(Buffer.byteLength(complete.blocks.filter(item=>item.type==='text').map(item=>item.text).join('')),32768);
 await assert.rejects(parse(exact+block('text',{text:'😀'},2)+stop(2)+finish()),invalid);
});

test('frame count, pending frame size and malformed UTF-8 are rejected without a successful result',async()=>{
 await assert.rejects(parse(':\n\n'.repeat(10001)+textRound()),invalid);
 await assert.rejects(parse('data: '+ 'x'.repeat(128001)),invalid);
 const malformed=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([0xc3,0x28]));controller.close()}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(readClaudeStream(malformed,new AbortController().signal,()=>{}));
});

test('future event names cannot complete a message while real thinking progress exposes no hidden reasoning',async()=>{
 const progress:ClaudeProgress[]=[];const wire=frame('future_event',{type:'future_event',data:'ignored'})+start()+block('thinking',{thinking:'SYNTHETIC_PRIVATE_REASONING',signature:'synthetic_signature'})+delta('thinking_delta',{thinking:'_MORE'})+stop()+block('text',{text:'Visible answer'},1)+stop(1)+finish();
 const result=await parse(wire,5,progress);assert.equal(result.stopReason,'end_turn');assert.deepEqual(progress.filter(item=>item.kind==='thinking'),[{kind:'thinking',state:'started'},{kind:'thinking',state:'finished'}]);assert.doesNotMatch(JSON.stringify(progress),/SYNTHETIC_PRIVATE_REASONING|synthetic_signature/);
 await assert.rejects(parse(frame('future_event',{type:'future_event',stop_reason:'end_turn'})),invalid);
});

test('usage counters preserve unknown values rather than coercing strings, negative or unsafe integers',async()=>{
 for(const value of ['7',-1,Number.MAX_SAFE_INTEGER+1,null]){
  const wire=frame('message_start',{type:'message_start',message:{id:'msg_usage',type:'message',role:'assistant',usage:{input_tokens:value}}})+block('text',{text:'Usage control'})+stop()+frame('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:value}})+frame('message_stop',{type:'message_stop'});
  const result=await parse(wire);assert.equal(result.inputTokens,null);assert.equal(result.outputTokens,null);
 }
});
