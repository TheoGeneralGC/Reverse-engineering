import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError,api } from '../src/api.ts';
import type { AccountSync } from '../src/api.ts';
import { createSyncMonitor,describeSync } from '../src/sync-state.ts';

test('checking, initial import, partial history and errors cannot be presented as a completed empty mailbox',()=>{
 for(const sync of [null,{phase:'not-started',partial:true,status:'idle'},{phase:'initial',partial:true,status:'running'},{phase:'history',partial:true,status:'ready'},{phase:'history',partial:false,status:'error',error:'Sync failed'}] as (AccountSync|null)[]){
  const state=describeSync(sync);assert.ok(state?.incomplete);assert.ok(!state.title.includes('done'));
 }
 assert.equal(describeSync({phase:'history',partial:false,status:'ready',lastCompletedAt:'2026-10-27T12:00:00Z'}),null);
});

test('Gmail throttling offers retry without incorrectly asking the user to reconnect',()=>{
 const state=describeSync({phase:'initial',partial:true,status:'error',code:'google_rate_limited',error:'Gmail is limiting requests. Try again later.',nextSyncAt:'2026-10-27T12:01:00Z'},Date.parse('2026-10-27T12:00:00Z'));
 assert.equal(state?.action,'retry');assert.match(state?.title||'',/temporarily paused/);assert.match(state?.description||'',/Next attempt/);
 const reconnect=describeSync({phase:'history',partial:false,status:'error',code:'reconnect_required'});
 assert.equal(reconnect?.action,'reconnect');assert.equal(reconnect?.actionLabel,'Reconnect Gmail');
 assert.equal(describeSync({phase:'history',partial:false,status:'error',code:'google_permission_denied',requiresReconnect:true})?.action,'reconnect');
});

test('routine background refresh keeps a previously complete mailbox available without an import notice',()=>{
 for(const status of ['queued','running'] as const){
  assert.equal(describeSync({phase:'history',partial:false,status,lastCompletedAt:'2026-10-27T12:00:00Z'}),null);
  assert.ok(describeSync({phase:'history',partial:true,status,lastCompletedAt:'2026-10-27T12:00:00Z'})?.incomplete);
 }
});

test('partially imported but idle accounts offer continuation rather than a successful empty result',()=>{
 const state=describeSync({phase:'history',partial:true,status:'ready'});
 assert.equal(state?.incomplete,true);assert.equal(state?.actionLabel,'Continue sync');
 const notStarted=describeSync({phase:'not-started',partial:true,status:'idle'});
 assert.equal(notStarted?.actionLabel,'Start sync');
});

test('a stopped account monitor discards its late response instead of replacing another account status',async()=>{
 let resolveRead!:(sync:AccountSync)=>void;let publications=0;let scheduled=0;
 const monitor=createSyncMonitor({read:()=>new Promise(resolve=>{resolveRead=resolve}),onStatus:()=>publications++,schedule:()=>{scheduled++;return()=>{}}});
 const check=monitor.check();monitor.stop();resolveRead({phase:'initial',partial:true,status:'error',error:'Old account'});await check;
 assert.equal(publications,0);assert.equal(scheduled,0);
});

test('newer status responses win when a retry check overlaps an earlier poll',async()=>{
 const readers:((sync:AccountSync)=>void)[]=[];const publications:AccountSync[]=[];let changed=0;
 const monitor=createSyncMonitor({read:()=>new Promise(resolve=>readers.push(resolve)),onStatus:sync=>publications.push(sync),onChange:()=>changed++,schedule:()=>()=>{}});
 const first=monitor.check(),second=monitor.check();
 readers[1]({phase:'history',partial:false,status:'ready'});await second;
 readers[0]({phase:'initial',partial:true,status:'error',error:'Stale error'});await first;
 assert.deepEqual(publications,[{phase:'history',partial:false,status:'ready'}]);assert.equal(changed,1);monitor.stop();
});

test('read-only polling retains explicit sync failures and recovers when the next GET succeeds',async()=>{
 const publications:AccountSync[]=[];let count=0;let scheduled:(()=>void)|undefined;
 const monitor=createSyncMonitor({read:async()=>{count++;if(count===1)throw new Error('Network unavailable');return{phase:'history',partial:false,status:'ready'}},onStatus:sync=>publications.push(sync),schedule:callback=>{scheduled=callback;return()=>{}}});
 await monitor.check();assert.equal(publications[0].status,'error');assert.equal(publications[0].code,'sync_status_unavailable');assert.ok(describeSync(publications[0])?.incomplete);assert.ok(scheduled);
 await monitor.check();assert.equal(publications[1].status,'ready');assert.equal(describeSync(publications[1]),null);monitor.stop();
});

test('status requests use GET and structured API error codes survive transport handling',async()=>{
 const original=globalThis.fetch;const calls:{url:string;method:string}[]=[];
 globalThis.fetch=(async(url,options)=>{calls.push({url:String(url),method:options?.method||'GET'});return new Response(JSON.stringify({error:{code:'google_rate_limited',message:'Gmail is limiting requests'}}),{status:429,headers:{'content-type':'application/json'}})}) as typeof fetch;
 try{await assert.rejects(()=>api('/accounts/google%3Ademo/sync'),error=>error instanceof ApiError&&error.code==='google_rate_limited'&&error.status===429);assert.deepEqual(calls,[{url:'/api/accounts/google%3Ademo/sync',method:'GET'}]);}
 finally{globalThis.fetch=original}
});
