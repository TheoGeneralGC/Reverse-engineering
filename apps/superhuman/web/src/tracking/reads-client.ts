import { TRACKING_READ_POLICY, TRACKING_READ_BOUNDS } from '../../../api/src/tracking-read-types.ts';
import type { TrackingReadView, TrackingReadSnapshot, TrackingReadCoverage, TrackingReadMessage, TrackingReadEvent, TrackingReadFeed, TrackingReadMessageStatus, TrackingReadRefreshRequest, TrackingReadRefreshResponse, TrackingReadTarget, TrackingReadError } from '../../../api/src/tracking-read-types.ts';
import { trackingDigest, trackingStable } from './client.ts';
import type { TrackingDigest } from './client.ts';
export type { TrackingReadView, TrackingReadSnapshot, TrackingReadCoverage, TrackingReadMessage, TrackingReadEvent, TrackingReadFeed, TrackingReadMessageStatus, TrackingReadRefreshRequest, TrackingReadRefreshResponse, TrackingReadTarget };
export class ReadValidationError extends Error { constructor() { super('Read activity could not be verified.'); this.name = 'ReadValidationError'; } }
const fail = (): never => { throw new ReadValidationError(); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, any> => object(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const int = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const bounded = (v: unknown, max: number): v is number => int(v) && v <= max;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && new TextEncoder().encode(v).length <= max && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(v);
const account = (v: unknown): v is string => text(v, 1024) && v.length > 0 && !/\s/u.test(v);
export const readRef = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const readHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const key = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const cursor = (v: unknown) => v === null || typeof v === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(v);
const reasons = ['not-configured', 'preference-disabled', 'no-eligible-messages', 'configuration-changed', 'binding-limit', 'basis-unverifiable', 'not-refreshed'];
const states = ['completed', 'failed', 'interrupted'];
function readError(v: unknown): TrackingReadError {
  if (!exact(v, ['code', 'message', 'retry']) || !['tracking_read_failed', 'tracking_read_stale', 'tracking_read_limit', 'tracking_read_corrupt', 'tracking_read_interrupted', 'tracking_read_superseded', 'tracking_read_disabled', 'tracking_read_configuration_changed'].includes(v.code) || !text(v.message, 2048) || v.retry !== 'explicit-refresh') return fail();
  return structuredClone(v) as TrackingReadError;
}
export function checkedReadCoverage(v: unknown): TrackingReadCoverage {
  if (!exact(v, ['completeSnapshot', 'fullMailbox', 'humanReadVerified', 'namedRecipientIdentity', 'pages', 'observedEvents', 'retainedResponseBytes', 'bounds', 'cumulativeThrottled']) || v.completeSnapshot !== true || v.fullMailbox !== false || v.humanReadVerified !== false || v.namedRecipientIdentity !== false || !bounded(v.pages, 50) || v.pages < 1 || !bounded(v.observedEvents, 5000) || !bounded(v.retainedResponseBytes, 8388608) || trackingStable(v.bounds) !== trackingStable(TRACKING_READ_BOUNDS) || !exact(v.cumulativeThrottled, ['value', 'sampledAt', 'basisDigest']) || !int(v.cumulativeThrottled.value) || !time(v.cumulativeThrottled.sampledAt) || !readHash(v.cumulativeThrottled.basisDigest)) return fail();
  return structuredClone(v) as TrackingReadCoverage;
}
export function checkedReadSnapshot(v: unknown): TrackingReadSnapshot {
  if (!exact(v, ['snapshotRef', 'revision', 'acceptedAt', 'basisDigest', 'events', 'messages', 'coverage']) || !readRef(v.snapshotRef) || !int(v.revision) || !time(v.acceptedAt) || !readHash(v.basisDigest) || !bounded(v.events, TRACKING_READ_BOUNDS.maxEvents) || !bounded(v.messages, TRACKING_READ_BOUNDS.maxBindings)) return fail();
  const coverage = checkedReadCoverage(v.coverage); if (coverage.observedEvents !== v.events || coverage.cumulativeThrottled.basisDigest !== v.basisDigest) return fail(); return structuredClone(v) as TrackingReadSnapshot;
}
export function checkedReadView(raw: unknown, accountId: string): TrackingReadView {
  const v = structuredClone(raw);
  if (!account(accountId) || !exact(v, ['version', 'policyVersion', 'accountId', 'revision', 'contextVersion', 'snapshot', 'cache', 'refresh', 'effectiveReadStatuses', 'effectiveRecentOpens', 'hostingVerified']) || v.version !== 1 || v.policyVersion !== TRACKING_READ_POLICY || v.accountId !== accountId || !int(v.revision) || !readHash(v.contextVersion) || v.effectiveReadStatuses !== false || v.effectiveRecentOpens !== false || v.hostingVerified !== false) return fail();
  if (v.snapshot !== null) { const s = checkedReadSnapshot(v.snapshot); if (s.revision > v.revision) return fail(); }
  if (!exact(v.cache, ['availability', 'events', 'messages', 'freshness']) || !['none', 'retained'].includes(v.cache.availability) || !int(v.cache.events) || !int(v.cache.messages) || !['not-refreshed', 'current', 'stale-basis', 'stale-configuration', 'preference-disabled'].includes(v.cache.freshness) || v.cache.availability === 'none' && (v.cache.events !== 0 || v.cache.messages !== 0)) return fail();
  const r = v.refresh;
  if (!exact(r, ['allowed', 'reason', 'basisDigest', 'active', 'lastResult']) || typeof r.allowed !== 'boolean' || r.reason !== null && !reasons.includes(r.reason) || r.basisDigest !== null && !readHash(r.basisDigest) || r.allowed && (r.basisDigest === null || r.reason !== null)) return fail();
  if (r.active !== null && (!exact(r.active, ['requestRef', 'acceptedAt']) || !readRef(r.active.requestRef) || !time(r.active.acceptedAt))) return fail();
  if (r.lastResult !== null) { const last = r.lastResult; if (!exact(last, ['requestRef', 'state', 'finishedAt', 'error']) || !readRef(last.requestRef) || !states.includes(last.state) || !time(last.finishedAt) || last.state === 'completed' && last.error !== null || last.state !== 'completed' && last.error === null) return fail(); if (last.error !== null) readError(last.error); }
  if (v.revision === 0 && (v.snapshot !== null || v.cache.availability !== 'none' || r.active !== null || r.lastResult !== null)) return fail();
  return v as TrackingReadView;
}
export function checkedReadMessage(v: unknown): TrackingReadMessage {
  if (!exact(v, ['messageRef', 'generation', 'subject', 'snapshotCoverage', 'availability', 'targetRef', 'targetVersion', 'evidence', 'viewer', 'humanReadVerified', 'namedRecipientIdentity', 'state', 'retainedEvents', 'lastObservedAt']) || !readRef(v.messageRef) || !int(v.generation) || v.subject !== null && !text(v.subject, 16384) || !['available', 'waiting-for-message', 'unavailable'].includes(v.availability) || v.targetRef !== null && !readRef(v.targetRef) || v.targetVersion !== null && !readHash(v.targetVersion) || v.evidence !== 'image-fetch' || v.viewer !== null || v.humanReadVerified !== false || v.namedRecipientIdentity !== false || !['image-fetch-observed', 'no-direct-evidence'].includes(v.state) || !int(v.retainedEvents) || v.lastObservedAt !== null && !time(v.lastObservedAt)) return fail();
  if (v.availability === 'available' ? !v.targetRef || !v.targetVersion : v.targetRef !== null || v.targetVersion !== null) return fail();
  if (v.state === 'no-direct-evidence' ? v.retainedEvents !== 0 || v.lastObservedAt !== null : v.retainedEvents === 0 || v.lastObservedAt === null) return fail();
  if (v.snapshotCoverage !== null && (!exact(v.snapshotCoverage, ['snapshotRef', 'revision', 'basisDigest', 'completeSnapshot']) || !readRef(v.snapshotCoverage.snapshotRef) || !int(v.snapshotCoverage.revision) || !readHash(v.snapshotCoverage.basisDigest) || v.snapshotCoverage.completeSnapshot !== true)) return fail();
  return structuredClone(v) as TrackingReadMessage;
}
export function checkedReadEvent(v: unknown): TrackingReadEvent {
  if (!exact(v, ['eventRef', 'messageRef', 'generation', 'observedAt', 'device', 'proxy', 'viewer', 'evidence']) || !readRef(v.eventRef) || !readRef(v.messageRef) || !int(v.generation) || !time(v.observedAt) || !['desktop', 'mobile', 'unknown'].includes(v.device) || !['google-proxy', 'possible-apple-proxy', 'unknown'].includes(v.proxy) || v.viewer !== null || v.evidence !== 'image-fetch') return fail();
  return structuredClone(v) as TrackingReadEvent;
}
function page(v: Record<string, any>, accountId: string, limit: number) {
  if (v.accountId !== accountId || v.policyVersion !== TRACKING_READ_POLICY || !int(v.revision) || !readHash(v.contextVersion) || !cursor(v.nextCursor) || !Array.isArray(v.events) || v.events.length > limit || v.coverage !== null && !object(v.coverage)) return fail();
  if (v.events.length > 0 && v.coverage === null) return fail();
  if (v.coverage !== null) checkedReadCoverage(v.coverage);
  const events = v.events.map(checkedReadEvent), seen = new Set<string>();
  for (const e of events) { if (seen.has(e.eventRef)) return fail(); seen.add(e.eventRef); }
  return events;
}
export function checkedReadFeed(raw: unknown, accountId: string, limit = 50): TrackingReadFeed {
  const v = structuredClone(raw);
  if (!exact(v, ['accountId', 'policyVersion', 'revision', 'contextVersion', 'snapshotRef', 'availability', 'reason', 'events', 'messages', 'nextCursor', 'coverage']) || !bounded(limit, 100) || limit < 1 || v.snapshotRef !== null && !readRef(v.snapshotRef) || !['unavailable', 'empty', 'cached'].includes(v.availability) || v.reason !== null && !reasons.includes(v.reason) || !Array.isArray(v.messages) || v.messages.length > 100) return fail();
  const events = page(v, accountId, limit), messages = v.messages.map(checkedReadMessage), byRef = new Map(messages.map(m => [m.messageRef, m])); if (byRef.size !== messages.length || messages.some(m => m.snapshotCoverage !== null && (m.snapshotCoverage.snapshotRef !== v.snapshotRef || m.snapshotCoverage.revision > v.revision || m.snapshotCoverage.basisDigest !== v.coverage?.cumulativeThrottled.basisDigest))) return fail();
  for (const e of events) { const m = byRef.get(e.messageRef); if (!m || e.generation !== m.generation || m.lastObservedAt === null || e.observedAt > m.lastObservedAt) return fail(); }
  if (v.availability === 'empty' && events.length > 0 || v.snapshotRef === null && v.coverage !== null) return fail();
  return v as TrackingReadFeed;
}
export function checkedReadMessageStatus(raw: unknown, accountId: string, messageRef: string, limit = 50): TrackingReadMessageStatus {
  const v = structuredClone(raw);
  if (!readRef(messageRef) || !exact(v, ['accountId', 'policyVersion', 'revision', 'contextVersion', 'message', 'events', 'nextCursor', 'coverage'])) return fail();
  const events = page(v, accountId, limit), m = checkedReadMessage(v.message); if (m.messageRef !== messageRef || m.snapshotCoverage !== null && (m.snapshotCoverage.revision > v.revision || m.snapshotCoverage.basisDigest !== v.coverage?.cumulativeThrottled.basisDigest) || events.some(e => e.messageRef !== messageRef || e.generation !== m.generation || m.lastObservedAt === null || e.observedAt > m.lastObservedAt)) return fail();
  return v as TrackingReadMessageStatus;
}
export function checkedReadRequest(raw: unknown, accountId: string): TrackingReadRefreshRequest {
  if (!exact(raw, ['accountId', 'clientRequestId', 'expectedRevision', 'expectedBasisDigest']) || raw.accountId !== accountId || !account(accountId) || !key(raw.clientRequestId) || !int(raw.expectedRevision) || raw.expectedRevision >= Number.MAX_SAFE_INTEGER || !readHash(raw.expectedBasisDigest)) return fail();
  return structuredClone(raw) as TrackingReadRefreshRequest;
}
export async function readRequestFingerprint(request: TrackingReadRefreshRequest, digest: TrackingDigest = trackingDigest) { const value = checkedReadRequest(structuredClone(request), request.accountId); return digest({ protocol: 'tracking-read-refresh-v1', request: value }); }
export async function checkedReadRefresh(raw: unknown, intent: TrackingReadRefreshRequest, digest: TrackingDigest = trackingDigest): Promise<TrackingReadRefreshResponse> {
  const v = structuredClone(raw), request = checkedReadRequest(structuredClone(intent), intent.accountId);
  if (!exact(v, ['receipt', 'state', 'accepted', 'result', 'historical']) || !['accepted', ...states].includes(v.state) || typeof v.historical !== 'boolean') return fail();
  const r = v.receipt, a = v.accepted;
  if (!exact(r, ['id', 'accountId', 'clientRequestId', 'requestProtocol', 'requestFingerprint', 'request', 'priorRevision', 'acceptedRevision', 'acceptedAt', 'basisDigest', 'bounds']) || !readRef(r.id) || r.accountId !== request.accountId || r.clientRequestId !== request.clientRequestId || r.requestProtocol !== 'tracking-read-refresh-v1' || !readHash(r.requestFingerprint) || trackingStable(r.request) !== trackingStable(request) || r.priorRevision !== request.expectedRevision || r.acceptedRevision !== request.expectedRevision + 1 || !time(r.acceptedAt) || r.basisDigest !== request.expectedBasisDigest || trackingStable(r.bounds) !== trackingStable(TRACKING_READ_BOUNDS)) return fail();
  if (!exact(a, ['revision', 'contextVersion', 'previousSnapshotRef']) || a.revision !== r.acceptedRevision || !readHash(a.contextVersion) || a.previousSnapshotRef !== null && !readRef(a.previousSnapshotRef)) return fail();
  if (v.state === 'accepted' ? v.result !== null : !exact(v.result, ['state', 'finishedAt', 'revision', 'snapshot', 'error'])) return fail();
  if (v.result !== null) { const result = v.result; if (result.state !== v.state || !time(result.finishedAt) || !int(result.revision) || result.revision <= a.revision || result.finishedAt < r.acceptedAt || result.state === 'completed' && result.error !== null || result.state !== 'completed' && result.error === null) return fail(); if (result.error !== null) readError(result.error); if (result.state !== 'completed' && result.snapshot !== null) return fail(); if (result.snapshot !== null) { const s = checkedReadSnapshot(result.snapshot); if (s.revision > result.revision || result.state === 'completed' && (s.revision !== result.revision || s.basisDigest !== r.basisDigest || s.acceptedAt !== result.finishedAt)) return fail(); } else if (result.state === 'completed') return fail(); }
  if (r.requestFingerprint !== await readRequestFingerprint(request, digest)) return fail();
  return v as TrackingReadRefreshResponse;
}
export function checkedReadTarget(raw: unknown, accountId: string, targetRef: string, revision: number, targetVersion: string): TrackingReadTarget {
  const v = structuredClone(raw);
  if (!exact(v, ['accountId', 'targetRef', 'targetVersion', 'revision', 'availability', 'target']) || v.accountId !== accountId || v.targetRef !== targetRef || !readRef(targetRef) || !readHash(v.targetVersion) || !int(v.revision) || !['available', 'waiting-for-message', 'unavailable', 'stale'].includes(v.availability)) return fail();
  if (v.availability === 'available') { if (v.revision !== revision || v.targetVersion !== targetVersion || !exact(v.target, ['kind', 'accountId', 'threadId', 'messageId']) || v.target.kind !== 'mail' || v.target.accountId !== accountId || !account(v.target.threadId) || !account(v.target.messageId)) return fail(); }
  else if (v.target !== null) return fail();
  return v as TrackingReadTarget;
}
