import type { SqlDatabase as DatabaseSync } from './sql-database.ts';
import { domainToASCII } from 'node:url';
import { insertInJsonBatches } from './bounded-json-insert.ts';
import { HttpError, type ContactSuggestion, type ContactSuggestionOptions, type ContactSuggestionPage } from './types.ts';

type Occurrence = { email: string; name: string; lastSeen: number; nameSeen: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const wellFormed = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
const binaryCompare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// Imported Person fields are metadata, not trusted header syntax. This first
// local index supports bare addresses, not quoted local parts or mailbox lists.
function contact(value: unknown): { email: string; name: string } | undefined {
  if (!object(value) || typeof value.email !== 'string' || !wellFormed(value.email) || /[\p{Cc}\p{Cf}]/u.test(value.email)) return;
  const input = value.email.normalize('NFKC').trim();
  const parts = input.split('@'); if (parts.length !== 2) return;
  const local = parts[0].toLowerCase();
  // domainToASCII uses URL-host parsing, which rewrites numeric ASCII hosts as
  // IPv4 (12.34 -> 12.0.0.34). Mailbox DNS labels are literal identities.
  const labels = parts[1].toLowerCase().replace(/[。．｡]/gu, '.').split('.').map(label => /^[\x00-\x7f]*$/.test(label) ? label : domainToASCII(label));
  if (labels.some(label => !label || label.includes('.'))) return;
  const domain = labels.join('.');
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)) return;
  if (!domain || domain.length > 253 || !domain.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) return;
  const email = `${local}@${domain}`; if (Buffer.byteLength(email) > 254) return;
  let name = typeof value.name === 'string' && wellFormed(value.name) && !/[\p{Cc}\p{Cf}]/u.test(value.name) ? value.name.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
  if (name.length > 512) name = '';
  // Decode one surrounding quoted-string wrapper; keep embedded commas/quotes.
  if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(["\\])/g, '$1').trim();
  if (normalized(name) === normalized(input) || normalized(name) === email) name = '';
  return { email, name };
}

export function normalizeContactEmail(raw: string): string | undefined { return contact({ email: raw })?.email; }

function metadata(raw: string): Occurrence[] {
  const thread: unknown = JSON.parse(raw); if (!object(thread)) return [];
  const people = new Map<string, Occurrence>();
  const stamp = (raw: unknown) => typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? Date.parse(raw) : 0;
  const add = (raw: unknown, date: number, fallback = false) => {
    const person = contact(raw); if (!person || (fallback && people.has(person.email))) return;
    const current = people.get(person.email);
    const useName = !!person.name && (!current?.name || date > current.nameSeen || (date === current.nameSeen && binaryCompare(person.name, current.name) < 0));
    people.set(person.email, { email: person.email, name: useName ? person.name : current?.name ?? '', lastSeen: current ? Math.max(current.lastSeen, date) : date, nameSeen: useName ? date : current?.nameSeen ?? 0 });
  };
  for (const message of Array.isArray(thread.messages) ? thread.messages : []) {
    if (!object(message)||(message.reminderContactEligible===false||message.reminderContactEligible===0)) continue;
    const date = stamp(message.date); add(message.sender, date);
    for (const key of ['to', 'cc']) for (const person of Array.isArray(message[key]) ? message[key] : []) add(person, date);
  }
  if(thread.reminderContactEligible!==false&&thread.reminderContactEligible!==0){const date = stamp(thread.lastMessageAt); add(thread.sender, date, true);
  for (const person of Array.isArray(thread.participants) ? thread.participants : []) add(person, date, true)}
  return [...people.values()];
}

function terms(name: string): string {
  const text = normalized(name);
  return JSON.stringify([...new Set([text, ...(text.match(/[\p{L}\p{N}@._+-]+/gu) ?? [])].filter(Boolean))]);
}

// Persisted triggers use only built-in SQLite functions. A connection running an
// older application can therefore invalidate/enqueue metadata without knowing
// any JS functions. The snapshot deliberately excludes bodies and attachments.
const snapshot = (data: string) => `json_object('reminderContactEligible',json_extract(${data},'$.reminderContactEligible'),'sender',json_extract(${data},'$.sender'),'participants',json(CASE WHEN json_type(${data},'$.participants')='array' THEN json_extract(${data},'$.participants') ELSE '[]' END),'lastMessageAt',COALESCE(json_extract(${data},'$.reminderContactAt'),json_extract(${data},'$.lastMessageAt')),'messages',json(COALESCE((SELECT json_group_array(json_object('reminderContactEligible',json_extract(message.value,'$.reminderContactEligible'),'sender',json_extract(message.value,'$.sender'),'to',json(CASE WHEN json_type(message.value,'$.to')='array' THEN json_extract(message.value,'$.to') ELSE '[]' END),'cc',json(CASE WHEN json_type(message.value,'$.cc')='array' THEN json_extract(message.value,'$.cc') ELSE '[]' END),'date',json_extract(message.value,'$.date'))) FROM json_each(${data},'$.messages') AS message),'[]')))`;

export function initializeRecipientContacts(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS recipient_occurrences(
        thread_id TEXT NOT NULL,account_id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,
        last_seen INTEGER NOT NULL,name_seen INTEGER NOT NULL,name_terms TEXT NOT NULL,PRIMARY KEY(thread_id,email));
      CREATE INDEX IF NOT EXISTS recipient_occurrence_recent ON recipient_occurrences(account_id,email,last_seen DESC);
      CREATE INDEX IF NOT EXISTS recipient_occurrence_name ON recipient_occurrences(account_id,email,name_seen DESC,name) WHERE name<>'';
      CREATE TABLE IF NOT EXISTS recipient_contacts(
        account_id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,last_seen INTEGER NOT NULL,name_seen INTEGER NOT NULL,
        occurrences INTEGER NOT NULL,name_terms TEXT NOT NULL,PRIMARY KEY(account_id,email));
      CREATE TABLE IF NOT EXISTS recipient_terms(
        account_id TEXT NOT NULL,term TEXT NOT NULL,email TEXT NOT NULL,PRIMARY KEY(account_id,term,email),
        FOREIGN KEY(account_id,email) REFERENCES recipient_contacts(account_id,email) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS recipient_pending(thread_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,metadata TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recipient_pending_account ON recipient_pending(account_id,thread_id);`);
    for (const table of ['recipient_contacts', 'recipient_occurrences']) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'name_terms')) db.exec(`ALTER TABLE ${table} ADD COLUMN name_terms TEXT NOT NULL DEFAULT '[]'`);
    const migrated = !!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('recipient-contacts-v3');
    const presentationMigrated=!!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('recipient-contacts-reminder-metadata-v1');if(!presentationMigrated)for(const name of['recipient_thread_insert','recipient_thread_update','recipient_thread_delete'])db.exec('DROP TRIGGER IF EXISTS '+name);
    if (!migrated) for (const name of ['contact_insert', 'contact_update', 'contact_delete', 'occurrence_insert', 'occurrence_delete', 'thread_insert', 'thread_update', 'thread_delete']) db.exec(`DROP TRIGGER IF EXISTS recipient_${name}`);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS recipient_contact_insert AFTER INSERT ON recipient_contacts BEGIN
        INSERT OR IGNORE INTO recipient_terms SELECT NEW.account_id,value,NEW.email FROM json_each(NEW.name_terms);
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_contact_update AFTER UPDATE ON recipient_contacts WHEN OLD.name_terms<>NEW.name_terms BEGIN
        DELETE FROM recipient_terms WHERE account_id=OLD.account_id AND email=OLD.email;
        INSERT OR IGNORE INTO recipient_terms SELECT NEW.account_id,value,NEW.email FROM json_each(NEW.name_terms);
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_contact_delete AFTER DELETE ON recipient_contacts BEGIN
        DELETE FROM recipient_terms WHERE account_id=OLD.account_id AND email=OLD.email;
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_occurrence_insert AFTER INSERT ON recipient_occurrences BEGIN
        INSERT INTO recipient_contacts(account_id,email,name,last_seen,name_seen,occurrences,name_terms) VALUES(NEW.account_id,NEW.email,NEW.name,NEW.last_seen,NEW.name_seen,1,NEW.name_terms)
        ON CONFLICT(account_id,email) DO UPDATE SET
          name=CASE WHEN excluded.name<>'' AND (recipient_contacts.name='' OR excluded.name_seen>recipient_contacts.name_seen OR (excluded.name_seen=recipient_contacts.name_seen AND excluded.name<recipient_contacts.name)) THEN excluded.name ELSE recipient_contacts.name END,
          name_terms=CASE WHEN excluded.name<>'' AND (recipient_contacts.name='' OR excluded.name_seen>recipient_contacts.name_seen OR (excluded.name_seen=recipient_contacts.name_seen AND excluded.name<recipient_contacts.name)) THEN excluded.name_terms ELSE recipient_contacts.name_terms END,
          name_seen=CASE WHEN excluded.name<>'' AND (recipient_contacts.name='' OR excluded.name_seen>recipient_contacts.name_seen OR (excluded.name_seen=recipient_contacts.name_seen AND excluded.name<recipient_contacts.name)) THEN excluded.name_seen ELSE recipient_contacts.name_seen END,
          last_seen=MAX(recipient_contacts.last_seen,excluded.last_seen),occurrences=recipient_contacts.occurrences+1;
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_occurrence_delete AFTER DELETE ON recipient_occurrences BEGIN
        UPDATE recipient_contacts SET occurrences=occurrences-1,
          last_seen=COALESCE((SELECT last_seen FROM recipient_occurrences WHERE account_id=OLD.account_id AND email=OLD.email ORDER BY last_seen DESC LIMIT 1),0),
          name=COALESCE((SELECT name FROM recipient_occurrences WHERE account_id=OLD.account_id AND email=OLD.email AND name<>'' ORDER BY name_seen DESC,name LIMIT 1),''),
          name_terms=COALESCE((SELECT name_terms FROM recipient_occurrences WHERE account_id=OLD.account_id AND email=OLD.email AND name<>'' ORDER BY name_seen DESC,name LIMIT 1),'[]'),
          name_seen=COALESCE((SELECT name_seen FROM recipient_occurrences WHERE account_id=OLD.account_id AND email=OLD.email AND name<>'' ORDER BY name_seen DESC,name LIMIT 1),0)
          WHERE account_id=OLD.account_id AND email=OLD.email;
        DELETE FROM recipient_contacts WHERE account_id=OLD.account_id AND email=OLD.email AND occurrences<=0;
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_thread_insert AFTER INSERT ON records WHEN NEW.kind='thread' BEGIN
        DELETE FROM recipient_occurrences WHERE thread_id=NEW.id;
        INSERT OR REPLACE INTO recipient_pending VALUES(NEW.id,json_extract(NEW.data,'$.accountId'),${snapshot('NEW.data')});
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_thread_update AFTER UPDATE ON records WHEN OLD.kind='thread' OR NEW.kind='thread' BEGIN
        DELETE FROM recipient_occurrences WHERE thread_id=OLD.id AND OLD.kind='thread';
        DELETE FROM recipient_pending WHERE thread_id=OLD.id AND OLD.kind='thread';
        INSERT OR REPLACE INTO recipient_pending SELECT NEW.id,json_extract(NEW.data,'$.accountId'),${snapshot('NEW.data')} WHERE NEW.kind='thread';
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_thread_delete AFTER DELETE ON records WHEN OLD.kind='thread' BEGIN
        DELETE FROM recipient_occurrences WHERE thread_id=OLD.id;
        DELETE FROM recipient_pending WHERE thread_id=OLD.id;
      END;`);
    if (!migrated) {
      db.exec(`INSERT OR REPLACE INTO recipient_pending SELECT id,json_extract(data,'$.accountId'),${snapshot('data')} FROM records WHERE kind='thread'`);
      db.prepare('INSERT INTO schema_migrations VALUES(?)').run('recipient-contacts-v3');
    }
    if(!presentationMigrated)db.prepare('INSERT INTO schema_migrations VALUES(?)').run('recipient-contacts-reminder-metadata-v1');
    while (refreshRecipientContacts(db, { limit: 256 })) { /* Startup metadata backfill; original records are untouched. */ }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function refreshRecipientContacts(db: DatabaseSync, options: { accountId?: string; threadId?: string; limit?: number } = {}): number {
  db.exec('SAVEPOINT recipient_projection_refresh');
  try {
    const rows = options.threadId !== undefined
      ? db.prepare('DELETE FROM recipient_pending WHERE thread_id=? RETURNING *').all(options.threadId)
      : options.accountId !== undefined
        ? db.prepare('DELETE FROM recipient_pending WHERE thread_id IN (SELECT thread_id FROM recipient_pending WHERE account_id=? ORDER BY thread_id LIMIT ?) RETURNING *').all(options.accountId, options.limit ?? 64)
        : db.prepare('DELETE FROM recipient_pending WHERE thread_id IN (SELECT thread_id FROM recipient_pending ORDER BY thread_id LIMIT ?) RETURNING *').all(options.limit ?? 64);
    const insert = db.prepare(`INSERT INTO recipient_occurrences(thread_id,account_id,email,name,last_seen,name_seen,name_terms)
      SELECT ?,?,json_extract(person.value,'$[0]'),json_extract(person.value,'$[1]'),json_extract(person.value,'$[2]'),json_extract(person.value,'$[3]'),json_extract(person.value,'$[4]')
      FROM json_each(?) AS person ORDER BY CAST(person.key AS INTEGER)`);
    let singleton: ReturnType<DatabaseSync['prepare']> | undefined;
    for (const row of rows) {
      db.prepare('DELETE FROM recipient_occurrences WHERE thread_id=?').run(row.thread_id);
      const people = metadata(String(row.metadata));
      insertInJsonBatches((function* () { for (const person of people) yield [person.email, person.name, person.lastSeen, person.nameSeen, terms(person.name)]; })(),
        json => { insert.run(row.thread_id, row.account_id, json); },
        person => { singleton ??= db.prepare('INSERT INTO recipient_occurrences(thread_id,account_id,email,name,last_seen,name_seen,name_terms) VALUES(?,?,?,?,?,?,?)'); singleton.run(row.thread_id, row.account_id, ...person); });
    }
    db.exec('RELEASE recipient_projection_refresh'); return rows.length;
  } catch (error) { db.exec('ROLLBACK TO recipient_projection_refresh; RELEASE recipient_projection_refresh'); throw error; }
}

function upperBound(prefix: string): string | null {
  const points = [...prefix];
  while (points.length) {
    const point = points.pop()!.codePointAt(0)!;
    if (point < 0x10ffff) return `${points.join('')}${String.fromCodePoint(point + 1 === 0xd800 ? 0xe000 : point + 1)}`;
  }
  return null;
}

export const recipientSuggestionSql = `WITH candidates AS (
  SELECT email,CASE WHEN email=? THEN 0 ELSE 1 END AS rank FROM recipient_contacts WHERE account_id=? AND email>=? AND email<?
  UNION ALL SELECT email,2 AS rank FROM recipient_terms WHERE account_id=? AND term>=? AND term<?
), matches AS (SELECT email,MIN(rank) AS rank FROM candidates GROUP BY email)
SELECT contact.email,contact.name FROM matches CROSS JOIN recipient_contacts AS contact ON contact.account_id=? AND contact.email=matches.email
ORDER BY matches.rank,contact.last_seen DESC,contact.email LIMIT ?`;

export function recipientSuggestions(db: DatabaseSync, options: ContactSuggestionOptions): ContactSuggestionPage {
  const limit = options.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new HttpError(400, 'Suggestion limit must be an integer from 1 to 5', 'invalid_limit');
  if (typeof options.q !== 'string' || options.q.length > 200 || !wellFormed(options.q) || /[\p{Cc}\p{Cf}]/u.test(options.q)) throw new HttpError(400, 'Suggestion query must be at most 200 characters without control characters', 'invalid_query');
  const query = normalized(options.q);
  if (query.length > 200) throw new HttpError(400, 'Normalized suggestion query is too long', 'invalid_query');
  if (!query) return { contacts: [], source: 'local-message-participants', limited: true };
  refreshRecipientContacts(db, { accountId: options.accountId, limit: 64 });
  const upper = upperBound(query);
  const sql = upper === null ? recipientSuggestionSql.replace(' AND email<?', '').replace(' AND term<?', '') : recipientSuggestionSql;
  const parameters = upper === null ? [query, options.accountId, query, options.accountId, query, options.accountId, limit] : [query, options.accountId, query, upper, options.accountId, query, upper, options.accountId, limit];
  const contacts = db.prepare(sql).all(...parameters).map(row => {
    const email = String(row.email); const name = String(row.name);
    return { name: name || email, email, formatted: name ? `"${name.replace(/["\\]/g, '\\$&')}" <${email}>` : email } satisfies ContactSuggestion;
  });
  return { contacts, source: 'local-message-participants', limited: true };
}
