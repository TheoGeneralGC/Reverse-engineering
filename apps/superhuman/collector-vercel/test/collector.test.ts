import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollector } from '../../collector/src/collector.ts';
import { sha256,signedHeaders,type CollectorError } from '../../collector/src/protocol.ts';
import { createAsyncCollector,type Input,type Output } from '../src/collector.ts';
import { memoryDatabase,deferred } from './helpers.ts';
const now=Date.parse('2026-10-29T09:00:00.000Z'),key=Buffer.alloc(32,17),cursor=Buffer.alloc(32,18),tenant='a'.repeat(64),account='b'.repeat(64),reg='c'.repeat(32),op='d'.repeat(32),delivery='e'.repeat(64),ack='f'.repeat(64),token=Buffer.alloc(32,19).toString('base64url');
const parse=(r:Output)=>JSON.parse(r.body.toString());
function fixture(limits={}){const backend=memoryDatabase();let clock=now;const options={signers:new Map([['main',{tenant,key}]]),cursorKey:cursor,now:()=>clock,...limits};const service=createAsyncCollector({...options,database:backend.client()});return{...backend,service,options,advance:(ms:number)=>clock+=ms,close(){service.close();backend.close()}}}
const request=(method:string,target:string,value?:unknown,time=now,nonce?:string):Input=>{const body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value));return{method,target,body,headers:signedHeaders(key,'main',method,target,body,time,nonce)}};
const create=(id=op,rid=reg,deliveryRef=delivery)=>request('POST','/v1/registrations',{operationId:id,registrationId:rid,accountRef:account,deliveryRef,tokenDigest:sha256(token),state:'prepared',expectedRevision:0});
const transition=(state:string,revision:number,id='1'.repeat(32))=>request('POST','/v1/registrations/'+reg,{operationId:id,expectedRevision:revision,state,acknowledgementRef:state==='confirmed'?ack:null});
const pixel:Input={method:'GET',target:'/p/'+token+'.gif',headers:{'user-agent':'GoogleImageProxy synthetic mobile'}};
async function active(f:ReturnType<typeof fixture>){assert.equal((await f.service.handle(create())).status,200);assert.equal((await f.service.handle(transition('armed',1))).status,200);assert.equal((await f.service.handle(transition('confirmed',2,'2'.repeat(32)))).status,200)}

test('actual unchanged SQLite ancestor and async core emit paired serialized lifecycle/error/public/cursor vectors',async()=>{
 const f=fixture(),old=createCollector({...f.options,databasePath:':memory:'});let comparisons=0;
 const paired=async(i:Input)=>{const actual=await f.service.handle(i),expected=old.handle(i);if(i.target.startsWith('/v1/events')&&actual.status===200){const a=parse(actual),b=parse(expected);for(const values of[a.events,b.events])for(const e of values){assert.match(e.id,/^[a-f0-9-]{36}$/);e.id='independent-random-event-id'}assert.deepEqual(a,b);assert.deepEqual(actual.headers,expected.headers)}else assert.deepEqual(actual,expected);comparisons++;return actual};
 try{
  await paired(pixel);const initial=create();const accepted=await paired(initial);await paired({...initial,headers:signedHeaders(key,'main',initial.method,initial.target,initial.body!,now)});
  await paired({...initial,headers:{...initial.headers,origin:'https://evil.invalid'}});await paired(transition('confirmed',1));await paired(transition('armed',1));await paired(pixel);
  await paired(request('GET','/v1/events?accountRef='+account));await paired(transition('confirmed',2,'2'.repeat(32)));await paired(pixel);
  const first=await paired(request('GET','/v1/events?accountRef='+account+'&limit=1')),c=parse(first).nextCursor;assert.ok(c);
  await paired(request('GET','/v1/events?accountRef='+account+'&cursor='+encodeURIComponent(c)+'&limit=1'));
  await paired(request('GET','/v1/requests/'+op));await paired(request('GET','/v1/registrations/'+reg));await paired(transition('disabled',3,'3'.repeat(32)));await paired(pixel);
  await paired({...pixel,method:'HEAD'});await paired({...pixel,target:pixel.target+'?viewer=untrusted'});
  await paired({method:'GET',target:'/v1/events?limit=1&accountRef='+account,body:Buffer.alloc(0),headers:{}});assert.equal(comparisons,19);assert.equal(accepted.status,200);
 }finally{old.close();f.close()}
});

test('two independent service owners share durable nonce, operation and revision fences',async()=>{
 const f=fixture(),other=createAsyncCollector({...f.options,database:f.client()});try{
  const same=create(),results=await Promise.all([f.service.handle(same),other.handle(same)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
  const replay=await other.handle(create());assert.equal(replay.status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_registrations').get()!.n,1);
  const transitions=await Promise.all([f.service.handle(transition('armed',1)),other.handle(transition('disabled',1,'9'.repeat(32)))]);assert.deepEqual(transitions.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.db.prepare('SELECT revision FROM tracking_registrations').get()!.revision,2);
 }finally{other.close();f.close()}
});

test('receipt insertion failure rolls back binding/state/tenant revision; auth nonce is its own prior atomic unit',async()=>{
 const f=fixture();try{f.fail('INSERT INTO tracking_requests');assert.equal((await f.service.handle(create())).status,500);for(const table of['tracking_registrations','tracking_bindings','tracking_tenant_revisions','tracking_requests'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get()!.n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,1);f.fail();assert.equal((await f.service.handle(create())).status,200)}finally{f.close()}
});

test('commit ACK loss retains exact acceptance and restart GET recovers without another POST',async()=>{
 const f=fixture();try{
  let commits=0;f.before(sql=>{if(sql.startsWith('INSERT INTO tracking_requests')){commits++;f.loseCommit()}});
  assert.equal((await f.service.handle(create())).status,503);f.before();assert.equal(commits,1);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,1);
  f.service.close();const resumed=createAsyncCollector({...f.options,database:f.client()});try{const r=await resumed.handle(request('GET','/v1/requests/'+op));assert.equal(r.status,200);assert.equal(parse(r).registration.state,'prepared');assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_registrations').get()!.n,1)}finally{resumed.close()}
 }finally{f.close()}
});

test('foreign key state/schema are checked on actual unit; no runtime schema adoption',async()=>{
 const f=fixture();try{f.db.exec('PRAGMA foreign_keys=OFF');assert.equal((await f.service.handle(create())).status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,0);f.db.exec('PRAGMA foreign_keys=ON');f.db.prepare("UPDATE tracking_meta SET value='foreign' WHERE key='schema'").run();assert.equal((await f.service.handle(create())).status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,0)}finally{f.close()}
});

test('concurrent pixels enforce aggregate/per-token rate limits and stable signed snapshot cursors',async()=>{
 const f=fixture({maxEventsPerTokenMinute:2,maxEventsPerMinute:2});try{await active(f);await Promise.all(Array.from({length:8},()=>f.service.handle(pixel)));assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_events').get()!.n,2);assert.equal(f.db.prepare('SELECT sum(dropped) n FROM tracking_throttle').get()!.n,6);
  const first=parse(await f.service.handle(request('GET','/v1/events?accountRef='+account+'&limit=1')));assert.equal(first.events.length,1);assert.ok(first.nextCursor);f.advance(60000);await f.service.handle(pixel);
  const page=parse(await f.service.handle(request('GET','/v1/events?accountRef='+account+'&cursor='+encodeURIComponent(first.nextCursor)+'&limit=100',undefined,now+60000)));assert.equal(page.events.length,1);assert.equal(page.coverage.snapshotThrough,2);assert.equal(page.coverage.throttled,6);assert.equal(page.events[0].viewer,null);
 }finally{f.close()}
});

test('cancelled invocation/closed service fences transaction before COMMIT and performs no later lifecycle write',async()=>{
 const f=fixture(),held=deferred(),entered=deferred(),controller=new AbortController();try{
  f.before(async sql=>{if(sql.startsWith('INSERT INTO tracking_requests')){entered.resolve();await held.promise}});
  const work=f.service.handle(create(),controller.signal);await entered.promise;controller.abort();held.resolve();assert.equal((await work).status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_registrations').get()!.n,0);
  f.before();f.service.close();assert.equal((await f.service.handle(create())).status,503);
 }finally{held.resolve();f.close()}
});

test('metadata remains opaque and same-image response survives write failure, malformed token and HEAD',async()=>{
 const f=fixture();try{await active(f);const expected=await f.service.handle({...pixel,target:'/p/unknown.gif'});f.fail('INSERT INTO tracking_events');const failed=await f.service.handle(pixel);assert.deepEqual(failed,expected);assert.deepEqual(await f.service.handle({...pixel,method:'HEAD'}),{...expected,body:Buffer.alloc(0)});assert.equal(f.db.prepare('SELECT count(*) n FROM tracking_events').get()!.n,0);assert(!JSON.stringify(f.db.prepare('SELECT * FROM tracking_registrations').all()).includes(token))}finally{f.close()}
});
