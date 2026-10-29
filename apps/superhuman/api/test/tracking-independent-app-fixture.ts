import{verifiedCollectorFixture}from'./tracking-verified-fixture.ts';
/** Synthetic fixture only. No default database, inherited environment, live network or credentials. */
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import PostalMime from 'postal-mime';
import {createApp} from '../src/server.ts';
import type {Draft} from '../src/types.ts';
import type {ProviderDraftTransport,GmailDraftResource} from '../src/provider-draft-transport.ts';
import {citationAnswer} from '../src/ai-citations.ts';
import {createCollectorFixture,type CollectorFault} from './tracking-independent-collector-fixture.ts';

export const SENDER='synthetic-sender',FOREIGN='synthetic-foreign',EMAIL='sender@example.test',PEER='peer@example.test';
export const SUBJECT='Independent fictional tracked Cedar fixture',BODY='The fictional Cedar review is Thursday at 3 PM. Bring 3 samples.';
export const HTML='<p>The fictional <b>Cedar</b> review is Thursday at 3 PM. Bring 3 samples.</p>';
export const ATTACHMENT=Buffer.alloc(65,0x78);
export const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
export type NativeCall=Readonly<{accountId:string;path:string;id:string;raw:string}>;

export async function invoke(app:ReturnType<typeof createApp>,method:string,url:string,value?:unknown):Promise<{status:number;body:any}>{
 return new Promise((resolve,reject)=>{
  const input=Object.assign(Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]),{method,url,headers:{host:'127.0.0.1:3001','content-type':'application/json'}});
  const output={status:0,setHeader(){},writeHead(status:number){this.status=status},end(payload:Buffer|string){try{resolve({status:this.status,body:JSON.parse(String(payload))})}catch{reject(Error('Synthetic response was not JSON'))}}};
  try{app.server.emit('request',input,output)}catch{reject(Error('Synthetic request handler failed'))}
 });
}

export function createAppFixture(options:{databasePath?:string;undoWindowMs?:number;collectorFault?:CollectorFault;nativeFault?:(call:NativeCall)=>Promise<Response>}={}){
 const databasePath=options.databasePath??':memory:';
 if(databasePath!==':memory:'&&!databasePath.startsWith('/'))throw Error('Fixture requires explicit memory or owned absolute temporary path');
 let deliveryNow=Date.now(),wallNow=deliveryNow,serial=0;
 const scheduled=new Set<{at:number;callback:()=>void}>();
 const scheduler={now:()=>deliveryNow,schedule:(callback:()=>void,ms:number)=>{const row={at:deliveryNow+ms,callback};scheduled.add(row);return{cancel:()=>{scheduled.delete(row)}}}};
 const collector=createCollectorFixture({now:()=>wallNow,fault:options.collectorFault});
 const remote=new Map<string,GmailDraftResource>(),providerCalls:{kind:string;id:string|null;raw:string|null}[]=[],nativeCalls:NativeCall[]=[],nativeEntries:{origin:string;method:string;path:string}[]=[];
 const transport:ProviderDraftTransport={
  ready(){},async profile(){return EMAIL},
  async create(_account,message){const id='owned-cloud-'+(++serial),value={id,message:{id:'cloud-message-'+serial,threadId:message.threadId??'cloud-thread',raw:message.raw,labelIds:['DRAFT']}};providerCalls.push({kind:'create',id,raw:message.raw});remote.set(id,value);return structuredClone(value)},
  async update(_account,id,message){if(!remote.has(id))throw Error('Synthetic cloud ID missing');const value={id,message:{id:'cloud-message-'+(++serial),threadId:message.threadId??'cloud-thread',raw:message.raw,labelIds:['DRAFT']}};providerCalls.push({kind:'update',id,raw:message.raw});remote.set(id,value);return structuredClone(value)},
  async get(_account,id){providerCalls.push({kind:'get',id,raw:null});return structuredClone(remote.get(id))},
  async list(){providerCalls.push({kind:'list',id:null,raw:null});return{drafts:[...remote.values()].map(v=>({id:v.id,message:{id:v.message.id}}))}},
  async metadata(_account,id){const item=[...remote.values()].find(v=>v.message.id===id);if(!item)throw Error('Synthetic metadata ID missing');const parsed=await PostalMime.parse(Buffer.from(item.message.raw!,'base64url'));return{id,labelIds:['DRAFT'],payload:{headers:parsed.headers.map(h=>({name:h.originalKey,value:h.value}))}}},
  async delete(_account,id){providerCalls.push({kind:'delete',id,raw:null});remote.delete(id)},
 };
 const env={DATABASE_PATH:databasePath,GOOGLE_CLIENT_ID:'synthetic-only',GOOGLE_CLIENT_SECRET:'synthetic-only',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),APPROVED_TEST_SENDERS:EMAIL,APPROVED_TEST_RECIPIENTS:PEER,GOOGLE_CALENDAR_ENABLED:'false',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''};
 Object.assign(collector.configuration,verifiedCollectorFixture(collector.configuration));
 const appOptions={databasePath,env,seed:false,runJobs:false,providerDraftAutomatic:false,undoWindowMs:options.undoWindowMs??0,scheduler,providerDraftTransport:transport,trackingCollector:collector.configuration,aiFetch:async()=>{throw Error('Synthetic fixture prohibits model calls')}};
 let app=createApp(appOptions);
 for(const [id,email]of[[SENDER,EMAIL],[FOREIGN,PEER]])app.store.put('account',id,{id,email,provider:'google',name:'Synthetic account',color:'#000'});
 app.store.put('preferences','global',{theme:'light',activeAccountId:SENDER,signature:'',defaultRemind:'tomorrow',splitInbox:[],snippets:[]});
 app.store.put('googleGrant','mail:'+SENDER,{accountId:SENDER,service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});
 app.google.saveTokens(SENDER,{access_token:'synthetic-no-real-token',expires_at:Date.now()+86_400_000,grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});
 const nativeFetcher:typeof fetch=async(input,init={})=>{
  const url=new URL(String(input));nativeEntries.push({origin:url.origin,method:init.method??'GET',path:url.pathname+url.search});if(url.origin!=='https://gmail.googleapis.com')throw Error('Synthetic fixture prohibits external origins/auth refresh');
  const path=url.pathname.replace(/^\/gmail\/v1\/users\/me\//,'');
  if((init.method??'GET')==='POST'&&path==='drafts/send'){
   const payload=JSON.parse(String(init.body));if(!payload||!remote.has(payload.id)||typeof payload.message?.raw!=='string')throw Error('Synthetic native payload escaped mapping');
   const call=Object.freeze({accountId:SENDER,path,id:payload.id,raw:payload.message.raw});nativeCalls.push(call);remote.delete(payload.id);
   return options.nativeFault?options.nativeFault(call):Response.json({id:'native-sent-'+nativeCalls.length});
  }
  const match=/^messages\/(native-sent-[1-9]\d*)$/.exec(path);
  if((init.method??'GET')==='GET'&&match&&url.searchParams.get('format')==='metadata'){
   const call=nativeCalls[Number(match[1].slice('native-sent-'.length))-1];if(!call)throw Error('Foreign post-ACK metadata');
   const parsed=await PostalMime.parse(Buffer.from(call.raw,'base64url'));
   return Response.json({id:match[1],labelIds:['SENT'],payload:{headers:parsed.headers.filter(h=>['from','message-id','x-reconstruction-delivery-id'].includes(h.key)).map(h=>({name:h.originalKey,value:h.value}))}});
  }
  throw Error('Synthetic fixture prohibits fallback or unrelated native requests');
 };
 app.google.fetcher=nativeFetcher;
 let closed=false;
 return{get app(){return app},collector,transport,remote,providerCalls,nativeCalls,nativeEntries,
  deliveryNow:()=>deliveryNow,wallNow:()=>wallNow,
  advanceDelivery(ms:number){deliveryNow+=ms},advanceWall(ms:number){wallNow+=ms},
  runDue(){for(const row of [...scheduled])if(row.at<=deliveryNow){scheduled.delete(row);row.callback()}},
  async draft(mapped=true,attach=false){const response=await invoke(app,'POST','/api/drafts',{accountId:SENDER,to:PEER,subject:SUBJECT,body:BODY,html:HTML});if(response.status!==201)throw Error('Synthetic local create failed');let draft=response.body.draft as Draft;if(attach)draft=app.store.addAttachment(draft.id,{name:'synthetic-65.txt',mimeType:'text/plain',data:ATTACHMENT.toString('base64')}).draft;if(mapped)await app.providerDrafts.flush(SENDER,draft.id);return app.store.required<Draft>('draft',draft.id)},
  sendRequest(draftId:string,key:string){const value=app.draftSend.current(SENDER,draftId);return{accountId:SENDER,clientRequestId:key,expectedDraftRevision:value.draftRevision,expectedContentHash:value.contentHash,expectedGeneration:value.eligibility.generation!}},
  artifact(key:string){const session=app.aiChat.createSession(SENDER),turn=app.aiChat.repository.accept(session.id,{accountId:SENDER,clientRequestId:'synthetic-seed-'+(++serial),expectedRevision:0,prompt:'Synthetic offline fixture',context:{resources:[]}},'synthetic-model').turn;app.aiChat.repository.update(turn.id,t=>{t.state='running'});const preview=app.aiChat.drafts.propose(turn.id,{to:[{email:PEER}],subject:SUBJECT,body:BODY,html:HTML});app.aiChat.repository.update(turn.id,t=>{t.state='completed';t.answer=citationAnswer('Offline fixture.',[],false);t.previews=[preview]},[],false,t=>app.aiChat.drafts.commitPreview(t,preview));return{preview,scope:{accountId:SENDER,sessionId:session.id,turnId:turn.id},request:{accountId:SENDER,sessionId:session.id,turnId:turn.id,clientRequestId:key,expectedGeneration:0,expectedPreviewHash:preview.payloadHash}}},
  async restart(){if(closed||databasePath===':memory:')throw Error('Restart requires an open fixture-owned temporary database');await app.close();app=createApp(appOptions);app.google.fetcher=nativeFetcher},
  observer(){if(closed||databasePath===':memory:')throw Error('Independent observer requires an owned temporary database');const next=createApp(appOptions);next.google.fetcher=nativeFetcher;return next},
  async close(){if(closed)return;closed=true;await app.close();collector.close()},
 };
}
