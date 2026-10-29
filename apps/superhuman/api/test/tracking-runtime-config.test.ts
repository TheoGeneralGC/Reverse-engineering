import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, createHash } from 'node:crypto';
import { loadTrackingRuntimeConfiguration } from '../src/tracking-runtime-config.ts';
import { TrackingCollectorClient } from '../src/tracking-collector.ts';
const signer={version:1,keyId:'owned',tenant:'a'.repeat(64),key:'21'.repeat(32)},origin='https://collector.example.test';
const temp=()=>mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-runtime-'));
function write(root:string,value:unknown=signer){const path=join(root,'signer.json');writeFileSync(path,JSON.stringify(value),{mode:0o600});return path;}
const rejected=(env:NodeJS.ProcessEnv)=>assert.throws(()=>loadTrackingRuntimeConfiguration(env),error=>error instanceof TypeError&&error.message==='Read-tracking runtime configuration is invalid.'&&!String(error).includes(signer.key));
test('absent configuration is disabled; incomplete or empty explicit fields fail closed without defaults',()=>{
 assert.equal(loadTrackingRuntimeConfiguration({}),undefined);
 for(const env of [{TRACKING_PUBLIC_ORIGIN:origin},{TRACKING_MAIN_SIGNER_FILE:'/missing/signers.json'},{TRACKING_COLLECTOR_TIMEOUT_MS:'5000'},{TRACKING_PUBLIC_ORIGIN:'',TRACKING_MAIN_SIGNER_FILE:''}])rejected(env);
});
test('valid explicit private envelope loads without requests or writes, and the caller key can be erased after client construction',()=>{
 const root=temp();try{
  const path=write(root),before=readFileSync(path),mtime=statSync(path).mtimeMs;let requests=0;
  const configuration=loadTrackingRuntimeConfiguration({TRACKING_PUBLIC_ORIGIN:origin,TRACKING_MAIN_SIGNER_FILE:path,TRACKING_COLLECTOR_TIMEOUT_MS:'9000'},async()=>{requests++;throw Error('No network permitted')});assert.ok(configuration);
  assert.equal(configuration.origin,origin);assert.equal(configuration.timeoutMs,9000);assert.equal(configuration.key.toString('hex'),signer.key);
  const client=new TrackingCollectorClient(configuration),fingerprint=client.capability().configurationFingerprint;configuration.key.fill(0);assert.equal(client.capability().configurationFingerprint,fingerprint);client.close();
  assert.equal(requests,0);assert.deepEqual(readFileSync(path),before);assert.equal(statSync(path).mtimeMs,mtime);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('wrong file type, broad permissions and leaf/ancestor symlinks are refused without changing their targets',()=>{
 const root=temp();try{
  const path=write(root),env={TRACKING_PUBLIC_ORIGIN:origin,TRACKING_MAIN_SIGNER_FILE:path},before=readFileSync(path);
  chmodSync(path,0o644);rejected(env);assert.deepEqual(readFileSync(path),before);chmodSync(path,0o600);
  const alias=join(root,'alias.json');symlinkSync(path,alias);rejected({...env,TRACKING_MAIN_SIGNER_FILE:alias});assert.deepEqual(readFileSync(path),before);
  const real=join(root,'real'),nested=join(real,'nested');mkdirSync(real);mkdirSync(nested);const nestedPath=write(nested),directoryAlias=join(root,'directory-alias');symlinkSync(real,directoryAlias,'dir');rejected({...env,TRACKING_MAIN_SIGNER_FILE:join(directoryAlias,'nested','signer.json')});assert.deepEqual(readFileSync(nestedPath),before);
  rejected({...env,TRACKING_MAIN_SIGNER_FILE:real});chmodSync(root,0o777);rejected(env);chmodSync(root,0o700);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('the advertised0600 signer mode refuses read-only, owner execution and the retained sticky permission bit',()=>{
 const root=temp();try{
  const path=write(root),env={TRACKING_PUBLIC_ORIGIN:origin,TRACKING_MAIN_SIGNER_FILE:path},before=readFileSync(path);
  for(const mode of [0o400,0o700,0o1600]){chmodSync(path,mode);assert.equal(statSync(path).mode&0o7777,mode);rejected(env);assert.deepEqual(readFileSync(path),before);}
  chmodSync(path,0o600);const loaded=loadTrackingRuntimeConfiguration(env);assert.ok(loaded);loaded.key.fill(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('malformed shape, hex, UTF-8, oversized and empty envelopes yield one sanitized failure',()=>{
 const root=temp();try{
  const path=write(root),env={TRACKING_PUBLIC_ORIGIN:origin,TRACKING_MAIN_SIGNER_FILE:path};
  for(const value of [{...signer,extra:true},{...signer,version:2},{...signer,keyId:'bad id'},{...signer,tenant:'b'.repeat(63)},{...signer,key:'2'.repeat(65)},{...signer,key:'AB'.repeat(32)},[signer],null]){writeFileSync(path,JSON.stringify(value));rejected(env);}
  for(const bytes of [Buffer.alloc(0),Buffer.from([0xff,0xfe]),Buffer.alloc(16385,0x20)]){writeFileSync(path,bytes);rejected(env);assert.deepEqual(readFileSync(path),bytes);}
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a client retains its copied signing identity after the loader caller erases its temporary key buffer',async()=>{
 const root=temp();try{
  const path=write(root);let calls=0,captured:{url:string;method:string|undefined;headers:Headers}|undefined;
  const configuration=loadTrackingRuntimeConfiguration({TRACKING_PUBLIC_ORIGIN:origin,TRACKING_MAIN_SIGNER_FILE:path},async(url,init={})=>{
   calls++;captured={url:String(url),method:init.method,headers:new Headers(init.headers)};
   return Response.json({error:{code:'registration_not_found'}},{status:404});
  });assert.ok(configuration);assert.equal(calls,0);const client=new TrackingCollectorClient(configuration);configuration.key.fill(0);
  try{
   await assert.rejects(client.current({registrationId:'b'.repeat(32),accountRef:'c'.repeat(64),deliveryRef:'d'.repeat(64),tokenDigest:'e'.repeat(64)}));assert.equal(calls,1);assert.ok(captured);
   assert.equal(captured.url,origin+'/v1/registrations/'+'b'.repeat(32));assert.equal(captured.method,'GET');
   const headers=captured.headers,canonical=['rea-tracking-v1',signer.keyId,'GET','/v1/registrations/'+'b'.repeat(32),headers.get('x-rea-time'),headers.get('x-rea-nonce'),createHash('sha256').update(Buffer.alloc(0)).digest('hex')].join('\n');
   assert.equal(headers.get('x-rea-signature'),createHmac('sha256',Buffer.from(signer.key,'hex')).update(canonical).digest('hex'));
  }finally{client.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('origin, destination and timeout validation cannot make a request or become a silent unconfigured fallback',()=>{
 const root=temp();try{
  const path=write(root),env={TRACKING_PUBLIC_ORIGIN:origin,TRACKING_MAIN_SIGNER_FILE:path};
  for(const value of ['http://collector.example.test','https://127.0.0.1','https://collector.example.test/','https://user:password@collector.example.test','https://collector.example.test/path','not-a-url'])rejected({...env,TRACKING_PUBLIC_ORIGIN:value});
  for(const value of ['','0','001','30001','5000\n','Infinity'])rejected({...env,TRACKING_COLLECTOR_TIMEOUT_MS:value});
  for(const value of ['relative.json',join(root,'bad\0.json'),join(root,'missing.json')])rejected({...env,TRACKING_MAIN_SIGNER_FILE:value});
 }finally{rmSync(root,{recursive:true,force:true});}
});
