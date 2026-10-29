import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { HttpError, type ThreadListOptions, type ThreadListPage, type ThreadSummary } from './types.ts';
import { normalizeSearchTimeZone } from './search.ts';

// Explicit metadata projection: adding a content-bearing field to Thread cannot
// accidentally expose it in a list response. This projection runs only on write
// or migration, never during a common list/count request.
const field = (name: string) => `json_extract(data,'$.${name}')`;
const flag = (name: string) => `COALESCE(${field(name)},0)<>0`;
const array = (name: string) => `json(COALESCE(${field(name)},'[]'))`;
const membership = (name: string, providerLabel: string) => `CASE WHEN json_type(data,'$.providerLabels')='array' THEN EXISTS(SELECT 1 FROM json_each(data,'$.providerLabels') WHERE value='${providerLabel}') ELSE ${field('folder')}='${name}' END`;
const projection = `SELECT id,${field('accountId')},${field('lastMessageAt')},${field('folder')},
  ${membership('inbox', 'INBOX')},${membership('sent', 'SENT')},${membership('trash', 'TRASH')},${membership('spam', 'SPAM')},${membership('drafts', 'DRAFT')},
  ${flag('starred')},${flag('important')},COALESCE(${field('snoozedUntil')},'')<>'',${flag('muted')},
  EXISTS(SELECT 1 FROM json_each(data,'$.labels') WHERE instr(lower(CAST(value AS TEXT)),'calendar')>0),${array('labels')},
  json_object('id',id,'accountId',${field('accountId')},'providerId',${field('providerId')},
    'subject',${field('subject')},'snippet',${field('snippet')},'sender',json(${field('sender')}),'participants',${array('participants')},
    'lastMessageAt',${field('lastMessageAt')},'unread',json(CASE WHEN ${flag('unread')} THEN 'true' ELSE 'false' END),
    'starred',json(CASE WHEN ${flag('starred')} THEN 'true' ELSE 'false' END),'important',json(CASE WHEN ${flag('important')} THEN 'true' ELSE 'false' END),
    'folder',${field('folder')},'labels',${array('labels')},'snoozedUntil',${field('snoozedUntil')},'snoozeRetryAt',${field('snoozeRetryAt')},
    'snoozeError',${field('snoozeError')},'split',${field('split')},'muted',json(CASE WHEN ${flag('muted')} THEN 'true' ELSE 'false' END),
    'providerLabels',json(${field('providerLabels')}),'messageCount',COALESCE(json_array_length(data,'$.messages'),0),
    'hasAttachments',json(CASE WHEN EXISTS(SELECT 1 FROM json_each(data,'$.messages') AS message JOIN json_each(message.value,'$.attachments') AS attachment) THEN 'true' ELSE 'false' END))
  FROM records`;

export function initializeThreadSummaries(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS thread_summaries(
        id TEXT PRIMARY KEY,account_id TEXT NOT NULL,last_message_at TEXT NOT NULL,folder TEXT NOT NULL,
        inbox INTEGER NOT NULL,sent INTEGER NOT NULL,trash INTEGER NOT NULL,spam INTEGER NOT NULL,drafts INTEGER NOT NULL,
        starred INTEGER NOT NULL,important INTEGER NOT NULL,snoozed INTEGER NOT NULL,muted INTEGER NOT NULL,calendar INTEGER NOT NULL,
        labels TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_summary_account_date ON thread_summaries(account_id,last_message_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS thread_summary_inbox_date ON thread_summaries(account_id,inbox,snoozed,last_message_at DESC,id DESC);
      CREATE TRIGGER IF NOT EXISTS thread_summary_insert AFTER INSERT ON records WHEN NEW.kind='thread' BEGIN
        INSERT OR REPLACE INTO thread_summaries ${projection} WHERE kind='thread' AND id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS thread_summary_update AFTER UPDATE ON records WHEN OLD.kind='thread' OR NEW.kind='thread' BEGIN
        DELETE FROM thread_summaries WHERE id=OLD.id AND OLD.kind='thread';
        INSERT OR REPLACE INTO thread_summaries ${projection} WHERE kind='thread' AND id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS thread_summary_delete AFTER DELETE ON records WHEN OLD.kind='thread' BEGIN
        DELETE FROM thread_summaries WHERE id=OLD.id;
      END;`);
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('thread-summaries-v1')) {
      db.exec(`INSERT OR REPLACE INTO thread_summaries ${projection} WHERE kind='thread'`);
      db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run('thread-summaries-v1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

type Context = { accountId: string; folder: string; q: string; split: NonNullable<ThreadListOptions['split']>; timeZone?: string };
type Position = { date: string; id: string };
const contextKey = (context: Context) => createHash('sha256').update(JSON.stringify(context)).digest('base64url');
function decodeCursor(input: string | null | undefined, context: Context): Position | undefined {
  if (!input) return undefined;
  try {
    if (input.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error();
    const bytes = Buffer.from(input, 'base64url'); if (bytes.toString('base64url') !== input) throw new Error();
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const cursor = value as Record<string, unknown>;
    if (Object.keys(cursor).sort().join(',') !== 'context,date,id,v' || cursor.v !== 1 || cursor.context !== contextKey(context) || typeof cursor.date !== 'string' || cursor.date.length > 128 || !Number.isFinite(Date.parse(cursor.date)) || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 1024) throw new Error();
    return { date: cursor.date, id: cursor.id };
  } catch { throw new HttpError(400, 'Invalid cursor or cursor belongs to a different mailbox query', 'invalid_cursor'); }
}
function encodeCursor(thread: ThreadSummary, context: Context) { return Buffer.from(JSON.stringify({ v: 1, context: contextKey(context), date: thread.lastMessageAt, id: thread.id })).toString('base64url'); }
function readSummary(value: unknown): ThreadSummary {
  const result = JSON.parse(String(value));
  for (const key of Object.keys(result)) if (result[key] === null) delete result[key];
  return result as ThreadSummary;
}
function folderCondition(folder: string): { sql: string; values: SQLInputValue[] } {
  if (folder === 'all') return { sql: "folder NOT IN ('trash','spam')", values: [] };
  if (folder === 'starred' || folder === 'snoozed') return { sql: `${folder}=1`, values: [] };
  if (folder === 'important' || folder === 'other') return { sql: `inbox=1 AND snoozed=0 AND important=${folder === 'important' ? 1 : 0}`, values: [] };
  if (folder.startsWith('label:')) return { sql: 'EXISTS(SELECT 1 FROM json_each(thread_summaries.labels) WHERE value=?)', values: [folder.slice(6)] };
  const alias = ({ archive: 'done', archived: 'done', reminders: 'snoozed', junk: 'spam', deleted: 'trash' } as Record<string, string>)[folder] ?? folder;
  if (alias === 'anywhere') return { sql: 'snoozed=0', values: [] };
  if (['inbox', 'sent', 'trash', 'spam', 'drafts', 'muted', 'snoozed'].includes(alias)) return { sql: `${alias}=1 AND snoozed=0`, values: [] };
  return { sql: 'folder=? AND snoozed=0', values: [alias] };
}

export function listThreadSummaries(db: DatabaseSync, options: ThreadListOptions, search: (accountId: string, query: string, timeZone?: string) => Set<string>): ThreadListPage {
  const timeZone = normalizeSearchTimeZone(options.timeZone);
  const context: Context = { accountId: options.accountId, folder: options.folder ?? 'inbox', q: (options.q ?? '').trim(), split: options.split ?? 'all', ...(timeZone === undefined ? {} : { timeZone }) };
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit must be an integer from 1 to 100', 'invalid_limit');
  if (!['all', 'important', 'other', 'calendar'].includes(context.split)) throw new HttpError(400, 'Invalid inbox split', 'invalid_split');
  const position = decodeCursor(options.cursor, context);
  const countsRow = db.prepare('SELECT COALESCE(SUM(inbox=1 AND snoozed=0),0) AS inbox,COALESCE(SUM(inbox=1 AND snoozed=0 AND important=1),0) AS important,COALESCE(SUM(inbox=1 AND snoozed=0 AND important=0),0) AS other,COALESCE(SUM(inbox=1 AND snoozed=0 AND calendar=1),0) AS calendar FROM thread_summaries WHERE account_id=?').get(context.accountId)!;
  const counts = { inbox: Number(countsRow.inbox), important: Number(countsRow.important), other: Number(countsRow.other), calendar: Number(countsRow.calendar) };
  let threads: ThreadSummary[]; let total: number;
  if (context.q) {
    // Preserve the existing local grammar, including body/filename/from:me
    // semantics. Only search falls back to full records, scoped by account.
    const matches = search(context.accountId, context.q, context.timeZone);
    const rows = db.prepare('SELECT id,last_message_at,data FROM thread_summaries WHERE account_id=? ORDER BY last_message_at DESC,id DESC').all(context.accountId).filter(row => matches.has(String(row.id)));
    total = rows.length;
    const dateBytes = position && Buffer.from(position.date); const idBytes = position && Buffer.from(position.id);
    threads = rows.filter(row => {
      if (!position) return true;
      // SQLite BINARY compares UTF-8 bytes; JavaScript string comparison uses
      // UTF-16 code units and can disagree for non-ASCII thread IDs.
      const dateOrder = Buffer.compare(Buffer.from(String(row.last_message_at)), dateBytes!);
      return dateOrder < 0 || (dateOrder === 0 && Buffer.compare(Buffer.from(String(row.id)), idBytes!) < 0);
    }).slice(0, limit + 1).map(row => readSummary(row.data));
  } else {
    const condition = folderCondition(context.folder); const values: SQLInputValue[] = [context.accountId, ...condition.values];
    let where = `account_id=? AND (${condition.sql})`;
    if (context.folder === 'inbox' && context.split !== 'all') where += context.split === 'calendar' ? ' AND calendar=1' : ` AND important=${context.split === 'important' ? 1 : 0}`;
    total = Number(db.prepare(`SELECT COUNT(*) AS total FROM thread_summaries WHERE ${where}`).get(...values)!.total);
    if (position) { where += ' AND (last_message_at,id)<(?,?)'; values.push(position.date, position.id); }
    threads = db.prepare(`SELECT data FROM thread_summaries WHERE ${where} ORDER BY last_message_at DESC,id DESC LIMIT ?`).all(...values, limit + 1).map(row => readSummary(row.data));
  }
  const hasMore = threads.length > limit; if (hasMore) threads.pop();
  return { threads, total, counts, nextCursor: hasMore ? encodeCursor(threads[threads.length - 1], context) : null, hasMore };
}
