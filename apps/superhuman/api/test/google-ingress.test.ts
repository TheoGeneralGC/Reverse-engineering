import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.ts';
import {GoogleProvider} from '../src/google.ts';
import {GoogleIngressAdapter,type GooglePublication,type GoogleHistoryPage} from '../src/google-ingress.ts';
import {HttpError,type Account,type Thread} from '../src/types.ts';
const H='a'.repeat(64),B='b'.repeat(64),account:Account={id:'google:fixture',provider:'google',email:'self@example.test',name:'Synthetic',color:'#888'};
const denied=(async()=>{throw Error('Real fetch forbidden')}) as typeof fetch;
const code=(v:string)=>(e:unknown)=>(e as {code?:string}).code===v;
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}}
const count=(s:Store,t:string)=>Number(s.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n);
function message(id='m1',date='1793286000000'){
 return{id,threadId:'t1',internalDate:date,snippet:'Fictional &amp; source',labelIds:['INBOX','UNREAD'],payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'Fictional <source@example.test>'},{name:'To',value:'Self <self@example.test>'},{name:'Subject',value:'Synthetic question'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Fictional question '+id).toString('base64url')}},{mimeType:'application/octet-stream',filename:'fictional.txt',body:{data:Buffer.from('Owned fake bytes').toString('base64url')}}]}};
}
function fixture(onPublication?:(p:GooglePublication)=>void,path=':memory:'){
 const store=new Store(path,false);store.put('account',account.id,account);let time=Date.parse('2026-10-29T15:00:00.000Z'),version=H;
 const publications:GooglePublication[]=[];const adapter=new GoogleIngressAdapter(store,{accountVersion:()=>version,now:()=>time,onPublication:p=>{publications.push(p);return onPublication?.(p)}});
 const provider=new GoogleProvider(store,{},denied,{now:()=>time,sleep:async()=>{},random:()=>0},adapter);
 let page:GoogleHistoryPage={historyId:'10',history:[]},raw=[message()];let listing:string[]=[];let calls=0;
 provider.request=async(_id,path)=>{calls++;assert.equal(adapter.readiness(account.id).pendingRead,true,'lease must predate every fetch');if(path==='labels')return{labels:[]};if(path==='profile')return{historyId:'10'};if(path.startsWith('threads?'))return{threads:listing.map(id=>({id}))};if(path.startsWith('history?'))return structuredClone(page);if(path==='threads/t1?format=full')return{id:'t1',messages:structuredClone(raw)};throw Error('Unexpected fake route '+path)};
 return{store,adapter,provider,publications,setPage(p:GoogleHistoryPage){page=p},setRaw(m:ReturnType<typeof message>[]){raw=m},setListing(ids:string[]){listing=ids},setVersion(v:string){version=v},advance(ms:number){time+=ms},now:()=>time,async prime(){await provider.sync(account.id);assert.equal(adapter.readiness(account.id).ready,true)},calls:()=>calls,close(){adapter.close();store.close()}};
}
const added=(cursor='12',entry='11',messages=[{id:'m1',threadId:'t1'}]):GoogleHistoryPage=>({historyId:cursor,history:[{id:entry,messagesAdded:messages.map(message=>({message}))}]});

test('live exact messagesAdded occurrence uses canonical H2 and preserves huge decimal history strings',async()=>{
 const f=fixture();try{await f.prime();const prior='9007199254740993123456789010';f.store.put('sync',account.id,{phase:'history',historyId:prior,generation:'g',partial:false});f.setPage(added('9007199254740993123456789012','9007199254740993123456789011'));await f.provider.sync(account.id);const p=f.publications.at(-1)!;assert.equal(p.origin,'live');assert.equal(p.occurrences.length,1);assert.deepEqual(p.occurrences[0].history,{entryId:'9007199254740993123456789011',afterCursor:prior,throughCursor:'9007199254740993123456789012',addedSourceRefs:[p.occurrences[0].sourceRef]});assert.equal(p.occurrences[0].sequence,1);assert.equal(f.store.list('messageAttachment').length,1)}finally{f.close()}
});

test('newer hydrated M2 has no occurrence until its own later positive history evidence',async()=>{
 const f=fixture();try{await f.prime();f.setRaw([message(),message('m2','1793286000001')]);f.setPage(added());await f.provider.sync(account.id);const first=f.publications.at(-1)!.occurrences;assert.equal(first.length,1);const m1=first[0];f.setPage(added('14','13',[{id:'m2',threadId:'t1'}]));await f.provider.sync(account.id);const second=f.publications.at(-1)!.occurrences;assert.equal(second.length,1);assert.notEqual(second[0].sourceRef,m1.sourceRef);assert.equal(second[0].sequence,2);assert.equal(count(f.store,'google_ingress_occurrences'),2);assert.equal(f.store.required<Thread>('thread',account.id+':t1').messages.length,2)}finally{f.close()}
});

test('label/read refresh publishes Mail but does not create positive occurrence',async()=>{
 const f=fixture();try{await f.prime();f.setPage({historyId:'12',history:[{id:'11',labelsRemoved:[{message:{id:'m1',threadId:'t1'}}]}]});await f.provider.sync(account.id);assert.equal(f.publications.length,1);assert.deepEqual(f.publications[0].occurrences,[]);assert.equal(count(f.store,'google_ingress_occurrences'),0);assert.ok(f.store.get('thread',account.id+':t1'))}finally{f.close()}
});

test('initial import and initial catchup additions never yield eligible callbacks',async()=>{
 const f=fixture();try{f.setListing(['t1']);await f.provider.sync(account.id,{maxPages:1});assert.equal(f.publications[0].origin,'initial');f.setPage(added());await f.provider.sync(account.id);assert.equal(f.publications.at(-1)!.origin,'repair');assert.equal(f.publications.flatMap(p=>p.occurrences).length,0);assert.equal(f.adapter.readiness(account.id).ready,true)}finally{f.close()}
 const c=fixture();try{c.store.put('sync',account.id,{phase:'initial',historyId:'10',generation:'initial-g',partial:true,pageToken:'remaining'});c.setPage(added());await c.provider.sync(account.id,{maxPages:1,maxThreadReads:1,catchupDuringInitial:true});assert.equal(c.publications[0].origin,'catchup');assert.deepEqual(c.publications[0].occurrences,[])}finally{c.close()}
});

test('observer rollback removes attachments Thread both projections source versions and outbox together',async()=>{
 let reject=true;const f=fixture(p=>{if(reject&&p.occurrences.length)throw Error('Controlled observer failure')});try{await f.prime();f.setPage(added());await assert.rejects(()=>f.provider.sync(account.id),/Controlled/);assert.equal(f.store.list('messageAttachment').length,0);assert.equal(f.store.list('thread').length,0);assert.equal(count(f.store,'split_header_facts'),0);assert.equal(count(f.store,'google_ingress_sources'),0);assert.equal(count(f.store,'google_ingress_versions'),0);assert.equal(count(f.store,'google_ingress_occurrences'),0);reject=false;await f.provider.sync(account.id);assert.equal(count(f.store,'google_ingress_occurrences'),1);assert.equal(f.store.list('messageAttachment').length,1);assert.equal(count(f.store,'split_header_facts'),1)}finally{f.close()}
});

test('crash after atomic publication before pending checkpoint replays the same occurrence and durable observer receipt',async()=>{
 const f=fixture(p=>{for(const occurrence of p.occurrences)f.store.db.prepare('INSERT OR IGNORE INTO observer_receipts VALUES(?)').run(occurrence.id)});try{f.store.db.exec('CREATE TABLE observer_receipts(id TEXT PRIMARY KEY)');await f.prime();f.setPage(added());const put=f.store.put.bind(f.store);let crash=true;f.store.put=((kind:string,id:string,data:any)=>{if(crash&&kind==='sync'&&data.pending?.ids.length===0){crash=false;throw Error('Controlled checkpoint crash')}return put(kind,id,data)}) as typeof f.store.put;await assert.rejects(()=>f.provider.sync(account.id),/checkpoint crash/);assert.equal(count(f.store,'google_ingress_occurrences'),1);const original=f.publications.at(-1)!.occurrences[0];await f.provider.sync(account.id);assert.deepEqual(f.publications.at(-1)!.occurrences[0],original);assert.equal(count(f.store,'observer_receipts'),1);assert.equal(count(f.store,'google_ingress_occurrences'),1)}finally{f.close()}
});

test('a scoped read lease blocks the second live owner before it can fetch',async()=>{
 const f=fixture();try{await f.prime();const hold=deferred<unknown>(),entered=deferred<void>(),original=f.provider.request.bind(f.provider);f.provider.request=async(id,path)=>{if(path.startsWith('history?')){entered.resolve();return hold.promise}return original(id,path)};const first=f.provider.sync(account.id);await entered.promise;const second=new GoogleIngressAdapter(f.store,{accountVersion:()=>H,now:f.now,ownerAlive:()=>true});const provider2=new GoogleProvider(f.store,{},denied,{},second);let calls=0;provider2.request=async()=>{calls++;return{}};await assert.rejects(()=>provider2.sync(account.id),code('google_ingress_busy'));assert.equal(calls,0);hold.resolve({historyId:'10',history:[]});await first;second.close()}finally{f.close()}
});

test('expired read lease ABA fences the old response after a newer owner completed',async()=>{
 const f=fixture();try{await f.prime();const hold=deferred<unknown>(),entered=deferred<void>(),original=f.provider.request.bind(f.provider);f.provider.request=async(id,path)=>{if(path.startsWith('history?')){entered.resolve();return hold.promise}return original(id,path)};const first=f.provider.sync(account.id);await entered.promise;f.advance(120001);const other=new GoogleIngressAdapter(f.store,{accountVersion:()=>H,now:f.now});const lease=other.begin(account.id);other.finish(lease,false);hold.resolve(added());await assert.rejects(()=>first,code('google_ingress_stale'));assert.equal(f.store.list('thread').length,0);assert.equal(count(f.store,'google_ingress_occurrences'),0);other.close()}finally{f.close()}
});

test('dead-owner recovery uses a fresh durable epoch and fences late old thread hydration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'google-ingress-peer-')),path=join(dir,'fixture.sqlite');const f=fixture(undefined,path);let other:Store|undefined;try{await f.prime();f.setPage(added());const hold=deferred<unknown>(),entered=deferred<void>(),original=f.provider.request.bind(f.provider);f.provider.request=async(id,p)=>{if(p.startsWith('threads/t1')){entered.resolve();return hold.promise}return original(id,p)};const first=f.provider.sync(account.id);await entered.promise;other=new Store(path,false);const takeover=new GoogleIngressAdapter(other,{accountVersion:()=>H,now:f.now,ownerAlive:()=>false});const lease=takeover.begin(account.id);takeover.finish(lease,false);hold.resolve({id:'t1',messages:[message()]});await assert.rejects(()=>first,code('google_ingress_stale'));assert.equal(f.store.list('thread').length,0);takeover.close()}finally{other?.close();f.close();rmSync(dir,{recursive:true,force:true})}
});

test('scope incarnation change and close fence held reads without publication',async()=>{
 for(const close of [false,true]){const f=fixture();try{await f.prime();const hold=deferred<unknown>(),entered=deferred<void>(),original=f.provider.request.bind(f.provider);f.provider.request=async(id,path)=>{if(path.startsWith('history?')){entered.resolve();return hold.promise}return original(id,path)};const pending=f.provider.sync(account.id);await entered.promise;if(close)f.adapter.close();else f.setVersion(B);hold.resolve(added());await assert.rejects(()=>pending);assert.equal(count(f.store,'google_ingress_occurrences'),0);assert.equal(f.store.list('thread').length,0)}finally{f.close()}}
});

test('readiness barrier is read-only transaction-bound and excludes pending reads and partial pages',async()=>{
 const f=fixture();try{assert.equal(f.adapter.readiness(account.id).ready,false);assert.throws(()=>f.adapter.captureBarrier(account.id),code('google_ingress_barrier_transaction_required'));await f.prime();f.store.db.exec('BEGIN IMMEDIATE');const n=f.store.db.prepare('SELECT total_changes() AS n').get()!.n;const first=f.adapter.captureBarrier(account.id);assert.ok(first);assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get()!.n,n);f.store.db.exec('COMMIT');const lease=f.adapter.begin(account.id);f.store.db.exec('BEGIN');assert.equal(f.adapter.captureBarrier(account.id),null);f.store.db.exec('COMMIT');f.adapter.finish(lease,false);assert.equal(f.adapter.readiness(account.id).ready,false);await f.provider.sync(account.id);assert.equal(f.adapter.readiness(account.id).ready,true)}finally{f.close()}
});

test('history404 invalidates anchor immediately and a fresh completed baseline does not backfill',async()=>{
 const f=fixture();try{await f.prime();const before=f.adapter.readiness(account.id).baselineVersion;let expired=true;const original=f.provider.request.bind(f.provider);f.provider.request=async(id,path)=>{if(path.startsWith('history?')&&expired){expired=false;throw new HttpError(404,'Expired','google_not_found')}return original(id,path)};f.setListing(['t1']);await f.provider.sync(account.id);assert.notEqual(f.adapter.readiness(account.id).baselineVersion,before);assert.equal(f.publications.flatMap(p=>p.occurrences).length,0);f.setPage(added());await f.provider.sync(account.id);assert.equal(f.publications.flatMap(p=>p.occurrences).length,0);assert.equal(f.adapter.readiness(account.id).ready,true)}finally{f.close()}
});

test('unsafe history numbers missing entry IDs or substituted proof fail closed without a positive write',async()=>{
 for(const invalid of [{historyId:12,history:[]},{historyId:'12',history:[{messagesAdded:[{message:{id:'m1',threadId:'t1'}}]}]}]){const f=fixture();try{await f.prime();f.setPage(invalid as any);await assert.rejects(()=>f.provider.sync(account.id));assert.equal(count(f.store,'google_ingress_occurrences'),0);assert.equal(f.store.list('thread').length,0)}finally{f.close()}}
 const f=fixture();try{await f.prime();const lease=f.adapter.begin(account.id),proof=f.adapter.page(lease,'10',added(),'live');proof.entries[0].added[0].id='m2';f.store.db.exec('BEGIN');assert.throws(()=>f.adapter.publish(lease,{...({} as Thread),id:account.id+':t1',accountId:account.id,providerId:'t1',messages:[]},proof),code('google_ingress_corrupt'));f.store.db.exec('ROLLBACK');f.adapter.finish(lease,false)}finally{f.close()}
});

test('default unwired provider still publishes attachment and Thread atomically with no ingress tables',async()=>{
 const store=new Store(':memory:',false);store.put('account',account.id,account);const p=new GoogleProvider(store,{},denied);p.request=async(_id,path)=>path==='labels'?{labels:[]}:path==='profile'?{historyId:'10'}:path.startsWith('threads?')?{threads:[{id:'t1'}]}:path.startsWith('history?')?{historyId:'10',history:[]}:{id:'t1',messages:[message()]};const put=store.put.bind(store);store.put=((kind:string,id:string,data:any)=>{const result=put(kind,id,data);if(kind==='thread')throw Error('Controlled post-projection failure');return result}) as typeof store.put;try{await assert.rejects(()=>p.sync(account.id),/post-projection/);assert.equal(store.list('messageAttachment').length,0);assert.equal(store.list('thread').length,0);assert.equal(count(store,'split_header_facts'),0);assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='google_ingress_meta'").get(),undefined)}finally{store.close()}
});

test('scoped immutable source lookup retains exact message and authoritative Reply-To absence despite later Mail changes',async()=>{
 const f=fixture();try{await f.prime();f.setPage(added());await f.provider.sync(account.id);const occurrence=f.publications.at(-1)!.occurrences[0],source=f.adapter.sourceVersion(account.id,occurrence.sourceRef,occurrence.inputVersion);assert.equal(source.providerMessageId,'m1');assert.equal(source.providerThreadId,'t1');assert.equal(source.message.providerLabels,undefined);assert.deepEqual(source.replyMetadata,{headersComplete:true,replyTo:null});const thread=f.store.required<Thread>('thread',account.id+':t1');f.store.put('thread',thread.id,{...thread,messages:[]});assert.deepEqual(f.adapter.sourceVersion(account.id,occurrence.sourceRef,occurrence.inputVersion),source);assert.throws(()=>f.adapter.sourceVersion(account.id,occurrence.sourceRef,B),code('google_ingress_source_not_found'));f.store.db.prepare('UPDATE google_ingress_versions SET data=? WHERE source_ref=?').run(JSON.stringify({...source,providerThreadId:'substituted'}),occurrence.sourceRef);assert.throws(()=>f.adapter.sourceVersion(account.id,occurrence.sourceRef,occurrence.inputVersion),code('google_ingress_corrupt'))}finally{f.close()}
});

test('ambiguous duplicate Reply-To cannot be projected as authoritative header absence',async()=>{
 const f=fixture();try{await f.prime();const raw=message();raw.payload.headers.push({name:'Reply-To',value:'first@example.test'},{name:'reply-to',value:'second@example.test'});f.setRaw([raw]);f.setPage(added());await f.provider.sync(account.id);const occurrence=f.publications.at(-1)!.occurrences[0];assert.deepEqual(f.adapter.sourceVersion(account.id,occurrence.sourceRef,occurrence.inputVersion).replyMetadata,{headersComplete:false,replyTo:null})}finally{f.close()}
});

test('exact added set may allocate other-message identity but not a version or occurrence before its own hydration',async()=>{
 const f=fixture();try{await f.prime();f.setPage(added('12','11',[{id:'m1',threadId:'t1'},{id:'m3',threadId:'t3'}]));await f.provider.sync(account.id,{maxThreadReads:1});const occurrence=f.publications.at(-1)!.occurrences[0];assert.equal(occurrence.history!.addedSourceRefs.length,2);assert.equal(count(f.store,'google_ingress_sources'),2);assert.equal(count(f.store,'google_ingress_versions'),1);assert.equal(count(f.store,'google_ingress_occurrences'),1);assert.equal(f.adapter.readiness(account.id).ready,false)}finally{f.close()}
});

test('same source identity cannot retarget another thread and observer Promise rolls back publication',async()=>{
 const f=fixture();try{await f.prime();f.setPage(added());await f.provider.sync(account.id);const original=f.store.required<Thread>('thread',account.id+':t1'),lease=f.adapter.begin(account.id),proof=f.adapter.page(lease,'12',added('14','13',[{id:'m1',threadId:'t2'}]),'live');const other={...original,id:account.id+':t2',providerId:'t2'};assert.throws(()=>f.adapter.unit(lease,()=>{f.store.put('thread',other.id,other);f.adapter.publish(lease,other,proof)}),code('google_ingress_source_conflict'));assert.equal(f.store.get('thread',other.id),undefined);assert.equal(count(f.store,'google_ingress_occurrences'),1);f.adapter.finish(lease,false)}finally{f.close()}
 const p=fixture((()=>Promise.resolve()) as any);try{await p.prime();p.setPage(added());await assert.rejects(()=>p.provider.sync(account.id),code('google_ingress_async_observer_forbidden'));assert.equal(p.store.list('thread').length,0);assert.equal(p.store.list('messageAttachment').length,0);assert.equal(count(p.store,'google_ingress_occurrences'),0)}finally{p.close()}
});
