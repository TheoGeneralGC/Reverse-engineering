import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import type { Account, Draft } from '../src/types.ts';
import { createProviderDraftMime, equivalentProviderDraftMime, decodeProviderDraftMime, PROVIDER_DRAFT_MAX_RAW_BYTES } from '../src/provider-draft-mime.ts';
function fixture() {
  const store = new Store(':memory:', false), account: Account = { id: 'google', email: 'self@example.test', provider: 'google', name: 'Synthetic', color: '#000' };
  store.put('account', account.id, account);
  const draft: Draft = store.saveDraft({ accountId: account.id, to: '"A, B" <peer@example.test>', cc: '', bcc: 'private@example.test', subject: 'Fictional 样本', body: 'Three samples.\n\n  Keep indentation.  ', html: '<p>Three <b>samples</b>.</p><pre>  Keep indentation.  </pre>' });
  return { store, account, draft, marker: { owner: 'a'.repeat(32), operationId: 'operation-one', revision: draft.revision! } };
}
test('decoded MIME proof preserves rich/plain, quoted recipients, Bcc, Unicode names, reply context and attachment bytes after metadata changes', async () => {
  const f = fixture();
  try {
    const added = f.store.addAttachment(f.draft.id, { name: '样本.txt', mimeType: 'text/plain', data: Buffer.from('UTF8样本\n').toString('base64') });
    const snapshot = await createProviderDraftMime(f.store, added.draft, f.account, { ...f.marker, revision: added.draft.revision! }, { internetMessageId: '<prior@example.test>', references: '<root@example.test>' }, 'provider-thread');
    const rewritten = Buffer.from('Message-ID: <provider-generated@example.test>\r\nDate: Wed, 28 Oct 2026 12:00:00 +0000\r\n' + snapshot.raw.toString());
    assert.equal(await equivalentProviderDraftMime(snapshot, rewritten, f.account.email), true);
    assert.equal(snapshot.threadId, 'provider-thread'); assert.ok(snapshot.decodedHash); assert.equal((await decodeProviderDraftMime(snapshot.raw)).marker!.revision, added.draft.revision);
    assert.equal(await equivalentProviderDraftMime(snapshot, rewritten, 'foreign@example.test'), false);
  } finally { f.store.close(); }
});
test('immutable accepted MIME survives later attachment removal and authored edits', async () => {
  const f = fixture();
  try {
    const added = f.store.addAttachment(f.draft.id, { name: 'small.txt', mimeType: 'text/plain', data: Buffer.from('Exact bytes').toString('base64') });
    const snapshot = await createProviderDraftMime(f.store, added.draft, f.account, { ...f.marker, revision: added.draft.revision! });
    const bytes = Buffer.from(snapshot.raw); f.store.removeAttachment(f.draft.id, added.attachment.id); f.store.saveDraft({ id: f.draft.id, body: 'Later local edit' });
    assert.deepEqual(snapshot.raw, bytes); assert.equal(await equivalentProviderDraftMime(snapshot, bytes, f.account.email), true);
    const later = await createProviderDraftMime(f.store, f.store.required('draft', f.draft.id), f.account, { ...f.marker, revision: f.store.required<Draft>('draft', f.draft.id).revision! });
    assert.equal(await equivalentProviderDraftMime(snapshot, later.raw, f.account.email), false);
  } finally { f.store.close(); }
});
test('matching opaque headers do not prove changed decoded content, duplicate headers or malformed/oversized MIME', async () => {
  const f = fixture();
  try {
    const snapshot = await createProviderDraftMime(f.store, f.draft, f.account, f.marker);
    const changed = snapshot.raw.toString().replace(Buffer.from(f.draft.body).toString('base64'), Buffer.from('Changed samples.').toString('base64'));
    assert.notEqual(changed, snapshot.raw.toString());
    assert.equal(await equivalentProviderDraftMime(snapshot, Buffer.from(changed), f.account.email), false);
    assert.equal(await equivalentProviderDraftMime(snapshot, Buffer.concat([Buffer.from('Subject: Forged\r\n'), snapshot.raw]), f.account.email), false);
    assert.equal(await equivalentProviderDraftMime(snapshot, Buffer.from('From: self@example.test\r\n\r\nBody'), f.account.email), false);
    assert.equal(await equivalentProviderDraftMime(snapshot, Buffer.alloc(PROVIDER_DRAFT_MAX_RAW_BYTES + 1), f.account.email), false);
  } finally { f.store.close(); }
});
test('recipient-free cloud draft MIME is valid while malformed outgoing fragments remain local instead of being dropped', async () => {
  const f = fixture();
  try {
    const noRecipients = { ...f.draft, to: '', cc: '', bcc: '' }, snapshot = await createProviderDraftMime(f.store, noRecipients, f.account, f.marker);
    assert.equal(await equivalentProviderDraftMime(snapshot, snapshot.raw, f.account.email), true);
    await assert.rejects(() => createProviderDraftMime(f.store, { ...f.draft, to: 'Bad <unfinished, valid@example.test' }, f.account, f.marker), { code: 'invalid_recipients' });
  } finally { f.store.close(); }
});
test('cloud MIME refuses invalid UTF-16 instead of silently replacing authored text, while valid emoji remains supported',async()=>{
  const f=fixture();try{
    const invalid={...f.draft,body:'Keep the literal lone surrogate: \ud800'};
    await assert.rejects(()=>createProviderDraftMime(f.store,invalid,f.account,f.marker),{code:'provider_draft_invalid_unicode'});
    assert.equal(invalid.body.charCodeAt(invalid.body.length-1),0xd800);
    const valid={...f.draft,body:'Keep valid emoji 😀 and 样本.'},snapshot=await createProviderDraftMime(f.store,valid,f.account,f.marker);assert.equal(await equivalentProviderDraftMime(snapshot,snapshot.raw,f.account.email),true);
  }finally{f.store.close()}
});
