import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,symlinkSync,existsSync,readdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareDeploymentEnvironment} from '../src/bootstrap.ts';
import {listenerConfiguration} from '../src/server.ts';

const tenant='a'.repeat(64),signer='21'.repeat(32),cursor='22'.repeat(32);
const directory=()=>realpathSync(mkdtempSync(join(tmpdir(),'collector-deployment-independent-')));
function env(root:string):NodeJS.ProcessEnv{return{TRACKING_DATABASE_PATH:join(root,'collector.sqlite'),TRACKING_PUBLIC_ORIGIN:'https://collector.example.test',TRACKING_LISTEN_HOST:'0.0.0.0',TRACKING_BOOTSTRAP_SIGNERS_JSON:JSON.stringify([{keyId:'main',tenant,key:signer}]),TRACKING_BOOTSTRAP_CURSOR_KEY:cursor}}

test('all malformed endpoint/path configuration fails before bootstrap creates private files',()=>{
 const variants=[{TRACKING_DATABASE_PATH:'relative.sqlite'},{TRACKING_DATABASE_PATH:':memory:'},{TRACKING_DATABASE_PATH:'$nul'},{TRACKING_PUBLIC_ORIGIN:'https://collector.example.test/'},{TRACKING_PUBLIC_ORIGIN:'https://user:password@collector.example.test'},{TRACKING_LISTEN_HOST:'0.0.0.0',TRACKING_PUBLIC_ORIGIN:'http://127.0.0.1:3013'},{TRACKING_PORT:'3013\n'}];
 for(const variant of variants){const root=directory();try{const input={...env(root),...variant};if(input.TRACKING_DATABASE_PATH==='$nul')input.TRACKING_DATABASE_PATH=join(root,'bad\0.sqlite');let rejected=false;try{prepareDeploymentEnvironment(input)}catch{rejected=true}assert.equal(rejected,true,'Malformed deployment configuration must be rejected');assert.deepEqual(readdirSync(root),[],'Invalid configuration must not create secret directories or files')}finally{rmSync(root,{recursive:true,force:true})}}
});

test('bootstrap refuses an existing symlink anywhere in the declared durable directory path',()=>{
 const root=directory(),outside=directory();try{mkdirSync(join(outside,'nested'));symlinkSync(outside,join(root,'alias'));const input={...env(root),TRACKING_DATABASE_PATH:join(root,'alias','nested','collector.sqlite')};let rejected=false;try{prepareDeploymentEnvironment(input)}catch{rejected=true}assert.equal(rejected,true,'A symlink ancestor must not redirect private secret material');assert.deepEqual(readdirSync(join(outside,'nested')),[],'No secret material may be written through the alias')}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}
});

test('bootstrap never creates the missing second secret when an existing first target is a directory or a symlink',()=>{
 for(const kind of ['directory','symlink']){const root=directory();try{mkdirSync(join(root,'.collector-private'),{mode:0o700});const target=join(root,'.collector-private','initial');mkdirSync(target,{mode:0o700});const first=join(target,'signers.json');if(kind==='directory')mkdirSync(first,{mode:0o700});else{const original=join(root,'original');writeFileSync(original,'unrelated',{mode:0o600});symlinkSync(original,first)}assert.throws(()=>prepareDeploymentEnvironment(env(root)));assert.equal(existsSync(join(target,'cursor.key')),false);if(kind==='symlink')assert.equal(readFileSync(join(root,'original'),'utf8'),'unrelated')}finally{rmSync(root,{recursive:true,force:true})}}
});

test('bootstrap rejects unknown signer fields and malformed key encodings without filesystem changes',()=>{
 const variants=[{keyId:'main',tenant,key:signer,extra:true},{keyId:'main',tenant,key:'g'.repeat(64)},{keyId:'main',tenant:'b'.repeat(63),key:signer},{keyId:'main',tenant,key:'2'.repeat(65)}];
 for(const value of variants){const root=directory();try{assert.throws(()=>prepareDeploymentEnvironment({...env(root),TRACKING_BOOTSTRAP_SIGNERS_JSON:JSON.stringify([value])}));assert.deepEqual(readdirSync(root),[])}finally{rmSync(root,{recursive:true,force:true})}}
});

test('canonical managed and local listener configuration is explicit and never implies TLS readiness',()=>{
 const root=directory();try{assert.deepEqual(listenerConfiguration(env(root)),{databasePath:join(root,'collector.sqlite'),port:3013,origin:new URL('https://collector.example.test'),listenHost:'0.0.0.0'});const local=listenerConfiguration({...env(root),TRACKING_LISTEN_HOST:'127.0.0.1',TRACKING_PUBLIC_ORIGIN:'http://127.0.0.1:3013'});assert.equal(local.listenHost,'127.0.0.1');assert.equal(local.origin.protocol,'http:');assert.deepEqual(readdirSync(root),[])}finally{rmSync(root,{recursive:true,force:true})}
});
