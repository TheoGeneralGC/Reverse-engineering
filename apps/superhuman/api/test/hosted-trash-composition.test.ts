import test,{after}from'node:test';
import assert from'node:assert/strict';
import{DatabaseSync}from'node:sqlite';
import{randomUUID}from'node:crypto';
import{syncBuiltinESMExports}from'node:module';
import http from'node:http';import https from'node:https';import net from'node:net';import tls from'node:tls';
import type{AddressInfo}from'node:net';
import type{SqlDatabase}from'../src/sql-database.ts';
import type{Thread,Draft}from'../src/types.ts';
import type{TrashNative}from'../src/trash-action-google.ts';

// Install before importing App/provider code. Only this file's explicitly owned
// numeric loopback ports are reachable; no host environment/config is loaded.
const ports=new Set<number>();let denied=0;
const refuse=():never=>{denied++;throw Error('Composite test forbids unowned network traffic')};
const allowed=(args:any[]):boolean=>{const value=args[0];if(Array.isArray(value))return allowed(value);if(value&&typeof value==='object')return(value.hostname??value.host)==='127.0.0.1'&&ports.has(Number(value.port));return typeof value==='number'&&args[1]==='127.0.0.1'&&ports.has(value)};
const originalRequest=http.request,originalConnect=net.connect,originalCreate=net.createConnection,originalSocket=net.Socket.prototype.connect;
http.request=((...args:any[])=>allowed(args)?Reflect.apply(originalRequest,http,args):refuse())as typeof http.request;
http.get=refuse as typeof http.get;https.request=refuse as typeof https.request;https.get=refuse as typeof https.get;
net.connect=((...args:any[])=>allowed(args)?Reflect.apply(originalConnect,net,args):refuse())as typeof net.connect;
net.createConnection=((...args:any[])=>allowed(args)?Reflect.apply(originalCreate,net,args):refuse())as typeof net.createConnection;
net.Socket.prototype.connect=function(this:net.Socket,...args:any[]){return allowed(args)?Reflect.apply(originalSocket,this,args):refuse()}as typeof net.Socket.prototype.connect;
tls.connect=refuse as typeof tls.connect;globalThis.fetch=refuse;syncBuiltinESMExports();
const[{createApp},{syntheticFullThread},{verifiedActionBasis},{trashCachedMessages}]=await Promise.all([
 import('../src/server.ts'),import('./reminder-projection-fixture.ts'),import('../src/archive-action-basis.ts'),import('../src/trash-action-google.ts'),
]);
after(()=>{assert.equal(denied,0);assert.equal(ports.size,0)});
const deferred=()=>{let release!:()=>void;return{promise:new Promise<void>(resolve=>{release=resolve}),release:()=>release()}};
const code=(expected:string)=>(error:unknown)=>(error as{code?:string})?.code===expected;
function fixture(hold:'none'|'preflight'|'issued'='none'){
 const databasePath=':memory:',nativeDb=new DatabaseSync(databasePath),entered=deferred(),finish=deferred();
 let owned=true,closed=0,opens=0,writes=0,reads=0,modifies=0,aborts=0,active=false,ownerChecks=0;
 const lost=Object.assign(new Error('Synthetic actor frontier revoked'),{code:'actor_authority_lost'}),fence=()=>{if(!owned)throw lost};
 const db:SqlDatabase={get isTransaction(){return nativeDb.isTransaction},exec(sql){fence();nativeDb.exec(sql)},prepare(sql){fence();const statement=nativeDb.prepare(sql);return{get(...args){fence();return statement.get(...args)},all(...args){fence();return statement.all(...args)},run(...args){fence();writes++;return statement.run(...args)}}},close(){if(!closed){closed++;nativeDb.close()}}};
 const remote=new Map<string,ReturnType<typeof trashCachedMessages>>();
 const native:TrashNative={async read(input,phase,guard){guard.check();reads++;if(hold==='preflight'&&phase==='required'){entered.release();await finish.promise;guard.check()}return{providerThreadId:input.providerThreadId,messages:structuredClone(remote.get(input.providerThreadId)!),profileEmail:'own@example.test',observedAt:new Date().toISOString()}},async modify(input,guard){guard.check();guard.beforeIssue();modifies++;active=true;guard.signal.addEventListener('abort',()=>{if(active)aborts++},{once:true});try{if(hold==='issued'){entered.release();await finish.promise;guard.check()}remote.set(input.providerThreadId,remote.get(input.providerThreadId)!.map(message=>({...message,labels:[...new Set([...message.labels.filter(label=>!input.removeLabelIds.includes(label)),...input.addLabelIds])].sort()})));guard.onAck(input.providerThreadId)}finally{active=false}}};
 const app=createApp({databasePath,env:{DATABASE_PATH:databasePath,WEB_ORIGIN:'https://mail.example.test',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',TOKEN_ENCRYPTION_KEY:'1'.repeat(64)},
  databaseFactory(path){assert.equal(path,databasePath);opens++;return db},ownerLiveness(localRegistered){ownerChecks++;return localRegistered},seed:false,runJobs:false,providerDraftAutomatic:false,trashNative:native});
 app.store.put('account','a',{id:'a',provider:'google',email:'own@example.test',name:'Synthetic',color:'#000'});
 for(const id of['t','u']){const thread:Thread={id,accountId:'a',providerId:id,subject:'Fictional '+id,snippet:'Synthetic only',sender:{name:'Other',email:'other@example.test'},participants:[],lastMessageAt:'2026-10-30T12:00:00.000Z',unread:true,starred:false,important:false,folder:'inbox',labels:[],providerLabels:['INBOX'],messages:[{id:'m-'+id,sender:{name:'Other',email:'other@example.test'},to:[{name:'Own',email:'own@example.test'}],date:'2026-10-30T12:00:00.000Z',internetMessageId:`<${id}@example.test>`,text:'Fictional question.',attachments:[],providerLabels:['INBOX']}]};app.store.put('thread',id,syntheticFullThread(app.store,thread));remote.set(id,trashCachedMessages(app.store.required('thread',id)))}
 const request=()=>{const basis=verifiedActionBasis(app.store,'t','a')!;return{version:1 as const,action:'trash' as const,accountId:'a',accountVersion:basis.accountVersion,expectedSourceVersion:basis.sourceVersion,clientRequestId:randomUUID()}};
 return{app,db,nativeDb,entered,finish,lost,request,counts:()=>({closed,opens,writes,reads,modifies,aborts,ownerChecks}),setOwned(value:boolean){owned=value},async close(){owned=true;finish.release();await app.close()}};
}
type Fixture=ReturnType<typeof fixture>;
async function listen(f:Fixture){await new Promise<void>((resolve,reject)=>{f.app.server.once('error',reject);f.app.server.listen(0,'127.0.0.1',resolve)});const port=(f.app.server.address()as AddressInfo).port;ports.add(port);return port}
function request(port:number,path:string,value?:unknown){return new Promise<{status:number;body:any}>((resolve,reject)=>{const bytes=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value));const client=http.request({hostname:'127.0.0.1',port,path,method:value===undefined?'GET':'POST',headers:{origin:'https://mail.example.test','content-type':'application/json','content-length':bytes.length}},response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString())}))});client.once('error',reject);client.end(bytes)})}

test('hosted factory and owner-liveness options compose with actual keyed Trash ledger writes',async()=>{
 const f=fixture();try{assert.equal(f.app.store.db,f.db);assert.equal(f.counts().opens,1);let fallback=0;assert.equal(f.app.store.ownerLiveness(false,()=>{fallback++;return true}),false);assert.equal(fallback,0);assert.ok(f.counts().ownerChecks>0);
  const result=await f.app.trashActions.trash('t',f.request());assert.equal(result.receipt.state,'confirmed');assert.equal(f.app.store.required<Thread>('thread','t').folder,'trash');assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM trash_action_operations').get()!.n,1);assert.equal(f.counts().modifies,1);
 }finally{await f.close();assert.equal(f.counts().closed,1)}
});

test('an admitted issued Trash drains through hosted quiescence without abort while new HTTP admission is refused',async()=>{
 const f=fixture('issued');let port:number|undefined,pending:Promise<{status:number;body:any}>|undefined;
 try{port=await listen(f);pending=request(port,'/api/threads/t/trash-actions',f.request());await f.entered.promise;
  const before=f.app.store.db.prepare('SELECT data FROM trash_action_operations').get()!;assert.equal(JSON.parse(String(before.data)).stage,'issued');
  f.app.beginQuiesce();let drained=false;const quiescing=f.app.quiesce().then(()=>{drained=true});for(let i=0;i<5;i++)await Promise.resolve();assert.equal(drained,false);assert.equal(f.counts().aborts,0);assert.equal(f.counts().closed,0);
  const blocked=await request(port,'/api/health');assert.equal(blocked.status,503);
  f.finish.release();const result=await pending;assert.equal(result.status,200);assert.equal(result.body.receipt.state,'confirmed');await quiescing;assert.equal(drained,true);assert.equal(f.counts().modifies,1);assert.equal(f.counts().aborts,0);assert.equal(f.counts().closed,0);assert.equal(f.app.store.required<Thread>('thread','t').folder,'trash');
 }finally{f.finish.release();await pending?.catch(()=>{});await f.close();if(port!==undefined)ports.delete(port)}
});

test('reciprocal Trash admission and the prepared SQL actor frontier both remain live in the combined Store',async()=>{
 const f=fixture('preflight');let pending:ReturnType<typeof f.app.trashActions.trash>|undefined;
 try{const stale=f.app.store.saveDraft({accountId:'a',threadId:'t',to:'other@example.test',subject:'Synthetic',body:'Fictional'});f.app.store.deleteDraft(stale.id);pending=f.app.trashActions.trash('t',f.request());await f.entered.promise;const writes=f.counts().writes;
  assert.throws(()=>f.app.store.saveDraft({accountId:'a',threadId:'t',body:'Blocked fictional draft'}),code('ordinary_action_locked'));assert.throws(()=>f.app.providerDrafts.repository.enroll(stale,'reply'),code('ordinary_action_locked'));assert.equal(f.counts().writes,writes);assert.equal(f.counts().modifies,0);
  const other=f.app.store.saveDraft({accountId:'a',threadId:'u',body:'Unrelated fictional draft'});assert.equal(f.app.store.required<Draft>('draft',other.id).body,other.body);
  const prepared=f.app.store.db.prepare("UPDATE records SET data=json_set(data,'$.subject','Must never reach native SQL') WHERE kind='thread' AND id='u'"),before=f.nativeDb.prepare("SELECT data FROM records WHERE kind='thread' AND id='u'").get()!.data,writesBefore=f.counts().writes;
  f.setOwned(false);assert.throws(()=>prepared.run(),error=>error===f.lost);assert.equal(f.counts().writes,writesBefore);assert.equal(f.nativeDb.prepare("SELECT data FROM records WHERE kind='thread' AND id='u'").get()!.data,before);
  f.setOwned(true);f.finish.release();await pending;assert.equal(f.counts().modifies,1);
 }finally{f.setOwned(true);f.finish.release();await pending?.catch(()=>{});await f.close()}
});
