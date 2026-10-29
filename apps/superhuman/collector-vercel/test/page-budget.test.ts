import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncCollector } from '../src/collector.ts';
import { libsqlDatabase } from '../src/store-libsql.ts';
import { configuration } from '../src/config.ts';
import { signedHeaders } from '../../collector/src/protocol.ts';
import { hranaFixture } from './hrana.ts';

const now=Date.parse('2026-10-29T09:00:00Z'),key=Buffer.alloc(32,17),tenant='a'.repeat(64),account='b'.repeat(64),ack='f'.repeat(64);
const env=()=>({TRACKING_PUBLIC_ORIGIN:'https://fixture.vercel.app',TURSO_DATABASE_URL:'https://fixture.turso.io',TURSO_AUTH_TOKEN:'synthetic-only',TRACKING_SIGNERS_JSON:JSON.stringify([{keyId:'main',tenant,key:key.toString('hex')}]),TRACKING_CURSOR_KEY:Buffer.alloc(32,18).toString('hex')});

function pageFixture(factory=createAsyncCollector){
 const server=hranaFixture();
 // Complete synthetic metadata only: one confirmed owned registration/binding
 // and one image-fetch event for each row. No real delivery, key or pixel URL.
 for(let i=1;i<=100;i++){
  const id=i.toString(16).padStart(32,'0'),digest=i.toString(16).padStart(64,'0'),event='00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
  server.db.prepare('INSERT INTO tracking_registrations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(tenant,id,account,digest,digest,'confirmed',3,ack,now,now,now);
  server.db.prepare('INSERT INTO tracking_bindings VALUES(?,?,?,?,?,?,?,?)').run(tenant,id,account,digest,digest,now,ack,now);
  server.db.prepare('INSERT INTO tracking_events VALUES(?,?,?,?,?,?,?,?)').run(tenant,account,i,event,id,now,'unknown','unknown');
 }
 server.db.prepare('INSERT INTO tracking_tenant_revisions VALUES(?,300)').run(tenant);
 let elapsed=0;const stepMs=40,live=new Map<string,{start:number;roundTrips:number}>(),units:{roundTrips:number;elapsedMs:number;outcome:string}[]=[];
 const transport=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const req=input instanceof Request?input:new Request(input,init),packet=await req.clone().json() as any,baton=packet.baton as string|undefined;
  elapsed+=stepMs;
  const active=baton?live.get(baton):undefined;
  if(active){active.roundTrips++;if(elapsed-active.start>5000){
   // Emulate a server-side interactive transaction expiry, not a local sleep.
   await server.transport(new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify({baton,requests:[{type:'execute',stmt:{sql:'ROLLBACK',args:[],want_rows:false}}]})}));
   units.push({...active,elapsedMs:elapsed-active.start,outcome:'timeout'});live.delete(baton!);
   return new Response(JSON.stringify({baton:null,base_url:null,results:packet.requests.map(()=>({type:'error',error:{message:'Synthetic5s transaction limit',code:'TRANSACTION_TIMEOUT'}}))}),{headers:{'content-type':'application/json'}});
  }}
  const before=server.statements.length,response=await server.transport(req),body=await response.clone().json() as any,id=baton??body.baton;
  const statements=server.statements.slice(before);
  if(statements.some(s=>s==='BEGIN IMMEDIATE'))live.set(id,{start:elapsed-stepMs,roundTrips:1});
  if(statements.some(s=>s==='COMMIT'||s==='ROLLBACK')){const current=live.get(id);if(current)units.push({...current,elapsedMs:elapsed-current.start,outcome:statements.includes('COMMIT')?'commit':'rollback'});live.delete(id)}
  return response;
 }) as typeof fetch;
 const c=configuration(env()),database=libsqlDatabase(c,{transport}),service=factory({...c,database,now:()=>now});
 const read=()=>{const target='/v1/events?accountRef='+account+'&limit=100';return service.handle({method:'GET',target,headers:signedHeaders(key,'main','GET',target,Buffer.alloc(0),now)})};
 return{...server,service,read,units,finish(){service.close();database.close();server.close()}};
}

test('max100 page uses bounded actual SDK/Hrana round trips inside virtual5s',async(t)=>{
 const f=pageFixture();try{const r=await f.read();assert.equal(r.status,200);const p=JSON.parse(r.body.toString());assert.equal(p.events.length,100);assert.equal(p.nextCursor,null);assert.deepEqual(p.coverage,{snapshotThrough:100,revision:300,throttled:0,fullMailbox:false,humanReadVerified:false});assert.deepEqual(p.events.map((e:any)=>e.registrationId),Array.from({length:100},(_,i)=>(i+1).toString(16).padStart(32,'0')));assert(f.units.every(u=>u.outcome==='commit'&&u.roundTrips<=16&&u.elapsedMs<=640));assert(f.statements.filter(s=>s.startsWith('SELECT e.*')).length===1);assert(!f.statements.some(s=>s==='SELECT * FROM tracking_registrations WHERE tenant=? AND id=?'));t.diagnostic('batched-V2 '+JSON.stringify(f.units))}finally{f.finish()}
});

test('all100 loaded registration proofs validate; corrupt/missing middle binding and nullable confirmation never hide rows',async()=>{
 const f=pageFixture();try{
  for(let i=1;i<=100;i++){const id=i.toString(16).padStart(32,'0');f.db.prepare('UPDATE tracking_registrations SET revision=-1 WHERE tenant=? AND id=?').run(tenant,id);const r=await f.read();assert.equal(r.status,500,'proof'+i);assert.equal(JSON.parse(r.body.toString()).error.code,'collector_artifact_corrupt');f.db.prepare('UPDATE tracking_registrations SET revision=3 WHERE tenant=? AND id=?').run(tenant,id)}
  const middle=(50).toString(16).padStart(32,'0'),binding=f.db.prepare('SELECT * FROM tracking_bindings WHERE tenant=? AND id=?').get(tenant,middle)!;
  for(const variant of['mismatch','missing','null-confirmation']){
   if(variant==='mismatch')f.db.prepare('UPDATE tracking_bindings SET token_digest=? WHERE tenant=? AND id=?').run('9'.repeat(64),tenant,middle);
   if(variant==='missing')f.db.prepare('DELETE FROM tracking_bindings WHERE tenant=? AND id=?').run(tenant,middle);
   if(variant==='null-confirmation')f.db.prepare('UPDATE tracking_registrations SET confirmed_at=NULL WHERE tenant=? AND id=?').run(tenant,middle);
   const r=await f.read();assert.equal(r.status,500,variant);assert.equal(JSON.parse(r.body.toString()).error.code,'collector_artifact_corrupt');
   f.db.prepare('UPDATE tracking_registrations SET confirmed_at=? WHERE tenant=? AND id=?').run(now,tenant,middle);
   f.db.prepare('INSERT OR REPLACE INTO tracking_bindings VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(binding) as any);
  }
  assert.equal(JSON.parse((await f.read()).body.toString()).events.length,100);
 }finally{f.finish()}
});
