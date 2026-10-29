import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, symlinkSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDeploymentEnvironment } from '../src/bootstrap.ts';
import { startCollector } from '../src/server.ts';
const tenant='a'.repeat(64),key='21'.repeat(32),cursor='22'.repeat(32);
function configuration(dir: string) {return {TRACKING_DATABASE_PATH:join(dir,'collector.sqlite'),TRACKING_PUBLIC_ORIGIN:'https://collector.example.test',TRACKING_BOOTSTRAP_SIGNERS_JSON:JSON.stringify([{keyId:'primary',tenant,key}]),TRACKING_BOOTSTRAP_CURSOR_KEY:cursor};}
test('NUL filename and existing database leaf symlink fail before private-key or database writes',() => {
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-collector-destination-'));
 try{
  const input=configuration(dir);
  assert.throws(()=>prepareDeploymentEnvironment({...input,TRACKING_DATABASE_PATH:join(dir,'invalid\0.sqlite')}));assert.equal(existsSync(join(dir,'.collector-private')),false);
  const target=join(dir,'unrelated.sqlite');writeFileSync(target,Buffer.alloc(0));symlinkSync(target,input.TRACKING_DATABASE_PATH);
  assert.throws(()=>prepareDeploymentEnvironment(input));assert.equal(existsSync(join(dir,'.collector-private')),false);assert.equal(readFileSync(target).length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('ancestor directory alias cannot redirect private bootstrap files',() => {
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-collector-ancestor-'));
 try{
  const real=join(dir,'real'),nested=join(real,'nested'),alias=join(dir,'alias');mkdirSync(real);mkdirSync(nested);symlinkSync(real,alias,'dir');
  assert.throws(()=>prepareDeploymentEnvironment(configuration(join(alias,'nested'))));assert.equal(existsSync(join(nested,'.collector-private')),false);assert.equal(existsSync(join(nested,'collector.sqlite')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('direct CLI refuses high-bit cursor bytes rather than silently folding them into a different key',() => {
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-collector-cursor-bytes-'));
 try{
  const signers=join(dir,'signers.json'),cursorFile=join(dir,'cursor.key'),database=join(dir,'collector.sqlite');
  writeFileSync(signers,JSON.stringify([{keyId:'primary',tenant,key}]),{mode:0o600});const bytes=Buffer.from(cursor);for(let i=0;i<bytes.length;i++)bytes[i]|=0x80;writeFileSync(cursorFile,bytes,{mode:0o600});
  assert.throws(()=>startCollector({TRACKING_DATABASE_PATH:database,TRACKING_PUBLIC_ORIGIN:'https://collector.example.test',TRACKING_SIGNERS_FILE:signers,TRACKING_CURSOR_KEY_FILE:cursorFile}));
  assert.equal(existsSync(database),false);assert.deepEqual(readFileSync(cursorFile),bytes);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
