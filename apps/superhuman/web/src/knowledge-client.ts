import { ApiError } from './api.ts';
import type { KnowledgeSource,KnowledgeSourcePage,KnowledgeStatus } from '../../api/src/knowledge-types.ts';
export type { KnowledgeSource,KnowledgeSourcePage,KnowledgeStatus };
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
export async function knowledgeApi(path:string,body?:unknown,method=body===undefined?'GET':'POST',options:{signal?:AbortSignal;raw?:boolean}={}){
 const response=await fetch('/api'+path,{method,signal:options.signal,...(method==='GET'?{cache:'no-store' as const}:{}),headers:body===undefined?{}:{'Content-Type':options.raw?'application/octet-stream':'application/json'},body:body===undefined?undefined:options.raw?body as ArrayBuffer:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new ApiError(result.error?.message||`Knowledge request failed (${response.status})`,response.status,result.error?.code);return result;
}
