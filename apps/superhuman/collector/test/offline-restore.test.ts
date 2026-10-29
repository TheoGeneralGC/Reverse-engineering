import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, cpSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { prepareDeploymentEnvironment } from '../src/bootstrap.ts';
import { createCollector } from '../src/collector.ts';
import { signedHeaders } from '../src/protocol.ts';

test('a stopped synthetic collector offline directory backup restores exact receipts, event cursor and replay protection with stable private keys',()=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'rea-collector-offline-restore-')),data=join(root,'data'),backup=join(root,'backup'),restored=join(root,'restored');mkdirSync(data,{mode:0o700});
 const tenant='a'.repeat(64),account='b'.repeat(64),registration='1'.repeat(32),delivery='c'.repeat(64),ack='d'.repeat(64),key=randomBytes(32),cursor=randomBytes(32),token=randomBytes(32).toString('base64url'),time=Date.parse('2026-10-29T03:00:00Z');let sequence=0;
 const env=(path:string)=>({TRACKING_DATABASE_PATH:join(path,'collector.sqlite'),TRACKING_PUBLIC_ORIGIN:'https://collector.example.test',TRACKING_BOOTSTRAP_SIGNERS_JSON:JSON.stringify([{keyId:'main',tenant,key:key.toString('hex')}]),TRACKING_BOOTSTRAP_CURSOR_KEY:cursor.toString('hex')});
 const open=(path:string)=>{
  const config=prepareDeploymentEnvironment(env(path)),signers=JSON.parse(readFileSync(config.TRACKING_SIGNERS_FILE!,'utf8')) as {keyId:string;tenant:string;key:string}[];
  return {config,collector:createCollector({databasePath:config.TRACKING_DATABASE_PATH!,signers:new Map(signers.map(v=>[v.keyId,{tenant:v.tenant,key:Buffer.from(v.key,'hex')}])),cursorKey:Buffer.from(readFileSync(config.TRACKING_CURSOR_KEY_FILE!,'utf8').trim(),'hex'),now:()=>time})};
 };
 let active:ReturnType<typeof open>|undefined;
 try{
  active=open(data);const request=(method:string,target:string,value?:unknown)=>{const body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value));return{method,target,body,headers:signedHeaders(key,'main',method,target,body,time,randomBytes(24).toString('base64url'))}};
  const send=(method:string,target:string,value?:unknown)=>{const r=active!.collector.handle(request(method,target,value));assert.equal(r.status,200);return JSON.parse(r.body.toString())};const operation=()=> (++sequence).toString(16).padStart(32,'0');
  const createKey=operation(),accepted=send('POST','/v1/registrations',{operationId:createKey,registrationId:registration,accountRef:account,deliveryRef:delivery,tokenDigest:createHash('sha256').update(token).digest('hex'),state:'prepared',expectedRevision:0});
  send('POST','/v1/registrations/'+registration,{operationId:operation(),expectedRevision:1,state:'armed',acknowledgementRef:null});send('POST','/v1/registrations/'+registration,{operationId:operation(),expectedRevision:2,state:'confirmed',acknowledgementRef:ack});
  for(let i=0;i<2;i++)assert.equal(active.collector.handle({method:'GET',target:'/p/'+token+'.gif',headers:{}}).status,200);
  const first=send('GET','/v1/events?accountRef='+account+'&limit=1');assert.equal(first.events.length,1);assert.equal(typeof first.nextCursor,'string');
  const replay=request('GET','/v1/requests/'+createKey);assert.equal(active.collector.handle(replay).status,200);
  const sourceMainBefore=()=>createHash('sha256').update(readFileSync(join(data,'collector.sqlite'))).digest('hex');
  active.collector.close();active=undefined;const stoppedHash=sourceMainBefore();
  cpSync(data,backup,{recursive:true,errorOnExist:true,force:false});cpSync(backup,restored,{recursive:true,errorOnExist:true,force:false});assert.equal(sourceMainBefore(),stoppedHash);
  const restoredSigner=join(restored,'.collector-private','initial','signers.json'),restoredCursor=join(restored,'.collector-private','initial','cursor.key'),keyBytes=[readFileSync(restoredSigner),readFileSync(restoredCursor)],keyMtimes=[statSync(restoredSigner).mtimeMs,statSync(restoredCursor).mtimeMs];
  active=open(restored);assert.deepEqual([readFileSync(restoredSigner),readFileSync(restoredCursor)],keyBytes);assert.deepEqual([statSync(restoredSigner).mtimeMs,statSync(restoredCursor).mtimeMs],keyMtimes);
  assert.equal(active.collector.handle(replay).status,401);assert.deepEqual(send('GET','/v1/requests/'+createKey),accepted);
  const second=send('GET','/v1/events?accountRef='+account+'&cursor='+encodeURIComponent(first.nextCursor)+'&limit=1');assert.equal(second.events.length,1);assert.notEqual(second.events[0].id,first.events[0].id);assert.equal(second.nextCursor,null);assert.equal(second.events[0].acknowledgementRef,ack);assert.equal(second.events[0].viewer,null);
  assert.equal(sourceMainBefore(),stoppedHash);
 }finally{active?.collector.close();key.fill(0);cursor.fill(0);rmSync(root,{recursive:true,force:true});}
});
