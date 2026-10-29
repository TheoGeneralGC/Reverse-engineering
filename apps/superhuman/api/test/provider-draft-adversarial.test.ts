import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ProviderDraftRepository } from '../src/provider-draft-store.ts';
import { createProviderDraftMime, equivalentProviderDraftMime } from '../src/provider-draft-mime.ts';
import { checkedProviderDraftSnapshot } from '../../web/src/provider-draft-client.ts';
import type { Account } from '../src/types.ts';

function fixture() {
  const store = new Store(':memory:', false), account: Account = { id: 'google', provider: 'google', email: 'self@example.test', name: 'Synthetic', color: '#000' };
  store.put('account', account.id, account); const repo = new ProviderDraftRepository(store);
  const draft = store.saveDraft({ accountId: account.id, subject: 'Fictional Cedar draft', body: 'Three fictional samples.' });
  const link = repo.enroll(draft, 'composer')!;
  return { store, repo, account, draft, link };
}

test('a newly enrolled idle repository snapshot is accepted by the published browser contract without a provider request', () => {
  const f = fixture();
  try {
    const snapshot = f.repo.snapshot(f.account.id, f.draft.id);
    assert.equal(snapshot.state, 'idle'); assert.equal(snapshot.ownership, 'replica-new');
    assert.doesNotThrow(() => checkedProviderDraftSnapshot(snapshot, { accountId: f.account.id, draftId: f.draft.id }));
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM provider_draft_operations').get()!.n, 0);
  } finally { f.store.close(); }
});

test('an earlier local acknowledgement cannot replace a newer desired draft revision or content hash', async () => {
  const f = fixture();
  try {
    const old = await createProviderDraftMime(f.store, f.draft, f.account, { owner: f.link.ownerMarker, operationId: 'old-snapshot', revision: f.draft.revision! });
    f.repo.desire(f.draft, old.contentHash, true);
    const latest = f.store.saveDraft({ id: f.draft.id, body: 'Later authored samples.' });
    const snapshot = await createProviderDraftMime(f.store, latest, f.account, { owner: f.link.ownerMarker, operationId: 'new-snapshot', revision: latest.revision! });
    f.repo.desire(latest, snapshot.contentHash, true); const before = f.repo.link(f.account.id, f.draft.id)!;
    try { f.repo.desire(f.draft, old.contentHash, true); }
    catch (error) { assert.equal((error as { status: number }).status, 409); }
    assert.deepEqual(f.repo.link(f.account.id, f.draft.id), before);
    assert.equal(f.repo.draft(f.account.id, f.draft.id)!.body, latest.body);
  } finally { f.store.close(); }
});

test('one acknowledged desired revision cannot silently change its content hash and break browser monotonicity', async () => {
  const f = fixture();
  try {
    const snapshot = await createProviderDraftMime(f.store, f.draft, f.account, { owner: f.link.ownerMarker, operationId: 'owned-snapshot', revision: f.draft.revision! });
    f.repo.desire(f.draft, snapshot.contentHash, true); const before = f.repo.link(f.account.id, f.draft.id)!;
    try { f.repo.desire(f.draft, 'b'.repeat(64), true); }
    catch (error) { assert.equal((error as { status: number }).status, 409); }
    assert.deepEqual(f.repo.link(f.account.id, f.draft.id), before);
  } finally { f.store.close(); }
});

test('matching opaque draft markers cannot hide a different Bcc or a same-size attachment-byte change', async () => {
  const f = fixture();
  try {
    const withBcc = f.store.saveDraft({ id: f.draft.id, bcc: 'hidden@example.test', html: '<p>Three <strong>fictional</strong> samples.</p>' });
    const added = f.store.addAttachment(withBcc.id, { name: 'owned.txt', mimeType: 'text/plain', data: Buffer.from('Cedar').toString('base64') });
    const snapshot = await createProviderDraftMime(f.store, added.draft, f.account, { owner: f.link.ownerMarker, operationId: 'owned-mime', revision: added.draft.revision! });
    const raw = snapshot.raw.toString(); const changedRecipient = raw.replace('hidden@example.test', 'other@example.test');
    assert.notEqual(changedRecipient, raw); assert.equal(await equivalentProviderDraftMime(snapshot, Buffer.from(changedRecipient), f.account.email), false);
    const encoded = Buffer.from('Cedar').toString('base64'), changedBytes = raw.replace(encoded, Buffer.from('Birch').toString('base64'));
    assert.notEqual(changedBytes, raw); assert.equal(await equivalentProviderDraftMime(snapshot, Buffer.from(changedBytes), f.account.email), false);
    assert.equal(await equivalentProviderDraftMime(snapshot, snapshot.raw, f.account.email), true);
  } finally { f.store.close(); }
});
