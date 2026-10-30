import {HttpError} from './types.ts';
import {ReminderSchemaError,parseReminderRequest} from './reminder-contract.ts';
import {ReminderService} from './reminders.ts';
function invalid():never{throw new HttpError(400,'Reminder request is invalid','reminder_invalid_request')}
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=1024&&!/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v)?v:invalid();
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:invalid();
const key=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)?v:invalid();
// JSON.parse alone silently keeps the last duplicate property. Tokenize only to
// reject duplicates; JSON.parse remains the grammar/primitive authority.
function jsonObject(text:string):unknown{
 const tokens=text.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)??[];
 const stack:({kind:'object';keys:Set<string>}|{kind:'array'})[]=[];
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t==='{')stack.push({kind:'object',keys:new Set()});else if(t==='[')stack.push({kind:'array'});else if(t==='}'||t===']')stack.pop();else if(t.startsWith('"')&&tokens[i+1]===':'){const top=stack.at(-1);if(!top||top.kind!=='object')invalid();const k=JSON.parse(t);if(top.keys.has(k))invalid();top.keys.add(k)}}
 try{return JSON.parse(text)}catch{return invalid()}
}
export async function readReminderJson(r:Request){if(r.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return invalid();const reader=r.body?.getReader();if(!reader)return invalid();const chunks:Uint8Array[]=[];let bytes=0;try{for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.byteLength;if(bytes>16384)return invalid();chunks.push(x.value)}}finally{await reader.cancel().catch(()=>{})}try{return jsonObject(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{return invalid()}}
export class ReminderHttp{
 readonly service:ReminderService;constructor(service:ReminderService){this.service=service}
 async handle(request:Request):Promise<Response>{const json=(status:number,v:unknown)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});try{
  this.service.assertOpen();const u=new URL(request.url),query=(names:string[])=>{if(names.some(n=>u.searchParams.getAll(n).length!==1)||[...u.searchParams.keys()].some(n=>!names.includes(n)))return invalid();return Object.fromEntries(u.searchParams)},decode=(x:string)=>{try{return id(decodeURIComponent(x))}catch{return invalid()}};
  const view=u.pathname.match(/^\/api\/threads\/([^/]+)\/reminder$/),recovery=u.pathname.match(/^\/api\/reminder-actions\/by-request\/([^/]+)$/);
  if(view&&request.method==='GET'){const q=query(['accountId']);return json(200,this.service.view(id(q.accountId),decode(view[1])))}
  if(recovery&&request.method==='GET'){const q=query(['accountId','accountVersion']);return json(200,await this.service.recover(id(q.accountId),hash(q.accountVersion),key(decode(recovery[1]))))}
  if(u.pathname==='/api/reminder-actions'&&request.method==='POST'){if(u.search)return invalid();parseReminderRequest(await readReminderJson(request));this.service.assertOpen();throw new HttpError(409,'Reminder dispatcher is unavailable','reminder_unavailable')}
  throw new HttpError(404,'Reminder route not found','reminder_not_found');
 }catch(e){const status=e instanceof HttpError?e.status:e instanceof ReminderSchemaError?400:500;return json(status,{error:{code:e instanceof HttpError?e.code:e instanceof ReminderSchemaError?'reminder_invalid_request':'reminder_corrupt',message:'Reminder request could not be completed'}})}}
}
