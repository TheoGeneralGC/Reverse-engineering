import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchMatcher } from '../src/search.ts';
import { Store } from '../src/store.ts';
import type { Label, Thread } from '../src/types.ts';

function fixture(overrides: Partial<Thread> = {}): Thread {
  return { id: 'planning', accountId: 'demo', subject: 'Launch planning', snippet: 'The blue moon report is ready', sender: { name: 'Alice Chen', email: 'alice@example.test' }, participants: [], lastMessageAt: '2026-06-01T00:00:00.000Z', unread: true, starred: true, important: true, folder: 'inbox', labels: ['work'], messages: [{ id: 'message-1', sender: { name: 'Alice Chen', email: 'alice@example.test' }, to: [{ name: 'Alex', email: 'alex@demo.local' }], cc: [{ name: 'Bob Rivera', email: 'bob@example.test' }], date: '2026-06-01T00:00:00.000Z', text: 'The blue moon report is ready. Track ticket:42. Exact quote: "approved".', attachments: [{ id: 'attachment-1', name: 'Launch plan.PDF', mimeType: 'application/pdf', size: 400 }] }], ...overrides };
}
const labels: Label[] = [{ id: 'work', accountId: 'demo', name: 'Work Projects' }, { id: 'foreign', accountId: 'other', name: 'Private' }];
const context = { labels, accountEmail: () => 'alex@demo.local' };
const matches = (query: string, thread = fixture()) => createSearchMatcher(query, context)(thread);

test('advertised before/after filters return the actual seeded date range through Store', () => {
  const store = new Store(':memory:');
  try {
    const total = store.threads('demo', 'all').length;
    assert.equal(total, 13);
    assert.equal(store.threads('demo', 'all', 'after:2026/06/01 before:2027/01/01').length, total);
    assert.equal(store.threads('demo', 'all', 'before:2026/06/01').length, 0);
    assert.equal(store.threads('demo', 'all', 'after:2027/01/01').length, 0);
  } finally { store.close(); }
});

test('date boundaries are deterministic UTC, inclusive after and exclusive before', () => {
  const before = fixture({ lastMessageAt: '2026-05-31T23:59:59.999Z' });
  const boundary = fixture();
  assert.equal(matches('before:2026/06/01', before), true);
  assert.equal(matches('before:2026/06/01', boundary), false);
  assert.equal(matches('after:2026-06-01', boundary), true);
  assert.equal(matches('after:2026-06-01', before), false);
  assert.equal(matches('older:2026/06/01', before), true);
  assert.equal(matches('newer:2026/06/01', boundary), true);
  assert.equal(matches('-after:2026/06/01', before), true);
  assert.equal(matches(`after:${Date.parse(boundary.lastMessageAt) / 1000}`, boundary), true);
});

test('invalid dates cannot silently match or normalize to a different calendar day', () => {
  for (const query of ['before:2026/02/29', 'after:2026/13/01', 'after:tomorrow', 'before:garbage']) assert.equal(matches(query), false, query);
  assert.equal(matches('after:2024/02/29', fixture({ lastMessageAt: '2024-02-29T00:00:00.000Z' })), true);
});

test('quoted phrases, contact names and escaped quotes remain single search values', () => {
  assert.equal(matches('"blue moon"'), true);
  assert.equal(matches('"moon blue"'), false);
  assert.equal(matches('FROM:"Alice Chen" subject: "Launch planning"'), true);
  assert.equal(matches('"Exact quote: \\"approved\\"."'), true);
  assert.equal(matches('"from:alice"'), false);
});

test('implicit AND, explicit OR, parentheses and negation compose predicates', () => {
  assert.equal(matches('from:bob OR from:alice subject:launch'), true);
  assert.equal(matches('(from:bob OR from:alice) -subject:cancelled'), true);
  assert.equal(matches('from:alice AND subject:missing'), false);
  assert.equal(matches('NOT (from:bob OR subject:cancelled)'), true);
  assert.equal(matches('!(from:alice)'), false);
  assert.equal(matches('-in:inbox'), false);
});

test('brace alternatives and field-prefix groups work without losing quoted values', () => {
  assert.equal(matches('{from:bob from:alice} subject:launch'), true);
  assert.equal(matches('from:(bob OR "Alice Chen")'), true);
  assert.equal(matches('subject:{cancelled planning}'), true);
  assert.equal(matches('-from:(alice OR bob)'), false);
});

test('labels resolve account-scoped names, local IDs and provider IDs', () => {
  assert.equal(matches('label:"Work Projects"'), true);
  assert.equal(matches('in:"Work Projects"'), true);
  assert.equal(matches('label:work'), true);
  assert.equal(matches('label:Private'), false);
  const other = fixture({ labels: ['foreign'] });
  assert.equal(matches('label:Private', other), false);
  assert.equal(createSearchMatcher('label:Label_5', { labels: [{ id: 'local-5', accountId: 'demo', name: 'Project', providerId: 'Label_5' }] })(fixture({ labels: ['local-5'] })), true);
});

test('attachment names and CC recipients can be searched independently of body text', () => {
  assert.equal(matches('has:attachment filename:"launch plan.pdf" cc:bob'), true);
  assert.equal(matches('filename:png'), false);
  assert.equal(matches('cc:"Bob Rivera"'), true);
  assert.equal(matches('from:me'), false);
  assert.equal(matches('to:me'), true);
});

test('folder queries preserve mixed provider Inbox and Sent membership', () => {
  const thread = fixture({ providerLabels: ['INBOX', 'SENT', 'STARRED'] });
  assert.equal(matches('in:sent in:inbox is:flagged', thread), true);
  assert.equal(matches('-in:sent', thread), false);
  assert.equal(matches('in:archive', fixture({ folder: 'done' })), true);
  assert.equal(matches('in:reminders', fixture({ snoozedUntil: '2027-01-01T00:00:00.000Z' })), true);
});

test('unknown operator text is literal and whitespace-only queries retain all scoped threads', () => {
  assert.equal(matches('ticket:42'), true);
  assert.equal(matches('ticket:43'), false);
  assert.equal(matches('bcc:alex'), false);
  const store = new Store(':memory:');
  try {
    assert.equal(store.threads('demo', 'all', '   ').length, 13);
    assert.equal(store.threads('nonexistent', 'all', 'after:2020/01/01').length, 0);
  } finally { store.close(); }
});

test('whitespace-only search preserves folder scope and excludes spam/trash from All Mail', () => {
  const store = new Store(':memory:');
  try {
    const original = store.required<Thread>('thread', 'demo-thread-1');
    for (const folder of ['spam', 'trash'] as const) store.put<Thread>('thread', `query-${folder}`, { ...original, id: `query-${folder}`, folder });
    for (const folder of ['inbox', 'all', 'spam', 'trash', 'starred']) {
      assert.deepEqual(store.threads('demo', folder, ' \t\n ').map(thread => thread.id), store.threads('demo', folder, '').map(thread => thread.id), folder);
    }
    assert.equal(store.threads('demo', 'all', '   ').some(thread => thread.id === 'query-trash' || thread.id === 'query-spam'), false);
  } finally { store.close(); }
});
