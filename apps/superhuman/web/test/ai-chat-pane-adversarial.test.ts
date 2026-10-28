import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { AiSourceTarget } from '../src/ai-chat.ts';
import type { AiChatSession,AiChatTurn,AiSourceReceipt } from '../../api/src/ai-chat-types.ts';
const compiled=new Map<string,string>();
for(const name of ['AiChatPane.tsx','AiDraftCard.tsx','AiMarkdown.tsx','Icon.tsx']){const path=fileURLToPath(new URL('../src/'+name,import.meta.url));compiled.set(pathToFileURL(path).href,(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code)}
const hook=registerHooks({load(url,context,next){if(url.endsWith('.css'))return{format:'module',shortCircuit:true,source:''};const source=compiled.get(url);return source===undefined?next(url,context):{format:'module',shortCircuit:true,source}}});after(()=>hook.deregister());
const {act,createElement}=await import('react'),{default:AiChatPane}=await import('../src/AiChatPane.tsx');
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}};
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const at='2026-10-28T12:00:00Z';
const session:AiChatSession={id:'session-a',accountId:'a',title:'Synthetic',createdAt:at,updatedAt:at,revision:2,turnCount:1,activeTurnId:null};
const source=(id:string,number:number):AiSourceReceipt=>({id,number,accountId:'a',sessionId:session.id,turnId:'turn-a',target:{kind:'mail',accountId:'a',threadId:'thread-'+id,messageIds:['message-'+id]},basis:'mail-text',label:'Synthetic '+id,secondaryLabel:'Sender',excerpt:'Synthetic fact',snapshotHash:id,fetchedAt:at,sourceUpdatedAt:at,truncated:false,partial:false});
const sources=[source('source-1',1),source('source-2',2)];
const turn:AiChatTurn={id:'turn-a',sessionId:session.id,accountId:'a',seq:1,clientRequestId:'synthetic-key',prompt:'Synthetic question',context:{resources:['mail']},state:'completed',phase:'finished',revision:3,lastEventSeq:1,createdAt:at,provider:'anthropic',model:'synthetic-model',providerRequestIds:[],dispatchCount:1,partial:{markdown:'Facts [cite:1] [cite:2]',thinkingSummary:null},answer:{markdown:'Facts [cite:1] [cite:2]',plainText:'Facts [1] [2]',citations:sources.map(item=>({number:item.number,sourceId:item.id})),sourceIds:sources.map(item=>item.id),finishReason:'end_turn',truncated:false},sources,usage:{inputTokens:1,outputTokens:1},limits:{providerRounds:1,toolCalls:0,summaryHits:0,fullThreadReads:0,contextBytes:1,outputTokens:1,exhausted:[]},coverage:[],error:null,cancellation:{requestedAt:null,localStoppedAt:null,providerOutcome:'response_observed'}};
async function mount(holdSecond=false){
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://127.0.0.1:5173'});
 for(const key of ['window','document','navigator','Node','HTMLElement','Element','Event'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key as keyof typeof dom.window]});Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const originalFetch=globalThis.fetch,second=deferred<Response>(),navigation=deferred<boolean>(),calls:{target:AiSourceTarget;current:()=>boolean}[]=[],requests:{method:string;path:string}[]=[];let closed=0;
 const fresh:AiChatSession={...session,id:'session-new',title:'New conversation',revision:0,turnCount:0};
 globalThis.fetch=async(input,init)=>{const url=new URL(String(input),'http://127.0.0.1:5173'),method=init?.method??'GET';requests.push({method,path:url.pathname});if(url.pathname==='/api/ai/chat/status')return response({status:{implemented:true,configured:true,provider:'anthropic',model:'synthetic-model',missing:[],capabilities:[],policyVersion:'synthetic',coverage:[],limitations:[]}});if(url.pathname==='/api/ai/chat/sessions')return response(method==='POST'?{session:fresh}:{sessions:[session],nextCursor:null,hasMore:false});if(url.pathname==='/api/ai/chat/sessions/'+session.id)return response({session,turns:[turn],nextBeforeSeq:null,hasMore:false});if(url.pathname==='/api/ai/chat/sessions/'+fresh.id)return response({session:fresh,turns:[],nextBeforeSeq:null,hasMore:false});for(const item of sources)if(url.pathname==='/api/ai/chat/sources/'+item.id){if(item.number===2&&holdSecond)return second.promise;return response({source:item,resolution:{availability:'available',target:item.target}})}throw new Error('Unexpected synthetic route: '+url.pathname)};
 const {createRoot}=await import('react-dom/client'),host=dom.window.document.querySelector('#root')!,root=createRoot(host);let unmounted=false;
 await act(async()=>root.render(createElement(AiChatPane,{accountId:'a',accountName:'Synthetic',visible:true,onClose:()=>{closed++},onOpenSource:(target,current)=>{calls.push({target,current});return navigation.promise}})));
 const expand=host.querySelector<HTMLButtonElement>('.ai-chat-answer-actions button[aria-expanded]');assert.ok(expand);await act(async()=>expand.click());
 const click=async(index:number)=>{const row=host.querySelectorAll<HTMLButtonElement>('.ai-chat-source button')[index];assert.ok(row);await act(async()=>row.click())};
 return{host,dom,calls,requests,closed:()=>closed,second,click,unmount:async()=>{if(!unmounted){await act(async()=>root.unmount());unmounted=true}},close:async()=>{navigation.resolve(false);second.resolve(response({source:sources[1],resolution:{availability:'available',target:sources[1].target}}));await act(async()=>{await Promise.resolve()});if(!unmounted)await act(async()=>root.unmount());globalThis.fetch=originalFetch;dom.window.close()}};
}

test('an already-resolved source navigation loses authority immediately when its pane unmounts',async()=>{
 const f=await mount();try{await f.click(0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].current(),true);await f.unmount();assert.equal(f.calls[0].current(),false,'A delayed App save may not use an unmounted source-navigation intent')}finally{await f.close()}
});

test('a newer same-session source click fences an older navigation before the newer resolver returns',async()=>{
 const f=await mount(true);try{await f.click(0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].current(),true);await f.click(1);assert.equal(f.calls.length,1,'The newer resolver is intentionally still pending');assert.equal(f.calls[0].current(),false,'The first navigation must stop while the newer source intent resolves')}finally{await f.close()}
});

test('opening history cancels delayed source navigation; Escape restores the same answer without a paid request',async()=>{
 const f=await mount(true);try{
  await f.click(1);assert.equal(f.calls.length,0);
  const history=f.host.querySelector<HTMLButtonElement>('[aria-label="AI conversation history"]')!;
  await act(async()=>history.click());assert.equal(history.getAttribute('aria-expanded'),'true');assert.ok(f.host.querySelector('.ai-chat-history-row[data-session-id="session-a"]'));assert.equal(f.host.querySelector('.ai-chat-transcript'),null);
  f.second.resolve(response({source:sources[1],resolution:{availability:'available',target:sources[1].target}}));await act(async()=>{await Promise.resolve()});assert.equal(f.calls.length,0,'A resolver hidden behind History may not navigate');
  await act(async()=>history.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(f.closed(),0);assert.equal(f.host.querySelector('.ai-chat-history'),null);assert.match(f.host.querySelector('.ai-chat-transcript')?.textContent??'',/Synthetic question/);assert.match(f.host.querySelector('.ai-chat-complete')?.textContent??'',/Done thinking/);assert.equal(f.dom.window.document.activeElement,f.host.querySelector('textarea'));
  await act(async()=>f.host.querySelector('textarea')!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(f.closed(),1);assert.equal(f.requests.filter(request=>request.method==='POST').length,0,'History and Escape are read-only');
 }finally{await f.close()}
});

test('a resolved navigation never regains authority after history closes; new conversation is empty without sending',async()=>{
 const f=await mount();try{
  await f.click(0);assert.equal(f.calls[0].current(),true);const history=f.host.querySelector<HTMLButtonElement>('[aria-label="AI conversation history"]')!;await act(async()=>history.click());assert.equal(f.calls[0].current(),false);await act(async()=>history.click());assert.equal(f.calls[0].current(),false,'Closing History cannot revive the older click');
  await act(async()=>f.host.querySelector<HTMLButtonElement>('[aria-label="New AI conversation"]')!.click());assert.equal(f.host.querySelector('.ai-chat-turn'),null);assert.equal(f.host.querySelector<HTMLTextAreaElement>('textarea')?.value,'');assert.equal(f.dom.window.document.activeElement,f.host.querySelector('textarea'));assert.deepEqual(f.requests.filter(request=>request.method==='POST'),[{method:'POST',path:'/api/ai/chat/sessions'}]);assert.ok(f.host.querySelector('button[aria-label="Send message"]'));
  await act(async()=>history.click());assert.ok(f.host.querySelector('.ai-chat-history-row[data-session-id="session-a"]'));assert.ok(f.host.querySelector('.ai-chat-history-row[data-session-id="session-new"]'));await act(async()=>f.host.querySelector<HTMLButtonElement>('.ai-chat-history-row[data-session-id="session-a"]')!.click());assert.match(f.host.querySelector('.ai-chat-transcript')?.textContent??'',/Synthetic question/);assert.equal(f.requests.filter(request=>request.method==='POST').length,1,'Restore history must not generate a new answer');
 }finally{await f.close()}
});
