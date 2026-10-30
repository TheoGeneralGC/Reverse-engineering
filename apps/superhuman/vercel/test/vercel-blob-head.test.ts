import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Headers as UndiciHeaders, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import * as actualSdk from '@vercel/blob';
import { NativeControl } from './control-sql-fixture.ts';
import { PrivateBodyTransport, type PrivateBlobPort } from '../src/blob-transport.ts';
import { VercelPrivateBlobStore, sameStrongBlobEtag, type PrivateBlobSdk } from '../src/vercel-blob-sdk.ts';
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External requests prohibited in isolated SDK controls')};after(()=>{globalThis.fetch=originalFetch;assert.equal(network,0)});
const storeId='store_AbCdEf1234567890',namespace='fictional-cedar',prefix=`mail-rpc/${createHash('sha256').update(namespace).digest('hex').slice(0,32)}/`,pathname=prefix+'A'.repeat(32),origin='https://abcdef1234567890.private.blob.vercel-storage.com';
test('actual pinned SDK undici GET without Content-Length binds authenticated HEAD to the same object/version before reading',async()=>{
 const previous=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);let auth=0,sawMissingLength=false;
 try{
  mock.get(origin).intercept({path:`/${pathname}?cache=0`,method:'GET',headers:{authorization:'Bearer fictional-oidc-1'}}).reply(200,Buffer.from([1,2,3]),{headers:{'content-type':'application/octet-stream',etag:'"fictional-version"'}});
  mock.get('https://vercel.com').intercept({path:/^\/api\/blob\?url=/,method:'GET',headers:{authorization:'Bearer fictional-oidc-2'}}).reply(options=>{
   assert.equal(new URL(options.path,'https://vercel.com').searchParams.get('url'),pathname);
   return{statusCode:200,data:{pathname,url:`${origin}/${pathname}`,downloadUrl:`${origin}/${pathname}?download=1`,contentType:'application/octet-stream',size:3,etag:'fictional-version',uploadedAt:new Date().toISOString(),contentDisposition:'',cacheControl:''},responseOptions:{headers:{'content-type':'application/json'}}};
  });
  const sdk={...actualSdk,get:async(...args:Parameters<typeof actualSdk.get>)=>{const value=await actualSdk.get(...args);assert.ok(value&&value.statusCode===200);assert.equal(value.headers.get('content-length'),null);assert.equal(value.blob.size,0);sawMissingLength=true;return value}};
  const store=new VercelPrivateBlobStore({storeId,namespace,sdk,getOidcToken:async()=>`fictional-oidc-${++auth}`});
  const stream=await store.read(pathname);assert.ok(stream);assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()),new Uint8Array([1,2,3]));
  assert.equal(auth,2);assert.equal(sawMissingLength,true);mock.assertNoPendingInterceptors();
 }finally{setGlobalDispatcher(previous);await mock.close()}
});

function fake(change:(value:any,head:any)=>void=()=>{}, body=new Uint8Array([1,2,3])) {
 let cancelled=0,heads=0,auth=0;
 const metadata={pathname,url:`${origin}/${pathname}`,downloadUrl:`${origin}/${pathname}?download=1`,contentType:'application/octet-stream',size:3,etag:'fictional-version',uploadedAt:new Date(),contentDisposition:'',cacheControl:''};
 const value:any={statusCode:200,headers:new UndiciHeaders({etag:'"fictional-version"'}),blob:{...metadata,size:0,etag:'"fictional-version"'},stream:new ReadableStream({start(c){c.enqueue(body);c.close()},cancel(){cancelled++}})},head:any={...metadata};
 change(value,head);
 const sdk={get:async()=>value,head:async(path:string,options:any)=>{assert.equal(path,pathname);assert.deepEqual(options,{storeId,oidcToken:'fictional-oidc-2'});heads++;return head}} as unknown as PrivateBlobSdk;
 const store=new VercelPrivateBlobStore({storeId,namespace,sdk,getOidcToken:async()=>`fictional-oidc-${++auth}`});
 return{store,sdk,value,head,cancelled:()=>cancelled,heads:()=>heads,auth:()=>auth};
}
test('zero with any present Content-Length and missing/weak/inconsistent GET version never triggers HEAD',async()=>{
 for(const change of[(value:any)=>value.headers.set('content-length','0'),(value:any)=>value.headers.set('content-length','invalid'),(value:any)=>{value.blob.etag='';value.headers.delete('etag')},(value:any)=>{value.blob.etag='W/"fictional-version"';value.headers.set('etag',value.blob.etag)},(value:any)=>value.headers.set('etag','"different-version"')]){
  const f=fake(change);await assert.rejects(f.store.read(pathname),{code:'private_storage_unavailable'});assert.equal(f.heads(),0);assert.equal(f.cancelled(),1);
 }
});
test('HEAD requires positive bounded length and exact private identity/MIME before returning the GET stream',async()=>{
 for(const change of[(v:any,h:any)=>delete h.size,(v:any,h:any)=>h.size=0,(v:any,h:any)=>h.size=-1,(v:any,h:any)=>h.size=3.5,(v:any,h:any)=>h.size=65*1024**2,(v:any,h:any)=>h.pathname=prefix+'B'.repeat(32),(v:any,h:any)=>h.contentType='text/plain',(v:any,h:any)=>h.url='https://attacker.invalid/file',(v:any,h:any)=>h.downloadUrl+=`&unexpected=1`]){
  const f=fake(change);await assert.rejects(f.store.read(pathname),{code:'private_storage_unavailable'});assert.equal(f.heads(),1);assert.equal(f.cancelled(),1);
 }
});
test('missing, weak, malformed or changed HEAD version cancels GET without exposing body',async()=>{
 for(const etag of[undefined,'','W/"fictional-version"','""','"fictional-version','different-version']){
  const f=fake((v,h)=>h.etag=etag);await assert.rejects(f.store.read(pathname),{code:'private_storage_unavailable'});assert.equal(f.cancelled(),1);
 }
});
test('GET version is snapshotted before HEAD; a replacement race cannot adopt another version',async()=>{
 const f=fake();f.sdk.head=async()=>{f.value.blob.etag='new-version';return{...f.head,etag:'new-version'}};
 await assert.rejects(f.store.read(pathname),{code:'private_storage_unavailable'});assert.equal(f.cancelled(),1);
});
test('authenticated HEAD failure cancels the already-open GET and never leaks provider text',async()=>{
 const f=fake();f.sdk.head=async()=>{throw Error('Fictional secret should not escape')};
 await assert.rejects(f.store.read(pathname),error=>{assert.equal((error as any).code,'private_storage_unavailable');assert.equal(String(error).includes('Fictional secret'),false);return true});assert.equal(f.cancelled(),1);
});
test('HEAD-derived bounds still reject truncated and oversized streams',async()=>{
 for(const length of[2,4]){const f=fake(()=>{},new Uint8Array(length));const stream=await f.store.read(pathname);assert.ok(stream);await assert.rejects(new Response(stream).arrayBuffer(),{code:'private_storage_unavailable'})}
});
test('strong version comparison accepts only one valid quoted/raw representation and preserves opaque identity',()=>{
 assert.equal(sameStrongBlobEtag('"fictional-version"','fictional-version'),true);assert.equal(sameStrongBlobEtag('"fictional-version"','"fictional-version"'),true);
 for(const [a,b]of[['',''],['""','""'],['W/"x"','"x"'],['"x','x'],['"x"','X'],['" x"','x'],['"x"',' x'],['"x\\"','x'],[undefined,undefined]])assert.equal(sameStrongBlobEtag(a,b),false);
});

test('durable request-body digest remains authoritative after authenticated HEAD supplies stream length',async()=>{
 const sql=new NativeControl(':memory:',{DATABASE_PATH:':memory:'}),actual=new Uint8Array([9,9,9]);
 const meta=(path:string)=>({pathname:path,url:`${origin}/${path}`,downloadUrl:`${origin}/${path}?download=1`,contentType:'application/octet-stream',size:3,etag:'fictional-version',uploadedAt:new Date(),contentDisposition:'',cacheControl:''});
 let reads=0,heads=0;const sdk={get:async(path:string)=>{reads++;return{statusCode:200,headers:new UndiciHeaders({etag:'"fictional-version"'}),blob:{...meta(path),size:0,etag:'"fictional-version"'},stream:new ReadableStream({start(c){c.enqueue(actual);c.close()}})}},head:async(path:string)=>{heads++;return meta(path)}} as unknown as PrivateBlobSdk;
 const store=new VercelPrivateBlobStore({storeId,namespace,sdk,getOidcToken:async()=>'fictional-oidc'});
 const unused=async()=>{throw Error('Unused fixture operation')};
 const port:PrivateBlobPort={uploadGrant:async()=>({url:'https://synthetic.invalid/unused-upload'}),read:store.read.bind(store),downloadGrant:unused,write:unused,remove:unused};
 try{
  const transport=new PrivateBodyTransport({sql,blob:port,namespace});await transport.initialize();
  const scope={namespace,commandId:'fictional-digest-binding',method:'POST',path:'/api/knowledge/sources/files'},expected=new Uint8Array([1,2,3]);
  const grant=await transport.createRequestUpload(scope,3,createHash('sha256').update(expected).digest('hex'));
  await assert.rejects(transport.readRequestBody(grant.body,scope),{code:'transport_body_mismatch'});assert.equal(reads,1);assert.equal(heads,1);
 }finally{await sql.close()}
});

test('actual SDK weak-validator unknown-length GET succeeds only with an exact caller digest and authenticated HEAD size',async()=>{
 const previous=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);let auth=0;
 try{
  mock.get(origin).intercept({path:`/${pathname}?cache=0`,method:'GET'}).reply(200,Buffer.from([1,2,3]),{headers:{'content-type':'application/octet-stream',etag:'W/"fictional-version"'}});
  mock.get('https://vercel.com').intercept({path:/^\/api\/blob\?url=/,method:'GET'}).reply(200,{pathname,url:`${origin}/${pathname}`,downloadUrl:`${origin}/${pathname}?download=1`,contentType:'application/octet-stream',size:3,etag:'different-representation',uploadedAt:new Date().toISOString(),contentDisposition:'',cacheControl:''},{headers:{'content-type':'application/json'}});
  const store=new VercelPrivateBlobStore({storeId,namespace,sdk:actualSdk,getOidcToken:async()=>`fictional-oidc-${++auth}`});
  const stream=await store.read(pathname,{bytes:3,sha256:createHash('sha256').update(new Uint8Array([1,2,3])).digest('hex')});assert.ok(stream);assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()),new Uint8Array([1,2,3]));assert.equal(auth,2);mock.assertNoPendingInterceptors();
 }finally{setGlobalDispatcher(previous);await mock.close()}
});

const expectedBinding=()=>({bytes:3,sha256:createHash('sha256').update(new Uint8Array([1,2,3])).digest('hex')});
test('invalid digest binding fails before OIDC; caller mutation after auth begins cannot replace accepted binding',async()=>{
 for(const binding of[{bytes:0,sha256:'a'.repeat(64)},{bytes:65*1024**2,sha256:'a'.repeat(64)},{bytes:3,sha256:'invalid'},{bytes:3,sha256:'a'.repeat(64),extra:true},null]){
  const f=fake();await assert.rejects(f.store.read(pathname,binding as any),{code:'invalid_private_storage_request'});assert.equal(f.auth(),0);assert.equal(f.heads(),0);
 }
 const f=fake(),binding=expectedBinding();let release!:()=>void;const waiting=new Promise<string>(done=>{release=()=>done('fictional-oidc')});
 f.sdk.head=async()=>f.head;const store=new VercelPrivateBlobStore({storeId,namespace,sdk:f.sdk,getOidcToken:()=>waiting}),pending=store.read(pathname,binding);binding.sha256='f'.repeat(64);binding.bytes=99;release();const stream=await pending;assert.ok(stream);assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()),new Uint8Array([1,2,3]));
});
test('digest-bound missing-length reads do not promote weak/absent validators; exact HEAD identity/size and bytes remain required',async()=>{
 for(const version of['W/"fictional-version"','']){
  const f=fake((value,head)=>{value.blob.etag=version;version?value.headers.set('etag',version):value.headers.delete('etag');head.etag='different-representation'});
  const stream=await f.store.read(pathname,expectedBinding());assert.ok(stream);assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()),new Uint8Array([1,2,3]));assert.equal(f.heads(),1);
 }
 for(const change of[(v:any,h:any)=>h.size=4,(v:any,h:any)=>h.pathname=prefix+'B'.repeat(32),(v:any,h:any)=>h.url='https://foreign.invalid/object',(v:any,h:any)=>h.contentType='text/plain']){
  const f=fake(change);await assert.rejects(f.store.read(pathname,expectedBinding()),{code:'private_storage_unavailable'});assert.equal(f.cancelled(),1);
 }
});
test('bound positive length cannot bypass malformed/present-zero metadata or the independent EOF digest',async()=>{
 for(const length of['0','invalid','3trailing']){const f=fake(value=>{value.blob.size=3;value.headers.set('content-length',length)});await assert.rejects(f.store.read(pathname,expectedBinding()),{code:'private_storage_unavailable'});assert.equal(f.heads(),0);assert.equal(f.cancelled(),1)}
 for(const knownLength of[false,true]){
  const f=fake(value=>{if(knownLength){value.blob.size=3;value.headers.set('content-length','3')}},new Uint8Array([9,9,9]));const stream=await f.store.read(pathname,expectedBinding());assert.ok(stream);await assert.rejects(new Response(stream).arrayBuffer(),{code:'transport_body_mismatch'});assert.equal(f.heads(),knownLength?0:1);
 }
});

test('durable transport snapshots row digest and length rather than mutable caller metadata across awaited storage',async()=>{
 const sql=new NativeControl(':memory:',{DATABASE_PATH:':memory:'});let release!:()=>void,started!:()=>void;const held=new Promise<void>(done=>{release=done}),admitted=new Promise<void>(done=>{started=done});let observed:any;
 const wrong=new Uint8Array([9,9,9]),unused=async()=>{throw Error('Unused fixture op')};
 const port:PrivateBlobPort={uploadGrant:async()=>({url:'https://synthetic.invalid/unused'}),read:async(path,binding)=>{observed={...binding};started();await held;return new ReadableStream({start(c){c.enqueue(wrong);c.close()}})},downloadGrant:unused,write:unused,remove:unused};
 try{
  const transport=new PrivateBodyTransport({sql,blob:port,namespace});await transport.initialize();const scope={namespace,commandId:'fictional-caller-mutation',method:'POST',path:'/api/knowledge/sources/files'},expected=expectedBinding();const grant=await transport.createRequestUpload(scope,expected.bytes,expected.sha256);
  const pending=transport.readRequestBody(grant.body,scope);await admitted;assert.deepEqual(observed,expected);grant.body.sha256=createHash('sha256').update(wrong).digest('hex');release();await assert.rejects(pending,{code:'transport_body_mismatch'});
 }finally{release?.();await sql.close()}
});
