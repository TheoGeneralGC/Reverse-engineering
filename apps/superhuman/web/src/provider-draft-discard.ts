import { api, ApiError } from './api.ts';
import { checkedProviderDraftAdvance, checkedProviderDraftSnapshot, providerStatusEqual, type ProviderDraftOperation, type ProviderDraftScope, type ProviderDraftSnapshot } from './provider-draft-client.ts';
import type { ProviderDraftDiscardReceipt, ProviderDraftDiscardRequest, ProviderDraftDiscardResponse } from '../../api/src/provider-draft-types.ts';
import type { ProviderDraftRequest } from './provider-draft-status.ts';

export type ProviderDiscardStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export type ProviderDiscardIdentity = { draftRevision: number; contentHash: string; providerDraft: ProviderDraftSnapshot };
export type ProviderDiscardJournal = { version: 1; draftId: string; request: ProviderDraftDiscardRequest; reviewed: ProviderDraftSnapshot; accepted: ProviderDraftDiscardResponse | null };
export type ProviderDiscardState = {
  request: ProviderDraftDiscardRequest | null; response: ProviderDraftDiscardResponse | null;
  submitting: boolean; checking: boolean; unknown: boolean; blocked: boolean;
  refused: boolean; settled: boolean; released: boolean; error: string;
};
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, any>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Surrogate}]/u.test(value);
const key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown) => { try { return typeof value === 'string' && new Date(value).toISOString() === value; } catch { return false; } };
const invalid = (): never => { throw Error('This discard acknowledgement could not be verified. Keep the draft and check its status.'); };
export const providerDiscardStorageKey = (scope: ProviderDraftScope) => 'reconstruction.provider-discard.v1:' + JSON.stringify([scope.accountId, scope.draftId]);

function checkedRequest(value: unknown, scope: ProviderDraftScope): ProviderDraftDiscardRequest {
  if (!object(value) || !keys(value, ['accountId', 'clientRequestId', 'expectedDraftRevision', 'expectedContentHash', 'expectedSyncRevision']) || value.accountId !== scope.accountId || !key(value.clientRequestId) || !integer(value.expectedDraftRevision) || value.expectedDraftRevision < 1 || !hash(value.expectedContentHash) || !integer(value.expectedSyncRevision)) return invalid();
  return structuredClone(value) as ProviderDraftDiscardRequest;
}
function checkedReceipt(value: unknown, scope: ProviderDraftScope, request: ProviderDraftDiscardRequest): ProviderDraftDiscardReceipt {
  if (!object(value) || !keys(value, ['id', 'accountId', 'draftId', 'clientRequestId', 'operationId', 'draftRevision', 'contentHash', 'acceptedSyncRevision', 'acceptedAt']) || !id(value.id) || !id(value.operationId) || value.accountId !== scope.accountId || value.draftId !== scope.draftId || value.clientRequestId !== request.clientRequestId || value.draftRevision !== request.expectedDraftRevision || value.contentHash !== request.expectedContentHash || value.acceptedSyncRevision !== request.expectedSyncRevision || !timestamp(value.acceptedAt)) return invalid();
  return structuredClone(value) as ProviderDraftDiscardReceipt;
}
export function checkedProviderDiscardResponse(value: unknown, scope: ProviderDraftScope, request: ProviderDraftDiscardRequest, knownReceipt: ProviderDraftDiscardReceipt | null = null): ProviderDraftDiscardResponse {
  if (!object(value) || !keys(value, ['providerDraft', 'receipt', 'resolution']) || !['pending', 'discarded', 'unavailable'].includes(value.resolution)) return invalid();
  const receipt = checkedReceipt(value.receipt, scope, request), providerDraft = checkedProviderDraftSnapshot(value.providerDraft, scope), operation = providerDraft.operation;
  if (knownReceipt && !providerStatusEqual(knownReceipt, receipt) || providerDraft.ownership !== 'replica-new' || providerDraft.revision <= receipt.acceptedSyncRevision || providerDraft.desiredRevision !== receipt.draftRevision || providerDraft.desiredHash !== receipt.contentHash || providerDraft.state === 'consumed') return invalid();
  if (operation?.kind === 'delete' && operation.id !== receipt.operationId) return invalid();
  if (value.resolution === 'pending') {
    if (providerDraft.state === 'discarded' || operation?.kind === 'delete' && !['discard_queued', 'discarding', 'outcome_unknown', 'remote_conflict', 'blocked'].includes(providerDraft.state)) return invalid();
  } else if (providerDraft.state !== 'discarded' || !operation || operation.id !== receipt.operationId || operation.kind !== 'delete' || operation.resolution !== 'target-unavailable' || operation.result !== null || !operation.completedAt || !['confirmed', 'unknown'].includes(operation.state) || value.resolution === 'discarded' && operation.state !== 'confirmed' || value.resolution === 'unavailable' && operation.state === 'confirmed' && !(operation.providerDraftId && operation.issuedAt === null)) return invalid();
  if (value.resolution !== 'pending' && operation) {
    if (operation.providerDraftId !== providerDraft.providerDraftId || operation.providerMessageId !== providerDraft.providerMessageId || operation.providerThreadId !== providerDraft.providerThreadId) return invalid();
    if (providerDraft.providerDraftId !== null) {
      if (!providerDraft.providerMessageId || providerDraft.syncedRevision === null || operation.draftRevision > providerDraft.syncedRevision || operation.contentHash !== providerDraft.syncedHash) return invalid();
    } else if (operation.providerMessageId !== null || operation.providerThreadId !== null || operation.issuedAt !== null || operation.draftRevision !== receipt.draftRevision || operation.contentHash !== receipt.contentHash) return invalid();
  }
  return { providerDraft, receipt, resolution: value.resolution };
}
function checkedJournal(raw: string, scope: ProviderDraftScope): ProviderDiscardJournal {
  if (raw.length > 32768) return invalid();
  const value = JSON.parse(raw);
  if (!object(value) || !keys(value, ['version', 'draftId', 'request', 'reviewed', 'accepted']) || value.version !== 1 || value.draftId !== scope.draftId || !(value.accepted === null || object(value.accepted))) return invalid();
  const request = checkedRequest(value.request, scope);
  const reviewed = checkedProviderDraftSnapshot(value.reviewed, scope);
  if (reviewed.ownership !== 'replica-new' || reviewed.revision !== request.expectedSyncRevision || reviewed.desiredRevision !== request.expectedDraftRevision || reviewed.desiredHash !== request.expectedContentHash || ['suspended', 'discard_queued', 'discarding', 'discarded', 'consumed'].includes(reviewed.state)) return invalid();
  const accepted = value.accepted === null ? null : checkedProviderDiscardResponse(value.accepted, scope, request);
  const operations = new Map<string, ProviderDraftOperation>(); if (reviewed.operation) operations.set(reviewed.operation.id, reviewed.operation);
  if (accepted) checkedProviderDraftAdvance(reviewed, accepted.providerDraft, operations);
  return { version: 1, draftId: scope.draftId, request, reviewed, accepted };
}
const definiteRefusal = (error: unknown) => error instanceof ApiError && (
  error.status === 400 && error.code === 'provider_draft_invalid_request' ||
  error.status === 404 && error.code === 'provider_draft_not_found' ||
  error.status === 409 && ['provider_draft_revision_conflict', 'provider_draft_request_conflict', 'provider_draft_locked'].includes(error.code ?? '') ||
  error.status === 503 && error.code === 'provider_draft_stopping');
const storageDefault = (): ProviderDiscardStorage => {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* A blocked storage context must fail before POST. */ }
  return { getItem() { throw Error('Browser recovery storage is unavailable.'); }, setItem() { throw Error('Browser recovery storage is unavailable.'); }, removeItem() { throw Error('Browser recovery storage is unavailable.'); } };
};
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const scheduleDefault: Schedule = (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); };

export class ProviderDraftDiscardController {
  readonly scope: ProviderDraftScope;
  private request: ProviderDraftRequest; private storage: ProviderDiscardStorage; private makeKey: () => string;
  private isCurrent: () => boolean; private canDiscard: () => boolean; private schedule: Schedule; private pollMs: number; private maxPolls: number;
  private state: ProviderDiscardState = { request: null, response: null, submitting: false, checking: false, unknown: false, blocked: false, refused: false, settled: false, released: false, error: '' };
  private journal: ProviderDiscardJournal | null = null; private stored: string | null = null; private listeners = new Set<() => void>();
  private active = true; private disposed = false; private epoch = 0; private abort?: AbortController; private cancelPoll?: () => void; private polls = 0;
  private knownOperations = new Map<string, ProviderDraftOperation>();
  constructor(options: ProviderDraftScope & { request?: ProviderDraftRequest; storage?: ProviderDiscardStorage; makeKey?: () => string; isCurrent?: () => boolean; canDiscard?: () => boolean; schedule?: Schedule; pollMs?: number; maxPolls?: number }) {
    if (!id(options.accountId) || !id(options.draftId)) throw Error('Invalid discard context.');
    this.scope = Object.freeze({ accountId: options.accountId, draftId: options.draftId }); this.request = options.request ?? api; this.storage = options.storage ?? storageDefault(); this.makeKey = options.makeKey ?? (() => crypto.randomUUID()); this.isCurrent = options.isCurrent ?? (() => true); this.canDiscard = options.canDiscard ?? (() => true); this.schedule = options.schedule ?? scheduleDefault; this.pollMs = options.pollMs ?? 1000; this.maxPolls = options.maxPolls ?? 30;
    try { this.stored = this.storage.getItem(providerDiscardStorageKey(this.scope)); if (this.stored !== null) { this.journal = checkedJournal(this.stored, this.scope); for (const operation of [this.journal.reviewed.operation, this.journal.accepted?.providerDraft.operation]) if (operation) this.knownOperations.set(operation.id, structuredClone(operation)); this.state = { ...this.state, request: this.journal.request, unknown: true, blocked: true }; } }
    catch { this.state = { ...this.state, blocked: true, unknown: true, error: 'Saved discard recovery data is unavailable or invalid. Keep this draft; no discard was retried.' }; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private current() { return this.active && !this.disposed && this.isCurrent(); }
  private emit(next: Partial<ProviderDiscardState>) { if (!this.current()) return; this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private stop() { this.epoch++; this.abort?.abort(); this.cancelPoll?.(); this.cancelPoll = undefined; }
  activate() { if (this.disposed) return; this.active = true; this.stop(); this.emit({ submitting: false, checking: false }); }
  suspend() { this.active = false; this.stop(); }
  dispose() { this.suspend(); this.disposed = true; this.listeners.clear(); }
  private persist(next: ProviderDiscardJournal) {
    const slot = providerDiscardStorageKey(this.scope);
    if (this.storage.getItem(slot) !== this.stored) throw Error('Discard recovery changed in another window. Keep the draft and reload its status.');
    const raw = JSON.stringify(next); this.storage.setItem(slot, raw);
    if (this.storage.getItem(slot) !== raw) throw Error('Discard recovery could not be saved. Keep this draft.');
    this.stored = raw; this.journal = next;
  }
  private clear() {
    const slot = providerDiscardStorageKey(this.scope);
    if (this.storage.getItem(slot) !== this.stored) throw Error('A newer discard recovery record must be preserved.');
    this.storage.removeItem(slot);
    if (this.storage.getItem(slot) !== null) throw Error('Discard recovery could not be cleared safely.');
    this.stored = null; this.journal = null;
  }
  async discard(identity: ProviderDiscardIdentity): Promise<boolean> {
    if (!this.current() || this.state.blocked || this.state.submitting || this.state.settled || this.state.released || this.journal || !this.canDiscard()) return false;
    try {
      const snapshot = checkedProviderDraftSnapshot(identity.providerDraft, this.scope);
      if (snapshot.ownership !== 'replica-new' || ['suspended', 'discard_queued', 'discarding', 'discarded', 'consumed'].includes(snapshot.state) || !integer(identity.draftRevision) || identity.draftRevision < 1 || !hash(identity.contentHash) || snapshot.desiredRevision !== identity.draftRevision || snapshot.desiredHash !== identity.contentHash) throw Error('Save and review this exact local draft before discarding.');
      const request = checkedRequest({ accountId: this.scope.accountId, clientRequestId: this.makeKey(), expectedDraftRevision: identity.draftRevision, expectedContentHash: identity.contentHash, expectedSyncRevision: snapshot.revision }, this.scope);
      this.persist({ version: 1, draftId: this.scope.draftId, request, reviewed: snapshot, accepted: null });
      if (!this.current() || !this.canDiscard()) { this.clear(); return false; }
      this.knownOperations.clear(); if (snapshot.operation) this.knownOperations.set(snapshot.operation.id, structuredClone(snapshot.operation));
      this.stop(); const epoch = this.epoch; this.abort = new AbortController(); this.emit({ request, response: null, submitting: true, blocked: true, unknown: false, refused: false, settled: false, released: false, error: '' });
      try {
        const result = await this.request('/drafts/' + encodeURIComponent(this.scope.draftId) + '/discard-operations', request, 'POST', { signal: this.abort.signal });
        if (!this.current() || epoch !== this.epoch) return false;
        return this.accept(result);
      } catch (error) {
        if (!this.current() || epoch !== this.epoch) return false;
        if (definiteRefusal(error)) {
          this.clear(); this.emit({ request: null, response: null, submitting: false, checking: false, blocked: false, unknown: false, refused: true, error: error instanceof Error ? error.message : 'Discard was not accepted.' });
        } else this.emit({ submitting: false, checking: false, blocked: true, unknown: true, error: error instanceof Error ? error.message : 'Discard is unconfirmed. Keep the draft and check its status.' });
        return false;
      }
    } catch (error) { this.emit({ submitting: false, checking: false, blocked: !!this.journal || this.state.blocked, unknown: !!this.journal || this.state.unknown, error: error instanceof Error ? error.message : 'Discard could not start safely.' }); return false; }
  }
  private accept(value: unknown): boolean {
    if (!this.journal) return false;
    const response = checkedProviderDiscardResponse(value, this.scope, this.journal.request, this.journal.accepted?.receipt ?? null);
    const previous = this.state.response?.providerDraft ?? this.journal.accepted?.providerDraft ?? this.journal.reviewed;
    if (previous && response.providerDraft.revision < previous.revision) { this.emit({ submitting: false, checking: false }); this.poll(); return false; }
    checkedProviderDraftAdvance(previous, response.providerDraft, this.knownOperations);
    const terminal = this.journal.accepted?.resolution !== 'pending' ? this.journal.accepted : null;
    if (terminal && (response.resolution !== terminal.resolution || response.providerDraft.operation?.state !== terminal.providerDraft.operation?.state)) return invalid();
    this.persist({ ...this.journal, accepted: response });
    if (!this.current()) return false;
    if (response.providerDraft.operation) this.knownOperations.set(response.providerDraft.operation.id, structuredClone(response.providerDraft.operation));
    this.emit({ response, submitting: false, checking: false, blocked: true, unknown: false, settled: response.resolution !== 'pending', error: '' }); this.poll(); return true;
  }
  private poll() {
    this.cancelPoll?.(); this.cancelPoll = undefined;
    if (!this.current() || !this.journal || !this.state.response || this.state.settled || this.state.unknown || this.state.submitting || this.state.checking || this.pollMs <= 0 || this.polls >= this.maxPolls) return;
    const epoch = this.epoch; this.cancelPoll = this.schedule(() => { this.cancelPoll = undefined; if (this.current() && epoch === this.epoch) { this.polls++; void this.recover(true); } }, this.pollMs);
  }
  async recover(automatic = false): Promise<boolean> {
    if (!this.current() || !this.journal || this.state.submitting || this.state.checking || this.state.released) return false;
    if (!automatic) this.polls = 0;
    this.stop(); const epoch = this.epoch; this.abort = new AbortController(); const request = this.journal.request; this.emit({ checking: true, error: '' });
    try {
      const result = await this.request('/draft-discard-operations/by-request/' + encodeURIComponent(request.clientRequestId) + '?accountId=' + encodeURIComponent(this.scope.accountId) + '&draftId=' + encodeURIComponent(this.scope.draftId), undefined, 'GET', { signal: this.abort.signal });
      if (!this.current() || epoch !== this.epoch) return false;
      return this.accept(result);
    } catch (error) { if (this.current() && epoch === this.epoch) this.emit({ submitting: false, checking: false, blocked: true, unknown: true, error: error instanceof Error ? error.message : 'Discard status is unconfirmed. No discard was retried.' }); return false; }
  }
  // The host must first verify its account/draft/editor generation and remove
  // only that editor. A receipt/status callback alone never changes authored data.
  releaseTerminal(): boolean {
    if (!this.current() || !this.state.settled || !this.state.response || this.state.response.resolution === 'pending' || !this.journal) return false;
    try { this.clear(); this.stop(); this.emit({ blocked: false, released: true, error: '' }); return true; }
    catch (error) { this.emit({ blocked: true, error: error instanceof Error ? error.message : 'Keep the draft until recovery can be cleared.' }); return false; }
  }
}
