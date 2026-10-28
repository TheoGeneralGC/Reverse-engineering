import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { AiProvider } from '../src/ai.ts';
import { createApp } from '../src/server.ts';
import { buildMime } from '../src/mime.ts';
import { HttpError } from '../src/types.ts';
import type { Account, Draft, Thread } from '../src/types.ts';

test('thread mutation and one-time undo survive database reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-store-')); const path = join(dir, 'mail.sqlite');
  try {
    let store = new Store(path); const before = store.required<Thread>('thread', 'demo-thread-1');
    const plan = store.prepareAction(before.id, 'archive'); const change = store.commitAction(plan.before, plan.thread);
    store.saveDraft({ id: 'persistent', to: 'someone@example.test', subject: 'Persistence', body: 'Saved body' });
    store.updatePreferences({ signature: 'A persisted signature' }); store.close();
    store = new Store(path);
    assert.equal(store.required<Thread>('thread', before.id).folder, 'done');
    assert.equal(store.required<Draft>('draft', 'persistent').body, 'Saved body');
    assert.equal(store.preferences().signature, 'A persisted signature');
    const undo = store.pendingUndo(change.undoId); store.commitUndo(change.undoId, undo);
    assert.deepEqual(store.required<Thread>('thread', before.id), before);
    assert.throws(() => store.pendingUndo(change.undoId), /Undo expired/);
    assert.equal(statSync(path).mode & 0o777, 0o600); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('search grammar, snooze wakeup and account boundaries', () => {
  const store = new Store(':memory:');
  assert.equal(store.threads('demo', 'all', 'from:jordan subject:launch').length, 1);
  assert.ok(store.threads('demo', 'all', 'is:unread').every(t => t.unread));
  assert.equal(store.threads('demo', 'all', 'has:attachment').length, 1);
  assert.equal(store.threads('unknown').length, 0);
  const until = new Date(Date.now() + 60_000).toISOString(); const plan = store.prepareAction('demo-thread-1', 'snooze', { until }); store.commitAction(plan.before, plan.thread);
  assert.equal(store.threads('demo', 'snoozed').length, 1);
  assert.ok(!store.threads('demo', 'inbox').some(t => t.id === plan.thread.id));
  store.wakeSnoozes(Date.now() + 61_000); assert.equal(store.threads('demo', 'snoozed').length, 0);
  store.put('label', 'foreign', { id: 'foreign', accountId: 'other', name: 'Other' });
  assert.throws(() => store.prepareAction('demo-thread-1', 'label', { labelId: 'foreign' }), /different account/);
  store.close();
});

test('OAuth token encryption rejects tampering and secrets are absent from account records', () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) });
  const tokens = { access_token: 'sensitive-access-value', refresh_token: 'sensitive-refresh-value', expires_at: Date.now() + 10000 };
  const sealed = provider.seal(tokens); assert.ok(!sealed.includes(tokens.access_token)); assert.deepEqual(provider.unseal(sealed), tokens);
  const values = sealed.split('.'); const ciphertext = Buffer.from(values[2], 'base64url'); ciphertext[0] ^= 1; values[2] = ciphertext.toString('base64url');
  assert.throws(() => provider.unseal(values.join('.')));
  provider.saveTokens('google-test', tokens);
  const raw = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get('google-test'); assert.ok(!JSON.stringify(raw).includes(tokens.refresh_token));
  assert.ok(!JSON.stringify(store.list<Account>('account')).includes(tokens.access_token)); store.close();
});

test('delivery guard blocks unknown recipients and CRLF injection before network access', () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, { APPROVED_TEST_RECIPIENTS: 'approved@example.test', APPROVED_TEST_SENDERS: 'alex@demo.local' });
  const draft = store.saveDraft({ to: 'approved@example.test', cc: 'unapproved@example.test', body: 'Test' });
  assert.throws(() => provider.validateDelivery(draft), /explicitly approved/);
  assert.throws(() => provider.validateDelivery({ ...draft, cc: '', subject: 'Hello\r\nBcc: hidden@example.test' }), /line breaks/);
  assert.doesNotThrow(() => provider.validateDelivery({ ...draft, cc: '' })); store.close();
});

test('delivery requires an explicitly approved authenticated sender and empty sender approval disables delivery', async () => {
  const app = createApp({ databasePath: ':memory:', env: { APPROVED_TEST_RECIPIENTS: 'approved@example.test' }, runJobs: false });
  app.store.put<Account>('account', 'google:test', { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' });
  const draft = app.store.saveDraft({ accountId: 'google:test', to: 'approved@example.test', subject: 'Sender guard' }); let sends = 0; app.google.send = async () => { sends++; return { id: 'should-not-send' }; };
  assert.equal(app.google.status().deliveryEnabled, false);
  await assert.rejects(() => app.deliver(draft.id), error => error instanceof HttpError && error.code === 'sender_not_approved'); assert.equal(sends, 0); assert.equal(app.store.list('delivery').length, 0);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const scheduled = await fetch(`http://127.0.0.1:${address.port}/api/drafts/${draft.id}/schedule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduledAt: new Date(Date.now() + 60_000).toISOString() }) }); assert.equal(scheduled.status, 403); assert.equal((await scheduled.json()).error.code, 'sender_not_approved'); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'draft');
  app.google.env.APPROVED_TEST_SENDERS = 'different@example.test'; assert.throws(() => app.google.validateDelivery(draft), /sender is not approved/);
  app.google.env.APPROVED_TEST_SENDERS = 'SENDER@example.test'; assert.doesNotThrow(() => app.google.validateDelivery(draft));
  app.google.env.GOOGLE_CLIENT_ID = 'dummy'; app.google.env.GOOGLE_CLIENT_SECRET = 'dummy'; app.google.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); assert.equal(app.google.status().deliveryEnabled, true); assert.deepEqual(app.google.status().approvedTestSenders, ['sender@example.test']);
  app.google.env.APPROVED_TEST_SENDERS = ''; assert.equal(app.google.status().deliveryEnabled, false); await app.close();
});

test('Google OAuth state rejects a mismatching browser session without exchanging a code', async () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', TOKEN_ENCRYPTION_KEY: 'b'.repeat(64) });
  const auth = provider.startAuth(); assert.ok(auth.url.startsWith('https://accounts.google.com/')); const url = new URL(auth.url); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  await assert.rejects(() => provider.finishAuth(auth.state, 'different-browser-session', 'not-a-real-code'), /Invalid authorization state/);
  assert.equal(store.list('account').length, 1); store.close();
});

test('API persists drafts, provides actionable missing-credential status and rejects cross-origin mutations', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, method = 'GET', data?: unknown, origin?: string) => fetch(base + path, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) }, body: data ? JSON.stringify(data) : undefined });
  try {
    const bootstrap = await (await request('/api/bootstrap')).json(); assert.equal(bootstrap.demo, true); assert.equal(bootstrap.accounts[0].provider, 'demo'); assert.equal(bootstrap.threads.length, 12);
    const draftResponse = await request('/api/drafts', 'POST', { to: 'test@example.test', subject: 'Persistent draft', body: 'Hello' }); assert.equal(draftResponse.status, 201); const { draft } = await draftResponse.json();
    await request(`/api/drafts/${draft.id}`, 'PATCH', { body: 'Updated' });
    const drafts = await (await request('/api/drafts')).json(); assert.equal(drafts.drafts[0].body, 'Updated');
    assert.equal((await request(`/api/drafts/${draft.id}/send`, 'POST', {})).status, 403);
    assert.equal((await request('/api/auth/google/start')).status, 503);
    const status = await (await request('/api/provider/status')).json(); assert.ok(status.google.missing.includes('GOOGLE_CLIENT_ID'));
    assert.equal((await request('/api/ai', 'POST', { prompt: 'Write a reply', mode: 'write' })).status, 503);
    const snippets = [{ id: 'greeting', title: 'Greeting', body: 'Hello there' }]; await request('/api/preferences', 'PATCH', { signature: 'Signed, Alex', snippets }); const prefs = await (await request('/api/preferences')).json(); assert.equal(prefs.preferences.signature, 'Signed, Alex'); assert.deepEqual(prefs.preferences.snippets, snippets);
    const mutation = await request('/api/threads/demo-thread-1/actions', 'POST', { action: 'archive' }); const { thread, undoId } = await mutation.json(); assert.equal(thread.folder, 'done');
    const undone = await (await request('/api/undo', 'POST', { undoId })).json(); assert.equal(undone.thread.folder, 'inbox');
    assert.equal((await request('/api/preferences', 'PATCH', { theme: 'light' }, 'https://untrusted.example')).status, 403);
    assert.equal((await request('/api/drafts', 'POST', { to: ['invalid-type'] })).status, 400);
    const toggles = { 'Auto Advance': false, 'Hide Empty Split Inboxes': true, 'Backtick as Escape': true, 'Show Sender Full Names': false };
    const savedToggles = await (await request('/api/preferences', 'PATCH', toggles)).json(); for (const [key, value] of Object.entries(toggles)) assert.equal(savedToggles.preferences[key], value);
    assert.equal((await request('/api/preferences', 'PATCH', { 'Auto Advance': 'true' })).status, 400);
    const upload = await request(`/api/drafts/${draft.id}/attachments`, 'POST', { name: 'note.txt', mimeType: 'text/plain', data: Buffer.from('Attachment bytes').toString('base64') }); assert.equal(upload.status, 201); const attached = await upload.json();
    const download = await request(`/api/drafts/${draft.id}/attachments/${attached.attachment.id}`); assert.equal(await download.text(), 'Attachment bytes');
    const removed = await (await request(`/api/drafts/${draft.id}/attachments/${attached.attachment.id}`, 'DELETE')).json(); assert.equal(removed.draft.attachments.length, 0);
  } finally { await app.close(); }
});

test('attachments persist as bytes, enforce ownership and validate size/MIME; MIME carries exact bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-attachments-')); const path = join(dir, 'mail.sqlite');
  try {
    let store = new Store(path); const draft = store.saveDraft({ to: 'receiver@example.test', subject: 'A file', body: 'Attached below' });
    const bytes = Buffer.from([0, 1, 2, 127, 128, 255]); const { attachment } = store.addAttachment(draft.id, { name: 'résumé.bin', mimeType: 'application/octet-stream', data: bytes.toString('base64') }); store.close();
    store = new Store(path); const persisted = store.required<Draft>('draft', draft.id); assert.equal(persisted.attachments?.[0].name, 'résumé.bin'); assert.deepEqual(store.attachmentBytes(draft.id, attachment.id), bytes);
    const mime = buildMime(persisted, store.required<Account>('account', 'demo'), undefined, [{ metadata: attachment, bytes }]); assert.ok(mime.includes('multipart/mixed')); assert.ok(mime.includes("filename*=UTF-8''r%C3%A9sum%C3%A9.bin")); assert.ok(mime.includes(bytes.toString('base64')));
    const other = store.saveDraft({}); assert.throws(() => store.attachmentBytes(other.id, attachment.id), /not found/);
    assert.throws(() => store.addAttachment(draft.id, { name: '../bad', mimeType: 'text/plain', data: '' }), /name/);
    assert.throws(() => store.addAttachment(draft.id, { name: 'bad', mimeType: 'text/plain\r\nX-Header: bad', data: '' }), /MIME/);
    assert.throws(() => store.addAttachment(draft.id, { name: 'bad', mimeType: 'text/plain', data: 'a=aa' }), /base64/);
    assert.throws(() => store.addAttachment(draft.id, { name: 'large', mimeType: 'application/octet-stream', data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }), /10 MiB/);
    store.removeAttachment(draft.id, attachment.id); assert.throws(() => store.attachmentBytes(draft.id, attachment.id), /not found/); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reply-all deduplicates recipients, excludes own address and preserves original CC', () => {
  const store = new Store(':memory:'); const thread = store.required<Thread>('thread', 'demo-thread-1'); const latest = thread.messages[0]; latest.to = [{ name: 'Alex', email: 'ALEX@demo.local' }, { name: 'Maya', email: 'maya@example.test' }]; latest.cc = [{ name: 'Maya', email: 'MAYA@example.test' }, { name: 'Sam', email: 'sam@example.test' }, { name: 'Self', email: 'alex@demo.local' }]; store.put('thread', thread.id, thread);
  const reply = store.replyDraft(thread.id, 'reply'); assert.equal(reply.to, 'jordan@example.test'); assert.equal(reply.cc, '');
  const all = store.replyDraft(thread.id, 'replyAll'); assert.equal(all.to, 'jordan@example.test, maya@example.test'); assert.equal(all.cc, 'sam@example.test'); assert.equal(all.subject, 'Re: A few thoughts on the launch');
  const forward = store.replyDraft(thread.id, 'forward'); assert.equal(forward.to, ''); assert.equal(forward.threadId, undefined); assert.ok(forward.body.includes('Forwarded message')); store.close();
});

test('undo restores only affected labels and preserves a later unrelated star', () => {
  const store = new Store(':memory:'); const before = store.required<Thread>('thread', 'demo-thread-1'); const plan = store.prepareAction(before.id, 'label', { labelId: 'finance' }); const { undoId } = store.commitAction(plan.before, plan.thread);
  const star = store.prepareAction(before.id, 'star'); store.commitAction(star.before, star.thread);
  const undo = store.pendingUndo(undoId); assert.equal(undo.starred, true); assert.deepEqual(undo.labels, before.labels); store.commitUndo(undoId, undo);
  const archive = store.prepareAction(before.id, 'archive'); const undoArchive = store.commitAction(archive.before, archive.thread); const trash = store.prepareAction(before.id, 'trash'); store.commitAction(trash.before, trash.thread);
  assert.throws(() => store.pendingUndo(undoArchive.undoId), /changed since/); store.close();
});

test('paginated Gmail sync resumes after reopen and applies incremental history and deletions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-google-sync-')); const path = join(dir, 'mail.sqlite');
  const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' };
  let historyCalls = 0;
  const fakeRequest = async (_accountId: string, route: string) => {
    if (route === 'labels') return { labels: [{ id: 'Label_1', name: 'Project', type: 'user' }] };
    if (route === 'profile') return { historyId: '10' };
    if (route.startsWith('threads?')) { const url = new URL(`https://test/${route}`); assert.equal(url.searchParams.get('includeSpamTrash'), 'true'); return url.searchParams.get('pageToken') === 'next' ? { threads: [{ id: 'two' }], resultSizeEstimate: 2 } : { threads: [{ id: 'one' }], nextPageToken: 'next', resultSizeEstimate: 2 }; }
    if (route.startsWith('history?')) { historyCalls++; return { historyId: String(10 + historyCalls), history: [{ messages: [{ id: 'm1', threadId: 'one' }], messagesDeleted: [{ message: { id: 'm2', threadId: 'two' } }] }] }; }
    if (route.startsWith('threads/two') && historyCalls) throw new HttpError(404, 'Gone', 'google_not_found');
    const threadId = route.startsWith('threads/one') ? 'one' : 'two';
    return { id: threadId, messages: [{ id: `m-${threadId}`, threadId, snippet: historyCalls ? 'Updated' : 'Original', internalDate: '10000000', labelIds: ['INBOX', ...(historyCalls ? ['STARRED'] : [])], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Sender <sender@example.test>' }, { name: 'Subject', value: threadId }], body: { data: Buffer.from('Body').toString('base64url') } } }] };
  };
  try {
    let store = new Store(path); store.put('account', account.id, account); let provider = new GoogleProvider(store, { GMAIL_SYNC_PAGES_PER_RUN: '1' }); provider.request = fakeRequest;
    const first = await provider.sync(account.id); assert.equal(first.partial, true); assert.equal(first.phase, 'initial'); assert.equal(store.list<Thread>('thread').filter(t => t.accountId === account.id).length, 1); store.close();
    store = new Store(path); provider = new GoogleProvider(store, { GMAIL_SYNC_PAGES_PER_RUN: '1' }); provider.request = fakeRequest;
    const second = await provider.sync(account.id); assert.equal(second.partial, true); assert.equal(second.phase, 'history'); assert.equal(store.list<Thread>('thread').filter(t => t.accountId === account.id).length, 2);
    const third = await provider.sync(account.id); assert.equal(third.partial, false); assert.equal(store.required<Thread>('thread', `${account.id}:one`).starred, true); assert.equal(store.get('thread', `${account.id}:two`), undefined); assert.equal(provider.syncStatus(account.id).partial, false); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed Gmail page does not advance its durable cursor; expired history restarts a full scan', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account);
  const provider = new GoogleProvider(store, { GMAIL_SYNC_PAGES_PER_RUN: '1' }); let fail = true;
  provider.request = async (_id, route) => { if (route === 'labels') return { labels: [] }; if (route === 'profile') return { historyId: '10' }; if (route.startsWith('threads?')) return { threads: [{ id: 'one' }], nextPageToken: 'next' }; if (fail) throw new Error('Provider unavailable'); return { id: 'one', messages: [] }; };
  await assert.rejects(() => provider.sync(account.id), /unavailable/); assert.equal(store.get<{ pageToken?: string }>('sync', account.id)?.pageToken, undefined);
  fail = false; await provider.sync(account.id); assert.equal(store.get<{ pageToken?: string }>('sync', account.id)?.pageToken, 'next');
  store.put('sync', account.id, { phase: 'history', historyId: 'expired', generation: 'g', partial: false });
  provider.request = async (_id, route) => { if (route === 'labels') return { labels: [] }; if (route === 'profile') return { historyId: '20' }; throw new HttpError(404, 'Expired', 'google_not_found'); };
  const reset = await provider.sync(account.id); assert.equal(reset.phase, 'initial'); assert.equal(reset.partial, true); assert.equal(store.get<{ historyId: string }>('sync', account.id)?.historyId, '20'); store.close();
});

test('explicit provider draft sync creates once then updates the saved provider draft ID', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account); const provider = new GoogleProvider(store, {}); const requests: { path: string; method: string | undefined }[] = [];
  provider.request = async (_id, path, init) => { requests.push({ path, method: init?.method }); return { id: 'provider-draft-1' }; };
  const draft = store.saveDraft({ accountId: account.id, to: 'receiver@example.test', subject: 'Draft', body: 'Saved but not sent' });
  const synced = await provider.syncDraft(draft); assert.equal(synced.providerDraftId, 'provider-draft-1'); await provider.syncDraft(store.saveDraft({ id: draft.id, body: 'Updated body' }));
  assert.deepEqual(requests, [{ path: 'drafts', method: 'POST' }, { path: 'drafts/provider-draft-1', method: 'PUT' }]); store.close();
});

test('AI sends only the selected thread and extracts all message output text', async () => {
  const store = new Store(':memory:'); let sent: Record<string, unknown> | undefined;
  const mockedFetch = (async (_url: unknown, request: RequestInit) => { sent = JSON.parse(String(request.body)); return new Response(JSON.stringify({ id: 'response-test', status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Summary.' }] }, { type: 'message', content: [{ type: 'output_text', text: 'Action item.' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  const ai = new AiProvider(store, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'configured-test-model' }, mockedFetch);
  const result = await ai.generate({ accountId: 'demo', mode: 'summarize', prompt: '', threadId: 'demo-thread-1' });
  assert.equal(result.text, 'Summary.\nAction item.'); assert.equal(sent?.store, false); assert.equal(sent?.model, 'configured-test-model');
  assert.ok(String(sent?.input).includes('launch')); assert.ok(!String(sent?.input).includes('Design review'));
  await assert.rejects(() => ai.generate({ mode: 'summarize', prompt: '' }), /Select a thread/); store.close();
});

test('interrupted delivery is durably unknown after restart and is never retried', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-send-attempt-')); const path = join(dir, 'mail.sqlite');
  const env = { APPROVED_TEST_RECIPIENTS: 'approved@example.test', APPROVED_TEST_SENDERS: 'sender@example.test' };
  try {
    const store = new Store(path); store.put<Account>('account', 'google:test', { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' });
    const draft = store.saveDraft({ accountId: 'google:test', to: 'approved@example.test', body: 'Test', status: 'scheduled', scheduledAt: new Date(Date.now() - 1).toISOString() });
    const pending = store.beginDelivery(draft.id); assert.equal(pending.status, 'sending'); assert.ok(pending.deliveryMessageId); store.close();
    const app = createApp({ databasePath: path, env, runJobs: false }); let providerCalls = 0; app.google.send = async () => { providerCalls++; return { id: 'should-not-send' }; };
    assert.equal(app.store.required<Draft>('draft', draft.id).status, 'delivery_unknown');
    await assert.rejects(() => app.deliver(draft.id), /reconciled/); await app.runJobs(); assert.equal(providerCalls, 0);
    assert.throws(() => app.store.saveDraft({ id: draft.id, status: 'draft' }), /reconciled/); await app.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ambiguous provider failure and accepted-before-commit failure cannot be resent', async () => {
  const app = createApp({ databasePath: ':memory:', env: { APPROVED_TEST_RECIPIENTS: 'approved@example.test', APPROVED_TEST_SENDERS: 'sender@example.test' }, runJobs: false });
  app.store.put<Account>('account', 'google:test', { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' });
  let calls = 0; app.google.send = async () => { calls++; throw new Error('Socket lost after provider acceptance'); };
  const first = app.store.saveDraft({ accountId: 'google:test', to: 'approved@example.test' });
  await assert.rejects(() => app.deliver(first.id), /could not be confirmed/); assert.equal(app.store.required<Draft>('draft', first.id).status, 'delivery_unknown'); await assert.rejects(() => app.deliver(first.id), /reconciled/); assert.equal(calls, 1);
  app.google.send = async () => { calls++; return { id: 'provider-accepted' }; };
  const second = app.store.saveDraft({ accountId: 'google:test', to: 'approved@example.test' }); const originalCommit = app.store.completeDelivery.bind(app.store);
  app.store.completeDelivery = () => { throw new Error('Simulated durable result commit failure'); };
  await assert.rejects(() => app.deliver(second.id), /could not be confirmed/); assert.equal(app.store.required<Draft>('draft', second.id).status, 'delivery_unknown');
  app.store.completeDelivery = originalCommit; await assert.rejects(() => app.deliver(second.id), /reconciled/); assert.equal(calls, 2); await app.close();
});

test('scheduler re-reads queued drafts and never downgrades one manually sent while an earlier job waits', async () => {
  const app = createApp({ databasePath: ':memory:', env: { APPROVED_TEST_RECIPIENTS: 'approved@example.test', APPROVED_TEST_SENDERS: 'sender@example.test' }, runJobs: false });
  app.store.put<Account>('account', 'google:test', { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' });
  const scheduledAt = new Date(Date.now() - 1000).toISOString(); const first = app.store.saveDraft({ accountId: 'google:test', to: 'approved@example.test', status: 'scheduled', scheduledAt }); const second = app.store.saveDraft({ accountId: 'google:test', to: 'approved@example.test', status: 'scheduled', scheduledAt });
  let release!: () => void; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; }); const sent: string[] = [];
  app.google.send = async draft => { sent.push(draft.id); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'sending'); if (draft.id === first.id) { entered(); await gate; } return { id: `sent-${draft.id}` }; };
  const scheduledRun = app.runJobs(); await started; const manual = app.deliver(second.id); release(); await Promise.all([scheduledRun, manual]);
  assert.deepEqual(sent, [first.id, second.id]); assert.equal(app.store.required<Draft>('draft', second.id).status, 'sent'); await app.runJobs(); assert.equal(sent.length, 2); await app.close();
});

test('Gmail membership retains new inbox mail despite an older trashed message and includes received-then-replied in Sent', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account); const provider = new GoogleProvider(store, {});
  provider.request = async (_id, route) => {
    if (route === 'labels') return { labels: [] }; if (route === 'profile') return { historyId: '10' }; if (route.startsWith('threads?')) return { threads: [{ id: 'mixed' }] }; if (route.startsWith('history?')) return { historyId: '11', history: [] };
    return { id: 'mixed', messages: [['old', ['TRASH'], 'from@example.test'], ['received', ['INBOX'], 'from@example.test'], ['reply', ['SENT'], account.email]].map(([id, labelIds, sender], index) => ({ id, threadId: 'mixed', labelIds, snippet: 'Message', internalDate: String(1000000 + index), payload: { mimeType: 'text/plain', headers: [{ name: 'from', value: sender }, { name: 'subject', value: 'Mixed membership' }], body: { data: Buffer.from('Test').toString('base64url') } } })) };
  };
  await provider.sync(account.id); const thread = store.required<Thread>('thread', `${account.id}:mixed`); assert.equal(thread.folder, 'inbox'); assert.equal(store.threads(account.id, 'inbox').length, 1); assert.equal(store.threads(account.id, 'sent').length, 1); assert.equal(store.threads(account.id, 'all', 'in:sent').length, 1); assert.equal(store.threads(account.id, 'all', 'in:inbox').length, 1); assert.equal(store.threads(account.id, 'all', '-in:inbox').length, 0); assert.deepEqual(thread.messages[0].providerLabels, ['TRASH']);
  const archived = store.prepareAction(thread.id, 'archive'); const { undoId } = store.commitAction(archived.before, archived.thread); const starred = store.prepareAction(thread.id, 'star'); store.commitAction(starred.before, starred.thread); const restored = store.pendingUndo(undoId); assert.ok(restored.providerLabels?.includes('STARRED')); assert.ok(restored.providerLabels?.includes('INBOX'));
  let modification: unknown; provider.request = async (_id, _path, init) => { modification = JSON.parse(String(init?.body)); return {}; }; await provider.updateThread(store.required('thread', thread.id), restored); assert.deepEqual(modification, { addLabelIds: ['INBOX'], removeLabelIds: [] }); store.close();
});

test('account queue preserves rapid Star and Archive during awaited provider work', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false }); const thread = app.store.required<Thread>('thread', 'demo-thread-1'); app.store.put<Account>('account', 'google:test', { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' }); app.store.put('thread', thread.id, { ...thread, accountId: 'google:test', providerId: 'provider-thread', providerLabels: ['INBOX'] });
  let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  app.google.updateThread = async () => { calls++; if (calls === 1) { entered(); await gate; } };
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const action = (value: string) => fetch(`${base}/api/threads/${thread.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: value }) });
  const first = action('star'); await started; const second = action('archive'); release(); const results = await Promise.all([first, second]); assert.ok(results.every(response => response.status === 200)); const current = app.store.required<Thread>('thread', thread.id); assert.equal(current.starred, true); assert.equal(current.folder, 'done'); assert.deepEqual(current.providerLabels, ['STARRED']); await app.close();
});

test('OAuth success redirects after account persistence even when initial sync fails; retry uses saved account', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false }); let syncCalls = 0;
  app.google.finishAuth = async () => { app.store.put<Account>('account', 'google:connected', { id: 'google:connected', provider: 'google', email: 'connected@example.test', name: 'Connected', color: '#888' }); app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('google:connected', 'preserved-token-ciphertext'); return 'google:connected'; };
  app.google.sync = async () => { syncCalls++; if (syncCalls === 1) throw new Error('Temporary mailbox failure'); return { imported: 1, partial: false, phase: 'history' as const, pages: 1, resultSizeEstimate: undefined, scope: 'test' }; };
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/auth/google/callback?state=test&code=test`, { redirect: 'manual' }); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), 'http://127.0.0.1:5173');
  for (let attempt = 0; attempt < 20 && app.google.syncStatus('google:connected').status !== 'error'; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(app.google.syncStatus('google:connected').status, 'error'); assert.equal(app.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get('google:connected')?.value, 'preserved-token-ciphertext');
  const retry = await fetch(`${base}/api/accounts/google%3Aconnected/sync`, { method: 'POST' }); assert.equal(retry.status, 200); assert.equal(app.google.syncStatus('google:connected').status, 'ready'); await app.close();
});

test('rescheduling is rejected while a due delivery is queued behind account synchronization', async () => {
  const app = createApp({ databasePath: ':memory:', env: { APPROVED_TEST_RECIPIENTS: 'approved@example.test', APPROVED_TEST_SENDERS: 'sender@example.test' }, runJobs: false });
  app.store.put<Account>('account', 'google:test', { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' });
  const originalSchedule = new Date(Date.now() - 1000).toISOString(); const draft = app.store.saveDraft({ accountId: 'google:test', to: 'approved@example.test', status: 'scheduled', scheduledAt: originalSchedule });
  let entered!: () => void; let release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  app.google.sync = async () => { entered(); await gate; return { imported: 0, partial: false, phase: 'history' as const, pages: 1, resultSizeEstimate: undefined, scope: 'test' }; };
  let sends = 0; app.google.send = async () => { sends++; return { id: 'provider-sent' }; };
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const sync = fetch(`${base}/api/accounts/google%3Atest/sync`, { method: 'POST' }); await started;
  const scheduledRun = app.runJobs(); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'scheduled');
  const reschedule = await fetch(`${base}/api/drafts/${draft.id}/schedule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }) });
  assert.equal(reschedule.status, 409); assert.equal(app.store.required<Draft>('draft', draft.id).scheduledAt, originalSchedule); assert.equal(sends, 0);
  release(); await Promise.all([sync, scheduledRun]); assert.equal(sends, 1); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'sent'); await app.close();
});

test('archived Gmail snooze wakes in provider and local Inbox; failed wake stays due and retries with backoff', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false });
  const original = app.store.required<Thread>('thread', 'demo-thread-1'); const account: Account = { id: 'google:test', provider: 'google', email: 'sender@example.test', name: 'Sender', color: '#888' }; app.store.put('account', account.id, account);
  const id = 'provider-snoozed'; app.store.put<Thread>('thread', id, { ...original, id, accountId: account.id, providerId: 'provider-thread', folder: 'done', providerLabels: [] });
  const until = new Date(Date.now() + 1000).toISOString(); const snooze = app.store.prepareAction(id, 'snooze', { until }); app.store.commitAction(snooze.before, snooze.thread);
  const wakeAt = Date.now() + 2000; app.store.wakeSnoozes(wakeAt); assert.equal(app.store.required<Thread>('thread', id).snoozedUntil, until);
  let attempts = 0; let change: unknown;
  app.google.request = async (_accountId, _path, init) => { attempts++; change = JSON.parse(String(init?.body)); if (attempts === 1) throw new Error('Temporary provider failure'); return {}; };
  const failed = await app.wakeSnoozes(wakeAt); assert.equal(failed.failed, 1); const retained = app.store.required<Thread>('thread', id); assert.equal(retained.folder, 'done'); assert.equal(retained.snoozedUntil, until); assert.ok(retained.snoozeError); assert.equal(app.store.threads(account.id, 'inbox').length, 0);
  await app.wakeSnoozes(wakeAt + 1000); assert.equal(attempts, 1);
  const successful = await app.wakeSnoozes(wakeAt + 61_000); assert.equal(successful.woken, 1); assert.deepEqual(change, { addLabelIds: ['INBOX'], removeLabelIds: [] });
  const awake = app.store.required<Thread>('thread', id); assert.equal(awake.folder, 'inbox'); assert.equal(awake.snoozedUntil, undefined); assert.equal(awake.snoozeError, undefined); assert.ok(awake.providerLabels?.includes('INBOX')); assert.equal(app.store.threads(account.id, 'inbox').length, 1); await app.close();
});
