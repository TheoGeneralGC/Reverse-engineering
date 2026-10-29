import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import PostalMime from 'postal-mime';
import { createApp } from '../src/server.ts';
import type { ProviderDraftTransport,GmailDraftResource } from '../src/provider-draft-transport.ts';
import type { Draft } from '../src/types.ts';
const env={DATABASE_PATH:':memory:',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),APPROVED_TEST_SENDERS:'self@example.test',APPROVED_TEST_RECIPIENTS:'peer@example.test'};
function fixture(windowMs=0,automatic=false){
  let n=0,sends=0;const remote=new Map<string,GmailDraftResource>(),calls={create:0,update:0,delete:0};
  const transport:ProviderDraftTransport={ready(){},async profile(){return'self@example.test'},async create(_a,message){calls.create++;const id='remote-'+(++n),value={id,message:{id:'message-'+n,threadId:message.threadId??'thread-1',raw:message.raw,labelIds:['DRAFT']}};remote.set(id,value);return value},async update(_a,id,message){calls.update++;const value={id,message:{id:'message-'+(++n),threadId:message.threadId??'thread-1',raw:message.raw,labelIds:['DRAFT']}};remote.set(id,value);return value},async get(_a,id){return remote.get(id)},async list(){return{drafts:[...remote.values()].map(v=>({id:v.id,message:{id:v.message.id}}))}},async metadata(_a,id){const item=[...remote.values()].find(v=>v.message.id===id)!;const parsed=await PostalMime.parse(Buffer.from(item.message.raw!,'base64url'));return{id,labelIds:['DRAFT'],payload:{headers:parsed.headers.map(h=>({name:h.originalKey,value:h.value}))}}},async delete(_a,id){calls.delete++;remote.delete(id)}};
  const timers=new Set<()=>void>();
  const app=createApp({databasePath:':memory:',env,seed:false,runJobs:false,undoWindowMs:windowMs,providerDraftTransport:transport,providerDraftAutomatic:automatic,scheduler:{now:Date.now,schedule:callback=>{timers.add(callback);return{cancel:()=>{timers.delete(callback)}}}}});
  for(const id of ['google','other'])app.store.put('account',id,{id,provider:'google',email:id==='google'?'self@example.test':'other@example.test',name:'Synthetic',color:'#000'});
  app.store.put('preferences','global',{theme:'light',activeAccountId:'google',signature:'',defaultRemind:'tomorrow',splitInbox:[],snippets:[]});app.store.put('googleGrant','mail:google',{accountId:'google',service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('google','synthetic-never-read');
  app.google.fetcher=(async()=>{throw Error('External traffic prohibited')})as typeof fetch;
  app.google.acknowledgedDeliveryMetadata=async()=>undefined;
  app.google.request=async(_account,path,init)=>{assert.equal(path,'drafts/send','No fallback or unrelated provider request');const body=JSON.parse(String(init?.body));assert.ok(remote.has(body.id));assert.ok(typeof body.message.raw==='string');sends++;remote.delete(body.id);return{id:'sent-'+sends}};
  return{app,transport,remote,calls,timers,sends:()=>sends};
}
async function invoke(app:ReturnType<typeof createApp>,method:string,url:string,value?:unknown):Promise<{status:number;body:any}>{
  return new Promise(resolve=>{const request=Object.assign(Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]),{method,url,headers:{host:'127.0.0.1:3001','content-type':'application/json'}});const response={status:0,setHeader(){},writeHead(status:number){this.status=status},end(payload:string|Buffer){resolve({status:this.status,body:JSON.parse(String(payload))})}};app.server.emit('request',request,response)});
}
async function create(f:ReturnType<typeof fixture>){const result=await invoke(f.app,'POST','/api/drafts',{accountId:'google',to:'peer@example.test',subject:'Synthetic cloud draft',body:'Three fictional samples.',html:'<p>Three <b>fictional</b> samples.</p>'});assert.equal(result.status,201);return result.body.draft as Draft}
function sendRequest(f:ReturnType<typeof fixture>,draftId:string,key='send-once'){const s=f.app.draftSend.current('google',draftId);return{accountId:'google',clientRequestId:key,expectedDraftRevision:s.draftRevision,expectedContentHash:s.contentHash,expectedGeneration:s.eligibility.generation!}}

test('HTTP enrolls only new replica drafts; selected status is scoped/read-only and legacy bytes are preserved',async()=>{
  const f=fixture();try{
    const legacy=f.app.store.saveDraft({accountId:'google',body:'Legacy original bytes'}),before=f.app.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(legacy.id)!.data;
    const draft=await create(f),read=await invoke(f.app,'GET','/api/drafts/'+draft.id+'/provider?accountId=google');assert.equal(read.status,200);assert.equal(read.body.providerDraft.ownership,'replica-new');assert.equal(read.body.providerDraft.state,'queued');assert.equal(f.calls.create,0);
    assert.equal((await invoke(f.app,'GET','/api/drafts/'+draft.id+'/provider?accountId=other')).status,404);assert.equal((await invoke(f.app,'GET','/api/drafts/'+draft.id+'/provider?accountId=google&accountId=other')).status,400);
    assert.equal((await invoke(f.app,'GET','/api/drafts/'+legacy.id+'/provider?accountId=google')).body.providerDraft.ownership,'unmanaged');assert.equal(f.app.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(legacy.id)!.data,before);assert.equal(f.calls.create,0);
  }finally{await f.app.close()}
});
test('managed explicit sync uses the durable ledger and PATCH returns current local/provider identity without a legacy sync call',async()=>{
  const f=fixture();try{
    const draft=await create(f);f.app.google.syncDraft=async()=>{throw Error('Legacy cloud sync bypass')};const synced=await invoke(f.app,'POST','/api/drafts/'+draft.id+'/sync',{});assert.equal(synced.status,200);assert.equal(synced.body.providerDraft.state,'synced');assert.equal(f.calls.create,1);
    const edited=await invoke(f.app,'PATCH','/api/drafts/'+draft.id,{body:'Later content'});assert.equal(edited.status,200);assert.equal(edited.body.providerDraft.desiredRevision,edited.body.draft.revision);assert.equal(edited.body.providerDraft.state,'queued');assert.equal(f.calls.update,0);
    await invoke(f.app,'POST','/api/drafts/'+draft.id+'/sync',{});assert.equal(f.calls.update,1);assert.equal(f.app.providerDrafts.status('google',draft.id).state,'synced');
  }finally{await f.app.close()}
});
test('HTTP keyless managed deletion is refused while exact keyed discard and historical receipt complete once',async()=>{
  const f=fixture();try{
    const draft=await create(f);assert.equal((await invoke(f.app,'DELETE','/api/drafts/'+draft.id)).body.error.code,'provider_draft_deletion_requires_action');await f.app.providerDrafts.flush('google',draft.id);
    const status=f.app.providerDrafts.status('google',draft.id),current=f.app.store.required<Draft>('draft',draft.id),request={accountId:'google',clientRequestId:'discard-key',expectedDraftRevision:current.revision,expectedContentHash:status.desiredHash,expectedSyncRevision:status.revision};
    const accepted=await invoke(f.app,'POST','/api/drafts/'+draft.id+'/discard-operations',request);assert.equal(accepted.status,202);await Promise.all([...f.app.providerDrafts.active.values()]);
    const checked=await invoke(f.app,'GET','/api/draft-discard-operations/by-request/discard-key?accountId=google&draftId='+draft.id);assert.equal(checked.status,200);assert.equal(checked.body.resolution,'discarded');assert.equal(checked.body.receipt.id,accepted.body.receipt.id);assert.equal(f.calls.delete,1);
    assert.equal((await invoke(f.app,'POST','/api/drafts/'+draft.id+'/discard-operations',request)).status,200);assert.equal(f.calls.delete,1);assert.equal(f.calls.create,1);
  }finally{await f.app.close()}
});
test('one mapped Send submits immutable replacement raw with stable draft ID and consumes cloud draft without an extra DELETE',async()=>{
  const f=fixture();try{
    const draft=await create(f);await f.app.providerDrafts.flush('google',draft.id);const saved=f.app.store.required<Draft>('draft',draft.id),remoteId=saved.providerDraftId!;let submitted:any;
    f.app.google.request=async(_account,path,init)=>{assert.equal(path,'drafts/send');submitted=JSON.parse(String(init?.body));assert.equal(submitted.id,remoteId);f.remote.delete(remoteId);return{id:'sent-exact'}};
    const operation=f.app.draftSend.submit(draft.id,sendRequest(f,draft.id)).snapshot.operation!;assert.equal(f.app.providerDrafts.status('google',draft.id).state,'suspended');await f.app.draftSend.execute(operation.id,f.app.deliverComposer);
    const parsed=await PostalMime.parse(Buffer.from(submitted.message.raw,'base64url'));assert.equal(parsed.subject,saved.subject);assert.equal(parsed.text?.trim(),saved.body);assert.ok(parsed.html?.includes('fictional'));assert.ok(parsed.headers.some(h=>h.key==='x-reconstruction-delivery-id'));
    assert.equal(f.app.store.required<Draft>('draft',draft.id).status,'sent');assert.equal(f.app.providerDrafts.status('google',draft.id).state,'consumed');assert.equal(f.remote.has(remoteId),false);assert.equal(f.calls.delete,0);assert.equal(f.calls.create,1);await f.app.providerDrafts.flush('google',draft.id);assert.equal(f.calls.create,1);
  }finally{await f.app.close()}
});
test('unknown mapped Send has no messages.send fallback, autosave recreation or automatic second delivery',async()=>{
  const f=fixture();try{
    const draft=await create(f);await f.app.providerDrafts.flush('google',draft.id);let requests=0;f.app.google.request=async(_account,path,init)=>{assert.equal(path,'drafts/send');requests++;const body=JSON.parse(String(init?.body));f.remote.delete(body.id);throw Error('Controlled lost Send ACK')};
    const request=sendRequest(f,draft.id),operation=f.app.draftSend.submit(draft.id,request).snapshot.operation!;await f.app.draftSend.execute(operation.id,f.app.deliverComposer);assert.equal(requests,1);assert.equal(f.app.draftSend.operation('google',operation.id).state,'outcome_unknown');assert.equal(f.app.providerDrafts.status('google',draft.id).state,'suspended');
    assert.equal(f.app.draftSend.submit(draft.id,request).accepted,false);await f.app.draftSend.execute(operation.id,f.app.deliverComposer);await f.app.providerDrafts.flush('google',draft.id);assert.equal(requests,1);assert.equal(f.calls.create,1);assert.equal(f.calls.delete,0);
  }finally{await f.app.close()}
});
test('confirmed Undo restores the same mapped draft and promotes identical content without a cloud PUT or deletion',async()=>{
  const f=fixture(10000);try{
    const draft=await create(f);await f.app.providerDrafts.flush('google',draft.id);const before=f.app.store.required<Draft>('draft',draft.id),op=f.app.draftSend.submit(draft.id,sendRequest(f,draft.id)).snapshot.operation!;
    const undone=f.app.draftSend.cancel(op.id,{accountId:'google',clientRequestId:'undo-cloud',expectedRevision:op.revision});assert.equal(undone.draft!.id,draft.id);assert.equal(undone.draft!.providerDraftId,before.providerDraftId);assert.equal(undone.draft!.body,before.body);assert.equal(undone.draft!.html,before.html);
    const status=f.app.providerDrafts.status('google',draft.id);assert.equal(status.state,'synced');assert.equal(status.desiredRevision,undone.draft!.revision);assert.equal(status.syncedRevision,status.desiredRevision);await f.app.providerDrafts.flush('google',draft.id);assert.equal(f.calls.update,0);assert.equal(f.calls.delete,0);assert.equal(f.sends(),0);
  }finally{await f.app.close()}
});

test('explicit owned-autosave-only constructor mode enables controlled automatic timers while other app jobs remain disabled',async()=>{
  assert.throws(()=>createApp({databasePath:':memory:',env:{DATABASE_PATH:':memory:'},providerDraftAutomatic:'yes' as any}),/must be a boolean/);
  const f=fixture(0,true);try{
    assert.equal(f.timers.size,0);const draft=await create(f);assert.equal(f.calls.create,0);assert.equal(f.timers.size,1);
    for(const callback of [...f.timers]){f.timers.delete(callback);callback()}await Promise.all([...f.app.providerDrafts.active.values()]);assert.equal(f.calls.create,1);assert.equal(f.app.providerDrafts.status('google',draft.id).state,'synced');assert.equal(f.timers.size,0);
  }finally{await f.app.close()}
});
