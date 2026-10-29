// Local Gmail autosave contract for new replica-owned drafts only. These types
// do not claim the original private transport or cross-client CAS semantics.
export type ProviderDraftOwnership = 'unmanaged' | 'replica-new';
export type ProviderDraftState = 'unmanaged' | 'idle' | 'queued' | 'saving' | 'synced' | 'blocked' | 'outcome_unknown' | 'remote_conflict' | 'suspended' | 'discard_queued' | 'discarding' | 'discarded' | 'consumed';
export type ProviderDraftOperationKind = 'create' | 'update' | 'delete';
export type ProviderDraftOperationState = 'queued' | 'dispatching' | 'confirmed' | 'unknown' | 'failed' | 'superseded';
export type ProviderDraftError = { code: string; message: string; retry: 'none' | 'explicit-check' };
export type ProviderDraftOperation = {
  id: string; accountId: string; draftId: string;
  kind: ProviderDraftOperationKind; state: ProviderDraftOperationState;
  draftRevision: number; contentHash: string;
  providerDraftId: string | null; providerMessageId: string | null;
  providerThreadId: string | null;
  // Above IDs are immutable pre-write expectations, not late ACK replacements.
  result: { providerDraftId: string; providerMessageId: string; providerThreadId: string | null } | null;
  createdAt: string; issuedAt: string | null; completedAt: string | null;
  // Absence can settle an owned discard without claiming our DELETE executed.
  resolution: 'unverified' | 'matching-snapshot' | 'target-unavailable' | 'delivery-consumed';
  error: ProviderDraftError | null;
};
export type ProviderDraftSnapshot = {
  accountId: string; draftId: string; ownership: ProviderDraftOwnership;
  revision: number; state: ProviderDraftState;
  desiredRevision: number | null; desiredHash: string | null;
  syncedRevision: number | null; syncedHash: string | null;
  providerDraftId: string | null; providerMessageId: string | null;
  providerThreadId: string | null;
  operation: ProviderDraftOperation | null;
  error: ProviderDraftError | null;
  deliveryBlocked: boolean;
  // No body/MIME/attachment bytes, tokens or ownership nonce are exposed.
};
export type ProviderDraftStatusResponse = { providerDraft: ProviderDraftSnapshot };
export type ProviderDraftReconcileRequest = { accountId: string; expectedSyncRevision: number };
export type ProviderDraftReconciliation = {
  operationId: string | null; matches: number; scanComplete: boolean;
  target: 'present' | 'unavailable' | 'unknown';
  content: 'equivalent' | 'different' | 'unverified';
  issuedOutcome: 'confirmed' | 'unknown' | 'not-issued';
};
export type ProviderDraftReconcileResponse = ProviderDraftStatusResponse & { verification: ProviderDraftReconciliation };
export type ProviderDraftDiscardRequest = {
  accountId: string; clientRequestId: string;
  expectedDraftRevision: number; expectedContentHash: string;
  expectedSyncRevision: number;
};
export type ProviderDraftDiscardReceipt = {
  id: string; accountId: string; draftId: string; clientRequestId: string;
  operationId: string | null;
  draftRevision: number; contentHash: string; acceptedSyncRevision: number;
  acceptedAt: string;
};
export type ProviderDraftDiscardResponse = ProviderDraftStatusResponse & {
  receipt: ProviderDraftDiscardReceipt;
  resolution: 'pending' | 'discarded' | 'unavailable';
};
