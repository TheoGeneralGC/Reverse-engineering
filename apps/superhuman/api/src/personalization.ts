import { createHash } from 'node:crypto';
import { Store } from './store.ts';
import { HttpError, type Account } from './types.ts';
import { PERSONALIZATION_FIELDS, type PersonalizationSettings, type PersonalizationSnapshot } from './personalization-types.ts';

function invalid(message: string): never { throw new HttpError(400, message, 'personalization_invalid'); }
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid('Unexpected personalization fields');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, multiline: boolean): string {
  if (typeof value !== 'string' || value.length > maximum || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) invalid(`Enter valid text of at most ${maximum} characters`);
  for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i); if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('Invalid Unicode text'); } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid('Invalid Unicode text'); }
  return value;
}
function factId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid('Invalid fact identity'); return value; }
export function emptyPersonalization(accountId: string): PersonalizationSettings {
  return { accountId, revision: 0, enabled: true, greeting: '', signoff: '', jobTitle: '', company: '', companyDescription: '', writing: '', scheduling: '', events: '', facts: [], updatedAt: null };
}

/** Per-account staged settings. Reads never create records or call a model. */
export class PersonalizationService {
  readonly store: Store;
  readonly now: () => number;
  constructor(store: Store, now = Date.now) { this.store = store; this.now = now; }
  get(accountId: string): PersonalizationSettings {
    this.store.required<Account>('account', accountId);
    const row = this.store.db.prepare("SELECT data FROM records WHERE kind='personalization' AND id=?").get(accountId);
    if (!row) return emptyPersonalization(accountId);
    let stored: PersonalizationSettings;
    try { stored = JSON.parse(String(row.data)); } catch { throw new HttpError(500, 'Stored personalization is invalid', 'personalization_corrupt'); }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new HttpError(500, 'Stored personalization is invalid', 'personalization_corrupt');
    if (stored.accountId !== accountId || !Number.isSafeInteger(stored.revision) || stored.revision < 0 || typeof stored.enabled !== 'boolean' || !Array.isArray(stored.facts)) throw new HttpError(500, 'Stored personalization is invalid', 'personalization_corrupt');
    try {
      for (const key of PERSONALIZATION_FIELDS) text(stored[key], 5000, ['writing', 'scheduling', 'events'].includes(key));
      const ids = new Set<string>(); let active = 0, removed = 0;
      for (const fact of stored.facts) { if (!fact || typeof fact !== 'object') invalid('Invalid stored fact'); const id = factId(fact.id); text(fact.text, 1000, true); if (!fact.text.trim() || ids.has(id)) invalid('Invalid stored fact'); ids.add(id); if (fact.deletedAt === null) active++; else { if (typeof fact.deletedAt !== 'string' || new Date(fact.deletedAt).toISOString() !== fact.deletedAt) invalid('Invalid fact removal time'); removed++; } }
      if (active > 100 || removed > 512 || (stored.updatedAt !== null && (typeof stored.updatedAt !== 'string' || new Date(stored.updatedAt).toISOString() !== stored.updatedAt))) invalid('Invalid stored settings');
    } catch { throw new HttpError(500, 'Stored personalization is invalid', 'personalization_corrupt'); }
    return structuredClone(stored);
  }
  patch(accountId: string, input: unknown): PersonalizationSettings {
    const request = object(input, ['expectedRevision', 'changes']);
    if (!Number.isSafeInteger(request.expectedRevision) || (request.expectedRevision as number) < 0) invalid('Expected the current personalization revision');
    const changes = object(request.changes, [...PERSONALIZATION_FIELDS, 'facts']);
    const fields: Record<string, string> = {};
    for (const key of PERSONALIZATION_FIELDS) if (Object.hasOwn(changes, key)) fields[key] = text(changes[key], 5000, ['writing', 'scheduling', 'events'].includes(key));
    let suppliedFacts: { id: string; text: string }[] | undefined;
    if (Object.hasOwn(changes, 'facts')) {
      if (!Array.isArray(changes.facts) || changes.facts.length > 100) invalid('At most 100 active facts are supported');
      const ids = new Set<string>();
      suppliedFacts = changes.facts.map(value => { const item = object(value, ['id', 'text']), id = factId(item.id), valueText = text(item.text, 1000, true); if (!valueText.trim() || ids.has(id)) invalid('Facts need unique identities and nonempty text'); ids.add(id); return { id, text: valueText }; });
    }
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(accountId);
      if (current.revision !== request.expectedRevision) throw new HttpError(409, 'Personalization changed elsewhere. Reload before saving.', 'personalization_conflict');
      const at = new Date(this.now()).toISOString();
      let facts = current.facts;
      if (suppliedFacts) {
        const byId = new Map(current.facts.map(fact => [fact.id, fact]));
        if (suppliedFacts.some(fact => byId.get(fact.id)?.deletedAt)) throw new HttpError(409, 'A removed fact cannot be silently restored', 'personalization_fact_removed');
        const suppliedIds = new Set(suppliedFacts.map(fact => fact.id));
        const removed = current.facts.filter(fact => fact.deletedAt || !suppliedIds.has(fact.id)).map(fact => fact.deletedAt ? fact : { ...fact, deletedAt: at });
        if (removed.length > 512) throw new HttpError(409, 'The retained fact history is full', 'personalization_history_full');
        facts = [...suppliedFacts.map(fact => ({ ...byId.get(fact.id), ...fact, deletedAt: null })), ...removed];
      }
      if (Object.entries(fields).every(([key, value]) => current[key as keyof PersonalizationSettings] === value) && JSON.stringify(facts) === JSON.stringify(current.facts)) { this.store.db.exec('COMMIT'); return current; }
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'Personalization revision is exhausted', 'personalization_revision_exhausted');
      const next = { ...current, ...fields, facts, revision: current.revision + 1, updatedAt: at };
      this.store.put('personalization', accountId, next);
      this.store.db.exec('COMMIT'); return structuredClone(next);
    } catch (error) { if (this.store.db.isTransaction) this.store.db.exec('ROLLBACK'); throw error; }
  }
  /** Bounded, revisioned user preferences; supplied as untrusted data, never tool authorization. */
  snapshot(accountId: string, maximumCharacters = 32000): PersonalizationSnapshot {
    if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 2 || maximumCharacters > 200000) throw new TypeError('Invalid personalization context budget');
    const settings = this.get(accountId);
    const value = { ...Object.fromEntries(PERSONALIZATION_FIELDS.filter(key => settings[key]).map(key => [key, settings[key]])), facts: settings.facts.filter(fact => !fact.deletedAt).map(fact => ({ id: fact.id, text: fact.text })) };
    const complete = settings.enabled ? JSON.stringify(value) : '';
    // Count the JSON string wrapper as well: quotes/newlines in preference data
    // must not expand beyond the provider context allowance after serialization.
    const fits = (encoded: string) => encoded.length <= maximumCharacters && Buffer.byteLength(JSON.stringify({ text: encoded }), 'utf8') <= 24576;
    let supplied = complete;
    if (!fits(complete)) {
      const bounded: Record<string, unknown> = {};
      const clip = (value: string, length: number) => { let result = value.slice(0, length); if (/[\ud800-\udbff]$/.test(result)) result = result.slice(0, -1); return result; };
      const fittingPrefix = (value: string, candidate: (prefix: string) => unknown): string => {
        let lower = 0, upper = value.length;
        while (lower < upper) { const mid = Math.ceil((lower + upper) / 2); if (fits(JSON.stringify(candidate(clip(value, mid))))) lower = mid; else upper = mid - 1; }
        return clip(value, lower);
      };
      for (const key of PERSONALIZATION_FIELDS) {
        if (!settings[key]) continue;
        const prefix = fittingPrefix(settings[key], prefix => ({ ...bounded, [key]: prefix }));
        if (prefix) bounded[key] = prefix;
      }
      const facts: { id: string; text: string }[] = [];
      if (fits(JSON.stringify({ ...bounded, facts }))) {
        bounded.facts = facts;
        for (const fact of value.facts) {
          const prefix = fittingPrefix(fact.text, prefix => ({ ...bounded, facts: [...facts, { id: fact.id, text: prefix }] }));
          if (prefix) facts.push({ id: fact.id, text: prefix });
        }
      }
      supplied = JSON.stringify(bounded);
    }
    return { accountId, revision: settings.revision, hash: createHash('sha256').update(JSON.stringify({ accountId, revision: settings.revision, enabled: settings.enabled, value })).digest('hex'), enabled: settings.enabled, text: supplied, totalCharacters: complete.length, suppliedCharacters: supplied.length, totalBytes: Buffer.byteLength(complete, 'utf8'), suppliedBytes: Buffer.byteLength(supplied, 'utf8'), truncated: supplied !== complete };
  }
}
