// Outside owner635. Pure synthetic DTO/model only; no sockets/App/Store/environment.
import test from 'node:test';import assert from 'node:assert/strict';
import{checkedReadSnapshot,checkedReadView}from'../src/tracking/reads-client.ts';
import{createReadActivity}from'../src/tracking/reads-model.ts';
import{snapshot,view,server,memory,digest,ref}from'./read-fixtures.ts';
test('complete snapshot evidence rejects zero pages, impossible counts and contradictory coverage identity',()=>{
 const good=snapshot();assert.equal(checkedReadSnapshot(good).events,1);
 const variants:[string,ReturnType<typeof snapshot>][]=[
  ['zero-pages',{...good,coverage:{...good.coverage,pages:0}}],
  ['event-count-over-budget',{...good,events:5001,coverage:{...good.coverage,observedEvents:5001}}],
  ['message-count-over-budget',{...good,messages:10001}],
  ['observed-events-contradiction',{...good,coverage:{...good.coverage,observedEvents:0}}],
  ['basis-contradiction',{...good,coverage:{...good.coverage,cumulativeThrottled:{...good.coverage.cumulativeThrottled,basisDigest:'d'.repeat(64)}}}],
 ];const accepted:string[]=[];for(const[name,value]of variants)try{checkedReadSnapshot(value);checkedReadView({...view('a',2),snapshot:value},'a');accepted.push(name)}catch{}
 assert.deepEqual(accepted,[],'A complete snapshot must satisfy the published importer bounds and its own evidence identity');
});
test('same current revision may update derived context but cannot retarget its immutable snapshot head',async()=>{
 const s=server(),storage=memory();s.current=view('a',2);const model=createReadActivity({accountId:'a',storage,request:s.request,digest,pollMs:0});model.activate();try{
  await model.load();const original=model.getSnapshot().view!;
  s.current={...s.current,contextVersion:'d'.repeat(64)};assert.equal((await model.load())?.contextVersion,'d'.repeat(64));
  const before=structuredClone(model.getSnapshot().view);s.current={...s.current,snapshot:{...s.current.snapshot!,snapshotRef:ref(90)}};
  assert.equal(await model.load(),null,'A new snapshot publication requires a newer account revision');assert.deepEqual(model.getSnapshot().view,before);assert.equal(model.getSnapshot().view?.snapshot?.snapshotRef,original.snapshot?.snapshotRef);assert.equal(storage.values.size,0);assert(s.calls.every(c=>c.method==='GET'));
 }finally{model.dispose()}
});
