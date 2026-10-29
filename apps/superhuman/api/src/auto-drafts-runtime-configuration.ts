import{autoDraftReplyTimeZone}from'./auto-drafts-reply-policy.ts';
import {hkdfSync} from 'node:crypto';
import {AutoDraftModelAdapter,modelTransportIdentity} from './auto-drafts-model.ts';
import {projectAutoDraftModelProfile,type AutoDraftModelProfileInput} from './auto-drafts-readiness.ts';
import type {AutoDraftGenerationOptions} from './server.ts';

/** Explicit CLI-only input. No process.env/files/network/App at import time.
 * Secret values are closure-only, never model-profile or persistence inputs. */
export function loadAutoDraftRuntimeConfiguration(environment:Readonly<NodeJS.ProcessEnv>,options:{modelFetch?:typeof fetch;systemTimeZone?:()=>string}={}):{generation:AutoDraftGenerationOptions|undefined;clear:()=>void}{
 if(!environment||typeof environment!=='object'||Array.isArray(environment)||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['modelFetch','systemTimeZone'].includes(k))||options.systemTimeZone!==undefined&&typeof options.systemTimeZone!=='function'||options.modelFetch!==undefined&&typeof options.modelFetch!=='function')throw new TypeError('Invalid automatic draft runtime configuration');
 const rawMode=environment.AUTO_DRAFTS_PERSISTENCE;if(rawMode!==undefined&&rawMode!=='local'&&rawMode!=='managed')throw new TypeError('Invalid automatic draft persistence');const generatedPersistence=rawMode==='managed'?'managed':'local';
 const read=(name:string)=>{const value=environment[name];if(value===undefined)return undefined;if(typeof value!=='string'||value.length>16384||/[\u0000\r\n]/.test(value.trim()))throw new TypeError('Invalid automatic draft runtime configuration');return value.trim()};
 const tokenKey=read('TOKEN_ENCRYPTION_KEY');if(!tokenKey){if(generatedPersistence==='managed')throw new TypeError('Managed automatic draft persistence requires cursor identity');return{generation:undefined,clear(){}};}if(environment.TOKEN_ENCRYPTION_KEY!==tokenKey||!/^[a-f0-9]{64}$/i.test(tokenKey))throw new TypeError('Invalid automatic draft cursor identity');
 const provider=read('AI_PROVIDER')||'anthropic';if(provider!=='anthropic'&&provider!=='openai')throw new TypeError('Invalid automatic draft model provider');
 const model=read(provider==='anthropic'?'ANTHROPIC_MODEL':'OPENAI_MODEL')||null,secret=read(provider==='anthropic'?'ANTHROPIC_API_KEY':'OPENAI_API_KEY')||null,workspace=provider==='anthropic'?read('ANTHROPIC_WORKSPACE_ID')||undefined:undefined;
 try{modelTransportIdentity({version:'0'.repeat(64),provider,model:model??'unconfigured',...(workspace?{workspaceId:workspace}:{})})}catch{throw new TypeError('Invalid automatic draft model configuration')}
 let replyTimeZone:string;try{if(!environment.TZ)throw Error('No explicit zone');replyTimeZone=autoDraftReplyTimeZone(environment.TZ)}catch{replyTimeZone=autoDraftReplyTimeZone((options.systemTimeZone??(()=>Intl.DateTimeFormat().resolvedOptions().timeZone))())}
 const profile:AutoDraftModelProfileInput=Object.freeze({provider,model,credentialAvailable:secret!==null,...(workspace?{workspaceId:workspace}:{})}),configuration=projectAutoDraftModelProfile(profile,generatedPersistence);
 const key=Buffer.from(tokenKey,'hex');let signer:Buffer;try{signer=Buffer.from(hkdfSync('sha256',key,Buffer.from('superhuman-reconstruction'),Buffer.from('auto-drafts-history-cursor-v1'),32))}finally{key.fill(0)}
 const adapter=new AutoDraftModelAdapter({fetcher:options.modelFetch??fetch,credential:async expected=>{if(!configuration||!secret||expected.version!==configuration.version||expected.provider!==configuration.provider||expected.model!==configuration.model||expected.workspaceId!==configuration.workspaceId)throw Error('Automatic draft model configuration changed');return secret}});
 return{generation:{processing:true,generatedPersistence,replyTimeZone,model:adapter,modelProfile:()=>({...profile}),cursorKey:signer},clear(){signer.fill(0)}};
}
