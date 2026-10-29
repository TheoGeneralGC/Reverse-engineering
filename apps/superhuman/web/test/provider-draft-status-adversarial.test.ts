import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderDraftStatusController, providerDraftPresentation } from '../src/provider-draft-status.ts';
import { checkedProviderDraftSnapshot } from '../src/provider-draft-client.ts';
import type { ProviderDraftSnapshot } from '../../api/src/provider-draft-types.ts';
import { providerHash, providerOperation, providerQueued, providerSynced, providerTime, providerUnknown } from './provider-draft-fixtures.ts';

const scope = { accountId: 'a', draftId: 'd' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function syncedAt(localRevision: number, syncRevision = 3): ProviderDraftSnapshot {
  const snapshot = providerSynced({ revision: syncRevision, desiredRevision: localRevision, syncedRevision: localRevision });
  snapshot.operation = { ...snapshot.operation!, draftRevision: localRevision }; return snapshot;
}

test('an older local revision ACK cannot clear the newest edit token or restore an old cloud-success label', () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 5, pollMs: 0 });
  assert.equal(controller.acceptAcknowledgedStatus(syncedAt(5)), true);
  const token = controller.markEdited(); controller.failLocal(token, 'Keep latest local failure'); controller.acknowledgeLocal(4, token);
  assert.equal(controller.getSnapshot().localRevision, 5); assert.equal(controller.getSnapshot().localDirty, true);
  assert.equal(controller.getSnapshot().localError, 'Keep latest local failure');
  assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Gmail sync pending');
  controller.acknowledgeLocal(6, token); assert.equal(controller.getSnapshot().localDirty, false);
  assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Gmail sync pending'); controller.dispose();
});

test('a contradictory first current-operation hash cannot claim cloud success or poison the status revision floor', () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0 });
  const malformed = syncedAt(1, 900); malformed.operation = { ...malformed.operation!, contentHash: 'b'.repeat(64) };
  assert.equal(controller.acceptAcknowledgedStatus(malformed), false);
  assert.equal(controller.getSnapshot().snapshot, null); assert.equal(controller.getSnapshot().readUnavailable, true);
  assert.equal(controller.acceptAcknowledgedStatus(syncedAt(1)), true);
  assert.equal(controller.getSnapshot().snapshot?.revision, 3); assert.equal(providerDraftPresentation(controller.getSnapshot()).cloudLabel, 'Synced to Gmail'); controller.dispose();
});

test('synced status cannot coexist with an explicitly unresolved operation or unverified confirmation', () => {
  for (const operation of [
    null,
    providerOperation({ state: 'unknown', issuedAt: providerTime }),
    providerOperation({ state: 'dispatching', issuedAt: providerTime }),
    providerOperation({ state: 'confirmed', issuedAt: providerTime, completedAt: providerTime }),
    { ...providerSynced().operation!, kind: 'delete' as const },
    { ...providerSynced().operation!, resolution: 'target-unavailable' as const },
    { ...providerSynced().operation!, draftRevision: 2 },
    { ...providerSynced().operation!, result: { ...providerSynced().operation!.result!, providerThreadId: null } },
  ]) {
    assert.throws(() => checkedProviderDraftSnapshot(providerSynced({ operation }), scope));
  }
});

test('known operation receipt mutation is rejected before the revision floor advances, and a later valid ACK remains usable', () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0 });
  assert.equal(controller.acceptAcknowledgedStatus(providerQueued()), true);
  const bad = providerSynced({ revision: 999 }); bad.operation = { ...bad.operation!, providerDraftId: 'invented-prewrite-mapping' };
  assert.equal(controller.acceptAcknowledgedStatus(bad), false); assert.equal(controller.getSnapshot().snapshot?.revision, 1);
  assert.equal(controller.acceptAcknowledgedStatus(providerSynced()), true); assert.equal(controller.getSnapshot().snapshot?.revision, 3);
  assert.equal(controller.getSnapshot().readUnavailable, false); controller.dispose();
});

test('a newer acknowledged status fences a held reconciliation and keeps its obsolete verification out of the view', async () => {
  const held = deferred<unknown>(), requests: { path: string; method: string; body: unknown }[] = [];
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0, request: async (path, body, method = 'GET') => { requests.push({ path, body, method }); return method === 'GET' ? { providerDraft: providerUnknown() } : held.promise; } });
  assert.equal(await controller.load(), true); const pending = controller.reconcile();
  assert.deepEqual(requests[1], { path: '/drafts/d/provider/reconcile', method: 'POST', body: { accountId: 'a', expectedSyncRevision: 2 } });
  assert.equal(controller.acceptAcknowledgedStatus(syncedAt(1, 4)), true);
  const token = controller.markEdited();
  held.resolve({ providerDraft: syncedAt(1, 3), verification: { operationId: 'cloud-create', matches: 1, scanComplete: true, target: 'present', content: 'equivalent', issuedOutcome: 'confirmed' } });
  assert.equal(await pending, false); assert.equal(controller.getSnapshot().snapshot?.revision, 4); assert.equal(controller.getSnapshot().verification, null);
  assert.equal(controller.getSnapshot().localDirty, true); controller.failLocal(token, 'Latest local save failed');
  assert.equal(providerDraftPresentation(controller.getSnapshot()).localLabel, 'Could not save locally');
  assert.equal(requests.filter(r => r.method === 'POST').length, 1); controller.dispose();
});

test('failed explicit status reconciliation never schedules a write retry and keeps unknown status and typing intact', async () => {
  const scheduled: (() => void)[] = [], calls: string[] = [];
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, schedule: callback => { scheduled.push(callback); return () => {}; }, request: async (_path, _body, method = 'GET') => { calls.push(method); if (method === 'POST') throw Error('Synthetic unknown reconciliation transport'); return { providerDraft: providerUnknown() }; } });
  await controller.load(); const token = controller.markEdited(); assert.equal(await controller.reconcile(), false);
  assert.equal(controller.getSnapshot().snapshot?.state, 'outcome_unknown'); assert.equal(controller.getSnapshot().localDirty, true);
  assert.equal(providerDraftPresentation(controller.getSnapshot()).blocksDelivery, true); assert.equal(providerDraftPresentation(controller.getSnapshot()).blocksTyping, false);
  assert.equal(controller.getSnapshot().editVersion, token); assert.deepEqual(calls, ['GET', 'POST']); assert.equal(scheduled.length, 0);
  await controller.load(); assert.deepEqual(calls, ['GET', 'POST', 'GET']); controller.dispose();
});

test('scope objects are immutable and suspension/account change fences a late reconciliation; remount starts with local GET', async () => {
  const held = deferred<unknown>(), options = { ...scope }; let current = true; const calls: { path: string; method: string }[] = [];
  const controller = new ProviderDraftStatusController({ ...options, localRevision: 1, pollMs: 0, isCurrent: () => current, request: async (path, _body, method = 'GET') => { calls.push({ path, method }); return method === 'GET' ? { providerDraft: providerUnknown() } : held.promise; } });
  options.accountId = 'foreign'; assert.equal(controller.scope.accountId, 'a'); assert.equal(Object.isFrozen(controller.scope), true);
  await controller.load(); const pending = controller.reconcile(); current = false; controller.suspend();
  held.resolve({ providerDraft: providerSynced(), verification: { operationId: 'cloud-create', matches: 1, scanComplete: true, target: 'present', content: 'equivalent', issuedOutcome: 'confirmed' } });
  assert.equal(await pending, false); assert.equal(controller.getSnapshot().snapshot?.state, 'outcome_unknown');
  current = true; controller.activate(); assert.equal(controller.getSnapshot().checking, false); assert.equal(await controller.load(), true);
  assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'GET']); assert.ok(calls.every(c => c.path.startsWith('/drafts/d/provider')));
  controller.dispose(); assert.equal(await controller.reconcile(), false); assert.equal(await controller.load(), false);
});

test('same desired revision cannot silently acquire another content hash, even under a new operation ID', () => {
  const controller = new ProviderDraftStatusController({ ...scope, localRevision: 1, pollMs: 0 });
  controller.acceptAcknowledgedStatus(providerQueued());
  const malformed = providerQueued({ revision: 900, desiredHash: 'b'.repeat(64), operation: providerOperation({ id: 'new-op', contentHash: 'b'.repeat(64) }) });
  assert.equal(controller.acceptAcknowledgedStatus(malformed), false); assert.equal(controller.getSnapshot().snapshot?.revision, 1);
  const good = providerSynced(); assert.equal(good.desiredHash, providerHash); assert.equal(controller.acceptAcknowledgedStatus(good), true); controller.dispose();
});
