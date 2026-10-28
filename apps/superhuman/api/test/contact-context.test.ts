import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { initializeContactContext, contactContextSql } from '../src/contact-context.ts';
import type { Thread, Person } from '../src/types.ts';

const person: Person = { name: 'Imported Contact', email: 'contact@example.test' };
function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return { id, accountId: 'a', subject: `Synthetic ${id}`, snippet: 'Metadata preview', sender: person, participants: [person], lastMessageAt: '2026-10-28T12:00:00.000Z', unread: true, starred: false, important: false, folder: 'inbox', labels: [], messages: [{ id: `m-${id}`, sender: person, to: [], date: '2026-10-28T12:00:00.000Z', text: 'PRIVATE_BODY_SHOULD_NOT_BE_LOADED', html: '<p>PRIVATE_HTML_SHOULD_NOT_BE_LOADED</p>', attachments: [] }], ...overrides };
}
const ids = (value: { threads: { id: string }[] }) => value.threads.map(thread => thread.id);

test('four recent summaries are account/contact scoped, ordered and body-free while the open thread is excluded', () => {
  const store = new Store(':memory:', false);
  try {
    for (let i = 0; i < 7; i++) store.put('thread', `t-${i}`, thread(`t-${i}`, { lastMessageAt: `2026-10-28T12:0${i}:00.000Z` }));
    store.put('thread', 'foreign', thread('foreign', { accountId: 'b', lastMessageAt: '2026-10-28T13:00:00Z', sender: { ...person, name: 'Other Account Secret' }, participants: [{ ...person, name: 'Other Account Secret' }], messages: [] }));
    const original = JSON.parse; let parses = 0;
    JSON.parse = (input, reviver) => { assert.equal(input.includes('PRIVATE_BODY'), false); assert.equal(input.includes('PRIVATE_HTML'), false); assert.equal(input.includes('Other Account Secret'), false); parses++; return original(input, reviver); };
    try {
      const result = store.contactContext({ accountId: 'a', email: ' ＣＯＮＴＡＣＴ@EXAMPLE.TEST ', excludeThreadId: 't-6' });
      assert.deepEqual(ids(result), ['t-5', 't-4', 't-3', 't-2']); assert.equal(parses, 4); assert.equal(result.matched, true); assert.deepEqual(result.contact, person);
      assert.equal(result.source, 'local-message-participants'); assert.equal(result.limited, true);
      assert.ok(result.threads.every(summary => !('messages' in summary) && !('html' in summary) && summary.messageCount === 1));
    } finally { JSON.parse = original; }
    assert.deepEqual(ids(store.contactContext({ accountId: 'b', email: person.email })), ['foreign']);
    assert.equal(store.contactContext({ accountId: 'missing', email: person.email }).matched, false);
    assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: 'other@example.test' })), []);
  } finally { store.close(); }
});

test('incomplete raw email returns an honest empty fallback and unnamed imported contacts stay explicitly unnamed', () => {
  const store = new Store(':memory:', false);
  try {
    for (const email of ['rea-invalid@', '@', 'not a mailbox', '', 'Name <unfinished']) {
      assert.deepEqual(store.contactContext({ accountId: 'a', email }), { contact: { name: email, email }, matched: false, threads: [], source: 'local-message-participants', limited: true });
    }
    store.put('thread', 'unnamed', thread('unnamed', { sender: { name: '', email: person.email }, participants: [], messages: [] }));
    const result = store.contactContext({ accountId: 'a', email: 'CONTACT@EXAMPLE.TEST' }); assert.equal(result.matched, true); assert.equal(result.contact.name, ''); assert.equal(result.contact.email, person.email);
    assert.deepEqual(ids(result), ['unnamed']);
  } finally { store.close(); }
});

test('draft-only provenance is projected on write while received conversations with unsent replies remain visible', () => {
  const store = new Store(':memory:', false);
  try {
    const draft = thread('draft-only', { folder: 'done', providerLabels: ['DRAFT'] }); draft.messages[0].providerLabels = ['DRAFT']; store.put('thread', draft.id, draft);
    const mixed = thread('mixed', { folder: 'done', providerLabels: ['DRAFT'] }); mixed.messages[0].providerLabels = []; mixed.messages.push({ ...mixed.messages[0], id: 'draft-reply', providerLabels: ['DRAFT'] }); store.put('thread', mixed.id, mixed);
    store.put('thread', 'legacy-draft', thread('legacy-draft', { folder: 'drafts' }));
    assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), ['mixed']);
    const action = store.prepareAction('draft-only', 'archive'); const committed = store.commitAction(action.before, action.thread);
    assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), ['mixed']);
    store.commitUndo(committed.undoId, store.pendingUndo(committed.undoId)); assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), ['mixed']);
    const changed = store.required<Thread>('thread', draft.id); changed.messages[0].providerLabels = ['SENT']; store.put('thread', draft.id, changed);
    assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), ['mixed', 'draft-only']);
    const uncertain = thread('uncertain-labels', { folder: 'done' }); uncertain.messages[0].providerLabels = ['DRAFT']; uncertain.messages.push({ ...uncertain.messages[0], id: 'malformed-legacy-labels', providerLabels: 'DRAFT' as unknown as string[] }); store.put('thread', uncertain.id, uncertain);
    assert.ok(ids(store.contactContext({ accountId: 'a', email: person.email })).includes('uncertain-labels'));
  } finally { store.close(); }
});

test('participant/name changes, account moves, deletes and undo never leave stale context metadata', () => {
  const store = new Store(':memory:', false);
  try {
    store.put('thread', 't', thread('t'));
    const newPerson = { name: 'Replacement Contact', email: 'replacement@example.test' };
    store.put('thread', 't', thread('t', { accountId: 'b', sender: newPerson, participants: [newPerson], messages: [] }));
    assert.equal(store.contactContext({ accountId: 'a', email: person.email }).matched, false);
    assert.deepEqual(ids(store.contactContext({ accountId: 'b', email: newPerson.email })), ['t']);
    const action = store.prepareAction('t', 'star'); const committed = store.commitAction(action.before, action.thread); store.commitUndo(committed.undoId, store.pendingUndo(committed.undoId));
    assert.deepEqual(store.contactContext({ accountId: 'b', email: newPerson.email }).contact, newPerson);
    store.remove('thread', 't'); assert.equal(store.contactContext({ accountId: 'b', email: newPerson.email }).matched, false); assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_thread_flags').get()!.total, 0);
  } finally { store.close(); }
});

test('invalid input and excluded identities are bounded without conflating incomplete addresses with transport errors', () => {
  const store = new Store(':memory:', false);
  try {
    const base = { accountId: 'a', email: person.email };
    for (const input of [{ accountId: '' }, { accountId: ' ' }, { accountId: 'x'.repeat(513) }, { email: 'x'.repeat(321) }, { email: '\u3300'.repeat(100) }, { email: 'x\n' }, { email: '\ud800' }, { excludeThreadId: '' }, { excludeThreadId: ' ' }, { excludeThreadId: 'x'.repeat(1025) }, { excludeThreadId: 'unsafe\u202e' }]) assert.throws(() => store.contactContext({ ...base, ...input }), { code: 'invalid_contact_context', status: 400 });
  } finally { store.close(); }
});

test('legacy migration is idempotent, preserves raw records and rolls back all new schema on a bad row', () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))');
  try {
    const raw = JSON.stringify(thread('legacy', { folder: 'drafts' })); db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', 'legacy', raw);
    initializeContactContext(db); initializeContactContext(db); assert.equal(db.prepare('SELECT draft_only FROM recipient_thread_flags').get()!.draft_only, 1); assert.equal(db.prepare('SELECT COUNT(*) AS total FROM recipient_thread_flags').get()!.total, 1); assert.equal(db.prepare('SELECT data FROM records').get()!.data, raw);
  } finally { db.close(); }
  const broken = new DatabaseSync(':memory:'); broken.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))');
  try {
    const raw = JSON.stringify({ ...thread('bad'), accountId: null }); broken.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', 'bad', raw);
    assert.throws(() => initializeContactContext(broken)); assert.equal(broken.prepare('SELECT data FROM records').get()!.data, raw);
    assert.deepEqual(broken.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'recipient_%' OR name='schema_migrations'").all(), []);
  } finally { broken.close(); }
});

test('plain older writer connections update projected flags without custom functions or body loads at request time', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-contact-context-')); const path = join(directory, 'mail.sqlite');
  const older = new DatabaseSync(path); older.exec('PRAGMA foreign_keys=OFF; CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))'); const store = new Store(path, false);
  try {
    const value = thread('external'); value.messages[0].providerLabels = ['DRAFT']; older.prepare('INSERT INTO records VALUES(?,?,?)').run('thread', value.id, JSON.stringify(value));
    assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), []);
    value.messages[0].providerLabels = ['INBOX']; older.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run(JSON.stringify(value), 'thread', value.id);
    const original = JSON.parse;
    JSON.parse = (input, reviver) => { assert.equal(input.includes('PRIVATE_BODY'), false); return original(input, reviver); };
    try { assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), ['external']); } finally { JSON.parse = original; }
    older.prepare('DELETE FROM records WHERE kind=? AND id=?').run('thread', value.id); assert.equal(store.contactContext({ accountId: 'a', email: person.email }).matched, false);
  } finally { older.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('flag projection failure rolls back original thread, contact membership and summaries together', () => {
  const store = new Store(':memory:', false);
  try {
    const before = thread('t'); store.put('thread', before.id, before);
    store.db.exec("CREATE TRIGGER reject_draft_flag BEFORE INSERT ON recipient_thread_flags WHEN NEW.draft_only=1 BEGIN SELECT RAISE(ABORT,'synthetic flag failure'); END");
    const changed = structuredClone(before); changed.messages[0].providerLabels = ['DRAFT'];
    assert.throws(() => store.put('thread', before.id, changed), /synthetic flag failure/); assert.deepEqual(store.required<Thread>('thread', before.id), before); assert.deepEqual(ids(store.contactContext({ accountId: 'a', email: person.email })), ['t']);
  } finally { store.close(); }
});

test('query plan starts from indexed account/email membership and loads only exact summary/flag rows', () => {
  const store = new Store(':memory:', false);
  try {
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN ${contactContextSql}`).all('a', person.email, null, null).map(row => String(row.detail));
    assert.ok(plan.some(line => /SEARCH occurrence USING INDEX recipient_occurrence_recent \(account_id=\? AND email=\?\)/.test(line)), plan.join('\n'));
    assert.ok(plan.some(line => /SEARCH summary USING INDEX .*\(id=\?\)/.test(line)), plan.join('\n'));
    assert.ok(plan.some(line => /SEARCH flags USING INDEX .*\(thread_id=\?\)/.test(line)), plan.join('\n'));
    assert.equal(plan.some(line => /\brecords\b|json_each/.test(line)), false);
  } finally { store.close(); }
});

test('HTTP route defaults account, fixes result size, rejects repeated arguments and preserves metadata-only bootstrap', async () => {
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, runJobs: false });
  const request = (url: string) => new Promise<{ status: number; headers: Record<string, string>; body: any }>(resolve => {
    const response = { status: 0, headers: {} as Record<string, string>, writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; }, setHeader() {}, end(raw: string) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(raw) }); } };
    app.server.emit('request', { method: 'GET', url, headers: { host: '127.0.0.1:3001' } }, response);
  });
  try {
    const response = await request('/api/contacts/context?email=jordan%40example.test'); assert.equal(response.status, 200); assert.equal(response.body.matched, true); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual((await request('/api/contacts/context?email=rea-invalid%40')).body.contact, { name: 'rea-invalid@', email: 'rea-invalid@' });
    for (const query of ['email=a&email=b', 'accountId=a&accountId=b', 'excludeThreadId=', 'excludeThreadId=a&excludeThreadId=b']) assert.equal((await request(`/api/contacts/context?${query}`)).status, 400);
    const before = app.store.threads; app.store.threads = () => { throw new Error('Full mailbox reads forbidden'); };
    try { assert.equal((await request('/api/contacts/context?email=jordan%40example.test')).status, 200); assert.deepEqual((await request('/api/bootstrap?includeThreads=false')).body.threads, []); } finally { app.store.threads = before; }
  } finally { await app.close(); }
});
