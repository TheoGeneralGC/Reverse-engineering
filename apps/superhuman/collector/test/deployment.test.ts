import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { startCollector } from '../src/server.ts';
import { createCollector } from '../src/collector.ts';

function inputs(path: string, port: number) {
  const signer=join(path,'signers.json'),cursor=join(path,'cursor.key');
  writeFileSync(signer,JSON.stringify([{keyId:'test',tenant:'a'.repeat(64),key:'12'.repeat(32)}]),{mode:0o600});
  writeFileSync(cursor,'13'.repeat(32),{mode:0o600});
  return {TRACKING_DATABASE_PATH:join(path,'collector.sqlite'),TRACKING_SIGNERS_FILE:signer,TRACKING_CURSOR_KEY_FILE:cursor,TRACKING_PORT:String(port),TRACKING_PUBLIC_ORIGIN:'http://127.0.0.1:'+port};
}
async function unusedPort() {
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const address=listener.address();assert.ok(address&&typeof address==='object');
  await new Promise<void>((done,reject)=>listener.close(error=>error?reject(error):done()));return address.port;
}
test('readable liveness never modifies rows and cannot imply an authenticated registration or human read',() => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-live-')),path=join(dir,'collector.sqlite');
  const collector=createCollector({databasePath:path,signers:new Map([['test',{tenant:'a'.repeat(64),key:Buffer.alloc(32,21)}]]),cursorKey:Buffer.alloc(32,22)});
  const db=new DatabaseSync(path);
  try {
    const rows=()=>db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>[r.name,db.prepare('SELECT count(*) n FROM "'+r.name+'"').get()!.n]);
    const before=rows();assert.equal(collector.readable(),true);assert.equal(collector.readable(),true);assert.deepEqual(rows(),before);
    db.prepare("UPDATE tracking_meta SET value='wrong' WHERE key='schema'").run();assert.equal(collector.readable(),false);
  } finally {db.close();collector.close();assert.equal(collector.readable(),false);rmSync(dir,{recursive:true,force:true});}
});
test('listener configuration defaults to loopback; external binding requires an explicit HTTPS origin before any database is created',() => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-listen-'));try {
    const env=inputs(dir,3013);
    for(const listenHost of ['0.0.0.0','::','localhost','127.0.0.2','']) {
      assert.throws(()=>startCollector({...env,TRACKING_LISTEN_HOST:listenHost}));assert.equal(existsSync(env.TRACKING_DATABASE_PATH),false);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('deployment adapter can bind explicitly for a managed TLS proxy; liveness is Host guarded, cache free and read only',async() => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-proxy-')),port=await unusedPort(),env=inputs(dir,port),host='collector.example.test';
  const running=startCollector({...env,TRACKING_PUBLIC_ORIGIN:'https://'+host,TRACKING_LISTEN_HOST:'0.0.0.0'});
  try {
    await once(running.server,'listening');const address=running.server.address();assert.ok(address&&typeof address==='object');assert.equal(address.address,'0.0.0.0');
    const send=(method:string,path:string,override=host,body='')=>new Promise<{status:number;body:string;headers:Record<string,unknown>}>((done,reject)=>{
      const req=request({host:'127.0.0.1',port,method,path,headers:{host:override,'content-length':String(Buffer.byteLength(body))}},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(Buffer.from(c)));res.on('end',()=>done({status:res.statusCode!,body:Buffer.concat(chunks).toString(),headers:res.headers}));});req.on('error',reject);req.end(body);
    });
    const db=new DatabaseSync(env.TRACKING_DATABASE_PATH,{readOnly:true});
    try {
      const before=db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n;
      const health=await send('GET','/healthz');assert.equal(health.status,204);assert.equal(health.body,'');assert.equal(health.headers['cache-control'],'no-store');
      assert.equal((await send('HEAD','/healthz')).status,204);assert.equal((await send('GET','/healthz','foreign.example.test')).status,400);
      assert.equal((await send('POST','/healthz')).status,400);assert.equal((await send('GET','/healthz',host,'x')).status,400);
      assert.equal(db.prepare('SELECT count(*) n FROM tracking_nonces').get()!.n,before);assert.equal(db.prepare('SELECT count(*) n FROM tracking_events').get()!.n,0);
      assert.equal((await send('GET','/p/'+'A'.repeat(43)+'.gif')).status,200);
    } finally {db.close();}
  } finally {const closed=once(running.server,'close');running.close();await closed;rmSync(dir,{recursive:true,force:true});}
});
