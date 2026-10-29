import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.ts';
import {GoogleProvider} from '../src/google.ts';
import {GoogleIngressAdapter} from '../src/google-ingress.ts';
import {AutoDraftReadinessAuthority} from '../src/auto-drafts-readiness.ts';
import {GoogleSendAsCache,SEND_AS_READ_PATH} from '../src/google-send-as-cache.ts';
const time=Date.parse('2026-10-29T22:00:00.000Z');
const account={id:'a',provider:'google' as const,email:'self@example.test',name:'Synthetic',color:'#000'};
const grant={accountId:'a',service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify'],requestedScopes:['https://www.googleapis.com/auth/gmail.modify'],scopeSource:'response',outcome:'granted',updatedAt:new Date(time).toISOString()};
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}};
async function until(predicate:()=>boolean){for(let i=0;i<100&&!predicate();i++)await Promise.resolve();assert.equal(predicate(),true)}
function fixture(fetcher:typeof fetch,sleep:(ms:number)=>Promise<void>=async()=>{}){
 const store=new Store(':memory:',false);store.put('account','a',account);store.put('googleGrant','mail:a',grant);let ingress!:GoogleIngressAdapter;
 const authority=new AutoDraftReadinessAuthority(store,{ingress:id=>ingress.readiness(id),now:()=>time});ingress=new GoogleIngressAdapter(store,{accountVersion:authority.accountVersion,now:()=>time});authority.adoptAccounts();
 const google=new GoogleProvider(store,{DATABASE_PATH:':memory:'},fetcher,{now:()=>time,sleep,random:()=>0});let tokenCalls=0;let token:()=>Promise<unknown>=async()=>({access_token:'synthetic-only',expires_at:time+100000});
 (google as unknown as{tokens:()=>Promise<unknown>}).tokens=()=>{tokenCalls++;return token()};
 const cache=new GoogleSendAsCache(authority,{read:(id,path,options)=>google.request(id,path,options,undefined,{signal:options.signal,beforeIssue:options.beforeIssue})});
 return{store,google,cache,authority,token(fn:()=>Promise<unknown>){token=fn},tokenCalls:()=>tokenCalls,close(){cache.close();ingress.close();store.close()}};
}
const response=()=>new Response(JSON.stringify({sendAs:[{sendAsEmail:account.email,isPrimary:true}]}));

test('cache lease and current grant fence the actual native GET after credential preparation',async()=>{
 for(const mode of ['close','grant-ABA']){let calls=0;const f=fixture(async()=>{calls++;return response()}),held=deferred<unknown>();try{f.token(()=>held.promise);const pending=f.cache.refresh('a');await until(()=>f.tokenCalls()===1);if(mode==='close')f.cache.close();else{f.store.remove('googleGrant','mail:a');f.store.put('googleGrant','mail:a',grant)}held.resolve({access_token:'synthetic-only',expires_at:time+100000});await assert.rejects(pending);assert.equal(calls,0);assert.equal(f.authority.identity('a').state,'unavailable')}finally{f.close()}}
});

test('cache close during actual pacing or retry backoff cannot issue a later native GET',async()=>{
 for(const mode of ['pace','backoff']){let calls=0,sleeps=0;const held=deferred<void>(),f=fixture(async()=>{calls++;return new Response('{}',{status:503})},async()=>{sleeps++;await held.promise});try{if(mode==='pace')f.google.readStarts.set('a',time+1000);const pending=f.cache.refresh('a');await until(()=>sleeps===1);assert.equal(calls,mode==='pace'?0:1);f.cache.close();held.resolve();await assert.rejects(pending);assert.equal(calls,mode==='pace'?0:1)}finally{f.close()}}
});

test('guarded request composes caller abort, never retries aborted work, and limits its request family before tokens',async()=>{
 let calls=0,sleeps=0;const abort=new AbortController(),f=fixture(async(_url,options)=>{calls++;assert.equal(options?.signal?.aborted,false);abort.abort(new Error('Own abort'));assert.equal(options?.signal?.aborted,true);throw Error('Own failed request')},async()=>{sleeps++});try{await assert.rejects(f.google.request('a',SEND_AS_READ_PATH,{method:'GET',signal:abort.signal},undefined,{signal:abort.signal,beforeIssue(){}}));assert.equal(calls,1);assert.equal(sleeps,0);const before=f.tokenCalls();for(const args of [{path:'settings/sendAs',options:{method:'GET'}},{path:SEND_AS_READ_PATH,options:{method:'POST'}},{path:SEND_AS_READ_PATH,options:{method:'GET',body:'forbidden'}}])await assert.rejects(f.google.request('a',args.path,args.options,undefined,{signal:new AbortController().signal,beforeIssue(){}}));await assert.rejects(f.google.request('a',SEND_AS_READ_PATH,{},()=>{}, {signal:new AbortController().signal,beforeIssue(){}}));assert.equal(f.tokenCalls(),before);assert.equal(calls,1)}finally{f.close()}
});

test('valid guarded cache refresh uses the exact authenticated GET and accepts its verified identity',async()=>{
 let calls=0;const f=fixture(async(url,options)=>{calls++;assert.equal(url,`https://gmail.googleapis.com/gmail/v1/users/me/${SEND_AS_READ_PATH}`);assert.equal(options?.method,'GET');assert.ok(options?.signal instanceof AbortSignal);assert.equal(options?.signal?.aborted,false);assert.equal((options?.headers as Record<string,string>).authorization,'Bearer synthetic-only');assert.equal('beforeIssue' in options!,false);return response()});try{assert.equal((await f.cache.refresh('a')).state,'complete');assert.equal(calls,1);assert.equal(f.authority.identity('a').state,'complete');assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM secrets').get()!.n,0)}finally{f.close()}
});
