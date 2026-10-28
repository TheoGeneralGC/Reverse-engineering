import { api, ApiError } from '../api.ts';
import { PERSONALIZATION_FIELDS, type PersonalizationField, type PersonalizationSettings, type PersonalizationPatch } from '../../../api/src/personalization-types.ts';
export type PersonalizationForm = Record<PersonalizationField, string> & { facts: { id: string; text: string }[] };
export type PersonalizationPort = (method: 'GET' | 'PATCH', accountId: string, body?: PersonalizationPatch, signal?: AbortSignal) => Promise<PersonalizationSettings>;
export type PersonalizationState = {
  base: PersonalizationSettings | null; form: PersonalizationForm | null;
  pending: 'loading' | 'saving' | null; error: string | null; needsReload: boolean;
  conflicts: (PersonalizationField | 'facts')[];
};
export const personalizationPort: PersonalizationPort = async (method, accountId, body, signal) => (await api<{ settings: PersonalizationSettings }>('/personalization?accountId=' + encodeURIComponent(accountId), body, method, { signal })).settings;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function personalizationForm(value: PersonalizationSettings): PersonalizationForm {
  return { ...Object.fromEntries(PERSONALIZATION_FIELDS.map(key => [key, value[key]])), facts: value.facts.filter(fact => !fact.deletedAt).map(fact => ({ id: fact.id, text: fact.text })) } as PersonalizationForm;
}
function checked(value: PersonalizationSettings, accountId: string): PersonalizationSettings {
  if (!value || value.accountId !== accountId || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.enabled !== 'boolean' || PERSONALIZATION_FIELDS.some(key => typeof value[key] !== 'string' || value[key].length > 5000) || !Array.isArray(value.facts) || value.facts.some(f => !f || typeof f.id !== 'string' || typeof f.text !== 'string' || (f.deletedAt !== null && typeof f.deletedAt !== 'string'))) throw new Error('The saved settings could not be verified. Reload to try again.');
  return structuredClone(value);
}
export function personalizationChanges(base: PersonalizationSettings, form: PersonalizationForm): PersonalizationPatch['changes'] {
  const changes: PersonalizationPatch['changes'] = {};
  for (const key of PERSONALIZATION_FIELDS) if (form[key] !== base[key]) changes[key] = form[key];
  if (!equal(form.facts, personalizationForm(base).facts)) changes.facts = structuredClone(form.facts);
  return changes;
}
export function personalizationFormError(form: PersonalizationForm | null): string | null {
  if (!form) return null;
  for (const key of PERSONALIZATION_FIELDS) if (form[key].length > 5000 || (['writing', 'scheduling', 'events'].includes(key) ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(form[key])) return 'Each field supports up to 5,000 characters.';
  if (form.facts.length > 100 || new Set(form.facts.map(f => f.id)).size !== form.facts.length || form.facts.some(f => !f.text.trim() || f.text.length > 1000)) return 'Enter a fact of up to 1,000 characters, or remove the empty fact.';
  return null;
}
function rebase(old: PersonalizationForm, local: PersonalizationForm, remote: PersonalizationForm) {
  const form = structuredClone(remote), conflicts: PersonalizationState['conflicts'] = [];
  for (const key of [...PERSONALIZATION_FIELDS, 'facts'] as const) {
    if (equal(local[key], old[key])) continue;
    if (!equal(remote[key], old[key]) && !equal(remote[key], local[key])) conflicts.push(key);
    if (key === 'facts') form.facts = structuredClone(local.facts); else form[key] = local[key];
  }
  return { form, conflicts };
}
export class PersonalizationModel {
  readonly accountId: string;
  private port: PersonalizationPort;
  private state: PersonalizationState = { base: null, form: null, pending: 'loading', error: null, needsReload: false, conflicts: [] };
  private listeners = new Set<() => void>();
  private closed = false; private sequence = 0; private controller?: AbortController;
  constructor(accountId: string, port: PersonalizationPort = personalizationPort) { this.accountId = accountId; this.port = port; }
  activate() { this.closed = false; this.sequence++; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(next: Partial<PersonalizationState>) { if (this.closed) return; this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  get dirty() { return !!this.state.base && !!this.state.form && Object.keys(personalizationChanges(this.state.base, this.state.form)).length > 0; }
  setField(key: PersonalizationField, value: string) { if (this.state.form) this.emit({ form: { ...this.state.form, [key]: value }, conflicts: this.state.conflicts.filter(field => field !== key || value !== this.state.base?.[key]) }); }
  setFacts(facts: PersonalizationForm['facts']) { if (this.state.form) this.emit({ form: { ...this.state.form, facts: structuredClone(facts) }, conflicts: this.state.conflicts.filter(field => field !== 'facts' || !equal(facts, this.state.base && personalizationForm(this.state.base).facts)) }); }
  resolveConflicts(choice: 'mine' | 'saved') {
    if (!this.state.form || !this.state.base) return;
    const form = structuredClone(this.state.form), saved = personalizationForm(this.state.base);
    if (choice === 'saved') for (const key of this.state.conflicts) { if (key === 'facts') form.facts = saved.facts; else form[key] = saved[key]; }
    this.emit({ form, conflicts: [] });
  }
  async load(): Promise<boolean> {
    if (this.closed || this.state.pending === 'saving') return false;
    const sequence = ++this.sequence; this.controller?.abort(); this.controller = new AbortController(); this.emit({ pending: 'loading', error: null });
    try {
      const saved = checked(await this.port('GET', this.accountId, undefined, this.controller.signal), this.accountId);
      if (this.closed || sequence !== this.sequence) return false;
      if (this.state.base && saved.revision < this.state.base.revision) throw new Error('The saved settings are older than the version already loaded.');
      const next = this.state.base && this.state.form ? rebase(personalizationForm(this.state.base), this.state.form, personalizationForm(saved)) : { form: personalizationForm(saved), conflicts: [] };
      this.emit({ base: saved, ...next, pending: null, error: null, needsReload: false }); return true;
    } catch (error) { if (!this.closed && sequence === this.sequence) this.emit({ pending: null, error: error instanceof Error ? error.message : 'Unable to load personalization.', needsReload: !!this.state.base }); return false; }
  }
  async save(): Promise<boolean> {
    if (this.closed || this.state.pending || this.state.needsReload || this.state.conflicts.length || !this.state.base || !this.state.form || !this.dirty || personalizationFormError(this.state.form)) return false;
    const sent = structuredClone(this.state.form), expectedRevision = this.state.base.revision, changes = personalizationChanges(this.state.base, sent), sequence = ++this.sequence;
    this.controller?.abort(); this.controller = new AbortController(); this.emit({ pending: 'saving', error: null });
    try {
      const saved = checked(await this.port('PATCH', this.accountId, { expectedRevision, changes }, this.controller.signal), this.accountId);
      if (this.closed || sequence !== this.sequence) return false;
      const savedForm = personalizationForm(saved);
      if (saved.revision !== expectedRevision + 1 || Object.entries(changes).some(([key, value]) => !equal(savedForm[key as keyof PersonalizationForm], value))) throw new Error('Save could not be confirmed. Reload saved settings to compare.');
      const current = this.state.form ?? sent, next = rebase(sent, current, savedForm);
      this.emit({ base: saved, ...next, pending: null, error: null, needsReload: false }); return true;
    } catch (error) {
      if (!this.closed && sequence === this.sequence) this.emit({ pending: null, error: error instanceof Error ? error.message : 'Save could not be confirmed.', needsReload: !(error instanceof ApiError && error.status === 400) });
      return false;
    }
  }
  close() { this.closed = true; this.sequence++; this.controller?.abort(); this.listeners.clear(); }
}
