import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import {transformWithOxc} from 'vite';
import {JSDOM} from 'jsdom';
import {SplitInboxModel} from '../src/split-inbox-model.ts';
import {configuration,definition,views,accepted,memoryStorage,deferred} from './split-inbox-fixtures.ts';
import type {SplitSaveRequest,SplitSaveResponse} from '../src/split-inbox-client.ts';
const path=fileURLToPath(new URL('../src/SplitInboxWorkspace.tsx',import.meta.url));
const compiled=(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code;
const hook=registerHooks({load(url,context,next){if(url.endsWith('.css'))return{format:'module',shortCircuit:true,source:''};if(url===pathToFileURL(path).href)return{format:'module',shortCircuit:true,source:compiled};return next(url,context)}});
after(()=>hook.deregister());
const dom=new JSDOM('<!doctype html><html><body><textarea id="mail">Untouched Mail</textarea></body></html>',{url:'http://127.0.0.1:5173'});
for(const k of ['window','document','navigator','Node','HTMLElement','Element','Event','KeyboardEvent'])Object.defineProperty(globalThis,k,{configurable:true,value:dom.window[k as keyof typeof dom.window]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{default:Workspace}=await import('../src/SplitInboxWorkspace.tsx');
async function mount(enabled:boolean,mode:'normal'|'held'|'lost'='normal'){
  let remote=configuration(1,[{...definition({enabled}),id:'owned',definitionRevision:1}]),last:SplitSaveResponse|undefined,patches=0;
  const hold=deferred<SplitSaveResponse>(),requests:SplitSaveRequest[]=[];
  const model=new SplitInboxModel({accountId:'a',storage:memoryStorage(),makeKey:()=> 'footer-'+mode,request:async(path,body,method='GET')=>{
    if(method==='PATCH'){
      patches++;const request=structuredClone(body as SplitSaveRequest);requests.push(request);
      let custom=structuredClone(remote.settings.custom);
      for(const c of request.changes){if(c.type==='update')custom=custom.map(d=>d.id===c.id?{...d,...c.changes,definitionRevision:d.definitionRevision+1}:d);else if(c.type==='delete')custom=custom.filter(d=>d.id!==c.id);else throw Error('Only owned update/delete is permitted');}
      remote=configuration(remote.settings.revision+1,custom);last=await accepted(request,remote);
      if(mode==='held')return hold.promise;if(mode==='lost')throw Error('Controlled lost ACK');return last;
    }
    if(path.includes('/by-request/'))return last;
    return path.includes('/views?')?views(remote):remote;
  }});
  model.activate();await model.load();assert.equal(model.edit('owned'),true);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(createElement(Workspace,{model,onClose:()=>{}})));
  const buttons=()=>[...host.querySelectorAll<HTMLButtonElement>('form footer button')];
  const button=(text:string)=>{const b=buttons().find(b=>b.textContent===text);assert.ok(b,'missing footer '+text);return b};
  const click=async(text:string)=>act(async()=>button(text).click());
  const input=async(label:string,value:string)=>act(async()=>{const e=host.querySelector<HTMLInputElement>('[aria-label="'+label+'"]')!;Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new dom.window.Event('input',{bubbles:true}))});
  const idle=async()=>{for(let i=0;i<100&&model.getSnapshot().pending;i++)await act(async()=>new Promise(r=>setTimeout(r,2)));assert.equal(model.getSnapshot().pending,null)};
  return{host,model,requests,buttons,button,click,input,idle,patches:()=>patches,release:async()=>{for(let i=0;i<100&&!last;i++)await act(async()=>new Promise(r=>setTimeout(r,2)));assert.ok(last);await act(async()=>hold.resolve(last!));await idle()},close:async()=>{await act(async()=>root.unmount());model.dispose();host.remove();assert.equal(document.querySelector('#mail')?.textContent,'Untouched Mail')}};
}

test('saved active footer exposes Turn Off Cancel Save and hides Delete',async()=>{
  const f=await mount(true);try{assert.deepEqual(f.buttons().map(b=>b.textContent),['Turn Off Split Inbox','Cancel','Save']);assert.equal(f.host.querySelector<HTMLButtonElement>('form footer .split-primary')?.type,'submit');assert.equal(f.patches(),0)}finally{await f.close()}
});

test('saved inactive primary Turn On keeps staged fields and remains inactive-mode while its ACK is pending',async()=>{
  const f=await mount(false,'held');try{
    await f.input('Split Inbox name','Renamed Cedar');await f.input('Split Inbox definition','subject:maple');
    assert.deepEqual(f.buttons().map(b=>b.textContent),['Delete Split Inbox','Cancel','Turn On Split Inbox']);const primary=f.host.querySelector<HTMLButtonElement>('form footer .split-primary')!;assert.equal(primary.textContent,'Turn On Split Inbox');assert.equal(primary.type,'button');
    await f.click('Turn On Split Inbox');assert.equal(f.patches(),1);assert.equal(f.model.getSnapshot().base?.settings.custom[0].enabled,false);assert.equal(f.model.getSnapshot().editor?.value.enabled,true);
    assert.deepEqual(f.buttons().map(b=>b.textContent),['Delete Split Inbox','Cancel','Turn On Split Inbox']);assert(f.buttons().every(b=>b.disabled));
    assert.deepEqual(f.requests[0].changes,[{type:'update',id:'owned',changes:{name:'Renamed Cedar',query:'subject:maple',enabled:true}}]);await f.release();assert.equal(f.model.getSnapshot().base?.settings.custom[0].name,'Renamed Cedar');assert.equal(f.model.getSnapshot().base?.settings.custom[0].enabled,true);assert.equal(f.patches(),1);
  }finally{await f.close()}
});

test('saved active Turn Off retains active-mode locked footer until authoritative ACK',async()=>{
  const f=await mount(true,'held');try{await f.click('Turn Off Split Inbox');assert.equal(f.model.getSnapshot().editor?.value.enabled,false);assert.equal(f.model.getSnapshot().base?.settings.custom[0].enabled,true);assert.deepEqual(f.buttons().map(b=>b.textContent),['Turn Off Split Inbox','Cancel','Save']);assert(f.buttons().every(b=>b.disabled));assert.deepEqual(f.requests[0].changes,[{type:'update',id:'owned',changes:{enabled:false}}]);await f.release();assert.equal(f.model.getSnapshot().base?.settings.custom[0].enabled,false);assert.equal(f.patches(),1)}finally{await f.close()}
});

test('inactive Delete confirmation uses acknowledged name and removes only owned ID after explicit confirmation',async()=>{
  const f=await mount(false);try{await f.input('Split Inbox name','Unsaved different name');await f.click('Delete Split Inbox');const confirm=f.host.querySelector<HTMLElement>('[role=alertdialog]')!;assert.ok(confirm);assert.match(confirm.textContent||'',/delete the split Cedar\?/);assert.doesNotMatch(confirm.textContent||'',/Unsaved different name/);assert.equal(f.patches(),0);const keep=[...confirm.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Keep editing')!;assert.equal(document.activeElement,keep);const remove=[...confirm.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Delete')!;await act(async()=>remove.click());await f.idle();assert.deepEqual(f.requests[0].changes,[{type:'delete',id:'owned'}]);assert.equal(f.patches(),1)}finally{await f.close()}
});

test('inactive form submit retains existing Save policy without implicitly turning on',async()=>{
  const f=await mount(false);try{await f.input('Split Inbox name','Saved while inactive');await act(async()=>f.host.querySelector<HTMLFormElement>('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await f.idle();assert.deepEqual(f.requests[0].changes,[{type:'update',id:'owned',changes:{name:'Saved while inactive'}}]);assert.equal(f.model.getSnapshot().base?.settings.custom[0].enabled,false);assert.equal(f.patches(),1)}finally{await f.close()}
});

test('lost Turn Off acknowledgement preserves saved active footer and locks further actions and authored fields',async()=>{
  const f=await mount(true,'lost');try{await f.input('Split Inbox name','Retained while unknown');await f.click('Turn Off Split Inbox');await f.idle();assert.equal(f.model.getSnapshot().unknown,true);assert.equal(f.host.querySelector<HTMLInputElement>('[aria-label="Split Inbox name"]')?.value,'Retained while unknown');assert.deepEqual(f.buttons().map(b=>b.textContent),['Turn Off Split Inbox','Cancel','Save']);assert(f.buttons().every(b=>b.disabled));await f.click('Save');assert.equal(f.patches(),1);assert.ok(f.model.getSnapshot().editor);assert.ok(f.host.querySelector('[role=alert]'))}finally{await f.close()}
});
