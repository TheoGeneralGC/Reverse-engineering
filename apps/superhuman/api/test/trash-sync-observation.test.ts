import './archive-network-deny.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.ts';
import {GoogleProvider} from '../src/google.ts';
import {GoogleIngressAdapter,type GoogleHistoryPage} from '../src/google-ingress.ts';
import {AccountIncarnationAuthority} from '../src/account-incarnation.ts';
import {initializeArchiveBasis,verifiedActionBasis} from '../src/archive-action-basis.ts';
import {TrashActionService} from '../src/trash-actions.ts';
import {trashCachedMessages,type TrashNative} from '../src/trash-action-google.ts';
import {OperationQueue} from '../src/operation-queue.ts';
import type {Thread} from '../src/types.ts';

const code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
function fixture(){
 const store=new Store(':memory:',false),authority=new AccountIncarnationAuthority(store);let time=Date.parse('2026-10-30T01:00:00.000Z');
 store.put('account','a',{id:'a',provider:'google',email:'own@example.test',name:'Synthetic',color:'#000'});
 store.put('googleGrant','mail:a',{accountId:'a',service:'mail',requestedScopes:['https://www.googleapis.com/auth/gmail.modify'],grantedScopes:['https://www.googleapis.com/auth/gmail.modify'],scopeSource:'response',outcome:'granted',updatedAt:new Date(time).toISOString()});initializeArchiveBasis(store);
 const raw=(threadId:string,id:string,text:string,labelIds=['INBOX'])=>({id,threadId,internalDate:String(time),snippet:text,labelIds,payload:{mimeType:'text/plain',headers:[{name:'From',value:'Fictional <other@example.test>'},{name:'To',value:'Own <own@example.test>'},{name:'Subject',value:'Fictional '+threadId},{name:'Message-ID',value:`<${id}@example.test>`}],body:{data:Buffer.from(text).toString('base64url'),size:Buffer.byteLength(text)}}});
 const messages=new Map([['t',[raw('t','m-t','Fictional T source.')]],['u',[raw('u','m-u','Fictional U source.')]]]);
 let history:GoogleHistoryPage={historyId:'10',history:[]};const calls:string[]=[];
 const ingress=new GoogleIngressAdapter(store,{accountVersion:()=>authority.version('a'),now:()=>time});
 const google=new GoogleProvider(store,{DATABASE_PATH:':memory:',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',TOKEN_ENCRYPTION_KEY:'1'.repeat(64)},(async(input,init)=>{
  assert.equal((init?.method??'GET').toUpperCase(),'GET','sync cannot issue a provider write');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-access');
  const url=new URL(String(input));assert.equal(url.origin,'https://gmail.googleapis.com');const path=url.pathname.replace('/gmail/v1/users/me/','');calls.push(path);
  if(path==='labels')return json({labels:[]});if(path==='profile')return json({emailAddress:'own@example.test',historyId:'10'});if(path==='threads')return json({threads:[{id:'t'},{id:'u'}],resultSizeEstimate:2});if(path==='history')return json(structuredClone(history));
  if(path==='threads/t'||path==='threads/u'){const threadId=path.split('/')[1]!;return json({id:threadId,messages:structuredClone(messages.get(threadId)!)})}throw Error('Unexpected synthetic route');
 })as typeof fetch,{now:()=>time,sleep:async ms=>{time+=Math.ceil(ms)},random:()=>0},ingress);
 google.saveTokens('a',{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3_600_000,grantedScopes:['https://www.googleapis.com/auth/gmail.modify']});
 let reads=0,modifies=0;const native:TrashNative={async read(input,_profile,guard){guard.check();reads++;const thread=store.required<Thread>('thread',`a:${input.providerThreadId}`);return{providerThreadId:input.providerThreadId,messages:trashCachedMessages(thread),profileEmail:'own@example.test',observedAt:new Date(time).toISOString()}},async modify(_input,guard){guard.check();guard.beforeIssue();modifies++;throw Error('Controlled lost ACK; no native transport')}};
 const trash=new TrashActionService(store,google,new OperationQueue(),{native,now:()=>time});
 return{store,authority,google,ingress,trash,calls,raw,messages,nativeCounts:()=>({reads,modifies}),async prime(){await google.sync('a',{maxPages:1,maxThreadReads:5});await google.sync('a',{maxPages:1,maxThreadReads:5});assert.equal(ingress.readiness('a').ready,true)},setHistory(page:GoogleHistoryPage){history=page},async lock(threadId='t'){const basis=verifiedActionBasis(store,'a:'+threadId,'a')!,key=randomUUID(),result=await trash.trash('a:'+threadId,{version:1,action:'trash',accountId:'a',accountVersion:authority.version('a'),expectedSourceVersion:basis.sourceVersion,clientRequestId:key});assert.equal(result.receipt.state,'unknown');assert.equal(result.receipt.locked,true);assert.deepEqual(result.receipt.native,{mode:'google',issuePossible:true,ackKnown:false,effectVerified:false});return{key,result}},close(){trash.close();ingress.close();store.close()}};
}

test('genuine pending/history sync publishes a locked target then an unrelated thread without clearing unknown ownership',async()=>{
 const f=fixture();try{await f.prime();const lock=await f.lock(),saved=f.store.db.prepare('SELECT * FROM trash_action_operations WHERE request_id=?').get(lock.key),prior=verifiedActionBasis(f.store,'a:t','a')!;
  f.messages.set('t',[f.raw('t','m-t','Fictional T source.',['TRASH']),f.raw('t','m-t-new','Fictional new T fact.',['TRASH'])]);f.messages.set('u',[f.raw('u','m-u','Fictional changed U fact.')]);f.setHistory({historyId:'20',history:[{id:'19',messagesAdded:[{message:{id:'m-t-new',threadId:'t'}},{message:{id:'m-u',threadId:'u'}}]}]});
  const start=f.calls.length,first=await f.google.sync('a',{maxPages:1,maxThreadReads:1});assert.equal(first.partial,true);assert.equal(first.imported,1);assert.deepEqual(f.store.get<{pending:{ids:string[]}}>('sync','a')!.pending.ids,['u']);assert.equal(f.store.required<Thread>('thread','a:t').messages.length,2);assert.notEqual(verifiedActionBasis(f.store,'a:t','a')!.sourceVersion,prior.sourceVersion);assert.equal(f.store.required<Thread>('thread','a:u').messages[0]!.text,'Fictional U source.');
  const second=await f.google.sync('a',{maxPages:1,maxThreadReads:1});assert.equal(second.partial,false);assert.equal(second.imported,1);const sync=f.store.get<{pending?:unknown;historyId:string}>('sync','a')!;assert.equal(sync.pending,undefined);assert.equal(sync.historyId,'20');assert.equal(f.ingress.readiness('a').ready,true);assert.equal(f.store.required<Thread>('thread','a:u').messages[0]!.text,'Fictional changed U fact.');
  assert.deepEqual(f.calls.slice(start),['labels','history','threads/t','labels','threads/u']);assert.deepEqual(f.store.db.prepare('SELECT * FROM trash_action_operations WHERE request_id=?').get(lock.key),saved,'provider observation does not edit, settle or normalize the unknown ledger');const current=f.trash.get('a:t','a',f.authority.version('a'),lock.key);assert.equal(current.receipt.state,'unknown');assert.equal(current.receipt.locked,true);assert.deepEqual(f.nativeCounts(),{reads:1,modifies:1});assert.throws(()=>f.store.saveDraft({accountId:'a',threadId:'a:t',body:'Fictional new draft'}),code('ordinary_action_locked'));
 }finally{f.close()}
});

test('an exact observation permit is consumed before callbacks and cannot authorize another locked target or later reuse',async()=>{
 const f=fixture();try{await f.prime();await f.lock('t');await f.lock('u');const oldT=f.store.required<Thread>('thread','a:t'),oldU=f.store.required<Thread>('thread','a:u'),nextT={...oldT,folder:'inbox' as const},nextU={...oldU,folder:'inbox' as const},producer=f.store.ordinaryActions.registerObservationProducer(),permit=producer.publish(nextT);let callbacks=0;
  const observer=f.store.registerReminderLifecycle({threadWritten(_before,next){if(next.id!=='a:t')return;callbacks++;assert.throws(()=>f.store.put('thread','a:u',nextU,permit),code('ordinary_action_locked'))}});
  try{f.store.put('thread','a:t',nextT,permit);assert.equal(callbacks,1);assert.equal(f.store.required<Thread>('thread','a:t').folder,'inbox');assert.deepEqual(f.store.required<Thread>('thread','a:u'),oldU);assert.throws(()=>f.store.put('thread','a:t',{...nextT,folder:'done'},permit),code('ordinary_action_locked'));assert.equal(f.store.required<Thread>('thread','a:t').folder,'inbox')}finally{observer.close()}
  assert.deepEqual(f.nativeCounts(),{reads:2,modifies:2});
 }finally{f.close()}
});
