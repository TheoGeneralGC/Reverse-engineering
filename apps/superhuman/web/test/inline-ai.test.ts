import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { ComposerRewriteRequest } from '../src/composer-ai.ts';
import type { RichComposerHandle } from '../src/RichComposer.tsx';

const compiled=new Map<string,string>();
for(const name of ['RichComposer.tsx','Icon.tsx']){const path=fileURLToPath(new URL('../src/'+name,import.meta.url));compiled.set(pathToFileURL(path).href,(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code)}
const hook=registerHooks({load(url,context,next){const source=compiled.get(url);return source===undefined?next(url,context):{format:'module',shortCircuit:true,source}}});
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5173'}),window=dom.window;
for(const key of ['window','document','navigator','Node','DocumentFragment','CharacterData','Event','CustomEvent','HTMLOListElement','Text','Element','HTMLElement','Range','Selection','MutationObserver','NodeFilter','DOMParser','HTMLAnchorElement','HTMLBRElement','HTMLDivElement','HTMLSpanElement','HTMLLIElement','HTMLInputElement','HTMLImageElement','KeyboardEvent','InputEvent','DOMRect','getComputedStyle'])Object.defineProperty(globalThis,key,{configurable:true,value:window[key as keyof typeof window]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});window.Range.prototype.getBoundingClientRect=()=>new window.DOMRect();window.Range.prototype.getClientRects=()=>Object.assign([],{item:()=>null}) as unknown as DOMRectList;
const {act,createElement,createRef}=await import('react'),{createRoot}=await import('react-dom/client'),{default:RichComposer}=await import('../src/RichComposer.tsx');hook.deregister();
const deferred=()=>{let resolve!:(value:string)=>void,reject!:(error:Error)=>void;return{promise:new Promise<string>((yes,no)=>{resolve=yes;reject=no}),resolve:(value:string)=>resolve(value),reject:(error:Error)=>reject(error)}};
async function mount(generateAI:(request:ComposerRewriteRequest,signal:AbortSignal)=>Promise<string>){
 const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host),ref=createRef<RichComposerHandle>();let value={body:'Before target text after',html:'<div><b>Before </b>target text<i> after</i></div>'},readOnly=false,accountId='synthetic-account';
 const render=()=>root.render(createElement(RichComposer,{ref,accountId,draftId:'owned-synthetic-ai-draft',...value,readOnly,generateAI,onChange:next=>{value=next;render()}}));await act(async()=>render());
 const body=()=>host.querySelector<HTMLElement>('[aria-label="Message body"]')!;
 const selectTarget=async()=>{await act(async()=>{body().focus();const range=window.document.createRange();range.selectNodeContents(body().querySelector('div')!.childNodes[1]);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);window.document.dispatchEvent(new window.Event('selectionchange'))})};
 const click=async(name:string)=>{const button=Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.trim()===name||button.getAttribute('aria-label')===name);assert.ok(button,'Missing '+name);await act(async()=>button.click())};
 return{host,body,ref,setAccount:async(nextAccount:string,nextBody:string)=>{accountId=nextAccount;value={body:nextBody,html:'<div>'+nextBody+'</div>'};await act(async()=>render())},getValue:()=>value,selectTarget,click,open:async()=>{await selectTarget();await act(async()=>ref.current!.openAI())},lock:async()=>{readOnly=true;await act(async()=>render())},close:async()=>{await act(async()=>root.unmount());host.remove()}};
}

test('inline AI sends only the selection, applies it directly and offers Done and explicit Retry',async()=>{
 const calls:ComposerRewriteRequest[]=[];const app=await mount(async request=>{calls.push(request);return calls.length===1?'Short text':'Retried text'});try{
  await app.open();assert.ok(app.host.querySelector('[aria-label="Describe how to edit the text"]'));await app.click('Shorten');
  assert.deepEqual(calls,[{accountId:'synthetic-account',instruction:'Shorten',text:'target text'}]);assert.equal(app.getValue().body,'Before Short text after');assert.match(app.getValue().html,/<b>Before /);assert.match(app.getValue().html,/<i> after<\/i>/);
  await app.click('Retry');assert.deepEqual(calls[1],calls[0]);assert.equal(app.getValue().body,'Before Retried text after');await app.click('Done');assert.equal(app.host.querySelector('[aria-label="Edit with AI"]'),null);
 }finally{await app.close()}
});

test('closing an in-flight AI edit aborts its request and a late result cannot change the draft',async()=>{
 const pending=deferred();let signal:AbortSignal|undefined,calls=0;const app=await mount(async(_request,abort)=>{calls++;signal=abort;return pending.promise});try{
  await app.open();await app.click('Shorten');assert.equal(calls,1);assert.equal(app.host.querySelector('[aria-label="Edit with AI"]')?.getAttribute('aria-busy'),'true');await app.click('Close AI editor');assert.equal(signal?.aborted,true);
  await act(async()=>pending.resolve('Late discarded result'));assert.equal(app.getValue().body,'Before target text after');assert.equal(app.host.querySelector('[aria-label="Edit with AI"]'),null);
 }finally{await app.close()}
});

test('provider errors preserve text and a user edit during a request blocks stale replacement',async()=>{
 const pending=deferred();let calls=0;const app=await mount(async()=>{calls++;if(calls===1)throw new Error('Configure OPENAI_API_KEY and OPENAI_MODEL to enable AI');return pending.promise});try{
  await app.open();await app.click('Shorten');assert.match(app.host.querySelector('[role="alert"]')!.textContent!,/Configure OPENAI/);assert.equal(app.getValue().body,'Before target text after');assert.equal(calls,1);
  await app.click('Shorten');await act(async()=>{app.body().textContent='My latest edit';app.body().dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText'}))});await act(async()=>pending.resolve('Stale AI result'));
  assert.match(app.host.querySelector('[role="alert"]')!.textContent!,/draft changed/);assert.equal(app.getValue().body,'My latest edit');assert.equal(calls,2);
 }finally{await app.close()}
});

test('delivery becoming read-only aborts AI and keeps a late output from entering a locked draft',async()=>{
 const pending=deferred();let signal:AbortSignal|undefined;const app=await mount(async(_request,abort)=>{signal=abort;return pending.promise});try{
  await app.open();await app.click('Improve writing');await app.lock();assert.equal(signal?.aborted,true);await act(async()=>pending.resolve('Too late'));assert.equal(app.getValue().body,'Before target text after');assert.equal(app.host.querySelector('[aria-label="Edit with AI"]'),null);
 }finally{await app.close()}
});

test('an in-place account change aborts its rewrite even when the draft ID is reused',async()=>{
 const pending=deferred();let signal:AbortSignal|undefined;const requests:ComposerRewriteRequest[]=[];const app=await mount(async(request,abort)=>{requests.push(request);signal=abort;return pending.promise});try{await app.open();await app.click('Shorten');assert.equal(requests[0].accountId,'synthetic-account');await app.setAccount('other-account','Other account text');assert.equal(signal?.aborted,true);assert.equal(app.host.querySelector('[aria-label="Edit with AI"]'),null);await act(async()=>pending.resolve('Foreign delayed replacement'));assert.equal(app.getValue().body,'Other account text');assert.equal(app.host.textContent?.includes('Foreign delayed replacement'),false)}finally{await app.close()}
});

test('the rewrite adapter requires an explicit account and never infers the active account',async()=>{
 const {requestComposerRewrite}=await import('../src/composer-ai.ts'),original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({text:'Unexpected'}))};try{for(const accountId of[undefined,'',' ','bad\naccount'])await assert.rejects(()=>requestComposerRewrite({accountId:accountId as string,instruction:'Shorten',text:'Synthetic'},new AbortController().signal),/Select an account/);assert.equal(calls,0)}finally{globalThis.fetch=original}
});
