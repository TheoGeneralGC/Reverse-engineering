import test from 'node:test';import assert from 'node:assert/strict';import { Duplex } from 'node:stream';import { IncomingMessage, ServerResponse } from 'node:http';
import { configuration } from '../src/config.ts';import { libsqlDatabase } from '../src/store-libsql.ts';import { createApplication } from '../src/index.ts';import { createAsyncCollector } from '../src/collector.ts';import { signedHeaders,sha256 } from '../../collector/src/protocol.ts';import { memoryDatabase } from './helpers.ts';import { hranaFixture } from './hrana.ts';
import { createClient } from '@libsql/client/web';import { installSchema } from '../src/operator.ts';
const now=Date.parse('2026-10-29T09:00:00Z'),key=Buffer.alloc(32,17),tenant='a'.repeat(64),account='b'.repeat(64),reg='c'.repeat(32),op='d'.repeat(32),token=Buffer.alloc(32,19).toString('base64url');
const env=()=>({TRACKING_PUBLIC_ORIGIN:'https://fixture.vercel.app',TURSO_DATABASE_URL:'https://fixture.turso.io',TURSO_AUTH_TOKEN:'synthetic-auth-only',TRACKING_SIGNERS_JSON:JSON.stringify([{keyId:'main',tenant,key:key.toString('hex')}]),TRACKING_CURSOR_KEY:Buffer.alloc(32,18).toString('hex')});
const payload={operationId:op,registrationId:reg,accountRef:account,deliveryRef:'e'.repeat(64),tokenDigest:sha256(token),state:'prepared',expectedRevision:0};

test('actual pinned @libsql/client/web exchanges transactions with injected Hrana/real SQLite; each unit checks FK and commits before return',async()=>{
 const server=hranaFixture(),c=configuration(env()),db=libsqlDatabase(c,{transport:server.transport}),service=createAsyncCollector({...c,database:db,now:()=>now});
 try{const target='/v1/registrations',body=Buffer.from(JSON.stringify(payload));assert.equal((await service.handle({method:'POST',target,body,headers:signedHeaders(key,'main','POST',target,body,now)})).status,200);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,1);assert.ok(server.statements.filter(s=>s==='BEGIN IMMEDIATE').length>=2);assert.equal(server.statements.filter(s=>s==='PRAGMA foreign_keys').length,2);assert.equal(server.statements.at(-1),'COMMIT');assert.equal(await service.readable(),true);
  // Runtime never silently turns FK on in another session or executes migration SQL.
  assert(!server.statements.some(s=>/CREATE TABLE|foreign_keys\s*=/.test(s)));server.db.exec('PRAGMA foreign_keys=OFF');assert.equal((await service.handle({method:'GET',target:'/v1/requests/'+op,headers:signedHeaders(key,'main','GET','/v1/requests/'+op,Buffer.alloc(0),now)})).status,500);
 }finally{service.close();db.close();server.close()}
});

test('actual SDK COMMIT ACK loss is unresolved then exact fresh-client GET proves acceptance with zero retry POST',async()=>{
 const server=hranaFixture(),c=configuration(env()),db=libsqlDatabase(c,{transport:server.transport}),service=createAsyncCollector({...c,database:db,now:()=>now});let primed=false;
 // Hook only the registration unit's COMMIT, after the nonce unit already completed.
 server.onCommit(()=>{if(!primed&&server.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n===1){primed=true;server.loseCommit()}});
 try{const target='/v1/registrations',body=Buffer.from(JSON.stringify(payload));assert.equal((await service.handle({method:'POST',target,body,headers:signedHeaders(key,'main','POST',target,body,now)})).status,503);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_requests').get()!.n,1);service.close();db.close();const c2=configuration(env()),db2=libsqlDatabase(c2,{transport:server.transport}),next=createAsyncCollector({...c2,database:db2,now:()=>now});try{const path='/v1/requests/'+op;const r=await next.handle({method:'GET',target:path,headers:signedHeaders(key,'main','GET',path,Buffer.alloc(0),now)});assert.equal(r.status,200);assert.equal(JSON.parse(r.body.toString()).registration.state,'prepared');assert.equal(server.statements.filter(s=>s.startsWith('INSERT INTO tracking_requests')).length,1)}finally{next.close();db2.close()}
 }finally{service.close();db.close();server.close()}
});

async function invoke(app:ReturnType<typeof createApplication>,method:string,url:string,body=Buffer.alloc(0),headers:Record<string,string>={},extra:Record<string,unknown>={}){
 return new Promise<{status:number;body:Buffer;headers:Record<string,string>}>((resolve,reject)=>{
  const chunks:Buffer[]=[];const socket=new Duplex({read(){},write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done()}});
  const req=Object.assign(new IncomingMessage(socket as any),{method,url,headers:{host:'fixture.vercel.app','content-length':String(body.length),...headers},rawHeaders:Object.entries({host:'fixture.vercel.app','content-length':String(body.length),...headers}).flat(),complete:true,...extra});
  const res=new ServerResponse(req);res.assignSocket(socket as any);
  res.on('finish',()=>{const wire=Buffer.concat(chunks),at=wire.indexOf('\r\n\r\n');resolve({status:res.statusCode,body:wire.subarray(at+4),headers:Object.fromEntries(Object.entries(res.getHeaders()).map(([k,v])=>[k,String(v)]))})});res.on('error',reject);app(req,res);req.push(body.length?body:null);if(body.length)req.push(null);
 });
}
test('actual Express root middleware binds raw public target/query/body/Host without rewrites or header authority',async()=>{
 const backend=memoryDatabase(),app=createApplication({configure:()=>configuration(env()),database:()=>backend.client()});try{
  const target='/v1/registrations',body=Buffer.from(JSON.stringify(payload,null,1));const good=await invoke(app,'POST',target,body,signedHeaders(key,'main','POST',target,body));assert.equal(good.status,200,good.body.toString());
  const path='/v1/events?accountRef='+account+'&limit=1';const read=await invoke(app,'GET',path,Buffer.alloc(0),signedHeaders(key,'main','GET',path,Buffer.alloc(0)));assert.equal(read.status,200);assert.equal(JSON.parse(read.body.toString()).events.length,0);
  for(const headers of[{host:'evil.invalid'},{'x-original-url':target,'x-forwarded-uri':target}] as Record<string,string>[]){const wrong=await invoke(app,'POST','/api/collector',body,{...signedHeaders(key,'main','POST',target,body),...headers});assert.notEqual(wrong.status,200)}
  const altered=await invoke(app,'POST',target,Buffer.from(JSON.stringify(payload)),signedHeaders(key,'main','POST',target,body));assert.equal(altered.status,401);assert.equal((await invoke(app,'GET','/healthz')).status,204);
  assert.equal((await invoke(app,'GET','/v1/events?limit=1&accountRef='+account,Buffer.alloc(0),signedHeaders(key,'main','GET',path,Buffer.alloc(0)))).status,400);assert.equal((await invoke(app,'POST',target,body,signedHeaders(key,'main','POST',target,body),{body:JSON.parse(body.toString())})).status,400);
 }finally{backend.close()}
});

test('complete environment preflight rejects malformed/partial/credential URLs and never constructs database or reads a file',async()=>{
 const maximumHost=[...Array(3).fill('a'.repeat(63)),'b'.repeat(52),'turso','io'].join('.'),tooLongHost=[...Array(3).fill('a'.repeat(63)),'b'.repeat(53),'turso','io'].join('.');assert.equal(maximumHost.length,253);assert.equal(tooLongHost.length,254);
 for(const databaseUrl of['https://fixture.turso.io','libsql://owned-fixture.aws-us-east-1.turso.io','https://a.b.turso.io','https://'+'a'.repeat(63)+'.turso.io','https://'+maximumHost]){const c=configuration({...env(),TURSO_DATABASE_URL:databaseUrl});assert.equal(c.databaseUrl,databaseUrl);for(const s of c.signers.values())s.key.fill(0);c.cursorKey.fill(0)}
 let creates=0;for(const changes of[{TURSO_AUTH_TOKEN:undefined},{TURSO_DATABASE_URL:'file:/tmp/forbidden.sqlite'},{TURSO_DATABASE_URL:'https://user:secret@fixture.turso.io'},{TURSO_DATABASE_URL:'https://turso.io'},{TURSO_DATABASE_URL:'https://fixture.turso.io.outside.invalid'},{TURSO_DATABASE_URL:'https://fixture..turso.io'},{TURSO_DATABASE_URL:'https://-fixture.turso.io'},{TURSO_DATABASE_URL:'https://fixture-.turso.io'},{TURSO_DATABASE_URL:'https://'+'a'.repeat(64)+'.turso.io'},{TURSO_DATABASE_URL:'https://'+tooLongHost},{TURSO_DATABASE_URL:'libsql://fixture.aws-us-east-1.turso.io:443'},{TURSO_DATABASE_URL:'libsql://fixture.aws-us-east-1.turso.io/path'},{TURSO_DATABASE_URL:'libsql://fixture.aws-us-east-1.turso.io?query=1'},{TRACKING_CURSOR_KEY:'bad'},{TRACKING_PUBLIC_ORIGIN:'https://fixture.vercel.app/path'},{TRACKING_SIGNERS_JSON:'[{"keyId":"leaked-private"}]'}]){const app=createApplication({configure:()=>configuration({...env(),...changes}),database:()=>{creates++;throw Error('Should not construct')}});const r=await invoke(app,'GET','/healthz');assert.equal(r.status,500);assert(!r.body.includes('leaked-private'))}assert.equal(creates,0);
});

test('two actual HTTP SDK clients converge exact keyed save and conflicting CAS without closing a sibling client',async()=>{
 const server=hranaFixture(),a=configuration(env()),b=configuration(env()),da=libsqlDatabase(a,{transport:server.transport}),db=libsqlDatabase(b,{transport:server.transport}),one=createAsyncCollector({...a,database:da,now:()=>now}),two=createAsyncCollector({...b,database:db,now:()=>now});
 const send=(s:typeof one,state:string,rev:number,id:string)=>{const target='/v1/registrations/'+reg,body=Buffer.from(JSON.stringify({operationId:id,expectedRevision:rev,state,acknowledgementRef:null}));return s.handle({method:'POST',target,body,headers:signedHeaders(key,'main','POST',target,body,now)})};
 try{const body=Buffer.from(JSON.stringify(payload)),r=await Promise.all([one,two].map(s=>s.handle({method:'POST',target:'/v1/registrations',body,headers:signedHeaders(key,'main','POST','/v1/registrations',body,now)})));assert.equal(r[0].status,200);assert.deepEqual(r[0],r[1]);const race=await Promise.all([send(one,'armed',1,'1'.repeat(32)),send(two,'disabled',1,'2'.repeat(32))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);one.close();da.close();const path='/v1/requests/'+op;assert.equal((await two.handle({method:'GET',target:path,headers:signedHeaders(key,'main','GET',path,Buffer.alloc(0),now)})).status,200)}finally{one.close();two.close();da.close();db.close();server.close()}
});

test('actual HTTP SDK write error rolls back full registration unit, including unique/FK-constrained identities',async()=>{
 const server=hranaFixture(),c=configuration(env()),db=libsqlDatabase(c,{transport:server.transport}),s=createAsyncCollector({...c,database:db,now:()=>now});
 try{server.fail('INSERT INTO tracking_requests');const body=Buffer.from(JSON.stringify(payload));assert.equal((await s.handle({method:'POST',target:'/v1/registrations',body,headers:signedHeaders(key,'main','POST','/v1/registrations',body,now)})).status,503);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_registrations').get()!.n,0);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_bindings').get()!.n,0);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_tenant_revisions').get()!.n,0);server.fail();assert.equal((await s.handle({method:'POST',target:'/v1/registrations',body,headers:signedHeaders(key,'main','POST','/v1/registrations',body,now)})).status,200);assert.throws(()=>server.db.prepare('INSERT INTO tracking_bindings VALUES(?,?,?,?,?,?,NULL,NULL)').run(tenant,'0'.repeat(32),account,'1'.repeat(64),'2'.repeat(64),now));assert.equal(server.db.isTransaction,false)}finally{s.close();db.close();server.close()}
});

test('explicit operator batches schema only into an empty owned store; runtime GET never creates it',async()=>{
 const server=hranaFixture(false),c=configuration(env()),client=createClient({url:c.databaseUrl,authToken:c.authToken,fetch:server.transport,intMode:'number'}),db=libsqlDatabase(c,{transport:server.transport}),s=createAsyncCollector({...c,database:db,now:()=>now});
 try{assert.equal(await s.readable(),false);const target='/v1/events?accountRef='+account;assert.equal((await s.handle({method:'GET',target,headers:signedHeaders(key,'main','GET',target,Buffer.alloc(0),now)})).status,500);assert.equal(server.db.prepare('SELECT count(*) n FROM sqlite_master').get()!.n,0);await installSchema(client);assert.equal(await s.readable(),true);const count=server.db.prepare('SELECT total_changes() n').get()!.n;await assert.rejects(installSchema(client));assert.equal(server.db.prepare('SELECT total_changes() n').get()!.n,count);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,0)}finally{s.close();db.close();client.close();server.close()}
});

test('pinned SDK cannot redirect its credential to a response-provided replacement origin',async()=>{
 const server=hranaFixture(),c=configuration(env());let calls=0;const transport=(async(...args:Parameters<typeof fetch>)=>{calls++;const r=await server.transport(...args),p=await r.json() as any;p.base_url='https://foreign.invalid/';return new Response(JSON.stringify(p),{headers:{'content-type':'application/json'}})}) as typeof fetch;const db=libsqlDatabase(c,{transport}),s=createAsyncCollector({...c,database:db,now:()=>now});
 try{const target='/v1/events?accountRef='+account,r=await s.handle({method:'GET',target,headers:signedHeaders(key,'main','GET',target,Buffer.alloc(0),now)});assert.equal(r.status,503);assert.equal(calls,1);assert.equal(server.db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,0)}finally{s.close();db.close();server.close()}
});
