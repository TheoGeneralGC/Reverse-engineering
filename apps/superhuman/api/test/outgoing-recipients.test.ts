import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { createApp } from '../src/server.ts';
import { buildMime } from '../src/mime.ts';
import { parseOutgoingRecipientHeader, parseOutgoingRecipientHeaders, formatOutgoingRecipientHeader, validOutgoingRecipientEmail } from '../src/outgoing-recipients.ts';
import type { Account, Draft } from '../src/types.ts';

const account: Account = { id: 'google:synthetic', email: 'sender@example.test', name: 'Synthetic Sender', provider: 'google', color: '#888' };
const env = { DATABASE_PATH: ':memory:', APPROVED_TEST_SENDERS: account.email, APPROVED_TEST_RECIPIENTS: 'approved@example.test,second@example.test,third@example.test' };
const approved = 'approved@example.test';
const escapedName = '"O\\"Neil" <approved@example.test>';
const rejected = [
  `not-an-address, ${escapedName}`,
  `${JSON.stringify('not;an;address')}, ${escapedName}`,
  `${JSON.stringify('bad"quote')}, ${escapedName}`,
  `${JSON.stringify('line\r\nbreak')}, ${escapedName}`,
  `${JSON.stringify('Name <unfinished')}, ${escapedName}`,
  '"Unclosed <approved@example.test>', 'Name <unfinished, second@example.test',
  'Bad <prefix <approved@example.test>', 'Bad > <approved@example.test>',
  'Name <approved@example.test> trailing', 'Name <approved@example.test><second@example.test>',
  '"Dangling\\', '"Name\\" <approved@example.test>', '"Good" "More" <approved@example.test>',
  'unapproved@example.test <approved@example.test>', 'approved@example.test,,second@example.test',
  ',approved@example.test', 'approved@example.test,', 'approved@example.test;second@example.test',
  'Friends:approved@example.test;', 'Name(comment) <approved@example.test>',
  'a..b@example.test', 'a@example..test', '.a@example.test', 'a.@example.test',
  'a@-example.test', 'a@example-.test', '"local part"@example.test', 'a@[127.0.0.1]', 'é@example.test', 'a@exämple.test',
];

test('strict outgoing parser accepts canonical commas, escaped quotes/backslashes and quoted literal angles', () => {
  assert.deepEqual(parseOutgoingRecipientHeader('"REA, Two" <Approved@example.test>, "A, B\\"C" <second@example.test>, "A < B" <third@example.test>'), [
    { name: 'REA, Two', email: 'Approved@example.test' }, { name: 'A, B"C', email: 'second@example.test' }, { name: 'A < B', email: 'third@example.test' },
  ]);
  assert.deepEqual(parseOutgoingRecipientHeader('"Back\\\\Slash" <approved@example.test>'), [{ name: 'Back\\Slash', email: approved }]);
  assert.deepEqual(parseOutgoingRecipientHeader(escapedName), [{ name: 'O"Neil', email: approved }]);
  assert.deepEqual(parseOutgoingRecipientHeader('Dr. REA < approved@example.test >'), [{ name: 'Dr. REA', email: approved }]);
  assert.deepEqual(parseOutgoingRecipientHeader('<approved@example.test>'), [{ name: '', email: approved }]);
  assert.deepEqual(parseOutgoingRecipientHeader('"合成の名前" <approved@example.test>'), [{ name: '合成の名前', email: approved }]);
});

test('every malformed neighbor/encoded invalid fragment is rejected rather than recovered as a trailing mailbox', () => {
  for (const raw of rejected) {
    assert.throws(() => parseOutgoingRecipientHeader(raw), { status: 400, code: 'invalid_recipients' }, JSON.stringify(raw));
    assert.throws(() => parseOutgoingRecipientHeader(`${approved}, ${raw}`), { status: 400, code: 'invalid_recipients' }, JSON.stringify(raw));
    assert.throws(() => parseOutgoingRecipientHeader(`${raw}, second@example.test`), { status: 400, code: 'invalid_recipients' }, JSON.stringify(raw));
  }
});

test('all control characters and malformed Unicode fail even inside a quoted display name', () => {
  const controls = [...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)), ...Array.from({ length: 33 }, (_, i) => String.fromCharCode(127 + i)), '\u2028', '\u2029', '\u202e', '\u200b', '\ud800'];
  for (const char of controls) {
    assert.throws(() => parseOutgoingRecipientHeader(`"Bad${char}Name" <${approved}>`), { code: 'invalid_recipients' });
    assert.throws(() => parseOutgoingRecipientHeader(`approved${char}@example.test`), { code: 'invalid_recipients' });
  }
});

test('empty fields are allowed but empty lists, unsupported grammar and input bounds cannot become a delivery', () => {
  assert.deepEqual(parseOutgoingRecipientHeader('   '), []);
  assert.deepEqual(parseOutgoingRecipientHeaders({ to: '', cc: '', bcc: approved }).recipients, [{ name: '', email: approved }]);
  assert.throws(() => parseOutgoingRecipientHeaders({ to: '', cc: '', bcc: '' }), { code: 'invalid_recipients' });
  assert.throws(() => parseOutgoingRecipientHeader('a'.repeat(65_537)), { code: 'invalid_recipients' });
  assert.throws(() => parseOutgoingRecipientHeader(Array(201).fill(approved).join(',')), { code: 'invalid_recipients' });
  assert.throws(() => parseOutgoingRecipientHeader(`${'a'.repeat(65)}@example.test`), { code: 'invalid_recipients' });
  assert.equal(validOutgoingRecipientEmail('a..b@example.test'), false); assert.equal(validOutgoingRecipientEmail(`${'a'.repeat(64)}@example.test`), true); assert.equal(validOutgoingRecipientEmail('REA+tag@example.test'), true);
  assert.equal(validOutgoingRecipientEmail('a@' + `${'b'.repeat(63)}.`.repeat(3) + 'c'.repeat(61)), false);
});

test('allowlist validation uses every parsed To/Cc/Bcc address and never ignores a malformed field', () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, env); store.put('account', account.id, account);
  const draft = store.saveDraft({ accountId: account.id, to: escapedName, cc: '"A, B\\"C" <second@example.test>', bcc: 'third@example.test' });
  try {
    assert.doesNotThrow(() => provider.validateDelivery(draft));
    for (const field of ['to', 'cc', 'bcc'] as const) {
      assert.throws(() => provider.validateDelivery({ ...draft, [field]: `not-an-address, ${escapedName}` }), { code: 'invalid_recipients' });
      assert.throws(() => provider.validateDelivery({ ...draft, [field]: '"O\\"Neil" <unapproved@example.test>' }), { code: 'recipient_not_approved', status: 403 });
    }
  } finally { store.close(); }
});

test('MIME emits canonical complete recipient headers agreeing with validated mailboxes and never raw fragments', () => {
  const store = new Store(':memory:'); store.put('account', account.id, account); const provider = new GoogleProvider(store, env);
  try {
    const draft = store.saveDraft({ accountId: account.id, to: 'Dr. REA <approved@example.test>, "A, B\\"C" <second@example.test>', cc: '"Back\\\\Slash" <third@example.test>', bcc: '' });
    assert.doesNotThrow(() => provider.validateDelivery(draft));
    const raw = Buffer.from(provider.mime(draft).raw, 'base64url').toString('utf8');
    assert.equal(raw.split('\r\n').find(line => line.startsWith('To: ')), 'To: "Dr. REA" <approved@example.test>, "A, B\\"C" <second@example.test>');
    assert.equal(raw.split('\r\n').find(line => line.startsWith('Cc: ')), 'Cc: "Back\\\\Slash" <third@example.test>');
    assert.equal(raw.split('\r\n').filter(line => /^(To|Cc):/.test(line)).length, 2);
    assert.equal(/^Bcc:/m.test(raw), false);
    assert.equal(formatOutgoingRecipientHeader([{ name: 'A, B"C', email: approved }]), '"A, B\\"C" <approved@example.test>');
    for (const to of rejected) assert.throws(() => buildMime({ ...draft, to }, account, undefined), { code: 'invalid_recipients' });
  } finally { store.close(); }
});

test('send, scheduling, provider draft sync and attempt preparation reject invalid recipients without dispatch or draft loss', async () => {
  const app = createApp({ databasePath: ':memory:', env, runJobs: false }); app.store.put('account', account.id, account); let requests = 0;
  app.google.request = async () => { requests++; throw new Error('No provider request may occur'); };
  const post = (url: string, input: unknown) => new Promise<{ status: number; body: any }>(resolve => {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), { method: 'POST', url, headers: { host: '127.0.0.1:3001', 'content-type': 'application/json' } });
    const response = { status: 0, writeHead(status: number) { this.status = status; }, setHeader() {}, end(raw: string) { resolve({ status: this.status, body: JSON.parse(raw) }); } };
    app.server.emit('request', request, response);
  });
  try {
    const invalid = `not-an-address, ${escapedName}`; const draft = app.store.saveDraft({ accountId: account.id, to: invalid, body: 'Synthetic unsent body' });
    for (const [action, body] of [['send', {}], ['schedule', { scheduledAt: new Date(Date.now() + 60_000).toISOString() }], ['sync', {}]] as const) {
      const response = await post(`/api/drafts/${draft.id}/${action}`, body); assert.equal(response.status, 400); assert.equal(response.body.error.code, 'invalid_recipients');
      assert.equal(app.store.required<Draft>('draft', draft.id).to, invalid); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'draft');
    }
    assert.throws(() => app.store.beginDelivery(draft.id), { code: 'invalid_recipients' }); assert.equal(app.store.list('delivery').length, 0); assert.equal(requests, 0);
    const locked = app.store.saveDraft({ accountId: account.id, to: approved }); app.store.beginDelivery(locked.id); app.store.unknownDelivery(locked.id, 'Synthetic unknown');
    app.store.put('draft', locked.id, { ...app.store.required<Draft>('draft', locked.id), to: invalid });
    await assert.rejects(app.deliver(locked.id), { code: 'delivery_requires_reconciliation', status: 409 }); assert.equal(requests, 0);
  } finally { await app.close(); }
});

test('permissive imported-header parsing remains unchanged', () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, {});
  try {
    const value = provider.normalizeMessage({ id: 'synthetic-import', threadId: 'thread', snippet: '', internalDate: '1', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: '"Unclosed <imported@example.test>' }, { name: 'To', value: '"REA, Two" <approved@example.test>' }], body: { data: Buffer.from('Synthetic body').toString('base64url') } } });
    assert.deepEqual(value.sender, { name: 'Unclosed', email: 'imported@example.test' }); assert.deepEqual(value.to, [{ name: 'REA, Two', email: approved }]);
  } finally { store.close(); }
});
