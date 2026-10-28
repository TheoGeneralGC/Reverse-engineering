import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import { DraftSendService } from '../src/draft-send.ts';
import { GoogleProvider } from '../src/google.ts';
import { Store } from '../src/store.ts';
import type { Draft } from '../src/types.ts';

const env = { DATABASE_PATH: ':memory:', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', TOKEN_ENCRYPTION_KEY: '1'.repeat(64), APPROVED_TEST_SENDERS: 'sender@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test,copy@example.test,blind@example.test' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
function fixture(path = ':memory:', windowMs = 10000, seed = true) {
  let now = Date.parse('2026-10-28T20:00:00Z');
  const timers: { cb: () => void; at: number; cancelled: boolean }[] = [];
  const schedule = (cb: () => void, ms: number) => { const t = { cb, at: now + ms, cancelled: false }; timers.push(t); return { cancel: () => { t.cancelled = true; } }; };
  const app = createApp({ databasePath: path, env: { ...env, DATABASE_PATH: path }, runJobs: false, seed, undoWindowMs: windowMs, scheduler: { now: () => now, schedule } });
  const accountId = 'synthetic';
  app.store.put('account', accountId, { id: accountId, provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
  app.store.put('googleGrant', `mail:${accountId}`, { accountId, service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
  app.store.db.prepare('INSERT OR REPLACE INTO secrets VALUES(?,?)').run(accountId, 'synthetic-never-read-token');
  app.google.fetcher = (async () => { throw Error('No live provider traffic permitted'); }) as typeof fetch;
  let sends = 0;
  app.google.send = async () => { sends++; return { id: 'synthetic-ack' }; };
  app.google.acknowledgedDeliveryMetadata = async () => undefined;
  const draft = app.store.saveDraft({ accountId, to: '"Recipient, Test" <recipient@example.test>', cc: 'copy@example.test', bcc: 'blind@example.test', subject: 'Fictional composer', html: '<p>Three <strong>fictional</strong> samples.</p>' });
  const request = (key = 'send-once') => { const current = app.draftSend.current(accountId, draft.id); return { accountId, clientRequestId: key, expectedDraftRevision: current.draftRevision, expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation! }; };
  return { app, accountId, draft, request, sends: () => sends, timers, now: () => now, advance(ms: number) { now += ms; for (const t of timers) if (!t.cancelled && t.at <= now) { t.cancelled = true; t.cb(); } }, close: () => app.close() };
}
async function invoke(app: ReturnType<typeof createApp>, method: string, url: string, value?: unknown) {
  return new Promise<{ status: number; body: any }>(resolve => {
    const request = Object.assign(Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]), { method, url, headers: { host: '127.0.0.1:3001', 'content-type': 'application/json' } });
    const response = { setHeader() {}, status: 0, writeHead(status: number) { this.status = status; }, end(payload: string) { resolve({ status: this.status, body: JSON.parse(payload) }); } };
    app.server.emit('request', request, response);
  });
}

test('same composer draft, rich body, recipients, provider linkage and attachment bytes survive Undo', async () => {
  const f = fixture(); try {
    f.app.store.saveDraft({ id: f.draft.id, providerDraftId: 'synthetic-cloud-container', providerDraftSyncedAt: '2026-10-28T00:00:00Z' });
    const bytes = Buffer.from('Fictional UTF-8 attachment: café\n');
    f.app.store.addAttachment(f.draft.id, { name: 'fixture.txt', mimeType: 'text/plain', data: bytes.toString('base64') });
    const before = f.app.store.required<Draft>('draft', f.draft.id), recordsBefore = f.app.store.list('draft').length;
    const accepted = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!;
    assert.equal(f.app.store.list('draft').length, recordsBefore); assert.equal(accepted.draftId, before.id);
    assert.equal(f.app.store.required<Draft>('draft', before.id).status, 'send_queued');
    const running = f.app.draftSend.execute(accepted.id, f.app.deliverComposer); await Promise.resolve();
    const undone = f.app.draftSend.cancel(accepted.id, { accountId: f.accountId, clientRequestId: 'undo-once', expectedRevision: 0 });
    assert.equal(undone.operation?.state, 'cancelled'); assert.equal(undone.draft?.id, before.id);
    for (const key of ['accountId', 'to', 'cc', 'bcc', 'subject', 'body', 'html', 'providerDraftId', 'providerDraftSyncedAt', 'attachments'] as const) assert.deepEqual(undone.draft?.[key], before[key]);
    assert.equal(undone.draft!.revision, before.revision! + 1);
    assert.deepEqual(f.app.store.attachmentBytes(before.id, before.attachments![0].id), bytes);
    f.advance(20000); await running; assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
  } finally { await f.close(); }
});

test('HTTP accepted operation and lost-ACK reads remain historical after Undo, edits and a fresh same-ID intent', async () => {
  const f = fixture(); try {
    const raw = f.request(), accepted = await invoke(f.app, 'POST', `/api/drafts/${f.draft.id}/send-operations`, raw);
    assert.equal(accepted.status, 202); const op = accepted.body.operation;
    const cancelRaw = { accountId: f.accountId, clientRequestId: 'undo-key', expectedRevision: op.revision };
    const undo = await invoke(f.app, 'POST', `/api/draft-send-operations/${op.id}/cancel`, cancelRaw); assert.equal(undo.status, 200);
    f.app.store.saveDraft({ id: f.draft.id, body: 'A new human-authored revision' });
    const legacy = await invoke(f.app, 'POST', `/api/drafts/${f.draft.id}/send`, {}); assert.equal(legacy.body.error.code, 'send_intent_required');
    assert.throws(() => f.app.store.beginDelivery(f.draft.id), { code: 'send_intent_required' });
    await assert.rejects(() => GoogleProvider.prototype.send.call(f.app.google, f.app.store.required<Draft>('draft', f.draft.id)), { code: 'send_intent_required' });
    const schedule = await invoke(f.app, 'POST', `/api/drafts/${f.draft.id}/schedule`, { scheduledAt: '2099-01-01T00:00:00Z' }); assert.equal(schedule.body.error.code, 'send_intent_required');
    const next = f.app.draftSend.submit(f.draft.id, f.request('send-again')).snapshot.operation!; assert.equal(next.generation, 1); assert.equal(next.draftId, op.draftId);
    const query = new URLSearchParams({ accountId: f.accountId, draftId: f.draft.id });
    const old = await invoke(f.app, 'GET', `/api/draft-send-operations/by-request/send-once?${query}`); assert.equal(old.body.operation.id, op.id); assert.equal(old.body.operation.state, 'cancelled'); assert.equal(old.body.latestGeneration, 1); assert.equal(old.body.draft, undefined);
    const receiptQuery = new URLSearchParams({ accountId: f.accountId, operationId: op.id });
    const receipt = await invoke(f.app, 'GET', `/api/draft-send-cancellations/by-request/undo-key?${receiptQuery}`); assert.equal(receipt.body.cancellation.id, undo.body.cancellation.id); assert.equal(receipt.body.draft, undefined);
    const replay = f.app.draftSend.submit(f.draft.id, raw); assert.equal(replay.accepted, false); assert.equal(replay.snapshot.operation!.id, op.id);
    assert.equal((await invoke(f.app, 'POST', `/api/draft-send-operations/${op.id}/cancel`, cancelRaw)).body.operation.id, op.id);
    f.advance(10000); await f.app.draftSend.execute(next.id, f.app.deliverComposer); assert.equal(f.sends(), 1); assert.equal(f.app.draftSend.current(f.accountId, f.draft.id).operation?.state, 'sent');
  } finally { await f.close(); }
});

test('draft revision and content identity reject changed headers, provider link and attachment bytes before any claim', async () => {
  for (const drift of ['revision', 'recipient', 'provider', 'attachment'] as const) {
    const f = fixture(); try {
      const metadata = f.app.store.addAttachment(f.draft.id, { name: 'fixture.txt', mimeType: 'text/plain', data: Buffer.from('one').toString('base64') }).draft.attachments![0];
      const request = f.request();
      if (drift === 'revision') { f.app.store.saveDraft({ id: f.draft.id, body: 'Changed' }); assert.throws(() => f.app.draftSend.submit(f.draft.id, request), { code: 'draft_send_conflict' }); continue; }
      const op = f.app.draftSend.submit(f.draft.id, request).snapshot.operation!;
      if (drift === 'recipient') f.app.store.db.prepare("UPDATE records SET data=json_set(data,'$.to','other@example.test') WHERE kind='draft' AND id=?").run(f.draft.id);
      if (drift === 'provider') f.app.store.db.prepare("UPDATE records SET data=json_set(data,'$.providerDraftId','unreviewed-container') WHERE kind='draft' AND id=?").run(f.draft.id);
      if (drift === 'attachment') f.app.store.db.prepare('UPDATE draft_attachments SET data=? WHERE id=?').run(Buffer.from('two'), metadata.id);
      f.advance(10000); await f.app.draftSend.execute(op.id, f.app.deliverComposer);
      assert.equal(f.app.draftSend.current(f.accountId, f.draft.id).operation?.state, 'not_dispatched'); assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
    } finally { await f.close(); }
  }
});

test('queued composer is locked through generic mutation, native cloud sync and direct native send', async () => {
  const f = fixture(); try {
    f.app.draftSend.submit(f.draft.id, f.request()); const pending = f.app.store.required<Draft>('draft', f.draft.id);
    for (const change of [() => f.app.store.saveDraft({ id: pending.id, body: 'Changed' }), () => f.app.store.put('draft', pending.id, { ...pending, status: 'draft' }), () => f.app.store.remove('draft', pending.id), () => f.app.store.deleteDraft(pending.id), () => f.app.store.addAttachment(pending.id, { name: 'x', mimeType: 'text/plain', data: 'eA==' })]) assert.throws(change);
    await assert.rejects(() => f.app.google.syncDraft(pending), { code: 'composer_delivery_locked' });
    await assert.rejects(() => GoogleProvider.prototype.send.call(f.app.google, pending), { code: 'composer_delivery_locked' });
    await assert.rejects(() => f.app.deliver(pending.id), { code: 'composer_delivery_locked' });
    assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});

test('deadline claim and cancellation are exclusive while the shared account queue is held', async () => {
  const f = fixture(), held = deferred<void>(), entered = deferred<void>();
  f.app.google.sync = async () => { entered.resolve(); await held.promise; return { imported: 0, pages: 0, partial: false, phase: 'history', resultSizeEstimate: 0, scope: 'synthetic' }; };
  try {
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!, sync = f.app.requestSync(f.accountId); await entered.promise;
    const running = f.app.draftSend.execute(op.id, f.app.deliverComposer); await Promise.resolve(); f.advance(9999);
    assert.equal(f.app.draftSend.cancel(op.id, { accountId: f.accountId, clientRequestId: 'undo', expectedRevision: 0 }).operation?.state, 'cancelled');
    held.resolve(); await sync; f.advance(1); await running; assert.equal(f.sends(), 0);
    const next = f.app.draftSend.submit(f.draft.id, f.request('next')).snapshot.operation!; f.advance(10000);
    assert.throws(() => f.app.draftSend.cancel(next.id, { accountId: f.accountId, clientRequestId: 'late-undo', expectedRevision: 0 }), { code: 'draft_send_not_cancellable' });
    await f.app.draftSend.execute(next.id, f.app.deliverComposer); assert.equal(f.sends(), 1);
  } finally { held.resolve(); await f.close(); }
});

test('ambiguous outcome stays locked and reconciles through the same delivery marker without resending', async () => {
  const f = fixture(':memory:', 0); let calls = 0;
  f.app.google.send = async () => { calls++; throw Error('Transport outcome is ambiguous'); };
  try {
    const request = f.request(), op = f.app.draftSend.submit(f.draft.id, request).snapshot.operation!;
    await f.app.draftSend.execute(op.id, f.app.deliverComposer); assert.equal(calls, 1); assert.equal(f.app.draftSend.current(f.accountId, f.draft.id).operation?.state, 'outcome_unknown');
    assert.equal(f.app.draftSend.submit(f.draft.id, request).accepted, false); await f.app.draftSend.execute(op.id, f.app.deliverComposer); assert.equal(calls, 1);
    f.app.google.reconcileDelivery = async () => ({ found: true, matches: 1, scanComplete: true, scannedCandidates: 1, reason: 'verified', providerMessageId: 'verified-synthetic' });
    const response = await invoke(f.app, 'POST', `/api/draft-send-operations/${op.id}/reconcile`, { accountId: f.accountId }); assert.equal(response.status, 200); assert.equal(response.body.operation.state, 'sent'); assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('second live SQLite owner cannot steal or downgrade a claimed composer attempt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'composer-owner-')), path = join(directory, 'synthetic.sqlite'), f = fixture(path, 0), entered = deferred<void>(), ack = deferred<{ id: string }>();
  let calls = 0; f.app.google.send = async () => { calls++; entered.resolve(); return ack.promise; };
  try {
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!, running = f.app.draftSend.execute(op.id, f.app.deliverComposer); await entered.promise;
    const second = createApp({ databasePath: path, env: { ...env, DATABASE_PATH: path }, runJobs: false, undoWindowMs: 0 });
    try {
      assert.equal(second.store.required<Draft>('draft', f.draft.id).status, 'sending'); assert.equal(second.draftSend.current(f.accountId, f.draft.id).operation?.state, 'sending');
      await second.draftSend.execute(op.id, async () => { throw Error('Foreign owner cannot dispatch'); });
      ack.resolve({ id: 'one-ack' }); await running; assert.equal(calls, 1); assert.equal(second.draftSend.current(f.accountId, f.draft.id).operation?.state, 'sent');
    } finally { await second.close(); }
  } finally { ack.resolve({ id: 'one-ack' }); await f.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('shutdown cancels pending wait without dispatch; dead-owner recovery never enqueues or restores', async () => {
  const f = fixture(); try {
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!, running = f.app.draftSend.execute(op.id, f.app.deliverComposer); await Promise.resolve();
    await f.app.draftSend.close(); f.advance(20000); await running;
    const replacement = new DraftSendService(f.app.store, f.app.google, f.now, () => false, { windowMs: 0 });
    try { assert.equal(replacement.current(f.accountId, f.draft.id).operation?.state, 'not_dispatched'); await replacement.execute(op.id, f.app.deliverComposer); assert.equal(f.sends(), 0); assert.equal(f.app.store.required<Draft>('draft', f.draft.id).status, 'send_queued'); } finally { await replacement.close(); }
  } finally { await f.close(); }
});

test('accepted reply parent stays immutable while new inbox messages arrive before claim and ACK', async () => {
  const f = fixture(':memory:', 0); try {
    const first = { id: 'first', sender: { name: 'Sender', email: 'recipient@example.test' }, to: [{ name: 'Me', email: 'sender@example.test' }], date: '2026-10-28T00:00:00Z', text: 'Fictional context', attachments: [], internetMessageId: '<first@example.test>', references: '<parent@example.test>' };
    const thread = { id: 'synthetic-reply', accountId: f.accountId, providerId: 'provider-thread', subject: 'Fictional reply', snippet: '', sender: first.sender, participants: [first.sender], lastMessageAt: first.date, unread: false, starred: false, important: false, folder: 'inbox', labels: [], messages: [first] };
    f.app.store.put('thread', thread.id, thread); f.app.store.saveDraft({ id: f.draft.id, threadId: thread.id });
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!;
    const second = { ...first, id: 'new-arrival', internetMessageId: '<new-arrival@example.test>' };
    f.app.store.put('thread', thread.id, { ...thread, providerId: 'changed-provider-thread', messages: [first, second] });
    f.app.google.send = async draft => {
      const mime = f.app.google.mime(draft), wire = Buffer.from(mime.raw, 'base64url').toString();
      assert.equal(mime.threadId, 'provider-thread'); assert.match(wire, /In-Reply-To: <first@example.test>/); assert.doesNotMatch(wire, /In-Reply-To: <new-arrival@example.test>/);
      f.app.store.put('thread', thread.id, { ...thread, messages: [second] });
      return { id: 'reply-ack' };
    };
    await f.app.draftSend.execute(op.id, f.app.deliverComposer);
    assert.equal(f.app.draftSend.current(f.accountId, f.draft.id).operation?.state, 'sent');
    assert.equal(f.app.store.required<Draft>('draft', f.draft.id).providerMessageId, 'reply-ack');
  } finally { await f.close(); }
});

test('application shutdown stops composer timers before awaiting unrelated AI shutdown work', async () => {
  const f = fixture(), held = deferred<void>(); let closing: Promise<void> | undefined;
  try {
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!;
    const running = f.app.draftSend.execute(op.id, f.app.deliverComposer); await Promise.resolve();
    const originalClose = f.app.aiChat.close.bind(f.app.aiChat);
    f.app.aiChat.close = async () => { await held.promise; await originalClose(); };
    closing = f.app.close();
    assert.equal(f.app.draftSend.current(f.accountId, f.draft.id).operation?.state, 'not_dispatched');
    f.advance(20000); await running; assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
  } finally { held.resolve(); await (closing ?? f.close()); }
});

test('transferred cancelled target fails closed instead of aliasing its previous account generation', async () => {
  const f = fixture(); try {
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!;
    f.app.draftSend.cancel(op.id, { accountId: f.accountId, clientRequestId: 'undo-transfer', expectedRevision: 0 });
    const otherId = 'other'; f.app.store.put('account', otherId, { id: otherId, provider: 'google', email: 'sender@example.test', name: 'Other', color: '#000000' });
    f.app.store.put('googleGrant', `mail:${otherId}`, { accountId: otherId, service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] }); f.app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run(otherId, 'synthetic-token');
    f.app.store.saveDraft({ id: f.draft.id, accountId: otherId });
    assert.equal(f.app.draftSend.current(otherId, f.draft.id).eligibility.eligible, false);
    assert.equal(f.app.draftSend.current(otherId, f.draft.id).eligibility.reason, 'draft_send_scope_changed');
    const old = f.app.draftSend.byRequest(f.accountId, f.draft.id, 'send-once'); assert.equal(old.draft, undefined); assert.equal(old.resolution.availability, 'unavailable');
    assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});


test('malformed prototype schema rolls back initialization without leaving a write transaction or changing mail', () => {
  const store = new Store(':memory:', false);
  try {
    store.put('account', 'synthetic', { id: 'synthetic', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
    store.put('draft', 'owned', { id: 'owned', accountId: 'synthetic', to: 'recipient@example.test', cc: '', bcc: '', subject: 'Fictional existing draft', body: 'Do not change', status: 'draft', updatedAt: '' });
    const before = store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id='owned'").get()!.data;
    store.db.exec('CREATE TABLE draft_send_operations(id TEXT PRIMARY KEY)');
    assert.throws(() => new DraftSendService(store, new GoogleProvider(store, { ...env })), /no such column/);
    assert.equal(store.db.isTransaction, false);
    assert.equal(store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id='owned'").get()!.data, before);
    assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='draft_send_cancellations'").get(), undefined);
  } finally { store.close(); }
});


test('central claim rejects invented or mixed delivery-source contexts without creating an attempt', async () => {
  const f = fixture(':memory:', 0); try {
    assert.throws(() => f.app.store.beginDelivery(f.draft.id, { composerOperationId: 'invented' }), { code: 'delivery_identity_conflict' });
    const op = f.app.draftSend.submit(f.draft.id, f.request()).snapshot.operation!;
    assert.throws(() => f.app.store.beginDelivery(f.draft.id, { composerOperationId: op.id, artifactOperationId: 'invented' }), { code: 'delivery_identity_conflict' });
    assert.equal(f.app.store.list('delivery').length, 0);
    await f.app.draftSend.execute(op.id, f.app.deliverComposer); assert.equal(f.sends(), 1);
  } finally { await f.close(); }
});
