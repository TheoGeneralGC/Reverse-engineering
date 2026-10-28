// Browser-safe explicit Send contract. Model proposals never invoke these routes.
import type { Draft } from './types.ts';
import type { AiDraftPreview, AiDraftCreation, AiDraftResolution } from './ai-draft-types.ts';
export type AiDraftSendState = 'queued' | 'sending' | 'sent' | 'not_dispatched' | 'outcome_unknown' | 'cancelled';
export type AiDraftSendOperation = {
  id: string; accountId: string; sessionId: string; turnId: string; previewId: string;
  generation: number; creationId: string; draftId: string; clientRequestId: string; payloadHash: string;
  state: AiDraftSendState; revision: number; createdAt: string; startedAt: string | null; confirmedAt: string | null;
  deliveryAttemptId: string | null; providerMessageId: string | null;
  originalCancellableUntil?:string; accelerationId?:string; acceleratedAt?:string; cancellableUntil: string; cancelledAt: string | null; cancelledFromRevision?: number;
  error: null | { code: string; message: string; retry: 'none'; providerOutcome: 'not_dispatched' | 'unknown' | 'confirmed' };
};
export type AiDraftSendRequest = { accountId: string; sessionId: string; turnId: string; clientRequestId: string; expectedPreviewHash: string; expectedGeneration: number };
export type AiDraftSendEligibility = { eligible: boolean; createGeneration: number | null; reason: string };
export type AiDraftSendSnapshot = { preview: AiDraftPreview; creation: AiDraftCreation | null; operation: AiDraftSendOperation | null; eligibility: AiDraftSendEligibility; serverNow: string; canCancel: boolean; latestGeneration: number | null; restoredResolution?: AiDraftResolution; restoredDraft?: Draft };

export type AiDraftSendCancelRequest = { accountId: string; sessionId: string; turnId: string; clientRequestId: string; expectedRevision: number };
export type AiDraftSendCancellation = { id: string; operationId: string; accountId: string; sessionId: string; turnId: string; clientRequestId: string; createdAt: string };
export type AiDraftSendCancelResponse = AiDraftSendSnapshot & { cancellation: AiDraftSendCancellation };
