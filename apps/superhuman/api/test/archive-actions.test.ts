import './archive-network-deny.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createApp} from '../src/server.ts';
import {ArchiveActionService} from '../src/archive-actions.ts';
import {OperationQueue} from '../src/operation-queue.ts';
import {actionBasis} from '../src/archive-action-basis.ts';
import {googleArchiveAction,type ArchiveNativeGuard,type ArchiveNativeInput} from '../src/archive-action-google.ts';
import type {Thread} from '../src/types.ts';
const denied=(globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
if(!denied)throw Error('preload_required');
after(()=>assert.equal(denied.attempts,0));
const thread=(id='t',accountId='a'):Thread=>({id,accountId,providerId:id,subject:'Synthetic question',snippet:'Synthetic',sender:{name:'Own',email:'own@example.test'},participants:[],lastMessageAt:'2026-10-29T00:00:00.000Z',unread:true,starred:false,important:false,folder:'inbox',labels:[],providerLabels:['INBOX','UNREAD'],messages:[{id:'m-'+id,sender:{name:'Own',email:'own@example.test'},to:[{name:'Own',email:'own@example.test'}],date:'2026-10-29T00:00:00.000Z',internetMessageId:'<'+id+'@example.test>',text:'Fictional only.',attachments:[]}]});
function fixture(options:{google?:boolean;
native?:(input:ArchiveNativeInput,guard:ArchiveNativeGuard)=>Promise<unknown>;
path?:string}={}){const path=options.path??':memory:',app=createApp({databasePath:path,env:{DATABASE_PATH:path},seed:false,runJobs:false,providerDraftAutomatic:false,aiFetch:async()=>{throw Error('no_model')}
});
if(!app.store.get('account','a')){app.store.put('account','a',{id:'a',provider:options.google?'google':'demo',email:'own@example.test',name:'Own',color:'#000'});
app.store.put('thread','t',thread());
app.store.put('thread','u',thread('u'));
app.store.updatePreferences({activeAccountId:'a'});
app.store.put('googleGrant','mail:a',{accountId:'a',service:'mail',grantedScopes:['https://www.googleapis.com/auth/gmail.modify'],requestedScopes:['https://www.googleapis.com/auth/gmail.modify'],outcome:'granted',scopeSource:'response',updatedAt:'2026-10-29T00:00:00.000Z'})}
let issues=0;
const service=new ArchiveActionService(app.store,app.google,new OperationQueue(),{native:options.native??(async(input,guard)=>{guard.beforeIssue();
issues++;
guard.onAck({providerThreadId:input.providerThreadId})}
)});
return{app,service,get issues(){return issues}
,request(id='t'){const b=service.basis(id,'a')!;
assert(b);
return{action:'archive',accountId:'a',accountVersion:b.accountVersion,expectedSourceVersion:b.sourceVersion,clientRequestId:randomUUID()}}
,async close(){service.close();
await app.close()}
}}
const changes=(f:ReturnType<typeof fixture>)=>Number(f.app.store.db.prepare('SELECT total_changes() n').get()!.n);
function http(app:ReturnType<typeof createApp>,method:string,url:string,value?:unknown){return new Promise<{status:number;
body:any}>(done=>{const req=Object.assign(Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]),{method,url,headers:{host:'127.0.0.1:3001',...(value!==undefined?{'content-type':'application/json'}:{})}}),res={status:0,setHeader(){}
,writeHead(status:number){this.status=status}
,end(v:unknown){done({status:this.status,body:JSON.parse(String(v))})}
};
app.server.emit('request',req,res)}
)}
test('actual HTTP bootstrap/summary/full expose zero-write action basis without Reply FULL or per-action context GET; keyed archive and Undo link atomically',async()=>{const f=fixture({google:true});
f.app.google.tokens=async()=>({access_token:'synthetic',expires_at:Date.now()+3600000});
f.app.google.fetcher=async()=>Response.json({id:'t'});
try{const before=changes(f),summaries=await http(f.app,'GET','/api/thread-summaries?accountId=a'),full=await http(f.app,'GET','/api/threads/t'),bootstrap=await http(f.app,'GET','/api/bootstrap');
assert.equal(changes(f),before);
assert.equal(summaries.body.threads.find((t:any)=>t.id==='t').archiveBasis.sourceVersion,full.body.thread.archiveBasis.sourceVersion);
assert.equal(bootstrap.body.threads.find((t:any)=>t.id==='t').archiveBasis.accountVersion,full.body.thread.archiveBasis.accountVersion);
assert.equal(bootstrap.body.archiveAccountVersions.a,full.body.thread.archiveBasis.accountVersion);
assert.equal(full.body.thread.reminderPresentation.replyAvailability,'unavailable');
const request=f.request(),response=await http(f.app,'POST','/api/threads/t/actions',request);
assert.equal(response.body.receipt.state,'confirmed');
assert(response.body.undoId);
assert.equal(response.body.thread.folder,'done');
const u=await http(f.app,'POST',`/api/threads/t/action-operations/${request.clientRequestId}/undo`,{accountId:'a',accountVersion:request.accountVersion,clientRequestId:randomUUID()});
assert.equal(u.body.undo.state,'confirmed');
assert.equal(u.body.thread.folder,'inbox')}
finally{await f.close()}
}
);
test('native Archive issue is durable before transport and exact key GET/POST never issue again',async()=>{let f:ReturnType<typeof fixture>,calls=0;
f=fixture({google:true,native:async(input,guard)=>{guard.beforeIssue();
calls++;
const row=JSON.parse(String(f.app.store.db.prepare('SELECT data FROM archive_action_operations').get()!.data));
assert.equal(row.state,'issued');
assert(row.undoId);
assert(f.app.store.db.prepare('SELECT id FROM undo WHERE id=?').get(row.undoId));
guard.onAck({providerThreadId:input.providerThreadId})}
});
try{const request=f.request(),result=await f.service.archive('t',request);
assert.equal(result.receipt.state,'confirmed');
const before=changes(f);
assert.deepEqual(f.service.get('t','a',request.accountVersion,request.clientRequestId).receipt,result.receipt);
assert.deepEqual((await f.service.archive('t',request)).receipt,result.receipt);
assert.equal(changes(f),before);
assert.equal(calls,1)}
finally{await f.close()}
}
);
test('lost Archive ACK locks unknown, keeps Undo and local state, and refuses distinct target retry without second provider issue',async()=>{let calls=0;
const f=fixture({google:true,native:async(_input,guard)=>{guard.beforeIssue();
calls++;
throw Error('synthetic_lost_ack')}
});
try{const request=f.request(),r=await f.service.archive('t',request);
assert.equal(r.receipt.state,'unknown');
assert.equal(f.app.store.required<Thread>('thread','t').folder,'done');
assert(r.undoId);
assert.equal((await f.service.archive('t',request)).receipt.state,'unknown');
const another=await f.service.archive('t',f.request());
assert.equal(another.receipt.state,'refused');
assert.equal(another.receipt.reason,'archive_unknown_locked');
assert.equal(calls,1);
await assert.rejects(f.service.undo('t',request.clientRequestId,{accountId:'a',accountVersion:request.accountVersion,clientRequestId:randomUUID()}),/unavailable/)}
finally{await f.close()}
}
);
test('definite preissue refusal rolls back only the own Archive delta and preserves a concurrent read/star',async()=>{let f:ReturnType<typeof fixture>;
f=fixture({google:true,native:async()=>{for(const action of ['read','star']){const p=f.app.store.prepareAction('t',action);
f.app.store.commitAction(p.before,p.thread)}
throw Error('synthetic_before_issue')}
});
try{const r=await f.service.archive('t',f.request());
assert.equal(r.receipt.state,'refused');
assert.equal(r.undoId,null);
const t=f.app.store.required<Thread>('thread','t');
assert.equal(t.folder,'inbox');
assert.equal(t.unread,false);
assert.equal(t.starred,true);
assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM undo').get()!.n,2)}
finally{await f.close()}
}
);
test('metadata renewal preserves basis while actual source/folder ABA and account replacement fence old requests with scoped refusals',async()=>{const f=fixture();
try{const request=f.request(),t=f.app.store.required<Thread>('thread','t');
f.app.store.put('thread','t',{...t,unread:false,starred:true,labels:['display-label'],snippet:'Renewed display',messages:t.messages.map(m=>({...m,trackingRead:{messageRef:'synthetic'}}))});
assert.equal(f.service.basis('t','a')!.sourceVersion,request.expectedSourceVersion);
f.app.store.put('thread','t',{...f.app.store.required<Thread>('thread','t'),folder:'done'});
f.app.store.put('thread','t',{...f.app.store.required<Thread>('thread','t'),folder:'inbox'});
const stale=await f.service.archive('t',request);
assert.equal(stale.receipt.state,'refused');
assert.equal(stale.receipt.reason,'archive_source_changed');
const next=f.request();
f.app.store.put('account','a',{...f.app.store.required<any>('account','a'),email:'replacement@example.test'});
const r=await f.service.archive('t',next);
assert.equal(r.receipt.state,'refused');
assert.equal(r.receipt.reason,'archive_account_changed');
assert.equal(r.thread,undefined)}
finally{await f.close()}
}
);
test('atomic receipt insertion failure cannot leave local Archive or orphan Undo accepted',async()=>{const f=fixture({google:true});
try{const request=f.request(),before=f.app.store.required('thread','t');
f.app.store.db.exec("CREATE TRIGGER reject_archive_receipt BEFORE INSERT ON archive_action_operations BEGIN SELECT RAISE(ABORT,'synthetic receipt failure');END");
await assert.rejects(f.service.archive('t',request));
assert.deepEqual(f.app.store.required('thread','t'),before);
assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM undo').get()!.n,0);
assert.equal(f.issues,0)}
finally{await f.close()}
}
);
test('per-account FIFO includes scoped Undo and late unrelated metadata survives restoration',async()=>{const order:string[]=[],f=fixture({google:true,native:async(input,guard)=>{guard.beforeIssue();
order.push(input.providerThreadId+(input.addInbox?':undo':':archive'));
await new Promise(r=>setImmediate(r));
guard.onAck({providerThreadId:input.providerThreadId})}
});
try{const a=f.request('t'),b=f.request('u'),p=f.service.archive('t',a),q=f.service.archive('u',b);
await Promise.all([p,q]);
const star=f.app.store.prepareAction('t','star');
f.app.store.commitAction(star.before,star.thread);
const u=await f.service.undo('t',a.clientRequestId,{accountId:'a',accountVersion:a.accountVersion,clientRequestId:randomUUID()});
assert.equal(u.undo!.state,'confirmed');
assert.equal(u.thread!.starred,true);
assert.deepEqual(order,['t:archive','u:archive','t:undo'])}
finally{await f.close()}
}
);
test('lost keyed Undo ACK remains unknown and neither exact-key recovery nor duplicate Undo reissues it',async()=>{let calls=0;
const f=fixture({google:true,native:async(input,guard)=>{guard.beforeIssue();
calls++;
if(input.addInbox)throw Error('synthetic_lost_undo_ack');
guard.onAck({providerThreadId:input.providerThreadId})}
});
try{const request=f.request();
await f.service.archive('t',request);
const undo={accountId:'a',accountVersion:request.accountVersion,clientRequestId:randomUUID()},r=await f.service.undo('t',request.clientRequestId,undo);
assert.equal(r.undo!.state,'unknown');
assert.equal((await f.service.undo('t',request.clientRequestId,undo)).undo!.state,'unknown');
const before=changes(f);
assert.equal(f.service.get('t','a',request.accountVersion,request.clientRequestId).undo!.state,'unknown');
assert.equal(changes(f),before);
assert.equal(calls,2);
assert.equal(f.app.store.required<Thread>('thread','t').folder,'done')}
finally{await f.close()}
}
);
test('ordinary unkeyed actions/Undo remain available while a keyed-owned Undo cannot bypass its receipt through the legacy route',async()=>{const f=fixture();
try{const p=await http(f.app,'POST','/api/threads/t/actions',{action:'archive'});
assert.equal(p.body.receipt,undefined);
const restored=await http(f.app,'POST','/api/undo',{undoId:p.body.undoId});
assert.equal(restored.body.thread.folder,'inbox');
const request=f.request(),keyed=await http(f.app,'POST','/api/threads/t/actions',request),legacy=await http(f.app,'POST','/api/undo',{undoId:keyed.body.undoId});
assert.equal(legacy.status,409);
assert.equal(legacy.body.error.code,'archive_keyed_undo_required')}
finally{await f.close()}
}
);
test('restart preserves issued unknown with zero provider dispatch and exact status reads allocate no writes',async()=>{const dir=mkdtempSync(join(tmpdir(),'archive-owned-')),path=join(dir,'mail.sqlite');
let f=fixture({path,google:true,native:async(_i,g)=>{g.beforeIssue();
throw Error('synthetic_lost_ack')}
});
const request=f.request();
try{await f.service.archive('t',request);
await f.close();
f=fixture({path,google:true,native:async()=>{throw Error('must_not_dispatch')}
});
const before=changes(f);
assert.equal(f.service.get('t','a',request.accountVersion,request.clientRequestId).receipt.state,'unknown');
assert.equal((await f.service.archive('t',request)).receipt.state,'unknown');
assert.equal(changes(f),before)}
finally{await f.close();
rmSync(dir,{recursive:true,force:true})}
}
);
test('dedicated real-shaped Google adapter has fixed labels/route, one native issue and positive ACK before later Stop',async()=>{const f=fixture({google:true});
let calls=0,issued=false,known=false;
const abort=new AbortController();
f.app.google.tokens=async()=>({access_token:'synthetic',expires_at:Date.now()+3600000});
f.app.google.fetcher=async(url,init={})=>{calls++;
assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/threads/t/modify');
assert.equal(issued,true);
assert.deepEqual(JSON.parse(String(init.body)),{addLabelIds:[],removeLabelIds:['INBOX']});
assert.equal(init.redirect,'manual');
assert.equal(init.credentials,'omit');
return Response.json({id:'t'})}
;
try{await assert.rejects(googleArchiveAction(f.app.google,{accountId:'a',providerThreadId:'t',addInbox:false,removeInbox:true},{signal:abort.signal,beforeIssue(){issued=true}
,onAck(){known=true;
abort.abort()}
}));
assert.equal(known,true);
assert.equal(calls,1)}
finally{await f.close()}
}
);
test('dedicated adapter refuses redirects/over-limit bodies/foreign ACK once, with no read or write retry',async()=>{for(const mode of ['redirect','size','scope']){const f=fixture({google:true});
let calls=0,ack=0;
f.app.google.tokens=async()=>({access_token:'synthetic',expires_at:Date.now()+3600000});
f.app.google.fetcher=async()=>{calls++;
return mode==='redirect'?Response.json({}, {status:302,headers:{location:'https://unapproved.example.test/'}}):mode==='size'?Response.json({id:'t'},{headers:{'content-length':'262145'}}):Response.json({id:'other'})}
;
try{await assert.rejects(googleArchiveAction(f.app.google,{accountId:'a',providerThreadId:'t',addInbox:false,removeInbox:true},{signal:new AbortController().signal,beforeIssue(){}
,onAck(){ack++}
}));
assert.equal(calls,1);
assert.equal(ack,0)}
finally{await f.close()}
}
}
);
test('positive native ACK followed by source change remains durably known unknown and never overwrites the changed source',async()=>{let f:ReturnType<typeof fixture>,calls=0;
f=fixture({google:true,native:async(input,guard)=>{guard.beforeIssue();
calls++;
guard.onAck({providerThreadId:input.providerThreadId});
const t=f.app.store.required<Thread>('thread','t');
f.app.store.put('thread','t',{...t,messages:[...t.messages,{...t.messages[0],id:'later',text:'Synthetic later source.'}]})}
});
try{const r=await f.service.archive('t',f.request());
assert.equal(r.receipt.state,'unknown');
const stored=JSON.parse(String(f.app.store.db.prepare('SELECT data FROM archive_action_operations').get()!.data));
assert.equal(stored.ack.providerThreadId,'t');
assert.equal(f.app.store.required<Thread>('thread','t').messages.length,2);
assert.equal(calls,1)}
finally{await f.close()}
}
);
test('account ABA after local acceptance refuses before native issue and preserves the scoped conflict instead of restoring into replacement identity',async()=>{let f:ReturnType<typeof fixture>,issues=0;
f=fixture({google:true,native:async(_input,guard)=>{const a=f.app.store.required<any>('account','a');
f.app.store.put('account','a',{...a,email:'other@example.test'});
f.app.store.put('account','a',a);
guard.beforeIssue();
issues++}
});
try{const r=await f.service.archive('t',f.request());
assert.equal(r.receipt.state,'refused');
assert.equal(r.receipt.reason,'archive_refused_local_conflict');
assert.equal(r.thread,undefined);
assert.equal(issues,0);
assert(r.undoId)}
finally{await f.close()}
}
);
test('source deletion/reinsert ABA changes its opaque version and a removed source head is never repaired by GET or another owner',async()=>{const f=fixture();
try{const old=f.service.basis('t','a')!,t=f.app.store.required<Thread>('thread','t');
f.app.store.remove('thread','t');
f.app.store.put('thread','t',t);
assert.notEqual(f.service.basis('t','a')!.sourceVersion,old.sourceVersion);
f.app.store.db.prepare('DELETE FROM archive_action_heads WHERE thread_id=?').run('t');
const n=changes(f);
assert.equal(f.service.basis('t','a'),null);
assert.equal(changes(f),n);
const s=new ArchiveActionService(f.app.store,f.app.google,new OperationQueue());
assert.equal(s.basis('t','a'),null);
s.close()}
finally{await f.close()}
}
);
test('same key with a changed immutable request is rejected without another action/Undo/provider attempt',async()=>{const f=fixture({google:true});
try{const request=f.request();
await f.service.archive('t',request);
const n=changes(f);
await assert.rejects(f.service.archive('t',{...request,expectedSourceVersion:'a'.repeat(64)}),e=>(e as any).code==='archive_key_conflict');
assert.equal(changes(f),n);
assert.equal(f.issues,1)}
finally{await f.close()}
}
);
test('legacy provider-facing action queued behind an unknown keyed Archive rechecks the lock inside the account queue',async()=>{const f=fixture({google:true});
let entered!:()=>void,release!:()=>void,legacyCalls=0;
const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
f.app.google.tokens=async()=>({access_token:'synthetic',expires_at:Date.now()+3600000});
f.app.google.fetcher=async()=>{entered();
await wait;
throw Error('synthetic_lost_ack')}
;
f.app.google.updateThread=async()=>{legacyCalls++}
;
try{const request=f.request(),a=http(f.app,'POST','/api/threads/t/actions',request);
await started;
const legacy=http(f.app,'POST','/api/threads/t/actions',{action:'unarchive'});
release();
assert.equal((await a).body.receipt.state,'unknown');
const r=await legacy;
assert.equal(r.status,409);
assert.equal(r.body.error.code,'archive_unknown_locked');
assert.equal(legacyCalls,0)}
finally{release?.();
await f.close()}
}
);
test('atomic Archive refresh preserves metadata written after initial preparation and refuses a true source change before acceptance',async()=>{for(const mode of ['metadata','source']){const f=fixture({google:true}),original=f.app.store.commitAction.bind(f.app.store);
let injected=false;
f.app.store.commitAction=((...args:any[])=>{if(!injected){injected=true;
const t=f.app.store.required<Thread>('thread','t');
f.app.store.put('thread','t',{...t,unread:false,starred:true,...(mode==='source'?{messages:[...t.messages,{...t.messages[0],id:'new-source'}]}:{})})}
return(original as any)(...args)}
)as any;
try{const r=await f.service.archive('t',f.request());
assert.equal(r.receipt.state,mode==='metadata'?'confirmed':'refused');
const t=f.app.store.required<Thread>('thread','t');
assert.equal(t.unread,false);
assert.equal(t.starred,true);
assert.equal(t.folder,mode==='metadata'?'done':'inbox');
assert.equal(f.issues,mode==='metadata'?1:0)}
finally{await f.close()}
}
}
);
test('two independent owners see the durable pending Undo reservation and only its owner reaches provider issue',async()=>{let entered!:()=>void,release!:()=>void;
const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
let calls=0;
const f=fixture({google:true,native:async(input,guard)=>{if(input.addInbox){entered();
await wait}
guard.beforeIssue();
calls++;
guard.onAck({providerThreadId:input.providerThreadId})}
}),other=new ArchiveActionService(f.app.store,f.app.google,new OperationQueue(),{native:async()=>{throw Error('must_not_issue')}
});
try{const request=f.request();
await f.service.archive('t',request);
const undo={accountId:'a',accountVersion:request.accountVersion,clientRequestId:randomUUID()},first=f.service.undo('t',request.clientRequestId,undo);
await started;
const second=await other.undo('t',request.clientRequestId,undo);
assert.equal(second.undo!.state,'pending');
release();
assert.equal((await first).undo!.state,'confirmed');
assert.equal(calls,2)}
finally{release?.();
other.close();
await f.close()}
}
);
test('Stop during an unresolved credential preparation returns before Archive issue and cannot dispatch a late native write',async()=>{const f=fixture({google:true}),abort=new AbortController();
let issues=0,fetches=0;
f.app.google.tokens=()=>new Promise(()=>{}
);
f.app.google.fetcher=async()=>{fetches++;
return Response.json({id:'t'})}
;
try{const work=googleArchiveAction(f.app.google,{accountId:'a',providerThreadId:'t',addInbox:false,removeInbox:true},{signal:abort.signal,beforeIssue(){issues++}
,onAck(){throw Error('must_not_ack')}
});
setTimeout(()=>abort.abort(),5);
await assert.rejects(work);
assert.equal(issues,0);
assert.equal(fetches,0)}
finally{await f.close()}
}
);
