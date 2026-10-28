import { api, ApiError } from './api.ts';
import { configurationValue } from './automation-rule.ts';
import type { AutomationConfiguration, AutomationCustomLabel, AutomationSettingsResponse } from '../../api/src/automation-types.ts';
export type { AutomationConfiguration, AutomationSettingsResponse };
export type AutomationRequest = (path: string, body?: unknown, method?: string, options?: { signal?: AbortSignal }) => Promise<any>;
export type AutomationState = { base: AutomationSettingsResponse | null; form: AutomationConfiguration | null; pending: 'loading' | 'saving' | null; error: string; needsReload: boolean; conflicts: string[] };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const sha = (value: unknown) => string(value) && /^[a-f0-9]{64}$/.test(value);

export function checkedAutomationSettings(value: unknown, accountId: string): AutomationSettingsResponse {
  const fail = () => { throw new Error('The automation settings response could not be verified.'); };
  if (!object(value) || !object(value.settings) || !object(value.capabilities)) return fail();
  const s = value.settings, c = s.configuration, capabilities = value.capabilities;
  if (s.accountId !== accountId || !Number.isSafeInteger(s.revision) || s.revision < 0 || !sha(s.configurationHash) || s.providerEffects !== false || !['manual-demo-only', 'unavailable'].includes(s.processing) || !(s.updatedAt === null || string(s.updatedAt))) return fail();
  if (!object(c) || !Array.isArray(c.labels) || !object(c.archive) || !['labelIds', 'always', 'never'].every(key => Array.isArray(c.archive[key]) && c.archive[key].every(string))) return fail();
  if (new Set(c.labels.map((rule: any) => rule?.id)).size !== c.labels.length || c.labels.some((rule: any) => !object(rule) || !string(rule.id) || !rule.id || !string(rule.name) || !string(rule.prompt) || rule.prompt.length > 1000 || !Array.isArray(rule.groups) || rule.groups.some((group: any) => !object(group) || !['or', 'and', 'exclude'].includes(group.operator) || !['or', 'and'].includes(group.queryOperator) || !Array.isArray(group.items) || group.items.some((item: any) => !object(item) || !['from', 'to', 'subject', 'label'].includes(item.type) || !string(item.value))))) return fail();
  if (!Array.isArray(value.labels) || value.labels.some((label: any) => !object(label) || !string(label.id) || !string(label.name) || !['builtin', 'custom'].includes(label.kind) || !string(label.mailLabelId) || typeof label.mailLabelAvailable !== 'boolean') || new Set(value.labels.map((label: any) => label.id)).size !== value.labels.length) return fail();
  if (!Array.isArray(value.availableLabels) || value.availableLabels.some((label: any) => !object(label) || !string(label.id) || !string(label.name)) || typeof value.labelOptionsLimited !== 'boolean') return fail();
  if (!Array.isArray(value.templates) || value.templates.some((template: any) => !object(template) || !string(template.id) || !string(template.name) || !['General', 'Finance', 'Purchases', 'Travel', 'Legal'].includes(template.category) || !['in-use', 'available'].includes(template.state) || template.criteriaPreset !== 'unmeasured')) return fail();
  if (capabilities.configuration !== true || capabilities.providerEffects !== false || capabilities.automaticProcessing !== false || typeof capabilities.preview !== 'boolean' || typeof capabilities.apply !== 'boolean' || !['controlled-fixture', 'unavailable'].includes(capabilities.classifier) || !Array.isArray(value.limitations) || !value.limitations.every(string)) return fail();
  return structuredClone(value) as AutomationSettingsResponse;
}

function rebase(old: AutomationConfiguration, local: AutomationConfiguration, remote: AutomationConfiguration) {
  const form = structuredClone(remote), conflicts: string[] = [];
  for (const field of ['labelIds', 'always', 'never'] as const) {
    if (equal(local.archive[field], old.archive[field])) continue;
    if (!equal(remote.archive[field], old.archive[field]) && !equal(remote.archive[field], local.archive[field])) conflicts.push('archive.' + field);
    form.archive[field] = [...local.archive[field]];
  }
  const oldMap = new Map(old.labels.map(rule => [rule.id, rule])), localMap = new Map(local.labels.map(rule => [rule.id, rule])), remoteMap = new Map(remote.labels.map(rule => [rule.id, rule]));
  const changed = new Set([...oldMap.keys(), ...localMap.keys()].filter(id => !equal(oldMap.get(id), localMap.get(id))));
  for (const id of changed) {
    const mine = localMap.get(id), theirs = remoteMap.get(id);
    if (!equal(theirs, oldMap.get(id)) && !equal(theirs, mine)) conflicts.push('labels.' + id);
    const index = form.labels.findIndex(rule => rule.id === id);
    if (!mine) { if (index >= 0) form.labels.splice(index, 1); }
    else if (index >= 0) form.labels[index] = structuredClone(mine);
    else form.labels.push(structuredClone(mine));
  }
  return { form, conflicts };
}

export class AutomationModel {
  readonly accountId: string;
  private request: AutomationRequest;
  private state: AutomationState = { base: null, form: null, pending: 'loading', error: '', needsReload: false, conflicts: [] };
  private listeners = new Set<() => void>();
  private closed = false; private epoch = 0; private controller?: AbortController;
  private unconfirmed: { revision: number; sent: AutomationConfiguration; canonical: AutomationConfiguration } | null = null;
  constructor(accountId: string, request: AutomationRequest = api) { this.accountId = accountId; this.request = request; }
  activate() { this.closed = false; this.epoch++; }
  close() { this.closed = true; this.epoch++; this.controller?.abort(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private emit(next: Partial<AutomationState>) { if (this.closed) return; this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  get dirty() { return !!this.state.base && !!this.state.form && !equal(this.state.form, this.state.base.settings.configuration); }
  get locked() { return this.closed || !!this.state.pending || this.state.needsReload; }
  setConfiguration(configuration: AutomationConfiguration) { if (!this.locked && this.state.form) this.emit({ form: structuredClone(configuration), error: '' }); }
  setArchive(field: keyof AutomationConfiguration['archive'], value: string[]) { if (this.state.form) this.setConfiguration({ ...this.state.form, archive: { ...this.state.form.archive, [field]: value } }); }
  putRule(rule: AutomationCustomLabel) {
    if (!this.state.form) return;
    const labels = this.state.form.labels, exists = labels.some(item => item.id === rule.id);
    this.setConfiguration({ ...this.state.form, labels: exists ? labels.map(item => item.id === rule.id ? rule : item) : [...labels, rule] });
  }
  removeRule(id: string) { if (this.state.form) this.setConfiguration({ labels: this.state.form.labels.filter(rule => rule.id !== id), archive: { ...this.state.form.archive, labelIds: this.state.form.archive.labelIds.filter(value => value !== id) } }); }
  resolveConflicts(choice: 'mine' | 'saved') {
    if (this.locked || !this.state.form || !this.state.base) return;
    let form = structuredClone(this.state.form);
    if (choice === 'saved') for (const conflict of this.state.conflicts) {
      if (conflict.startsWith('archive.')) { const field = conflict.slice(8) as keyof AutomationConfiguration['archive']; form.archive[field] = [...this.state.base.settings.configuration.archive[field]]; }
      else { const id = conflict.slice(7), saved = this.state.base.settings.configuration.labels.find(rule => rule.id === id); form.labels = form.labels.filter(rule => rule.id !== id); if (saved) form.labels.push(structuredClone(saved)); }
    }
    this.emit({ form, conflicts: [], error: '' });
  }
  async load(): Promise<boolean> {
    if (this.closed || this.state.pending === 'saving') return false;
    const epoch = ++this.epoch; this.controller?.abort(); this.controller = new AbortController(); this.emit({ pending: 'loading', error: '' });
    try {
      const saved = checkedAutomationSettings(await this.request('/automation/settings?accountId=' + encodeURIComponent(this.accountId), undefined, 'GET', { signal: this.controller.signal }), this.accountId);
      if (this.closed || epoch !== this.epoch) return false;
      if (this.state.base && saved.settings.revision < this.state.base.settings.revision) throw new Error('The saved settings are older than the version already loaded.');
      const confirmed = this.unconfirmed && [this.unconfirmed.revision, this.unconfirmed.revision + 1].includes(saved.settings.revision) && equal(saved.settings.configuration, this.unconfirmed.canonical);
      const next = confirmed && this.unconfirmed && this.state.form ? rebase(this.unconfirmed.sent, this.state.form, saved.settings.configuration) : this.state.base && this.state.form ? rebase(this.state.base.settings.configuration, this.state.form, saved.settings.configuration) : { form: structuredClone(saved.settings.configuration), conflicts: [] };
      this.unconfirmed = null;
      this.emit({ base: saved, ...next, pending: null, needsReload: false, error: '' }); return true;
    } catch (error) { if (!this.closed && epoch === this.epoch) this.emit({ pending: null, error: error instanceof Error ? error.message : 'Unable to load automation settings.', needsReload: !!this.state.base }); return false; }
  }
  async save(): Promise<boolean> {
    if (this.locked || this.state.conflicts.length || !this.state.base || !this.state.form || !this.dirty) return false;
    let configuration: AutomationConfiguration;
    try { configuration = configurationValue(this.state.form); } catch (error) { this.emit({ error: (error as Error).message }); return false; }
    const sent = structuredClone(this.state.form), expectedRevision = this.state.base.settings.revision, epoch = ++this.epoch;
    this.unconfirmed = { revision: expectedRevision, sent, canonical: configuration };
    this.controller?.abort(); this.controller = new AbortController(); this.emit({ pending: 'saving', error: '' });
    try {
      const saved = checkedAutomationSettings(await this.request('/automation/settings?accountId=' + encodeURIComponent(this.accountId), { expectedRevision, configuration }, 'PATCH', { signal: this.controller.signal }), this.accountId);
      if (this.closed || epoch !== this.epoch) return false;
      if (![expectedRevision, expectedRevision + 1].includes(saved.settings.revision) || !equal(saved.settings.configuration, configuration)) throw new Error('Save could not be confirmed. Reload saved settings to compare.');
      const next = rebase(sent, this.state.form ?? sent, saved.settings.configuration);
      this.unconfirmed = null;
      this.emit({ base: saved, ...next, pending: null, needsReload: false, error: '' }); return true;
    } catch (error) {
      if (!this.closed && epoch === this.epoch) this.emit({ pending: null, error: error instanceof Error ? error.message : 'Save could not be confirmed.', needsReload: !(error instanceof ApiError && error.status === 400) });
      return false;
    }
  }
}
