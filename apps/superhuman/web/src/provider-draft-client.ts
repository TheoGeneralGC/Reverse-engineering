import type { ProviderDraftOperation, ProviderDraftReconcileResponse, ProviderDraftSnapshot } from '../../api/src/provider-draft-types.ts';
export type { ProviderDraftOperation, ProviderDraftReconcileResponse, ProviderDraftSnapshot };
export type ProviderDraftScope = { accountId: string; draftId: string };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Surrogate}]/u.test(value);
const nullableId = (value: unknown) => value === null || id(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown) => { try { return typeof value === 'string' && new Date(value).toISOString() === value; } catch { return false; } };
const keys = (value: Record<string, any>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const failure = (): never => { throw new Error('The Gmail draft status could not be verified. Refresh status before sending or discarding.'); };
export function providerStatusEqual(left: unknown, right: unknown): boolean {
  const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}
function checkedError(value: unknown): boolean {
  return value === null || object(value) && keys(value, ['code', 'message', 'retry']) && id(value.code) && typeof value.message === 'string' && value.message.length <= 4000 && ['none', 'explicit-check'].includes(value.retry);
}
function checkedOperation(value: unknown, scope: ProviderDraftScope): ProviderDraftOperation | null {
  if (value === null) return null;
  if (!object(value) || !keys(value, ['id', 'accountId', 'draftId', 'kind', 'state', 'draftRevision', 'contentHash', 'providerDraftId', 'providerMessageId', 'providerThreadId', 'result', 'createdAt', 'issuedAt', 'completedAt', 'resolution', 'error']) || value.accountId !== scope.accountId || value.draftId !== scope.draftId || !id(value.id) || !['create', 'update', 'delete'].includes(value.kind) || !['queued', 'dispatching', 'confirmed', 'unknown', 'failed', 'superseded'].includes(value.state) || !integer(value.draftRevision) || !hash(value.contentHash) || ![value.providerDraftId, value.providerMessageId, value.providerThreadId].every(nullableId) || !timestamp(value.createdAt) || !(value.issuedAt === null || timestamp(value.issuedAt)) || !(value.completedAt === null || timestamp(value.completedAt)) || !['unverified', 'matching-snapshot', 'target-unavailable', 'delivery-consumed'].includes(value.resolution) || !checkedError(value.error)) return failure();
  if (!(value.result === null || object(value.result) && keys(value.result, ['providerDraftId', 'providerMessageId', 'providerThreadId']) && id(value.result.providerDraftId) && id(value.result.providerMessageId) && nullableId(value.result.providerThreadId))) return failure();
  return structuredClone(value) as ProviderDraftOperation;
}
export function checkedProviderDraftSnapshot(value: unknown, scope: ProviderDraftScope): ProviderDraftSnapshot {
  if (!object(value) || !keys(value, ['accountId', 'draftId', 'ownership', 'revision', 'state', 'desiredRevision', 'desiredHash', 'syncedRevision', 'syncedHash', 'providerDraftId', 'providerMessageId', 'providerThreadId', 'operation', 'error', 'deliveryBlocked']) || value.accountId !== scope.accountId || value.draftId !== scope.draftId || !['unmanaged', 'replica-new'].includes(value.ownership) || !integer(value.revision) || !['unmanaged', 'idle', 'queued', 'saving', 'synced', 'blocked', 'outcome_unknown', 'remote_conflict', 'suspended', 'discard_queued', 'discarding', 'discarded', 'consumed'].includes(value.state) || ![value.providerDraftId, value.providerMessageId, value.providerThreadId].every(nullableId) || typeof value.deliveryBlocked !== 'boolean' || !checkedError(value.error)) return failure();
  for (const [revision, identity] of [[value.desiredRevision, value.desiredHash], [value.syncedRevision, value.syncedHash]]) if (!(revision === null && identity === null || integer(revision) && hash(identity))) return failure();
  const operation = checkedOperation(value.operation, scope);
  if (value.ownership === 'unmanaged') {
    if (value.state !== 'unmanaged' || value.revision !== 0 || value.desiredRevision !== null || value.syncedRevision !== null || value.providerDraftId !== null || value.providerMessageId !== null || value.providerThreadId !== null || operation !== null || value.error !== null || value.deliveryBlocked !== false) return failure();
  } else {
    if (value.state === 'unmanaged' || !['idle', 'queued', 'synced'].includes(value.state) && value.deliveryBlocked !== true) return failure();
    if (value.desiredRevision !== null && value.syncedRevision !== null && value.syncedRevision > value.desiredRevision) return failure();
    if (value.state === 'synced' && (value.providerDraftId === null || value.providerMessageId === null || value.desiredRevision === null || value.desiredRevision !== value.syncedRevision || value.desiredHash !== value.syncedHash || !operation || !['create', 'update'].includes(operation.kind) || operation.state !== 'confirmed' || !operation.result || operation.resolution !== 'matching-snapshot' || operation.contentHash !== value.syncedHash || operation.draftRevision > value.syncedRevision || operation.result.providerDraftId !== value.providerDraftId || operation.result.providerMessageId !== value.providerMessageId || operation.result.providerThreadId !== value.providerThreadId)) return failure();
  }
  return { ...structuredClone(value), operation } as ProviderDraftSnapshot;
}
export function checkedProviderDraftStatus(value: unknown, scope: ProviderDraftScope): ProviderDraftSnapshot {
  if (!object(value) || !keys(value, ['providerDraft'])) return failure();
  return checkedProviderDraftSnapshot(value.providerDraft, scope);
}
export function checkedProviderDraftReconcile(value: unknown, scope: ProviderDraftScope, operationId: string | null): ProviderDraftReconcileResponse {
  if (!object(value) || !keys(value, ['providerDraft', 'verification']) || !object(value.verification)) return failure();
  const snapshot = checkedProviderDraftSnapshot(value.providerDraft, scope), verification = value.verification;
  if (!keys(verification, ['operationId', 'matches', 'scanComplete', 'target', 'content', 'issuedOutcome']) || verification.operationId !== operationId || !integer(verification.matches) || typeof verification.scanComplete !== 'boolean' || !['present', 'unavailable', 'unknown'].includes(verification.target) || !['equivalent', 'different', 'unverified'].includes(verification.content) || !['confirmed', 'unknown', 'not-issued'].includes(verification.issuedOutcome) || snapshot.operation?.id !== operationId && !(snapshot.operation === null && operationId === null)) return failure();
  return { providerDraft: snapshot, verification: structuredClone(verification) } as ProviderDraftReconcileResponse;
}
export function checkedProviderDraftAdvance(previous: ProviderDraftSnapshot | null, next: ProviderDraftSnapshot, knownOperations: ReadonlyMap<string, ProviderDraftOperation>): void {
  if (previous) {
    if (next.revision < previous.revision || next.revision === previous.revision && !providerStatusEqual(previous, next) || next.ownership !== previous.ownership || previous.providerDraftId !== null && next.providerDraftId !== previous.providerDraftId) return failure();
    for (const field of ['desired', 'synced'] as const) {
      const beforeRevision = previous[field + 'Revision' as 'desiredRevision' | 'syncedRevision'], afterRevision = next[field + 'Revision' as 'desiredRevision' | 'syncedRevision'];
      if (beforeRevision !== null && afterRevision !== null && (afterRevision < beforeRevision || afterRevision === beforeRevision && previous[field + 'Hash' as 'desiredHash' | 'syncedHash'] !== next[field + 'Hash' as 'desiredHash' | 'syncedHash'])) return failure();
    }
  }
  if (next.operation) {
    const prior = knownOperations.get(next.operation.id);
    if (prior) {
      const immutable = ['id', 'accountId', 'draftId', 'kind', 'draftRevision', 'contentHash', 'providerDraftId', 'providerMessageId', 'providerThreadId', 'createdAt'] as const;
      if (immutable.some(field => !providerStatusEqual(prior[field], next.operation![field])) || prior.result !== null && !providerStatusEqual(prior.result, next.operation.result) || prior.issuedAt !== null && prior.issuedAt !== next.operation.issuedAt || prior.completedAt !== null && prior.completedAt !== next.operation.completedAt) return failure();
    }
  }
}
