import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackingDelivery } from '../src/tracking/delivery.ts';
import { ApiError } from '../src/api.ts';
import { digest } from './tracking-fixtures.ts';
const identity = { accountId: 'a', source: 'composer' as const, operationId: 'op' };
const snapshot = { ...identity, version: 1, policyVersion: 'local-tracking-delivery-v1', generation: 0, draftId: 'draft', revision: 1, decision: { tracked: true, preferenceRevision: 1, reason: 'enabled' }, phase: 'held_before_gmail', mailOutcome: 'not-issued', registration: 'create-unknown', heldReason: 'collector-unresolved', canReconcile: true, canContinue: false, reads: { availability: 'unavailable', reason: 'event-import-not-integrated', events: [], humanReadVerified: false, namedRecipientIdentity: false } };
test('positive control receipt cannot be cleared by a later current-status404 or503', async () => {
 for (const [status, code] of [[404, 'tracking_delivery_not_found'], [503, 'tracking_delivery_stopping']] as const) {
  const values = new Map<string, string>(); let accepted = false, posts = 0;
  const model = createTrackingDelivery({ identity, digest, storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }, uuid: () => 'key', request: async (_path, body, method) => {
   if (method === 'POST') { accepted = true; posts++; const request = body as any; return { state: 'accepted', historical: false, snapshot, receipt: { ...identity, id: 'receipt', action: 'reconcile', clientRequestId: request.clientRequestId, expectedRevision: request.expectedRevision, requestProtocol: 'tracking-control-v1', requestFingerprint: await digest({ protocol: 'tracking-control-v1', request: { ...identity, action: 'reconcile', ...request } }), acceptedAt: '2026-10-29T00:00:00.000Z' } }; }
   if (accepted) throw new ApiError('Current status unavailable', status, code); return snapshot;
  } }); model.activate(); await model.load(); await model.control('reconcile');
  assert.equal(values.size, 1, 'Already accepted receipt and key must remain durable'); assert.equal(model.getSnapshot().accepted, true); assert.equal(model.locked, true); await model.control('continue'); assert.equal(posts, 1); model.dispose();
 }
});
