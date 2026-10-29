import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {startCollector} from '../src/server.ts';

const directory=()=>realpathSync(mkdtempSync(join(tmpdir(),'collector-deployment-http-independent-')));
async function unusedPort(){const r=createServer();r.listen(0,'127.0.0.1');await once(r,'listening');const a=r.address();assert(a&&typeof a==='object');await new Promise<void>((ok,bad)=>r.close(e=>e?bad(e):ok()));return a.port}
function environment(root:string,port:number){const signer=join(root,'signers.json'),cursor=join(root,'cursor.key');writeFileSync(signer,JSON.stringify([{keyId:'fake',tenant:'a'.repeat(64),key:'21'.repeat(32)}]),{flag:'wx',mode:0o600});writeFileSync(cursor,'22'.repeat(32),{flag:'wx',mode:0o600});return{TRACKING_DATABASE_PATH:join(root,'collector.sqlite'),TRACKING_SIGNERS_FILE:signer,TRACKING_CURSOR_KEY_FILE:cursor,TRACKING_PORT:String(port),TRACKING_PUBLIC_ORIGIN:'https://collector.example.test'}}
async function close(r:ReturnType<typeof startCollector>){const done=once(r.server,'close');r.close();await done}
const rows=(db:DatabaseSync)=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>[String(r.name),db.prepare('SELECT * FROM "'+String(r.name).replaceAll('"','""')+'" ORDER BY rowid').all().map(r=>({...r}))]));

test('direct file configuration rejects non-ASCII cursor bytes before database or listener creation',async()=>{
 const root=directory(),env=environment(root,await unusedPort());let running:ReturnType<typeof startCollector>|undefined,rejected=false;try{writeFileSync(env.TRACKING_CURSOR_KEY_FILE,Buffer.from(Array.from(Buffer.from('22'.repeat(32)),n=>n|0x80)));try{running=startCollector(env)}catch{rejected=true}if(running)await once(running.server,'listening');assert.equal(rejected,true,'Binary high-bit bytes must not silently normalize to a valid hex cursor key');assert.equal(existsSync(env.TRACKING_DATABASE_PATH),false,'Invalid secret bytes must fail before database writes')}finally{if(running)await close(running);rmSync(root,{recursive:true,force:true})}
});

test('deployment entry refuses a symlink database instead of adopting and modifying its target',async()=>{
 const root=directory(),foreign=directory(),env=environment(root,await unusedPort()),target=join(foreign,'empty.sqlite');let running:ReturnType<typeof startCollector>|undefined,rejected=false;const db=new DatabaseSync(target);db.close();symlinkSync(target,env.TRACKING_DATABASE_PATH);try{try{running=startCollector(env)}catch{rejected=true}if(running)await once(running.server,'listening');assert.equal(rejected,true,'The explicit deployment database path must not follow a symlink');const observed=new DatabaseSync(target,{readOnly:true});try{assert.equal(observed.prepare("SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()!.n,0,'An unrelated alias target must remain unchanged')}finally{observed.close()}}finally{if(running)await close(running);rmSync(root,{recursive:true,force:true});rmSync(foreign,{recursive:true,force:true})}
});

test('actual managed-proxy health requests enforce Host/shape and preserve every logical row; corruption reports unavailable',async()=>{
 const root=directory(),port=await unusedPort(),env=environment(root,port),running=startCollector({...env,TRACKING_LISTEN_HOST:'0.0.0.0'});await once(running.server,'listening');const db=new DatabaseSync(env.TRACKING_DATABASE_PATH);try{
  const send=(method:string,path:string,headers:Record<string,string>|string[]={},body='')=>new Promise<{status:number,headers:Record<string,unknown>,body:string}>((ok,bad)=>{const req=request({host:'127.0.0.1',port,method,path,headers:Array.isArray(headers)?headers:{Host:'collector.example.test','Content-Length':String(Buffer.byteLength(body)),...headers}},res=>{const parts:Buffer[]=[];res.on('data',b=>parts.push(Buffer.from(b)));res.on('end',()=>ok({status:res.statusCode!,headers:res.headers,body:Buffer.concat(parts).toString()}))});req.on('error',bad);req.end(body)});
  const before=rows(db);for(const method of ['GET','HEAD']){const res=await send(method,'/healthz');assert.equal(res.status,204);assert.equal(res.body,'');assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['set-cookie'],undefined)}
  for(const host of ['foreign.example.test','collector.example.test:443','collector.example.test.','COLLECTOR.EXAMPLE.TEST'])assert.equal((await send('GET','/healthz',{Host:host})).status,400);
  assert.equal((await send('GET','/healthz',['Host','collector.example.test','Host','foreign.example.test','Content-Length','0'])).status,400);
  for(const method of ['POST','PUT','DELETE','OPTIONS'])assert.equal((await send(method,'/healthz')).status,400);
  assert.equal((await send('GET','/healthz',{},'x')).status,400);assert.notEqual((await send('GET','/healthz?ready=1')).status,204);assert.equal((await send('GET','/healthz',{'Content-Length':'4097'})).status,413);
  assert.deepEqual(rows(db),before,'All health and rejected requests must leave logical collector rows unchanged');db.prepare("UPDATE tracking_meta SET value='corrupt' WHERE key='schema'").run();const unhealthy=await send('GET','/healthz');assert.equal(unhealthy.status,503);assert.equal(unhealthy.body,'');
 }finally{db.close();await close(running);rmSync(root,{recursive:true,force:true})}
});
