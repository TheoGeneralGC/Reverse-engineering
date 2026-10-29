import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../src/store.ts';
import {AutoDraftsV2Authority} from '../src/auto-drafts-v2-authority.ts';
import {AutoDraftModelAdapter} from '../src/auto-drafts-model.ts';
import {SEND_AS_READ_PATH} from '../src/google-send-as-cache.ts';
import {GMAIL_SCOPE} from '../src/google-scopes.ts';
import {parseEngineStatus} from '../src/auto-drafts-generation-contract.ts';
const T=Date.parse('2026-10-29T22:00:00.000Z');
const account={id:'a',provider:'google' as const,email:'self@example.test',name:'Synthetic',color:'#000'};
const grant={accountId:'a',service:'mail',requestedScopes:[GMAIL_SCOPE],grantedScopes:[GMAIL_SCOPE],scopeSource:'response',outcome:'granted',updatedAt:new Date(T).toISOString()};
const profile={provider:'anthropic',model:'synthetic',credentialAvailable:true};
const digest=async(text:string)=>createHash('sha256').update(text).digest('hex');
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}};
async function until(predicate:()=>boolean){for(let i=0;i<1000&&!predicate();i++)await Promise.resolve();assert.equal(predicate(),true)}
function fixture(processing=true){
 const store=new Store(':memory:',false);store.put('account','a',account);store.put('googleGrant','mail:a',grant);
 let now=T,sequence=0,native=0,modelCalls=0,heldLabels:Promise<void>|null=null,labelsWaiting=false;
 const paths:string[]=[];
 const model=new AutoDraftModelAdapter({credential:async()=> 'synthetic-only',fetcher:async(_url,options)=>{modelCalls++;assert.equal(store.db.isTransaction,false);const context=JSON.parse(JSON.parse(String(options?.body)).messages[0].content);return new Response(JSON.stringify({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({kind:'draft',plainText:'Fictional response.',sourceRefs:[context.messages.at(-1).ref]})}]}))}});
 const system=new AutoDraftsV2Authority(store,{processing,model,cursorKey:new Uint8Array(32).fill(7),googleEnvironment:{DATABASE_PATH:':memory:'},maximumIdentityAgeMs:60000,now:()=>now,schedule:()=>({cancel(){}}),googleFetch:async(url,options)=>{
  native++;assert.equal(store.db.isTransaction,false);assert.equal((options?.method??'GET'),'GET');const u=String(url),prefix='https://gmail.googleapis.com/gmail/v1/users/me/';assert.equal(u.startsWith(prefix),true);const path=u.slice(prefix.length);paths.push(path);now+=1000;
  let data:unknown;
  if(path===SEND_AS_READ_PATH){assert.ok(options?.signal instanceof AbortSignal);assert.equal('beforeIssue' in options!,false);data={sendAs:[{sendAsEmail:account.email,isPrimary:true}]}}
  else if(path==='labels'){if(heldLabels){labelsWaiting=true;await heldLabels}data={labels:[]}}
  else if(path==='profile')data={historyId:'10'};
  else if(path.startsWith('threads?'))data={threads:[]};
  else if(path.startsWith('history?')){const start=new URLSearchParams(path.split('?')[1]).get('startHistoryId');data=sequence&&Number(start)<10+sequence*2?{historyId:String(10+sequence*2),history:[{id:String(9+sequence*2),messagesAdded:[{message:{id:'m'+sequence,threadId:'t1'}}]}]}:{historyId:String(10+sequence*2),history:[]}}
  else if(path==='threads/t1?format=full')data={id:'t1',messages:[{id:'m'+sequence,threadId:'t1',internalDate:String(now-1000),labelIds:['INBOX'],snippet:'Fictional question',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Sender <sender@example.test>'},{name:'To',value:'Self <self@example.test>'},{name:'Subject',value:'Fictional question'},{name:'Message-ID',value:`<m${sequence}@example.test>`}],body:{data:Buffer.from('Fictional question').toString('base64url')}}}]};
  else throw Error('Unexpected own fake Google path');return new Response(JSON.stringify(data));
 }});
 let token:()=>Promise<unknown>=async()=>({access_token:'synthetic-only',expires_at:now+600000});let tokenCalls=0;
 (system.facade.runtime.google as unknown as{tokens:()=>Promise<unknown>}).tokens=()=>{tokenCalls++;return token()};
 return{store,system,paths,calls:()=>({native,modelCalls,tokenCalls}),now:()=>now,advance(ms:number){now+=ms},token(value:()=>Promise<unknown>){token=value},incoming(){sequence++;now++},holdLabels(value:Promise<void>|null){heldLabels=value;labelsWaiting=false},waiting:()=>labelsWaiting,
  async request(method:string,path:string,body?:unknown){const r=await system.handle(new Request('http://127.0.0.1:3001'+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:r.status,body:await r.json() as any}},
  async setup(){system.adoptAccounts();await system.install('a')},async ready(){await system.observeModelProfile('a',profile);await system.refreshIdentity('a');await system.sync('a')},
  async on(){return this.request('PATCH','/api/auto-drafts/v2/preferences',{accountId:'a',clientRequestId:randomUUID(),section:'preferences',expectedRevision:0,change:{field:'responsesEnabled',value:true}})},
  close(){system.close();store.close()}};
}
const changes=(s:Store)=>s.db.prepare('SELECT total_changes() AS n').get()!.n;

test('authority composition constructor is inert and default processing stays OFF with local read-only status',async()=>{
 const f=fixture(false);try{assert.deepEqual(f.calls(),{native:0,modelCalls:0,tokenCalls:0});assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auto_draft_ready_accounts').get()!.n,0);await f.setup();await f.system.observeModelProfile('a',profile);assert.equal(f.system.authority.configuration('a'),null);const before=changes(f.store),calls=f.calls();const r=await f.request('GET','/api/auto-drafts/v2/status?accountId=a');assert.equal(r.status,200);assert.equal((await parseEngineStatus(r.body,'a',digest)).effective.responses,false);assert.equal(changes(f.store),before);assert.deepEqual(f.calls(),calls);assert.equal(f.store.list('draft').length,0)}finally{f.close()}
});

test('direct ON waits for actual profile/identity/baseline then one later ingress publishes a local draft using one Google instance',async()=>{
 const f=fixture();try{await f.setup();assert.equal((await f.on()).status,200);let status=(await f.request('GET','/api/auto-drafts/v2/status?accountId=a')).body;assert.equal(status.engine.activation.status,'pending');assert.equal(status.effective.responses,false);assert.equal(f.calls().native,0);await f.ready();const ready=(await f.request('GET','/api/auto-drafts/v2/status?accountId=a')).body;await parseEngineStatus(ready,'a',digest,status);assert.equal(ready.effective.responses,true);assert.equal(f.paths.filter(x=>x===SEND_AS_READ_PATH).length,1);assert.equal(f.calls().modelCalls,0);f.incoming();const r=await f.system.sync('a');assert.equal(r.admitted.length,1);const job=await f.system.run('a',r.admitted[0]);assert.equal(job.state,'published');assert.equal(f.calls().modelCalls,1);assert.equal(f.store.list('draft').length,1);assert.equal(f.paths.some(p=>p.startsWith('drafts')||p.startsWith('messages/send')),false);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM secrets').get()!.n,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auto_draft_runtime_epochs').get()!.n,0)}finally{f.close()}
});

test('normal held empty read advances truthful status without changing activation or authority eligibility',async()=>{
 const f=fixture();try{await f.setup();await f.ready();await f.on();const before=(await f.request('GET','/api/auto-drafts/v2/status?accountId=a')).body,epoch=f.system.authority.readiness('a').configurationEpoch,event=f.system.authority.latestEvent('a'),hold=deferred<void>();f.holdLabels(hold.promise);const pending=f.system.sync('a');await until(f.waiting);await until(()=>f.store.db.prepare('SELECT sequence FROM auto_draft_v2_status_commits ORDER BY sequence DESC LIMIT 1').get()?.sequence===f.store.db.prepare('SELECT sequence FROM auto_draft_v2_projection_counters WHERE account_id=?').get('a')?.sequence);const during=(await f.request('GET','/api/auto-drafts/v2/status?accountId=a')).body;assert.equal(during.readiness.responseGeneration,'ingress-not-ready');assert.equal(during.effective.responses,false);await parseEngineStatus(during,'a',digest,before);hold.resolve();await pending;f.holdLabels(null);const after=(await f.request('GET','/api/auto-drafts/v2/status?accountId=a')).body;await parseEngineStatus(after,'a',digest,during);assert.equal(after.effective.responses,true);assert.deepEqual(after.engine.activation,before.engine.activation);assert.equal(f.system.authority.readiness('a').configurationEpoch,epoch);assert.equal(f.system.authority.latestEvent('a'),event);assert.equal(f.calls().modelCalls,0)}finally{f.close()}
});

test('durable grant revocation makes GET refuse stale head without repair before explicit observation',async()=>{
 const f=fixture();try{await f.setup();await f.ready();await f.on();f.store.remove('googleGrant','mail:a');const before=changes(f.store),calls=f.calls();const stale=await f.request('GET','/api/auto-drafts/v2/status?accountId=a');assert.equal(stale.status,503);assert.equal(changes(f.store),before);assert.deepEqual(f.calls(),calls);await f.system.settle('a');const current=(await f.request('GET','/api/auto-drafts/v2/status?accountId=a')).body;assert.equal(current.effective.responses,false);assert.equal(current.readiness.responseGeneration,'identity-incomplete');assert.equal(current.engine.activation.status,'pending')}finally{f.close()}
});

test('observed identity expiry and identical renewal establish a fresh forward barrier without a second Activate',async()=>{
 const f=fixture();try{await f.setup();await f.ready();await f.on();const before=f.system.facade.runtime.worker.activation('a')!;f.advance(60001);await f.system.settle('a');const pending=f.system.facade.runtime.worker.activation('a')!;assert.equal(pending.status,'pending');await f.system.refreshIdentity('a');const after=f.system.facade.runtime.worker.activation('a')!;assert.equal(after.status,'active');assert.notEqual(after.id,before.id);assert(Date.parse(after.barrier!.internalDateAfter)>Date.parse(before.barrier!.internalDateAfter));assert.equal(f.calls().modelCalls,0)}finally{f.close()}
});

test('matched cache close after held actual Google credential preparation issues zero native reads',async()=>{
 const f=fixture();try{await f.setup();const hold=deferred<unknown>();f.token(()=>hold.promise);const pending=f.system.refreshIdentity('a');await until(()=>f.calls().tokenCalls===1);f.system.close();hold.resolve({access_token:'synthetic-only',expires_at:f.now()+600000});await assert.rejects(pending);assert.equal(f.calls().native,0);assert.equal(f.calls().modelCalls,0);assert.equal(f.system.authority.identity('a').state,'unavailable')}finally{f.close()}
});

test('closing after shared preference digest starts refuses both changed and no-op acceptance with no receipt writes',async()=>{
 for(const value of [false,true]){const f=fixture();try{await f.setup();const pending=f.system.facade.savePreferences({accountId:'a',clientRequestId:randomUUID(),section:'preferences',expectedRevision:0,change:{field:'responsesEnabled',value}});f.system.close();const before=changes(f.store);await assert.rejects(pending,(e:unknown)=>(e as{code?:string}).code==='auto_draft_generation_stopping');assert.equal(changes(f.store),before);assert.equal(f.system.facade.settings.get('a').preferences.value.responsesEnabled,false);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auto_drafts_v2_requests').get()!.n,0)}finally{f.close()}}
});

test('leased sync close after pacing or retry backoff cannot issue a later native read',async()=>{
 for(const mode of ['pace','backoff']){const f=fixture(),hold=deferred<void>();let sleeps=0,calls=0;try{await f.setup();const google=f.system.facade.runtime.google;google.timing.sleep=async()=>{sleeps++;await hold.promise};if(mode==='pace')google.readStarts.set('a',f.now()+1000);const original=google.fetcher;google.fetcher=async(url,options)=>{calls++;return mode==='backoff'?new Response('{}',{status:503}):original(url,options)};const pending=f.system.sync('a');await until(()=>sleeps===1);assert.equal(calls,mode==='pace'?0:1);f.system.close();hold.resolve();await assert.rejects(pending);assert.equal(calls,mode==='pace'?0:1);assert.equal(f.calls().modelCalls,0)}finally{hold.resolve();f.close()}}
});
