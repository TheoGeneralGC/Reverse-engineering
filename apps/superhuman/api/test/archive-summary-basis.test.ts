import './archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.ts';
import { publicWireValue } from '../src/reminder-message-projection.ts';
import type { Account, Thread, ThreadListPage, ThreadSummary } from '../src/types.ts';
import type { SqlDatabase } from '../src/sql-database.ts';
const denial = (globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
after(() => assert.equal(denial.attempts, 0));
const account = (id = 'a'): Account => ({ id, provider: 'google', email: id + '@example.test', name: 'Fictional ' + id, color: '#888' });
const grant = (id = 'a') => ({ accountId: id, service: 'mail', outcome: 'granted', scopeSource: 'response', requestedScopes: ['https://www.googleapis.com/auth/gmail.modify'], grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
const thread = (id: string, accountId = 'a'): Thread => ({ id, accountId, providerId: id, subject: 'Fictional ' + id, snippet: 'Metadata only', sender: { name: 'Synthetic', email: 'sender@example.test' }, participants: [], lastMessageAt: '2026-10-27T12:00:00.000Z', folder: 'inbox', labels: [], providerLabels: ['INBOX'], starred: false, unread: true, important: true, messages: [{ id: 'message-' + id, sender: { name: 'Synthetic', email: 'sender@example.test' }, to: [], date: '2026-10-27T12:00:00.000Z', text: 'PRIVATE_BODY_SENTINEL', attachments: [] }] });
const rawPage = (threads: ThreadSummary[]): ThreadListPage => ({ threads, total: threads.length, counts: { inbox: threads.length, important: threads.length, other: 0, calendar: 0 }, hasMore: false, nextCursor: null });
function fixture(options: { path?: string; guard?: (kind: string, sql: string) => void } = {}) {
  const path = options.path ?? ':memory:', calls: { kind: string; sql: string; values?: unknown[] }[] = [];
  let opened = 0, closed = 0;
  const app = createApp({ databasePath: path, env: { DATABASE_PATH: path }, seed: false, runJobs: false, providerDraftAutomatic: false,
    databaseFactory(selected) {
      assert.equal(selected, path); opened++; const native = new DatabaseSync(selected);
      const port: SqlDatabase = { get isTransaction() { return native.isTransaction; }, exec(sql) { options.guard?.('exec', sql); calls.push({ kind: 'exec', sql }); native.exec(sql); options.guard?.('exec-ack', sql); },
        prepare(sql) { options.guard?.('prepare', sql); calls.push({ kind: 'prepare', sql }); const s = native.prepare(sql); return {
          get(...values) { options.guard?.('get', sql); calls.push({ kind: 'get', sql, values }); return s.get(...values); },
          all(...values) { options.guard?.('all', sql); calls.push({ kind: 'all', sql, values }); return s.all(...values); },
          run(...values) { options.guard?.('run', sql); calls.push({ kind: 'run', sql, values }); return s.run(...values); },
        }; }, close() { if (!closed) { native.close(); closed++; } } };
      return port;
    } });
  for (const a of ['a', 'b']) { app.store.put('account', a, account(a)); app.store.put('googleGrant', 'mail:' + a, grant(a)); }
  app.store.put('preferences', 'global', { activeAccountId: 'a', splitInbox: ['Important', 'Other'], snippets: [] });
  const summaries = (accountId = 'a', limit = 100) => app.store.threadSummaries({ accountId, limit });
  const legacy = (p: ThreadListPage) => app.archiveActions!.annotate(publicWireValue(app.store, p));
  const page = (read = summaries) => app.archiveActions!.summaryPage(() => read());
  return { app, calls, summaries, legacy, page, put: (id: string, a = 'a') => app.store.put('thread', id, thread(id, a)), async close() { await app.close(); assert.equal(opened, 1); assert.equal(closed, 1); } };
}
async function http(app: ReturnType<typeof createApp>, url: string) {
  return new Promise<{ status: number; value: any }>(resolve => { const request = Object.assign(Readable.from([]), { method: 'GET', url, headers: { host: '127.0.0.1:3001' } }), response = { status: 0, setHeader() {}, writeHead(status: number) { this.status = status; }, end(value: unknown) { resolve({ status: this.status, value: JSON.parse(String(value)) }); } }; app.server.emit('request', request, response); });
}

test('actual route 0/1/50/100 pages match scalar privacy/bases and perform one bounded head read', async () => {
  const f = fixture(); try {
    for (const count of [0, 1, 50, 100]) {
      for (let n = f.summaries().total; n < count; n++) f.put('thread-' + n);
      const original = f.legacy(f.summaries()), before = Number(f.app.store.db.prepare('SELECT total_changes() n').get()!.n); f.calls.length = 0;
      const actual = await http(f.app, '/api/thread-summaries?accountId=a&limit=100'); assert.equal(actual.status, 200); assert.deepEqual(actual.value, original); assert.equal(JSON.stringify(actual.value).includes('PRIVATE_BODY_SENTINEL'), false);
      const heads = f.calls.filter(c => c.kind === 'all' && c.sql.includes('LEFT JOIN archive_action_heads')); assert.equal(heads.length, count ? 1 : 0); if (count) { assert.equal(JSON.parse(String(heads[0].values![0])).length, count); assert.equal(heads[0].sql.includes('thread-'), false); }
      assert.equal(Number(f.app.store.db.prepare('SELECT total_changes() n').get()!.n), before); assert.equal(f.app.store.db.isTransaction, false);
    }
    const limited = await http(f.app, '/api/thread-summaries?accountId=a&limit=1'); assert.equal(limited.value.threads.length, 1); assert(limited.value.nextCursor); assert.equal(limited.value.hasMore, true);
    const full = await http(f.app, '/api/threads/thread-0'); assert.equal(full.value.thread.archiveBasis.sourceVersion, f.app.archiveActions!.basis('thread-0', 'a')!.sourceVersion);
  } finally { await f.close(); }
});

test('per-account checks and tuple keys isolate mixed accounts, duplicate rows and mismatched head owners', async () => {
  const f = fixture(); try {
    f.put('shared'); f.put('bob', 'b'); const a = f.summaries('a').threads[0], b = f.summaries('b').threads[0], p = rawPage([a, b, { ...a, accountId: 'b' }, a]);
    const expected: any = f.legacy(p); f.calls.length = 0; const actual: any = f.page(() => p); assert.deepEqual(actual, expected); assert.equal(actual.threads[2].archiveBasis, null); assert.notEqual(actual.threads[0].archiveBasis, actual.threads[3].archiveBasis);
    assert.equal(f.calls.filter(c => c.kind === 'get' && c.sql === 'SELECT * FROM auto_draft_ready_accounts WHERE account_id=?').length, 2);
    const head = f.calls.find(c => c.kind === 'all' && c.sql.includes('LEFT JOIN archive_action_heads'))!; assert.equal(JSON.parse(String(head.values![0])).length, 3);
  } finally { await f.close(); }
});

test('grant and account/incarnation malformed/unavailable states retain the scalar null/error outcome', async () => {
  const f = fixture(); try {
    f.put('one'); const p = f.summaries(), originalGrant = grant(), registry = f.app.store.db.prepare('SELECT * FROM auto_draft_ready_accounts WHERE account_id=?').get('a')!;
    for (const bad of [undefined, { ...grant(), outcome: 'denied' }, { ...grant(), scopeSource: 'unknown' }, { ...grant(), accountId: 'b' }, { ...grant(), grantedScopes: [3] }, { ...grant(), grantedScopes: ['read-only'] }, { ...grant(), grantedScopes: Array(129).fill('x') }]) {
      if (bad) f.app.store.put('googleGrant', 'mail:a', bad); else f.app.store.remove('googleGrant', 'mail:a'); assert.deepEqual(f.page(() => p), f.legacy(p));
    }
    f.app.store.put('googleGrant', 'mail:a', originalGrant);
    for (const patch of [{ present: 0 }, { incarnation: 'invalid' }, { epoch: 0 }, { facts: '{}' }]) {
      for (const [key, value] of Object.entries(patch)) f.app.store.db.prepare('UPDATE auto_draft_ready_accounts SET ' + key + '=? WHERE account_id=?').run(value, 'a'); assert.deepEqual(f.page(() => p), f.legacy(p));
      f.app.store.db.prepare('UPDATE auto_draft_ready_accounts SET incarnation=?,epoch=?,facts=?,present=? WHERE account_id=?').run(registry.incarnation, registry.epoch, registry.facts, registry.present, 'a');
    }
    // Existing record triggers reject actually storing this invalid JSON. Inject
    // only its selected Store.get parse boundary, shared by old/new readers.
    assert.throws(() => f.app.store.db.prepare("UPDATE records SET data='not-json' WHERE kind='googleGrant' AND id='mail:a'").run());
    const get = f.app.store.get.bind(f.app.store); f.app.store.get = ((kind: string, id: string) => { if (kind === 'googleGrant' && id === 'mail:a') throw new SyntaxError('synthetic_malformed_json'); return get(kind, id); }) as typeof f.app.store.get;
    try { assert.throws(() => f.legacy(p), /synthetic_malformed_json/); assert.throws(() => f.page(() => p), /synthetic_malformed_json/); assert.equal(f.app.store.db.isTransaction, false); } finally { f.app.store.get = get; }
  } finally { await f.close(); }
});

test('missing registry/head schema is null without creating authority or resetting existing state', async () => {
  for (const table of ['archive_action_heads', 'auto_draft_ready_accounts']) {
    const f = fixture(); try { f.put('one'); const p = f.summaries(); f.app.store.db.exec('DROP TABLE ' + table); const old = f.legacy(p); f.calls.length = 0; assert.deepEqual(f.page(() => p), old); assert.equal(f.app.store.db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table), undefined); assert.equal(f.calls.some(c => /CREATE |INSERT |UPDATE |DELETE /i.test(c.sql)), false); } finally { await f.close(); }
  }
});

test('per-row malformed head types/values preserve good neighbours and scalar outcomes', async () => {
  const f = fixture(); try {
    f.put('bad'); f.put('good'); const p = f.summaries(), head = f.app.store.db.prepare('SELECT * FROM archive_action_heads WHERE thread_id=?').get('bad')!;
    const patches: Record<string, any>[] = [{ epoch: 0 }, { epoch: -1 }, { epoch: 1.5 }, { epoch: 9007199254740991n }, { epoch: 9007199254740992n }, { epoch: 9223372036854775807n }, { present: 9007199254740992n }, { epoch: 'nonsense' }, { epoch: new Uint8Array([1]) }, { present: 0 }, { present: 'bad' }, { source_version: 'g'.repeat(64) }, { source_version: new Uint8Array([1]) }, { account_id: 'b' }];
    for (const patch of patches) { for (const [key, value] of Object.entries(patch)) f.app.store.db.prepare('UPDATE archive_action_heads SET ' + key + '=? WHERE thread_id=?').run(value, 'bad'); const expected: any = f.legacy(p), actual: any = f.page(() => p); assert.deepEqual(actual, expected); assert(actual.threads.find((x: any) => x.id === 'good').archiveBasis); f.app.store.db.prepare('UPDATE archive_action_heads SET epoch=?,present=?,source_version=?,account_id=? WHERE thread_id=?').run(head.epoch, head.present, head.source_version, head.account_id, 'bad'); }
  } finally { await f.close(); }
});

test('a new request sees current grants/heads, rollback and durable account/source ABA rather than prior witnesses', async () => {
  const f = fixture(); try {
    f.put('one'); const p = f.summaries(), first: any = f.page(() => p), basis = first.threads[0].archiveBasis;
    f.app.store.db.exec('BEGIN'); f.app.store.put('thread', 'one', { ...thread('one'), subject: 'Temporary' }); f.app.store.db.exec('ROLLBACK'); assert.deepEqual(f.page(() => p), first);
    f.app.store.put('thread', 'one', { ...thread('one'), subject: 'Changed' }); f.app.store.put('thread', 'one', thread('one')); const afterSource: any = f.page(() => p); assert.notEqual(afterSource.threads[0].archiveBasis.sourceVersion, basis.sourceVersion);
    f.app.store.put('account', 'a', { ...account(), email: 'changed@example.test' }); f.app.store.put('account', 'a', account()); const afterAccount: any = f.page(() => p); assert.notEqual(afterAccount.threads[0].archiveBasis.accountVersion, basis.accountVersion);
    f.app.store.put('googleGrant', 'mail:a', { ...grant(), outcome: 'denied' }); assert.equal((f.page(() => p) as any).threads[0].archiveBasis, null); f.app.store.put('googleGrant', 'mail:a', grant()); assert.deepEqual(f.page(() => p), afterAccount);
    let issues = 0; (f.app.archiveActions as any).native = async () => { issues++; throw Error('must_not_issue'); }; const result = await f.app.archiveActions!.archive('one', { action: 'archive', accountId: 'a', accountVersion: basis.accountVersion, expectedSourceVersion: basis.sourceVersion, clientRequestId: randomUUID() }); assert.equal(result.receipt.state, 'refused'); assert.equal(issues, 0);
  } finally { await f.close(); }
});

test('external WAL writer during an established page read cannot mix new witnesses into the old response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'summary-basis-snapshot-')), path = join(dir, 'owned.sqlite'), f = fixture({ path }); let writer: DatabaseSync | undefined;
  try {
    f.put('one'); const first: any = f.page(), firstBasis = first.threads[0].archiveBasis; writer = new DatabaseSync(path); writer.exec('PRAGMA foreign_keys=ON');
    const held: any = f.page(() => { const page = f.summaries(); assert.equal(f.app.store.db.isTransaction, true); writer!.exec('BEGIN IMMEDIATE'); writer!.prepare("UPDATE records SET data=? WHERE kind='account' AND id='a'").run(JSON.stringify({ ...account(), email: 'other-incarnation@example.test' })); writer!.prepare("UPDATE records SET data=? WHERE kind='account' AND id='a'").run(JSON.stringify(account())); writer!.prepare("UPDATE records SET data=? WHERE kind='thread' AND id='one'").run(JSON.stringify({ ...thread('one'), subject: 'Committed while reader held' })); writer!.prepare("UPDATE records SET data=? WHERE kind='googleGrant' AND id='mail:a'").run(JSON.stringify({ ...grant(), outcome: 'denied' })); writer!.exec('COMMIT'); return page; });
    assert.deepEqual(held, first); const fresh: any = f.page(); assert.equal(fresh.threads[0].subject, 'Committed while reader held'); assert.equal(fresh.threads[0].archiveBasis, null); assert.equal(f.app.store.db.isTransaction, false);
    f.app.store.put('googleGrant', 'mail:a', grant()); const current: any = f.page(); assert.notEqual(current.threads[0].archiveBasis.sourceVersion, firstBasis.sourceVersion); assert.notEqual(current.threads[0].archiveBasis.accountVersion, firstBasis.accountVersion);
  } finally { writer?.close(); await f.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unsupported shape/IDs/byte bound selects original annotation before batch work and preserves privacy', async () => {
  const f = fixture(); try {
    f.put('one'); const page = f.summaries(), normal = page.threads[0]; const variants: ThreadListPage[] = [rawPage([{ ...normal, id: 'unpaired-\ud800' }]), rawPage([{ ...normal, id: 'x'.repeat(513) }]), { ...page, extra: { source: thread('one') } } as ThreadListPage, rawPage(Array.from({ length: 100 }, (_, n) => ({ ...normal, id: '界'.repeat(500) + n, accountId: '界'.repeat(500) + n })))];
    for (const p of variants) { const expected = f.legacy(p); f.calls.length = 0; assert.deepEqual(f.page(() => p), expected); assert.equal(f.calls.some(c => c.sql.includes('LEFT JOIN archive_action_heads')), false); assert.equal(JSON.stringify(f.page(() => p)).includes('reminderHeaderFacts'), false); }
  } finally { await f.close(); }
});

test('exact128KiB UTF8 pair bound batches, the next byte falls back, and private nested header evidence is still removed', async () => {
  const f = fixture(); try {
    f.put('one'); const normal = f.summaries().threads[0], ids = Array.from({ length: 100 }, (_, n) => '界'.repeat(400) + n);
    const encodedBytes = () => Buffer.byteLength(JSON.stringify(ids.map(id => ['a', id])));
    for (let n = 0; n < ids.length && encodedBytes() < 128 * 1024; n++) { const extra = Math.min(512 - ids[n].length, 128 * 1024 - encodedBytes()); ids[n] += 'x'.repeat(extra); }
    assert.equal(encodedBytes(), 128 * 1024); const p = rawPage(ids.map(id => ({ ...normal, id }))), expected = f.legacy(p); f.calls.length = 0; assert.deepEqual(f.page(() => p), expected); assert.equal(f.calls.filter(c => c.kind === 'all' && c.sql.includes('LEFT JOIN archive_action_heads')).length, 1);
    const spare = ids.findIndex(id => id.length < 512); assert(spare >= 0); ids[spare] += 'x'; assert.equal(encodedBytes(), 128 * 1024 + 1); const tooLarge = rawPage(ids.map(id => ({ ...normal, id }))); f.calls.length = 0; assert.deepEqual(f.page(() => tooLarge), f.legacy(tooLarge)); assert.equal(f.calls.some(c => c.sql.includes('LEFT JOIN archive_action_heads')), false);
    const full = thread('one'); (full.messages[0] as any).reminderHeaderFacts = { privateValue: 'PRIVATE_HEADER_SENTINEL' }; const nested = { ...f.summaries(), extra: full } as ThreadListPage; const actual = f.page(() => nested); assert.deepEqual(actual, f.legacy(nested)); assert.equal(JSON.stringify(actual).includes('PRIVATE_HEADER_SENTINEL'), false); assert.equal(JSON.stringify(actual).includes('reminderHeaderFacts'), false);
  } finally { await f.close(); }
});

test('read callback failure rolls back its source/projections and nested read release preserves caller transaction', async () => {
  const f = fixture(); try {
    f.put('one'); const before = f.page(); assert.throws(() => f.page(() => { f.app.store.put('thread', 'one', { ...thread('one'), subject: 'Must roll back with projection' }); throw Error('synthetic_read_failed'); }), /synthetic_read_failed/); assert.deepEqual(f.page(), before); assert.equal(f.app.store.db.isTransaction, false);
    f.app.store.db.exec('BEGIN'); assert.deepEqual(f.page(), before); assert.equal(f.app.store.db.isTransaction, true); f.app.store.db.exec('ROLLBACK'); assert.equal(f.app.store.db.isTransaction, false);
  } finally { await f.close(); }
});

test('unexpected batch failure fails whole GET once; no scalar replay, partial200 or automatic retry; next independent request works', async () => {
  let fail = false, attempts = 0; const f = fixture({ guard(kind, sql) { if (kind === 'all' && sql.includes('LEFT JOIN archive_action_heads')) { attempts++; if (fail) throw Error('synthetic_batch_failure'); } } });
  try { f.put('one'); f.put('two'); fail = true; f.calls.length = 0; const result = await http(f.app, '/api/thread-summaries?accountId=a'); assert.equal(result.status, 500); assert.equal('threads' in result.value, false); assert.equal(attempts, 1); assert.equal(f.calls.some(c => c.sql.startsWith('SELECT epoch,present,source_version,account_id FROM archive_action_heads')), false); assert.equal(f.app.store.db.isTransaction, false); fail = false; const next = await http(f.app, '/api/thread-summaries?accountId=a'); assert.equal(next.status, 200); assert.equal(next.value.threads.length, 2); assert.equal(attempts, 2); } finally { await f.close(); }
});

test('owner loss before prepared batch execution and release failure cannot return cached/partial bases or replay SQL', async () => {
  for (const mode of ['owner', 'release']) {
    let armed = false, revoked = false, batch = 0; const f = fixture({ guard(kind, sql) { if (!armed) return; if (mode === 'owner' && kind === 'all' && sql.includes('LEFT JOIN archive_action_heads')) revoked = true; if (revoked) throw Error('synthetic_owner_lost'); if (kind === 'all' && sql.includes('LEFT JOIN archive_action_heads')) batch++; if (mode === 'release' && kind === 'exec-ack' && sql === 'RELEASE archive_summary_read') { revoked = true; throw Error('synthetic_commit_ack_lost'); } } });
    try { f.put('one'); const expected = f.page(); assert(expected); armed = true; assert.throws(() => f.page(), /synthetic_/); assert.equal(batch, mode === 'owner' ? 0 : 1); assert.equal(f.calls.filter(c => c.kind === 'all' && c.sql.includes('LEFT JOIN archive_action_heads')).length, mode === 'owner' ? 1 : 2); } finally { await f.close().catch(() => {}); f.app.store.close(); }
  }
});
