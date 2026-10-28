import {isIP}from'node:net';
import {lookup}from'node:dns/promises';
import {request}from'node:https';
import type{LookupFunction}from'node:net';
import {HttpError}from'./types.ts';
const invalid=()=>new HttpError(400,'Use a public HTTPS page without embedded credentials','knowledge_invalid_url');
// Conservative numeric CIDRs, based on IANA special-purpose registries. We also
// exclude protocol-special allocations whose routability is not ordinary web use.
export function publicKnowledgeAddress(address:string):boolean{
 const family=isIP(address);
 if(family===4){const number=(value:string)=>value.split('.').reduce((n,p)=>(n<<8n)|BigInt(Number(p)),0n),value=number(address);const blocks:[string,number][]=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]];return!blocks.some(([base,bits])=>value>>BigInt(32-bits)===number(base)>>BigInt(32-bits))}
 if(family===6){try{const number=(value:string)=>{const normalized=new URL('http://['+value+']/').hostname.slice(1,-1),parts=normalized.split('::'),left=parts[0]?parts[0].split(':'):[],right=parts[1]?parts[1].split(':'):[],words=parts.length===1?left:[...left,...Array(8-left.length-right.length).fill('0'),...right];return words.reduce((n,p)=>(n<<16n)|BigInt(parseInt(p,16)),0n)},value=number(address),inside=(base:string,bits:number)=>value>>BigInt(128-bits)===number(base)>>BigInt(128-bits);return inside('2000::',3)&&![['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]].some(([base,bits])=>inside(String(base),Number(bits)))}catch{return false}}
 return false;
}
export function normalizeKnowledgeUrl(raw:unknown):string{
 if(typeof raw!=='string'||Buffer.byteLength(raw)>4096||/[\x00-\x20\x7f]/.test(raw))throw invalid();let url:URL;try{url=new URL(raw)}catch{throw invalid()}
 const host=url.hostname.replace(/^\[|\]$/g,'');if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!host||host.endsWith('.'))throw invalid();
 if(isIP(host)){if(!publicKnowledgeAddress(host))throw invalid()}else if(!host.includes('.')||/\.(local|localhost|internal|onion|invalid|test)$/i.test(host))throw invalid();
 url.hash='';const canonical=url.toString();if(Buffer.byteLength(canonical)>4096)throw invalid();return canonical;
}
export type KnowledgeLinkTransport={resolve:(host:string)=>Promise<{address:string;family:number}[]>;get:(url:URL,pinned:{address:string;family:number},signal:AbortSignal)=>Promise<{status:number;headers:Record<string,string|undefined>;body:AsyncIterable<Uint8Array>;close:()=>void}>};
const transport:KnowledgeLinkTransport={resolve:host=>lookup(host,{all:true,verbatim:true}),get:(url,pinned,signal)=>new Promise((accept,reject)=>{
 const host=url.hostname.replace(/^\[|\]$/g,''),pinnedLookup=((_hostname:any,options:any,callback:any)=>{if(options?.all)callback(null,[pinned]);else callback(null,pinned.address,pinned.family)})as LookupFunction;
 const req=request(url,{method:'GET',signal,lookup:pinnedLookup,family:pinned.family,servername:isIP(host)?undefined:host,maxHeaderSize:16384,headers:{Accept:'text/html,text/plain','Accept-Encoding':'identity','User-Agent':'Reconstruction-Knowledge/1.0'}},response=>{const headers:Record<string,string|undefined>={};for(const[name,value]of Object.entries(response.headers))headers[name]=Array.isArray(value)?value.join(','):value;accept({status:response.statusCode??0,headers,body:response,close:()=>response.destroy()})});req.setTimeout(5000,()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end();
})};
async function fetchLinkInternal(raw:string,io:KnowledgeLinkTransport,signal:AbortSignal):Promise<{url:string;bytes:Buffer;extension:'html'|'txt';mediaType:string}>{
 let current=normalizeKnowledgeUrl(raw),seen=new Set<string>();
 for(let redirects=0;redirects<=3;redirects++){
  if(seen.has(current))throw new HttpError(422,'The page redirects repeatedly','knowledge_redirect_limit');seen.add(current);const url=new URL(current),host=url.hostname.replace(/^\[|\]$/g,'');let addresses:{address:string;family:number}[];try{addresses=isIP(host)?[{address:host,family:isIP(host)}]:await bounded(io.resolve(host),signal)}catch(error){if(error instanceof HttpError&&error.code==='knowledge_link_timeout')throw error;throw new HttpError(422,'The public page could not be reached','knowledge_link_unreachable')}
  if(!addresses.length||addresses.length>32||addresses.some(value=>!publicKnowledgeAddress(value.address)||(value.family!==isIP(value.address))))throw new HttpError(422,'Private, internal, or special-purpose addresses cannot be indexed','knowledge_private_address');
  let response:Awaited<ReturnType<KnowledgeLinkTransport['get']>>;try{response=await bounded(io.get(url,addresses[0],signal),signal)}catch(error){if(error instanceof HttpError&&error.code==='knowledge_link_timeout')throw error;throw new HttpError(422,'The public page could not be read securely','knowledge_link_unreachable')}
  try{
   if([301,302,303,307,308].includes(response.status)){if(redirects===3||!response.headers.location)throw new HttpError(422,'The page redirects repeatedly','knowledge_redirect_limit');current=normalizeKnowledgeUrl(new URL(response.headers.location,current).toString());continue}
   if(response.status<200||response.status>=300)throw new HttpError(422,'The public page is inaccessible','knowledge_link_inaccessible');
   const type=(response.headers['content-type']??'').toLowerCase(),isHtml=/^text\/html(?:;|$)/.test(type),isText=/^text\/plain(?:;|$)/.test(type);if(!isHtml&&!isText||type.includes('charset=')&&!/charset=["']?(?:utf-8|us-ascii)\b/.test(type)||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new HttpError(422,'This link must return UTF-8 HTML or plain text','knowledge_link_content_type');
   let size=0;const chunks:Buffer[]=[];const iterator=response.body[Symbol.asyncIterator]();for(;;){const next=await bounded(iterator.next(),signal);if(next.done)break;const part=next.value;size+=part.length;if(size>2*1024*1024)throw new HttpError(422,'The page exceeds the single-page text budget','knowledge_link_too_large');chunks.push(Buffer.from(part))}if(!size)throw new HttpError(422,'The page is empty','knowledge_empty_text');return{url:current,bytes:Buffer.concat(chunks,size),extension:isHtml?'html':'txt',mediaType:isHtml?'text/html':'text/plain'};
  }finally{response.close()}
 }
 throw new HttpError(422,'The page could not be indexed','knowledge_link_unreachable');
}

function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(new HttpError(422,'The page exceeded its read time budget','knowledge_link_timeout'));return new Promise((resolve,reject)=>{const abort=()=>reject(new HttpError(422,'The page exceeded its read time budget','knowledge_link_timeout'));signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})})}
export async function fetchKnowledgeLink(raw:string,io:KnowledgeLinkTransport=transport,options:{timeoutMs?:number}={}):Promise<{url:string;bytes:Buffer;extension:'html'|'txt';mediaType:string}>{const timeoutMs=options.timeoutMs??15000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>15000)throw new TypeError('Invalid link read budget');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await fetchLinkInternal(raw,io,controller.signal)}finally{clearTimeout(timer);controller.abort()}}
