import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createSearchMatcher } from '../src/search.ts';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import type { Account, Thread } from '../src/types.ts';

const subject = 'REA Mapped Draft Split fixture 20261028-01';
function thread(id = 'fixture', lastMessageAt = '2026-10-29T00:50:41.000Z', accountId = 'a'): Thread {
  const sender = { name: 'Fictional sender', email: 'sender@example.test' };
  return { id, accountId, subject, snippet: 'Fictional date boundary', sender, participants: [sender], lastMessageAt, unread: false, starred: false, important: true, folder: 'inbox', labels: [], messages: [{ id: 'm-' + id, sender, to: [], date: lastMessageAt, text: 'Synthetic only', attachments: [] }] };
}
function fixture() {
  const store = new Store(':memory:', false);
  for (const id of ['a', 'b']) store.put<Account>('account', id, { id, name: 'Synthetic account', email: id + '@example.test', provider: 'demo', color: '#000' });
  return store;
}
function invoke(app: ReturnType<typeof createApp>, url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(Readable.from([]), { method: 'GET', url, headers: { host: '127.0.0.1:3001' } });
    const output = { status: 0, setHeader() {}, writeHead(status: number) { this.status = status; }, end(payload: string) { try { resolve({ status: this.status, body: JSON.parse(String(payload)) }); } catch (error) { reject(error); } } };
    app.server.emit('request', input, output);
  });
}

test('observed slash-local and ISO-UTC boundary results pass through actual Store search and summaries', () => {
  const store = fixture(); store.put('thread', 'fixture', thread()); store.put('thread', 'foreign', thread('foreign', undefined, 'b'));
  try {
    const q = `subject:"${subject}"`, zone = 'America/Los_Angeles';
    for (const [suffix, expected] of [['', 1], [' after:2026/10/29', 0], [' before:2026/10/29', 1], [' after:2026-10-29', 1]] as const) {
      assert.equal(store.threads('a', 'all', q + suffix, zone).length, expected, suffix);
      const page = store.threadSummaries({ accountId: 'a', q: q + suffix, timeZone: zone });
      assert.equal(page.total, expected, suffix); assert.ok(page.threads.every(row => row.accountId === 'a'));
    }
    assert.equal(store.threads('a', 'all', q + ' after:2026/10/29').length, 1, 'absent zone retains legacy UTC');
    assert.equal(store.threadSummaries({ accountId: 'missing', q, timeZone: zone }).total, 0);
  } finally { store.close(); }
});

test('slash dates use zone midnight across DST and UTC offsets while ISO, epoch and invalid-date policy stay unchanged', () => {
  const zone = 'America/Los_Angeles';
  for (const [date, boundary] of [['2026/03/08', '2026-03-08T08:00:00Z'], ['2026/03/09', '2026-03-09T07:00:00Z'], ['2026/11/01', '2026-11-01T07:00:00Z'], ['2026/11/02', '2026-11-02T08:00:00Z']] as const) {
    const at = thread('at', boundary), before = thread('before', new Date(Date.parse(boundary) - 1).toISOString());
    assert.equal(createSearchMatcher('after:' + date, { timeZone: zone })(at), true);
    assert.equal(createSearchMatcher('after:' + date, { timeZone: zone })(before), false);
    assert.equal(createSearchMatcher('before:' + date, { timeZone: zone })(at), false);
    assert.equal(createSearchMatcher('before:' + date, { timeZone: zone })(before), true);
  }
  const tokyo = thread('tokyo', '2026-10-28T15:00:00Z');
  assert.equal(createSearchMatcher('after:2026/10/29', { timeZone: 'Asia/Tokyo' })(tokyo), true);
  for (const timeZone of [undefined, 'UTC', zone, 'Asia/Tokyo']) {
    assert.equal(createSearchMatcher('after:2026-10-29', { timeZone })(thread()), true);
    assert.equal(createSearchMatcher('after:1793232000', { timeZone })(thread()), true);
    for (const value of ['2026/02/29', '2026/13/01', 'tomorrow']) assert.equal(createSearchMatcher('after:' + value, { timeZone })(thread()), false);
  }
});

test('summary cursors bind normalized zone and preserve exact absent-zone legacy cursor context', () => {
  const store = fixture(); for (const id of ['one', 'two', 'three']) store.put('thread', id, thread(id));
  try {
    const q = 'subject:fixture', options = { accountId: 'a', q, limit: 1 };
    const legacy = store.threadSummaries(options), row = legacy.threads[0];
    const context = createHash('sha256').update(JSON.stringify({ accountId: 'a', folder: 'inbox', q, split: 'all' })).digest('base64url');
    assert.equal(legacy.nextCursor, Buffer.from(JSON.stringify({ v: 1, context, date: row.lastMessageAt, id: row.id })).toString('base64url'));
    assert.equal(store.threadSummaries({ ...options, cursor: legacy.nextCursor }).threads.length, 1);
    const page = store.threadSummaries({ ...options, timeZone: 'America/Los_Angeles' });
    for (const changes of [{ timeZone: undefined }, { timeZone: 'UTC' }, { timeZone: 'Asia/Tokyo' }, { accountId: 'b' }]) assert.throws(() => store.threadSummaries({ ...options, timeZone: 'America/Los_Angeles', cursor: page.nextCursor, ...changes }), { status: 400, code: 'invalid_cursor' });
    const alias = store.threadSummaries({ ...options, timeZone: 'US/Pacific' });
    assert.equal(store.threadSummaries({ ...options, timeZone: 'America/Los_Angeles', cursor: alias.nextCursor }).threads.length, 1);
  } finally { store.close(); }
});

test('actual socket-free routes reject duplicate or invalid zones before wake/search and pass valid zones to both query paths', async () => {
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, providerDraftAutomatic: false });
  app.store.put<Account>('account', 'a', { id: 'a', name: 'Synthetic account', email: 'a@example.test', provider: 'demo', color: '#000' });
  app.store.put('preferences', 'global', { activeAccountId: 'a' }); app.store.put('thread', 'fixture', thread());
  const due = thread('due'); due.snoozedUntil = '2020-01-01T00:00:00Z'; app.store.put('thread', 'due', due);
  let searches = 0; const original = app.store.threads.bind(app.store);
  app.store.threads = (...args) => { searches++; return original(...args); };
  try {
    for (const path of ['/api/threads', '/api/thread-summaries']) {
      app.store.put('thread', 'due', due);
      for (const zone of ['Not/A_Zone', '', '+01:00', 'America/Los_Angeles&timeZone=UTC']) {
        const before = searches, changes = app.store.db.prepare('SELECT total_changes() n').get()!.n;
        const response = await invoke(app, path + '?accountId=a&q=subject:fixture&timeZone=' + zone);
        assert.equal(response.status, 400); assert.equal(response.body.error.code, 'invalid_search_time_zone');
        assert.equal(searches, before); assert.equal(app.store.db.prepare('SELECT total_changes() n').get()!.n, changes);
      }
      app.store.remove('thread', 'due');
      const response = await invoke(app, path + '?accountId=a&q=' + encodeURIComponent('subject:fixture before:2026/10/29') + '&timeZone=America%2FLos_Angeles');
      assert.equal(response.status, 200); assert.equal(response.body.threads.length, 1); assert.equal(response.body.threads[0].id, 'fixture');
    }
    assert.throws(() => original('a', 'all', '', 'Not/A_Zone'), { status: 400, code: 'invalid_search_time_zone' });
    assert.throws(() => app.store.threadSummaries({ accountId: 'a', timeZone: 'Not/A_Zone' }), { status: 400, code: 'invalid_search_time_zone' });
    assert.equal(app.store.list('delivery').length, 0);
  } finally { await app.close(); }
});
