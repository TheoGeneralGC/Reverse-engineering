import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDeploymentEnvironment } from '../src/bootstrap.ts';
const tenant='a'.repeat(64),key='21'.repeat(32),cursor='22'.repeat(32);
function env(dir: string) {return {TRACKING_DATABASE_PATH:join(dir,'collector.sqlite'),TRACKING_PUBLIC_ORIGIN:'https://collector.example.test',TRACKING_LISTEN_HOST:'0.0.0.0',TRACKING_BOOTSTRAP_SIGNERS_JSON:JSON.stringify([{keyId:'primary',tenant,key}]),TRACKING_BOOTSTRAP_CURSOR_KEY:cursor};}
test('deployment bootstrap writes only private stable keys; repeats are read-only and input environment remains unchanged',() => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-bootstrap-'));try{
    const input=env(dir),snapshot=JSON.stringify(input),configured=prepareDeploymentEnvironment(input);
    assert.equal(JSON.stringify(input),snapshot);assert.equal(configured.TRACKING_BOOTSTRAP_SIGNERS_JSON,undefined);assert.equal(configured.TRACKING_BOOTSTRAP_CURSOR_KEY,undefined);
    assert.equal(statSync(configured.TRACKING_SIGNERS_FILE!).mode & 0o077,0);assert.equal(statSync(join(dir,'.collector-private')).mode & 0o077,0);
    const before=[readFileSync(configured.TRACKING_SIGNERS_FILE!),readFileSync(configured.TRACKING_CURSOR_KEY_FILE!)],mtime=[statSync(configured.TRACKING_SIGNERS_FILE!).mtimeMs,statSync(configured.TRACKING_CURSOR_KEY_FILE!).mtimeMs];
    assert.deepEqual(prepareDeploymentEnvironment(input),configured);assert.deepEqual([statSync(configured.TRACKING_SIGNERS_FILE!).mtimeMs,statSync(configured.TRACKING_CURSOR_KEY_FILE!).mtimeMs],mtime);
    assert.throws(()=>prepareDeploymentEnvironment({...input,TRACKING_BOOTSTRAP_CURSOR_KEY:'23'.repeat(32)}));
    assert.deepEqual([readFileSync(configured.TRACKING_SIGNERS_FILE!),readFileSync(configured.TRACKING_CURSOR_KEY_FILE!)],before);assert.equal(existsSync(input.TRACKING_DATABASE_PATH),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid/ambiguous secrets fail before creating private configuration files; symlink outputs are refused without replacing their target',() => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-bootstrap-input-'));try{
    const input=env(dir);
    for(const change of [{TRACKING_PUBLIC_ORIGIN:'not-a-url'},{TRACKING_LISTEN_HOST:'0.0.0.1'},{TRACKING_PORT:'0'},{TRACKING_BOOTSTRAP_SIGNERS_JSON:'not-json'},{TRACKING_BOOTSTRAP_CURSOR_KEY:''},{TRACKING_CONFIG_REVISION:'../../outside'},{TRACKING_SIGNERS_FILE:join(dir,'unused')},{TRACKING_BOOTSTRAP_SIGNERS_JSON:JSON.stringify([{keyId:'primary',tenant,key},{keyId:'primary',tenant,key}])}]){
      assert.throws(()=>prepareDeploymentEnvironment({...input,...change}));assert.equal(existsSync(join(dir,'.collector-private')),false);
    }
    const configured=prepareDeploymentEnvironment(input),file=configured.TRACKING_SIGNERS_FILE!,before=readFileSync(file);rmSync(file);const unrelated=join(dir,'unrelated');writeFileSync(unrelated,before,{mode:0o600});symlinkSync(unrelated,file);
    assert.throws(()=>prepareDeploymentEnvironment(input));assert.deepEqual(readFileSync(unrelated),before);assert.equal(statSync(unrelated).mode&0o077,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('a conflicting second key prevents creation of a missing first key',() => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'rea-tracking-bootstrap-pair-'));try{
    const input=env(dir),configured=prepareDeploymentEnvironment(input),signer=configured.TRACKING_SIGNERS_FILE!,cursorFile=configured.TRACKING_CURSOR_KEY_FILE!;
    rmSync(signer);writeFileSync(cursorFile,'23'.repeat(32)+'\n',{mode:0o600});
    assert.throws(()=>prepareDeploymentEnvironment(input));assert.equal(existsSync(signer),false);assert.equal(readFileSync(cursorFile,'utf8'),'23'.repeat(32)+'\n');
    assert.equal(existsSync(input.TRACKING_DATABASE_PATH),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
