import { api } from './api.ts';
import { checkedProviderDraftAdvance, checkedProviderDraftReconcile, checkedProviderDraftSnapshot, checkedProviderDraftStatus, type ProviderDraftOperation, type ProviderDraftScope, type ProviderDraftSnapshot } from './provider-draft-client.ts';
import type { ProviderDraftReconciliation } from '../../api/src/provider-draft-types.ts';
export type ProviderDraftRequest = (path: string, body?: unknown, method?: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
export type ProviderDraftStatusState = {
  snapshot: ProviderDraftSnapshot | null; verification: ProviderDraftReconciliation | null;
  localRevision: number | null; localDirty: boolean; editVersion: number; localError: string;
  loading: boolean; checking: boolean; readUnavailable: boolean; error: string;
};
export type ProviderDraftPresentation = { localLabel: string; cloudLabel: string; tone: 'quiet' | 'pending' | 'success' | 'error'; blocksDelivery: boolean; blocksTyping: boolean; canCheck: boolean };
export function providerDraftPresentation(state: ProviderDraftStatusState): ProviderDraftPresentation {
  const snapshot = state.snapshot, base = { localLabel: state.localError ? 'Could not save locally' : state.localDirty ? 'Saving locally…' : 'Saved locally', cloudLabel: '', tone: 'quiet' as ProviderDraftPresentation['tone'], blocksDelivery: !snapshot || state.readUnavailable || !!snapshot?.deliveryBlocked, blocksTyping: !!snapshot && ['discard_queued', 'discarding', 'discarded', 'consumed'].includes(snapshot.state), canCheck: !!snapshot && snapshot.ownership === 'replica-new' && !state.loading && !state.checking && (snapshot.error?.retry === 'explicit-check' || ['outcome_unknown', 'remote_conflict'].includes(snapshot.state)) };
  if (state.readUnavailable) return { ...base, cloudLabel: 'Gmail status unavailable', tone: 'error' };
  if (state.error) return { ...base, cloudLabel: 'Gmail status needs refresh', tone: 'error', blocksDelivery: true, canCheck: false };
  if (!snapshot) return { ...base, cloudLabel: state.loading ? 'Checking Gmail status…' : '', tone: 'pending' };
  if (snapshot.ownership === 'unmanaged') return base;
  if (state.checking) return { ...base, cloudLabel: 'Checking Gmail status…', tone: 'pending' };
  if (snapshot.state === 'synced') {
    const current = !state.localDirty && state.localRevision !== null && state.localRevision === snapshot.syncedRevision && snapshot.desiredRevision === snapshot.syncedRevision && snapshot.desiredHash === snapshot.syncedHash;
    return { ...base, cloudLabel: current ? 'Synced to Gmail' : 'Gmail sync pending', tone: current ? 'success' : 'pending' };
  }
  const labels: Record<ProviderDraftSnapshot['state'], [string, ProviderDraftPresentation['tone']]> = {
    unmanaged: ['', 'quiet'], idle: ['', 'quiet'], queued: ['Gmail sync queued', 'pending'], saving: ['Saving to Gmail…', 'pending'], synced: ['Gmail sync pending', 'pending'], blocked: ['Gmail sync paused', 'error'], outcome_unknown: ['Gmail sync unconfirmed', 'error'], remote_conflict: ['Gmail draft changed elsewhere', 'error'], suspended: ['Gmail sync paused for delivery', 'quiet'], discard_queued: ['Discard queued', 'pending'], discarding: ['Discarding Gmail draft…', 'pending'], discarded: ['Draft discarded', 'quiet'], consumed: ['Gmail draft no longer active', 'quiet'],
  };
  const [cloudLabel, tone] = labels[snapshot.state]; return { ...base, cloudLabel, tone };
}
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const scheduleDefault: Schedule = (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); };
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export class ProviderDraftStatusController {
  readonly scope: ProviderDraftScope;
  private request: ProviderDraftRequest; private isCurrent: () => boolean; private schedule: Schedule; private pollMs: number; private maxPolls: number;
  private state: ProviderDraftStatusState;
  private listeners = new Set<() => void>(); private knownOperations = new Map<string, ProviderDraftOperation>();
  private active = true; private disposed = false; private epoch = 0; private controller?: AbortController; private cancelPoll?: () => void; private polls = 0;
  constructor(options: ProviderDraftScope & { localRevision?: number | null; request?: ProviderDraftRequest; isCurrent?: () => boolean; pollMs?: number; maxPolls?: number; schedule?: Schedule }) {
    if (!options.accountId || !options.draftId || /[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(options.accountId + options.draftId) || options.localRevision !== undefined && options.localRevision !== null && !validRevision(options.localRevision)) throw new Error('Invalid Gmail draft context.');
    this.scope = Object.freeze({ accountId: options.accountId, draftId: options.draftId }); this.request = options.request ?? api; this.isCurrent = options.isCurrent ?? (() => true); this.schedule = options.schedule ?? scheduleDefault; this.pollMs = options.pollMs ?? 1000; this.maxPolls = options.maxPolls ?? 30;
    this.state = { snapshot: null, verification: null, localRevision: options.localRevision ?? null, localDirty: false, editVersion: 0, localError: '', loading: false, checking: false, readUnavailable: false, error: '' };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private current() { return this.active && !this.disposed && this.isCurrent(); }
  private emit(next: Partial<ProviderDraftStatusState>) { if (!this.current()) return; this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private cancel() { this.epoch++; this.controller?.abort(); this.cancelPoll?.(); this.cancelPoll = undefined; }
  activate() { if (this.disposed) return; this.active = true; this.cancel(); this.emit({ loading: false, checking: false }); }
  suspend() { this.active = false; this.cancel(); }
  dispose() { this.suspend(); this.disposed = true; this.listeners.clear(); }
  markEdited(): number {
    if (!this.current()) return this.state.editVersion;
    const editVersion = this.state.editVersion + 1; this.emit({ localDirty: true, editVersion, localError: '' }); return editVersion;
  }
  acknowledgeLocal(revision: number, editVersion: number): void {
    if (!this.current() || !validRevision(revision) || !validRevision(editVersion) || editVersion > this.state.editVersion) return;
    if (this.state.localRevision !== null && revision < this.state.localRevision) return;
    const localRevision = Math.max(this.state.localRevision ?? 0, revision), localDirty = this.state.localDirty && editVersion !== this.state.editVersion;
    this.emit({ localRevision, localDirty, ...(editVersion === this.state.editVersion ? { localError: '' } : {}) }); this.polls = 0; this.pollIfNeeded();
  }
  failLocal(editVersion: number, message: string) { if (this.current() && editVersion === this.state.editVersion) this.emit({ localError: message || 'Local save failed.', localDirty: true }); }
  acceptAcknowledgedStatus(value: unknown): boolean {
    if (!this.current()) return false;
    try {
      const snapshot = checkedProviderDraftSnapshot(value, this.scope);
      if (this.state.snapshot && snapshot.revision < this.state.snapshot.revision) return false;
      checkedProviderDraftAdvance(this.state.snapshot, snapshot, this.knownOperations);
      if (!this.current()) return false;
      this.cancel(); return this.accept(snapshot);
    }
    catch (error) { this.emit({ readUnavailable: true, error: error instanceof Error ? error.message : 'Gmail status could not be verified.' }); return false; }
  }
  private accept(snapshot: ProviderDraftSnapshot, verification: ProviderDraftReconciliation | null = null): boolean {
    if (this.state.snapshot && snapshot.revision < this.state.snapshot.revision) { this.emit({ loading: false, checking: false }); this.pollIfNeeded(); return false; }
    checkedProviderDraftAdvance(this.state.snapshot, snapshot, this.knownOperations);
    if (!this.current()) return false;
    if (snapshot.operation) this.knownOperations.set(snapshot.operation.id, structuredClone(snapshot.operation));
    this.emit({ snapshot, verification, loading: false, checking: false, readUnavailable: false, error: '' }); this.pollIfNeeded();
    return true;
  }
  private pollIfNeeded() {
    this.cancelPoll?.(); this.cancelPoll = undefined;
    if (!this.current() || this.state.loading || this.state.checking || this.pollMs <= 0 || this.polls >= this.maxPolls || this.state.readUnavailable) return;
    const snapshot = this.state.snapshot;
    if (!snapshot || snapshot.ownership === 'unmanaged' || !(['queued', 'saving', 'discard_queued', 'discarding'].includes(snapshot.state) || this.state.localRevision !== null && snapshot.desiredRevision !== null && this.state.localRevision > snapshot.desiredRevision)) return;
    const epoch = this.epoch;
    this.cancelPoll = this.schedule(() => { this.cancelPoll = undefined; if (this.current() && epoch === this.epoch) { this.polls++; void this.load(true); } }, this.pollMs);
  }
  async load(automatic = false): Promise<boolean> {
    if (!this.current() || this.state.loading || this.state.checking) return false;
    if (!automatic) this.polls = 0;
    this.cancel(); const epoch = this.epoch; this.controller = new AbortController(); this.emit({ loading: true, error: '' });
    try {
      const result = await this.request('/drafts/' + encodeURIComponent(this.scope.draftId) + '/provider?accountId=' + encodeURIComponent(this.scope.accountId), undefined, 'GET', { signal: this.controller.signal });
      if (!this.current() || epoch !== this.epoch) return false;
      return this.accept(checkedProviderDraftStatus(result, this.scope));
    } catch (error) { if (this.current() && epoch === this.epoch) this.emit({ loading: false, readUnavailable: true, error: error instanceof Error ? error.message : 'Gmail status is unavailable. Your local draft is still here.' }); return false; }
  }
  async reconcile(): Promise<boolean> {
    const before = this.state.snapshot;
    if (!this.current() || !before || before.ownership !== 'replica-new' || this.state.loading || this.state.checking) return false;
    this.cancel(); const epoch = this.epoch; this.controller = new AbortController(); this.emit({ checking: true, error: '' });
    try {
      const result = await this.request('/drafts/' + encodeURIComponent(this.scope.draftId) + '/provider/reconcile', { accountId: this.scope.accountId, expectedSyncRevision: before.revision }, 'POST', { signal: this.controller.signal });
      if (!this.current() || epoch !== this.epoch) return false;
      const checked = checkedProviderDraftReconcile(result, this.scope, before.operation?.id ?? null); return this.accept(checked.providerDraft, checked.verification);
    } catch (error) { if (this.current() && epoch === this.epoch) this.emit({ checking: false, error: error instanceof Error ? error.message : 'Gmail status could not be checked. No sync write was retried.' }); return false; }
  }
}
