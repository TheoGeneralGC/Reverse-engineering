import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedTrackingDelivery, assertTrackingDeliveryProgress } from '../src/tracking/delivery-client.ts';
const identity = { accountId: 'fixture-a', source: 'composer' as const, operationId: 'owned-send' };
const base = { ...identity, version: 1, policyVersion: 'local-tracking-delivery-v1', generation: 0, draftId: 'owned-draft', revision: 4, decision: { tracked: true, preferenceRevision: 1, reason: 'enabled' }, phase: 'issue_possible', mailOutcome: 'unknown', registration: 'armed', heldReason: null, canReconcile: false, canContinue: false, reads: { availability: 'unavailable', reason: 'event-import-not-integrated', events: [], humanReadVerified: false, namedRecipientIdentity: false } };
test('native issue permit cannot become never-issued or cancellable at a larger revision', () => {
 const old = checkedTrackingDelivery(base, identity);
 for (const outcome of ['unknown', 'issue-possible']) {
  const issued = checkedTrackingDelivery({ ...old, mailOutcome: outcome }, identity);
  const held = checkedTrackingDelivery({ ...old, revision: 5, phase: 'held_before_gmail', mailOutcome: 'not-issued', heldReason: 'collector-unresolved', canContinue: true }, identity);
  assert.throws(() => assertTrackingDeliveryProgress(issued, held));
  const cancelled = checkedTrackingDelivery({ ...old, revision: 5, phase: 'cancelled', mailOutcome: 'not-issued' }, identity);
  assert.throws(() => assertTrackingDeliveryProgress(issued, cancelled));
 }
});
