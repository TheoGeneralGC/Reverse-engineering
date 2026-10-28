import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import type { Account, Thread } from '../src/types.ts';

test('account-scoped lists and searches do not JSON-parse unrelated account conversations', () => {
  const store = new Store(':memory:'); const template = store.required<Thread>('thread', 'demo-thread-1');
  store.put<Account>('account', 'other', { id: 'other', name: 'Other', email: 'other@example.test', provider: 'demo', color: '#888' });
  for (let index = 0; index < 100; index++) store.put<Thread>('thread', `other-${index}`, { ...template, id: `other-${index}`, accountId: 'other', subject: 'UNRELATED_THREAD_MUST_NOT_BE_PARSED', providerLabels: ['INBOX', 'SENT'] });
  const originalParse = JSON.parse; let unrelatedParses = 0;
  JSON.parse = (text, reviver) => { if (text.includes('UNRELATED_THREAD_MUST_NOT_BE_PARSED')) unrelatedParses++; return originalParse(text, reviver); };
  try {
    assert.equal(store.threads('demo', 'inbox').length, 12); assert.equal(store.threads('demo', 'all', 'from:jordan').length, 2); assert.equal(store.threads('nonexistent', 'all').length, 0); assert.equal(unrelatedParses, 0);
  } finally { JSON.parse = originalParse; store.close(); }
});

test('snooze candidates exclude ordinary mailbox records before JSON parsing', () => {
  const store = new Store(':memory:'); const template = store.required<Thread>('thread', 'demo-thread-1');
  for (let index = 0; index < 100; index++) store.put<Thread>('thread', `ordinary-${index}`, { ...template, id: `ordinary-${index}`, subject: 'ORDINARY_THREAD_MUST_NOT_BE_PARSED' });
  store.put<Thread>('thread', 'due', { ...template, id: 'due', snoozedUntil: '2026-10-27T12:00:00.000Z' });
  const originalParse = JSON.parse; let ordinaryParses = 0;
  JSON.parse = (text, reviver) => { if (text.includes('ORDINARY_THREAD_MUST_NOT_BE_PARSED')) ordinaryParses++; return originalParse(text, reviver); };
  try {
    const now = Date.parse('2026-10-27T13:00:00.000Z'); assert.deepEqual(store.dueSnoozes(now).map(thread => thread.id), ['due']); store.wakeSnoozes(now); assert.equal(store.required<Thread>('thread', 'due').snoozedUntil, undefined); assert.equal(ordinaryParses, 0);
  } finally { JSON.parse = originalParse; store.close(); }
});

test('snooze offset dates, noncanonical dates and retry backoff retain Date.parse semantics', () => {
  const store = new Store(':memory:'); const template = store.required<Thread>('thread', 'demo-thread-1');
  const entries = [
    { id: 'offset-due', snoozedUntil: '2026-10-27T20:30:00+08:00' },
    { id: 'offset-future', snoozedUntil: '2026-10-27T08:30:00-07:00' },
    { id: 'noncanonical-due', snoozedUntil: 'Oct 27 2026 12:00:00 GMT+0000' },
    { id: 'retry-future', snoozedUntil: '2026-10-27T12:00:00Z', snoozeRetryAt: 'Oct 27 2026 14:00:00 GMT+0000' },
    { id: 'retry-due', snoozedUntil: '2026-10-27T11:00:00Z', snoozeRetryAt: '2026-10-27T20:00:00+08:00' },
    { id: 'invalid', snoozedUntil: 'not-a-time' },
    { id: 'empty', snoozedUntil: '' },
  ];
  for (const entry of entries) store.put('thread', entry.id, { ...template, ...entry });
  const result = store.dueSnoozes(Date.parse('2026-10-27T13:00:00Z'));
  assert.deepEqual(new Set(result.map(thread => thread.id)), new Set(['offset-due', 'noncanonical-due', 'retry-due'])); assert.equal(store.dueSnoozes(Date.parse('2026-10-27T13:00:00Z'), 1).length, 1); store.close();
});

test('lookup indexes are added to an existing private fixture database without changing mailbox membership', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-query-index-')); const path = join(directory, 'mail.sqlite');
  try {
    let store = new Store(path); const template = store.required<Thread>('thread', 'demo-thread-1'); store.put<Thread>('thread', 'mixed', { ...template, id: 'mixed', providerLabels: ['INBOX', 'SENT'] }); store.db.exec('DROP INDEX thread_account_lookup; DROP INDEX thread_snooze_candidates;'); store.close();
    store = new Store(path); assert.ok(store.threads('demo', 'inbox').some(thread => thread.id === 'mixed')); assert.ok(store.threads('demo', 'sent').some(thread => thread.id === 'mixed')); assert.ok(store.threads('demo', 'all', 'in:sent in:inbox').some(thread => thread.id === 'mixed'));
    const accountPlan = store.db.prepare("EXPLAIN QUERY PLAN SELECT data FROM records WHERE kind='thread' AND json_extract(data,'$.accountId')=? ORDER BY rowid").all('demo').map(row => String(row.detail)); assert.ok(accountPlan.some(detail => detail.includes('thread_account_lookup')));
    const snoozePlan = store.db.prepare("EXPLAIN QUERY PLAN SELECT data FROM records INDEXED BY thread_snooze_candidates WHERE kind='thread' AND json_type(data,'$.snoozedUntil')='text' AND json_extract(data,'$.snoozedUntil')<>'' ORDER BY rowid").all().map(row => String(row.detail)); assert.ok(snoozePlan.some(detail => detail.includes('thread_snooze_candidates'))); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
