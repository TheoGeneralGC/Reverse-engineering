import { api, ApiError } from './api.ts';
import type { AutomationApplyResponse, AutomationPreview, AutomationSettingsResponse } from '../../api/src/automation-types.ts';
import type { AutomationRequest } from './automation-model.ts';
export type AutomationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type PreviewIntent = { version: 1; kind: 'preview'; accountId: string; key: string; revision: number; settingsHash: string; threadIds: string[]; previewId?: string };
type ApplyIntent = { version: 1; kind: 'apply'; accountId: string; key: string; preview: AutomationPreview };
type Intent = PreviewIntent | ApplyIntent;
export type AutomationActionState = { preview: AutomationPreview | null; application: AutomationApplyResponse | null; pending: 'preview' | 'apply' | 'checking' | null; unknown: boolean; error: string };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const key = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\p{Cc}\p{Cf}]/u.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const timestamp = (value: unknown) => { try { return typeof value === 'string' && new Date(value).toISOString() === value; } catch { return false; } };
function checkedPreview(value: unknown, accountId: string): AutomationPreview {
  const fail = () => { throw new Error('The demo preview response could not be verified.'); };
  if (!object(value) || value.accountId !== accountId || !key(value.id) || !key(value.clientRequestId) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 0 || !sha(value.settingsHash) || !['prepared', 'classifying', 'completed', 'failed', 'interrupted'].includes(value.state)) return fail();
  if (!object(value.provenance) || value.provenance.kind !== 'synthetic-fixture' || !key(value.provenance.classifierId) || !key(value.provenance.classifierVersion) || !sha(value.provenance.fixtureSetHash)) return fail();
  if (!timestamp(value.createdAt) || !(value.completedAt === null || timestamp(value.completedAt)) || !(value.error === null || object(value.error) && key(value.error.code) && typeof value.error.message === 'string' && value.error.retry === 'explicit-new-preview')) return fail();
  if (!Array.isArray(value.threadIdentities) || !value.threadIdentities.length || value.threadIdentities.length > 20 || value.threadIdentities.some((thread: any) => !object(thread) || !key(thread.threadId) || !sha(thread.stateHash)) || new Set(value.threadIdentities.map((thread: any) => thread.threadId)).size !== value.threadIdentities.length) return fail();
  if (!Array.isArray(value.effects) || value.effects.some((effect: any) => !object(effect) || !key(effect.threadId) || !sha(effect.beforeHash) || !value.threadIdentities.some((thread: any) => thread.threadId === effect.threadId && thread.stateHash === effect.beforeHash) || !Array.isArray(effect.addLabelIds) || !effect.addLabelIds.every(key) || !Array.isArray(effect.labelIdentities) || effect.labelIdentities.length !== effect.addLabelIds.length || effect.labelIdentities.some((label: any) => !object(label) || !effect.addLabelIds.includes(label.id) || !sha(label.stateHash)) || new Set(effect.labelIdentities.map((label: any) => label.id)).size !== effect.labelIdentities.length || typeof effect.archive !== 'boolean' || !['classified', 'unclassified'].includes(effect.classification) || !Array.isArray(effect.reasons) || !effect.reasons.every((reason: unknown) => typeof reason === 'string'))) return fail();
  if (value.state === 'completed' && (!sha(value.previewHash) || value.effects.length !== value.threadIdentities.length || new Set(value.effects.map((effect: any) => effect.threadId)).size !== value.effects.length)) return fail();
  return structuredClone(value) as AutomationPreview;
}
function checkedApplication(value: unknown, intent: ApplyIntent): AutomationApplyResponse {
  const fail = () => { throw new Error('The demo application receipt could not be verified.'); };
  if (!object(value) || !object(value.receipt) || !object(value.application)) return fail();
  const receipt = value.receipt, application = value.application, preview = intent.preview;
  if (receipt.accountId !== intent.accountId || receipt.clientRequestId !== intent.key || !key(receipt.id) || !key(application.id) || !timestamp(receipt.acceptedAt) || !timestamp(application.appliedAt) || receipt.applicationId !== application.id || receipt.previewId !== preview.id || receipt.previewHash !== preview.previewHash || application.previewId !== preview.id || application.previewHash !== preview.previewHash || application.accountId !== intent.accountId || application.settingsRevision !== preview.settingsRevision || application.effectScope !== 'synthetic-demo-local' || application.providerEffects !== false) return fail();
  if (!Array.isArray(application.threads) || application.threads.length !== preview.threadIdentities.length || new Set(application.threads.map((thread: any) => thread?.threadId)).size !== application.threads.length || application.threads.some((thread: any) => !object(thread) || !preview.threadIdentities.some(source => source.threadId === thread.threadId && source.stateHash === thread.beforeHash) || !sha(thread.afterHash) || !Array.isArray(thread.addedLabelIds) || !thread.addedLabelIds.every((id: unknown) => key(id) && preview.effects.find(effect => effect.threadId === thread.threadId)?.addLabelIds.includes(id)) || typeof thread.archived !== 'boolean' || thread.archived && !preview.effects.find(effect => effect.threadId === thread.threadId)?.archive)) return fail();
  return structuredClone(value) as AutomationApplyResponse;
}
const storageDefault = (): AutomationStorage => window.localStorage;
const storageKey = (accountId: string) => 'superhuman.automation.action.v1.' + encodeURIComponent(accountId);
const definite = (error: unknown) => error instanceof ApiError && [400, 401, 403, 409, 413, 503].includes(error.status) && ['automation_invalid_request', 'automation_revision_conflict', 'automation_request_conflict', 'automation_preview_stale', 'automation_demo_only', 'automation_label_unavailable', 'automation_label_conflict', 'automation_classifier_unavailable', 'automation_stopping', 'request_failed'].includes(error.code ?? '');

export class AutomationActions {
  readonly accountId: string;
  private request: AutomationRequest; private storage?: AutomationStorage; private canAct: () => boolean; private uuid: () => string;
  private state: AutomationActionState = { preview: null, application: null, pending: null, unknown: false, error: '' };
  private listeners = new Set<() => void>(); private closed = false; private epoch = 0; private controller?: AbortController; private intent: Intent | null = null;
  private observedPreviewIds = new Map<string, string>();
  constructor(accountId: string, options: { request?: AutomationRequest; storage?: AutomationStorage; canAct?: () => boolean; uuid?: () => string } = {}) { this.accountId = accountId; this.request = options.request ?? api; this.storage = options.storage; this.canAct = options.canAct ?? (() => true); this.uuid = options.uuid ?? (() => crypto.randomUUID()); }
  activate() { this.closed = false; this.epoch++; }
  close() { this.closed = true; this.epoch++; this.controller?.abort(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private emit(next: Partial<AutomationActionState>) { if (this.closed) return; this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private store() { return this.storage ?? storageDefault(); }
  private hasPending() { try { return this.store().getItem(storageKey(this.accountId)) !== null; } catch { return true; } }
  private readIntent(): Intent | null {
    const raw = this.store().getItem(storageKey(this.accountId)); if (!raw) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('An earlier demo action could not be verified. No new action was started.'); }
    if (!object(value) || value.version !== 1 || value.accountId !== this.accountId || !key(value.key)) throw new Error('An earlier demo action could not be verified. No new action was started.');
    if (value.kind === 'preview' && Number.isSafeInteger(value.revision) && value.revision >= 0 && sha(value.settingsHash) && (value.previewId === undefined || key(value.previewId)) && Array.isArray(value.threadIds) && value.threadIds.length > 0 && value.threadIds.length <= 20 && value.threadIds.every(key) && new Set(value.threadIds).size === value.threadIds.length) return structuredClone(value) as PreviewIntent;
    if (value.kind === 'apply') return { version: 1, kind: 'apply', accountId: this.accountId, key: value.key, preview: checkedPreview(value.preview, this.accountId) };
    throw new Error('An earlier demo action could not be verified. No new action was started.');
  }
  private saveIntent(intent: Intent) {
    if (this.store().getItem(storageKey(this.accountId))) throw new Error('Check the earlier demo action before starting another.');
    const raw = JSON.stringify(intent); this.store().setItem(storageKey(this.accountId), raw);
    if (this.store().getItem(storageKey(this.accountId)) !== raw) throw new Error('This browser could not save the action receipt. Nothing was submitted.');
    this.intent = intent;
  }
  private clearIntent(intent: Intent) {
    if (this.store().getItem(storageKey(this.accountId)) !== JSON.stringify(intent)) throw new Error('Another demo action is waiting. Check its status before continuing.');
    this.store().removeItem(storageKey(this.accountId));
    if (this.store().getItem(storageKey(this.accountId)) !== null) throw new Error('The action receipt could not be cleared. Check status before continuing.');
    this.intent = null;
  }
  private acceptPreview(value: unknown, intent: PreviewIntent) {
    const preview = checkedPreview(value, this.accountId);
    if (preview.clientRequestId !== intent.key || preview.settingsRevision !== intent.revision || preview.settingsHash !== intent.settingsHash || !same(preview.threadIdentities.map(item => item.threadId).sort(), [...intent.threadIds].sort())) throw new Error('The preview did not match the selected settings and messages.');
    const knownId = intent.previewId ?? this.observedPreviewIds.get(intent.key) ?? (this.state.preview?.clientRequestId === intent.key ? this.state.preview.id : undefined);
    if (knownId !== undefined && knownId !== preview.id) throw new Error('The accepted preview identity changed. Check the earlier action before continuing.');
    if (this.state.preview?.id === preview.id && (preview.revision < this.state.preview.revision || preview.revision === this.state.preview.revision && !same(this.state.preview, preview) || !same(this.state.preview.provenance, preview.provenance) || this.state.preview.settingsHash !== preview.settingsHash || !same(this.state.preview.threadIdentities, preview.threadIdentities) || this.state.preview.state === 'completed' && !same(this.state.preview, preview))) throw new Error('The preview changed after it was confirmed.');
    this.observedPreviewIds.set(intent.key, preview.id);
    const terminal = !['prepared', 'classifying'].includes(preview.state);
    if (terminal) this.clearIntent(intent);
    else {
      if (!same(this.readIntent(), intent)) throw new Error('Another demo action is waiting. Check its status before continuing.');
      if (!intent.previewId) {
        const bound = { ...intent, previewId: preview.id }, raw = JSON.stringify(bound);
        this.store().setItem(storageKey(this.accountId), raw);
        if (this.store().getItem(storageKey(this.accountId)) !== raw) throw new Error('The accepted preview receipt could not be saved. Check status before continuing.');
        this.intent = bound;
      }
    }
    this.emit({ preview, pending: null, unknown: false, error: '' });
  }
  async preview(settings: AutomationSettingsResponse, threadIds: string[]): Promise<boolean> {
    if (this.closed || !this.canAct() || this.state.pending || this.state.unknown || !settings.capabilities.preview || settings.settings.accountId !== this.accountId) return false;
    const ids = [...new Set(threadIds)].sort(); if (!ids.length || ids.length > 20) { this.emit({ error: 'Select between one and twenty demo conversations.' }); return false; }
    const intent: PreviewIntent = { version: 1, kind: 'preview', accountId: this.accountId, key: this.uuid(), revision: settings.settings.revision, settingsHash: settings.settings.configurationHash, threadIds: ids };
    try { this.saveIntent(intent); } catch (error) { this.emit({ unknown: !!this.intent || this.hasPending(), error: (error as Error).message }); return false; }
    return this.dispatch(intent);
  }
  async apply(settings: AutomationSettingsResponse): Promise<boolean> {
    const preview = this.state.preview;
    if (this.closed || !this.canAct() || this.state.pending || this.state.unknown || this.state.application || !settings.capabilities.apply || settings.settings.accountId !== this.accountId || !preview || preview.state !== 'completed' || !preview.previewHash || preview.settingsRevision !== settings.settings.revision || preview.settingsHash !== settings.settings.configurationHash) return false;
    const intent: ApplyIntent = { version: 1, kind: 'apply', accountId: this.accountId, key: this.uuid(), preview: structuredClone(preview) };
    try { this.saveIntent(intent); } catch (error) { this.emit({ unknown: !!this.intent || this.hasPending(), error: (error as Error).message }); return false; }
    return this.dispatch(intent);
  }
  private async dispatch(intent: Intent): Promise<boolean> {
    const epoch = ++this.epoch; this.controller?.abort(); this.controller = new AbortController(); this.emit({ pending: intent.kind, error: '', application: null });
    try {
      if (!this.canAct() || this.closed) throw new Error('This automation view is no longer active.');
      const result = intent.kind === 'preview' ? await this.request('/automation/previews', { accountId: this.accountId, clientRequestId: intent.key, expectedSettingsRevision: intent.revision, threadIds: intent.threadIds }, 'POST', { signal: this.controller.signal }) : await this.request('/automation/previews/' + encodeURIComponent(intent.preview.id) + '/apply', { accountId: this.accountId, clientRequestId: intent.key, expectedPreviewHash: intent.preview.previewHash }, 'POST', { signal: this.controller.signal });
      if (this.closed || epoch !== this.epoch || !this.canAct()) return false;
      if (intent.kind === 'preview') this.acceptPreview(result?.preview, intent);
      else { const application = checkedApplication(result, intent); this.clearIntent(intent); this.emit({ preview: intent.preview, application, pending: null, unknown: false, error: '' }); }
      return true;
    } catch (error) {
      if (!this.closed && epoch === this.epoch) {
        let unknown = true;
        if (definite(error)) try { this.clearIntent(intent); unknown = false; } catch { /* Preserve a changed or uncleared journal. */ }
        this.emit({ pending: null, unknown, error: error instanceof Error ? error.message : 'Check the earlier action before trying again.' });
      }
      return false;
    }
  }
  async recover(): Promise<boolean> {
    if (this.closed || !this.canAct() || this.state.pending) return false;
    let intent: Intent | null;
    try { intent = this.readIntent(); } catch (error) { this.emit({ unknown: true, error: (error as Error).message }); return false; }
    if (!intent) return false;
    this.intent = intent; const epoch = ++this.epoch; this.controller?.abort(); this.controller = new AbortController(); this.emit({ pending: 'checking', unknown: true, error: '' });
    try {
      const path = intent.kind === 'preview' ? '/automation/previews/by-request/' : '/automation/applications/by-request/';
      const result = await this.request(path + encodeURIComponent(intent.key) + '?accountId=' + encodeURIComponent(this.accountId), undefined, 'GET', { signal: this.controller.signal });
      if (this.closed || epoch !== this.epoch || !this.canAct()) return false;
      if (intent.kind === 'preview') this.acceptPreview(result?.preview, intent);
      else { const application = checkedApplication(result, intent); this.clearIntent(intent); this.emit({ preview: intent.preview, application, pending: null, unknown: false, error: '' }); }
      return true;
    } catch (error) { if (!this.closed && epoch === this.epoch) this.emit({ pending: null, unknown: true, error: error instanceof Error ? error.message : 'The earlier action is still unconfirmed. No new action was started.' }); return false; }
  }
}
