import test from 'node:test';import assert from 'node:assert/strict';
import { createAsyncCollector } from '../src/collector.ts';import type { CollectorDatabase } from '../src/database.ts';
import { signedHeaders,sha256 } from '../../collector/src/protocol.ts';import { memoryDatabase,deferred } from './helpers.ts';
const base=Date.parse('2026-10-29T09:00:00Z'),key=Buffer.alloc(32,17),tenant='a'.repeat(64),account='b'.repeat(64),reg='c'.repeat(32),token=Buffer.alloc(32,19).toString('base64url');
function fixture(){const backend=memoryDatabase(),underlying=backend.client();let now=base,count=0,blockAt=Infinity,entered=deferred(),release=deferred();
 const database:CollectorDatabase={...underlying,async primaryTransaction(work,alive){count++;if(count===blockAt){entered.resolve();await release.promise}return underlying.primaryTransaction(work,alive)}};
 const options={signers:new Map([['main',{tenant,key}]]),cursorKey:Buffer.alloc(32,18),now:()=>now},service=createAsyncCollector({...options,database});
 const body={operationId:'d'.repeat(32),registrationId:reg,accountRef:account,deliveryRef:'e'.repeat(64),tokenDigest:sha256(token),state:'prepared',expectedRevision:0};
 const send=(method:string,target:string,payload?:unknown)=>{const b=payload===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(payload));return service.handle({method,target,body:b,headers:signedHeaders(key,'main',method,target,b,now)})};
 return{...backend,service,options,body,send,set:(v:number)=>now=v,hold(n=1){entered=deferred();release=deferred();blockAt=count+n;return{entered:entered.promise,release:release.resolve}},finish(){release.resolve();service.close();backend.close()}};
}
test('queued older pixel samples its unit clock after acquisition, so two monotonic observations both persist',async()=>{
 const f=fixture(),other=createAsyncCollector({...f.options,database:f.client()});try{assert.equal((await f.send('POST','/v1/registrations',f.body)).status,200);assert.equal((await f.send('POST','/v1/registrations/'+reg,{operationId:'1'.repeat(32),expectedRevision:1,state:'armed',acknowledgementRef:null})).status,200);const hold=f.hold(),pixel={method:'GET',target:'/p/'+token+'.gif',headers:{}};const old=f.service.handle(pixel);await hold.entered;f.set(base+1);assert.equal((await other.handle(pixel)).status,200);hold.release();assert.equal((await old).status,200);assert.deepEqual(f.db.prepare('SELECT sequence,observed_at FROM tracking_events ORDER BY sequence').all().map(r=>[r.sequence,r.observed_at]),[[1,base+1],[2,base+1]])}finally{other.close();f.finish()}
});
test('auth signature fresh at arrival but expired before acquired unit refuses401 with no nonce/write',async()=>{
 const f=fixture();try{const hold=f.hold(),work=f.send('GET','/v1/events?accountRef='+account);await hold.entered;f.set(base+300001);hold.release();const result=await work;assert.equal(result.status,401);assert.equal(JSON.parse(result.body.toString()).error.code,'unauthorized');assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM tracking_meta WHERE key='clock_high_watermark'").get()!.n,0)}finally{f.finish()}
});
test('signature expiry between nonce acceptance and queued save also refuses, preserving only accepted nonce unit',async()=>{
 const f=fixture();try{const hold=f.hold(2),work=f.send('POST','/v1/registrations',f.body);await hold.entered;f.set(base+300001);hold.release();assert.equal((await work).status,401);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_registrations').get()!.n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,0)}finally{f.finish()}
});
test('queued save derives its accepted timestamps from acquired unit and real rollback before read remains503',async()=>{
 const f=fixture();try{const hold=f.hold(2),work=f.send('POST','/v1/registrations',f.body);await hold.entered;f.set(base+10);hold.release();const result=await work;assert.equal(result.status,200);const accepted=JSON.parse(result.body.toString());assert.equal(accepted.receipt.acceptedAt,base+10);assert.equal(accepted.registration.createdAt,base+10);assert.equal(accepted.registration.updatedAt,base+10);f.set(base);const read=await f.send('GET','/v1/requests/'+f.body.operationId);assert.equal(read.status,503);assert.equal(JSON.parse(read.body.toString()).error.code,'collector_clock_rollback');assert.equal(f.db.prepare('SELECT accepted_at FROM tracking_requests').get()!.accepted_at,base+10)}finally{f.finish()}
});
test('real clock rollback after awaited unit writes fences COMMIT and rolls back its full publication',async()=>{
 const f=fixture();try{f.before(sql=>{if(sql.startsWith('INSERT INTO tracking_requests'))f.set(base-1)});assert.equal((await f.send('POST','/v1/registrations',f.body)).status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_registrations').get()!.n,0)}finally{f.finish()}
});
