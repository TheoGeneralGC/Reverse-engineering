import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as reserveServer } from 'node:net';
import { request } from 'node:http';
import { once } from 'node:events';
import { realpathSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startCollector } from '../src/server.ts';
import { createCollector } from '../src/collector.ts';
import { sha256, signedHeaders } from '../src/protocol.ts';

test('real local HTTP adapter keeps public image shape, exact Host/body bounds and authenticated registration; no external services',async() => {
  const root=mkdtempSync(join(realpathSync(tmpdir()),'rea-collector-http-'));
  const reservation=reserveServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const address=reservation.address();assert.ok(address && typeof address === 'object');const port=address.port;
  await new Promise<void>((resolve,reject)=>reservation.close(error => error ? reject(error) : resolve()));
  const key=Buffer.alloc(32,71),tenant='a'.repeat(64),token=randomBytes(32).toString('base64url');
  writeFileSync(join(root,'signers.json'),JSON.stringify([{keyId:'test',tenant,key:key.toString('hex')}]),{mode:0o600});
  writeFileSync(join(root,'cursor.key'),Buffer.alloc(32,72).toString('hex'),{mode:0o600});
  const running=startCollector({TRACKING_DATABASE_PATH:join(root,'collector.sqlite'),TRACKING_SIGNERS_FILE:join(root,'signers.json'),TRACKING_CURSOR_KEY_FILE:join(root,'cursor.key'),TRACKING_PORT:String(port),TRACKING_PUBLIC_ORIGIN:'http://127.0.0.1:'+port});
  try{
    await once(running.server,'listening');
    const send=(method:string,target:string,headers:Record<string,string>={},body=Buffer.alloc(0)) => new Promise<{status:number;body:Buffer;headers:Record<string,unknown>}>((resolve,reject) => {
      const req=request({hostname:'127.0.0.1',port,method,path:target,headers:{'content-length':String(body.length),...headers}},response => {
        const chunks:Buffer[]=[];response.on('data',chunk => chunks.push(Buffer.from(chunk)));response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers,body:Buffer.concat(chunks)}));
      });req.on('error',reject);req.end(body);
    });
    const unknown=await send('GET','/p/'+token+'.gif');assert.equal(unknown.status,200);assert.equal(unknown.headers['content-type'],'image/gif');
    const intent={operationId:'b'.repeat(32),registrationId:'c'.repeat(32),accountRef:'d'.repeat(64),deliveryRef:'e'.repeat(64),tokenDigest:sha256(token),state:'prepared',expectedRevision:0},body=Buffer.from(JSON.stringify(intent));
    const accepted=await send('POST','/v1/registrations',signedHeaders(key,'test','POST','/v1/registrations',body),body);assert.equal(accepted.status,200);
    const known=await send('GET','/p/'+token+'.gif');assert.deepEqual(known.body,unknown.body);
    const head=await send('HEAD','/p/'+token+'.gif');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],unknown.headers['content-length']);
    assert.equal((await send('GET','/p/'+token+'.gif',{host:'evil.invalid'})).status,400);
    assert.equal((await send('POST','/v1/registrations',{'content-type':'application/json'},Buffer.alloc(4097))).status,413);
    const recovered=await send('GET','/v1/requests/'+intent.operationId,signedHeaders(key,'test','GET','/v1/requests/'+intent.operationId,Buffer.alloc(0)));assert.equal(recovered.status,200);assert.deepEqual(recovered.body,accepted.body);
  }finally{
    const closed=once(running.server,'close');running.close();await closed;rmSync(root,{recursive:true,force:true});
  }
});

test('collector refuses an unrelated existing database before changing any schema or record',() => {
  const root=mkdtempSync(join(realpathSync(tmpdir()),'rea-collector-db-')),path=join(root,'unrelated.sqlite');
  try{
    const original=new DatabaseSync(path);original.exec('CREATE TABLE unrelated(id TEXT PRIMARY KEY,value TEXT); INSERT INTO unrelated VALUES(\'sentinel\',\'unchanged\')');original.close();
    assert.throws(()=>createCollector({databasePath:path,signers:new Map([['test',{tenant:'a'.repeat(64),key:Buffer.alloc(32,31)}]]),cursorKey:Buffer.alloc(32,32)}),/collector_database_identity_mismatch/);
    const check=new DatabaseSync(path,{readOnly:true});try{
      assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name),['unrelated']);
      assert.equal(check.prepare("SELECT value FROM unrelated WHERE id='sentinel'").get()!.value,'unchanged');
    }finally{check.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});
