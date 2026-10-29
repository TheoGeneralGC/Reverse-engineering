import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError } from '../src/api.ts';
import { trackingStable } from '../src/tracking/client.ts';
import { checkedTrackingDelivery, checkedTrackingControl, checkedOwnerTracking } from '../src/tracking/delivery-client.ts';
import { createTrackingDelivery, trackingDeliveryJournalKey } from '../src/tracking/delivery.ts';
import type { TrackingDeliverySnapshot, TrackingDeliveryControlResponse, TrackingDeliveryControlRequest } from '../src/tracking/delivery-client.ts';
import { createComposerSend } from '../src/composer-send.ts';
import type { Draft } from '../src/api.ts';
import type { DraftSendSnapshot, DraftSendOperation } from '../../api/src/draft-send-types.ts';
import { createAiDraftSend } from '../src/ai-draft-send.ts';
import type { AiDraftPreview } from '../src/ai-draft.ts';
const identity = { accountId: 'account-a', source: 'composer' as const, operationId: 'send-a' };
const digest = async (v: unknown) => createHash('sha256').update(trackingStable(v)).digest('hex');
const snapshot = (patch: Partial<TrackingDeliverySnapshot> = {}): TrackingDeliverySnapshot => ({ ...identity, version: 1, policyVersion: 'local-tracking-delivery-v1', generation: 0, draftId: 'draft-a', revision: 3, decision: { tracked: true, preferenceRevision: 1, reason: 'enabled' }, phase: 'held_before_gmail', mailOutcome: 'not-issued', registration: 'create-unknown', heldReason: 'collector-unresolved', canReconcile: true, canContinue: false, reads: { availability: 'unavailable', reason: 'event-import-not-integrated', events: [], humanReadVerified: false, namedRecipientIdentity: false }, ...patch });
async function receipt(request: TrackingDeliveryControlRequest, action: 'reconcile' | 'continue', s: TrackingDeliverySnapshot, state: 'accepted' | 'completed' = 'completed'): Promise<TrackingDeliveryControlResponse> { return { state, historical: false, snapshot: s, receipt: { ...identity, id: 'receipt-' + request.clientRequestId, clientRequestId: request.clientRequestId, action, expectedRevision: request.expectedRevision, requestProtocol: 'tracking-control-v1', requestFingerprint: await digest({ protocol: 'tracking-control-v1', request: { ...identity, action, ...request } }), acceptedAt: '2026-10-29T00:00:00.000Z' } }; }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => resolve = yes); return { promise, resolve }; };
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }

test('delivery status is exact, scoped, anonymous, and never equates held with a Gmail issue', () => {
 assert.equal(checkedTrackingDelivery(snapshot(), identity).mailOutcome, 'not-issued');
 for (const patch of [{ accountId: 'foreign' }, { canContinue: true, mailOutcome: 'sent' }, { phase: 'confirmed', registration: 'prepared' }, { registrationId: 'private-ref' }, { reads: { ...snapshot().reads, humanReadVerified: true } }]) assert.throws(() => checkedTrackingDelivery({ ...snapshot(), ...patch }, identity));
 for (const op of [{ state: 'held_before_provider', providerMessageId: 'provider', confirmedAt: null, startedAt: null, deliveryAttemptId: null }, { state: 'held_before_provider', providerMessageId: null, confirmedAt: null, startedAt: null, deliveryAttemptId: 'attempt' }]) assert.throws(() => checkedOwnerTracking(identity, identity, { error: { code: 'tracking_delivery_held', retry: 'none', providerOutcome: 'not_dispatched' }, ...op }));
});
test('control receipt binds exact request and clone before asynchronous digest; accepted is not completion', async () => {
 const request = { accountId: identity.accountId, clientRequestId: 'action-a', expectedRevision: 3 }, value = await receipt(request, 'reconcile', snapshot(), 'accepted');
 assert.equal((await checkedTrackingControl(value, identity, 'reconcile', request, digest)).state, 'accepted');
 const hold = deferred<string>(), pending = checkedTrackingControl(value, identity, 'reconcile', request, () => hold.promise);
 value.snapshot.accountId = 'foreign'; value.receipt.id = 'substitute'; request.accountId = 'foreign'; hold.resolve(value.receipt.requestFingerprint);
 assert.equal((await pending).snapshot.accountId, identity.accountId);
 for (const patch of [{ receipt: { ...value.receipt, accountId: 'foreign' } }, { state: 'completed', snapshot: snapshot({ revision: 2 }) }]) await assert.rejects(checkedTrackingControl({ ...await receipt({ ...request, accountId: identity.accountId }, 'reconcile', snapshot()), ...patch }, identity, 'reconcile', { ...request, accountId: identity.accountId }, digest));
});
test('explicit control journals before its single POST, duplicate click is synchronous, completed clears after current GET', async () => {
 const store = storage(), calls: string[] = [], hold = deferred<unknown>(); let latest = snapshot();
 const model = createTrackingDelivery({ identity, storage: store, digest, uuid: () => 'one', request: async (path, body, method = 'GET') => { calls.push(method + ' ' + path); if (method === 'POST') { assert.ok(store.values.has(trackingDeliveryJournalKey(identity))); return hold.promise; } return latest; } }); model.activate(); await model.load();
 const pending = model.control('reconcile'); assert.equal(await model.control('reconcile'), null); await new Promise(resolve => setImmediate(resolve));
 latest = snapshot({ revision: 4, registration: 'prepared', canReconcile: false, canContinue: true }); hold.resolve(await receipt({ accountId: identity.accountId, clientRequestId: 'one', expectedRevision: 3 }, 'reconcile', latest)); await pending;
 assert.equal(calls.filter(v => v.startsWith('POST')).length, 1); assert.equal(store.values.size, 0); assert.equal(model.getSnapshot().snapshot?.revision, 4); model.dispose();
});
test('lost acknowledgement and404 remount recover only the same control key', async () => {
 const store = storage(), calls: string[] = []; const request = async (path: string, _body?: unknown, method = 'GET') => { calls.push(method + ' ' + path); if (method === 'POST') throw new TypeError('synthetic'); if (path.includes('/requests/')) throw new ApiError('missing', 404, 'tracking_delivery_not_found'); return snapshot(); };
 const first = createTrackingDelivery({ identity, storage: store, digest, uuid: () => 'lost', request }); first.activate(); await first.load(); await first.control('reconcile'); first.dispose();
 const second = createTrackingDelivery({ identity, storage: store, digest, request }); second.activate(); await second.load(); assert.equal(second.getSnapshot().unknown, true); assert.equal(await second.control('continue'), null); assert.equal(calls.filter(v => v.startsWith('POST')).length, 1); assert.ok(calls.at(-1)?.includes('/requests/by-request/lost?')); assert.equal(store.values.size, 1); second.dispose();
});
test('accepted receipt is durable while work remains accepted; explicit GET recovery completes without repost', async () => {
 const store = storage(), calls: string[] = []; let current = snapshot(), accepted: TrackingDeliveryControlResponse;
 const model = createTrackingDelivery({ identity, storage: store, digest, uuid: () => 'accepted', request: async (path, body, method = 'GET') => { calls.push(method + ' ' + path); if (method === 'POST') { accepted = await receipt(body as TrackingDeliveryControlRequest, 'reconcile', current, 'accepted'); return accepted; } if (path.includes('/requests/')) return { ...accepted, state: 'completed', historical: true, snapshot: current }; return current; } }); model.activate(); await model.load(); await model.control('reconcile');
 assert.equal(model.getSnapshot().accepted, true); assert.equal(model.locked, true); assert.equal(JSON.parse([...store.values.values()][0]).receipt.id, 'receipt-accepted');
 current = snapshot({ revision: 4, registration: 'prepared', canReconcile: false, canContinue: true }); await model.recover(); assert.equal(model.locked, false); assert.equal(calls.filter(v => v.startsWith('POST')).length, 1); model.dispose();
});
test('storage failure, stale account and suspended reply cannot send or publish another scope', async () => {
 const store = storage(), hold = deferred<unknown>(); let posts = 0, current = true;
 const model = createTrackingDelivery({ identity, storage: { ...store, setItem: () => {} }, digest, uuid: () => 'storage', isCurrent: () => current, request: async (_p, _b, method) => { if (method === 'POST') posts++; return snapshot(); } }); model.activate(); await model.load(); await model.control('reconcile'); assert.equal(posts, 0); assert.match(model.getSnapshot().error, /storage/); model.dispose();
 const delayed = createTrackingDelivery({ identity, storage: store, digest, isCurrent: () => current, request: () => hold.promise }); delayed.activate(); const pending = delayed.load(); current = false; delayed.suspend(); hold.resolve(snapshot()); await pending; assert.equal(delayed.getSnapshot().snapshot, null); delayed.dispose();
});
test('newer-tab control intent survives a held acknowledgement, with no further POST', async () => {
 const store = storage(), hold = deferred<unknown>(); let post = 0;
 const model = createTrackingDelivery({ identity, storage: store, digest, uuid: () => 'old', request: async (_p, _b, method) => { if (method === 'POST') { post++; return hold.promise; } return snapshot(); } }); model.activate(); await model.load(); const pending = model.control('reconcile'); await new Promise(resolve => setImmediate(resolve));
 const key = trackingDeliveryJournalKey(identity), replacement = JSON.parse(store.getItem(key)!); replacement.request.clientRequestId = 'new'; replacement.fingerprint = await digest({ protocol: 'tracking-control-v1', request: { ...identity, action: 'reconcile', ...replacement.request } }); const bytes = JSON.stringify(replacement); store.setItem(key, bytes);
 hold.resolve(await receipt({ accountId: identity.accountId, clientRequestId: 'old', expectedRevision: 3 }, 'reconcile', snapshot())); await pending; assert.equal(store.getItem(key), bytes); assert.equal(model.getSnapshot().unknown, true); assert.equal(post, 1); model.dispose();
});
test('definite preaccept refusal clears only that action; transport uncertainty retains it', async () => {
 for (const [status, code, remains] of [[409, 'tracking_delivery_conflict', false], [500, 'internal_error', true]] as const) { const store = storage(); const model = createTrackingDelivery({ identity, storage: store, digest, uuid: () => 'refusal', request: async (_p, _b, method) => { if (method === 'POST') throw new ApiError('synthetic', status, code); return snapshot(); } }); model.activate(); await model.load(); await model.control('reconcile'); assert.equal(store.values.size > 0, remains); assert.equal(model.getSnapshot().unknown, remains); model.dispose(); }
});

const draft = (): Draft => ({ id: 'draft-a', accountId: identity.accountId, to: 'peer@example.test', cc: '', bcc: '', subject: 'Fictional tracking fixture', body: 'Authored body', html: '<p>Authored body</p>', status: 'draft', revision: 1, updatedAt: '2026-10-29T00:00:00.000Z', attachments: [] });
const owner = (op: DraftSendOperation | null = null): DraftSendSnapshot => ({ operation: op, latestGeneration: op?.generation ?? null, draftRevision: 1, contentHash: 'a'.repeat(64), serverNow: '2026-10-29T00:00:00.000Z', canCancel: false, eligibility: { eligible: !op, generation: op ? null : 0, reason: op ? 'locked' : 'ready' }, resolution: { availability: op ? 'locked' : 'available', draftId: 'draft-a' }, ...(op ? { tracking: identity } : { draft: draft() }) });
const held = (attempt: string | null): DraftSendOperation => ({ id: identity.operationId, accountId: identity.accountId, draftId: 'draft-a', generation: 0, mode: 'immediate', scheduledAt: null, clientRequestId: 'send-key', draftRevision: 1, contentHash: 'a'.repeat(64), state: 'held_before_provider', revision: 2, createdAt: '2026-10-29T00:00:00.000Z', startedAt: attempt ? '2026-10-29T00:00:01.000Z' : null, confirmedAt: null, cancellableUntil: '2026-10-29T00:00:10.000Z', cancelledAt: null, deliveryAttemptId: attempt, providerMessageId: null, error: { code: 'tracking_delivery_held', message: 'Held before issue', retry: 'none', providerOutcome: 'not_dispatched' } });
test('generic composer observer accepts provably held states, withholds Undo/Check Sent and preserves an already claimed attempt', async () => {
 for (const attempt of [null, 'attempt-a']) {
  let op = held(attempt); const store = storage(); const calls: string[] = [];
  const model = createComposerSend({ accountId: identity.accountId, draftId: 'draft-a', storage: store, pollMs: 0, sendRequestId: 'send-key', request: async path => { calls.push(path); return owner(op); } }); model.resume(false);
  assert.equal((await model.load())?.operation?.state, 'held_before_provider'); assert.equal(await model.cancel(), null); assert.equal(await model.reconcile(), null);
  if (attempt) { op = { ...op, revision: 3, state: 'sending', error: null }; assert.equal((await model.load())?.operation?.deliveryAttemptId, attempt); op = { ...op, revision: 4, deliveryAttemptId: 'substitute' }; assert.equal(await model.load(), null); assert.equal(model.getSnapshot().response?.operation?.deliveryAttemptId, attempt); }
  assert.ok(calls.every(path => path.includes('/by-request/send-key?'))); model.dispose();
 }
});
test('only documented tracking preaccept409 refusals release the composer Send key', async () => {
 for (const code of ['tracking_mapped_draft_required', 'tracking_rich_html_required', 'tracking_configuration_required', 'tracking_delivery_held']) {
  const store = storage(); let posts = 0; const model = createComposerSend({ accountId: identity.accountId, draftId: 'draft-a', storage: store, pollMs: 0, uuid: () => 'send-key', request: async (_p, _b, method) => { if (method === 'POST') { posts++; throw new ApiError('Synthetic tracking refusal', 409, code); } return owner(); } }); model.resume(false); await model.send(draft());
  assert.equal(posts, 1); assert.equal(model.getSnapshot().unknown, code === 'tracking_delivery_held'); assert.equal([...store.values.keys()].some(k => k.startsWith('reconstruction.composer-send.')), code === 'tracking_delivery_held'); model.dispose();
 }
});
test('a tracking preaccept error code with HTTP500 remains unknown and never releases its Send key', async () => {
 const store = storage(); const model = createComposerSend({ accountId: identity.accountId, draftId: 'draft-a', storage: store, pollMs: 0, uuid: () => 'http500', request: async (_p, _b, method) => { if (method === 'POST') throw new ApiError('Uncertain server failure', 500, 'tracking_mapped_draft_required'); return owner(); } }); model.resume(false);
 await model.send(draft()); assert.equal(model.getSnapshot().unknown, true); assert.equal([...store.values.keys()].some(k => k.startsWith('reconstruction.composer-send.')), true); model.dispose();
});
test('Card Send mapping refusal offers explicit Create/cloud-save/composer guidance while HTTP500 remains unresolved', async () => {
 const preview: AiDraftPreview = { id: 'preview-a', accountId: identity.accountId, sessionId: 'session', turnId: 'turn', kind: 'draft-preview', payloadHash: 'a'.repeat(64), sourceIds: [], createdAt: '2026-10-29T00:00:00.000Z', payload: { to: [{ email: 'peer@example.test' }], cc: [], bcc: [], subject: 'Immutable fictional preview', body: 'Authored fictional body' } };
 for (const status of [409, 500]) {
  const store = storage(), calls: string[] = []; const model = createAiDraftSend({ preview, storage: store, pollMs: 0, uuid: () => 'card-key', request: async (path, _b, method = 'GET') => { calls.push(method + ' ' + path); if (method === 'POST') throw new ApiError('Synthetic mapping refusal', status, 'tracking_mapped_draft_required'); return { preview, operation: null, creation: null, latestGeneration: null, serverNow: '2026-10-29T00:00:00.000Z', canCancel: false, eligibility: { eligible: true, createGeneration: 0, reason: 'ready' } }; } }); model.resume(); await new Promise(resolve => setImmediate(resolve)); await model.send();
  assert.equal(model.getSnapshot().unknown, status === 500); if (status === 409) assert.match(model.getSnapshot().error, /Create Draft.*Synced to Gmail.*composer/); assert.equal(calls.filter(v => v.startsWith('POST')).length, 1); assert.equal(calls.some(v => v.includes('create-draft')), false); assert.deepEqual(model.getSnapshot().preview.payload, preview.payload); model.dispose();
 }
});
