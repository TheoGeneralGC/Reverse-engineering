// Host packaging only; collector/protocol45 remain byte-identical.
import{mkdirSync,lstatSync,realpathSync,chownSync}from'node:fs';
import{join,dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';
import{listenerConfiguration}from'../src/server.ts';
import{startDeployment}from'../src/bootstrap.ts';
const fail=()=>{throw Error('invalid_render_configuration')};
export function checkedRenderEnvironment(raw,mount='/var/data'){
 if(raw.TRACKING_DATABASE_PATH!==join(mount,'collector/collector.sqlite')||raw.TRACKING_PORT!=='10000'||raw.PORT!=='10000'||raw.TRACKING_LISTEN_HOST!=='0.0.0.0')fail();
 listenerConfiguration(raw);
 if(raw.RENDER_EXTERNAL_URL!==undefined&&raw.RENDER_EXTERNAL_URL!==raw.TRACKING_PUBLIC_ORIGIN)fail();
 if(typeof raw.TRACKING_PUBLIC_ORIGIN!=='string'||!raw.TRACKING_PUBLIC_ORIGIN.startsWith('https://')||raw.TRACKING_SIGNERS_FILE!==undefined||raw.TRACKING_CURSOR_KEY_FILE!==undefined)fail();
 const text=raw.TRACKING_BOOTSTRAP_SIGNERS_JSON,cursor=raw.TRACKING_BOOTSTRAP_CURSOR_KEY,revision=raw.TRACKING_CONFIG_REVISION??'initial';
 if(typeof text!=='string'||Buffer.byteLength(text)>16384||typeof cursor!=='string'||!/^[a-f0-9]{64,128}$/.test(cursor)||cursor.length%2||!/^[a-zA-Z0-9_-]{1,48}$/.test(revision))fail();
 let signers;try{signers=JSON.parse(text)}catch{fail()}if(!Array.isArray(signers)||!signers.length||signers.length>32)fail();const ids=new Set();
 for(const s of signers){if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).sort().join(',')!=='key,keyId,tenant'||typeof s.keyId!=='string'||!/^[a-zA-Z0-9_-]{1,48}$/.test(s.keyId)||ids.has(s.keyId)||typeof s.tenant!=='string'||!/^[a-f0-9]{64}$/.test(s.tenant)||typeof s.key!=='string'||!/^[a-f0-9]{64,128}$/.test(s.key)||s.key.length%2)fail();ids.add(s.keyId)}
 return{...raw,TRACKING_CONFIG_REVISION:revision};
}
export function prepareDataDirectory(mount='/var/data',uid=1000,gid=1000){
 if(resolve(mount)!==mount||realpathSync(mount)!==mount||!lstatSync(mount).isDirectory())fail();const path=join(mount,'collector');let made=false;
 try{mkdirSync(path,{mode:0o700});made=true}catch(e){if(e?.code!=='EEXIST')fail()}
 if(made&&process.getuid?.()===0)chownSync(path,uid,gid);
 const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path||(s.mode&0o077)!==0||s.uid!==uid||s.gid!==gid)fail();
 const db=join(path,'collector.sqlite');try{const t=lstatSync(db);if(!t.isFile()||t.isSymbolicLink()||t.uid!==uid||(t.mode&0o077)!==0)fail()}catch(e){if(e?.code!=='ENOENT')fail()}
 return path;
}
export function startRender(raw){if(process.version!=='v24.22.1'||process.platform!=='linux')fail();const env=checkedRenderEnvironment(raw);prepareDataDirectory();if(process.getuid()===0){process.setgroups([]);process.setgid(1000);process.setuid(1000)}if(process.getuid()!==1000||process.getgid()!==1000)fail();return startDeployment(env)}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length===3&&process.argv[2]==='--execute'){try{const running=startRender(process.env);process.once('SIGINT',running.close);process.once('SIGTERM',running.close)}catch{process.stderr.write('Collector host startup failed. No configuration values are logged.\n');process.exitCode=1}}else{console.log(JSON.stringify({preparedOnly:true,requiresExplicitExecute:true,opensDatabase:false,startsListener:false}))}}
