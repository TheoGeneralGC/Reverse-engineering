import { ApiError } from './api.ts';
import { mailFetch } from './mail-fetch.ts';
import type { KnowledgeSource,KnowledgeSourcePage,KnowledgeStatus,KnowledgeActionRequest,KnowledgeActionResponse } from '../../api/src/knowledge-types.ts';
export type { KnowledgeSource,KnowledgeSourcePage,KnowledgeStatus,KnowledgeActionRequest,KnowledgeActionResponse };
export type KnowledgeRequest=(path:string,body?:unknown,method?:string,options?:{signal?:AbortSignal;raw?:boolean})=>Promise<unknown>;
export type KnowledgeStorage={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void};
export type KnowledgeFile={name:string;size:number;arrayBuffer:()=>Promise<ArrayBuffer>};
export const KNOWLEDGE_MAX_BYTES=50*1024*1024;
export const KNOWLEDGE_EXTENSIONS=['c','cpp','cs','css','doc','docx','go','html','java','js','json','md','pdf','php','pptx','py','rb','sh','tex','ts','txt'];
export const wellFormed=(text:string)=>!/[\uD800-\uDFFF]/u.test(text);
export const utf8=(text:string)=>new TextEncoder().encode(text).length;
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const knowledgeId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=1024&&wellFormed(value)&&!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function knowledgeFileError(file:KnowledgeFile):string{
 if(!file.name||!wellFormed(file.name)||utf8(file.name)>1024||/[\x00-\x1f\x7f/\\]/.test(file.name))return 'Choose a valid file name.';
 const extension=file.name.slice(file.name.lastIndexOf('.')+1).toLowerCase();if(!file.name.includes('.')||!KNOWLEDGE_EXTENSIONS.includes(extension))return 'This file type is not supported.';
 if(!Number.isSafeInteger(file.size)||file.size<=0)return 'The selected file is empty.';if(file.size>KNOWLEDGE_MAX_BYTES)return 'Files must be 50 MiB or smaller.';return '';
}
export function knowledgeUrl(raw:string){
 if(!wellFormed(raw)||utf8(raw)>4096||/[\x00-\x20\x7f]/.test(raw))throw Error('Enter a public HTTPS page without embedded credentials.');
 let url:URL;try{url=new URL(raw)}catch{throw Error('Enter a public HTTPS page without embedded credentials.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!url.hostname||url.hostname.endsWith('.'))throw Error('Enter a public HTTPS page without embedded credentials.');url.hash='';const normalized=url.toString();if(utf8(normalized)>4096)throw Error('Use a page link of at most 4,096 UTF-8 bytes after URL encoding.');return normalized;
}
export function validKnowledgeSource(value:unknown,accountId:string,id?:string):value is KnowledgeSource{
 if(!object(value)||value.accountId!==accountId||!knowledgeId(value.id)||id!==undefined&&value.id!==id||!Number.isSafeInteger(value.revision)||value.revision<1||value.visibility!=='private'||!['file','link'].includes(value.kind)||!['pending','processing','ready','error'].includes(value.status)||typeof value.name!=='string'||utf8(value.name)>2048||typeof value.description!=='string'||utf8(value.description)>20000||!date(value.createdAt)||!date(value.updatedAt)||!knowledgeId(value.contentVersion)||!hash(value.contentHash)||value.indexedAt!==null&&!date(value.indexedAt)||![value.chunkCount,value.extractedBytes].every(number=>Number.isSafeInteger(number)&&number>=0)||typeof value.truncated!=='boolean')return false;
 if(value.error!==null&&(!object(value.error)||typeof value.error.message!=='string'||value.error.message.length>4096||typeof value.error.code!=='string'||!['explicit','none'].includes(value.error.retry)))return false;
 if(value.kind==='file')return object(value.file)&&typeof value.file.name==='string'&&value.file.name.length<=1024&&Number.isSafeInteger(value.file.bytes)&&value.file.bytes>0&&value.file.bytes<=KNOWLEDGE_MAX_BYTES&&typeof value.file.mediaType==='string'&&KNOWLEDGE_EXTENSIONS.includes(value.file.extension)&&hash(value.file.sha256)&&value.file.sha256===value.contentHash;
 if(!object(value.link)||value.link.scope!=='single-page'||typeof value.link.url!=='string'||typeof value.link.requestedUrl!=='string'||value.link.fetchedAt!==null&&!date(value.link.fetchedAt))return false;
 try{return knowledgeUrl(value.link.url)===value.link.url&&knowledgeUrl(value.link.requestedUrl)===value.link.requestedUrl}catch{return false}
}
export function parseKnowledgeSource(value:unknown,accountId:string,id?:string):KnowledgeSource{if(!object(value)||!validKnowledgeSource(value.source,accountId,id))throw Error('Unexpected Private Knowledge response. No source was applied.');return structuredClone(value.source)}
export function parseKnowledgePage(value:unknown,accountId:string):KnowledgeSourcePage{if(!object(value)||!Array.isArray(value.sources)||value.sources.length>100||value.sources.some(source=>!validKnowledgeSource(source,accountId))||new Set(value.sources.map(source=>source.id)).size!==value.sources.length||typeof value.hasMore!=='boolean'||value.nextCursor!==null&&typeof value.nextCursor!=='string'||value.hasMore!==(value.nextCursor!==null))throw Error('Unexpected Private Knowledge list.');return structuredClone(value) as KnowledgeSourcePage}
export function knowledgeActionRequestJson(request:KnowledgeActionRequest):string{
 if(request.kind==='file')return JSON.stringify({kind:'file',name:request.name,sha256:request.sha256});
 if(request.kind==='link')return JSON.stringify({kind:'link',url:request.url});
 return JSON.stringify({kind:'retry',id:request.sourceId,expectedRevision:request.expectedRevision});
}
export async function knowledgeActionFingerprint(request:KnowledgeActionRequest):Promise<string>{const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(knowledgeActionRequestJson(request)));return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('')}
export async function parseKnowledgeAction(value:unknown,expected:{accountId:string;clientRequestId:string;request:KnowledgeActionRequest}):Promise<KnowledgeActionResponse>{
 const fail=()=>{throw Error('The Knowledge action receipt did not match the submitted request. No source was applied.')};
 try{value=structuredClone(value)}catch{return fail()}
 if(!object(value)||!object(value.receipt)||!object(value.resolution))return fail();const receipt=value.receipt,resolution=value.resolution;
 if(receipt.version!==1||!knowledgeId(receipt.id)||receipt.accountId!==expected.accountId||receipt.clientRequestId!==expected.clientRequestId||!knowledgeId(receipt.sourceId)||receipt.fingerprintProtocol!=='knowledge-request-json-sha256-v1'||!hash(receipt.fingerprint))return fail();
 if(expected.request.kind==='retry'&&receipt.sourceId!==expected.request.sourceId)return fail();
 if(receipt.provenance==='accepted'){
  if(!date(receipt.acceptedAt)||!knowledgeId(receipt.acceptedContentVersion)||!object(receipt.request))return fail();const request=receipt.request,wanted=expected.request;
  if(request.kind!==wanted.kind)return fail();
  if(wanted.kind==='file'){if(request.name!==wanted.name||request.sha256!==wanted.sha256||request.bytes!==wanted.bytes||Object.keys(request).some(key=>!['kind','name','sha256','bytes'].includes(key)))return fail()}
  else if(wanted.kind==='link'){if(request.url!==wanted.url||Object.keys(request).some(key=>!['kind','url'].includes(key)))return fail()}
  else if(request.sourceId!==wanted.sourceId||request.expectedRevision!==wanted.expectedRevision||Object.keys(request).some(key=>!['kind','sourceId','expectedRevision'].includes(key)))return fail();
 }else if(receipt.provenance!=='legacy-reference'||receipt.request!==null||receipt.acceptedAt!==null||receipt.acceptedContentVersion!==null)return fail();
 if(resolution.availability==='available'){if(!validKnowledgeSource(value.source,expected.accountId,receipt.sourceId)||resolution.sourceId!==receipt.sourceId||resolution.currentContentVersion!==value.source.contentVersion)return fail()}
 else if(!['deleted','unavailable'].includes(resolution.availability)||value.source!==null||resolution.sourceId!==null||resolution.currentContentVersion!==null)return fail();
 if(receipt.fingerprint!==await knowledgeActionFingerprint(expected.request))return fail();return structuredClone(value) as KnowledgeActionResponse;
}
export async function knowledgeApi(path:string,body?:unknown,method=body===undefined?'GET':'POST',options:{signal?:AbortSignal;raw?:boolean}={}){
 const response=await mailFetch('/api'+path,{method,signal:options.signal,...(method==='GET'?{cache:'no-store' as const}:{}),headers:body===undefined?{}:{'Content-Type':options.raw?'application/octet-stream':'application/json'},body:body===undefined?undefined:options.raw?body as ArrayBuffer:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new ApiError(result.error?.message||`Knowledge request failed (${response.status})`,response.status,result.error?.code);return result;
}
