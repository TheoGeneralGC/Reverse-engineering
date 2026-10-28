import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { aiCitationMap,safeAiHref } from '../src/ai-markdown.ts';
const path=fileURLToPath(new URL('../src/AiMarkdown.tsx',import.meta.url));
const compiled=(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code;
const hook=registerHooks({load(url,context,next){return url===pathToFileURL(path).href?{format:'module',shortCircuit:true,source:compiled}:next(url,context)}});
const {default:AiMarkdown}=await import('../src/AiMarkdown.tsx');hook.deregister();
const receipts=[{id:'owned-source',label:1}],render=(text:string)=>JSDOM.fragment(renderToStaticMarkup(createElement(AiMarkdown,{text,citations:receipts,onCitation:()=>{}})));

test('reference links, autolinks, code and escaped/Unicode lookalikes cannot smuggle interactive source markers',()=>{
 const text='[link][cite:1]\n\n[cite:1]: https://example.test/reference\n\n<cite:1> <https://example.test/[cite:1]>\n\n```html\n<strong>[cite:1]</strong>\n```\n\n    [cite:1]\n\n`[cite:1]` \\[cite:1] [cite&#58;1] [cite:01] [cite:１] [cite：1]';
 const fragment=render(text);assert.equal(fragment.querySelector('button'),null);assert.ok(fragment.querySelectorAll('a').length>=1);assert.equal(fragment.querySelector('a button'),null);assert.equal(fragment.querySelectorAll('pre').length,2);assert.match(fragment.textContent||'',/\[cite:１\]/);
});

test('rejected link destinations do not turn their nested labels into independent source actions',()=>{
 for(const text of ['[Link [cite:1]](javascript:alert(1))','[Link [cite:1]](/api/drafts)','[Link [cite:1]](data:text/html,test)'])assert.equal(render(text).querySelector('button'),null);
});

test('citation-looking text within raw HTML tags, attributes, comments and script literals stays inert',()=>{
 for(const text of ['<span title="[cite:1]">literal</span>','<!-- [cite:1] -->','<script>const source="[cite:1]";</script>','<button onclick="alert(1)">[cite:1]</button>','Prefix <span title="[cite:1]">[cite:1]</span> suffix','Prefix <!-- [cite:1] --> suffix']){
  const fragment=render(text);assert.equal(fragment.querySelector('button'),null,'Raw HTML literals are not citation prose');assert.equal(fragment.querySelector('script,span[title],button[onclick]'),null);assert.match(fragment.textContent||'',/\[cite:1\]/);
 }
});

test('nested ordinary emphasis/list prose uses only the exact validated source map and never copies model attributes',()=>{
 const fragment=render('- **Evidence [cite:1]**\n  - *Another [cite:1]*\n\n[external](https://example.test "onclick=alert(1) data-ai-source=forged")');
 assert.equal(fragment.querySelectorAll('button.ai-citation').length,2);assert.equal(fragment.querySelector('strong button')?.getAttribute('data-ai-source'),'owned-source');assert.equal(fragment.querySelector('em button')?.getAttribute('data-ai-source'),'owned-source');
 for(const node of fragment.querySelectorAll('*'))for(const attribute of node.attributes)assert.ok(!/^on/i.test(attribute.name));assert.equal(fragment.querySelector('a')?.getAttribute('data-ai-source'),null);
 assert.deepEqual([...aiCitationMap([{id:'same',label:1},{id:'same',label:2},{id:'different',label:2}])],[]);
});

test('absolute loopback application links remain blocked just like relative application paths',()=>{
 for(const link of ['http://127.0.0.1:3001/api/auth/google/start?service=calendar','http://localhost:5173/','http://[::1]:3001/api/bootstrap','http://2130706433:3001/api/bootstrap','http://127.1:3001/api/bootstrap'])assert.equal(safeAiHref(link),null);
 assert.ok(safeAiHref('https://example.test/docs'));assert.ok(safeAiHref('mailto:person@example.test'));
});

test('same-array receipt mutation followed by rerender cannot retain a prior source callback binding',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
 for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key as keyof typeof dom.window]});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const {act}=await import('react'),{createRoot}=await import('react-dom/client');
 const host=dom.window.document.querySelector('#root')!,root=createRoot(host),calls:string[]=[],citations=[{id:'source-a',label:1}];
 const draw=()=>root.render(createElement(AiMarkdown,{text:'Fact [cite:1]',citations,onCitation:id=>calls.push(id)}));
 try{
  await act(async()=>draw());await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());assert.deepEqual(calls,['source-a']);
  citations[0].id='source-b';await act(async()=>draw());assert.equal(host.querySelector('button')?.getAttribute('data-ai-source'),'source-b');await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());assert.deepEqual(calls,['source-a','source-b']);
  citations.length=0;await act(async()=>draw());assert.equal(host.querySelector('button'),null);assert.match(host.textContent||'',/\[cite:1\]/);
 }finally{await act(async()=>root.unmount());dom.window.close()}
});
