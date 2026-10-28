import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { RecipientFieldsHandle } from '../src/RecipientFields.tsx';
import type { ContactIdentity,ContactSource } from '../src/contact-context.ts';

const compiled=new Map<string,string>();
for(const name of ['RecipientFields.tsx','Icon.tsx']){
 const path=fileURLToPath(new URL('../src/'+name,import.meta.url));
 compiled.set(pathToFileURL(path).href,(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code);
}
const hook=registerHooks({load(url,context,next){const source=compiled.get(url);return source===undefined?next(url,context):{format:'module',shortCircuit:true,source}}});
after(()=>hook.deregister());
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5173'}),window=dom.window;
for(const name of ['window','document','navigator','Node','HTMLElement','HTMLInputElement','Event','KeyboardEvent'])Object.defineProperty(globalThis,name,{configurable:true,value:window[name as keyof typeof window]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const {act,createElement,createRef}=await import('react'),{createRoot}=await import('react-dom/client'),{default:RecipientFields}=await import('../src/RecipientFields.tsx');

test('two empty-append Backspaces retain the focused combobox and publish previous then author, independently of selected Delete',async()=>{
 const host=window.document.createElement('div');window.document.body.append(host);
 const root=createRoot(host),ref=createRef<RecipientFieldsHandle>();
 const intents:{contact:ContactIdentity;source:ContactSource}[]=[];
 await act(async()=>root.render(createElement(RecipientFields,{
  ref,draftId:'synthetic-backspace-draft',accountId:'synthetic-account',
  to:'one@example.test, two@example.test',cc:'',bcc:'',readOnly:false,
  author:{name:'Synthetic Author',email:'author@example.test'},onChange:()=>{},
  onContactIntent:intent=>intents.push(intent),
  request:async()=>{throw new Error('Empty-input removal must not request suggestions')},
 })));
 const input=()=>{const node=host.querySelector<HTMLInputElement>('input[role="combobox"][aria-label="To"]');assert.ok(node,'The append combobox must remain mounted');return node};
 const focusedAppend=()=>{const node=input();assert.equal(node.value,'');assert.equal(window.document.activeElement,node,'Empty-input removal keeps keyboard focus on the append combobox');assert.equal(host.querySelector('.recipient-chip.is-selected'),null,'Empty-input removal must not enter selected-chip mode');return node};
 const key=async(node:Element,value:string,options:KeyboardEventInit={})=>{const event=new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options});await act(async()=>node.dispatchEvent(event));assert.equal(event.defaultPrevented,true);};
 try{
  await act(async()=>ref.current!.focus('to'));
  await key(focusedAppend(),'Backspace');
  assert.equal(ref.current!.getValue().to,'one@example.test');focusedAppend();
  assert.equal(intents.at(-1)?.contact.email,'one@example.test');assert.equal(intents.at(-1)?.source,'backspace');
  // Resolve the second event from the combobox itself. A group fallback would
  // accidentally exercise selected-delete semantics and conceal this regression.
  await key(input(),'Backspace');
  assert.equal(ref.current!.getValue().to,'');focusedAppend();
  assert.equal(intents.at(-1)?.contact.email,'author@example.test');assert.equal(intents.at(-1)?.source,'backspace');
  await key(input(),'z',{metaKey:true});assert.equal(ref.current!.getValue().to,'one@example.test');focusedAppend();
  await key(input(),'z',{metaKey:true});assert.equal(ref.current!.getValue().to,'one@example.test, two@example.test');focusedAppend();
  await key(input(),'z',{metaKey:true,shiftKey:true});assert.equal(ref.current!.getValue().to,'one@example.test');focusedAppend();
  await key(input(),'z',{metaKey:true,shiftKey:true});assert.equal(ref.current!.getValue().to,'');focusedAppend();

  await key(input(),'z',{metaKey:true});
  const chip=host.querySelector<HTMLButtonElement>('button[aria-label="Recipient one@example.test"]');assert.ok(chip);
  await act(async()=>chip.click());assert.equal(host.querySelector('input[aria-label="To"]'),null);
  const group=host.querySelector<HTMLElement>('[role="group"][aria-label="To recipients"]');assert.ok(group);assert.equal(window.document.activeElement,group);
  const count=intents.length;await key(group,'Delete');assert.equal(ref.current!.getValue().to,'');focusedAppend();
  assert.equal(intents.length,count,'Deleting the final selected chip retains its contact instead of emitting the append-author fallback');
 }finally{await act(async()=>root.unmount());host.remove()}
});
