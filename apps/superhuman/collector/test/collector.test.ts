import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCollector, type Input } from '../src/collector.ts';
import { sha256, signedHeaders } from '../src/protocol.ts';

const key=Buffer.alloc(32,41),otherKey=Buffer.alloc(32,42),cursorKey=Buffer.alloc(32,43),tenant='a'.repeat(64),otherTenant='b'.repeat(64),account='c'.repeat(64),otherAccount='d'.repeat(64),delivery='e'.repeat(64),reg='a'.repeat(32),operation='b'.repeat(32);
const fixedTime=Date.parse('2026-10-29T01:00:00.123Z');
function fixture(path=':memory:',limits={}) {
  let clock=fixedTime;
  const collector=createCollector({databasePath:path,signers:new Map([['primary',{tenant,key}],['other',{tenant:otherTenant,key:otherKey}]]),cursorKey,now:() => clock,...limits});
  const token=randomBytes(32).toString('base64url');
  function request(method:string,target:string,value?:unknown,other=false,extra:Partial<Input>={}) {
    const body=value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
    return collector.handle({method,target,headers:signedHeaders(other?otherKey:key,other?'other':'primary',method,target,body,clock),body,...extra});
  }
  const decode=(result:ReturnType<typeof request>) => JSON.parse(result.body.toString());
  const create=(changes={}) => request('POST','/v1/registrations',{operationId:operation,registrationId:reg,accountRef:account,deliveryRef:delivery,tokenDigest:sha256(token),state:'prepared',expectedRevision:0,...changes});
  const transition=(state:string,expectedRevision:number,changes={}) => request('POST','/v1/registrations/'+reg,{operationId:randomBytes(16).toString('hex'),expectedRevision,state,acknowledgementRef:state==='confirmed'?'f'.repeat(64):null,...changes});
  const pixel=(t=token,method='GET',headers={}) => collector.handle({method,target:'/p/'+t+'.gif',headers});
  const events=(a=account) => request('GET','/v1/events?accountRef='+a);
  return {...collector,token,request,decode,create,transition,pixel,events,advance:(ms:number) => {clock+=ms;}};
}

test('public responses are identical for unknown, malformed, prepared, disabled and active tokens; HEAD never records',() => {
  const f=fixture();try{
    const unknown=f.pixel(randomBytes(32).toString('base64url'));
    assert.equal(f.create().status,200);
    const prepared=f.pixel();assert.deepEqual(prepared,unknown);
    assert.equal(f.transition('armed',1).status,200);
    const head=f.pixel(f.token,'HEAD');assert.equal(head.body.length,0);assert.deepEqual(head.headers,unknown.headers);
    assert.deepEqual(f.pixel(),unknown);
    assert.equal(f.transition('confirmed',2).status,200);
    assert.equal(f.decode(f.events()).events.length,1);
    assert.equal(f.transition('disabled',3).status,200);
    assert.deepEqual(f.pixel(),unknown);assert.deepEqual(f.pixel('malformed'),unknown);
    assert.equal(f.decode(f.events()).events.length,1);
  }finally{f.close();}
});
test('strict HMAC binds method, canonical path/query, time, nonce and exact body; replays and browser calls fail',() => {
  const f=fixture();try{
    const target='/v1/events?accountRef='+account,body=Buffer.alloc(0),headers=signedHeaders(key,'primary','GET',target,body,fixedTime);
    assert.equal(f.handle({method:'GET',target,body,headers}).status,200);
    assert.equal(f.handle({method:'GET',target,body,headers}).status,401);
    for(const h of [{...headers,'x-rea-nonce':'x'.repeat(32)},{...headers,'x-rea-time':String(fixedTime-300001)},{...headers,'x-rea-key-id':'other'},{...headers,'x-rea-signature':'0'.repeat(64)}])assert.equal(f.handle({method:'GET',target,body,headers:h}).status,401);
    assert.equal(f.handle({method:'GET',target:target.replace(account,otherAccount),body,headers}).status,401);
    assert.equal(f.request('GET',target,undefined,false,{headers:{...signedHeaders(key,'primary','GET',target,body,fixedTime),origin:'https://evil.invalid'}}).status,403);
    assert.equal(f.handle({method:'GET',target:target+'&accountRef='+account,body,headers}).status,400);
    assert.equal(f.handle({method:'POST',target:'/v1/registrations',body:Buffer.alloc(4097),headers}).status,413);
    assert.equal(f.handle({method:'GET',target:'/v1/events?limit=50&accountRef='+account,body,headers}).status,400);
  }finally{f.close();}
});
test('prepared and unknown Send registrations cannot produce confirmed receipts; cancellation is terminal',() => {
  const f=fixture();try{
    f.create();f.pixel();assert.equal(f.transition('confirmed',1).status,409);
    assert.equal(f.transition('armed',1).status,200);f.pixel();
    assert.equal(f.decode(f.events()).events.length,0);
    assert.equal(f.transition('disabled',2).status,200);
    assert.equal(f.transition('armed',3).status,409);
    assert.equal(f.transition('confirmed',3).status,409);
    assert.equal(f.decode(f.events()).events.length,0);
  }finally{f.close();}
});
test('immutable keyed registration recovery returns original acceptance after later state and does not retarget delivery/token',() => {
  const f=fixture();try{
    const accepted=f.create();assert.equal(accepted.status,200);
    f.transition('armed',1);
    assert.deepEqual(f.create(),accepted);
    assert.equal(f.create({deliveryRef:otherAccount}).status,409);
    assert.equal(f.create({operationId:'c'.repeat(32),registrationId:'d'.repeat(32)}).status,409);
    assert.deepEqual(f.request('GET','/v1/requests/'+operation),accepted);
    assert.equal(f.request('GET','/v1/requests/'+operation,undefined,true).status,404);
    assert.equal(f.transition('confirmed',1).status,409);
    const current=f.decode(f.request('GET','/v1/registrations/'+reg)).registration;
    assert.equal(current.state,'armed');assert.equal(current.revision,2);assert.equal(current.deliveryRef,delivery);
  }finally{f.close();}
});
test('signature rejection is independent of replay and binds changed body, method and each timestamp',() => {
  const f=fixture();try{
    const target='/v1/registrations',body=Buffer.from('{}');
    const attempt=(method:string,changed:Buffer,stamp=fixedTime) => f.handle({method,target,body:changed,headers:signedHeaders(key,'primary','POST',target,body,stamp)});
    assert.equal(attempt('POST',Buffer.from('{"x":1}')).status,401);
    assert.equal(attempt('GET',Buffer.alloc(0)).status,401);
    assert.equal(attempt('POST',body,fixedTime+300001).status,401);
    assert.equal(attempt('POST',body,fixedTime-300001).status,401);
    assert.equal(attempt('POST',body).status,400); // A valid signature reaches request validation.
    assert.equal(f.create().status,200);
  }finally{f.close();}
});
test('public query claims, noncanonical token spellings and non-image methods never register an event',() => {
  const f=fixture();try{
    f.create();f.transition('armed',1);f.transition('confirmed',2);
    const response=f.handle({method:'GET',target:'/p/'+f.token+'.gif?viewerEmail=recipient@example.test',headers:{}});
    assert.equal(response.status,200);
    assert.equal(f.pixel(f.token,'POST').status,405);
    assert.equal(f.handle({method:'GET',target:'/p/'+f.token+'.gif',headers:{},body:Buffer.from('x')}).status,200);
    assert.equal(f.decode(f.events()).events.length,0);
  }finally{f.close();}
});
test('tenant and account isolation apply to registration, receipt pages and token collisions',() => {
  const f=fixture();try{
    f.create();f.transition('armed',1);f.transition('confirmed',2);f.pixel();
    assert.equal(f.request('GET','/v1/registrations/'+reg,undefined,true).status,404);
    assert.equal(f.decode(f.request('GET','/v1/events?accountRef='+account,undefined,true)).events.length,0);
    assert.equal(f.decode(f.events(otherAccount)).events.length,0);
    const response=f.request('POST','/v1/registrations',{operationId:operation,registrationId:reg,accountRef:account,deliveryRef:delivery,tokenDigest:sha256(f.token),state:'prepared',expectedRevision:0},true);
    assert.equal(response.status,409);
  }finally{f.close();}
});
test('event snapshot pagination excludes later events, rejects other account and invalidates changed confirmation context',() => {
  const f=fixture();try{
    f.create();f.transition('armed',1);f.transition('confirmed',2);f.pixel();f.advance(1);f.pixel();f.advance(1);f.pixel();
    const first=f.decode(f.request('GET','/v1/events?accountRef='+account+'&limit=1'));assert.equal(first.events.length,1);assert.ok(first.nextCursor);
    f.pixel();
    const second=f.decode(f.request('GET','/v1/events?accountRef='+account+'&cursor='+encodeURIComponent(first.nextCursor)+'&limit=100'));
    assert.equal(second.events.length,2);assert.equal(second.nextCursor,null);assert.equal(second.coverage.snapshotThrough,3);
    assert.equal(f.request('GET','/v1/events?accountRef='+otherAccount+'&cursor='+encodeURIComponent(first.nextCursor)).status,400);
    assert.equal(f.request('GET','/v1/events?accountRef='+account+'&cursor='+encodeURIComponent(first.nextCursor+'a')).status,400);
    f.transition('disabled',3);
    assert.equal(f.request('GET','/v1/events?accountRef='+account+'&cursor='+encodeURIComponent(first.nextCursor)).status,409);
  }finally{f.close();}
});
test('coarse classification stores no viewer claim; known-token event rate bounds disclose incomplete coverage only to authenticated account',() => {
  const f=fixture(':memory:',{maxEventsPerTokenMinute:2,maxEventsPerMinute:2});try{
    f.create();f.transition('armed',1);f.transition('confirmed',2);
    f.pixel(f.token,'GET',{'user-agent':'GoogleImageProxy / attacker@example.test'});f.pixel(f.token,'GET',{'user-agent':'Mozilla iPhone'});
    const before=f.pixel();const after=f.pixel();assert.deepEqual(before,after);
    const page=f.decode(f.events());assert.equal(page.events.length,2);assert.equal(page.coverage.throttled,2);
    assert.equal(page.events[0].proxy,'google-proxy');assert.equal(page.events[1].device,'mobile');assert.equal(page.events[0].viewer,null);
    assert.equal(page.coverage.humanReadVerified,false);assert.ok(!JSON.stringify(page).includes('attacker@'));
    f.advance(60000);f.pixel();assert.equal(f.decode(f.events()).events.length,3);
  }finally{f.close();}
});
test('restart preserves accepted keys, authentication nonces, lifecycle and byte-free opaque events',() => {
  const dir=mkdtempSync(join(tmpdir(),'rea-collector-')),path=join(dir,'collector.sqlite');
  try{
    const f=fixture(path),token=f.token;f.create();f.transition('armed',1);f.transition('confirmed',2);f.pixel();
    const target='/v1/registrations/'+reg,headers=signedHeaders(key,'primary','GET',target,Buffer.alloc(0),fixedTime);
    const read=f.handle({method:'GET',target,headers});assert.equal(read.status,200);f.close();
    const resumed=fixture(path);try{
      assert.equal(resumed.handle({method:'GET',target,headers}).status,401);
      assert.deepEqual(resumed.request('GET',target),read);
      assert.equal(resumed.decode(resumed.events()).events.length,1);
      resumed.pixel(token);assert.equal(resumed.decode(resumed.events()).events.length,2);
    }finally{resumed.close();}
    const db=new DatabaseSync(path,{readOnly:true});try{
      const rows=db.prepare('SELECT * FROM tracking_events').all();assert.equal(rows.length,2);assert.ok(!JSON.stringify(rows).includes(token));
      assert.deepEqual(Object.keys(rows[0]).sort(),['account_ref','device','id','observed_at','proxy','registration_id','sequence','tenant'].sort());
    }finally{db.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('corrupt historical receipts fail closed even with recomputed request fingerprint',() => {
  const dir=mkdtempSync(join(tmpdir(),'rea-collector-corrupt-')),path=join(dir,'collector.sqlite'),f=fixture(path);
  const db=new DatabaseSync(path);
  try{
    assert.equal(f.create().status,200);f.transition('armed',1);
    const row=db.prepare('SELECT * FROM tracking_requests WHERE operation_id=?').get(operation)!;
    const corruptions=[
      (r:any) => {r.receipt.acceptedAt='yesterday';},
      (r:any) => {r.registration.deliveryRef=otherAccount;},
      (r:any) => {r.registration.state='confirmed';},
      (r:any) => {r.registration.revision=7;},
      (r:any) => {r.receipt.operationId='0'.repeat(32);},
      (r:any) => {r.unrecognized=true;},
    ];
    for(const change of corruptions){
      const result=JSON.parse(row.response_json as string);change(result);db.prepare('UPDATE tracking_requests SET response_json=? WHERE operation_id=?').run(JSON.stringify(result),operation);
      const response=f.request('GET','/v1/requests/'+operation);assert.equal(response.status,500);assert.equal(f.decode(response).error.code,'collector_artifact_corrupt');
    }
    const request=JSON.parse(row.request_json as string);request.deliveryRef=otherAccount;const raw=JSON.stringify(request),fingerprint=sha256(row.request_path+'\n'+raw),result=JSON.parse(row.response_json as string);
    result.receipt.requestFingerprint=fingerprint;result.registration.deliveryRef=otherAccount;
    db.prepare('UPDATE tracking_requests SET request_json=?,fingerprint=?,response_json=? WHERE operation_id=?').run(raw,fingerprint,JSON.stringify(result),operation);
    assert.equal(f.request('GET','/v1/requests/'+operation).status,500);
    db.prepare('UPDATE tracking_requests SET request_json=?,fingerprint=?,response_json=? WHERE operation_id=?').run(row.request_json as string,row.fingerprint as string,row.response_json as string,operation);
    assert.equal(f.request('GET','/v1/requests/'+operation).status,200);
  }finally{db.close();f.close();rmSync(dir,{recursive:true,force:true});}
});
