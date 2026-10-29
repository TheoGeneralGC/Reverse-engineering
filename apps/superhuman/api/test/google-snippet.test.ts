import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import { gmailSnippetToText } from '../src/gmail-snippet.ts';
import type { Account, Thread } from '../src/types.ts';

test('fresh Gmail snippet references decode once with Unicode and literal angle text preserved', () => {
  assert.equal(gmailSnippetToText('Cedar&#39;s &quot;plan&quot; &lt;next&gt; &amp; ready'), `Cedar's "plan" <next> & ready`);
  assert.equal(gmailSnippetToText('&#x1F332; &eacute; &NotEqualTilde;'), '🌲 é ≂̸');
  assert.equal(gmailSnippetToText('<b>Cedar</b>'), '<b>Cedar</b>');
});

test('one pass preserves encoded literal entity examples instead of recursively decoding them', () => {
  const raw = 'Type &amp;lt;plan&amp;gt; and &amp;#39;.';
  const text = gmailSnippetToText(raw);
  assert.equal(text, 'Type &lt;plan&gt; and &#39;.');
  assert.notEqual(gmailSnippetToText(text), text, 'Canonical output must never be passed through the raw-input codec again');
});

test('strict codec preserves tested unknown names, malformed references and missing semicolons', () => {
  const raw = '&notanentity; &#39 &#xQQ; &amp text AT&T';
  assert.equal(gmailSnippetToText(raw), raw);
});

function fixture() {
  let providerCalls = 0, modelCalls = 0;
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, providerDraftAutomatic: false,
    scheduler: { now: () => Date.parse('2026-10-29T10:00:00Z'), schedule: () => { throw Error('No snippet fixture timer allowed'); } },
    aiFetch: (async () => { modelCalls++; throw Error('No model transport allowed'); }) as typeof fetch });
  app.google.fetcher = (async () => { providerCalls++; throw Error('No provider transport allowed'); }) as typeof fetch;
  const account: Account = { id: 'google:snippet-fixture', provider: 'google', name: 'Synthetic', email: 'sender@example.test', color: '#888' };
  app.store.put('account', account.id, account);
  return { app, account, calls: () => ({ providerCalls, modelCalls }) };
}

test('actual Google sync imports only the latest raw snippet once while MIME bodies, headers, attachments and other account stay exact', async () => {
  const f = fixture();
  const plain = 'Body literal &#39; and &lt;tag&gt; must remain unchanged.\nCedar 🌲';
  const html = '<p>Body &amp;lt;tag&amp;gt; stays HTML.</p>';
  const bytes = Buffer.from('Synthetic attachment');
  const rawSnippet = 'Cedar&#39;s &lt;plan&gt;; example &amp;lt;tag&amp;gt;';
  const foreign = { id: 'other:thread', accountId: 'other', providerId: 'same-provider-id', subject: 'Foreign', snippet: 'Keep &lt;literal&gt;', sender: { name: 'Other', email: 'other@example.test' }, participants: [], lastMessageAt: '2026-10-28T00:00:00Z', unread: false, starred: false, important: false, folder: 'inbox', labels: [], messages: [] } satisfies Thread;
  f.app.store.put('account', 'other', { id: 'other', provider: 'demo', email: 'other@example.test', name: 'Other', color: '#000' });
  f.app.store.put('thread', foreign.id, foreign);
  const foreignBefore = JSON.stringify(f.app.store.required<Thread>('thread', foreign.id));
  const routes: string[] = [];
  f.app.google.request = async (accountId, route, init) => {
    assert.equal(accountId, f.account.id); assert.equal(init?.method ?? 'GET', 'GET'); routes.push(route);
    if (route === 'labels') return { labels: [] };
    if (route === 'profile') return { historyId: '10' };
    if (route.startsWith('threads?')) return { threads: [{ id: 'same-provider-id' }], resultSizeEstimate: 1 };
    if (route.startsWith('history?')) return { historyId: '11', history: [{ messages: [{ id: 'latest', threadId: 'same-provider-id' }] }] };
    assert.equal(route, 'threads/same-provider-id?format=full');
    const message = (id: string, date: string, snippet: string) => ({ id, threadId: 'same-provider-id', internalDate: date, snippet, labelIds: ['INBOX'], payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Fictional <fictional@example.test>' }, { name: 'To', value: 'Synthetic <sender@example.test>' }, { name: 'Subject', value: 'Synthetic snippet import' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(plain).toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } }, { mimeType: 'text/plain', filename: 'synthetic.txt', partId: '2', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { data: bytes.toString('base64url'), size: bytes.length } }] } });
    return { id: 'same-provider-id', messages: [message('latest', '20000000', rawSnippet), message('older', '10000000', 'Wrong&#39;s snippet')] };
  };
  try {
    await f.app.google.sync(f.account.id, { maxPages: 1 });
    const id = f.account.id + ':same-provider-id'; const thread = f.app.store.required<Thread>('thread', id);
    assert.equal(thread.snippet, "Cedar's <plan>; example &lt;tag&gt;");
    assert.deepEqual(thread.messages.map(m => m.id), ['older', 'latest']); assert.equal(thread.subject, 'Synthetic snippet import');
    for (const m of thread.messages) { assert.equal(m.text, plain); assert.equal(m.html, html); assert.equal(m.sender.email, 'fictional@example.test'); assert.deepEqual(m.to, [{name:'Synthetic',email:'sender@example.test'}]); assert.equal(m.attachments[0].name, 'synthetic.txt'); assert.equal(m.attachments[0].size, bytes.length); }
    const summary = JSON.parse(String(f.app.store.db.prepare('SELECT data FROM thread_summaries WHERE id=? AND account_id=?').get(id, f.account.id)!.data));
    assert.equal(summary.snippet, thread.snippet);
    const storedAttachments = f.app.store.list<{accountId:string;messageId:string;data:string}>('messageAttachment');
    assert.equal(storedAttachments.length, 2);
    for (const a of storedAttachments) { assert.equal(a.accountId, f.account.id); assert.deepEqual(Buffer.from(a.data, 'base64url'), bytes); }
    await f.app.google.sync(f.account.id, { maxPages: 1 });
    assert.equal(f.app.store.required<Thread>('thread', id).snippet, thread.snippet, 'A repeated fresh raw import must not decode stored canonical output');
    assert.equal(JSON.stringify(f.app.store.required<Thread>('thread', foreign.id)), foreignBefore);
    assert.equal(routes.filter(r => r === 'threads/same-provider-id?format=full').length, 2);
    assert.equal(f.app.store.list('draft').length, 0); assert.equal(f.app.store.list('delivery').length, 0);
    assert.deepEqual(f.calls(), { providerCalls: 0, modelCalls: 0 });
  } finally { await f.app.close(); }
});

test('stored local snippets are not decoded by Store writes or projection', async () => {
  const f = fixture(); try {
    const thread = { id: 'local-entity-example', accountId: f.account.id, providerId: 'provider-shaped-id', subject: 'Synthetic', snippet: 'Literal &lt;tag&gt; and &#39;', sender: { name: 'Synthetic', email: 'sender@example.test' }, participants: [], lastMessageAt: '2026-10-28T00:00:00Z', unread: false, starred: false, important: false, folder: 'sent', labels: [], messages: [] } satisfies Thread;
    f.app.store.put('thread', thread.id, thread);
    assert.equal(f.app.store.required<Thread>('thread', thread.id).snippet, thread.snippet);
    assert.equal(JSON.parse(String(f.app.store.db.prepare('SELECT data FROM thread_summaries WHERE id=?').get(thread.id)!.data)).snippet, thread.snippet);
    assert.deepEqual(f.calls(), { providerCalls: 0, modelCalls: 0 });
  } finally { await f.app.close(); }
});
