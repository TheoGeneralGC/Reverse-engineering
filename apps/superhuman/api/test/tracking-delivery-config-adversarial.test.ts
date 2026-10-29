// Additive frozen-origin controls; the original24 assertions/helpers remain unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAppFixture,invoke,SENDER} from './tracking-independent-app-fixture.ts';

const path=(id:string)=>'/api/tracking/deliveries/composer/'+encodeURIComponent(id);
const enable=(f:ReturnType<typeof createAppFixture>)=>f.app.tracking.save({accountId:SENDER,clientRequestId:'enable-tracking',expectedRevision:0,desired:{readStatuses:true,recentOpens:false}});

for(const target of ['prepared','armed','confirmed'] as const)test('replaced collector cannot receive old '+target+' recovery packets',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'tracking-realm-')));let lost=false;
 const f=createAppFixture({databasePath:join(directory,'synthetic.sqlite'),collectorFault:async(response,call)=>{if(call.method==='POST'&&!lost&&JSON.parse(Buffer.from(call.bodyBase64,'base64').toString()).state===target){lost=true;throw Error('Synthetic old-realm accepted mutation ACK loss')}return response}});
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'old-realm-'+target)).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);await new Promise<void>(resolve=>setImmediate(resolve));
  const original=await invoke(f.app,'GET',path(op.id)+'?accountId='+SENDER);assert.equal(original.status,200);assert.equal(original.body.canReconcile,true);const expectedSends=target==='confirmed'?1:0;assert.equal(f.nativeCalls.length,expectedSends);
  f.collector.configuration.origin='https://replacement.example.test';await f.restart();const count=f.collector.entries.length;
  const current=await invoke(f.app,'GET',path(op.id)+'?accountId='+SENDER);assert.equal(current.status,200);assert.equal(current.body.canReconcile,false);assert.equal(current.body.canContinue,false);assert.equal(current.body.heldReason,'configuration-changed');
  const check=await invoke(f.app,'POST',path(op.id)+'/reconcile',{accountId:SENDER,clientRequestId:'wrong-realm-check',expectedRevision:current.body.revision});assert.equal(check.status,409);
  await f.app.trackingDelivery.confirm({accountId:SENDER,source:'composer',operationId:op.id});assert.equal(f.collector.entries.length,count,'No old-key request may enter the replacement transport');assert.equal(f.nativeCalls.length,expectedSends);assert.equal(current.body.mailOutcome,target==='confirmed'?'sent':'not-issued');
 }finally{await f.close();rmSync(directory,{recursive:true,force:true})}
});

test('later verified Gmail ACK cannot start first confirmation POST against a replacement collector',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'tracking-realm-ack-'))),f=createAppFixture({databasePath:join(directory,'synthetic.sqlite'),nativeFault:async()=>{throw Error('Synthetic native ACK ambiguity')}});
 try{
  const draft=await f.draft();enable(f);const op=f.app.draftSend.submit(draft.id,f.sendRequest(draft.id,'native-unknown-old-realm')).snapshot.operation!;await f.app.draftSend.execute(op.id,f.app.deliverComposer);assert.equal(f.nativeCalls.length,1);
  f.collector.configuration.origin='https://replacement.example.test';await f.restart();const entries=f.collector.entries.length;
  f.app.google.reconcileDelivery=async()=>({found:true,matches:1,scanComplete:true,scannedCandidates:1,reason:'verified',providerMessageId:'native-sent-1',providerInternetMessageId:'<synthetic-verified@example.test>'});
  const readOnlyProviderCheck=await invoke(f.app,'POST','/api/drafts/'+draft.id+'/reconcile',{});assert.equal(readOnlyProviderCheck.status,200);assert.equal(readOnlyProviderCheck.body.resolved,true);await new Promise<void>(resolve=>setImmediate(resolve));
  const current=await invoke(f.app,'GET',path(op.id)+'?accountId='+SENDER);assert.equal(current.body.mailOutcome,'sent');assert.equal(current.body.heldReason,'configuration-changed');assert.equal(current.body.canReconcile,false);assert.equal(f.collector.entries.length,entries);assert.equal(f.nativeCalls.length,1);
  assert.equal(f.collector.calls.filter(c=>c.method==='POST').some(c=>JSON.parse(Buffer.from(c.bodyBase64,'base64').toString()).state==='confirmed'),false);
 }finally{await f.close();rmSync(directory,{recursive:true,force:true})}
});
