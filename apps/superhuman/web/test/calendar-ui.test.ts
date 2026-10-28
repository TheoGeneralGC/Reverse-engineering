import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync,readFileSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { CalendarEvent,CalendarOperation,CalendarProviderStatus,CalendarRangeResult,CalendarRequest } from '../src/calendar/types.ts';
import { calendarJournal } from '../src/calendar/model.ts';
const directory=fileURLToPath(new URL('../src/',import.meta.url)),compiled=new Map<string,string>();
await Promise.all(readdirSync(directory,{recursive:true}).filter(name=>String(name).endsWith('.tsx')).map(async name=>{const path=directory+name,result=await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}});compiled.set(pathToFileURL(path).href,result.code)}));
const hook=registerHooks({load(url,context,next){if(url.endsWith('.css'))return{format:'module',shortCircuit:true,source:''};const source=compiled.get(url);return source!==undefined?{format:'module',shortCircuit:true,source}:next(url,context)}});after(()=>hook.deregister());
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5173'}),window=dom.window;
for(const key of ['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','KeyboardEvent','MouseEvent','Event','CustomEvent','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,key,{configurable:true,value:window[key as keyof typeof window]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:FrameRequestCallback)=>setTimeout(()=>fn(Date.now()),0),cancelAnimationFrame:(id:ReturnType<typeof setTimeout>)=>clearTimeout(id)});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{default:CalendarWorkspace}=await import('../src/calendar/CalendarWorkspace.tsx');
const now=()=>new Date('2026-10-28T02:08:00Z'),zone='America/Los_Angeles';let serial=0;
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}};
const enabled:CalendarProviderStatus={enabled:true,configured:true,grant:{},capabilities:{list:true,read:true,readOwned:true,writeOwned:true,freebusy:true},writesEnabled:true,liveVerified:false};
type Request={path:string;method:string;body:any};
async function mount(options:{accountId?:string;provider?:CalendarProviderStatus;unknown?:boolean;range?:(path:URL,normal:CalendarRangeResult)=>Promise<CalendarRangeResult>;availability?:Promise<unknown>;sourceTarget?:{accountId:string;calendarId:string;eventId:string};detail?:(url:URL,event:CalendarEvent|undefined)=>Promise<CalendarEvent>}={}){
 const accountId=options.accountId||'calendar-ui-'+(++serial),requests:Request[]=[],stored=new Map<string,string>(),journal=calendarJournal({getItem:key=>stored.get(key)||null,setItem:(key,value)=>{stored.set(key,value)},removeItem:key=>{stored.delete(key)}}),operations=new Map<string,CalendarOperation>();
 const work:CalendarEvent={accountId,calendarId:'owned',id:'work',etag:'"v1"',status:'confirmed',summary:'Project review',start:{dateTime:'2026-10-28T12:00:00-07:00',timeZone:zone},end:{dateTime:'2026-10-28T14:00:00-07:00',timeZone:zone},recurrence:['RRULE:FREQ=WEEKLY;BYDAY=WE']},holiday:CalendarEvent={accountId,calendarId:'holiday',id:'holiday',etag:'"h1"',status:'confirmed',summary:'Halloween',start:{date:'2026-10-31'},end:{date:'2026-11-01'}};
 const events=new Map([['work',work],['holiday',holiday]]);
 const request:CalendarRequest=async<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>{
  requests.push({path,body:body===undefined?undefined:structuredClone(body),method});const url=new URL(path,'http://fixture.test');
  if(url.pathname==='/calendar/calendars')return{calendars:[{accountId,id:'owned',summary:'Owner Calendar',timeZone:zone,accessRole:'owner',primary:true,selected:true,backgroundColor:'#bce3f8',updatedAt:now().toISOString()},{accountId,id:'holiday',summary:'Holidays',timeZone:zone,accessRole:'reader',selected:true,backgroundColor:'#98e7ad',updatedAt:now().toISOString()}],sync:{phase:'incremental',partial:false},providerStatus:options.provider||enabled} as T;
  if(url.pathname==='/calendar/events'){const id=url.searchParams.get('calendarId')!,normal:CalendarRangeResult={calendarId:id,range:{timeMin:url.searchParams.get('timeMin')!,timeMax:url.searchParams.get('timeMax')!,timeZone:url.searchParams.get('timeZone')!},events:[...events.values()].filter(event=>event.calendarId===id),cache:{key:'week',partial:false,updatedAt:now().toISOString(),expiresAt:'2026-10-28T02:09:00Z'}};return(options.range?await options.range(url,normal):normal) as T}
  if(url.pathname.startsWith('/calendar/events/')){const event=events.get(decodeURIComponent(url.pathname.split('/').at(-1)!));return{event:options.detail?await options.detail(url,event):event} as T}
  if(url.pathname==='/calendar/freebusy')return await options.availability as T;
  if(url.pathname==='/calendar/operations'){const input=body as any,id='operation-'+(operations.size+1),operation:CalendarOperation={id,accountId,calendarId:input.calendarId,kind:input.kind,eventId:input.eventId||'new-event',etag:input.etag,input:input.event,status:'prepared',createdAt:now().toISOString(),updatedAt:now().toISOString()};operations.set(id,operation);return{operation} as T}
  if(url.pathname.startsWith('/calendar/operations/')){const pieces=url.pathname.split('/'),id=pieces[3],operation=operations.get(id)!;if(pieces[4]==='execute'){assert.deepEqual(journal.read(accountId),{id,attempted:true});if(options.unknown){operation.status='unknown';operation.error='Synthetic unconfirmed event change';operation.errorCode='calendar_delivery_unknown';throw new Error(operation.error)}operation.status='succeeded';operation.result={accountId,calendarId:operation.calendarId,id:operation.eventId,status:operation.kind==='delete'?'cancelled':'confirmed',...operation.input};events.set(operation.eventId,operation.result)}else if(pieces[4]==='reconcile'){operation.status='succeeded';operation.result={accountId,calendarId:operation.calendarId,id:operation.eventId,status:'confirmed',...operation.input}}return{operation} as T}
  throw new Error('Unexpected fixture request '+method+' '+path);
 };
 const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host);let sourceTarget=options.sourceTarget;const render=()=>root.render(createElement(CalendarWorkspace,{accountId,accountName:'Synthetic Owner',accountEmail:'owner@example.test',timeZone:zone,initialDate:'2026-10-27',now,request,journal,sourceTarget}));await act(async()=>{render()});
 const button=(name:string)=>{const result=Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item=>item.getAttribute('aria-label')===name||item.textContent?.trim()===name);assert.ok(result,`Missing button ${name}`);return result};
 const click=async(name:string)=>{await act(async()=>{button(name).click()})};
 const fill=async(name:string,value:string)=>{const input=host.querySelector<HTMLInputElement>(`[aria-label="${name}"]`);assert.ok(input,`Missing input ${name}`);await act(async()=>{input.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}))});return input};
 const key=async(value:string)=>{await act(async()=>{window.document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}))})};
 return{accountId,host,requests,journal,updateTarget:async(target:typeof sourceTarget)=>{sourceTarget=target;await act(async()=>render())},setEvent:(id:string,patch:Partial<CalendarEvent>)=>events.set(id,{...events.get(id)!,...patch}),button,click,fill,key,close:async()=>{await act(async()=>root.unmount());host.remove()}};
}

test('Calendar workspace renders Sunday week, timed and exclusive all-day events with owned/read-only calendars',async()=>{
 const app=await mount();try{assert.equal(app.host.querySelectorAll('.calendar-week-head>div').length,8);assert.match(app.host.textContent||'',/Sun 25.*Mon 26.*Tue 27.*Wed 28.*Thur 29.*Fri 30.*Sat 31/);assert.ok(app.button('Project review, 12 pm to 2 pm'));assert.ok(app.button('Halloween'));assert.match(app.host.textContent||'',/Owner Calendar/);assert.equal(app.host.querySelectorAll('.calendar-current-time').length,1);assert.equal(app.requests.some(item=>item.method!=='GET'),false)}finally{await app.close()}
});

test('new event is ephemeral, defaults to thirty minutes, and Cancel makes no provider operation',async()=>{
 const app=await mount();try{await app.key('b');await app.fill('Event title','Synthetic draft');const when=app.host.querySelector<HTMLInputElement>('[aria-label="When"]')!;assert.equal(when.value,'Tue, Oct 27th 7:08 – 7:38 PM');assert.ok(app.host.querySelector('[data-calendar-preview]'));assert.equal(app.requests.some(item=>item.method!=='GET'),false);await app.click('Cancel');assert.equal(app.host.querySelector('[aria-label="New event"]'),null);assert.equal(app.requests.some(item=>item.path==='/calendar/operations'),false)}finally{await app.close()}
});

test('inline observed When phrases normalize on blur and retain an exact secondary time zone label',async()=>{
 const app=await mount();try{await app.key('b');const input=await app.fill('When','tomorrow 2 pm 30 min new york');await act(async()=>input.blur());assert.equal(input.value,'Wed, Oct 28th 2:00 – 2:30 PM EDT');assert.match(app.host.textContent||'',/Wed, Oct 28th 11:00 – 11:30 AM PDT/);await app.click('Cancel')}finally{await app.close()}
});

test('Repeat and Custom stay local until Save, while invalid When text cannot dispatch the old time',async()=>{
 const app=await mount();try{await app.key('b');await app.click('Repeat');await app.click('Custom');assert.ok(app.host.querySelector('[aria-label="Repeat"]'));await app.click('Done');assert.equal(app.requests.some(item=>item.method!=='GET'),false);await app.fill('When','unrecognized schedule');await app.click('Save');assert.equal(app.requests.some(item=>item.path==='/calendar/operations'),false);assert.match(app.host.textContent||'',/Try “tomorrow/)}finally{await app.close()}
});

test('Save records one operation before execution and closes only after confirmed success',async()=>{
 const app=await mount();try{await app.key('b');await app.fill('Event title','Explicit save');await act(async()=>{app.button('Save').click();app.button('Save').click()});assert.equal(app.requests.filter(item=>item.path==='/calendar/operations').length,1);assert.equal(app.requests.filter(item=>item.path.endsWith('/execute')).length,1);assert.equal(app.journal.read(app.accountId),null);assert.match(app.host.textContent||'',/Event saved/)}finally{await app.close()}
});

test('unknown Save retains and locks entered fields, never prepares a fresh operation, and offers explicit reconciliation',async()=>{
 const app=await mount({unknown:true});try{await app.key('b');await app.fill('Event title','Keep this text');await app.click('Save');assert.equal(app.host.querySelector<HTMLInputElement>('[aria-label="Event title"]')?.value,'Keep this text');assert.equal(app.host.querySelector<HTMLInputElement>('[aria-label="Event title"]')?.readOnly,true);assert.ok(app.button('Check event status'));assert.equal(app.button('Cancel').disabled,true);assert.equal(app.requests.filter(item=>item.path==='/calendar/operations').length,1);assert.equal(app.requests.some(item=>item.path.endsWith('/reconcile')),false);await app.click('Check event status');assert.equal(app.requests.filter(item=>item.path.endsWith('/execute')).length,1);assert.equal(app.requests.filter(item=>item.path.endsWith('/reconcile')).length,1);assert.match(app.host.textContent||'',/Event saved/)}finally{await app.close()}
});

test('read-only holiday details have no enabled edit/delete action and never prepare an event operation',async()=>{
 const app=await mount();try{await app.click('Halloween');await app.click('Event options');assert.equal(app.button('Edit').disabled,true);assert.equal(app.button('Delete').disabled,true);assert.equal(app.requests.some(item=>item.path==='/calendar/operations'),false)}finally{await app.close()}
});

test('a partial range failure keeps already imported events and announces incomplete coverage',async()=>{
 let pages=0;const app=await mount({range:async(url,normal)=>{if(url.searchParams.get('calendarId')!=='owned')return normal;if(pages++===0)return{...normal,cache:{...normal.cache,partial:true}};throw new Error('Synthetic partial range failure')}});try{assert.ok(app.button('Project review, 12 pm to 2 pm'));assert.match(app.host.textContent||'',/Synthetic partial range failure/);assert.doesNotMatch(app.host.textContent||'',/No events|all done/i)}finally{await app.close()}
});

test('changing Meet email invalidates an earlier availability lookup instead of showing it for the new person',async()=>{
 const pending=deferred<unknown>();const app=await mount({availability:pending.promise});try{const input=await app.fill('Meet Who','first@example.test');await act(async()=>{input.closest('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))});await app.fill('Meet Who','second@example.test');await act(async()=>{pending.resolve({timeMin:'',timeMax:'',complete:true,groups:{},calendars:{'first@example.test':{status:'known',busy:[]}}})});assert.equal(app.host.querySelector('.calendar-availability'),null)}finally{await app.close()}
});

test('unsaved plain calendar draft survives leaving and reopening the same account without a write',async()=>{
 const accountId='calendar-ui-retained';const first=await mount({accountId});await first.key('b');await first.fill('Event title','Retain across account navigation');await first.close();const second=await mount({accountId});try{assert.equal(second.host.querySelector<HTMLInputElement>('[aria-label="Event title"]')?.value,'Retain across account navigation');assert.equal(second.requests.some(item=>item.path==='/calendar/operations'),false);await second.click('Cancel')}finally{await second.close()}
});


test('an asynchronous Google Meet link is refreshed with GET and never re-dispatched',async()=>{
 const app=await mount();try{app.setEvent('work',{meetingLink:{provider:'googleMeet',status:'pending'}});await app.click('Project review, 12 pm to 2 pm');assert.match(app.host.textContent||'',/Meeting link is being created/);app.setEvent('work',{meetingLink:{provider:'googleMeet',status:'success',uri:'https://meet.google.com/abc-defg-hij'}});await app.click('Refresh link status');assert.equal(app.host.querySelector<HTMLAnchorElement>('a[href="https://meet.google.com/abc-defg-hij"]')?.textContent,'Join Google Meet');assert.equal(app.requests.some(item=>item.method!=='GET'),false)}finally{await app.close()}
});


test('typed AI calendar source opens only its exact event and navigates using the returned event date',async()=>{
 const accountId='calendar-ai-source-date';const app=await mount({accountId,sourceTarget:{accountId,calendarId:'owned',eventId:'work'},detail:async(_url,event)=>({...event!,start:{dateTime:'2026-11-12T12:00:00-08:00',timeZone:zone},end:{dateTime:'2026-11-12T13:00:00-08:00',timeZone:zone}})});try{
  assert.match(app.host.querySelector('[aria-label="Event details"]')?.textContent||'',/Project review/);assert.match(app.host.querySelector('.calendar-week-head')?.textContent||'',/Thur 12/);assert.equal(app.requests.filter(item=>item.path.startsWith('/calendar/events/work?')).length,1);assert.equal(app.requests.some(item=>item.method!=='GET'),false);
 }finally{await app.close()}
});

test('a delayed old AI calendar source cannot replace a newer exact source target',async()=>{
 const accountId='calendar-ai-source-race',pending=deferred<CalendarEvent>();let old:CalendarEvent|undefined;const app=await mount({accountId,sourceTarget:{accountId,calendarId:'owned',eventId:'work'},detail:async(url,event)=>{if(url.pathname.endsWith('/work')){old=event;return pending.promise}return event!}});try{
  assert.equal(app.requests.filter(item=>item.path.startsWith('/calendar/events/work?')).length,1);await app.updateTarget({accountId,calendarId:'holiday',eventId:'holiday'});assert.match(app.host.querySelector('[aria-label="Event details"]')?.textContent||'',/Halloween/);assert.ok(old);await act(async()=>pending.resolve(old!));assert.match(app.host.querySelector('[aria-label="Event details"]')?.textContent||'',/Halloween/);assert.doesNotMatch(app.host.querySelector('[aria-label="Event details"]')?.textContent||'',/Project review/);assert.equal(app.requests.some(item=>item.method!=='GET'),false);
 }finally{await app.close()}
});

test('missing or foreign AI calendar source targets never substitute a normal visible event',async()=>{
 for(const foreign of[false,true]){
  const accountId='calendar-ai-source-missing-'+foreign;const app=await mount({accountId,sourceTarget:{accountId:foreign?'other-account':accountId,calendarId:'owned',eventId:'missing'},detail:async()=>{throw new Error('Synthetic exact source not found')}});try{
   assert.equal(app.host.querySelector('[aria-label="Event details"]'),null);assert.equal(app.requests.filter(item=>item.path.startsWith('/calendar/events/missing?')).length,foreign?0:1);if(!foreign)assert.match(app.host.textContent||'',/Synthetic exact source not found/);assert.equal(app.requests.some(item=>item.method!=='GET'),false);
  }finally{await app.close()}
 }
});
