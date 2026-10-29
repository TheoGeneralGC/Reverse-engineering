// Contract-derived independent cases. Execute only after owner publishes a ready held surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import PostalMime from 'postal-mime';
import {parseFragment,serialize} from 'parse5';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAppFixture,invoke,SENDER,FOREIGN,BODY,HTML,ATTACHMENT,sha} from './tracking-independent-app-fixture.ts';
import type {Draft} from '../src/types.ts';

function enable(f:ReturnType<typeof createAppFixture>,enabled=true,key='preferences'){
 const current=f.app.tracking.response(SENDER).preferences;
 return f.app.tracking.save({accountId:SENDER,clientRequestId:key,expectedRevision:current.revision,desired:{readStatuses:enabled,recentOpens:false}});
}
async function status(f:ReturnType<typeof createAppFixture>,id:string,accountId=SENDER){
 return invoke(f.app,'GET','/api/tracking/deliveries/composer/'+encodeURIComponent(id)+'?accountId='+encodeURIComponent(accountId));
}
const code=(expected:string)=>(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===expected;
const stable=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';
const postStates=(f:ReturnType<typeof createAppFixture>)=>f.collector.calls.filter(c=>c.method==='POST').map(c=>JSON.parse(Buffer.from(c.bodyBase64,'base64').toString()).state as string);
const controlPath=(id:string)=>'/api/tracking/deliveries/composer/'+encodeURIComponent(id);
async function control(f:ReturnType<typeof createAppFixture>,id:string,action:'reconcile'|'continue',key:string){
 const before=await status(f,id);assert.equal(before.status,200);
 const response=await invoke(f.app,'POST',controlPath(id)+'/'+action,{accountId:SENDER,clientRequestId:key,expectedRevision:before.body.revision});
 assert(response.status>=200&&response.status<300);const original=response.body;
 for(let n=0;n<30;n++){
  const recovered=await invoke(f.app,'GET',controlPath(id)+'/requests/by-request/'+encodeURIComponent(key)+'?accountId='+SENDER);
  assert.equal(recovered.status,200);assert.equal(recovered.body.receipt.id,original.receipt.id);
  if(recovered.body.state==='completed')return recovered.body;
  assert.equal(recovered.body.state,'accepted');await new Promise<void>(resolve=>setImmediate(resolve));
 }
 throw Error('Synthetic control did not complete within bounded event-loop work');
}

test('disabled decision keeps native mapped delivery untracked with no collector startup/read/send effects',async()=>{
 const f=createAppFixture();try{
  assert.equal(f.collector.calls.length,0);assert.equal(f.nativeEntries.length,0);
  const draft=await f.draft(true,true),before=f.app.store.required<Draft>('draft',draft.id);
  const accepted=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'untracked-native')),op=accepted.snapshot.operation!;
  assert.equal(f.collector.calls.length,0);await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  assert.equal(f.nativeCalls.length,1);assert.equal(f.nativeCalls[0]!.id,before.providerDraftId);
  const decoded=await PostalMime.parse(Buffer.from(f.nativeCalls[0]!.raw,'base64url'));
  assert.equal(decoded.text,BODY);assert.equal(decoded.html,HTML);assert.equal(decoded.attachments.length,1);const content=decoded.attachments[0]!.content;if(typeof content==='string')throw Error('Unexpected synthetic parser attachment encoding');assert.equal(sha(content instanceof Uint8Array?content:new Uint8Array(content)),sha(ATTACHMENT));
  assert.equal(f.collector.calls.length,0);assert.equal(f.providerCalls.filter(c=>['create','update','delete'].includes(c.kind)).length,1);
  const after=f.app.store.required<Draft>('draft',draft.id);assert.equal(after.status,'sent');assert.equal(after.body,before.body);assert.equal(after.html,before.html);
  assert.equal(f.nativeEntries.some(c=>c.path.includes('/messages/send')),false);
 }finally{await f.close()}
});

test('tracked desired direct artifact refuses before acceptance without a shadow draft or collector request',async()=>{
 const f=createAppFixture();try{
  enable(f);const artifact=f.artifact('tracked-artifact');const before=f.app.store.list<Draft>('draft').length;
  assert.throws(()=>f.app.aiSend.submit(artifact.preview.id,artifact.request),code('tracking_mapped_draft_required'));
  assert.equal(f.app.store.list<Draft>('draft').length,before);assert.equal(f.app.aiSend.get(artifact.scope,artifact.preview.id).operation,null);
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM ai_draft_sends').get()!.n,0);
  assert.equal(f.collector.calls.length,0);assert.equal(f.nativeEntries.length,0);assert.equal(f.providerCalls.length,0);
 }finally{await f.close()}
});

test('tracked rich composer requires the already owned mapping without implicit provider creation',async()=>{
 const f=createAppFixture();try{
  const draft=await f.draft(false);enable(f);
  assert.throws(()=>f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'unmapped')),code('tracking_mapped_draft_required'));
  assert.equal(f.app.store.required<Draft>('draft',draft.id).status,'draft');assert.equal(f.app.draftSend.current(SENDER,draft.id).operation,null);
  assert.equal(f.providerCalls.length,0);assert.equal(f.collector.calls.length,0);assert.equal(f.nativeEntries.length,0);
 }finally{await f.close()}
});

test('tracked plain-only mapped composer refuses before locking or decorating authored content',async()=>{
 const f=createAppFixture();try{
  const first=await f.draft(),draft=f.app.store.saveDraft({id:first.id,html:''});await f.app.providerDrafts.flush(SENDER,draft.id);enable(f);
  const before=f.app.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(draft.id)!.data;
  assert.throws(()=>f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'plain-only')),code('tracking_rich_html_required'));
  assert.equal(f.app.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(draft.id)!.data,before);
  assert.equal(f.collector.calls.length,0);assert.equal(f.nativeEntries.length,0);
 }finally{await f.close()}
});

test('tracked Undo then fresh scheduled Cancel keep the same authored mapped draft and never activate registration',async()=>{
 const f=createAppFixture({undoWindowMs:10000});try{
  const draft=await f.draft(true,true),before=f.app.store.required<Draft>('draft',draft.id);enable(f);
  const firstRequest=f.sendRequest(draft.id,'generation-zero'),first=f.app.draftSend.submit(draft.id,firstRequest).snapshot.operation!;
  const queued=await status(f,first.id);assert.equal(queued.status,200);assert.equal(queued.body.phase,'queued');assert.equal(queued.body.mailOutcome,'not-issued');assert.equal(queued.body.registration,'inactive');
  f.app.draftSend.cancel(first.id,{accountId:SENDER,clientRequestId:'undo-zero',expectedRevision:first.revision});
  assert.equal(f.app.draftSend.submit(draft.id,firstRequest).snapshot.operation!.id,first.id);await f.app.draftSend.execute(first.id,f.app.deliverComposer);
  const restored=f.app.store.required<Draft>('draft',draft.id);assert.equal(restored.id,before.id);assert.equal(restored.providerDraftId,before.providerDraftId);assert.equal(restored.body,before.body);assert.equal(restored.html,before.html);assert.deepEqual(restored.attachments,before.attachments);
  const second=f.app.draftSend.submit(draft.id,{...f.sendRequest(draft.id,'schedule-generation-one'),scheduledAt:new Date(f.deliveryNow()+86_400_000).toISOString()}).snapshot.operation!;
  assert.equal(second.generation,1);await f.app.draftSend.execute(second.id,f.app.deliverComposer);
  f.app.draftSend.cancel(second.id,{accountId:SENDER,clientRequestId:'cancel-one',expectedRevision:second.revision});
  assert.equal((await status(f,first.id)).body.phase,'cancelled');assert.equal((await status(f,second.id)).body.phase,'cancelled');
  assert.equal(f.collector.calls.length,0);assert.equal(f.nativeEntries.length,0);assert.equal(f.providerCalls.filter(c=>['create','update','delete'].includes(c.kind)).length,1);
  assert.equal(sha(f.app.store.attachmentBytes(draft.id,before.attachments![0]!.id)),sha(ATTACHMENT));
  assert.equal((await status(f,first.id,FOREIGN)).status,404);
 }finally{await f.close()}
});

test('accepted create lost ACK holds before any Gmail issue and exact GET recovery cannot resume Send',async()=>{
 let lost=false;const f=createAppFixture({collectorFault:async(response,call)=>{if(!lost&&call.method==='POST'&&call.target==='/v1/registrations'){lost=true;throw Error('Synthetic accepted-create ACK loss')}return response}});try{
  const draft=await f.draft(),before=f.app.store.required<Draft>('draft',draft.id);enable(f);
  const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'create-loss')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  const held=await status(f,op.id);assert.equal(held.status,200);assert.equal(held.body.phase,'held_before_gmail');assert.equal(held.body.mailOutcome,'not-issued');assert.equal(held.body.registration,'create-unknown');
  assert.deepEqual(postStates(f),['prepared']);assert.equal(f.nativeEntries.length,0);assert.equal(f.app.store.required<Draft>('draft',draft.id).deliveryAttemptId,undefined);
  const recovered=await control(f,op.id,'reconcile','check-create');assert.equal(recovered.snapshot.mailOutcome,'not-issued');assert.equal(f.nativeEntries.length,0);assert.deepEqual(postStates(f),['prepared']);
  const first=await status(f,op.id);for(let n=0;n<3;n++)await status(f,op.id);assert.equal((await status(f,op.id)).body.revision,first.body.revision);assert.equal(f.nativeEntries.length,0);
  assert.equal(f.app.store.required<Draft>('draft',draft.id).body,before.body);assert.equal(f.app.store.required<Draft>('draft',draft.id).html,before.html);
 }finally{await f.close()}
});

test('accepted arm lost ACK keeps the existing claim known-not-issued; explicit continuation consumes one wire once',async()=>{
 let lost=false;const f=createAppFixture({collectorFault:async(response,call)=>{if(call.method==='POST'){const body=JSON.parse(Buffer.from(call.bodyBase64,'base64').toString());if(!lost&&body.state==='armed'){lost=true;throw Error('Synthetic accepted-arm ACK loss')}}return response}});try{
  const draft=await f.draft(true,true);enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'arm-loss')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  const held=await status(f,op.id),claim=f.app.store.required<Draft>('draft',draft.id).deliveryAttemptId;assert.equal(held.body.phase,'held_before_gmail');assert.equal(held.body.mailOutcome,'not-issued');assert.equal(held.body.registration,'arm-unknown');assert.equal(typeof claim,'string');
  assert.deepEqual(postStates(f),['prepared','armed']);assert.equal(f.nativeEntries.length,0);
  await control(f,op.id,'reconcile','check-arm');assert.equal(f.nativeEntries.length,0);assert.deepEqual(postStates(f),['prepared','armed']);
  const sent=await control(f,op.id,'continue','continue-original-claim');assert.equal(sent.snapshot.mailOutcome,'sent');assert.equal(f.nativeCalls.length,1);assert.equal(f.app.store.required<Draft>('draft',draft.id).deliveryAttemptId,claim);
  assert.deepEqual(postStates(f),['prepared','armed','confirmed']);assert.equal(f.app.store.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='delivery'").get()!.n,1);
  const history=await invoke(f.app,'GET',controlPath(op.id)+'/requests/by-request/check-arm?accountId='+SENDER);assert.equal(history.status,200);assert.equal(history.body.snapshot.mailOutcome,'not-issued');assert.equal(f.nativeCalls.length,1);
 }finally{await f.close()}
});

test('known Gmail ACK stays Sent when collector confirmation ACK is lost and recovery never repeats any mutation',async()=>{
 let lost=false;const f=createAppFixture({collectorFault:async(response,call)=>{if(call.method==='POST'){const body=JSON.parse(Buffer.from(call.bodyBase64,'base64').toString());if(!lost&&body.state==='confirmed'){lost=true;throw Error('Synthetic accepted-confirm ACK loss')}}return response}});try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'confirm-loss')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  const pending=await status(f,op.id);assert.equal(pending.body.mailOutcome,'sent');assert.equal(pending.body.registration,'confirmation-unknown');assert.equal(f.app.store.required<Draft>('draft',draft.id).status,'sent');assert.equal(f.app.draftSend.operation(SENDER,op.id).state,'sent');
  assert.equal(f.nativeCalls.length,1);assert.deepEqual(postStates(f),['prepared','armed','confirmed']);
  const current=await control(f,op.id,'reconcile','check-confirm');assert.equal(current.snapshot.mailOutcome,'sent');assert.equal(current.snapshot.registration,'confirmed');
  assert.equal(f.nativeCalls.length,1);assert.deepEqual(postStates(f),['prepared','armed','confirmed']);assert.equal(f.app.providerDrafts.status(SENDER,draft.id).state,'consumed');
  assert.equal(f.providerCalls.filter(c=>c.kind==='delete').length,0);assert.equal(f.nativeEntries.some(c=>c.path.includes('/messages/send')),false);
 }finally{await f.close()}
});

for(const mutation of ['raw-and-row-hash','thread-route'] as const)test('wire proof rejects '+mutation+' substitution before the native permit',async()=>{
 let lost=false;const f=createAppFixture({collectorFault:async(response,call)=>{if(call.method==='POST'){const body=JSON.parse(Buffer.from(call.bodyBase64,'base64').toString());if(!lost&&body.state==='armed'){lost=true;throw Error('Synthetic arm hold for wire mutation')}}return response}});try{
  const draft=await f.draft(true,true);enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'wire-'+mutation)).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);await control(f,op.id,'reconcile','wire-check-'+mutation);
  const reviewed=await status(f,op.id);assert.equal(reviewed.status,200);const row=f.app.store.db.prepare('SELECT * FROM tracking_delivery_wire').get()!;assert(row);const original=Buffer.from(row.raw as Uint8Array);
  if(mutation==='raw-and-row-hash'){
   const value=original.toString('utf8'),changed=value.replace('To: peer@example.test','To: unauthorized@example.test');assert.notEqual(changed,value);
   const raw=Buffer.from(changed);f.app.store.db.prepare('UPDATE tracking_delivery_wire SET raw=?,sha256=? WHERE binding_id=?').run(raw,sha(raw),String(row.binding_id));
  }else f.app.store.db.prepare('UPDATE tracking_delivery_wire SET thread_id=? WHERE binding_id=?').run('foreign-provider-thread',String(row.binding_id));
  const refusedStatus=await status(f,op.id),refusedContinue=await invoke(f.app,'POST',controlPath(op.id)+'/continue',{accountId:SENDER,clientRequestId:'wire-continue-'+mutation,expectedRevision:reviewed.body.revision});
  assert.deepEqual([refusedStatus.status,refusedContinue.status],[500,500]);
  assert.equal(f.nativeCalls.length,0,'Mutated stored wire must not acquire native authority from its self-recomputed row hash');
  assert.equal(f.app.store.required<Draft>('draft',draft.id).status==='sent',false);
 }finally{await f.close()}
});

test('scheduled Cancel remains valid until local claim while a prepared collector ACK is deferred',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),seen=new Promise<void>(resolve=>{entered=resolve});
 const f=createAppFixture({collectorFault:async(response,call)=>{if(call.method==='POST'&&call.target==='/v1/registrations'){entered();await gate}return response}});let work:Promise<unknown>|undefined;
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,{...f.sendRequest(draft.id,'due-schedule'),scheduledAt:new Date(f.deliveryNow()+60000).toISOString()}).snapshot.operation!;
  f.advanceDelivery(60001);work=f.app.draftSend.execute(op.id,f.app.deliverComposer);await seen;
  const before=f.app.draftSend.current(SENDER,draft.id);assert.equal(before.canCancel,true);assert.equal(before.operation!.deliveryAttemptId,null);
  let cancelled=false;try{f.app.draftSend.cancel(op.id,{accountId:SENDER,clientRequestId:'cancel-prepared',expectedRevision:before.operation!.revision});cancelled=true}catch{/* assert the failed advertised right below, after releasing owned work */}finally{release();await work}
  assert.equal(cancelled,true,'A preparatory collector packet cannot contradict the advertised pre-claim cancellation right');
  assert.equal(f.app.store.required<Draft>('draft',draft.id).status,'draft');assert.equal(f.nativeCalls.length,0);assert.deepEqual(postStates(f),['prepared']);
 }finally{release();if(work)await work;await f.close()}
});

for(const variant of ['draft','generation','sent','decision-type'] as const)test('historical control rejects '+variant+' substitution even with a recomputed storage digest',async()=>{
 let lost=false;const f=createAppFixture({collectorFault:async(response,call)=>{if(!lost&&call.method==='POST'&&call.target==='/v1/registrations'){lost=true;throw Error('Synthetic create hold for control validation')}return response}});
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'control-proof-'+variant)).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  const result=await control(f,op.id,'reconcile','historical-'+variant);assert.equal(result.snapshot.mailOutcome,'not-issued');
  const row=f.app.store.db.prepare('SELECT * FROM tracking_delivery_controls WHERE client_key=?').get('historical-'+variant)!,value=JSON.parse(String(row.data));
  if(variant==='draft')value.snapshot.draftId='substituted-owned-draft';
  if(variant==='generation')value.snapshot.generation++;
  if(variant==='sent')Object.assign(value.snapshot,{phase:'confirmed',mailOutcome:'sent',registration:'confirmed',heldReason:null,canContinue:false,canReconcile:false});
  if(variant==='decision-type')value.snapshot.decision.tracked='fabricated-truthy-value';
  f.app.store.db.prepare('UPDATE tracking_delivery_controls SET data=?,integrity=? WHERE id=?').run(JSON.stringify(value),sha(stable(value)),String(row.id));
  const recovered=await invoke(f.app,'GET',controlPath(op.id)+'/requests/by-request/historical-'+variant+'?accountId='+SENDER);
  const replay=await invoke(f.app,'POST',controlPath(op.id)+'/reconcile',{accountId:SENDER,clientRequestId:'historical-'+variant,expectedRevision:value.receipt.expectedRevision});
  assert.deepEqual([recovered.status,replay.status],[500,500],'A hashed historical DTO must still agree with its immutable delivery binding and permitted facts on both read/replay paths');
  assert.equal(f.nativeCalls.length,0);
 }finally{await f.close()}
});

test('pristine tracked send consumes the exact committed wire once and retains it independently of provider snapshot pruning',async()=>{
 let inspected=false;const f=createAppFixture({nativeFault:async call=>{
  const row=f.app.store.db.prepare('SELECT * FROM tracking_delivery_wire').get()!;assert.equal(Buffer.from(row.raw as Uint8Array).toString('base64url'),call.raw);assert.equal(sha(Buffer.from(call.raw,'base64url')),row.sha256);
  assert.deepEqual(postStates(f),['prepared','armed']);assert.equal(f.app.store.required<Draft>('draft',draft.id).html,HTML);
  const decoded=await PostalMime.parse(Buffer.from(call.raw,'base64url'));assert.equal(decoded.text,BODY);const tree=parseFragment(decoded.html!),images:any[]=[];
  const walk=(node:any)=>{if(node.nodeName==='img')images.push(node);for(const child of node.childNodes??[])walk(child)};walk(tree);assert.equal(images.length,1);
  const url=new URL(images[0].attrs.find((a:any)=>a.name==='src').value);assert.equal(url.origin,'https://collector.example.test');assert.match(url.pathname,/^\/p\/[A-Za-z0-9_-]{43}\.gif$/);assert.equal(url.search,'');
  const token=url.pathname.slice(3,-4),create=JSON.parse(Buffer.from(f.collector.calls.find(c=>c.method==='POST'&&c.target==='/v1/registrations')!.bodyBase64,'base64').toString());assert.equal(create.tokenDigest,sha(token));
  tree.childNodes=tree.childNodes.filter(node=>node!==images[0]);assert.equal(serialize(tree),HTML);const attachment=decoded.attachments[0]!.content;if(typeof attachment==='string')throw Error('Unexpected synthetic parser attachment encoding');assert.equal(sha(attachment instanceof Uint8Array?attachment:new Uint8Array(attachment)),sha(ATTACHMENT));inspected=true;return Response.json({id:'native-sent-1'});
 }});let draft:Draft;try{
  draft=await f.draft(true,true);enable(f);f.app.google.mime=()=>{throw Error('Tracked send must not rebuild generic MIME')};const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'wire-positive')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);await f.app.trackingDelivery.waitForIdle();
  assert.equal(inspected,true);assert.equal(f.nativeCalls.length,1);assert.deepEqual(postStates(f),['prepared','armed','confirmed']);assert.equal(f.app.providerDrafts.status(SENDER,draft.id).state,'consumed');
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM tracking_delivery_wire').get()!.n,1);assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM provider_draft_operations WHERE raw IS NOT NULL').get()!.n,0);
  assert.equal(Buffer.from(f.app.store.db.prepare('SELECT raw FROM tracking_delivery_wire').get()!.raw as Uint8Array).toString('base64url'),f.nativeCalls[0]!.raw);
 }finally{await f.close()}
});

test('preference disable during awaited credentials fences native issue; restored explicit continuation keeps the claim and wire',async()=>{
 const f=createAppFixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),seen=new Promise<void>(resolve=>{entered=resolve});let work:Promise<unknown>|undefined;
 try{
  const draft=await f.draft();enable(f);const original=f.app.google.tokens.bind(f.app.google);let first=true;f.app.google.tokens=async(...args)=>{if(first){first=false;entered();await gate}return original(...args)};
  const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'late-disable')).snapshot.operation!;work=f.app.draftSend.execute(op.id,f.app.deliverComposer);await seen;
  const before=f.app.store.db.prepare('SELECT attempt_id,sha256 FROM tracking_delivery_wire').get()!;enable(f,false,'disable-before-issue');release();await work;
  const held=await status(f,op.id);assert.equal(held.body.mailOutcome,'not-issued');assert.equal(held.body.heldReason,'preference-disabled');assert.equal(held.body.canContinue,false);assert.equal(f.nativeEntries.length,0);
  enable(f,true,'restore-before-continue');await control(f,op.id,'continue','continue-after-enable');assert.equal(f.nativeCalls.length,1);assert.deepEqual(f.app.store.db.prepare('SELECT attempt_id,sha256 FROM tracking_delivery_wire').get(),before);assert.deepEqual(postStates(f),['prepared','armed','confirmed']);
 }finally{release();if(work)await work;await f.close()}
});

test('provider ambiguity never confirms tracking or reissues native Send through key replay or continuation',async()=>{
 const f=createAppFixture({nativeFault:async()=>{throw Error('Synthetic issued-native lost ACK')}});try{
  const draft=await f.draft();enable(f);const request=f.sendRequest(draft.id,'native-unknown'),op=f.app.draftSend.submit(draft.id,request).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  const unknown=await status(f,op.id);assert.equal(unknown.body.mailOutcome,'unknown');assert.equal(unknown.body.canContinue,false);assert.equal(f.app.store.required<Draft>('draft',draft.id).status,'delivery_unknown');assert.deepEqual(postStates(f),['prepared','armed']);
  assert.equal(f.app.draftSend.submit(draft.id,request).accepted,false);await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  const continued=await invoke(f.app,'POST',controlPath(op.id)+'/continue',{accountId:SENDER,clientRequestId:'forbidden-resend',expectedRevision:unknown.body.revision});assert.equal(continued.status,409);assert.equal(f.nativeCalls.length,1);
 }finally{await f.close()}
});

test('restart with a new collector origin holds the original generation and probes no old or replacement collector',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'tracking-config-restart-'))),path=join(directory,'synthetic.sqlite'),f=createAppFixture({databasePath:path});
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'origin-frozen')).snapshot.operation!,before=await status(f,op.id);
  f.collector.configuration.origin='https://replacement.example.test';await f.restart();const after=await status(f,op.id);assert.equal(after.status,200);assert.equal(after.body.mailOutcome,'not-issued');assert.equal(after.body.canContinue,false);assert.equal(after.body.decision.preferenceRevision,before.body.decision.preferenceRevision);
  const continued=await invoke(f.app,'POST',controlPath(op.id)+'/continue',{accountId:SENDER,clientRequestId:'wrong-origin',expectedRevision:after.body.revision});assert.equal(continued.status,409);
  assert.equal(f.collector.entries.length,0);assert.equal(f.nativeEntries.length,0);
 }finally{await f.close();rmSync(directory,{recursive:true,force:true})}
});

test('shutdown while credentials are deferred closes the final native gate without an outgoing attempt',async()=>{
 const f=createAppFixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),seen=new Promise<void>(resolve=>{entered=resolve});let work:Promise<unknown>|undefined,closing:Promise<unknown>|undefined;
 try{
  const draft=await f.draft();enable(f);const tokens=f.app.google.tokens.bind(f.app.google);f.app.google.tokens=async(...args)=>{entered();await gate;return tokens(...args)};
  const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'close-before-native')).snapshot.operation!;work=f.app.draftSend.execute(op.id,f.app.deliverComposer);await seen;
  assert.deepEqual(postStates(f),['prepared','armed']);closing=f.close();release();await work;await closing;assert.equal(f.nativeEntries.length,0);
 }finally{release();if(work)await work;if(closing)await closing;await f.close()}
});

test('failed wire INSERT rolls back the local claim and explicit continuation creates only one persisted attempt',async()=>{
 const f=createAppFixture();try{
  const draft=await f.draft(true,true);enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'wire-rollback')).snapshot.operation!;
  f.app.store.db.exec("CREATE TRIGGER independent_wire_failure BEFORE INSERT ON tracking_delivery_wire BEGIN SELECT RAISE(ABORT,'synthetic-wire-insert'); END");
  await f.app.draftSend.execute(op.id,f.app.deliverComposer);
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM tracking_delivery_wire').get()!.n,0);assert.equal(f.app.store.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='delivery'").get()!.n,0);assert.equal(f.app.store.required<Draft>('draft',draft.id).deliveryAttemptId,undefined);assert.equal(f.nativeEntries.length,0);assert.deepEqual(postStates(f),['prepared']);
  f.app.store.db.exec('DROP TRIGGER independent_wire_failure');await control(f,op.id,'continue','continue-after-local-rollback');
  assert.equal(f.nativeCalls.length,1);assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM tracking_delivery_wire').get()!.n,1);assert.equal(f.app.store.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='delivery'").get()!.n,1);assert.deepEqual(postStates(f),['prepared','armed','confirmed']);
 }finally{await f.close()}
});

test('pending control has durable immutable accepted history and its GET cannot complete or resume the action',async()=>{
 let lose=true,hold=false,release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),seen=new Promise<void>(resolve=>{entered=resolve});
 const f=createAppFixture({collectorFault:async(response,call)=>{if(lose&&call.method==='POST'&&call.target==='/v1/registrations'){lose=false;throw Error('Synthetic pending control seed')}if(hold&&call.method==='GET'){entered();await gate}return response}});let checking:Promise<{status:number;body:any}>|undefined;
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'pending-control')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);const before=await status(f,op.id);hold=true;
  const request={accountId:SENDER,clientRequestId:'held-check',expectedRevision:before.body.revision};checking=invoke(f.app,'POST',controlPath(op.id)+'/reconcile',request);await seen;
  const path=controlPath(op.id)+'/requests/by-request/held-check?accountId='+SENDER,first=await invoke(f.app,'GET',path),calls=f.collector.calls.length;assert.equal(first.status,200);assert.equal(first.body.state,'accepted');assert.equal(first.body.snapshot.mailOutcome,'not-issued');
  assert.deepEqual((await invoke(f.app,'GET',path)).body,first.body);assert.equal(f.collector.calls.length,calls);assert.equal(f.nativeEntries.length,0);
  release();const finished=await checking;assert.equal(finished.status,200);assert.equal(finished.body.state,'completed');assert.deepEqual(finished.body.receipt,first.body.receipt);assert.equal(first.body.state,'accepted');assert.equal(f.nativeEntries.length,0);
  const history=await invoke(f.app,'GET',path);assert.equal(history.body.state,'completed');const count=f.collector.calls.length;
  const replay=await invoke(f.app,'POST',controlPath(op.id)+'/reconcile',request);assert.equal(replay.body.historical,true);assert.deepEqual(replay.body.receipt,first.body.receipt);assert.equal(f.collector.calls.length,count);
 }finally{release();if(checking)await checking;await f.close()}
});

test('a second live owner can read but cannot adopt or continue another live held claim',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'tracking-live-owner-'))),f=createAppFixture({databasePath:join(directory,'synthetic.sqlite'),collectorFault:async(response,call)=>{if(call.method==='POST'&&JSON.parse(Buffer.from(call.bodyBase64,'base64').toString()).state==='armed')throw Error('Synthetic live-owner arm hold');return response}});let observer:ReturnType<typeof f.observer>|undefined;
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'live-owner')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);const count=f.collector.calls.length;observer=f.observer();
  const read=await invoke(observer,'GET',controlPath(op.id)+'?accountId='+SENDER);assert.equal(read.status,200);assert.equal(read.body.canContinue,false);
  const attempt=await invoke(observer,'POST',controlPath(op.id)+'/continue',{accountId:SENDER,clientRequestId:'steal-live-owner',expectedRevision:read.body.revision});assert.equal(attempt.status,409);assert.equal(f.collector.calls.length,count);assert.equal(f.nativeEntries.length,0);
  await observer.close();observer=undefined;f.collector.setFault(undefined);await control(f,op.id,'reconcile','own-arm-proof');await control(f,op.id,'continue','own-live-continuation');assert.equal(f.nativeCalls.length,1);
 }finally{if(observer)await observer.close();await f.close();rmSync(directory,{recursive:true,force:true})}
});

test('late original confirmation ACK cannot regress an already reconciled exact confirmation proof',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),seen=new Promise<void>(resolve=>{entered=resolve});
 const f=createAppFixture({collectorFault:async(response,call)=>{if(call.method==='POST'&&JSON.parse(Buffer.from(call.bodyBase64,'base64').toString()).state==='confirmed'){entered();await gate}return response}});
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'late-confirm')).snapshot.operation!,sending=f.app.draftSend.execute(op.id,f.app.deliverComposer);await seen;await sending;
  const checked=await control(f,op.id,'reconcile','positive-confirm-before-ack');assert.equal(checked.snapshot.phase,'confirmed');assert.equal(checked.snapshot.registration,'confirmed');assert.equal(f.nativeCalls.length,1);
  release();await new Promise<void>(resolve=>setImmediate(resolve));
  const current=await status(f,op.id);assert.equal(current.body.phase,'confirmed','A duplicate exact proof cannot be reclassified as confirmation uncertainty');assert.equal(current.body.registration,'confirmed');assert.equal(current.body.mailOutcome,'sent');assert.equal(f.nativeCalls.length,1);assert.deepEqual(postStates(f),['prepared','armed','confirmed']);
 }finally{release();await f.close()}
});
