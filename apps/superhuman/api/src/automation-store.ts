import { createHash } from 'node:crypto';
import type { Store } from './store.ts';
import { HttpError, type Account } from './types.ts';
import type { AutomationSettingsEnvelope } from './automation-types.ts';

export const automationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(): never { throw new HttpError(400, 'Invalid automation configuration request', 'automation_invalid_request'); }
function corrupt(): never { throw new HttpError(500, 'Stored automation configuration could not be verified', 'automation_settings_corrupt'); }

/** Storage mechanics only. The caller supplies the concrete observed-form
 * schema and canonical parser; no generic JSON configuration is exposed by HTTP.
 * Reading/saving configuration never starts classification or applies a rule.
 */
export class AutomationSettingsRepository<Configuration> {
  readonly store: Store;
  readonly defaults: () => Configuration;
  readonly parse: (value: unknown) => Configuration;
  readonly now: () => number;
  constructor(store: Store, defaults: () => Configuration, parse: (value: unknown) => Configuration, now = Date.now) {
    this.store = store; this.defaults = defaults; this.parse = parse; this.now = now;
    if (store.db.isTransaction) throw new Error('Automation initialization must own its startup transaction');
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.exec('CREATE TABLE IF NOT EXISTS automation_settings(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL)');
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  }
  account(accountId: string): Account {
    if (typeof accountId !== 'string' || !accountId || Buffer.byteLength(accountId) > 1024 || /[\x00-\x20\x7f]/.test(accountId)) invalid();
    const row = this.store.db.prepare("SELECT data FROM records WHERE kind='account' AND id=?").get(accountId);
    if (!row) throw new HttpError(404, 'Automation account not found', 'automation_not_found');
    try { const account = JSON.parse(String(row.data)) as Account;
      if (!account || account.id !== accountId || !['demo', 'google'].includes(account.provider)) corrupt();
      return account;
    } catch { return corrupt(); }
  }
  get(accountId: string): AutomationSettingsEnvelope<Configuration> {
    const account = this.account(accountId);
    const row = this.store.db.prepare('SELECT revision,data FROM automation_settings WHERE account_id=?').get(accountId);
    let configuration: Configuration, revision = 0, updatedAt: string | null = null;
    if (row) {
      try {
        const value = JSON.parse(String(row.data));
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.accountId !== accountId || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision !== row.revision || typeof value.updatedAt !== 'string' || new Date(value.updatedAt).toISOString() !== value.updatedAt) corrupt();
        configuration = this.parse(value.configuration);
        if (automationHash(configuration) !== value.configurationHash) corrupt();
        revision = value.revision; updatedAt = value.updatedAt;
      } catch { return corrupt(); }
    } else configuration = this.parse(this.defaults());
    return { accountId, revision, configuration: structuredClone(configuration), configurationHash: automationHash(configuration), updatedAt,
      processing: account.provider === 'demo' ? 'manual-demo-only' : 'unavailable', providerEffects: false };
  }
  save(accountId: string, expectedRevision: number, input: unknown): AutomationSettingsEnvelope<Configuration> {
    this.account(accountId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) invalid();
    const configuration = this.parse(input);
    if (Buffer.byteLength(JSON.stringify(configuration)) > 65536) invalid();
    const ownTransaction = !this.store.db.isTransaction;
    if (ownTransaction) this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(accountId);
      if (current.revision !== expectedRevision) throw new HttpError(409, 'Automation settings changed; reload before saving', 'automation_revision_conflict');
      const configurationHash = automationHash(configuration);
      if (configurationHash === current.configurationHash) { if (ownTransaction) this.store.db.exec('COMMIT'); return current; }
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'Automation settings revision is exhausted', 'automation_revision_conflict');
      const next = { ...current, configuration: structuredClone(configuration), configurationHash, revision: current.revision + 1, updatedAt: new Date(this.now()).toISOString() };
      this.store.db.prepare('INSERT INTO automation_settings VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(accountId, next.revision, JSON.stringify(next));
      if (ownTransaction) this.store.db.exec('COMMIT');
      return structuredClone(next);
    } catch (error) { if (ownTransaction) this.store.db.exec('ROLLBACK'); throw error; }
  }
}
