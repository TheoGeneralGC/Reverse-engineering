import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { createApp } from '../src/server.ts';
import { buildMime } from '../src/mime.ts';
import type { Account, Draft, DeliveryAttempt } from '../src/types.ts';

const account: Account = { id: 'google:delivery-test', email: 'sender@example.test', name: 'Sender', provider: 'google', color: '#888' };
const env = { APPROVED_TEST_SENDERS: account.email, APPROVED_TEST_RECIPIENTS: 'recipient@example.test' };
function fixture(path = ':memory:') { const store = new Store(path); store.put('account', account.id, account); const provider = new GoogleProvider(store, {}); const created = store.saveDraft({ accountId: account.id, to: 'recipient@example.test', subject: 'Synthetic delivery', body: 'Synthetic delivery body' }); const pending = store.beginDelivery(created.id); const draft = store.unknownDelivery(created.id, 'Synthetic ambiguous send'); return { store, provider, draft, pending }; }
function metadata(id: string, marker?: string, extra: { from?: string; labels?: string[]; internetMessageId?: string; duplicateMarker?: boolean } = {}) {
  return { id, labelIds: extra.labels ?? ['SENT'], payload: { headers: [
    { name: 'From', value: extra.from ?? account.email }, { name: 'Message-ID', value: extra.internetMessageId ?? '<provider-final@mail.example.test>' },
    ...(marker ? [{ name: 'X-Reconstruction-Delivery-ID', value: marker }, ...(extra.duplicateMarker ? [{ name: 'x-reconstruction-delivery-id', value: marker }] : [])] : []),
  ] } };
}
function mockedScan(provider: GoogleProvider, ids: string[], values: Record<string, unknown>, paths: string[] = []) { provider.request = async (id, path, options = {}) => { assert.equal(id, account.id); assert.equal(options.method, undefined); paths.push(path); if (path === 'profile') return { emailAddress: account.email }; if (path.startsWith('messages?')) return { messages: ids.map(id => ({ id })) }; const name = decodeURIComponent(path.split('/')[1].split('?')[0]); return values[name]; }; return paths; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('delivery marker is persisted before dispatch, survives restart and stays out of visible content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-delivery-marker-')); const path = join(directory, 'synthetic.sqlite'); let store: Store | undefined;
  try {
    const setup = fixture(path); store = setup.store; const { draft } = setup; assert.match(draft.deliveryMarker!, /^[A-Za-z0-9_-]{32}$/); assert.equal(store.required<DeliveryAttempt>('delivery', draft.deliveryAttemptId!).marker, draft.deliveryMarker); const raw = buildMime(draft, account, undefined); assert.equal(raw.match(/^X-Reconstruction-Delivery-ID:/gm)?.length, 1); assert.ok(raw.includes(`X-Reconstruction-Delivery-ID: ${draft.deliveryMarker}\r\n`)); assert.equal(draft.body.includes(draft.deliveryMarker!), false); assert.ok(raw.includes(`Message-ID: ${draft.deliveryMessageId}`));
    assert.throws(() => buildMime({ ...draft, deliveryMarker: 'unsafe\r\nBcc: outsider@example.test' }, account, undefined), /Invalid delivery marker/); store.close(); store = new Store(path); assert.equal(store.required<Draft>('draft', draft.id).deliveryMarker, draft.deliveryMarker); assert.equal(store.required<Draft>('draft', draft.id).status, 'delivery_unknown');
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rewritten RFC Message-ID reconciles through exact opaque marker and stores provider identity separately', async () => {
  const { store, provider, draft } = fixture(); const paths = mockedScan(provider, ['candidate'], { candidate: metadata('candidate', draft.deliveryMarker) });
  try {
    const result = await provider.reconcileDelivery(draft); assert.equal(result.found, true); assert.equal(result.matches, 1); assert.equal(result.scanComplete, true); assert.equal(result.providerInternetMessageId, '<provider-final@mail.example.test>');
    const search = new URL(paths.find(path => path.startsWith('messages?'))!, 'https://mail.invalid/').searchParams; assert.equal(search.get('labelIds'), 'SENT'); assert.equal(search.get('maxResults'), '25'); assert.match(search.get('q')!, /^after:\d+$/); assert.equal(search.get('q')!.includes('rfc822msgid'), false);
    const detail = new URL(paths.find(path => path.startsWith('messages/'))!, 'https://mail.invalid/').searchParams; assert.equal(detail.get('format'), 'metadata'); assert.deepEqual(detail.getAll('metadataHeaders').sort(), ['From', 'Message-ID', 'X-Reconstruction-Delivery-ID']);
    const sent = store.completeDelivery(draft.id, result.providerMessageId, result.providerInternetMessageId, true); assert.equal(sent.deliveryMessageId, draft.deliveryMessageId); assert.equal(sent.providerMessageId, 'candidate'); assert.equal(sent.providerInternetMessageId, '<provider-final@mail.example.test>'); assert.equal(sent.deliveryMarkerVerified, true); assert.equal(store.required<DeliveryAttempt>('delivery', draft.deliveryAttemptId!).messageId, draft.deliveryMessageId);
  } finally { store.close(); }
});

test('requested RFC header, matching subject/body or fuzzy marker never substitute for exact marker proof', async () => {
  const { store, provider, draft } = fixture();
  try { for (const marker of [undefined, `${draft.deliveryMarker}-suffix`, 'a'.repeat(32)]) { mockedScan(provider, ['candidate'], { candidate: metadata('candidate', marker, { internetMessageId: draft.deliveryMessageId }) }); const result = await provider.reconcileDelivery(draft); assert.equal(result.found, false); assert.equal(result.matches, 0); assert.equal(result.reason, 'no_marker_match'); assert.equal(store.required<Draft>('draft', draft.id).status, 'delivery_unknown'); } } finally { store.close(); }
});

test('multiple distinct marker matches remain unknown, while duplicate list IDs count only once', async () => {
  const { store, provider, draft } = fixture();
  try { mockedScan(provider, ['one', 'two'], { one: metadata('one', draft.deliveryMarker), two: metadata('two', draft.deliveryMarker) }); let result = await provider.reconcileDelivery(draft); assert.equal(result.found, false); assert.equal(result.matches, 2); assert.equal(result.reason, 'multiple_marker_matches'); mockedScan(provider, ['one', 'one'], { one: metadata('one', draft.deliveryMarker) }); result = await provider.reconcileDelivery(draft); assert.equal(result.found, true); assert.equal(result.scannedCandidates, 1); } finally { store.close(); }
});

test('a marker match cannot confirm delivery when the bounded scan still has unchecked pages', async () => {
  const { store, provider, draft } = fixture(); let lists = 0; let reads = 0;
  provider.request = async (_id, path) => { if (path === 'profile') return { emailAddress: account.email }; if (path.startsWith('messages?')) { const query = new URL(path, 'https://mail.invalid/').searchParams; if (lists === 1) assert.equal(query.get('pageToken'), 'page-one'); lists++; return { messages: Array.from({ length: 25 }, (_, index) => ({ id: `candidate-${(lists - 1) * 25 + index}` })), nextPageToken: lists === 1 ? 'page-one' : 'more-unchecked' }; } reads++; const id = path.split('/')[1].split('?')[0]; return metadata(id, id === 'candidate-0' ? draft.deliveryMarker : undefined); };
  try { const result = await provider.reconcileDelivery(draft); assert.equal(result.found, false); assert.equal(result.matches, 1); assert.equal(result.scanComplete, false); assert.equal(result.reason, 'scan_limit_reached'); assert.equal(result.scannedCandidates, 50); assert.equal(reads, 50); assert.equal(lists, 2); } finally { store.close(); }
});

test('wrong identity, missing Sent label, duplicate marker headers and failed candidate reads never confirm', async () => {
  const { store, provider, draft } = fixture();
  try {
    for (const candidate of [metadata('candidate', draft.deliveryMarker, { from: 'outsider@example.test' }), metadata('candidate', draft.deliveryMarker, { labels: ['INBOX'] }), metadata('candidate', draft.deliveryMarker, { duplicateMarker: true }), { ...metadata('candidate', draft.deliveryMarker), id: 'different-resource' }]) { mockedScan(provider, ['candidate'], { candidate }); assert.equal((await provider.reconcileDelivery(draft)).found, false); }
    let calls = 0; provider.request = async () => { calls++; return { emailAddress: 'wrong-account@example.test' }; }; const wrong = await provider.reconcileDelivery(draft); assert.equal(wrong.reason, 'account_identity_unverified'); assert.equal(calls, 1);
    provider.request = async (_id, path) => { if (path === 'profile') return { emailAddress: account.email }; if (path.startsWith('messages?')) return { messages: [{ id: 'one' }, { id: 'two' }] }; if (path.startsWith('messages/one?')) return metadata('one', draft.deliveryMarker); throw new Error('Synthetic candidate read failure'); }; const failed = await provider.reconcileDelivery(draft); assert.equal(failed.found, false); assert.equal(failed.matches, 1); assert.equal(failed.scanComplete, false);
  } finally { store.close(); }
});

test('legacy unknown attempts without a marker remain locked and make no provider requests', async () => {
  const { store, provider, draft } = fixture(); const legacy = { ...draft, deliveryMarker: undefined }; store.put('draft', draft.id, legacy); let calls = 0; provider.request = async () => { calls++; throw new Error('No legacy scan allowed'); };
  try { const result = await provider.reconcileDelivery(legacy); assert.equal(result.found, false); assert.equal(result.reason, 'legacy_attempt_unverifiable'); assert.equal(calls, 0); assert.equal(store.required<Draft>('draft', draft.id).status, 'delivery_unknown'); assert.throws(() => store.saveDraft({ id: draft.id, status: 'draft' }), { code: 'delivery_requires_reconciliation' }); } finally { store.close(); }
});

test('accepted-before-commit failure reconciles read-only without a second send and preserves requested ID', async () => {
  const app = createApp({ databasePath: ':memory:', env, runJobs: false }); app.store.put('account', account.id, account); let sends = 0; const draft = app.store.saveDraft({ accountId: account.id, to: 'recipient@example.test', body: 'Synthetic' }); const commit = app.store.completeDelivery.bind(app.store);
  app.google.send = async pending => { sends++; assert.equal(app.store.required<Draft>('draft', pending.id).deliveryMarker, pending.deliveryMarker); assert.equal(app.store.required<DeliveryAttempt>('delivery', pending.deliveryAttemptId!).marker, pending.deliveryMarker); return { id: 'provider-accepted' }; }; app.store.completeDelivery = () => { throw new Error('Synthetic local commit crash'); };
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object');
  try {
    await assert.rejects(() => app.deliver(draft.id), { code: 'delivery_requires_reconciliation' }); app.store.completeDelivery = commit; const unknown = app.store.required<Draft>('draft', draft.id); mockedScan(app.google, ['provider-accepted'], { 'provider-accepted': metadata('provider-accepted', unknown.deliveryMarker) });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/drafts/${draft.id}/reconcile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.resolved, true); assert.equal(result.draft.status, 'sent'); assert.equal(result.draft.deliveryMessageId, unknown.deliveryMessageId); assert.equal(result.draft.providerInternetMessageId, '<provider-final@mail.example.test>'); await assert.rejects(() => app.deliver(draft.id), { code: 'already_sent' }); assert.equal(sends, 1);
  } finally { await app.close(); }
});

test('failed acknowledged metadata enrichment never downgrades sent status or retries the write', async () => {
  const app = createApp({ databasePath: ':memory:', env, runJobs: false }); app.store.put('account', account.id, account); let sends = 0; const started = deferred(); const draft = app.store.saveDraft({ accountId: account.id, to: 'recipient@example.test' }); app.google.send = async () => { sends++; return { id: 'accepted' }; }; app.google.acknowledgedDeliveryMetadata = async () => { started.resolve(); throw new Error('Synthetic metadata outage'); };
  try { const result = await app.deliver(draft.id); assert.equal(result.sent, true); await started.promise; await new Promise(resolve => setImmediate(resolve)); const sent = app.store.required<Draft>('draft', draft.id); assert.equal(sent.status, 'sent'); assert.equal(sent.providerMessageId, 'accepted'); assert.equal(sent.providerInternetMessageId, undefined); await assert.rejects(() => app.deliver(draft.id), { code: 'already_sent' }); assert.equal(sends, 1); } finally { await app.close(); }
});

test('shutdown awaits final metadata enrichment and stores final RFC ID separately from requested audit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-sent-enrichment-')); const path = join(directory, 'synthetic.sqlite'); const app = createApp({ databasePath: path, env, runJobs: false }); app.store.put('account', account.id, account); const started = deferred(); const release = deferred(); const draft = app.store.saveDraft({ accountId: account.id, to: 'recipient@example.test' }); app.google.send = async () => ({ id: 'accepted' }); app.google.acknowledgedDeliveryMetadata = async () => { started.resolve(); await release.promise; return { providerInternetMessageId: '<rewritten@mail.example.test>', markerVerified: true }; };
  try { await app.deliver(draft.id); await started.promise; const requested = app.store.required<Draft>('draft', draft.id).deliveryMessageId; let closed = false; const closing = app.close().then(() => { closed = true; }); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); release.resolve(); await closing; const reopened = new Store(path); try { const sent = reopened.required<Draft>('draft', draft.id); assert.equal(sent.status, 'sent'); assert.equal(sent.deliveryMessageId, requested); assert.equal(sent.providerInternetMessageId, '<rewritten@mail.example.test>'); assert.equal(sent.deliveryMarkerVerified, true); assert.equal(reopened.required<DeliveryAttempt>('delivery', sent.deliveryAttemptId!).messageId, requested); } finally { reopened.close(); } } finally { release.resolve(); await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a malformed send acknowledgment remains unknown and cannot produce another send', async () => {
  const app = createApp({ databasePath: ':memory:', env, runJobs: false }); app.store.put('account', account.id, account); let sends = 0; app.google.send = async () => { sends++; return {}; }; const draft = app.store.saveDraft({ accountId: account.id, to: 'recipient@example.test' });
  try { await assert.rejects(() => app.deliver(draft.id), { code: 'delivery_requires_reconciliation' }); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'delivery_unknown'); await assert.rejects(() => app.deliver(draft.id), { code: 'delivery_requires_reconciliation' }); assert.equal(sends, 1); } finally { await app.close(); }
});
