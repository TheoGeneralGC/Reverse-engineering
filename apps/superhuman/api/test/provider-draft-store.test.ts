import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { ProviderDraftRepository } from '../src/provider-draft-store.ts';
import { createProviderDraftMime } from '../src/provider-draft-mime.ts';
import type { Account, Draft } from '../src/types.ts';
function fixture(path = ':memory:') {
  const store = new Store(path,false), repo = new ProviderDraftRepository(store);
  const account: Account = { id:'google',provider:'google',email:'self@example.test',name:'Synthetic',color:'#000' };
  store.put('account',account.id,account);store.put('account','other',{...account,id:'other',email:'other@example.test'});store.put('account','demo',{...account,id:'demo',provider:'demo'});
  const draft = store.saveDraft({accountId:account.id,subject:'Synthetic recipient-free draft',body:'Three fictional samples.'});
  return {store,repo,account,draft};
}
async function queued(f: ReturnType<typeof fixture>) {
  const link = f.repo.enroll(f.draft,'composer')!;
  const snapshot = await createProviderDraftMime(f.store,f.draft,f.account,{owner:link.ownerMarker,operationId:'write-one',revision:f.draft.revision!});
  return {snapshot,link:f.repo.desire(f.draft,snapshot.contentHash,true)!};
}
test('constructor/read never enrolls or changes legacy drafts and unmanaged status exposes no invented provider tracking', () => {
  const f = fixture();
  try {
    const legacy = f.store.saveDraft({accountId:'google',providerDraftId:'legacy-id',subject:'Legacy synthetic'}), before=f.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all();
    const second = new ProviderDraftRepository(f.store);
    assert.deepEqual(second.snapshot('google',legacy.id),{accountId:'google',draftId:legacy.id,ownership:'unmanaged',revision:0,state:'unmanaged',desiredRevision:null,desiredHash:null,syncedRevision:null,syncedHash:null,providerDraftId:null,providerMessageId:null,providerThreadId:null,operation:null,error:null,deliveryBlocked:false});
    assert.deepEqual(f.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),before);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM provider_draft_links').get()!.n,0);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM provider_draft_operations').get()!.n,0);
    assert.throws(()=>f.repo.enroll(legacy,'composer'),{code:'provider_draft_enrollment_conflict'});
    const demo=f.store.saveDraft({accountId:'demo',body:'Synthetic'});assert.equal(f.repo.enroll(demo,'composer'),undefined);
  } finally {f.store.close();}
});
test('durable claim stores exact immutable MIME while a newer local edit changes only desired identity', async () => {
  const f=fixture();
  try {
    const {link,snapshot}=await queued(f);
    const op=f.repo.transaction(()=>f.repo.insertOperation(link,snapshot,'create','owner-one'));
    assert.equal(op.state,'dispatching');assert.equal(f.repo.snapshot('google',f.draft.id).state,'saving');
    const later=f.store.saveDraft({id:f.draft.id,body:'Later authored content'});
    const newer=await createProviderDraftMime(f.store,later,f.account,{owner:link.ownerMarker,operationId:'later-op',revision:later.revision!});
    f.repo.desire(later,newer.contentHash,true);
    assert.equal(f.repo.link('google',f.draft.id)!.desiredRevision,later.revision);
    assert.equal(f.repo.snapshot('google',f.draft.id).operation!.draftRevision,f.draft.revision);
    assert.deepEqual(f.repo.payload('google',f.draft.id,op.id).raw,snapshot.raw);
    assert.equal(f.repo.snapshot('google',f.draft.id).deliveryBlocked,true);
  } finally {f.store.close();}
});
test('failed claim transaction cannot leave an active link or operation behind', async () => {
  const f=fixture();
  try {
    const {link,snapshot}=await queued(f);
    f.store.db.exec("CREATE TEMP TRIGGER fail_provider_op BEFORE INSERT ON provider_draft_operations BEGIN SELECT RAISE(ABORT,'controlled provider claim failure'); END");
    assert.throws(()=>f.repo.transaction(()=>f.repo.insertOperation(link,snapshot,'create','owner-one')),/controlled provider claim failure/);
    assert.deepEqual(f.repo.link('google',f.draft.id),link);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM provider_draft_operations').get()!.n,0);
  } finally {f.store.close();}
});
test('foreign malformed link/operation data is excluded before parsing and no snapshot leaks its ownership nonce', async () => {
  const f=fixture();
  try {
    const {link,snapshot}=await queued(f);f.repo.transaction(()=>f.repo.insertOperation(link,snapshot,'create','owner-one'));
    f.store.db.prepare('INSERT INTO provider_draft_links VALUES(?,?,?,?)').run('other','foreign-draft',0,'FOREIGN_NOT_JSON');
    f.store.db.prepare('INSERT INTO provider_draft_operations VALUES(?,?,?,?,?,?,?,?,?,?)').run('foreign-op','other','foreign-draft','dispatching','owner',process.pid,'FOREIGN_NOT_JSON',null,null,null);
    assert.equal(f.repo.link('google','foreign-draft'),undefined);assert.throws(()=>f.repo.operation('google','foreign-draft','foreign-op'),{code:'provider_draft_not_found'});
    const publicValue=JSON.stringify(f.repo.snapshot('google',f.draft.id));assert.ok(!publicValue.includes(link.ownerMarker));assert.ok(!publicValue.includes('rawHash'));assert.ok(!publicValue.includes('raw'));
  } finally {f.store.close();}
});
test('provider ID and operation intent cannot be rewritten; corrupt snapshot bytes fail closed', async () => {
  const f=fixture();
  try {
    const {link,snapshot}=await queued(f),op=f.repo.transaction(()=>f.repo.insertOperation(link,snapshot,'create','owner-one'));
    f.repo.transaction(()=>{
      const fresh=f.repo.link('google',f.draft.id)!;f.repo.saveLink({...fresh,providerDraftId:'stable-provider-id'});
    });
    assert.throws(()=>f.repo.transaction(()=>f.repo.saveLink({...f.repo.link('google',f.draft.id)!,providerDraftId:null})),{code:'provider_draft_corrupt'});
    assert.throws(()=>f.repo.transaction(()=>f.repo.saveOperation({...op,contentHash:'0'.repeat(64)})),{code:'provider_draft_corrupt'});
    f.store.db.prepare('UPDATE provider_draft_operations SET raw=? WHERE id=?').run(Buffer.from('changed bytes'),op.id);
    assert.throws(()=>f.repo.payload('google',f.draft.id,op.id),{code:'provider_draft_corrupt'});
  } finally {f.store.close();}
});
test('an issued snapshot survives a temp-database restart without enrollment scans or provider retries', async () => {
  const dir=mkdtempSync(join(tmpdir(),'provider-draft-repo-')),path=join(dir,'fixture.sqlite');const f=fixture(path);
  let reopened:Store|undefined;
  try {
    const {link,snapshot}=await queued(f),op=f.repo.transaction(()=>f.repo.insertOperation(link,snapshot,'create','owner-one'));
    f.store.close();reopened=new Store(path,false);const repo=new ProviderDraftRepository(reopened);
    assert.equal(repo.snapshot('google',f.draft.id).operation!.id,op.id);assert.deepEqual(repo.payload('google',f.draft.id,op.id).raw,snapshot.raw);
    assert.equal(repo.draft('google',f.draft.id)!.body,'Three fictional samples.');
    assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM provider_draft_links').get()!.n,1);
  } finally {if(reopened)reopened.close();else f.store.close();rmSync(dir,{recursive:true,force:true});}
});
