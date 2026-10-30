import type { SqlDatabase as DatabaseSync } from './sql-database.ts';
import { normalizeContactEmail, refreshRecipientContacts } from './contacts.ts';
import { HttpError, type ContactContextOptions, type ContactContextPage, type ThreadSummary } from './types.ts';

const invalid = (): never => { throw new HttpError(400, 'Invalid contact context query', 'invalid_contact_context'); };
const unsafe = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\uD800-\uDFFF]/u;

// Classification occurs only on write/backfill. Aggregate DRAFT membership alone
// is insufficient: received mail plus an unsent reply must remain visible.
const draftOnly = (data: string) => `CASE
  WHEN EXISTS(SELECT 1 FROM json_each(${data},'$.messages') AS message WHERE json_type(message.value,'$.providerLabels')='array')
  THEN NOT EXISTS(SELECT 1 FROM json_each(${data},'$.messages') AS message
    WHERE COALESCE(json_type(message.value,'$.providerLabels'),'')<>'array'
      OR NOT EXISTS(SELECT 1 FROM json_each(message.value,'$.providerLabels') WHERE value='DRAFT'))
  ELSE COALESCE(json_extract(${data},'$.folder'),'')='drafts' END`;

export function initializeContactContext(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS recipient_thread_flags(thread_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,draft_only INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS recipient_flags_insert AFTER INSERT ON records WHEN NEW.kind='thread' BEGIN
        INSERT OR REPLACE INTO recipient_thread_flags VALUES(NEW.id,json_extract(NEW.data,'$.accountId'),${draftOnly('NEW.data')});
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_flags_update AFTER UPDATE ON records WHEN OLD.kind='thread' OR NEW.kind='thread' BEGIN
        DELETE FROM recipient_thread_flags WHERE thread_id=OLD.id AND OLD.kind='thread';
        INSERT OR REPLACE INTO recipient_thread_flags SELECT NEW.id,json_extract(NEW.data,'$.accountId'),${draftOnly('NEW.data')} WHERE NEW.kind='thread';
      END;
      CREATE TRIGGER IF NOT EXISTS recipient_flags_delete AFTER DELETE ON records WHEN OLD.kind='thread' BEGIN
        DELETE FROM recipient_thread_flags WHERE thread_id=OLD.id;
      END;`);
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('recipient-thread-flags-v1')) {
      db.exec(`INSERT OR REPLACE INTO recipient_thread_flags SELECT id,json_extract(data,'$.accountId'),${draftOnly('data')} FROM records WHERE kind='thread'`);
      db.prepare('INSERT INTO schema_migrations VALUES(?)').run('recipient-thread-flags-v1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Force membership candidates first, then exact summary/flag key lookups. This
// avoids a whole-account summary scan for a rare contact. Only matching metadata
// is ordered; original thread JSON is never selected.
export const contactContextSql = `SELECT summary.data
  FROM recipient_occurrences AS occurrence
  CROSS JOIN thread_summaries AS summary ON summary.id=occurrence.thread_id AND summary.account_id=occurrence.account_id
  CROSS JOIN recipient_thread_flags AS flags ON flags.thread_id=occurrence.thread_id AND flags.account_id=occurrence.account_id
  WHERE occurrence.account_id=? AND occurrence.email=? AND flags.draft_only=0 AND (? IS NULL OR summary.id<>?)
  ORDER BY summary.last_message_at DESC,summary.id DESC LIMIT 4`;

export function contactContext(db: DatabaseSync, options: ContactContextOptions): ContactContextPage {
  if (typeof options.accountId !== 'string' || !options.accountId.trim() || options.accountId.length > 512 || unsafe.test(options.accountId)) return invalid();
  if (typeof options.email !== 'string' || options.email.length > 320 || unsafe.test(options.email) || options.email.normalize('NFKC').length > 320) return invalid();
  if (options.excludeThreadId !== undefined && (typeof options.excludeThreadId !== 'string' || !options.excludeThreadId.trim() || options.excludeThreadId.length > 1024 || unsafe.test(options.excludeThreadId))) return invalid();
  const raw = options.email.trim(); const email = normalizeContactEmail(raw);
  const empty: ContactContextPage = { contact: { name: email ?? raw, email: email ?? raw }, matched: false, threads: [], source: 'local-message-participants', limited: true };
  if (!email) return empty;
  refreshRecipientContacts(db, { accountId: options.accountId, limit: 64 });
  const person = db.prepare('SELECT name FROM recipient_contacts WHERE account_id=? AND email=?').get(options.accountId, email);
  if (!person) return empty;
  const exclude = options.excludeThreadId ?? null;
  const threads = db.prepare(contactContextSql).all(options.accountId, email, exclude, exclude).map(row => {
    const summary = JSON.parse(String(row.data)) as ThreadSummary & Record<string, unknown>;
    for (const key of Object.keys(summary)) if (summary[key] === null) delete summary[key];
    return summary;
  });
  return { ...empty, contact: { name: String(person.name), email }, matched: true, threads };
}
