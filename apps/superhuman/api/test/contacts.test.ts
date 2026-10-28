import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { createApp, resolveApplicationDatabasePath } from '../src/server.ts';
import { initializeRecipientContacts, recipientSuggestionSql, normalizeContactEmail } from '../src/contacts.ts';
import type { Person, Thread, ContactSuggestionPage } from '../src/types.ts';

const person = (email: string, name = email): Person => ({ email, name });
function thread(id: string, people: Person[], overrides: Partial<Thread> = {}): Thread {
  return { id, accountId: 'a', subject: 'Synthetic subject', snippet: 'Synthetic preview', sender: people[0] ?? person('empty@example.test'), participants: people, lastMessageAt: '2026-10-28T12:00:00.000Z', unread: true, starred: false, important: false, folder: 'inbox', labels: [], messages: [], ...overrides };
}
const emails = (page: ContactSuggestionPage) => page.contacts.map(contact => contact.email);

test('suggestions index message sender, To and Cc metadata and isolate accounts without reading mail', () => {
  const store = new Store(':memory:', false);
  try {
    const value = thread('a-thread', [person('fallback@example.test', 'Fallback Person')]);
    value.messages = [{ id: 'message', date: value.lastMessageAt, sender: person('sender@example.test', 'Sender Person'), to: [person('to@example.test', 'To Person')], cc: [person('cc@example.test', 'Cc Person')], text: 'PRIVATE BODY MUST NEVER BE READ BY SUGGESTIONS', html: '<p>PRIVATE HTML</p>', attachments: [] }];
    store.put('thread', value.id, value);
    store.put('thread', 'b-thread', thread('b-thread', [person('sender@example.test', 'Other Account Secret')], { accountId: 'b' }));
    const original = JSON.parse; let parses = 0;
    JSON.parse = (...args) => { parses++; return original(...args); };
    try {
      for (const email of ['sender', 'to', 'cc', 'fallback']) assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: email })), [`${email}@example.test`]);
      assert.equal(store.recipientSuggestions({ accountId: 'a', q: 'sender' }).contacts[0].name, 'Sender Person');
      assert.equal(store.recipientSuggestions({ accountId: 'b', q: 'sender' }).contacts[0].name, 'Other Account Secret');
      assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'missing', q: 'sender' })), []);
      assert.equal(parses, 0);
    } finally { JSON.parse = original; }
  } finally { store.close(); }
});

test('normalization deduplicates case/compatibility forms and preserves safely quoted display names', () => {
  const store = new Store(':memory:', false);
  try {
    store.put('thread', 'names', thread('names', [person(' ＲＥＡ-TWO@EXAMPLE.TEST ', '"REA, Two"'), person('rea-two@example.test', '"REA, Two"'), person('jane@example.test', 'Jane "JJ" Doe'), person('header@example.test', 'Unsafe\r\nBcc: victim@example.test'), person('broken <x@example.test>', 'No'), person('x@example.test\r\nBcc:bad@example.test'), person('comma,list@example.test'), person('missing-domain@'), person('double@at@example.test')]));
    assert.deepEqual(store.recipientSuggestions({ accountId: 'a', q: 'ｒｅａ' }).contacts, [{ name: 'REA, Two', email: 'rea-two@example.test', formatted: '"REA, Two" <rea-two@example.test>' }]);
    assert.deepEqual(store.recipientSuggestions({ accountId: 'a', q: 'jj' }).contacts, [{ name: 'Jane "JJ" Doe', email: 'jane@example.test', formatted: '"Jane \\"JJ\\" Doe" <jane@example.test>' }]);
    assert.deepEqual(store.recipientSuggestions({ accountId: 'a', q: 'header' }).contacts, [{ name: 'header@example.test', email: 'header@example.test', formatted: 'header@example.test' }]);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_contacts').get()!.total, 3);
  } finally { store.close(); }
});

test('numeric DNS domains remain distinct literal mailbox identities while non-ASCII labels use IDNA', () => {
  const store = new Store(':memory:', false);
  try {
    const domains = ['12.34', '12.0.0.34', '01.2.3.4', '1.2.3.4', '123', '0.0.0.123', '0x7f.1', '127.0.0.1'];
    for (const [index, domain] of domains.entries()) { const email = `numeric@${domain}`; assert.equal(normalizeContactEmail(email), email); store.put('thread', `numeric-${index}`, thread(`numeric-${index}`, [person(email, `Numeric ${index}`)])); }
    assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_contacts').get()!.total, domains.length);
    for (const [index, domain] of domains.entries()) assert.equal(store.contactContext({ accountId: 'a', email: `NUMERIC@${domain}` }).threads[0].id, `numeric-${index}`);
    assert.equal(normalizeContactEmail('numeric@12。34'), 'numeric@12.34');
    assert.equal(normalizeContactEmail('numeric@１２.３４'), 'numeric@12.34');
    assert.equal(normalizeContactEmail('idn@BÜCHER.example'), 'idn@xn--bcher-kva.example');
    assert.equal(normalizeContactEmail('numeric@%31%32.34'), undefined);
  } finally { store.close(); }
});

test('v3 atomically rebuilds old numeric aliases from unchanged original mail and survives rollback/reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-recipient-v3-')); const path = join(directory, 'mail.sqlite'); let store = new Store(path, false);
  try {
    const value = thread('legacy-numeric', [person('numeric@12.34', 'Numeric Contact')]); store.put('thread', value.id, value);
    const original = String(store.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('thread', value.id)!.data);
    store.db.prepare('DELETE FROM recipient_occurrences WHERE thread_id=?').run(value.id);
    store.db.prepare('INSERT INTO recipient_occurrences(thread_id,account_id,email,name,last_seen,name_seen,name_terms) VALUES(?,?,?,?,?,?,?)').run(value.id, 'a', 'numeric@12.0.0.34', 'Numeric Contact', Date.parse(value.lastMessageAt), Date.parse(value.lastMessageAt), '["numeric contact","numeric","contact"]');
    store.db.prepare('DELETE FROM schema_migrations WHERE name=?').run('recipient-contacts-v3'); store.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?)').run('recipient-contacts-v2');
    store.db.exec("CREATE TRIGGER reject_v3 BEFORE INSERT ON recipient_occurrences WHEN NEW.email='numeric@12.34' BEGIN SELECT RAISE(ABORT,'synthetic normalization migration failure'); END");
    assert.throws(() => initializeRecipientContacts(store.db), /synthetic normalization migration failure/);
    assert.equal(store.db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('recipient-contacts-v3'), undefined);
    assert.equal(store.db.prepare('SELECT email FROM recipient_contacts').get()!.email, 'numeric@12.0.0.34');
    assert.equal(store.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('thread', value.id)!.data, original);
    store.db.exec('DROP TRIGGER reject_v3'); store.close(); store = new Store(path, false);
    assert.equal(store.contactContext({ accountId: 'a', email: 'numeric@12.34' }).matched, true);
    assert.equal(store.contactContext({ accountId: 'a', email: 'numeric@12.0.0.34' }).matched, false);
    assert.equal(store.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('thread', value.id)!.data, original);
    assert.ok(store.db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('recipient-contacts-v3'));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('address exact/prefix and name-word prefixes use deterministic local ranking and literal query characters', () => {
  const store = new Store(':memory:', false);
  try {
    store.put('thread', 'one', thread('one', [person('alex@example.test', 'Zed'), person('alexander@example.test', 'New Name'), person('other@example.test', 'Project Alex'), person('literal@example.test', '%_ Literal')], { lastMessageAt: '2026-10-28T10:00:00Z' }));
    store.put('thread', 'two', thread('two', [person('name@example.test', 'Alex Newer')], { lastMessageAt: '2026-10-28T11:00:00Z' }));
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'alex' })), ['alex@example.test', 'alexander@example.test', 'name@example.test', 'other@example.test']);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'alex@example.test' })), ['alex@example.test']);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: '%_' })), ['literal@example.test']);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: '_' })), ['literal@example.test']);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: '\\' })), []);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'alex', limit: 1 })), ['alex@example.test']);
  } finally { store.close(); }
});

test('query and response bounds reject malformed input and return no contacts for blank queries', () => {
  const store = new Store(':memory:');
  try {
    assert.deepEqual(store.recipientSuggestions({ accountId: 'demo', q: '  　 ' }), { contacts: [], source: 'local-message-participants', limited: true });
    for (const q of ['x'.repeat(201), 'x\n', '\ud800', '\u202equery', '\u3300'.repeat(100)]) assert.throws(() => store.recipientSuggestions({ accountId: 'demo', q }), { code: 'invalid_query', status: 400 });
    for (const limit of [0, -1, 1.5, 6, NaN, Infinity]) assert.throws(() => store.recipientSuggestions({ accountId: 'demo', q: 'a', limit }), { code: 'invalid_limit', status: 400 });
    assert.ok(store.recipientSuggestions({ accountId: 'demo', q: 'a' }).contacts.length <= 5);
  } finally { store.close(); }
});

test('import updates, account moves, raw SQL writes and removals invalidate names and source ownership atomically', () => {
  const store = new Store(':memory:', false);
  try {
    store.put('thread', 'older', thread('older', [person('shared@example.test', 'Older Name')], { lastMessageAt: '2026-10-27T12:00:00Z' }));
    store.put('thread', 'latest', thread('latest', [person('shared@example.test', 'Latest Name')]));
    assert.equal(store.recipientSuggestions({ accountId: 'a', q: 'shared' }).contacts[0].name, 'Latest Name');
    store.put('thread', 'latest', thread('latest', [person('moved@example.test', 'Moved Name')], { accountId: 'b' }));
    assert.equal(store.recipientSuggestions({ accountId: 'a', q: 'shared' }).contacts[0].name, 'Older Name');
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'moved' })), []);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'b', q: 'moved' })), ['moved@example.test']);
    store.db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run(JSON.stringify(thread('latest', [person('raw@example.test', 'Raw Import')], { accountId: 'b' })), 'thread', 'latest');
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'b', q: 'moved' })), []);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'b', q: 'raw' })), ['raw@example.test']);
    store.remove('thread', 'latest'); store.remove('thread', 'older');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_contacts').get()!.total, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_terms').get()!.total, 0);
  } finally { store.close(); }
});

test('trigger failure and enclosing transaction rollback preserve mail and contact projection together', () => {
  const store = new Store(':memory:', false);
  try {
    const before = thread('t', [person('kept@example.test', 'Kept Name')]); store.put('thread', before.id, before);
    store.db.exec("CREATE TRIGGER fail_recipient BEFORE INSERT ON recipient_occurrences WHEN NEW.email='fail@example.test' BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END");
    assert.throws(() => store.put('thread', before.id, thread('t', [person('fail@example.test')])), /synthetic projection failure/);
    assert.deepEqual(store.required<Thread>('thread', before.id), before);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'kept' })), ['kept@example.test']);
    store.db.exec('BEGIN'); store.remove('thread', before.id); store.db.exec('ROLLBACK');
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'kept' })), ['kept@example.test']);
    store.db.exec('DROP TRIGGER fail_recipient');
    const action = store.prepareAction('t', 'archive'); const committed = store.commitAction(action.before, action.thread); store.commitUndo(committed.undoId, store.pendingUndo(committed.undoId));
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'kept' })), ['kept@example.test']);
    assert.equal(store.db.prepare('SELECT occurrences FROM recipient_contacts').get()!.occurrences, 1);
  } finally { store.close(); }
});

test('legacy backfill and reopening preserve original records while rebuilding indexed metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-recipient-migration-')); const path = join(directory, 'mail.sqlite');
  try {
    const db = new DatabaseSync(path); db.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))');
    const raw = JSON.stringify(thread('legacy', [person('legacy@example.test', 'Legacy Contact')])); db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', 'legacy', raw); db.close();
    for (let count = 0; count < 2; count++) {
      const store = new Store(path, false);
      try { assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'legacy' })), ['legacy@example.test']); assert.equal(store.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('thread', 'legacy')!.data, raw); assert.equal(store.db.prepare('SELECT occurrences FROM recipient_contacts').get()!.occurrences, 1); } finally { store.close(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('failed legacy contact migration rolls back schema and leaves raw mail unchanged', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))');
  try {
    const raw = JSON.stringify({ ...thread('bad', [person('valid@example.test')]), accountId: null }); db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', 'bad', raw);
    assert.throws(() => initializeRecipientContacts(db));
    assert.equal(db.prepare('SELECT data FROM records').get()!.data, raw);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'recipient_%' OR name='schema_migrations'").all(), []);
  } finally { db.close(); }
});

test('older SQLite connections enqueue body-free snapshots without JS functions and refresh is account scoped and bounded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-recipient-connections-')); const path = join(directory, 'mail.sqlite');
  const legacy = new DatabaseSync(path); legacy.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))');
  const store = new Store(path, false);
  try {
    legacy.exec('PRAGMA foreign_keys=OFF');
    const insert = legacy.prepare('INSERT INTO records VALUES(?,?,?)');
    for (let index = 0; index < 65; index++) {
      const id = `external-${String(index).padStart(3, '0')}`; const value = thread(id, [person(`person${index}@example.test`, `Person ${index}`)]);
      value.messages = [{ id, sender: value.sender, to: [], date: value.lastMessageAt, text: 'PRIVATE OUT-OF-BAND BODY', html: '<p>PRIVATE OUT-OF-BAND HTML</p>', attachments: [] }]; insert.run('thread', id, JSON.stringify(value));
    }
    insert.run('thread', 'other', JSON.stringify(thread('other', [person('other@example.test')], { accountId: 'b' })));
    const raw = String(store.db.prepare('SELECT metadata FROM recipient_pending LIMIT 1').get()!.metadata); assert.equal(raw.includes('PRIVATE OUT-OF-BAND'), false); assert.equal(raw.includes('text'), false); assert.equal(raw.includes('html'), false);
    const original = JSON.parse; let parses = 0;
    JSON.parse = (input, reviver) => { assert.equal(input.includes('PRIVATE OUT-OF-BAND'), false); parses++; return original(input, reviver); };
    try { assert.equal(store.recipientSuggestions({ accountId: 'a', q: 'person' }).contacts.length, 5); assert.equal(parses, 64); } finally { JSON.parse = original; }
    assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_pending WHERE account_id=?').get('a')!.total, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_pending WHERE account_id=?').get('b')!.total, 1);
    store.recipientSuggestions({ accountId: 'a', q: 'person' }); assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_pending WHERE account_id=?').get('a')!.total, 0);
    const updated = thread('external-000', [person('person0@example.test', 'Replacement Label')]);
    legacy.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run(JSON.stringify(updated), 'thread', updated.id);
    assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: 'replacement' })), ['person0@example.test']);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS total FROM recipient_terms WHERE account_id='a' AND email='person0@example.test' AND term='person'").get()!.total, 0);
    const sql = store.db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name LIKE 'recipient_%'").all().map(row => String(row.sql)).join('\n'); assert.equal(/json_each\(recipient_|recipient_metadata\(/.test(sql), false);
  } finally { legacy.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('equal/invalid dates, reversed insertion and supplementary Unicode prefix boundaries stay deterministic', () => {
  const result = (reverse: boolean) => {
    const store = new Store(':memory:', false);
    try {
      const values = [thread('z', [person('same@example.test', 'Zed')], { lastMessageAt: 'invalid' }), thread('a', [person('same@example.test', 'Alpha')], { lastMessageAt: 'invalid' }), thread('supplementary', [person('unicode@example.test', '\u{10000} Name')]), thread('maximum', [person('maximum@example.test', '\u{10ffff} Name')])];
      for (const value of reverse ? values.reverse() : values) store.put('thread', value.id, value);
      assert.equal(store.recipientSuggestions({ accountId: 'a', q: 'same' }).contacts[0].name, 'Alpha');
      assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: '\u{10000}' })), ['unicode@example.test']);
      assert.deepEqual(emails(store.recipientSuggestions({ accountId: 'a', q: '\u{10ffff}' })), ['maximum@example.test']);
      return store.recipientSuggestions({ accountId: 'a', q: 'name' });
    } finally { store.close(); }
  };
  assert.deepEqual(result(false), result(true));
});

test('suggestion query uses indexed account-and-prefix ranges, with no mail table in its plan', () => {
  const store = new Store(':memory:');
  try {
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN ${recipientSuggestionSql}`).all('jor', 'demo', 'jor', 'jos', 'demo', 'jor', 'jos', 'demo', 5).map(row => String(row.detail));
    assert.ok(plan.some(line => /SEARCH recipient_contacts USING (?:COVERING )?INDEX .*account_id=\? AND email>\? AND email<\?/.test(line)), plan.join('\n'));
    assert.ok(plan.some(line => /SEARCH recipient_terms USING COVERING INDEX .*account_id=\? AND term>\? AND term<\?/.test(line)), plan.join('\n'));
    assert.equal(plan.some(line => /\brecords\b|\bthread_summaries\b/.test(line)), false);
    assert.ok(plan.some(line => /SEARCH contact USING INDEX .*account_id=\? AND email=\?/.test(line)), plan.join('\n'));
  } finally { store.close(); }
});

test('app configuration rejects misspelled options and test-default database paths before opening a store', () => {
  assert.throws(() => createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, dbPath: ':memory:' } as Parameters<typeof createApp>[0]), /Unknown application configuration option/);
  assert.ok(process.env.NODE_TEST_CONTEXT, 'This check must run inside the Node test worker');
  assert.throws(() => createApp({ env: {}, runJobs: false }), /explicit databasePath or DATABASE_PATH/);
  assert.throws(() => createApp({ databasePath: '', env: { DATABASE_PATH: ':memory:' }, runJobs: false }), /nonempty string/);
  for (const optional of [undefined, '', '   ']) {
    assert.equal(resolveApplicationDatabasePath(undefined, optional, false), undefined);
    assert.throws(() => resolveApplicationDatabasePath(undefined, optional, true), /explicit databasePath or DATABASE_PATH/);
  }
  assert.equal(resolveApplicationDatabasePath(':memory:', '', true), ':memory:');
  assert.equal(resolveApplicationDatabasePath(undefined, ':memory:', true), ':memory:');
  for (const explicit of ['', '   ', 0, null]) assert.throws(() => resolveApplicationDatabasePath(explicit, ':memory:', false), /nonempty string/);
});

test('HTTP contract is bounded and account scoped, returns no-store, and preserves metadata bootstrap', async () => {
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, runJobs: false });
  const request = (url: string) => new Promise<{ status: number; headers: Record<string, string>; body: any }>((resolve) => {
    const response = { writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; }, status: 0, headers: {} as Record<string, string>, end(raw: string) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(raw) }); }, setHeader() {} };
    app.server.emit('request', { headers: { host: '127.0.0.1:3001' }, method: 'GET', url }, response);
  });
  try {
    const response = await request('/api/contacts/suggestions?q=jor'); assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store'); assert.deepEqual(emails(response.body), ['jordan@example.test']);
    const other = await request('/api/contacts/suggestions?accountId=missing&q=jor'); assert.deepEqual(other.body.contacts, []);
    for (const query of ['limit=6', 'limit=NaN', 'limit=', `q=${'x'.repeat(201)}`]) assert.equal((await request(`/api/contacts/suggestions?${query}`)).status, 400);
    const before = app.store.threads; app.store.threads = () => { throw new Error('Full mail read forbidden'); };
    try { const metadata = await request('/api/bootstrap?includeThreads=false'); assert.equal(metadata.status, 200); assert.deepEqual(metadata.body.threads, []); assert.equal((await request('/api/contacts/suggestions?q=jor')).status, 200); } finally { app.store.threads = before; }
  } finally { await app.close(); }
});
