import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {publicKnowledgeAddress,fetchKnowledgeLink} from '../src/knowledge-url.ts';
import {Store} from '../src/store.ts';
import {KnowledgeService} from '../src/knowledge.ts';
import {AiChatRepository} from '../src/ai-chat-store.ts';
import {AiRetrieval} from '../src/ai-retrieval.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {KnowledgeExtraction} from '../src/knowledge-types.ts';
const extracted=(text:string):KnowledgeExtraction=>({text,parser:'synthetic-controlled',truncated:false,warnings:[]});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}};
function fixture(path=':memory:',extract:((bytes:Buffer,extension:string)=>Promise<KnowledgeExtraction>)=async bytes=>extracted(bytes.toString('utf8')),ownerAlive?:()=>boolean){const store=new Store(path,false);for(const id of ['a','b'])if(!store.get('account',id))store.put('account',id,{id,email:`${id}@example.test`,name:id,provider:'demo',color:'#fff'});const service=new KnowledgeService(store,{autoProcess:false,resume:false,extract,ownerAlive,fetchLink:async()=>{throw Error('No external fetch permitted')}});return{store,service,repo:service.repository,close:async()=>{await service.close();store.close()}}}

// IANA marks 2001:2::/48 Benchmarking as not globally reachable.
// https://www.iana.org/assignments/iana-ipv6-special-registry
test('non-global IPv6 benchmark addresses are rejected before any pinned HTTP transport is opened',async()=>{
 assert.equal(publicKnowledgeAddress('2001:2::1'),false,'A special-purpose benchmark destination is not a public web target');let gets=0;
 await assert.rejects(()=>fetchKnowledgeLink('https://example.com/',{resolve:async()=>[{address:'2001:2::1',family:6}],get:async()=>{gets++;throw Error('Never open a special-purpose destination')}}),{code:'knowledge_private_address'});assert.equal(gets,0);
});

test('mixed DNS answers, redirect re-resolution and request pinning never open a private target',async()=>{
 let gets=0,closes=0;const publicIp={address:'93.184.216.34',family:4};const good=()=>({status:200,headers:{'content-type':'text/plain; charset=utf-8'},body:(async function*(){yield Buffer.from('Controlled public fixture')})(),close(){closes++}});
 await assert.rejects(()=>fetchKnowledgeLink('https://example.com/',{resolve:async()=>[publicIp,{address:'127.0.0.1',family:4}],get:async()=>{gets++;return good()}}),{code:'knowledge_private_address'});assert.equal(gets,0);
 const hosts:string[]=[],io={resolve:async(host:string)=>{hosts.push(host);return host==='example.com'?[publicIp]:[{address:'10.1.2.3',family:4}]},get:async(url:URL,pinned:{address:string;family:number})=>{gets++;assert.equal(url.hostname,'example.com');assert.deepEqual(pinned,publicIp);return{...good(),status:302,headers:{location:'https://other.example.org/private'}}}};
 await assert.rejects(()=>fetchKnowledgeLink('https://example.com/',io),{code:'knowledge_private_address'});assert.equal(gets,1);assert.equal(closes,1);assert.deepEqual(hosts,['example.com','other.example.org']);
});

test('a foreign scope cannot parse corrupt private metadata, blobs, receipts, or chunks',async()=>{
 const f=fixture();try{const original=f.service.upload('a','owned-upload','private.txt',Buffer.from('PRIVATE_ONLY_A')).source;await f.service.runJobs();f.store.db.prepare('UPDATE knowledge_sources SET data=? WHERE id=?').run('{malformed private source',original.id);
  for(const read of [()=>f.repo.get('b',original.id),()=>f.repo.blob('b',original.id),()=>f.repo.read('b',original.id),()=>f.repo.byRequest('b','owned-upload')])assert.throws(read,{status:404,code:'knowledge_not_found'});assert.deepEqual(f.repo.list('b').sources,[]);assert.deepEqual(f.repo.search('b','PRIVATE'),[]);assert.equal(f.store.db.prepare('SELECT data FROM knowledge_sources WHERE id=?').get(original.id)!.data,'{malformed private source');
 }finally{await f.close()}
});

test('historical upload keys never resurrect a deleted source or retarget a later explicit upload of the same bytes',async()=>{
 const f=fixture();try{const bytes=Buffer.from('Exact controlled source bytes'),old=f.service.upload('a','old-upload','owned.txt',bytes).source;await f.service.runJobs();const ready=f.repo.get('a',old.id);f.repo.remove('a',old.id,ready.revision);assert.throws(()=>f.service.upload('a','old-upload','owned.txt',bytes),{status:409,code:'knowledge_action_unavailable'});const fresh=f.service.upload('a','fresh-upload','owned.txt',bytes).source;assert.notEqual(fresh.id,old.id);assert.throws(()=>f.repo.byRequest('a','old-upload'),{status:404});assert.throws(()=>f.service.upload('a','old-upload','owned.txt',bytes),{status:409,code:'knowledge_action_unavailable'});assert.equal(f.repo.byRequest('a','fresh-upload').id,fresh.id);assert.equal(f.repo.list('a').sources.length,1);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM knowledge_blobs').get()!.n,1);
 }finally{await f.close()}
});

test('an FTS update failure rolls back acknowledged metadata and its revision in the same transaction',async()=>{
 const f=fixture();try{const created=f.service.upload('a','atomic-edit','owned.txt',Buffer.from('Cedar searchable text')).source;await f.service.runJobs();const before=f.repo.get('a',created.id),raw=f.store.db.prepare('SELECT data FROM knowledge_sources WHERE id=?').get(created.id)!.data;
  // A thrown SQL function inside UPDATE aborts after the metadata save has begun.
  assert.ok(f.store.db instanceof DatabaseSync); f.store.db.function('owned_abort',{varargs:true},()=>{throw Error('Controlled FTS update failure')});const statement=f.store.db.prepare.bind(f.store.db);f.store.db.prepare=((sql:string)=>sql.startsWith('UPDATE knowledge_fts SET name=')?statement('SELECT owned_abort(?,?,?)'):statement(sql))as typeof f.store.db.prepare;
  try{assert.throws(()=>f.repo.edit('a',created.id,before.revision,{name:'Must roll back',description:'Must roll back too'}));assert.equal(f.store.db.isTransaction,false)}finally{f.store.db.prepare=statement}
  assert.equal(f.store.db.prepare('SELECT data FROM knowledge_sources WHERE id=?').get(created.id)!.data,raw);assert.equal(f.repo.get('a',created.id).revision,before.revision);assert.equal(f.repo.search('a','Cedar')[0].source.name,before.name);
 }finally{await f.close()}
});

test('a reclaimed dead-owner job commits once and a late original worker cannot replace its newer index',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'knowledge-owned-recovery-')),path=join(directory,'controlled.sqlite'),held=deferred<KnowledgeExtraction>(),first=fixture(path,()=>held.promise);let second:ReturnType<typeof fixture>|undefined;try{const source=first.service.upload('a','queued-owner','owned.txt',Buffer.from('Synthetic raw bytes')).source,running=first.service.runJobs();assert.equal(first.repo.get('a',source.id).status,'processing');second=fixture(path,async()=>extracted('NEW_OWNER_CONTENT'),()=>false);assert.equal(second.repo.get('a',source.id).status,'pending');await second.service.runJobs();const committed=second.repo.get('a',source.id);assert.equal(committed.status,'ready');held.resolve(extracted('LATE_OLD_OWNER_CONTENT'));await running;assert.deepEqual(second.repo.get('a',source.id),committed);assert.equal(second.repo.search('a','LATE').length,0);assert.match(second.repo.read('a',source.id).chunks[0].text,/NEW_OWNER_CONTENT/);
 }finally{held.resolve(extracted('released'));await first.close();if(second)await second.close();rmSync(directory,{recursive:true,force:true})}
});

test('a served Knowledge receipt detects changed chunk bytes without mutating its historical facts or crossing sessions',async()=>{
 const f=fixture();try{const uploaded=f.service.upload('a','grounded','Cedar.txt',Buffer.from('Cedar controlled original facts')).source;await f.service.runJobs();const chat=new AiChatRepository(f.store.db),session=chat.createSession('a'),turn=chat.accept(session.id,{accountId:'a',clientRequestId:'grounding-turn',expectedRevision:0,prompt:'Cedar facts',context:{resources:['knowledge']}},'synthetic').turn;chat.update(turn.id,value=>{value.state='running'});const retrieval=new AiRetrieval(f.store,chat,turn.id),summary=retrieval.knowledgeSearch({query:'Cedar'}).sources[0];chat.dispatch(turn.id,[summary.id],{});const receipt=retrieval.knowledgeRead({sourceIds:[summary.id]}).documents[0].source,before=structuredClone(receipt);assert.equal(retrieval.resolve('a',session.id,turn.id,receipt.id).resolution.availability,'available');const chunk=(receipt.target as {kind:'knowledge';chunkIds:string[]}).chunkIds[0];f.store.db.prepare('UPDATE knowledge_chunks SET text=? WHERE id=?').run('CHANGED_CURRENT_BYTES',chunk);assert.equal(retrieval.resolve('a',session.id,turn.id,receipt.id).resolution.availability,'changed');assert.deepEqual(retrieval.resolve('a',session.id,turn.id,receipt.id).source,before);const foreign=chat.createSession('b');assert.throws(()=>retrieval.resolve('b',foreign.id,turn.id,receipt.id),{status:404});assert.equal(f.repo.get('a',uploaded.id).status,'ready');
 }finally{await f.close()}
});
