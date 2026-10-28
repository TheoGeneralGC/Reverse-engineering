// Browser-safe persistent Ask AI contracts. See research/ai-chat-contract.md.
import type { AiDraftPreview } from './ai-draft-types.ts';
export type AiResource = 'mail' | 'calendar';
export type AiTurnState = 'queued' | 'running' | 'cancel_requested'
  | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'outcome_unknown';
export type AiPhase = 'queued' | 'connecting' | 'thinking' | 'retrieving'
  | 'responding' | 'stopping' | 'finished';

export type AiChatSubmit = {
  accountId: string;
  clientRequestId: string;
  expectedRevision: number; // Session history/order revision, not stream revision.
  prompt: string;
  context: {
    selectedThreadId?: string;
    resources: AiResource[]; // Unique values. [] permits no new search tools.
  };
  retryOfTurnId?: string; // Explicit new generation, same account/session only.
};

export type AiChatSession = {
  id: string; accountId: string; title: string;
  createdAt: string; updatedAt: string; revision: number;
  turnCount: number; activeTurnId: string | null;
};

export type AiChatTurn = {
  id: string; sessionId: string; accountId: string; seq: number;
  clientRequestId: string; retryOfTurnId?: string;
  prompt: string; context: AiChatSubmit['context'];
  state: AiTurnState; phase: AiPhase; revision: number; lastEventSeq: number;
  createdAt: string; startedAt?: string; finishedAt?: string; deadlineAt?: string;
  provider: 'anthropic'; model: string;
  providerRequestIds: string[]; // Actual returned IDs only; absent ≠ undispatched.
  dispatchCount: number; // Persisted before each upstream request.
  partial: { markdown: string; thinkingSummary: string | null };
  answer: AiChatAnswer | null; // Only completed turns have an answer.
  sources: AiSourceReceipt[];
  previews?: AiDraftPreview[]; // Completed server-validated artifacts; absent on legacy turns.
  usage: { inputTokens: number | null; outputTokens: number | null };
  limits: AiTurnLimits; coverage: AiCoverage[];
  error: AiChatError | null;
  cancellation: {
    requestedAt: string | null;
    localStoppedAt: string | null;
    providerOutcome: 'not_dispatched' | 'response_observed' | 'unknown';
  };
};

export type AiSourceTarget =
  | { kind: 'mail'; accountId: string; threadId: string; messageIds: string[] }
  | { kind: 'calendar'; accountId: string; calendarId: string; eventId: string };

export type AiSourceReceipt = {
  id: string; accountId: string; sessionId: string; turnId: string;
  number: number; // Positive server-assigned display number, local to this turn.
  target: AiSourceTarget;
  basis: 'selected-thread' | 'mail-summary' | 'mail-text' | 'calendar-cache';
  label: string; secondaryLabel: string; excerpt: string;
  snapshotHash: string; fetchedAt: string;
  sourceVersion?: string;
  sourceUpdatedAt: string | null;
  truncated: boolean; partial: boolean;
};

export type AiSourceResolution = {
  availability: 'available' | 'changed' | 'unavailable';
  target: AiSourceTarget | null; // Never a model-selected/arbitrary URL.
};
export type AiChatAnswer = {
  markdown: string; plainText: string;
  citations: { number: number; sourceId: string }[];
  sourceIds: string[];
  finishReason: 'end_turn';
  truncated: boolean; // True if retrieval/history coverage was bounded/partial.
};

export type AiCoverage = {
  resource: AiResource;
  scope: 'local-imported' | 'local-cache';
  status: 'complete-local-snapshot' | 'partial' | 'unavailable';
  lastUpdatedAt: string | null;
  indexedRecords?: number;
  pendingRecords?: number;
  errorRecords?: number;
  range?: { timeMin: string; timeMax: string; timeZone: string };
  reasons: string[]; // Typed allowlist in implementation, no raw provider error.
};

export type AiTurnLimits = {
  providerRounds: number; toolCalls: number; summaryHits: number;
  fullThreadReads: number; contextBytes: number; outputTokens: number;
  exhausted: string[];
};
export type AiChatStatus = {
  implemented: boolean; configured: boolean; provider: 'anthropic';
  model: string | null; missing: string[];
  capabilities: ('persistent-chat' | 'streaming' | 'local-mail-retrieval'
    | 'cached-calendar-retrieval' | 'source-citations' | 'cancel' | 'draft-preview' | 'create-local-draft' | 'send-artifact' | 'undo-artifact-send')[];
  policyVersion: string; coverage: AiCoverage[]; limitations: string[];
};

export type AiProgressPayload =
  | { kind: 'state'; state: AiTurnState; phase: AiPhase }
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking'; state: 'started' | 'finished' }
  | { kind: 'thinking_summary_delta'; text: string }
  | { kind: 'tool'; callId: string;
      tool: 'mail_search' | 'mail_read' | 'calendar_cache_search' | 'propose_email_draft';
      state: 'started' | 'completed' | 'failed'; resultCount?: number;
      errorCode?: string }
  | { kind: 'source'; source: AiSourceReceipt }
  | { kind: 'preview'; preview: AiDraftPreview }
  | { kind: 'limit'; name: string }
  | { kind: 'terminal'; state: AiTurnState; revision: number };
export type AiChatEvent = {
  accountId: string; sessionId: string; turnId: string;
  seq: number; revision: number; createdAt: string;
  payload: AiProgressPayload;
};
export type AiChatError = {
  code: string; message: string;
  retry: 'none' | 'explicit-new-turn';
  providerOutcome: 'not_dispatched' | 'response_observed' | 'unknown';
};
// Immediate HTTP failure before turn acceptance uses the existing API envelope:
export type AiChatHttpError = { error: { message: string; code: string } }; // Existing API envelope.

export type AiSessionPage = { sessions: AiChatSession[]; nextCursor: string | null; hasMore: boolean };
export type AiSessionDetail = { session: AiChatSession; turns: AiChatTurn[]; nextBeforeSeq: number | null; hasMore: boolean };
export type AiTurnResponse = { session: AiChatSession; turn: AiChatTurn };
export type AiEventPage = { events: AiChatEvent[]; nextSeq: number; hasMore: boolean; turnRevision: number; terminal: boolean };
export type AiSourceResponse = { source: AiSourceReceipt; resolution: AiSourceResolution };
