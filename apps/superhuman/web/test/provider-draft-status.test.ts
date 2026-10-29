import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedProviderDraftSnapshot, checkedProviderDraftAdvance } from '../src/provider-draft-client.ts';
import { ProviderDraftStatusController, providerDraftPresentation } from '../src/provider-draft-status.ts';
import { providerHash, providerOperation, providerQueued, providerSynced, providerUnknown, providerUnmanaged } from './provider-draft-fixtures.ts';
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const scope = { accountId: 'a', draftId: 'd' };

test('browser validator rejects foreign, incomplete, secret-bearing and falsely safe cloud snapshots', () => {
  assert.deepEqual(checkedProviderDraftSnapshot(providerUnmanaged(), scope), providerUnmanaged());
  assert.deepEqual(checkedProviderDraftSnapshot(providerSynced(), scope), providerSynced());
  for (const value of [providerQueued({ accountId: 'b' }), providerQueued({ draftId: 'other' }), providerSynced({ providerDraftId: null }), providerSynced({ providerMessageId: 'mismatched-result' }), providerSynced({ desiredRevision: 2 }), { ...providerUnknown(), deliveryBlocked: false }, { ...providerQueued(), token: 'never-display' }, { ...providerUnmanaged(), providerDraftId: 'legacy-unclaimed' }, providerQueued({ operation: { ...providerOperation(), draftId: 'other' } })]) assert.throws(() => checkedProviderDraftSnapshot(value, scope));
});

test('known mapping and operation identity/result cannot mutate or poison the accepted revision floor', () => {
  const old = providerSynced(), operations = new Map([[old.operation!.id, old.operation!]]);
  for (const value of [providerSynced({ revision: 900, providerDraftId: 'foreign-draft' }), providerSynced({ revision: 900, operation: { ...old.operation!, contentHash: 'b'.repeat(64) } }), providerSynced({ revision: 900, operation: { ...old.operation!, result: { ...old.operation!.result!, providerMessageId: 'different-ack' } } }), providerSynced({ revision: 900, operation: { ...old.operation!, issuedAt: null } })]) assert.throws(() => checkedProviderDraftAdvance(old, value, operations));
  assert.doesNotThrow(() => checkedProviderDraftAdvance(old, providerSynced({ revision: 4 }), operations));
  assert.throws(() => checkedProviderDraftAdvance(old, providerSynced({ error: { code: 'changed', message: 'same revision substitution', retry: 'none' } }), operations));
});

test('initial status and bounded processing polls issue local GET only, never reconciliation or sync writes', async () => {
  const jobs: { run: () => void; cancelled: boolean }[] = [], calls: { path: string; method: string }[] = [];
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, maxPolls: 2, schedule: run => { const job = { run, cancelled: false }; jobs.push(job); return () => { job.cancelled = true; }; }, request: async (path, _body, method = 'GET') => { calls.push({ path, method }); return { providerDraft: providerQueued() }; } });
  assert.equal(calls.length, 0); await controller.load();
  for (let i = 0; i < 3; i++) { const job = jobs.shift(); if (job && !job.cancelled) job.run(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.method === 'GET' && call.path === '/drafts/d/provider?accountId=a')); assert.equal(jobs.length, 0); controller.dispose();
});

test('a newer local ACK status cancels an older held read without replacing the current cloud state', async () => {
  const held = deferred<unknown>(); const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0, request: () => held.promise });
  const reading = controller.load(); assert.equal(controller.acceptAcknowledgedStatus(providerSynced()), true); held.resolve({ providerDraft: providerQueued() }); assert.equal(await reading, false);
  assert.equal(controller.getSnapshot().snapshot?.revision, 3); assert.equal(controller.getSnapshot().readUnavailable, false); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Synced to Gmail');
  assert.equal(controller.acceptAcknowledgedStatus(providerQueued()), false); assert.equal(controller.getSnapshot().readUnavailable, false); controller.dispose();
});

test('old local saves never clear newer typing and cloud success requires the current acknowledged revision', () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 0, pollMs: 0 }); const first = controller.markEdited(), second = controller.markEdited();
  controller.acknowledgeLocal(1, first); controller.acceptAcknowledgedStatus(providerSynced()); assert.equal(controller.getSnapshot().localDirty, true); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Gmail sync pending');
  controller.failLocal(second, 'Synthetic local failure'); assert.equal(providerDraftPresentation(controller.getSnapshot()).localLabel, 'Could not save locally'); controller.acknowledgeLocal(2, second); assert.equal(controller.getSnapshot().localDirty, false); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Gmail sync pending');
  controller.acceptAcknowledgedStatus(providerSynced({ revision: 4, desiredRevision: 2, syncedRevision: 2 })); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Synced to Gmail'); controller.dispose();
});

test('explicit reconciliation is single-flight, scope/revision-bound and cannot erase typing made while checking', async () => {
  const held = deferred<unknown>(), calls: { path: string; body: any; method: string }[] = [];
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0, request: async (path, body, method = 'GET') => { calls.push({ path, body, method }); return method === 'GET' ? { providerDraft: providerUnknown() } : held.promise; } });
  await controller.load(); assert.equal(calls.length, 1); const checking = controller.reconcile(); assert.equal(await controller.reconcile(), false); assert.equal(calls.length, 2); assert.deepEqual(calls[1], { path: '/drafts/d/provider/reconcile', body: { accountId: 'a', expectedSyncRevision: 2 }, method: 'POST' }); controller.markEdited();
  held.resolve({ providerDraft: providerSynced(), verification: { operationId: 'cloud-create', matches: 1, scanComplete: true, target: 'present', content: 'equivalent', issuedOutcome: 'confirmed' } }); assert.equal(await checking, true); assert.equal(controller.getSnapshot().localDirty, true); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Gmail sync pending'); assert.equal(providerDraftPresentation(controller.getSnapshot()).blocksTyping, false); controller.dispose();
});

test('foreign reconciliation proof cannot replace an unknown status or mark it synchronized', async () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0, request: async (_path, _body, method = 'GET') => method === 'GET' ? { providerDraft: providerUnknown() } : { providerDraft: providerSynced(), verification: { operationId: 'different-operation', matches: 1, scanComplete: true, target: 'present', content: 'equivalent', issuedOutcome: 'confirmed' } } });
  await controller.load(); assert.equal(await controller.reconcile(), false); assert.equal(controller.getSnapshot().snapshot?.state, 'outcome_unknown'); assert.equal(providerDraftPresentation(controller.getSnapshot()).blocksDelivery, true); assert.equal(providerDraftPresentation(controller.getSnapshot()).blocksTyping, false); controller.dispose();
});

test('suspend/account context and permanent disposal fence late reads and do not issue another request', async () => {
  const held = deferred<unknown>(); let current = true, calls = 0;
  const controller = new ProviderDraftStatusController({ ...scope, pollMs: 0, isCurrent: () => current, request: async () => { calls++; return held.promise; } }); const reading = controller.load(); current = false; controller.suspend(); held.resolve({ providerDraft: providerSynced() }); await reading; assert.equal(controller.getSnapshot().snapshot, null);
  current = true; controller.activate(); controller.acceptAcknowledgedStatus(providerUnmanaged()); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, ''); controller.dispose(); assert.equal(await controller.load(), false); assert.equal(await controller.reconcile(), false); assert.equal(calls, 1);
});

test('status read failure withholds cloud success, blocks delivery and retains local typing', async () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0, request: async () => { throw Error('Synthetic status transport failure'); } }); controller.acceptAcknowledgedStatus(providerSynced()); await controller.load(); const view = providerDraftPresentation(controller.getSnapshot());
  assert.equal(view.cloudLabel, 'Gmail status unavailable'); assert.equal(view.blocksDelivery, true); assert.equal(view.blocksTyping, false); assert.equal(controller.getSnapshot().snapshot?.providerDraftId, 'gmail-draft'); controller.dispose();
});

test('positive reconciliation exposes only the confirmed older revision before a distinct successor saves newer edits', async () => {
  const newerHash = 'b'.repeat(64), late = deferred<unknown>(), requests: { method: string; body: any }[] = []; let reads = 0;
  const confirmedOlder = providerSynced({ revision: 4, state: 'queued', desiredRevision: 2, desiredHash: newerHash });
  const later = '2026-10-28T00:00:01.000Z', update = providerOperation({ id: 'cloud-update', kind: 'update', state: 'dispatching', draftRevision: 2, contentHash: newerHash, providerDraftId: 'gmail-draft', providerMessageId: 'gmail-message', providerThreadId: 'gmail-thread', createdAt: later, issuedAt: later });
  const savingNewer = providerQueued({ revision: 5, state: 'saving', desiredRevision: 2, desiredHash: newerHash, syncedRevision: 1, syncedHash: providerHash, providerDraftId: 'gmail-draft', providerMessageId: 'gmail-message', providerThreadId: 'gmail-thread', operation: update, deliveryBlocked: true });
  const syncedNewer = providerSynced({ revision: 6, desiredRevision: 2, desiredHash: newerHash, syncedRevision: 2, syncedHash: newerHash, providerMessageId: 'gmail-message-new', operation: { ...update, state: 'confirmed', completedAt: later, resolution: 'matching-snapshot', result: { providerDraftId: 'gmail-draft', providerMessageId: 'gmail-message-new', providerThreadId: 'gmail-thread' } } });
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0, request: async (_path, body, method = 'GET') => { requests.push({ method, body }); if (method === 'POST') return { providerDraft: confirmedOlder, verification: { operationId: 'cloud-create', matches: 1, scanComplete: true, target: 'present', content: 'equivalent', issuedOutcome: 'confirmed' } }; reads++; return reads === 1 ? { providerDraft: providerUnknown() } : reads === 2 ? { providerDraft: savingNewer } : late.promise; } });
  await controller.load(); const edit = controller.markEdited(); controller.acknowledgeLocal(2, edit); controller.acceptAcknowledgedStatus({ ...providerUnknown(), revision: 3, desiredRevision: 2, desiredHash: newerHash }); await controller.reconcile();
  assert.equal(controller.getSnapshot().snapshot?.syncedRevision, 1); assert.equal(controller.getSnapshot().snapshot?.desiredRevision, 2); assert.notEqual(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Synced to Gmail'); assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  await controller.load(); assert.equal(controller.getSnapshot().snapshot?.operation?.id, 'cloud-update'); assert.equal(providerDraftPresentation(controller.getSnapshot()).blocksTyping, false);
  const oldRead = controller.load(); assert.equal(controller.acceptAcknowledgedStatus(syncedNewer), true); late.resolve({ providerDraft: savingNewer }); await oldRead; assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Synced to Gmail'); assert.equal(controller.getSnapshot().snapshot?.providerMessageId, 'gmail-message-new'); assert.equal(requests.filter(request => request.method === 'POST').length, 1); controller.dispose();
});
