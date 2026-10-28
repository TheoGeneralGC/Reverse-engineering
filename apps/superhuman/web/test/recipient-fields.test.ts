import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { RecipientFieldsHandle,RecipientSuggestions } from '../src/RecipientFields.tsx';
import type { RecipientField,RecipientHeaders } from '../src/recipient-model.ts';
import type { ContactIdentity,ContactSource } from '../src/contact-context.ts';
const compiled=new Map<string,string>();for(const name of ['RecipientFields.tsx','Icon.tsx']){const path=fileURLToPath(new URL('../src/'+name,import.meta.url));compiled.set(pathToFileURL(path).href,(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code)}
const hook=registerHooks({load(url,context,next){const source=compiled.get(url);return source===undefined?next(url,context):{format:'module',shortCircuit:true,source}}});after(()=>hook.deregister());
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5173'}),window=dom.window;
for(const name of ['window','document','navigator','Node','HTMLElement','HTMLInputElement','Event','KeyboardEvent','MouseEvent'])Object.defineProperty(globalThis,name,{configurable:true,value:window[name as keyof typeof window]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const {act,createElement,createRef}=await import('react'),{createRoot}=await import('react-dom/client'),{default:RecipientFields}=await import('../src/RecipientFields.tsx');
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return{promise,resolve}};
const result=(name:string,email:string):RecipientSuggestions=>({contacts:[{name,email}],source:'local-message-participants',limited:true});
async function mount(initial:Partial<RecipientHeaders>={},request:(account:string,q:string,signal:AbortSignal)=>Promise<RecipientSuggestions>=async()=>({...result('',''),contacts:[]})){
 const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host),ref=createRef<RecipientFieldsHandle>(),writes:RecipientHeaders[]=[],requests:{account:string;q:string;signal:AbortSignal}[]=[];let escaped=0;const intents:{accountId:string;draftId:string;contact:ContactIdentity;source:ContactSource}[]=[];
 let props={to:'',cc:'',bcc:'',...initial,draftId:'synthetic-draft',accountId:'account-one',readOnly:false};
 const outside=window.document.createElement('button');window.document.body.append(outside);
 const render=()=>root.render(createElement(RecipientFields,{...props,ref,author:{name:'Demo Author',email:'author@example.test'},onContactIntent:intent=>intents.push(intent),onChange:value=>writes.push(value),onEscapeCommit:()=>{escaped++;outside.focus()},request:async(account,q,signal)=>{requests.push({account,q,signal});return request(account,q,signal)}}));await act(async()=>render());await act(async()=>ref.current!.focus('to'));
 const input=(field:RecipientField='to')=>host.querySelector<HTMLInputElement>(`input[aria-label="${{to:'To',cc:'Cc',bcc:'Bcc'}[field]}"]`);
 const region=(field:RecipientField='to')=>host.querySelector<HTMLDivElement>(`[role="group"][aria-label="${{to:'To',cc:'Cc',bcc:'Bcc'}[field]} recipients"]`)!;
 const fill=async(text:string,field:RecipientField='to')=>{const node=input(field);assert.ok(node,'Missing '+field+' input');await act(async()=>{node.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(node,text);node.dispatchEvent(new window.Event('input',{bubbles:true}))});return node};
 const key=async(value:string,options:KeyboardEventInit={},field:RecipientField='to')=>{const event=new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options});await act(async()=>{(input(field)||region(field)).dispatchEvent(event)});return event};
 const click=async(name:string,double=false)=>{const button=host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);assert.ok(button,'Missing '+name);await act(async()=>{if(double)button.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));else button.click()})};
 return{host,ref,writes,requests,intents,input,region,fill,key,click,outside,escaped:()=>escaped,wait:()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,140))}),update:async(patch:Partial<typeof props>)=>{props={...props,...patch};await act(async()=>render())},close:async()=>{await act(async()=>root.unmount());host.remove();outside.remove()}};
}

test('actual fields commit physical Enter/comma/semicolon, guard name-only punctuation and preserve Escape stages',async()=>{
 const app=await mount();let escapedEvents=0;const outer=(event:Event)=>{if((event as KeyboardEvent).key==='Escape'&&!event.defaultPrevented)escapedEvents++};window.addEventListener('keydown',outer);try{
  for(const [email,key]of[['one@example.test','Enter'],['two@example.test',','],['three@example.test',';']]){await app.fill(email);assert.equal((await app.key(key)).defaultPrevented,true)}assert.equal(app.host.querySelectorAll('.recipient-chip').length,3);await app.key('Backspace');assert.equal(app.host.querySelectorAll('.recipient-chip').length,2);assert.ok(app.input());assert.equal(window.document.activeElement,app.input());await app.fill('name-only');assert.equal((await app.key(',')).defaultPrevented,false);await app.fill('name-only,');await app.key('Escape');assert.equal(app.escaped(),1);assert.equal(escapedEvents,0);assert.ok(app.host.querySelector('.recipient-chip.is-invalid'));assert.equal(window.document.activeElement,app.outside);await act(async()=>app.outside.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(escapedEvents,1);assert.match(app.ref.current!.getValue().to,/name-only,/);
 }finally{window.removeEventListener('keydown',outer);await app.close()}
});

test('existing edit replacement stays selected without an input; double-click edits and empty Backspace removes that chip',async()=>{
 const app=await mount({to:'one@example.test, two@example.test'});try{
  await app.click('Recipient one@example.test');await app.key('Enter');assert.equal(app.input()?.value,'one@example.test');await app.fill('new@example.test');await app.key('Enter');assert.equal(app.input(),null);assert.equal(app.host.querySelector('.recipient-chip.is-selected>button:first-child')?.textContent,'new@example.test');assert.equal(window.document.activeElement,app.region());
  await app.click('Recipient new@example.test',true);await app.fill('');await app.key('Backspace');assert.equal(app.ref.current!.getValue().to,'two@example.test');
 }finally{await app.close()}
});

test('Cc/Bcc auto-reveal and no-suggestion Tab blurs into Cc while preserving the To text',async()=>{
 const app=await mount({cc:'cc@example.test',bcc:'bcc@example.test'});try{assert.ok(app.input('cc'));assert.ok(app.input('bcc'));await app.fill('one@example.test');assert.equal((await app.key('Tab')).defaultPrevented,false);await act(async()=>app.input('cc')!.focus());assert.equal(app.ref.current!.getValue().to,'one@example.test');assert.equal(app.input()!.value,'');assert.equal(window.document.activeElement,app.input('cc'));}finally{await app.close()}
});

test('observed Escape commits the literal query instead of highlighted suggestion; suggested Tab accepts and retains field focus',async()=>{
 const app=await mount({},async()=>result('REA, Person','person@example.test'));try{
  await app.fill('person');await app.wait();assert.equal(app.host.querySelectorAll('[role="option"]').length,1);await app.key('Escape');assert.equal(app.host.querySelector('[role="listbox"]'),null);assert.equal(app.ref.current!.getValue().to,'person');assert.equal(app.escaped(),1);assert.ok(app.host.querySelector('.recipient-chip.is-invalid'));await app.click('Remove recipient person');await app.fill('pers');await app.wait();assert.equal((await app.key('Tab')).defaultPrevented,true);assert.equal(app.ref.current!.getValue().to,'"REA, Person" <person@example.test>');assert.equal(app.host.querySelector('.recipient-chip>button:first-child')?.textContent,'Person REA');assert.equal(window.document.activeElement,app.input());
 }finally{await app.close()}
});

test('newer query wins and account/context changes abort old suggestions instead of exposing them',async()=>{
 const first=deferred<RecipientSuggestions>(),second=deferred<RecipientSuggestions>();const app=await mount({},async(_account,q)=>q==='first'?first.promise:second.promise);try{
  await app.fill('first');await app.wait();await app.fill('second');await app.wait();assert.equal(app.requests[0].signal.aborted,true);await act(async()=>first.resolve(result('Private old person','old@example.test')));assert.doesNotMatch(app.host.textContent||'',/Private old person/);await act(async()=>second.resolve(result('Current person','current@example.test')));assert.match(app.host.textContent||'',/Current person/);
  await app.update({accountId:'account-two'});assert.equal(app.requests[1].signal.aborted,true);assert.doesNotMatch(app.host.textContent||'',/Current person/);
 }finally{await app.close()}
});

test('read-only transition aborts suggestions and blocks queued chip/input mutations while retaining pending edits',async()=>{
 const pending=deferred<RecipientSuggestions>();const app=await mount({to:'one@example.test'},async()=>pending.promise);try{
  await app.fill('unfinished');await app.wait();const before=app.ref.current!.getValue();await app.update({readOnly:true});assert.equal(app.requests[0].signal.aborted,true);await act(async()=>pending.resolve(result('Late','late@example.test')));assert.equal(app.host.querySelector('[role="listbox"]'),null);await app.fill('changed');await app.key('Enter');await app.click('Remove recipient one@example.test');assert.deepEqual(app.ref.current!.getValue(),before);assert.equal(app.input()!.readOnly,true);
 }finally{await app.close()}
});

test('caret-in-middle arrows stay text navigation, boundaries select chips, and IME punctuation never commits early',async()=>{
 const app=await mount({to:'one@example.test'});try{
  const input=await app.fill('text');await act(async()=>input.setSelectionRange(2,2));assert.equal((await app.key('ArrowLeft')).defaultPrevented,false);await act(async()=>input.setSelectionRange(0,0));assert.equal((await app.key('ArrowLeft')).defaultPrevented,true);assert.equal(app.input(),null);await app.key('ArrowRight');await app.key('ArrowRight');await app.fill('new@example.test');assert.equal((await app.key(',',{isComposing:true})).defaultPrevented,false);assert.equal(app.host.querySelectorAll('.recipient-chip').length,2);
 }finally{await app.close()}
});

test('synthetic paste/cut preserve quoted names and selected recipient history without using the system clipboard',async()=>{
 const app=await mount();try{
  const paste=new window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:()=> '"REA, One" <one@example.test>; two@example.test'}});await act(async()=>app.input()!.dispatchEvent(paste));assert.equal(app.ref.current!.getValue().to,'"REA, One" <one@example.test>, two@example.test');await app.key('a',{metaKey:true});let copied='';const cut=new window.Event('cut',{bubbles:true,cancelable:true});Object.defineProperty(cut,'clipboardData',{value:{setData:(_kind:string,value:string)=>copied=value}});await act(async()=>app.region().dispatchEvent(cut));assert.equal(copied,'"REA, One" <one@example.test>, two@example.test');assert.equal(app.ref.current!.getValue().to,'');await app.key('z',{metaKey:true});assert.equal(app.ref.current!.getValue().to,copied);
 }finally{await app.close()}
});


test('contact intents follow explicit suggestion navigation and recipient commits, never raw typing or initial highlight',async()=>{
 const app=await mount({},async()=>({contacts:[{name:'One',email:'one@example.test'},{name:'Two',email:'two@example.test'}],source:'local-message-participants',limited:true}));try{
  await app.fill('query');await app.wait();assert.equal(app.intents.length,0);
  await app.key('ArrowDown');assert.equal(app.intents.at(-1)?.contact.email,'two@example.test');assert.equal(app.intents.at(-1)?.source,'suggestion');
  const option=app.host.querySelector('[role="option"]')!;await act(async()=>option.dispatchEvent(new window.MouseEvent('mousemove',{bubbles:true})));assert.equal(app.intents.at(-1)?.contact.email,'one@example.test');
  const count=app.intents.length;await app.fill('new-query');await app.wait();assert.equal(app.intents.length,count);await app.key('Escape');assert.equal(app.intents.length,count,'name-only invalid commit retains contact');
  await app.click('Remove recipient new-query');await app.fill('unfinished@');await app.key('Escape');assert.equal(app.intents.at(-1)?.contact.email,'unfinished@');assert.equal(app.intents.at(-1)?.source,'commit');
  assert.equal(app.intents.at(-1)?.accountId,'account-one');assert.equal(app.intents.at(-1)?.draftId,'synthetic-draft');
 }finally{await app.close()}
});

test('chip selection changes context while selected deletion retains; empty-append Backspace shows previous or author without selecting a chip',async()=>{
 const app=await mount({to:'one@example.test, two@example.test'});try{
  await app.click('Recipient one@example.test');assert.equal(app.intents.at(-1)?.contact.email,'one@example.test');const count=app.intents.length;
  await app.key('Delete');assert.equal(app.intents.length,count);await app.click('Recipient two@example.test');await app.key('ArrowRight');await app.key('Backspace');assert.equal(app.intents.at(-1)?.contact.email,'author@example.test');assert.equal(app.intents.at(-1)?.source,'backspace');
 }finally{await app.close()}
});

test('observed invalid-chip selection uses author, selected-key deletion picks a neighbor, final selected deletion retains',async()=>{
 const app=await mount({to:'one@example.test, invalid-name'});try{
  await app.click('Recipient invalid-name, invalid');assert.equal(app.intents.at(-1)?.contact.email,'author@example.test');await app.key('Delete');assert.equal(app.intents.at(-1)?.contact.email,'one@example.test');const count=app.intents.length;await app.key('Delete');assert.equal(app.host.querySelectorAll('.recipient-chip').length,0);assert.equal(app.intents.length,count);
 }finally{await app.close()}
});
