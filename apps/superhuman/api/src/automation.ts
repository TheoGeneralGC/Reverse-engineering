import type { Store } from './store.ts';
import { HttpError, type Label } from './types.ts';
import { AutomationSettingsRepository, automationHash } from './automation-store.ts';
import { AutomationFixtureEngine, type AutomationFixtureClassifier } from './automation-engine.ts';
import { AUTOMATION_BUILTINS, AUTOMATION_TEMPLATE_NAMES, automationLabelId, emptyAutomationConfiguration, parseAutomationConfiguration } from './automation-config.ts';
import type { AutomationConfiguration, AutomationSettingsResponse, AutomationPreviewRequest, AutomationApplyRequest } from './automation-types.ts';

export type AutomationOptions = { now?: () => number; fixture?: AutomationFixtureClassifier<AutomationConfiguration> };
export function automationObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(400, 'Invalid automation request', 'automation_invalid_request');
  return value as Record<string, unknown>;
}
function labelConflict(): never { throw new HttpError(409, 'A managed label was edited or removed. Keep that user change and review the automation configuration.', 'automation_label_conflict'); }

export class AutomationService {
  readonly store: Store; readonly settings: AutomationSettingsRepository<AutomationConfiguration>;
  readonly engine: AutomationFixtureEngine<AutomationConfiguration>; readonly fixtureConfigured: boolean;
  constructor(store: Store, options: AutomationOptions = {}) {
    this.store = store;
    this.settings = new AutomationSettingsRepository(store, emptyAutomationConfiguration, parseAutomationConfiguration, options.now);
    this.fixtureConfigured = !!options.fixture;
    store.db.exec('CREATE TABLE IF NOT EXISTS automation_label_targets(account_id TEXT NOT NULL,definition_id TEXT NOT NULL,label_id TEXT NOT NULL,managed_hash TEXT NOT NULL,PRIMARY KEY(account_id,definition_id))');
    this.engine = new AutomationFixtureEngine(store, this.settings, options.fixture ?? {
      provenance: { kind: 'synthetic-fixture', classifierId: 'unconfigured', classifierVersion: 'v1', fixtureSetHash: '0'.repeat(64) },
      classify: async () => { throw new HttpError(503, 'Configure an explicit controlled fixture classifier for preview', 'automation_classifier_unavailable'); },
    }, options.now);
  }
  private ownedLabel(accountId: string, id: string): Label | undefined {
    const row = this.store.db.prepare("SELECT data FROM records WHERE kind='label' AND id=? AND CASE WHEN json_valid(data) THEN json_extract(data,'$.accountId') END=?").get(id, accountId);
    if (!row) return;
    const label = JSON.parse(String(row.data)) as Label;
    if (!label || label.id !== id || label.accountId !== accountId || typeof label.name !== 'string') return;
    return label;
  }
  response(accountId: string): AutomationSettingsResponse {
    const settings = this.settings.get(accountId), definitions = [...AUTOMATION_BUILTINS, ...settings.configuration.labels.filter(label => !AUTOMATION_BUILTINS.some(builtin => builtin.id === label.id))];
    const labels = definitions.map(definition => {
      const mailLabelId = automationLabelId(accountId, definition.id), label = this.ownedLabel(accountId, mailLabelId);
      const binding = this.store.db.prepare('SELECT label_id,managed_hash FROM automation_label_targets WHERE account_id=? AND definition_id=?').get(accountId, definition.id);
      return { id: definition.id, name: definition.name, kind: AUTOMATION_BUILTINS.some(builtin => builtin.id === definition.id) ? 'builtin' as const : 'custom' as const, mailLabelId,
        mailLabelAvailable: !!label && label.name === definition.name && binding?.label_id === mailLabelId && binding.managed_hash === automationHash(label) };
    });
    const rows = this.store.db.prepare("SELECT id,data FROM records WHERE kind='label' AND CASE WHEN json_valid(data) THEN json_extract(data,'$.accountId') END=? ORDER BY id LIMIT 201").all(accountId);
    const availableLabels = rows.slice(0, 200).flatMap(row => { const label = JSON.parse(String(row.data)) as Label; return label && label.id === row.id && label.accountId === accountId && typeof label.name === 'string' ? [{ id: label.id, name: label.name }] : []; });
    const ready = settings.configuration.labels.every(definition => labels.some(label => label.id === definition.id && label.mailLabelAvailable));
    const demo = this.settings.account(accountId).provider === 'demo';
    return { settings, labels, availableLabels, labelOptionsLimited: rows.length > 200,
      templates: AUTOMATION_TEMPLATE_NAMES.map(template => ({ ...template, state: settings.configuration.labels.some(label => label.id === template.id.replace('template-', 'builtin-')) ? 'in-use' : 'available', criteriaPreset: 'unmeasured' })),
      capabilities: { configuration: true, preview: demo && ready && this.fixtureConfigured, apply: demo && ready, providerEffects: false, automaticProcessing: false, classifier: this.fixtureConfigured ? 'controlled-fixture' : 'unavailable' },
      limitations: ['Saved configuration never activates background processing or provider changes.', 'Preview/apply is manual and limited to explicitly registered synthetic demo fixtures; Gmail effects are unavailable.', 'Prompt/built-in results are controlled annotations, not an original paid classifier or model-quality claim.', 'Group matching, archive precedence and fixture history are explicit local policies pending original classification comparison.', 'Template preset criteria, original new-account defaults, complete address-book matching and live backfill remain unmeasured.'] };
  }
  private validateLabelCriteria(accountId: string, configuration: AutomationConfiguration) {
    const targets = new Set(configuration.labels.map(label => automationLabelId(accountId, label.id)));
    for (const label of configuration.labels) for (const group of label.groups) for (const item of group.items) {
      if (item.type === 'label' && !targets.has(item.value) && !this.ownedLabel(accountId, item.value)) throw new HttpError(400, 'Select a label in this account', 'automation_label_unavailable');
    }
  }
  private syncDemoTargets(accountId: string, configuration: AutomationConfiguration) {
    for (const definition of configuration.labels) {
      const id = automationLabelId(accountId, definition.id), binding = this.store.db.prepare('SELECT label_id,managed_hash FROM automation_label_targets WHERE account_id=? AND definition_id=?').get(accountId, definition.id);
      const exists = this.store.db.prepare("SELECT 1 FROM records WHERE kind='label' AND id=?").get(id), old = this.ownedLabel(accountId, id);
      if (binding && (binding.label_id !== id || !old || binding.managed_hash !== automationHash(old)) || !binding && exists) labelConflict();
      const next: Label = old ? { ...old, name: definition.name } : { id, accountId, name: definition.name };
      if (!old || automationHash(old) !== automationHash(next)) this.store.put('label', id, next);
      this.store.db.prepare('INSERT INTO automation_label_targets VALUES(?,?,?,?) ON CONFLICT(account_id,definition_id) DO UPDATE SET label_id=excluded.label_id,managed_hash=excluded.managed_hash').run(accountId, definition.id, id, automationHash(next));
    }
  }
  save(accountId: string, raw: unknown): AutomationSettingsResponse {
    const input = automationObject(raw, ['expectedRevision', 'configuration']);
    if (typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new HttpError(400, 'Expected the current automation revision', 'automation_invalid_request');
    const configuration = parseAutomationConfiguration(input.configuration), account = this.settings.account(accountId);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const before = this.settings.get(accountId), next = this.settings.save(accountId, input.expectedRevision, configuration);
      this.validateLabelCriteria(accountId, configuration);
      if (account.provider === 'demo' && next.revision !== before.revision) this.syncDemoTargets(accountId, configuration);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    return this.response(accountId);
  }
  preview(raw: unknown) {
    const value = automationObject(raw, ['accountId', 'clientRequestId', 'expectedSettingsRevision', 'threadIds']);
    const input = value as AutomationPreviewRequest;
    this.settings.account(input.accountId);
    // Known keys recover their original artifact regardless of a later fixture
    // configuration change; no classification is repeated by this path.
    const known = typeof input.clientRequestId === 'string' && this.store.db.prepare('SELECT 1 FROM automation_requests WHERE account_id=? AND client_key=?').get(input.accountId, input.clientRequestId);
    if (!known) {
      if (this.settings.account(input.accountId).provider !== 'demo') throw new HttpError(409, 'Preview is limited to synthetic demo fixtures', 'automation_demo_only');
      if (!this.fixtureConfigured) throw new HttpError(503, 'Configure an explicit controlled fixture classifier for preview', 'automation_classifier_unavailable');
      if (!this.response(input.accountId).capabilities.preview) throw new HttpError(409, 'Review the managed fixture labels before preview', 'automation_label_conflict');
    }
    const result = this.engine.prepare(input);
    if (result.accepted) void this.engine.classify(input.accountId, result.preview.id).catch(() => { /* Durable state/recovery records interruption; never auto retry. */ });
    return result;
  }
  apply(id: string, raw: unknown) {
    const value = automationObject(raw, ['accountId', 'clientRequestId', 'expectedPreviewHash']);
    return this.engine.apply(id, value as AutomationApplyRequest);
  }
  close() { this.engine.close(); }
}
