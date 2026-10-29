import { trackingDigest, trackingStable } from './client.ts';
import type { TrackingDigest } from './client.ts';
import type { TrackingDeliveryIdentity, TrackingDeliverySnapshot, TrackingDeliveryControlRequest, TrackingDeliveryControlReceipt, TrackingDeliveryControlResponse } from '../../../api/src/tracking-delivery-types.ts';
export type { TrackingDeliveryIdentity, TrackingDeliverySnapshot, TrackingDeliveryControlRequest, TrackingDeliveryControlReceipt, TrackingDeliveryControlResponse };
export type TrackingControlAction = 'reconcile' | 'continue';
export class TrackingDeliveryValidationError extends Error { constructor() { super('Tracking delivery status could not be verified.'); this.name = 'TrackingDeliveryValidationError'; } }
const fail = (): never => { throw new TrackingDeliveryValidationError(); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, any> => object(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const int = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= 1024 && !/[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(v);
const key = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function checkedTrackingIdentity(raw: unknown): TrackingDeliveryIdentity {
  if (!exact(raw, ['accountId', 'source', 'operationId']) || !id(raw.accountId) || !id(raw.operationId) || !['composer', 'artifact'].includes(raw.source)) return fail();
  return structuredClone(raw) as TrackingDeliveryIdentity;
}
export function sameTrackingIdentity(a: TrackingDeliveryIdentity, b: TrackingDeliveryIdentity) { return a.accountId === b.accountId && a.source === b.source && a.operationId === b.operationId; }
export function checkedOwnerTracking(value: unknown, identity: TrackingDeliveryIdentity, operation: Record<string, any> | null) {
  if (value !== undefined && !sameTrackingIdentity(checkedTrackingIdentity(value), identity)) return fail();
  if (operation?.state === 'held_before_provider' && (value === undefined || operation.providerMessageId !== null || operation.confirmedAt !== null || (operation.startedAt === null) !== (operation.deliveryAttemptId === null) || operation.error?.code !== 'tracking_delivery_held' || operation.error?.retry !== 'none' || operation.error?.providerOutcome !== 'not_dispatched')) return fail();
}
export function checkedTrackingDelivery(raw: unknown, identity: TrackingDeliveryIdentity): TrackingDeliverySnapshot {
  const v = structuredClone(raw); checkedTrackingIdentity(identity);
  if (!exact(v, ['accountId', 'source', 'operationId', 'version', 'policyVersion', 'generation', 'draftId', 'revision', 'decision', 'phase', 'mailOutcome', 'registration', 'heldReason', 'canReconcile', 'canContinue', 'reads']) || !sameTrackingIdentity(v as TrackingDeliveryIdentity, identity) || v.version !== 1 || v.policyVersion !== 'local-tracking-delivery-v1' || !int(v.generation) || !int(v.revision) || !id(v.draftId)) return fail();
  if (!exact(v.decision, ['tracked', 'preferenceRevision', 'reason']) || typeof v.decision.tracked !== 'boolean' || !int(v.decision.preferenceRevision) || !['enabled', 'local-disabled-default', 'account-disabled'].includes(v.decision.reason) || v.decision.tracked !== (v.decision.reason === 'enabled') || v.decision.reason === 'local-disabled-default' && v.decision.preferenceRevision !== 0) return fail();
  if (!['untracked', 'queued', 'preparing', 'held_before_gmail', 'claimed', 'arming', 'ready', 'issue_possible', 'sent_confirmation_pending', 'confirmed', 'cancelled'].includes(v.phase) || !['not-issued', 'issue-possible', 'unknown', 'sent'].includes(v.mailOutcome) || !['inactive', 'create-unknown', 'prepared', 'arm-unknown', 'armed', 'confirmation-unknown', 'confirmed'].includes(v.registration) || ![null, 'configuration-changed', 'preference-disabled', 'collector-unresolved', 'interrupted', 'preflight-refused', 'stopping'].includes(v.heldReason) || typeof v.canReconcile !== 'boolean' || typeof v.canContinue !== 'boolean') return fail();
  if (!exact(v.reads, ['availability', 'reason', 'events', 'humanReadVerified', 'namedRecipientIdentity']) || v.reads.availability !== 'unavailable' || v.reads.reason !== 'event-import-not-integrated' || !Array.isArray(v.reads.events) || v.reads.events.length || v.reads.humanReadVerified !== false || v.reads.namedRecipientIdentity !== false) return fail();
  if (!v.decision.tracked && (!['untracked', 'cancelled'].includes(v.phase) || v.registration !== 'inactive' || v.canReconcile || v.canContinue) || v.decision.tracked && v.phase === 'untracked') return fail();
  if (v.phase === 'held_before_gmail' && (v.mailOutcome !== 'not-issued' || !v.heldReason) || v.canContinue && (!v.decision.tracked || v.phase !== 'held_before_gmail' || v.mailOutcome !== 'not-issued') || v.canReconcile && (!v.decision.tracked || !(v.phase === 'held_before_gmail' || v.mailOutcome === 'sent')) || v.heldReason === 'configuration-changed' && (v.canContinue || v.canReconcile)) return fail();
  if (v.decision.tracked && (['queued', 'preparing', 'held_before_gmail', 'claimed', 'arming', 'ready', 'cancelled'].includes(v.phase) && v.mailOutcome !== 'not-issued' || v.phase === 'issue_possible' && !['issue-possible', 'unknown'].includes(v.mailOutcome))) return fail();
  if (v.decision.tracked && (v.phase === 'confirmed' && (v.registration !== 'confirmed' || v.mailOutcome !== 'sent') || v.mailOutcome === 'sent' && !['sent_confirmation_pending', 'confirmed'].includes(v.phase) || v.phase === 'sent_confirmation_pending' && v.mailOutcome !== 'sent') || v.phase === 'cancelled' && (v.mailOutcome !== 'not-issued' || v.canContinue || v.canReconcile)) return fail();
  return v as TrackingDeliverySnapshot;
}
export function checkedTrackingControlRequest(raw: unknown, identity: TrackingDeliveryIdentity): TrackingDeliveryControlRequest {
  if (!exact(raw, ['accountId', 'clientRequestId', 'expectedRevision']) || raw.accountId !== identity.accountId || !key(raw.clientRequestId) || !int(raw.expectedRevision)) return fail();
  return structuredClone(raw) as TrackingDeliveryControlRequest;
}
export async function trackingControlFingerprint(identity: TrackingDeliveryIdentity, action: TrackingControlAction, request: TrackingDeliveryControlRequest, digest: TrackingDigest = trackingDigest) {
  return digest({ protocol: 'tracking-control-v1', request: { ...checkedTrackingIdentity(identity), action, ...checkedTrackingControlRequest(request, identity) } });
}
export async function checkedTrackingControl(raw: unknown, identity: TrackingDeliveryIdentity, action: TrackingControlAction, intent: TrackingDeliveryControlRequest, digest: TrackingDigest = trackingDigest): Promise<TrackingDeliveryControlResponse> {
  const v = structuredClone(raw), scope = checkedTrackingIdentity(structuredClone(identity)), request = checkedTrackingControlRequest(structuredClone(intent), scope);
  if (!exact(v, ['state', 'receipt', 'snapshot', 'historical']) || !['accepted', 'completed'].includes(v.state) || typeof v.historical !== 'boolean') return fail();
  const snapshot = checkedTrackingDelivery(v.snapshot, scope), r = v.receipt;
  if (!exact(r, ['id', 'accountId', 'source', 'operationId', 'clientRequestId', 'action', 'expectedRevision', 'requestProtocol', 'requestFingerprint', 'acceptedAt']) || !sameTrackingIdentity(r as TrackingDeliveryIdentity, scope) || !id(r.id) || r.clientRequestId !== request.clientRequestId || r.action !== action || r.expectedRevision !== request.expectedRevision || r.requestProtocol !== 'tracking-control-v1' || !sha(r.requestFingerprint) || !time(r.acceptedAt) || v.state === 'accepted' && snapshot.revision !== request.expectedRevision || v.state === 'completed' && snapshot.revision < request.expectedRevision) return fail();
  if (r.requestFingerprint !== await trackingControlFingerprint(scope, action, request, digest)) return fail();
  return { state: v.state, receipt: r as TrackingDeliveryControlReceipt, snapshot, historical: v.historical };
}
/** Positive identity and terminal phases are immutable; dynamic availability may change at the same revision. */
export function assertTrackingDeliveryProgress(old: TrackingDeliverySnapshot, next: TrackingDeliverySnapshot) {
  if (!sameTrackingIdentity(old, next) || old.draftId !== next.draftId || old.generation !== next.generation || trackingStable(old.decision) !== trackingStable(next.decision)) return fail();
  if (next.revision < old.revision) return false;
  if (['issue-possible', 'unknown'].includes(old.mailOutcome) && next.mailOutcome === 'not-issued') return fail();
  if (next.revision === old.revision && ['phase', 'mailOutcome', 'registration'].some(k => old[k as keyof typeof old] !== next[k as keyof typeof next])) return fail();
  if (['confirmed', 'cancelled'].includes(old.phase) && next.phase !== old.phase || old.mailOutcome === 'sent' && next.mailOutcome !== 'sent') return fail();
  return true;
}
