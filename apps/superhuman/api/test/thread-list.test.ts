import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { initializeThreadSummaries } from '../src/thread-list.ts';
import type { Account, Thread } from '../src/types.ts';

const person = { name: 'Synthetic Sender', email: 'sender@example.test' };
function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return { id, accountId: 'account-a', subject: `Subject ${id}`, snippet: 'Preview', sender: person, participants: [person], lastMessageAt: '2026-10-27T12:00:00.000Z', unread: true, starred: false, important: true, folder: 'inbox', labels: [], messages: [{ id: `message-${id}`, sender: person, to: [{ name: 'Account A', email: 'a@example.test' }], date: '2026-10-27T12:00:00.000Z', text: 'PRIVATE_BODY_ONLY_NEVER_IN_SUMMARY', html: '<p>PRIVATE_HTML_ONLY_NEVER_IN_SUMMARY</p>', attachments: [] }], ...overrides };
}
function fixture() { const store = new Store(':memory:', false); store.put<Account>('account', 'account-a', { id: 'account-a', name: 'Account A', email: 'a@example.test', provider: 'demo', color: '#888' }); return store; }
const ids = (threads: { id: string }[]) => threads.map(value => value.id).sort();

test('summary pages never parse full mail, expose only explicit metadata and isolate accounts', () => {
  const store = fixture();
  for (let index = 0; index < 120; index++) store.put('thread', `a-${index}`, thread(`a-${index}`));
  store.put('thread', 'other-account', thread('other-account', { accountId: 'account-b' }));
  const attached = thread('attached'); attached.messages.push({ ...attached.messages[0], id: 'attached-message', attachments: [{ id: 'attachment', name: 'note.txt', mimeType: 'text/plain', size: 3 }] });
  store.put('thread', attached.id, { ...attached, futureBodyField: 'FUTURE_CONTENT_MUST_NOT_LEAK' });
  const originalParse = JSON.parse; let bodyParses = 0; let parsed = 0;
  JSON.parse = (input, reviver) => { parsed++; if (input.includes('PRIVATE_BODY_ONLY_NEVER_IN_SUMMARY')) bodyParses++; return originalParse(input, reviver); };
  try {
    const page = store.threadSummaries({ accountId: 'account-a' });
    assert.equal(page.threads.length, 50); assert.equal(page.total, 121); assert.equal(page.hasMore, true); assert.ok(page.nextCursor); assert.equal(page.counts.inbox, 121);
    assert.equal(bodyParses, 0); assert.equal(parsed, 51); assert.ok(page.threads.every(value => value.accountId === 'account-a'));
    const summary = store.threadSummaries({ accountId: 'account-a', q: 'subject:attached' }).threads[0];
    assert.equal(summary.messageCount, 2); assert.equal(summary.hasAttachments, true); assert.equal(summary.unread, true); assert.equal(typeof summary.important, 'boolean');
    const output = JSON.stringify(summary); assert.equal(output.includes('PRIVATE_BODY'), false); assert.equal(output.includes('PRIVATE_HTML'), false); assert.equal(output.includes('FUTURE_CONTENT'), false); assert.equal('messages' in summary, false); assert.equal('providerLabels' in summary, false);
    assert.equal(store.threadSummaries({ accountId: 'missing' }).total, 0);
  } finally { JSON.parse = originalParse; store.close(); }
});

test('all legacy folders retain mixed labels, empty provider arrays and snooze eligibility', () => {
  const store = fixture();
  const values = [
    thread('fallback'), thread('mixed', { providerLabels: ['INBOX', 'SENT', 'TRASH'], starred: true }),
    thread('empty-labels', { providerLabels: [] }), thread('primary-trash', { folder: 'trash', providerLabels: ['INBOX'] }),
    thread('snoozed', { snoozedUntil: '2099-01-01T00:00:00Z', starred: true, labels: ['label-one'], providerLabels: ['INBOX', 'SENT'] }),
    thread('other', { important: false }), thread('done', { folder: 'done', providerLabels: ['SENT'] }),
  ];
  for (const value of values) store.put('thread', value.id, value);
  try {
    for (const folder of ['inbox', 'important', 'other', 'sent', 'trash', 'spam', 'done', 'all', 'starred', 'snoozed', 'label:label-one', 'anywhere', 'archive', 'reminders']) {
      assert.deepEqual(ids(store.threadSummaries({ accountId: 'account-a', folder }).threads), ids(store.threads('account-a', folder)), folder);
    }
    assert.ok(store.threadSummaries({ accountId: 'account-a', folder: 'sent' }).threads.some(value => value.id === 'mixed'));
    assert.ok(!store.threadSummaries({ accountId: 'account-a' }).threads.some(value => value.id === 'empty-labels'));
  } finally { store.close(); }
});

test('splits and global inbox counts preserve Calendar overlap and ignore active search/folder', () => {
  const store = fixture();
  const values = [thread('important'), thread('calendar', { labels: ['Account:Calendar-Invites'] }), thread('other', { important: false }), thread('other-calendar', { important: false, labels: ['cAlEnDaR'] }), thread('snoozed', { snoozedUntil: '2099-01-01Z' }), thread('trash', { folder: 'trash' })];
  for (const value of values) store.put('thread', value.id, value);
  try {
    const important = store.threadSummaries({ accountId: 'account-a', split: 'important' }); assert.deepEqual(ids(important.threads), ['calendar', 'important']); assert.equal(important.total, 2);
    const other = store.threadSummaries({ accountId: 'account-a', split: 'other' }); assert.deepEqual(ids(other.threads), ['other', 'other-calendar']);
    const calendar = store.threadSummaries({ accountId: 'account-a', split: 'calendar' }); assert.deepEqual(ids(calendar.threads), ['calendar', 'other-calendar']);
    const counts = { inbox: 4, important: 2, other: 2, calendar: 2 }; assert.deepEqual(calendar.counts, counts);
    const search = store.threadSummaries({ accountId: 'account-a', folder: 'done', split: 'calendar', q: 'subject:trash' }); assert.deepEqual(ids(search.threads), ['trash']); assert.deepEqual(search.counts, counts);
    assert.deepEqual(ids(store.threadSummaries({ accountId: 'account-a', folder: 'inbox', split: 'other', q: ' \t ' }).threads), ['other', 'other-calendar']);
  } finally { store.close(); }
});

test('body, recipient, attachment and grouped search grammar use account-scoped fallback', () => {
  const store = fixture(); const first = thread('first'); first.messages[0].attachments = [{ id: 'a', name: 'plan.pdf', mimeType: 'application/pdf', size: 100 }];
  store.put('thread', first.id, first); store.put('thread', 'second', thread('second', { folder: 'trash', important: false, starred: true })); store.put('thread', 'unrelated', thread('unrelated', { accountId: 'account-b' }));
  try {
    for (const query of ['PRIVATE_BODY_ONLY', 'to:me', 'filename:plan.pdf', 'has:attachment', '(subject:first OR is:starred) -is:read', 'in:trash', '-in:inbox']) assert.deepEqual(ids(store.threadSummaries({ accountId: 'account-a', folder: 'inbox', split: 'calendar', q: query }).threads), ids(store.threads('account-a', 'inbox', query)), query);
  } finally { store.close(); }
});

test('keyset cursor handles equal timestamps and arrivals above its boundary without duplicates', () => {
  const store = fixture(); for (const id of ['a', 'b', 'c', 'd', 'e']) store.put('thread', id, thread(id));
  try {
    const first = store.threadSummaries({ accountId: 'account-a', limit: 2 }); assert.deepEqual(first.threads.map(value => value.id), ['e', 'd']); assert.equal(first.total, 5); assert.equal(first.hasMore, true);
    store.put('thread', 'newer', thread('newer', { lastMessageAt: '2026-10-27T13:00:00.000Z' }));
    const second = store.threadSummaries({ accountId: 'account-a', limit: 2, cursor: first.nextCursor }); assert.deepEqual(second.threads.map(value => value.id), ['c', 'b']); assert.equal(second.total, 6);
    const third = store.threadSummaries({ accountId: 'account-a', limit: 2, cursor: second.nextCursor }); assert.deepEqual(third.threads.map(value => value.id), ['a']); assert.equal(third.nextCursor, null); assert.equal(third.hasMore, false);
    assert.equal(store.threadSummaries({ accountId: 'account-a', limit: 2 }).threads[0].id, 'newer');
    assert.deepEqual(ids([...first.threads, ...second.threads, ...third.threads]), ['a', 'b', 'c', 'd', 'e']);
    const plan = store.db.prepare('EXPLAIN QUERY PLAN SELECT data FROM thread_summaries WHERE account_id=? AND inbox=1 AND snoozed=0 AND (last_message_at,id)<(?,?) ORDER BY last_message_at DESC,id DESC LIMIT 51').all('account-a', '2026-10-27T12:00:00.000Z', 'c').map(row => String(row.detail)); assert.ok(plan.some(detail => detail.includes('thread_summary_inbox_date') && detail.includes('last_message_at')));
  } finally { store.close(); }
});

test('cursors reject malformed data and reuse across account, folder, query and split', () => {
  const store = fixture(); for (const id of ['a', 'b', 'c']) store.put('thread', id, thread(id));
  try {
    const cursor = store.threadSummaries({ accountId: 'account-a', limit: 1 }).nextCursor!;
    for (const changes of [{ accountId: 'account-b' }, { folder: 'all' }, { q: 'subject:a' }, { split: 'important' as const }]) assert.throws(() => store.threadSummaries({ accountId: 'account-a', cursor, ...changes }), { code: 'invalid_cursor', status: 400 });
    for (const value of ['invalid!', Buffer.from('null').toString('base64url'), Buffer.from(JSON.stringify({ v: 1 })).toString('base64url'), 'a'.repeat(5000), `${cursor}=`]) assert.throws(() => store.threadSummaries({ accountId: 'account-a', cursor: value }), { code: 'invalid_cursor' });
    for (const limit of [0, -1, 101, 1.5, NaN]) assert.throws(() => store.threadSummaries({ accountId: 'account-a', limit }), { code: 'invalid_limit' });
    assert.throws(() => store.threadSummaries({ accountId: 'account-a', split: 'invalid' as 'all' }), { code: 'invalid_split' });
  } finally { store.close(); }
});

test('search cursor boundaries use the same UTF-8 ID ordering as SQLite for equal dates', () => {
  const store = fixture(); for (const id of ['\uE000', '\u{10000}']) store.put('thread', id, thread(id, { subject: 'Unicode cursor fixture' }));
  try {
    const first = store.threadSummaries({ accountId: 'account-a', q: 'subject:unicode', limit: 1 }); assert.equal(first.threads[0].id, '\u{10000}'); assert.equal(first.hasMore, true);
    const second = store.threadSummaries({ accountId: 'account-a', q: 'subject:unicode', limit: 1, cursor: first.nextCursor }); assert.equal(second.threads[0].id, '\uE000'); assert.equal(second.hasMore, false);
  } finally { store.close(); }
});

test('existing fixtures migrate without rewriting messages; triggers maintain writes, undo, removals and rollback atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-summary-migration-')); const path = join(directory, 'mail.sqlite');
  try {
    const legacy = new DatabaseSync(path); legacy.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))'); const raw = JSON.stringify(thread('existing')); legacy.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', 'existing', raw); legacy.close();
    let store = new Store(path, false); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 1); assert.equal(store.db.prepare("SELECT data FROM records WHERE kind='thread'").get()!.data, raw);
    const { before, thread: archived } = store.prepareAction('existing', 'archive'); const { undoId } = store.commitAction(before, archived); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 0); store.commitUndo(undoId, store.pendingUndo(undoId)); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 1);
    store.db.exec('BEGIN'); store.put('thread', 'existing', { ...before, accountId: 'account-b' }); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 0); assert.equal(store.threadSummaries({ accountId: 'account-b' }).total, 1); store.db.exec('ROLLBACK'); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 1); assert.equal(store.threadSummaries({ accountId: 'account-b' }).total, 0);
    store.close(); store = new Store(path, false); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 1); store.remove('thread', 'existing'); assert.equal(store.threadSummaries({ accountId: 'account-a' }).total, 0); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('failed legacy projection rolls back migration schema and preserves original records', () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))');
  const raw = JSON.stringify({ id: 'incomplete', messages: [] }); db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', 'incomplete', raw);
  try {
    assert.throws(() => initializeThreadSummaries(db), /NOT NULL constraint failed/);
    assert.equal(db.prepare('SELECT data FROM records').get()!.data, raw);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('thread_summaries','thread_summary_insert','thread_summary_account_date','schema_migrations')").all(), []);
  } finally { db.close(); }
});

test('additive HTTP list and metadata-only bootstrap preserve legacy responses and validate limits', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false }); await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const legacy = await (await fetch(`${base}/api/bootstrap`)).json(); assert.equal(legacy.threads.length, 12); assert.ok(legacy.threads[0].messages);
    const fullThreads = app.store.threads.bind(app.store); let calls = 0; app.store.threads = (...args) => { calls++; return fullThreads(...args); };
    const metadataResponse = await fetch(`${base}/api/bootstrap?includeThreads=false`); assert.equal(metadataResponse.headers.get('cache-control'), 'no-store'); const metadata = await metadataResponse.json(); assert.deepEqual(metadata.threads, []); assert.deepEqual(metadata.accounts, legacy.accounts); assert.deepEqual(metadata.preferences, legacy.preferences); assert.equal(calls, 0);
    const page = await (await fetch(`${base}/api/thread-summaries?limit=2`)).json(); assert.equal(page.threads.length, 2); assert.equal(page.total, 12); assert.equal(page.threads[0].messages, undefined); assert.ok(page.nextCursor);
    const next = await (await fetch(`${base}/api/thread-summaries?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`)).json(); assert.equal(next.threads.length, 2); assert.ok(next.threads.every((value: { id: string }) => !page.threads.some((old: { id: string }) => old.id === value.id)));
    for (const query of ['limit=101', 'limit=two', 'split=unknown', 'cursor=invalid!']) assert.equal((await fetch(`${base}/api/thread-summaries?${query}`)).status, 400);
    const threads = await (await fetch(`${base}/api/threads`)).json(); assert.equal(threads.threads.length, 12); assert.ok(threads.threads[0].messages);
  } finally { await app.close(); }
});
