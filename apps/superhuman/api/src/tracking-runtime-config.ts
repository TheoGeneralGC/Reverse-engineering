import { openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, constants } from 'node:fs';
import { isAbsolute, resolve, dirname } from 'node:path';
import { TrackingCollectorClient, type CollectorConfiguration } from './tracking-collector.ts';
import {parseTrackingOperatorVerification}from'./tracking-runtime-capability.ts';
const invalid=()=>new TypeError('Read-tracking runtime configuration is invalid.');
function privateJson(path:unknown):unknown{
 if(typeof path!=='string'||path.includes('\0')||!isAbsolute(path)||resolve(path)!==path)throw invalid();
 const parent=dirname(path),parentStat=lstatSync(parent);if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||(parentStat.mode&0o022)!==0||realpathSync(parent)!==parent)throw invalid();
 const leaf=lstatSync(path);if(!leaf.isFile()||leaf.isSymbolicLink()||(leaf.mode&0o7777)!==0o600||leaf.size<1||leaf.size>16384||typeof constants.O_NOFOLLOW!=='number'||typeof constants.O_NONBLOCK!=='number')throw invalid();
 const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),buffer=Buffer.alloc(16385);try{const stat=fstatSync(descriptor);if(!stat.isFile()||stat.dev!==leaf.dev||stat.ino!==leaf.ino||(stat.mode&0o7777)!==0o600||stat.size<1||stat.size>16384)throw invalid();let size=0;while(size<buffer.length){const n=readSync(descriptor,buffer,size,buffer.length-size,null);if(!n)break;size+=n}if(size<1||size>16384)throw invalid();return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,size)))}finally{buffer.fill(0);closeSync(descriptor)}
}
/** Explicit CLI seam only: no import-time access, defaults, writes or requests. */
export function loadTrackingRuntimeConfiguration(env:NodeJS.ProcessEnv,transport:typeof fetch=fetch):CollectorConfiguration|undefined{
 const origin=env.TRACKING_PUBLIC_ORIGIN,path=env.TRACKING_MAIN_SIGNER_FILE,timeoutRaw=env.TRACKING_COLLECTOR_TIMEOUT_MS,source=env.TRACKING_COLLECTOR_SOURCE_IDENTITY,verificationFile=env.TRACKING_OPERATOR_VERIFICATION_FILE;
 if([origin,path,timeoutRaw,source,verificationFile].every(v=>v===undefined))return undefined;let key:Buffer|undefined;
 try{if(typeof origin!=='string'||!origin||timeoutRaw!==undefined&&(!/^[1-9]\d{0,4}$/.test(timeoutRaw)||Number(timeoutRaw)>30000)||source!==undefined&&!/^[a-f0-9]{64}$/.test(source)||verificationFile!==undefined&&source===undefined)throw invalid();
  const parsed=privateJson(path);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).sort().join(',')!=='key,keyId,tenant,version')throw invalid();const signer=parsed as Record<string,unknown>;
  if(signer.version!==1||typeof signer.keyId!=='string'||typeof signer.tenant!=='string'||typeof signer.key!=='string'||!/^[a-f0-9]{64,128}$/.test(signer.key)||signer.key.length%2!==0)throw invalid();key=Buffer.from(signer.key,'hex');
  const configuration:CollectorConfiguration={origin,keyId:signer.keyId,tenant:signer.tenant,key,transport,...(timeoutRaw===undefined?{}:{timeoutMs:Number(timeoutRaw)}),...(source===undefined?{}:{collectorSourceIdentity:source}),...(verificationFile===undefined?{}:{operatorVerification:parseTrackingOperatorVerification(privateJson(verificationFile))})};
  const validator=new TrackingCollectorClient(configuration);validator.close();return configuration;
 }catch{key?.fill(0);throw invalid()}
}
