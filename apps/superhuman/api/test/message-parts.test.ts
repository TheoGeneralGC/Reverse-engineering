import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { createApp } from '../src/server.ts';
import type { Account, Thread } from '../src/types.ts';

const account: Account = { id: 'google:fixture', name: 'Fixture', email: 'fixture@example.test', provider: 'google', color: '#888' };
const textAttachment = 'PRIVATE_ATTACHMENT_CONTENT_NEVER_IN_BODY';
const fixture = () => ({
  id: 'message-fixture', threadId: 'thread-fixture', snippet: 'Main body', internalDate: '100000000', labelIds: ['INBOX'],
  payload: { partId: '', mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'sender@example.test' }, { name: 'To', value: account.email }, { name: 'Subject', value: 'Small attachment fixture' }], parts: [
    { partId: '0', mimeType: 'text/plain', filename: '', body: { data: Buffer.from('Main body only').toString('base64url'), size: 14 } },
    { partId: '1', mimeType: 'text/plain', filename: 'small.txt', body: { data: Buffer.from(textAttachment).toString('base64url'), size: 999 } },
    { partId: '2', mimeType: 'image/png', filename: 'inline.png', headers: [{ name: 'Content-ID', value: '<inline-fixture>' }, { name: 'Content-Disposition', value: 'inline; filename="inline.png"' }], body: { data: Buffer.from([0, 1, 127, 128, 255]).toString('base64url'), size: 5 } },
    { partId: '3', mimeType: 'text/plain', filename: 'empty.txt', body: { data: '', size: 0 } },
  ] },
});

test('Gmail embedded named text/inline bytes are attachments and never become message body or public byte fields', async () => {
  const store = new Store(':memory:'); store.put('account', account.id, account); const provider = new GoogleProvider(store, {});
  const message = provider.normalizeMessage(fixture(), account.id);
  assert.equal(message.text, 'Main body only'); assert.equal(message.attachments.length, 3); assert.equal(message.attachments[0].name, 'small.txt'); assert.equal(message.attachments[0].partId, '1'); assert.equal(message.attachments[0].source, 'embedded'); assert.equal(message.attachments[0].size, Buffer.byteLength(textAttachment));
  assert.ok(!JSON.stringify(message).includes(textAttachment)); assert.ok(!JSON.stringify(message).includes(Buffer.from(textAttachment).toString('base64url'))); assert.ok(message.attachments.every(item => !Object.hasOwn(item, 'data')));
  let externalCalls = 0; provider.request = async () => { externalCalls++; throw new Error('No provider call expected'); };
  assert.equal(Buffer.from((await provider.attachment(account.id, message.id, message.attachments[0].id)).data, 'base64url').toString(), textAttachment);
  assert.deepEqual(Buffer.from((await provider.attachment(account.id, message.id, message.attachments[1].id)).data, 'base64url'), Buffer.from([0, 1, 127, 128, 255]));
  assert.equal((await provider.attachment(account.id, message.id, message.attachments[2].id)).data, ''); assert.equal(externalCalls, 0); store.close();
});

test('fallback part identities are deterministic and distinguish same-named attachment siblings', () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, {}); const input = fixture();
  const first = input.payload.parts[1]; const second = { ...first, body: { data: Buffer.from('Second file').toString('base64url'), size: 11 } };
  const payload = { ...input, payload: { ...input.payload, parts: [{ ...first, partId: undefined }, { ...second, partId: undefined }] } };
  const parsed = provider.normalizeMessage(payload); const repeated = provider.normalizeMessage(payload);
  assert.notEqual(parsed.attachments[0].id, parsed.attachments[1].id); assert.deepEqual(parsed.attachments, repeated.attachments); assert.equal(parsed.attachments[0].partId, '0.0'); assert.equal(parsed.attachments[1].partId, '0.1'); assert.equal(parsed.text, ''); store.close();
});

test('sync persists embedded attachment bytes across reopen and downloads enforce account/message identity with safe headers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-message-parts-')); const databasePath = join(dir, 'mail.sqlite');
  try {
    const store = new Store(databasePath); store.put('account', account.id, account); const provider = new GoogleProvider(store, {});
    provider.request = async (_id, route) => { if (route === 'labels') return { labels: [] }; if (route === 'profile') return { historyId: '1' }; if (route.startsWith('threads?')) return { threads: [{ id: 'thread-fixture' }] }; if (route.startsWith('history?')) return { historyId: '2', history: [] }; return { id: 'thread-fixture', messages: [fixture()] }; };
    await provider.sync(account.id); const thread = store.required<Thread>('thread', `${account.id}:thread-fixture`); const attachment = thread.messages[0].attachments[0]; assert.equal(thread.messages[0].text, 'Main body only'); store.close();
    const app = createApp({ databasePath, runJobs: false, env: {} }); app.store.put<Account>('account', 'google:other', { ...account, id: 'google:other', email: 'other@example.test' }); let providerCalls = 0; app.google.request = async () => { providerCalls++; throw new Error('Embedded download must not call Google'); };
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
    const path = (accountId: string, messageId: string) => `${base}/api/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`;
    const response = await fetch(path(account.id, 'message-fixture')); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('content-disposition'), "attachment; filename*=UTF-8''small.txt"); assert.equal(await response.text(), textAttachment);
    assert.equal((await fetch(path('google:other', 'message-fixture'))).status, 404); assert.equal((await fetch(path(account.id, 'wrong-message'))).status, 404); assert.equal(providerCalls, 0); await app.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('provider attachment IDs still fetch remotely while unavailable attached containers do not leak child body text', async () => {
  const store = new Store(':memory:'); store.put('account', account.id, account); const provider = new GoogleProvider(store, {}); const input = fixture();
  const message = provider.normalizeMessage({ ...input, payload: { ...input.payload, parts: [{ partId: 'provider', filename: 'large.bin', mimeType: 'application/octet-stream', body: { attachmentId: 'provider-attachment', size: 3 } }, { partId: 'container', filename: 'attached.eml', mimeType: 'message/rfc822', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Attached message content').toString('base64url') } }] }] } }, account.id);
  assert.equal(message.text, ''); assert.equal(message.attachments[0].source, 'provider'); assert.equal(message.attachments[1].source, 'unavailable');
  let calls = 0; provider.request = async (id, path) => { calls++; assert.equal(id, account.id); assert.equal(path, 'messages/message-fixture/attachments/provider-attachment'); return { data: Buffer.from('abc').toString('base64url'), size: 3 }; };
  const bytes = await provider.attachment(account.id, message.id, 'provider-attachment'); assert.equal(bytes.name, 'large.bin'); assert.equal(Buffer.from(bytes.data, 'base64url').toString(), 'abc');
  await assert.rejects(() => provider.attachment(account.id, message.id, message.attachments[1].id), /not available/); assert.equal(calls, 1); store.close();
});
