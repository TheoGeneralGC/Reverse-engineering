// Browser-only synthetic fixture. All Calendar calls terminate in this function;
// there is deliberately no fetch fallback or provider credential configuration.
import { createRoot } from 'react-dom/client';
import CalendarWorkspace from '../src/calendar/CalendarWorkspace.tsx';
import Icon from '../src/Icon.tsx';
import type { CalendarCatalog,CalendarEvent,CalendarMetadata,CalendarOperation,CalendarRequest } from '../src/calendar/types.ts';
import '../src/style.css';

const accountId='demo',now=()=>new Date('2026-10-28T02:23:00Z');
const calendars:CalendarMetadata[]=[
 {accountId,id:'synthetic-owned',summary:'Calendar fixture',timeZone:'America/Los_Angeles',accessRole:'owner',primary:true,selected:true,backgroundColor:'#eef9ff',updatedAt:now().toISOString()},
 {accountId,id:'synthetic-holidays',summary:'Public holidays',timeZone:'America/Los_Angeles',accessRole:'reader',selected:true,backgroundColor:'#e0fbe9',updatedAt:now().toISOString()},
];
const events:CalendarEvent[]=[
 {accountId,calendarId:'synthetic-owned',id:'planning',status:'confirmed',etag:'"fixture-v1"',summary:'Planning session',start:{dateTime:'2026-10-28T12:00:00-07:00',timeZone:'America/Los_Angeles'},end:{dateTime:'2026-10-28T14:00:00-07:00',timeZone:'America/Los_Angeles'},recurrence:['RRULE:FREQ=WEEKLY;BYDAY=WE'],htmlLink:'https://calendar.google.com/'},
 {accountId,calendarId:'synthetic-holidays',id:'halloween',status:'confirmed',etag:'"holiday-v1"',summary:'Halloween',start:{date:'2026-10-31'},end:{date:'2026-11-01'}},
];
const operations=new Map<string,CalendarOperation>();let sequence=0;
const journalData=new Map<string,{id:string;attempted:boolean}>();
const journal={read:(id:string)=>journalData.get(id)||null,write:(id:string,value:{id:string;attempted:boolean})=>{journalData.set(id,value);return true},clear:(id:string)=>{journalData.delete(id)}};
const clone=<T,>(value:T):T=>structuredClone(value);
const catalog:CalendarCatalog={calendars,sync:{phase:'incremental',partial:false,lastCompletedAt:now().toISOString()},providerStatus:{enabled:true,configured:true,grant:null,capabilities:{list:true,read:true,readOwned:true,writeOwned:true,freebusy:true},writesEnabled:true,liveVerified:false}};
const request:CalendarRequest=async<T,>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>=>{
 const url=new URL(path,'http://synthetic.invalid'),input=body as Record<string,any>|undefined;
 if(url.pathname==='/calendar/calendars'&&method==='GET')return clone(catalog) as T;
 if(url.pathname==='/calendar/calendars/sync')return{partial:false} as T;
 if(url.pathname==='/calendar/events'&&method==='GET'){
  const calendarId=url.searchParams.get('calendarId')!,timeMin=url.searchParams.get('timeMin')!,timeMax=url.searchParams.get('timeMax')!,timeZone=url.searchParams.get('timeZone')!;
  const selected=events.filter(event=>event.calendarId===calendarId&&event.status!=='cancelled'&&new Date(event.end?.dateTime||event.end?.date||0).getTime()>Date.parse(timeMin)&&new Date(event.start?.dateTime||event.start?.date||0).getTime()<Date.parse(timeMax));
  return clone({calendarId,range:{timeMin,timeMax,timeZone},events:selected,cache:{key:calendarId+timeMin,partial:false,updatedAt:now().toISOString(),expiresAt:'2027-01-01T00:00:00Z'}}) as T;
 }
 const eventMatch=url.pathname.match(/^\/calendar\/events\/([^/]+)$/);
 if(eventMatch){const event=events.find(event=>event.id===decodeURIComponent(eventMatch[1])&&event.calendarId===url.searchParams.get('calendarId'));if(!event)throw new Error('Synthetic event unavailable');return clone({event}) as T}
 if(url.pathname==='/calendar/operations'&&method==='POST'){
  const id='synthetic-operation-'+(++sequence),operation:CalendarOperation={id,accountId,calendarId:input!.calendarId,kind:input!.kind,eventId:input!.eventId||'synthetic-created-'+sequence,etag:input!.etag,input:input!.event,status:'prepared',createdAt:now().toISOString(),updatedAt:now().toISOString()};operations.set(id,operation);return clone({operation}) as T;
 }
 const operationMatch=url.pathname.match(/^\/calendar\/operations\/([^/]+)(?:\/(execute|reconcile))?$/);
 if(operationMatch){const operation=operations.get(decodeURIComponent(operationMatch[1]));if(!operation)throw new Error('Synthetic operation unavailable');
  if(operationMatch[2]==='execute'&&operation.status==='prepared'){
   const existing=events.find(event=>event.calendarId===operation.calendarId&&event.id===operation.eventId);
   if(operation.kind!=='create'&&operation.etag!==existing?.etag){operation.status='conflict';operation.error='The synthetic event changed.'}
   else{
    const event:CalendarEvent={...(existing||{accountId,calendarId:operation.calendarId,id:operation.eventId,status:'confirmed'}),...operation.input,etag:'"fixture-operation-'+sequence+'"',...(operation.kind==='delete'?{status:'cancelled' as const}:{})};
    if(existing)events.splice(events.indexOf(existing),1,event);else events.push(event);operation.status='succeeded';operation.result=event;
   }
  }
  return clone({operation}) as T;
 }
 if(url.pathname==='/calendar/freebusy'){
  const email=input!.items[0],known=email==='available@example.test';return{timeMin:input!.timeMin,timeMax:input!.timeMax,calendars:{[email]:known?{status:'known',busy:[{start:'2026-10-28T19:00:00Z',end:'2026-10-28T21:00:00Z'}]}:{status:'unknown',errors:['notFound']}},groups:{},complete:known} as T;
 }
 throw new Error('No provider traffic: unsupported synthetic Calendar request '+method+' '+url.pathname);
};
createRoot(document.getElementById('root')!).render(<div className="app calendar-mode" style={{height:'100vh',paddingBottom:32}}><aside className="rail" aria-label="Applications"><button aria-label="Ask AI" disabled><Icon name="spark"/></button><nav><button aria-label="Mail" disabled><Icon name="mail"/></button><button aria-label="Calendar" className="active"><Icon name="calendar"/></button></nav></aside><CalendarWorkspace accountId={accountId} accountName="Calendar fixture" accountEmail="calendar-fixture@example.test" initialDate="2026-10-27" timeZone="America/Los_Angeles" now={now} request={request} journal={journal}/></div>);
