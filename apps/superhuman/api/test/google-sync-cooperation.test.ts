import './archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { GoogleIngressAdapter } from '../src/google-ingress.ts';
import type { Account, Thread } from '../src/types.ts';
import type { SqlDatabaseFactory } from '../src/sql-database.ts';
const denial = (globalThis as typeof globalThis & { [key:symbol]:{attempts:number} })[Symbol.for('rea.generated-cloud.network-denied')];
after(()=>assert.equal(denial.attempts,0));
const account:Account={id:'google:fixture',provider:'google',email:'self@example.test',name:'Fictional',color:'#000'},H='a'.repeat(64);
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve}};
function fixture(factory?:SqlDatabaseFactory){
 const store=new Store(':memory:',false,factory?{databaseFactory:factory}:{});store.put('account',account.id,account);let now=1793390000000;
 const ingress=new GoogleIngressAdapter(store,{accountVersion:()=>H,now:()=>now});
 const provider=new GoogleProvider(store,{DATABASE_PATH:':memory:'},async()=>{throw Error('Native provider forbidden')},{now:()=>now,sleep:async()=>{},random:()=>0},ingress),calls:string[]=[];
 const message={id:'m1',threadId:'t1',internalDate:String(now-1000),snippet:'Fictional',labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'Sender <sender@example.test>'},{name:'To',value:'Self <self@example.test>'},{name:'Subject',value:'Fictional'}],body:{data:Buffer.from('Fictional question').toString('base64url')}}};
 provider.request=async(_id,path)=>{calls.push(path);if(path==='labels')return{labels:[{id:'one',name:'One',type:'user'},{id:'system',name:'System',type:'system'},{id:'two',name:'Two',type:'user'}]};if(path==='profile')return{historyId:'10'};if(path.startsWith('threads?'))return{threads:[{id:'t1'}]};if(path.startsWith('history?'))return{historyId:'12',history:[{id:'11',messagesAdded:[{message:{id:'m1',threadId:'t1'}}]}]};if(path==='threads/t1?format=full')return{id:'t1',messages:[message]};throw Error('Unexpected fake route')};
 return{store,ingress,provider,calls,advance(ms:number){now+=ms},close(){ingress.close();store.close()}};
}
test('default real event-loop turns occur only after committed label and main-thread checkpoint groups',async()=>{
 const f=fixture();let labelTurns=0,checkpointTurn=false,put=f.store.put.bind(f.store);
 f.store.put=((kind:string,id:string,value:unknown)=>{const result=put(kind,id,value);if(kind==='label'){const expected=++labelTurns;void setImmediate().then(()=>{assert.equal(f.store.db.isTransaction,false);assert.equal(f.store.list('label').length,expected)})}if(kind==='sync'&&(value as {pending?:{ids:string[]}}).pending?.ids.length===0){void setImmediate().then(()=>{assert.equal(f.store.db.isTransaction,false);const state=f.store.get<{pending?:{ids:string[]}}>('sync',account.id);assert.deepEqual(state?.pending?.ids,[]);assert.equal(f.store.required<Thread>('thread',account.id+':t1').messages.length,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM split_header_people').get()!.n,2);checkpointTurn=true})}return result})as typeof f.store.put;
 try{await f.provider.sync(account.id,{maxPages:1,pageSize:1});await setImmediate();assert.equal(labelTurns,2);assert.equal(checkpointTurn,true);assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')}finally{f.close()}
});
test('initial catchup yields after its existing committed pending-ID checkpoint without positive live occurrence',async()=>{
 const f=fixture();let seen=false;const put=f.store.put.bind(f.store);
 f.store.put('sync',account.id,{phase:'initial',historyId:'10',generation:'fixture-generation',partial:true,pageToken:'remaining'});
 f.store.put=((kind:string,id:string,value:unknown)=>{const result=put(kind,id,value);if(kind==='sync'&&(value as {catchup?:{pending?:{ids:string[]}}}).catchup?.pending?.ids.length===0){void setImmediate().then(()=>{assert.equal(f.store.db.isTransaction,false);assert.deepEqual(f.store.get<{catchup:{pending:{ids:string[]}}}>('sync',account.id)!.catchup.pending.ids,[]);seen=true})}return result})as typeof f.store.put;
 try{await f.provider.sync(account.id,{maxPages:1,pageSize:1,maxThreadReads:1,catchupDuringInitial:true});await setImmediate();assert(seen);assert.equal(f.store.db.prepare('SELECT count(*) n FROM google_ingress_occurrences').get()!.n,0)}finally{f.close()}
});
test('resuming a paused committed label traverses original owner guard before native SQL or another provider issue',async()=>{
 let live=true,nativeCalls=0;const lost=new Error('Controlled original owner fence'),check=()=>{if(!live)throw lost;nativeCalls++};
 const factory:SqlDatabaseFactory=path=>{assert.equal(path,':memory:');const db=new DatabaseSync(path);return{get isTransaction(){return db.isTransaction},exec(text){check();db.exec(text)},prepare(text){check();const q=db.prepare(text);return{get(...args){check();return q.get(...args)},all(...args){check();return q.all(...args)},run(...args){check();return q.run(...args)}}},close(){db.close()}}};
 const f=fixture(factory),paused=deferred(),release=deferred();let waits=0;
 f.provider.timing.yieldSync=async()=>{assert.equal(f.store.db.isTransaction,false);if(++waits===1){paused.resolve();await release.promise}else await setImmediate()};
 try{const sync=f.provider.sync(account.id);void sync.catch(()=>{});await paused.promise;assert.equal(f.store.list('label').length,1);const before=nativeCalls;live=false;release.resolve();await assert.rejects(sync,error=>error===lost);assert.equal(nativeCalls,before);assert.deepEqual(f.calls,['labels']);assert.equal(waits,1)}finally{release.resolve();/* Lost ownership cannot run ingress metadata cleanup. Close only our native handle. */f.store.close()}
});
test('same existing ingress expiry after a paused commit refuses continuation without lease renewal or another read',async()=>{
 const f=fixture(),paused=deferred(),release=deferred();let waits=0;
 f.provider.timing.yieldSync=async()=>{if(++waits===1){assert.equal(f.store.db.isTransaction,false);paused.resolve();await release.promise}};
 try{const sync=f.provider.sync(account.id);void sync.catch(()=>{});await paused.promise;f.advance(120001);release.resolve();await assert.rejects(sync,error=>(error as {code?:string}).code==='google_ingress_stale');assert.deepEqual(f.calls,['labels']);assert.equal(f.store.list('label').length,1);assert.equal(f.store.db.prepare('SELECT lease_id FROM google_ingress_meta').get()!.lease_id,null)}finally{release.resolve();f.close()}
});
