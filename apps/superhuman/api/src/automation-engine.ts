import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import { HttpError, type Thread, type Label } from './types.ts';
import { automationHash, AutomationSettingsRepository } from './automation-store.ts';
import type { AutomationPreview, AutomationPreviewRequest, AutomationProposedEffect, AutomationApplyRequest, AutomationApplication, AutomationApplyResponse, AutomationFixtureProvenance } from './automation-types.ts';

const owners = new Set<string>();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
const key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function invalid(): never { throw new HttpError(400, 'Invalid automation preview request', 'automation_invalid_request'); }
function missing(): never { throw new HttpError(404, 'Automation artifact not found', 'automation_not_found'); }
function conflict(): never { throw new HttpError(409, 'The automation intent changed; create a new explicit preview', 'automation_request_conflict'); }
function corrupt(): never { throw new HttpError(500, 'The automation artifact could not be verified', 'automation_artifact_corrupt'); }
const previewHash = (preview: AutomationPreview) => automationHash({ accountId: preview.accountId, settingsRevision: preview.settingsRevision, settingsHash: preview.settingsHash, threadIdentities: preview.threadIdentities, provenance: preview.provenance, effects: preview.effects });
function timestamp(value: unknown): boolean { try { return typeof value === 'string' && new Date(value).toISOString() === value; } catch { return false; } }
function parsedApplication(raw: string, accountId: string, id: string, preview: AutomationPreview): AutomationApplication {
  let value: AutomationApplication; try { value = JSON.parse(raw); } catch { return corrupt(); }
  if (!value || value.id !== id || !key(value.id) || value.accountId !== accountId || !key(value.previewId) || !sha(value.previewHash) || preview.state !== 'completed' || value.previewId !== preview.id || value.previewHash !== preview.previewHash || value.settingsRevision !== preview.settingsRevision || !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 0 || !timestamp(value.appliedAt) || value.effectScope !== 'synthetic-demo-local' || value.providerEffects !== false || !Array.isArray(value.threads) || value.threads.length !== preview.threadIdentities.length || !value.threads.length || value.threads.length > 20 || value.threads.some(thread => !thread || !key(thread.threadId) || !sha(thread.beforeHash) || !sha(thread.afterHash) || typeof thread.archived !== 'boolean' || !Array.isArray(thread.addedLabelIds) || thread.addedLabelIds.length > 100 || thread.addedLabelIds.some(id => !key(id)) || new Set(thread.addedLabelIds).size !== thread.addedLabelIds.length) || new Set(value.threads.map(thread => thread.threadId)).size !== value.threads.length) corrupt();
  for (const thread of value.threads) {
    const source = preview.threadIdentities.find(source => source.threadId === thread.threadId);
    const effect = preview.effects.find(effect => effect.threadId === thread.threadId);
    if (!source || source.stateHash !== thread.beforeHash || !effect || thread.addedLabelIds.some(id => !effect.addLabelIds.includes(id)) || thread.archived && !effect.archive) corrupt();
  }
  return value;
}

export type AutomationFixtureClassifier<Configuration> = {
  provenance: AutomationFixtureProvenance;
  classify(input: { accountId: string; configuration: Configuration; threads: Thread[] }): Promise<Omit<AutomationProposedEffect, 'beforeHash' | 'labelIdentities'>[]>;
};

/** Manual synthetic fixture engine. It has no Google/model adapter, background
 * scheduler or startup classification. Its settings parser is supplied only by
 * the later concrete form layer; this module does not invent rule semantics.
 */
export class AutomationFixtureEngine<Configuration> {
  readonly store: Store; readonly settings: AutomationSettingsRepository<Configuration>;
  readonly classifier: AutomationFixtureClassifier<Configuration>; readonly owner = randomUUID();
  readonly now: () => number; private closing = false;
  private readonly stoppedPreviews = new Map<string, AutomationPreview>();
  constructor(store: Store, settings: AutomationSettingsRepository<Configuration>, classifier: AutomationFixtureClassifier<Configuration>, now = Date.now, ownerAlive = alive) {
    this.store = store; this.settings = settings; this.classifier = classifier; this.now = now;
    const p = classifier.provenance;
    if (p.kind !== 'synthetic-fixture' || !key(p.classifierId) || !key(p.classifierVersion) || !sha(p.fixtureSetHash)) invalid();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.exec(`CREATE TABLE IF NOT EXISTS automation_previews(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS automation_applications(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,preview_id TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,preview_id));
        CREATE TABLE IF NOT EXISTS automation_requests(account_id TEXT NOT NULL,client_key TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT,PRIMARY KEY(account_id,client_key));`);
      for (const row of store.db.prepare("SELECT id,owner,owner_pid,data FROM automation_previews WHERE state IN ('prepared','classifying')").all()) {
        const live = Number(row.owner_pid) === process.pid && ownerAlive === alive ? owners.has(String(row.owner)) : ownerAlive(Number(row.owner_pid));
        if (live) continue;
        const preview = JSON.parse(String(row.data)) as AutomationPreview;
        preview.state = 'interrupted'; preview.error = { code: 'automation_interrupted', message: 'The earlier manual preview was interrupted. Request a new preview explicitly.', retry: 'explicit-new-preview' };
        this.writePreview(preview);
      }
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    owners.add(this.owner);
  }
  private transaction<T>(fn: () => T): T {
    if (this.store.db.isTransaction) return fn();
    this.store.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.store.db.exec('COMMIT'); return value; } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  private demo(accountId: string) { if (this.settings.account(accountId).provider !== 'demo') throw new HttpError(409, 'Automation previews and effects are available only for synthetic demo fixtures', 'automation_demo_only'); }
  private readThreads(accountId: string, ids: string[]): Thread[] {
    this.demo(accountId); let bytes = 0;
    return ids.map(id => {
      const row = this.store.db.prepare("SELECT r.data FROM thread_summaries s JOIN records r ON r.kind='thread' AND r.id=s.id WHERE s.account_id=? AND s.id=?").get(accountId, id);
      if (!row) missing(); const raw = String(row.data); bytes += Buffer.byteLength(raw);
      if (Buffer.byteLength(raw) > 65536 || bytes > 262144) throw new HttpError(413, 'The selected fixture threads exceed the preview budget', 'automation_preview_limit');
      const thread = JSON.parse(raw) as Thread;
      if (thread.accountId !== accountId || thread.id !== id || thread.providerId || !Array.isArray(thread.labels) || !Array.isArray(thread.messages)) throw new HttpError(409, 'This thread is not an owned local demo fixture', 'automation_demo_only');
      return thread;
    });
  }
  private writePreview(preview: AutomationPreview) { if (!Number.isSafeInteger(preview.revision) || preview.revision < 0 || preview.revision === Number.MAX_SAFE_INTEGER) corrupt(); preview.revision++; this.store.db.prepare('UPDATE automation_previews SET state=?,data=? WHERE id=? AND account_id=?').run(preview.state, JSON.stringify(preview), preview.id, preview.accountId); }
  get(accountId: string, id: string): AutomationPreview {
    this.demo(accountId); if (!key(id)) invalid();
    const row = this.store.db.prepare('SELECT state,data FROM automation_previews WHERE id=? AND account_id=?').get(id, accountId); if (!row) missing();
    let preview: AutomationPreview; try { preview = JSON.parse(String(row.data)); } catch { return corrupt(); }
    if (!preview || preview.id !== id || preview.accountId !== accountId || !key(preview.clientRequestId) || !Number.isSafeInteger(preview.revision) || preview.revision < 0 || preview.state !== row.state || !Number.isSafeInteger(preview.settingsRevision) || preview.settingsRevision < 0 || !sha(preview.settingsHash) || !Array.isArray(preview.threadIdentities) || !preview.threadIdentities.length || preview.threadIdentities.length > 20 || preview.threadIdentities.some(source => !source || !key(source.threadId) || !sha(source.stateHash)) || !Array.isArray(preview.effects) || !['prepared', 'classifying', 'completed', 'failed', 'interrupted'].includes(preview.state)) corrupt();
    if (preview.state === 'completed' && (!sha(preview.previewHash) || previewHash(preview) !== preview.previewHash)) corrupt();
    return preview;
  }
  byRequest(accountId: string, clientRequestId: string): AutomationPreview {
    this.demo(accountId); if (!key(clientRequestId)) invalid();
    const row = this.store.db.prepare("SELECT entity_id,fingerprint FROM automation_requests WHERE account_id=? AND client_key=? AND kind='preview'").get(accountId, clientRequestId); if (!row) missing();
    const preview = this.get(accountId, String(row.entity_id));
    if (preview.clientRequestId !== clientRequestId || row.fingerprint !== automationHash({ kind: 'preview', accountId, expectedSettingsRevision: preview.settingsRevision, threadIds: preview.threadIdentities.map(source => source.threadId).sort() })) corrupt();
    return preview;
  }
  prepare(input: AutomationPreviewRequest): { accepted: boolean; preview: AutomationPreview } {
    if (this.closing) throw new HttpError(503, 'Automation preview service is stopping', 'automation_stopping');
    this.demo(input.accountId);
    if (!key(input.clientRequestId) || !Number.isSafeInteger(input.expectedSettingsRevision) || input.expectedSettingsRevision < 0 || !Array.isArray(input.threadIds) || !input.threadIds.length || input.threadIds.length > 20 || input.threadIds.some(id => !key(id)) || new Set(input.threadIds).size !== input.threadIds.length) invalid();
    const ids = [...input.threadIds].sort(), fingerprint = automationHash({ kind: 'preview', accountId: input.accountId, expectedSettingsRevision: input.expectedSettingsRevision, threadIds: ids });
    return this.transaction(() => {
      const old = this.store.db.prepare('SELECT kind,entity_id,fingerprint FROM automation_requests WHERE account_id=? AND client_key=?').get(input.accountId, input.clientRequestId);
      if (old) { if (old.kind !== 'preview' || old.fingerprint !== fingerprint) conflict(); return { accepted: false, preview: this.byRequest(input.accountId, input.clientRequestId) }; }
      const settings = this.settings.get(input.accountId); if (settings.revision !== input.expectedSettingsRevision) throw new HttpError(409, 'Automation settings changed', 'automation_revision_conflict');
      const threads = this.readThreads(input.accountId, ids);
      const preview: AutomationPreview = { id: randomUUID(), accountId: input.accountId, clientRequestId: input.clientRequestId, revision: 0, settingsRevision: settings.revision, settingsHash: settings.configurationHash,
        threadIdentities: threads.map(thread => ({ threadId: thread.id, stateHash: automationHash(thread) })), provenance: structuredClone(this.classifier.provenance), state: 'prepared', effects: [], previewHash: null, createdAt: new Date(this.now()).toISOString(), completedAt: null, error: null };
      this.store.db.prepare('INSERT INTO automation_previews VALUES(?,?,?,?,?,?)').run(preview.id, preview.accountId, this.owner, process.pid, preview.state, JSON.stringify(preview));
      this.store.db.prepare('INSERT INTO automation_requests VALUES(?,?,?,?,?,NULL)').run(preview.accountId, preview.clientRequestId, 'preview', preview.id, fingerprint);
      return { accepted: true, preview };
    });
  }
  private checkCurrent(preview: AutomationPreview): Thread[] {
    const settings = this.settings.get(preview.accountId);
    if (settings.revision !== preview.settingsRevision || settings.configurationHash !== preview.settingsHash) throw new HttpError(409, 'Automation settings changed after this preview', 'automation_preview_stale');
    const threads = this.readThreads(preview.accountId, preview.threadIdentities.map(source => source.threadId));
    if (threads.some((thread, i) => automationHash(thread) !== preview.threadIdentities[i].stateHash)) throw new HttpError(409, 'A selected thread changed after this preview', 'automation_preview_stale');
    return threads;
  }
  private labels(accountId: string, ids: string[]): Label[] {
    return ids.map(id => { const row = this.store.db.prepare("SELECT data FROM records WHERE kind='label' AND id=? AND json_extract(data,'$.accountId')=?").get(id, accountId); if (!row) throw new HttpError(409, 'A proposed label is unavailable in this account', 'automation_label_unavailable'); const label = JSON.parse(String(row.data)) as Label; if (label.id !== id || label.accountId !== accountId) invalid(); return label; });
  }
  async classify(accountId: string, id: string): Promise<AutomationPreview> {
    const input = this.transaction(() => {
      const row = this.store.db.prepare('SELECT owner FROM automation_previews WHERE id=? AND account_id=?').get(id, accountId), preview = this.get(accountId, id);
      if (this.closing || row?.owner !== this.owner || preview.state !== 'prepared') return null;
      let threads: Thread[];
      try { threads = this.checkCurrent(preview); } catch (error) { preview.state = 'failed'; preview.error = { code: error instanceof HttpError ? error.code : 'automation_classification_failed', message: 'The fixture input changed or is unavailable. Nothing was applied.', retry: 'explicit-new-preview' }; this.writePreview(preview); return null; }
      preview.state = 'classifying'; this.writePreview(preview);
      return { preview, threads, configuration: this.settings.get(accountId).configuration };
    });
    if (!input) return this.get(accountId, id);
    try {
      const result = await this.classifier.classify({ accountId, configuration: structuredClone(input.configuration), threads: structuredClone(input.threads) });
      if (this.closing) return structuredClone(this.stoppedPreviews.get(id) ?? input.preview);
      this.transaction(() => {
        const preview = this.get(accountId, id), row = this.store.db.prepare('SELECT owner FROM automation_previews WHERE id=?').get(id);
        if (this.closing || row?.owner !== this.owner || preview.state !== 'classifying') return;
        this.checkCurrent(preview);
        if (!Array.isArray(result) || result.length !== preview.threadIdentities.length || Buffer.byteLength(JSON.stringify(result)) > 65536 || new Set(result.map(effect => effect.threadId)).size !== result.length) invalid();
        preview.effects = preview.threadIdentities.map(source => {
          const effect = result.find(effect => effect.threadId === source.threadId);
          if (!effect || !Array.isArray(effect.addLabelIds) || effect.addLabelIds.length > 100 || effect.addLabelIds.some(id => !key(id)) || new Set(effect.addLabelIds).size !== effect.addLabelIds.length || typeof effect.archive !== 'boolean' || !['classified', 'unclassified'].includes(effect.classification) || !Array.isArray(effect.reasons) || effect.reasons.length > 8 || effect.reasons.some(reason => typeof reason !== 'string' || Buffer.byteLength(reason) > 512) || effect.classification === 'unclassified' && (effect.archive || effect.addLabelIds.length)) invalid();
          const labels = this.labels(accountId, effect.addLabelIds);
          return { threadId: source.threadId, beforeHash: source.stateHash, addLabelIds: [...effect.addLabelIds], labelIdentities: labels.map(label => ({ id: label.id, stateHash: automationHash(label) })), archive: effect.archive, classification: effect.classification, reasons: [...effect.reasons] };
        });
        preview.previewHash = previewHash(preview);
        preview.state = 'completed'; preview.completedAt = new Date(this.now()).toISOString(); this.writePreview(preview);
      });
    } catch (error) {
      if (this.closing) return structuredClone(this.stoppedPreviews.get(id) ?? input.preview);
      this.transaction(() => { const preview = this.get(accountId, id); if (preview.state !== 'classifying' || this.closing) return; preview.state = 'failed'; preview.error = { code: error instanceof HttpError ? error.code : 'automation_classification_failed', message: 'The fixture preview could not be completed. Nothing was applied.', retry: 'explicit-new-preview' }; this.writePreview(preview); });
    }
    return this.get(accountId, id);
  }
  applicationByRequest(accountId: string, clientRequestId: string): AutomationApplyResponse {
    this.demo(accountId); if (!key(clientRequestId)) invalid();
    const row = this.store.db.prepare("SELECT r.data AS receipt,r.fingerprint,a.data AS application,a.id,a.preview_id FROM automation_requests r JOIN automation_applications a ON a.id=r.entity_id AND a.account_id=r.account_id WHERE r.account_id=? AND r.client_key=? AND r.kind='apply'").get(accountId, clientRequestId);
    if (!row) missing(); let receipt: AutomationApplyResponse['receipt']; try { receipt = JSON.parse(String(row.receipt)); } catch { return corrupt(); }
    let preview: AutomationPreview;
    try { preview = this.get(accountId, String(row.preview_id)); } catch { return corrupt(); }
    const application = parsedApplication(String(row.application), accountId, String(row.id), preview);
    if (!receipt || !key(receipt.id) || receipt.accountId !== accountId || receipt.clientRequestId !== clientRequestId || receipt.applicationId !== row.id || receipt.previewId !== application.previewId || receipt.previewHash !== application.previewHash || !timestamp(receipt.acceptedAt) || row.fingerprint !== automationHash({ kind: 'apply', previewId: receipt.previewId, expectedPreviewHash: receipt.previewHash })) corrupt();
    return { receipt, application };
  }
  apply(previewId: string, input: AutomationApplyRequest): AutomationApplyResponse {
    if (this.closing) throw new HttpError(503, 'Automation preview service is stopping', 'automation_stopping');
    this.demo(input.accountId); if (!key(input.clientRequestId) || !sha(input.expectedPreviewHash)) invalid();
    const fingerprint = automationHash({ kind: 'apply', previewId, expectedPreviewHash: input.expectedPreviewHash });
    return this.transaction(() => {
      const prior = this.store.db.prepare('SELECT kind,fingerprint FROM automation_requests WHERE account_id=? AND client_key=?').get(input.accountId, input.clientRequestId);
      if (prior) { if (prior.kind !== 'apply' || prior.fingerprint !== fingerprint) conflict(); return this.applicationByRequest(input.accountId, input.clientRequestId); }
      const preview = this.get(input.accountId, previewId);
      if (preview.state !== 'completed' || preview.previewHash !== input.expectedPreviewHash) conflict();
      const existing = this.store.db.prepare('SELECT id,data FROM automation_applications WHERE account_id=? AND preview_id=?').get(input.accountId, previewId);
      let application: AutomationApplication;
      if (existing) application = parsedApplication(String(existing.data), input.accountId, String(existing.id), preview);
      else {
        const threads = this.checkCurrent(preview), applied: AutomationApplication['threads'] = [];
        for (const effect of preview.effects) {
          const before = threads.find(thread => thread.id === effect.threadId); if (!before || automationHash(before) !== effect.beforeHash) conflict();
          const labels = this.labels(input.accountId, effect.addLabelIds), after = structuredClone(before);
          if (!Array.isArray(effect.labelIdentities) || labels.some(label => effect.labelIdentities.find(identity => identity.id === label.id)?.stateHash !== automationHash(label))) throw new HttpError(409, 'A proposed label changed after this preview', 'automation_preview_stale');
          after.labels = [...new Set([...after.labels, ...labels.map(label => label.id)])];
          if (effect.archive) { after.folder = 'done'; delete after.snoozedUntil; if (after.providerLabels) after.providerLabels = after.providerLabels.filter(label => label !== 'INBOX'); }
          if (after.providerLabels) after.providerLabels = [...new Set([...after.providerLabels, ...labels.flatMap(label => label.providerId ? [label.providerId] : [])])];
          const afterHash = automationHash(after); if (afterHash !== effect.beforeHash) this.store.put('thread', after.id, after);
          const archived = effect.archive && (before.folder !== after.folder || before.snoozedUntil !== after.snoozedUntil || !!before.providerLabels?.includes('INBOX') && !after.providerLabels?.includes('INBOX'));
          applied.push({ threadId: after.id, beforeHash: effect.beforeHash, afterHash, addedLabelIds: labels.map(label => label.id).filter(id => !before.labels.includes(id)), archived });
        }
        application = { id: randomUUID(), accountId: input.accountId, previewId, previewHash: input.expectedPreviewHash, settingsRevision: preview.settingsRevision, appliedAt: new Date(this.now()).toISOString(), threads: applied, effectScope: 'synthetic-demo-local', providerEffects: false };
        this.store.db.prepare('INSERT INTO automation_applications VALUES(?,?,?,?)').run(application.id, input.accountId, previewId, JSON.stringify(application));
      }
      const receipt = { id: randomUUID(), accountId: input.accountId, clientRequestId: input.clientRequestId, applicationId: application.id, previewId, previewHash: input.expectedPreviewHash, acceptedAt: new Date(this.now()).toISOString() };
      this.store.db.prepare('INSERT INTO automation_requests VALUES(?,?,?,?,?,?)').run(input.accountId, input.clientRequestId, 'apply', application.id, fingerprint, JSON.stringify(receipt));
      return { application, receipt };
    });
  }
  close() {
    if (this.closing) return;
    this.closing = true;
    try { this.transaction(() => { for (const row of this.store.db.prepare("SELECT data FROM automation_previews WHERE owner=? AND state IN ('prepared','classifying')").all(this.owner)) { const preview = JSON.parse(String(row.data)) as AutomationPreview; preview.state = 'interrupted'; preview.error = { code: 'automation_interrupted', message: 'The preview stopped locally. Nothing was applied.', retry: 'explicit-new-preview' }; this.writePreview(preview); this.stoppedPreviews.set(preview.id, structuredClone(preview)); } }); }
    finally { owners.delete(this.owner); }
  }
}
