import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import type { Account, Draft } from '../src/types.ts';

async function listen(app: ReturnType<typeof createApp>) { await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); return `http://127.0.0.1:${address.port}`; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }

test('exact draft GET includes sent and delivery_unknown without provider calls or state changes', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false }); const base = await listen(app);
  app.google.request = async () => { throw new Error('Status reads must not call Google'); };
  app.google.reconcileDelivery = async () => { throw new Error('Status reads must not reconcile implicitly'); };
  const sent = app.store.saveDraft({ to: 'synthetic@example.test', subject: 'Read sent state' }); app.store.beginDelivery(sent.id); app.store.completeDelivery(sent.id, 'mock-accepted');
  const unknown = app.store.saveDraft({ to: 'synthetic@example.test', subject: 'Read unknown state' }); app.store.beginDelivery(unknown.id); app.store.unknownDelivery(unknown.id, 'Synthetic unconfirmed result');
  try {
    for (const [id, status] of [[sent.id, 'sent'], [unknown.id, 'delivery_unknown']] as const) {
      const before = app.store.required<Draft>('draft', id); const attempts = app.store.list('delivery');
      const response = await fetch(`${base}/api/drafts/${encodeURIComponent(id)}`); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json(); assert.equal(data.draft.status, status); assert.deepEqual(data.draft, before); assert.equal(data.deliveryPending, false);
      assert.deepEqual(app.store.required<Draft>('draft', id), before); assert.deepEqual(app.store.list('delivery'), attempts);
    }
    const listed = await (await fetch(`${base}/api/drafts`)).json(); assert.ok(!listed.drafts.some((draft: Draft) => draft.id === sent.id));
    assert.ok(listed.drafts.some((draft: Draft) => draft.id === unknown.id));
  } finally { await app.close(); }
});

test('exact missing draft GET returns existing not_found 404 and creates nothing', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false }); const base = await listen(app);
  try {
    const before = app.store.list('draft'); const response = await fetch(`${base}/api/drafts/missing-draft`);
    assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: { code: 'not_found', message: 'draft not found' } }); assert.deepEqual(app.store.list('draft'), before);
  } finally { await app.close(); }
});

test('queued dispatch is pending before stored sending status and remains pending until the mock send settles', async () => {
  const app = createApp({ databasePath: ':memory:', env: { APPROVED_TEST_SENDERS: 'sender@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test' }, runJobs: false }); const base = await listen(app);
  const owner: Account = { id: 'google:status-fixture', name: 'Status fixture', email: 'sender@example.test', provider: 'google', color: '#888' }; app.store.put('account', owner.id, owner);
  const draft = app.store.saveDraft({ accountId: owner.id, to: 'recipient@example.test', subject: 'Mock queued dispatch' });
  const syncStarted = deferred(); const releaseSync = deferred(); const sendStarted = deferred(); const releaseSend = deferred();
  app.google.sync = async () => { syncStarted.resolve(); await releaseSync.promise; return { imported: 0, pages: 1, partial: false, phase: 'history' as const, resultSizeEstimate: undefined, scope: 'offline fixture' }; };
  let sends = 0; app.google.send = async () => { sends++; sendStarted.resolve(); await releaseSend.promise; return { id: 'mock-accepted' }; };
  const read = async () => (await (await fetch(`${base}/api/drafts/${draft.id}`)).json()) as { draft: Draft; deliveryPending: boolean };
  const sync = app.requestSync(owner.id); await syncStarted.promise; const delivery = app.deliver(draft.id);
  try {
    const queued = await read(); assert.equal(queued.draft.status, 'draft'); assert.equal(queued.deliveryPending, true); assert.equal(sends, 0);
    releaseSync.resolve(); await sync; await sendStarted.promise;
    const sending = await read(); assert.equal(sending.draft.status, 'sending'); assert.equal(sending.deliveryPending, true); assert.equal(sends, 1);
    releaseSend.resolve(); await delivery;
    const sent = await read(); assert.equal(sent.draft.status, 'sent'); assert.equal(sent.deliveryPending, false); assert.equal(sends, 1);
  } finally { releaseSync.resolve(); releaseSend.resolve(); await Promise.allSettled([sync, delivery]); await app.close(); }
});
