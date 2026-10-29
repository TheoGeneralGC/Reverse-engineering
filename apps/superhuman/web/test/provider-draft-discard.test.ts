import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.ts';
import { ProviderDraftDiscardController, checkedProviderDiscardResponse, providerDiscardStorageKey, type ProviderDiscardStorage } from '../src/provider-draft-discard.ts';
import type { ProviderDraftDiscardRequest, ProviderDraftDiscardResponse } from '../../api/src/provider-draft-types.ts';
import { providerHash, providerOperation, providerQueued, providerSynced, providerTime, providerUnknown } from './provider-draft-fixtures.ts';
const scope = { accountId: 'a', draftId: 'd' }, slot = providerDiscardStorageKey(scope);
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
const identity = () => ({ draftRevision: 1, contentHash: providerHash, providerDraft: providerQueued() });
const request = (): ProviderDraftDiscardRequest => ({ accountId: 'a', clientRequestId: 'discard-one', expectedDraftRevision: 1, expectedContentHash: providerHash, expectedSyncRevision: 1 });
export const discardResponse = (resolution: ProviderDraftDiscardResponse['resolution'] = 'pending'): ProviderDraftDiscardResponse => ({
  receipt: { id: 'discard-receipt', accountId: 'a', draftId: 'd', clientRequestId: 'discard-one', operationId: 'cloud-delete', draftRevision: 1, contentHash: providerHash, acceptedSyncRevision: 1, acceptedAt: providerTime },
  resolution,
  providerDraft: resolution === 'pending' ? providerQueued({ revision: 2, state: 'discard_queued', deliveryBlocked: true }) : resolution === 'unavailable' ? providerSynced({ revision: 5, state: 'discarded', deliveryBlocked: true, operation: providerOperation({ id: 'cloud-delete', kind: 'delete', state: 'unknown', providerDraftId: 'gmail-draft', providerMessageId: 'gmail-message', providerThreadId: 'gmail-thread', issuedAt: providerTime, completedAt: providerTime, resolution: 'target-unavailable' }) }) : providerQueued({ revision: 5, state: 'discarded', deliveryBlocked: true, operation: providerOperation({ id: 'cloud-delete', kind: 'delete', state: 'confirmed', completedAt: providerTime, resolution: 'target-unavailable' }) }),
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('managed discard saves its exact key and snapshot before one POST; only terminal host acknowledgement releases it', async () => {
  const s = storage(), held = deferred<unknown>(), calls: { path: string; body: unknown; method?: string }[] = [];
  const c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', pollMs: 0, request: async (path, body, method) => { assert.ok(s.getItem(slot)); calls.push({ path, body, method }); return held.promise; } });
  const sending = c.discard(identity()); assert.equal(c.getSnapshot().blocked, true); assert.equal(c.getSnapshot().submitting, true); assert.equal(await c.discard(identity()), false); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { path: '/drafts/d/discard-operations', body: request(), method: 'POST' });
  held.resolve(discardResponse('discarded')); assert.equal(await sending, true); assert.equal(c.getSnapshot().settled, true); assert.equal(c.getSnapshot().blocked, true); assert.ok(s.getItem(slot), 'The host has not acknowledged its exact editor yet');
  assert.equal(c.releaseTerminal(), true); assert.equal(s.getItem(slot), null); assert.equal(c.getSnapshot().released, true); assert.equal(calls.length, 1); c.dispose();
});

test('lost ACK and404 remount remain locked and use only the original GET key; absence is not a fresh discard invitation', async () => {
  const s = storage(); const first = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', pollMs: 0, request: async () => { throw Error('Connection lost'); } });
  await first.discard(identity()); assert.equal(first.getSnapshot().unknown, true); first.dispose();
  const calls: string[] = []; let answer: unknown = new ApiError('Not found', 404, 'provider_draft_not_found');
  const next = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => { throw Error('Never create another key'); }, pollMs: 0, request: async (path, body, method) => { calls.push(method + ' ' + path); assert.equal(body, undefined); if (answer instanceof Error) throw answer; return answer; } });
  assert.equal(next.getSnapshot().blocked, true); assert.equal(await next.recover(), false); assert.ok(s.getItem(slot)); assert.equal(await next.discard(identity()), false);
  answer = discardResponse('unavailable'); assert.equal(await next.recover(), true); assert.equal(next.getSnapshot().response?.resolution, 'unavailable'); assert.equal(next.getSnapshot().settled, true); assert.ok(calls.every(call => call === 'GET /draft-discard-operations/by-request/discard-one?accountId=a&draftId=d')); next.dispose();
});

test('definite preacceptance refusal unlocks without erasing authorship; transport/internal errors retain recovery', async () => {
  for (const [status, code, definite] of [[400, 'provider_draft_invalid_request', true], [404, 'provider_draft_not_found', true], [409, 'provider_draft_revision_conflict', true], [409, 'provider_draft_locked', true], [503, 'provider_draft_stopping', true], [500, 'provider_draft_corrupt', false], [409, 'different_error', false]] as const) {
    const s = storage(), c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', request: async () => { throw new ApiError('Synthetic refusal', status, code); } });
    await c.discard(identity()); assert.equal(c.getSnapshot().blocked, !definite, code); assert.equal(c.getSnapshot().refused, definite, code); assert.equal(!!s.getItem(slot), !definite, code); c.dispose();
  }
});

test('all receipt identity fields bind the exact accepted intent and terminal requires its reserved delete operation', () => {
  const good = discardResponse('discarded'); assert.equal(checkedProviderDiscardResponse(good, scope, request()).resolution, 'discarded');
  const mutations: ((value: ProviderDraftDiscardResponse) => void)[] = [value => { value.receipt.accountId = 'b'; }, value => { value.receipt.draftId = 'other'; }, value => { value.receipt.clientRequestId = 'other'; }, value => { value.receipt.contentHash = 'b'.repeat(64); }, value => { value.receipt.draftRevision = 2; }, value => { value.receipt.acceptedSyncRevision = 2; }, value => { value.receipt.operationId = null; }, value => { value.providerDraft.operation!.id = 'other-delete'; }, value => { value.providerDraft.operation!.resolution = 'unverified'; }, value => { value.providerDraft.operation!.state = 'dispatching'; }, value => { value.providerDraft.desiredHash = 'b'.repeat(64); }, value => { value.providerDraft.state = 'consumed'; }];
  for (const mutate of mutations) { const value = structuredClone(good); mutate(value); assert.throws(() => checkedProviderDiscardResponse(value, scope, request())); }
  const changed = structuredClone(good); changed.receipt.id = 'replaced'; assert.throws(() => checkedProviderDiscardResponse(changed, scope, request(), good.receipt));
  for (const field of ['providerDraftId', 'providerMessageId', 'providerThreadId'] as const) { const swapped = structuredClone(good); swapped.providerDraft.operation![field] = 'foreign-target'; assert.throws(() => checkedProviderDiscardResponse(swapped, scope, request())); }
  const mapped = discardResponse('unavailable'); mapped.providerDraft.operation!.contentHash = 'b'.repeat(64); assert.throws(() => checkedProviderDiscardResponse(mapped, scope, request()));
});

test('accepted waiting receipt permits the earlier unresolved cloud operation, but never automatically reconciles or writes again', async () => {
  const s = storage(), callbacks: (() => void)[] = [], calls: string[] = [];
  const pending = discardResponse(); pending.providerDraft = { ...providerUnknown(), revision: 3 };
  const c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', maxPolls: 2, schedule: callback => { callbacks.push(callback); return () => {}; }, request: async (path, body, method) => { calls.push(method + ' ' + path); return pending; } });
  assert.equal(await c.discard(identity()), true); assert.equal(c.getSnapshot().response?.providerDraft.operation?.id, 'cloud-create');
  callbacks.shift()!(); await tick(); callbacks.shift()!(); await tick(); assert.equal(callbacks.length, 0); assert.equal(calls.length, 3); assert.equal(calls.filter(call => call.startsWith('POST')).length, 1); assert.ok(calls.slice(1).every(call => call.startsWith('GET /draft-discard-operations/'))); c.dispose();
});

test('suspend/account fence rejects a late ACK and permanent disposal prevents every recovery request', async () => {
  const s = storage(), held = deferred<unknown>(); let current = true, calls = 0;
  const c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', isCurrent: () => current, request: async () => { calls++; return held.promise; } });
  const pending = c.discard(identity()); current = false; c.suspend(); held.resolve(discardResponse('discarded')); assert.equal(await pending, false); assert.equal(c.getSnapshot().response, null); assert.ok(s.getItem(slot)); current = true; c.dispose(); assert.equal(await c.recover(), false); assert.equal(await c.discard(identity()), false); assert.equal(calls, 1);
});

test('another window replacing the journal during recovery is retained and cannot expose or clear the old terminal result', async () => {
  const s = storage(), held = deferred<unknown>();
  const c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', pollMs: 0, request: async (_path, _body, method) => { if (method === 'POST') throw Error('Lost ACK'); return held.promise; } });
  await c.discard(identity()); const recovery = c.recover(), replacement = JSON.stringify({ version: 1, draftId: 'd', request: { ...request(), clientRequestId: 'newer-key' }, receipt: null }); s.setItem(slot, replacement); held.resolve(discardResponse('discarded'));
  assert.equal(await recovery, false); assert.equal(s.getItem(slot), replacement); assert.equal(c.getSnapshot().response, null); assert.equal(c.getSnapshot().blocked, true); assert.equal(c.releaseTerminal(), false); c.dispose();
});

test('unavailable/corrupt/silent storage blocks POST; failed terminal clear does not unlock the editor', async () => {
  for (const mode of ['silent', 'throw', 'corrupt'] as const) {
    let posts = 0; const s = storage(); if (mode === 'corrupt') s.setItem(slot, '{corrupt');
    const bad: ProviderDiscardStorage = { getItem: s.getItem, setItem: mode === 'throw' ? () => { throw Error('Denied'); } : mode === 'silent' ? () => {} : s.setItem, removeItem: s.removeItem };
    const c = new ProviderDraftDiscardController({ ...scope, storage: bad, makeKey: () => 'discard-one', request: async () => { posts++; return discardResponse('discarded'); } }); await c.discard(identity()); assert.equal(posts, 0); c.dispose();
  }
  const s = storage(), c = new ProviderDraftDiscardController({ ...scope, storage: { ...s, removeItem: () => {} }, makeKey: () => 'discard-one', request: async () => discardResponse('discarded') }); await c.discard(identity()); assert.equal(c.releaseTerminal(), false); assert.equal(c.getSnapshot().blocked, true); assert.ok(s.getItem(slot)); c.dispose();
});

test('managed ownership, exact saved local identity and the latest delivery guard are required before journaling', async () => {
  let posts = 0, allowed = true; const s = storage(), c = new ProviderDraftDiscardController({ ...scope, storage: s, canDiscard: () => allowed, makeKey: () => 'discard-one', request: async () => { posts++; return discardResponse(); } });
  await c.discard({ ...identity(), draftRevision: 2 }); await c.discard({ ...identity(), contentHash: 'b'.repeat(64) }); allowed = false; await c.discard(identity()); assert.equal(posts, 0); assert.equal(s.getItem(slot), null); c.dispose();
});

test('receipt persistence across remount rejects a substituted same-key receipt without poisoning later valid recovery', async () => {
  const s = storage(), c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', pollMs: 0, request: async () => discardResponse() }); await c.discard(identity()); c.dispose();
  const bad = discardResponse('discarded'); bad.receipt.operationId = 'substitute'; bad.providerDraft.operation!.id = 'substitute'; let answer = bad;
  const next = new ProviderDraftDiscardController({ ...scope, storage: s, pollMs: 0, request: async () => answer }); assert.equal(await next.recover(), false); assert.equal(next.getSnapshot().response, null); answer = discardResponse('discarded'); assert.equal(await next.recover(), true); assert.equal(next.getSnapshot().response?.receipt.operationId, 'cloud-delete'); next.dispose();
});

test('the first accepted and remounted responses cannot substitute a previously acknowledged Gmail draft mapping', async () => {
  const pending = discardResponse(); pending.providerDraft = providerSynced({ revision: 4, state: 'discard_queued', deliveryBlocked: true });
  const s = storage(), c = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', pollMs: 0, request: async () => pending });
  assert.equal(await c.discard(identity()), true); c.dispose();
  const good = discardResponse('discarded'); good.providerDraft = { ...providerSynced({ revision: 6, state: 'discarded', deliveryBlocked: true }), operation: providerOperation({ id: 'cloud-delete', kind: 'delete', state: 'confirmed', providerDraftId: 'gmail-draft', providerMessageId: 'gmail-message', providerThreadId: 'gmail-thread', issuedAt: providerTime, completedAt: providerTime, resolution: 'target-unavailable' }) };
  const substituted = structuredClone(good); substituted.providerDraft.providerDraftId = 'another-gmail-draft'; substituted.providerDraft.operation!.providerDraftId = 'another-gmail-draft'; let answer = substituted;
  const next = new ProviderDraftDiscardController({ ...scope, storage: s, pollMs: 0, request: async () => answer });
  assert.equal(await next.recover(), false); assert.equal(next.getSnapshot().response, null); assert.equal(next.getSnapshot().blocked, true); answer = good; assert.equal(await next.recover(), true); assert.equal(next.getSnapshot().response?.providerDraft.providerDraftId, 'gmail-draft'); next.dispose();
});

test('a remounted terminal receipt cannot change its terminal resolution or claimed issued outcome', async () => {
  const s = storage(), first = new ProviderDraftDiscardController({ ...scope, storage: s, makeKey: () => 'discard-one', pollMs: 0, request: async () => discardResponse('discarded') }); await first.discard(identity()); first.dispose();
  let answer = discardResponse('unavailable'); const c = new ProviderDraftDiscardController({ ...scope, storage: s, pollMs: 0, request: async () => answer });
  assert.equal(await c.recover(), false); assert.equal(c.getSnapshot().settled, false); assert.equal(c.releaseTerminal(), false); assert.ok(s.getItem(slot)); answer = discardResponse('discarded'); assert.equal(await c.recover(), true); assert.equal(c.getSnapshot().response?.resolution, 'discarded'); c.dispose();
});
