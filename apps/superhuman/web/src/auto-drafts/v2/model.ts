import { api, ApiError } from '../../api.ts';
import {
  parseSnapshot, parseRequest, parseSaveResponse, parseErrorResponse,
  definiteMutationRefusal, assertPreferencePreconditions, scheduling, stable, intentText,
  type SettingsSnapshot, type PreferencesSnapshot, type DirectPreferences,
  type TeammateScheduling, type PreferenceSave, type SaveRequest, type SaveResponse, type Sha256,
} from '../../../../api/src/auto-drafts-contract.ts';

import { POLICY, parseEngineStatus, type EngineStatus } from '../../../../api/src/auto-drafts-generation-contract.ts';
type SettingsResponse = EngineStatus;

export type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export type Request = (path: string, body?: unknown, method?: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
type Phase = 'prepared' | 'issued' | 'accepted';
type Journal = { version: 2; policy: typeof POLICY; phase: Phase; request: PreferenceSave; reviewed: PreferencesSnapshot; fingerprint: string; acceptance?: SaveResponse };
export type State = {
  base: SettingsResponse | null; stagedScheduling: TeammateScheduling | null; schedulingConflict: boolean;
  pending: 'loading' | 'preparing' | 'saving' | 'checking' | null; phase: Phase | null; unknown: boolean;
  conflict: boolean; error: string; notice: string; intent: PreferenceSave['change'] | null; lastReceipt: SaveResponse['receipt'] | null;
};
const initial = (): State => ({ base: null, stagedScheduling: null, schedulingConflict: false, pending: null, phase: null, unknown: false, conflict: false, error: '', notice: '', intent: null, lastReceipt: null });
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
const copy = <T,>(v: T): T => structuredClone(v);
const message = (e: unknown) => e instanceof ModelError ? e.message : 'This Auto Drafts change could not be confirmed. Check its status before trying another change.';
class ModelError extends Error {}
export const journalKey = (accountId: string) => 'superhuman.auto-drafts.preferences.v2.' + POLICY + '.' + encodeURIComponent(accountId);
export const browserDigest: Sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');

function readJournal(raw: string | null, accountId: string): Journal | null {
  if (raw === null) return null;
  if (raw.length > 65536) throw new ModelError('The saved Auto Drafts action is too large to verify.');
  const value = JSON.parse(raw);
  if (!value || value.version !== 2 || value.policy !== POLICY || !['prepared', 'issued', 'accepted'].includes(value.phase) || Object.keys(value).some(k => !['version', 'policy', 'phase', 'request', 'reviewed', 'fingerprint', 'acceptance'].includes(k)) || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new ModelError('The saved Auto Drafts action could not be verified.');
  const request = parseRequest(value.request), reviewed = parseSnapshot(value.reviewed);
  if (request.section !== 'preferences' || reviewed.section !== 'preferences' || request.accountId !== accountId || reviewed.accountId !== accountId || reviewed.revision !== request.expectedRevision || (value.phase === 'accepted') !== !!value.acceptance) throw new ModelError('The saved Auto Drafts action has inconsistent ownership.');
  return { version: 2, policy: POLICY, phase: value.phase, request, reviewed, fingerprint: value.fingerprint, ...(value.acceptance ? { acceptance: copy(value.acceptance) } : {}) };
}

export class AutoDraftsModel {
  readonly accountId: string; readonly storageKey: string;
  private state = initial(); private active = false; private disposed = false; private epoch = 0; private read = 0;
  private abort?: AbortController; private journal: Journal | null = null; private raw: string | null = null;
  private known = new Map<string, SaveResponse>(); private listeners = new Set<() => void>();
  private storage: Storage; private request: Request; private digest: Sha256; private makeKey: () => string;
  private online: () => boolean; private isCurrent: () => boolean;
  constructor(options: { accountId: string; storage: Storage; request?: Request; digest?: Sha256; makeKey?: () => string; online?: () => boolean; isCurrent?: () => boolean }) {
    this.accountId = options.accountId; this.storageKey = journalKey(options.accountId); this.storage = options.storage;
    this.request = options.request || api; this.digest = options.digest || browserDigest; this.makeKey = options.makeKey || (() => crypto.randomUUID());
    this.online = options.online || (() => globalThis.navigator?.onLine !== false); this.isCurrent = options.isCurrent || (() => true);
    try { this.raw = this.storage.getItem(this.storageKey); this.journal = readJournal(this.raw, this.accountId); if (this.journal) this.state = { ...this.state, intent: this.journal.request.change, phase: this.journal.phase, unknown: this.journal.phase !== 'prepared' }; }
    catch { this.state = { ...this.state, unknown: true, error: 'The saved Auto Drafts action could not be verified. No new change was sent.' }; }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  activate() { if (!this.disposed) { this.active = true; this.epoch++; } }
  suspend() { this.active = false; this.epoch++; this.read++; this.abort?.abort(); this.state = { ...this.state, pending: null, unknown: this.state.unknown || !!this.journal && this.journal.phase !== 'prepared' }; }
  dispose() { this.suspend(); this.disposed = true; this.listeners.clear(); }
  private current(epoch = this.epoch) { return this.active && !this.disposed && this.isCurrent() && epoch === this.epoch; }
  private emit(update: Partial<State>) { if (this.current()) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); } }
  get locked() { return !this.current() || !!this.state.pending || this.state.unknown || this.state.conflict || !!this.journal; }
  get schedulingDirty() { return !!this.state.base && !!this.state.stagedScheduling && !equal(this.state.base.scheduling.value, this.state.stagedScheduling); }
  get requestId() { return this.journal?.request.clientRequestId || null; }
  stageScheduling(value: TeammateScheduling) { if (!this.current() || !this.state.base) return false; try { this.emit({ stagedScheduling: scheduling(value), error: '' }); return true; } catch { return false; } }
  discardScheduling() { if (!this.current() || !this.state.base) return false; this.emit({ stagedScheduling: copy(this.state.base.scheduling.value), schedulingConflict: false }); return true; }
  saveScheduling() { this.emit({ error: 'Teammate scheduling cannot be saved because a Team directory is not available. No preview or draft was generated.' }); return false; }
  private route() { return '/auto-drafts/v2/status?accountId=' + encodeURIComponent(this.accountId); }
  private stored() { const raw = this.storage.getItem(this.storageKey); return { raw, journal: readJournal(raw, this.accountId) }; }
  private adopt(raw: string | null) {
    if (raw === null && this.journal && this.journal.phase !== 'prepared') { this.raw = raw; this.emit({ unknown: true, error: 'The earlier Auto Drafts action is missing from storage. Its outcome is still unknown.' }); return; }
    this.raw = raw;
    try { this.journal = readJournal(raw, this.accountId); this.emit({ phase: this.journal?.phase || null, unknown: !!this.journal && this.journal.phase !== 'prepared', intent: this.journal?.request.change || null, error: this.journal ? 'Another Auto Drafts action is saved in this browser. Check it before making another change.' : '' }); }
    catch { this.emit({ unknown: true, error: 'The saved Auto Drafts action could not be verified.' }); }
  }
  private write(journal: Journal, expected: string | null) {
    const before = this.storage.getItem(this.storageKey);
    if (before !== expected) { this.adopt(before); throw new ModelError('A different saved Auto Drafts action must be reviewed first.'); }
    const raw = JSON.stringify(journal); this.storage.setItem(this.storageKey, raw);
    if (this.storage.getItem(this.storageKey) !== raw) { this.adopt(this.storage.getItem(this.storageKey)); throw new ModelError('This browser could not safely save the Auto Drafts action.'); }
    this.raw = raw; this.journal = journal; this.emit({ phase: journal.phase, unknown: journal.phase !== 'prepared' }); return raw;
  }
  private clear(expected: string) {
    if (this.storage.getItem(this.storageKey) !== expected) { this.adopt(this.storage.getItem(this.storageKey)); throw new ModelError('A newer saved Auto Drafts action was preserved.'); }
    this.storage.removeItem(this.storageKey);
    if (this.storage.getItem(this.storageKey) !== null) { this.adopt(this.storage.getItem(this.storageKey)); throw new ModelError('The confirmed action could not be released from this browser.'); }
    this.raw = null; this.journal = null; this.emit({ phase: null, unknown: false });
  }
  private checkBase(next: SettingsResponse) {
    const old = this.state.base;
    if (!old) return;
    for (const key of ['preferences', 'scheduling'] as const) {
      const a = old[key], b = next[key];
      if (b.revision < a.revision || b.revision === a.revision && !equal(a, b)) throw new ModelError('Saved Auto Drafts settings changed without a valid newer revision.');
    }
  }
  private publish(next: SettingsResponse, patch: Partial<State> = {}) {
    this.checkBase(next);
    const dirty = this.schedulingDirty, changed = !!this.state.base && !equal(this.state.base.scheduling, next.scheduling);
    this.emit({ base: next, stagedScheduling: dirty ? this.state.stagedScheduling : copy(next.scheduling.value), schedulingConflict: this.state.schedulingConflict || dirty && changed, ...patch });
  }
  private async verifyJournal(journal: Journal) {
    if (journal.fingerprint !== await this.digest(intentText(journal.request))) throw new ModelError('The saved Auto Drafts request fingerprint changed.');
    if (this.known.has(journal.request.clientRequestId) && !journal.acceptance) throw new ModelError('A known accepted proof cannot be downgraded to an unsent action. Check the exact saved key.');
    if (journal.acceptance) {
      const accepted = await parseSaveResponse(journal.acceptance, journal.request, journal.reviewed, this.digest);
      const known = this.known.get(journal.request.clientRequestId);
      if (known && (!equal(known.receipt, accepted.receipt) || !equal(known.acceptedSnapshot, accepted.acceptedSnapshot))) throw new ModelError('The earlier Auto Drafts receipt changed.');
      this.known.set(journal.request.clientRequestId, copy(accepted));
    }
  }
  async load(): Promise<boolean> {
    if (!this.current() || this.state.pending) return false;
    try { const stored = this.stored(); if (stored.raw !== this.raw) this.adopt(stored.raw); if (stored.journal && stored.journal.phase !== 'prepared') return this.recover(); if (this.state.unknown && !stored.journal) return false; }
    catch (error) { this.emit({ unknown: true, error: message(error) }); return false; }
    const epoch = this.epoch, read = ++this.read; this.abort?.abort(); this.abort = new AbortController(); this.emit({ pending: 'loading', error: '' });
    try { if (this.journal) await this.verifyJournal(this.journal); if (!this.current(epoch) || read !== this.read) return false; const value = await parseEngineStatus(await this.request(this.route(), undefined, 'GET', { signal: this.abort.signal }), this.accountId, this.digest, this.state.base || undefined); if (!this.current(epoch) || read !== this.read) return false; this.publish(value, { pending: null, conflict: !!this.journal && value.preferences.revision !== this.journal.request.expectedRevision, error: '', notice: this.journal?.phase === 'prepared' ? 'This change is saved in this browser and has not been sent.' : '' }); return true; }
    catch (error) { if (this.current(epoch) && read === this.read) this.emit({ pending: null, error: message(error) }); return false; }
  }
  private async accepted(raw: unknown, journal: Journal, expectedRaw: string | null, epoch: number): Promise<boolean> {
    const response = await parseSaveResponse(raw, journal.request, journal.reviewed, this.digest);
    if (!this.current(epoch) || !this.journal || !equal(this.journal.request, journal.request)) return false;
    const known = this.known.get(journal.request.clientRequestId);
    if (known && (!equal(known.receipt, response.receipt) || !equal(known.acceptedSnapshot, response.acceptedSnapshot))) throw new ModelError('The accepted Auto Drafts proof changed.');
    this.known.set(journal.request.clientRequestId, copy(response));
    const confirmed: Journal = { ...journal, phase: 'accepted', acceptance: response }, confirmedRaw = this.write(confirmed, expectedRaw);
    const current = await parseEngineStatus(await this.request(this.route(), undefined, 'GET', { signal: this.abort?.signal }), this.accountId, this.digest, this.state.base || undefined);
    if (!this.current(epoch)) return false;
    this.checkBase(current);
    if (current.preferences.revision < response.receipt.acceptedRevision || current.preferences.revision === response.receipt.acceptedRevision && !equal(current.preferences, response.acceptedSnapshot)) throw new ModelError('The accepted preference is not yet available in current settings.');
    this.clear(confirmedRaw);
    this.publish(current, { pending: null, unknown: false, conflict: false, intent: null, error: '', lastReceipt: response.receipt, notice: current.preferences.revision > response.receipt.acceptedRevision ? 'Your preference was saved and then changed elsewhere. The current status is shown below.' : 'Preference saved. The current response status is shown below.' });
    return true;
  }
  async recover(): Promise<boolean> {
    if (!this.current() || this.state.pending) return false;
    let saved: { raw: string | null; journal: Journal | null };
    try { saved = this.stored(); if (!saved.journal && this.journal?.phase !== 'prepared') saved.journal = this.journal; if (!saved.journal) throw new ModelError('The earlier action cannot be found. Its outcome remains unknown.'); if (saved.raw !== this.raw) this.adopt(saved.raw); if (saved.journal.phase === 'prepared') return this.load(); }
    catch (error) { this.emit({ unknown: true, error: message(error) }); return false; }
    const journal = saved.journal, epoch = this.epoch; this.abort?.abort(); this.abort = new AbortController(); this.emit({ pending: 'checking', unknown: true, error: '' });
    try { await this.verifyJournal(journal); if (!this.current(epoch)) return false; const response = await this.request('/auto-drafts/v2/requests/by-request/' + encodeURIComponent(journal.request.clientRequestId) + '?accountId=' + encodeURIComponent(this.accountId) + '&section=preferences', undefined, 'GET', { signal: this.abort.signal }); if (!this.current(epoch)) return false; return await this.accepted(response, journal, saved.raw, epoch); }
    catch (error) { if (this.current(epoch)) this.emit({ pending: null, unknown: true, error: message(error) }); return false; }
  }
  async setPreference(field: keyof DirectPreferences, value: boolean): Promise<boolean> {
    if (this.locked || !this.state.base) return false;
    const epoch = this.epoch; this.read++; this.abort?.abort(); this.abort = new AbortController(); this.emit({ pending: 'preparing', error: '', notice: '', intent: { field, value }, lastReceipt: null });
    try {
      const reviewed = copy(this.state.base.preferences), request = parseRequest({ section: 'preferences', accountId: this.accountId, clientRequestId: this.makeKey(), expectedRevision: reviewed.revision, change: { field, value } });
      if (request.section !== 'preferences') return false; assertPreferencePreconditions(request, reviewed);
      const before = this.stored(); if (before.journal) { this.adopt(before.raw); throw new ModelError('Check the earlier saved action before making another change.'); }
      const fingerprint = await this.digest(intentText(request)); if (!this.current(epoch)) return false;
      const journal: Journal = { version: 2, policy: POLICY, phase: 'prepared', request, reviewed, fingerprint }; const raw = this.write(journal, before.raw);
      if (!this.online()) { this.emit({ pending: null, notice: 'Saved in this browser. The change has not been sent.' }); return false; }
      return await this.issue(journal, raw, epoch);
    } catch (error) { if (this.current(epoch)) this.emit({ pending: null, unknown: this.state.unknown || !!this.journal && this.journal.phase !== 'prepared', error: message(error) }); return false; }
  }
  private async issue(journal: Journal, raw: string, epoch: number): Promise<boolean> {
    await this.verifyJournal(journal); if (!this.current(epoch) || !this.online()) return false;
    const issued = { ...journal, phase: 'issued' as const }, issuedRaw = this.write(issued, raw); this.emit({ pending: 'saving', unknown: true });
    let response: unknown;
    try { response = await this.request('/auto-drafts/v2/preferences', issued.request, 'PATCH', { signal: this.abort?.signal }); }
    catch (error) {
      if (!this.current(epoch)) return false;
      let definite = false;
      if (error instanceof ApiError) try { definite = definiteMutationRefusal(parseErrorResponse({ error: { code: error.code, message: error.message } }), error.status, { phase: 'mutation-response', acceptedProof: this.known.has(journal.request.clientRequestId) || !!this.journal?.acceptance }); } catch { /* Unknown errors never release a journal. */ }
      if (definite) { try { this.clear(issuedRaw); this.emit({ pending: null, unknown: false, conflict: error instanceof ApiError && error.status === 409, intent: null, error: 'This change was not saved. Reload saved settings and review it before trying again.' }); } catch (clearError) { this.emit({ pending: null, unknown: true, error: message(clearError) }); } }
      else this.emit({ pending: null, unknown: true, error: message(error) }); return false;
    }
    try { return await this.accepted(response, issued, issuedRaw, epoch); }
    catch (error) { if (this.current(epoch)) this.emit({ pending: null, unknown: true, error: message(error) }); return false; }
  }
  async resumePrepared(): Promise<boolean> {
    if (!this.current() || this.state.pending || this.state.unknown || !this.online()) return false;
    try { const saved = this.stored(); if (!saved.journal || saved.journal.phase !== 'prepared' || saved.raw === null) return false; if (saved.raw !== this.raw) this.adopt(saved.raw); const epoch = this.epoch; this.abort?.abort(); this.abort = new AbortController(); this.emit({ pending: 'preparing' }); await this.verifyJournal(saved.journal); if (!this.current(epoch)) return false; const current = await parseEngineStatus(await this.request(this.route(), undefined, 'GET', { signal: this.abort.signal }), this.accountId, this.digest, this.state.base || undefined); if (!this.current(epoch)) return false; this.checkBase(current); if (!equal(current.preferences, saved.journal.reviewed)) { this.publish(current, { pending: null, conflict: true, error: 'Settings changed while this action was offline. Discard the unsent action and review it.' }); return false; } return await this.issue(saved.journal, saved.raw, epoch); }
    catch (error) { this.emit({ pending: null, error: message(error) }); return false; }
  }
  discardPrepared() { if (!this.current() || this.state.pending || this.journal?.phase !== 'prepared' || !this.raw) return false; try { this.clear(this.raw); this.emit({ conflict: false, intent: null, error: '', notice: 'The unsent browser change was discarded.' }); return true; } catch (error) { this.emit({ unknown: true, error: message(error) }); return false; } }
}
