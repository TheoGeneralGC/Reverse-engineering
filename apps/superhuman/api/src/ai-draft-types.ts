// Browser-safe structured preview/action contracts. No model or provider effects.
import type { Draft } from './types.ts';

export type AiDraftMailbox = { email: string; name?: string };
export type AiDraftPayload = { to: AiDraftMailbox[]; cc: AiDraftMailbox[]; bcc: AiDraftMailbox[]; subject: string; body: string; html?: string };
export type AiDraftPreview = {
  id: string; accountId: string; sessionId: string; turnId: string;
  kind: 'draft-preview'; payload: AiDraftPayload; payloadHash: string;
  sourceIds: string[]; createdAt: string;
};
export type AiDraftCreation = {
  id: string; accountId: string; sessionId: string; turnId: string; previewId: string;
  payloadHash: string; draftId: string; generation: number; createdAt: string;
};
export type AiDraftActionReceipt = {
  id: string; clientRequestId: string; accountId: string; sessionId: string; turnId: string;
  previewId: string; creationId: string; generation: number; createdAt: string;
};
export type AiDraftResolution = { availability: 'available' | 'unavailable' | 'locked'; draftId: string | null };
export type AiDraftCreateRequest = { accountId: string; sessionId: string; turnId: string; clientRequestId: string; expectedPreviewHash: string; expectedGeneration: number };
export type AiDraftScope = { accountId: string; sessionId: string; turnId: string };
export type AiDraftResponse = {
  preview: AiDraftPreview; creation: AiDraftCreation | null; request: AiDraftActionReceipt | null;
  resolution: AiDraftResolution; createGeneration: number | null; draft?: Draft;
};
