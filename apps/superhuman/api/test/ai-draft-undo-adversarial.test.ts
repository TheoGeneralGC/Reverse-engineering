// Independent cancellation faults and race checks; explicit memory DBs and mocked providers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import { AiDraftSendService } from '../src/ai-draft-send.ts';
import { citationAnswer } from '../src/ai-citations.ts';
import type { Draft } from '../src/types.ts';

async function fixture() {
  let now = Date.parse('2026-10-28T21:00:00Z'), sends = 0;
  const timers: { callback: () => void; at: number; cancelled: boolean }[] = [];
  const schedule = (callback: () => void, ms: number) => {
    const timer = { callback, at: now + ms, cancelled: false }; timers.push(timer);
    return { cancel: () => { timer.cancelled = true; } };
  };
  const env = { DATABASE_PATH: ':memory:', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', TOKEN_ENCRYPTION_KEY: '2'.repeat(64), APPROVED_TEST_SENDERS: 'sender@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test' };
  const app = createApp({ databasePath: ':memory:', env, runJobs: false, undoWindowMs: 10000, scheduler: { now: () => now, schedule } });
  app.store.put('account', 'synthetic', { id: 'synthetic', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000' });
  app.store.put('googleGrant', 'mail:synthetic', { accountId: 'synthetic', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
  app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('synthetic', 'not-a-real-token');
  app.google.fetcher = (async () => { throw Error('External requests forbidden'); }) as typeof fetch;
  app.google.send = async () => { sends++; return { id: 'mock-accepted' }; };
  app.google.acknowledgedDeliveryMetadata = async () => undefined;
  function seed(key = 'initial') {
    const session = app.aiChat.createSession('synthetic');
    const turn = app.aiChat.repository.accept(session.id, { accountId: 'synthetic', clientRequestId: 'seed-' + key, expectedRevision: 0, prompt: 'Fictional only.', context: { resources: [] } }, 'synthetic').turn;
    app.aiChat.repository.update(turn.id, value => { value.state = 'running'; });
    const preview = app.aiChat.drafts.propose(turn.id, { to: [{ email: 'recipient@example.test' }], subject: 'Synthetic ' + key, body: 'Fictional controlled text.' });
    app.aiChat.repository.update(turn.id, value => { value.state = 'completed'; value.answer = citationAnswer('Ready.', [], false); value.previews = [preview]; }, [], false, value => app.aiChat.drafts.commitPreview(value, preview));
    const scope = { accountId: 'synthetic', sessionId: session.id, turnId: turn.id };
    const request = { ...scope, clientRequestId: 'send-' + key, expectedPreviewHash: preview.payloadHash, expectedGeneration: 0 };
    return { preview, scope, request };
  }
  const first = seed(), operation = app.aiSend.submit(first.preview.id, first.request).snapshot.operation!;
  const rawDraft = () => String(app.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(operation.draftId)!.data);
  return { app, ...first, operation, seed, rawDraft, sends: () => sends,
    cancel: (key = 'cancel-initial', revision = operation.revision) => app.aiSend.cancel(operation.id, { ...first.scope, clientRequestId: key, expectedRevision: revision }),
    advance: (ms: number) => { now += ms; for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.callback(); } },
    now: () => now, schedule, close: () => app.close() };
}

test('cancellation-receipt failure rolls back the operation and draft; a later explicit retry commits once', async () => {
  const f = await fixture(); try {
    const before = f.rawDraft();
    f.app.store.db.exec("CREATE TRIGGER fail_cancel_receipt BEFORE INSERT ON ai_draft_send_cancellations BEGIN SELECT RAISE(ABORT,'synthetic receipt fault'); END");
    assert.throws(() => f.cancel(), /synthetic receipt fault/);
    assert.equal(f.rawDraft(), before); assert.equal(f.app.aiSend.get(f.scope, f.preview.id).operation?.state, 'queued');
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_send_cancellations').get()!.n, 0);
    f.app.store.db.exec('DROP TRIGGER fail_cancel_receipt'); const result = f.cancel();
    assert.equal(result.operation?.state, 'cancelled'); assert.equal(result.restoredDraft?.id, f.operation.draftId);
    assert.equal(f.cancel().cancellation.id, result.cancellation.id); assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
  } finally { await f.close(); }
});

test('cancel identity is immutable across revisions and scopes, while distinct valid keys converge without restoring edits again', async () => {
  const f = await fixture(); try {
    assert.throws(() => f.cancel('stale', 12), { code: 'ai_draft_send_conflict' });
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_send_cancellations').get()!.n, 0);
    const first = f.cancel(); f.app.store.saveDraft({ id: f.operation.draftId, subject: 'Human subject', body: 'Human edit after Undo.' }); const before = f.rawDraft();
    assert.throws(() => f.cancel('cancel-initial', first.operation!.revision), { code: 'ai_draft_send_conflict' });
    const second = f.cancel('independent-tab', first.operation!.revision);
    assert.equal(second.operation?.revision, first.operation?.revision); assert.notEqual(second.cancellation.id, first.cancellation.id);
    assert.equal(f.rawDraft(), before); assert.equal(second.restoredDraft?.body, 'Human edit after Undo.');
    assert.throws(() => f.app.aiSend.byCancelRequest({ ...f.scope, sessionId: 'wrong-session' }, f.operation.id, 'cancel-initial'), { status: 404 });
    assert.equal(f.app.aiSend.byCancelRequest(f.scope, f.operation.id, 'cancel-initial').cancellation.id, first.cancellation.id);
    assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});

test('an account-wide action key cannot be repurposed across Undo, Send, Create or another operation', async () => {
  const f = await fixture(); try {
    assert.throws(() => f.cancel(f.request.clientRequestId), { code: 'ai_draft_send_conflict' });
    f.cancel('one-undo-key'); const other = f.seed('other'); const otherOp = f.app.aiSend.submit(other.preview.id, other.request).snapshot.operation!;
    assert.throws(() => f.app.aiSend.cancel(otherOp.id, { ...other.scope, clientRequestId: 'one-undo-key', expectedRevision: 0 }), { code: 'ai_draft_send_conflict' });
    const third = f.seed('third');
    assert.throws(() => f.app.aiSend.submit(third.preview.id, { ...third.request, clientRequestId: 'one-undo-key' }), { code: 'ai_draft_send_conflict' });
    assert.throws(() => f.app.aiChat.drafts.create(third.preview.id, { ...third.request, clientRequestId: 'one-undo-key' }), { status: 409 });
    assert.equal(f.app.aiSend.get(other.scope, other.preview.id).operation?.state, 'queued');
    assert.equal(f.app.aiChat.drafts.get(third.scope, third.preview.id).creation, null); assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});

test('a malformed durable deadline grants neither cancellation nor a delivery attempt', async () => {
  const f = await fixture(); try {
    f.app.store.db.prepare("UPDATE ai_draft_sends SET data=json_set(data,'$.cancellableUntil','not-an-instant') WHERE id=?").run(f.operation.id);
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).canCancel, false);
    assert.throws(() => f.cancel(), { code: 'ai_draft_send_not_cancellable' });
    await f.app.aiSend.execute(f.operation.id, f.app.deliver);
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).operation?.state, 'not_dispatched');
    assert.equal(f.app.store.list('delivery').length, 0); assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});

test('corrupted queued status cannot be restored over a claimed or already sent draft', async () => {
  for (const status of ['sending', 'delivery_unknown', 'sent']) {
    const f = await fixture(); try {
      f.app.store.db.prepare("UPDATE records SET data=json_set(data,'$.status',?) WHERE kind='draft' AND id=?").run(status, f.operation.draftId); const before = f.rawDraft();
      assert.throws(() => f.cancel(), { code: 'ai_draft_send_not_cancellable' });
      assert.equal(f.rawDraft(), before); assert.equal(f.app.aiSend.get(f.scope, f.preview.id).operation?.state, 'queued');
      assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_send_cancellations').get()!.n, 0); assert.equal(f.sends(), 0);
    } finally { await f.close(); }
  }
});

test('deadline closure remains authoritative while account dispatch is queued; late Undo cannot compensate for a send', async () => {
  const f = await fixture(); let release!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const running = f.app.aiSend.execute(f.operation.id, async (id, operation) => { entered(); await blocked; return f.app.deliver(id, operation); });
    await Promise.resolve(); f.advance(10000); await started;
    assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
    assert.throws(() => f.cancel(), { code: 'ai_draft_send_not_cancellable' });
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).canCancel, false);
    release(); await running; assert.equal(f.sends(), 1); assert.equal(f.app.store.list('delivery').length, 1);
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).operation?.state, 'sent');
  } finally { release?.(); await f.close(); }
});

test('cancelled tombstones survive dead-owner recovery without recreating or rewriting the restored draft', async () => {
  const f = await fixture(); let replacement: AiDraftSendService | undefined;
  try {
    const result = f.cancel(); f.app.store.saveDraft({ id: f.operation.draftId, body: 'Preserved after owner replacement.' }); const before = f.rawDraft();
    replacement = new AiDraftSendService(f.app.store, f.app.aiChat.drafts, f.app.google, f.now, () => false, { windowMs: 10000, schedule: f.schedule });
    assert.equal(replacement.get(f.scope, f.preview.id).operation?.state, 'cancelled');
    assert.equal(replacement.byCancelRequest(f.scope, f.operation.id, 'cancel-initial').cancellation.id, result.cancellation.id);
    assert.equal(replacement.submit(f.preview.id, f.request).accepted, false);
    await replacement.execute(f.operation.id, f.app.deliver); f.advance(20000);
    assert.equal(f.rawDraft(), before); assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
  } finally { await replacement?.close(); await f.close(); }
});

test('cancel recovery never reveals a restored draft that has moved to another account', async () => {
  const f = await fixture(); try {
    f.cancel(); f.app.store.db.prepare("UPDATE records SET data=json_set(data,'$.accountId','demo','$.body','foreign-only-marker') WHERE kind='draft' AND id=?").run(f.operation.draftId);
    for (const snapshot of [f.app.aiSend.get(f.scope, f.preview.id), f.app.aiSend.byCancelRequest(f.scope, f.operation.id, 'cancel-initial'), f.cancel()]) {
      assert.equal(snapshot.operation?.state, 'cancelled'); assert.equal(snapshot.restoredResolution?.availability, 'unavailable');
      assert.equal(snapshot.restoredDraft, undefined); assert.equal(JSON.stringify(snapshot).includes('foreign-only-marker'), false);
    }
    assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});

test('after cancelled-target removal only a fresh explicit generation can send; old Send and Undo keys remain historical', async () => {
  const f = await fixture(); try {
    const undone = f.cancel(); f.app.store.remove('draft', f.operation.draftId);
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).eligibility.createGeneration, 1);
    const nextRequest = { ...f.request, clientRequestId: 'send-next-generation', expectedGeneration: 1 };
    const next = f.app.aiSend.submit(f.preview.id, nextRequest); assert.equal(next.accepted, true);
    assert.equal(next.snapshot.operation?.generation, 1); assert.notEqual(next.snapshot.operation?.id, f.operation.id); assert.notEqual(next.snapshot.operation?.draftId, f.operation.draftId);
    const historicalSend = f.app.aiSend.byRequest(f.scope, f.preview.id, f.request.clientRequestId);
    const historicalUndo = f.app.aiSend.byCancelRequest(f.scope, f.operation.id, 'cancel-initial');
    assert.equal(historicalSend.operation?.id, f.operation.id); assert.equal(historicalSend.operation?.state, 'cancelled'); assert.equal(historicalSend.creation?.generation, 0);
    assert.equal(historicalUndo.cancellation.id, undone.cancellation.id); assert.equal(historicalUndo.operation?.id, f.operation.id); assert.equal(historicalUndo.restoredResolution?.availability, 'unavailable');
    assert.equal(f.app.aiSend.submit(f.preview.id, f.request).accepted, false); await f.app.aiSend.execute(f.operation.id, f.app.deliver); assert.equal(f.sends(), 0);
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).operation?.id, next.snapshot.operation?.id);
    assert.equal(f.app.aiSend.get(f.scope, f.preview.id).latestGeneration, 1);
    assert.equal(historicalSend.latestGeneration, 1); assert.equal(historicalSend.eligibility.eligible, false); assert.equal(historicalSend.eligibility.createGeneration, null);
    assert.equal(historicalUndo.latestGeneration, 1); assert.equal(historicalUndo.eligibility.eligible, false);
    f.advance(10000); await f.app.aiSend.execute(next.snapshot.operation!.id, f.app.deliver); assert.equal(f.sends(), 1);
    assert.equal(f.app.aiSend.byRequest(f.scope, f.preview.id, f.request.clientRequestId).operation?.state, 'cancelled');
  } finally { await f.close(); }
});

test('fresh Create after cancelled-target removal excludes Send and old keys cannot overwrite the new human draft', async () => {
  const f = await fixture(); try {
    f.cancel(); f.app.store.remove('draft', f.operation.draftId);
    const created = f.app.aiChat.drafts.create(f.preview.id, { ...f.request, clientRequestId: 'create-next-generation', expectedGeneration: 1 });
    assert.equal(created.result.creation?.generation, 1); const id = created.result.creation!.draftId;
    f.app.store.saveDraft({ id, body: 'Human changes in the new generation.' });
    const current = f.app.aiSend.get(f.scope, f.preview.id); assert.equal(current.operation, null); assert.equal(current.creation?.draftId, id); assert.equal(current.latestGeneration, 1);
    assert.throws(() => f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'competing-send', expectedGeneration: 1 }), { status: 409 });
    const historical = f.app.aiSend.submit(f.preview.id, f.request); assert.equal(historical.accepted, false); assert.equal(historical.snapshot.operation?.draftId, f.operation.draftId);
    f.cancel(); assert.equal(f.app.store.required<Draft>('draft', id).body, 'Human changes in the new generation.'); assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});

test('existing or moved cancelled targets do not authorize a replacement generation', async () => {
  for (const moved of [false, true]) {
    const f = await fixture(); try {
      f.cancel(); if (moved) f.app.store.db.prepare("UPDATE records SET data=json_set(data,'$.accountId','demo') WHERE kind='draft' AND id=?").run(f.operation.draftId);
      const status = f.app.aiSend.get(f.scope, f.preview.id); assert.equal(status.eligibility.eligible, false); assert.equal(status.eligibility.createGeneration, null);
      assert.throws(() => f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'wrong-replacement', expectedGeneration: 1 }), { status: 409 });
      assert.throws(() => f.app.aiChat.drafts.create(f.preview.id, { ...f.request, clientRequestId: 'wrong-create', expectedGeneration: 1 }), { status: 409 });
      assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_sends').get()!.n, 1); assert.equal(f.sends(), 0);
    } finally { await f.close(); }
  }
});

test('missing targets in every non-cancelled Send state never authorize a new action generation', async () => {
  for (const state of ['queued', 'sending', 'sent', 'outcome_unknown', 'not_dispatched']) {
    const f = await fixture(); try {
      f.app.store.db.prepare("UPDATE ai_draft_sends SET state=?,data=json_set(data,'$.state',?) WHERE id=?").run(state, state, f.operation.id);
      f.app.store.db.prepare("DELETE FROM records WHERE kind='draft' AND id=?").run(f.operation.draftId);
      const status = f.app.aiSend.get(f.scope, f.preview.id); assert.equal(status.eligibility.eligible, false, state); assert.equal(status.eligibility.createGeneration, null, state);
      assert.throws(() => f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'cannot-retry', expectedGeneration: 1 }), { status: 409 });
      assert.throws(() => f.app.aiChat.drafts.create(f.preview.id, { ...f.request, clientRequestId: 'cannot-create', expectedGeneration: 1 }), { status: 409 });
      assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_sends').get()!.n, 1); assert.equal(f.sends(), 0);
    } finally { await f.close(); }
  }
});

test('stale generation keys and failed replacement-ledger writes cannot create an orphan or rearm an old action', async () => {
  const f = await fixture(); try {
    f.cancel(); f.app.store.remove('draft', f.operation.draftId); const before = f.app.store.list<Draft>('draft').map(d => d.id).sort();
    assert.throws(() => f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'stale-new-key', expectedGeneration: 0 }), { status: 409 });
    f.app.store.db.exec("CREATE TRIGGER fail_next_send BEFORE INSERT ON ai_draft_sends BEGIN SELECT RAISE(ABORT,'replacement fault'); END");
    assert.throws(() => f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'next-key', expectedGeneration: 1 }), /replacement fault/);
    assert.deepEqual(f.app.store.list<Draft>('draft').map(d => d.id).sort(), before); assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_creations').get()!.n, 1);
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_sends').get()!.n, 1);
    f.app.store.db.exec('DROP TRIGGER fail_next_send'); const next = f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'next-key', expectedGeneration: 1 });
    assert.equal(next.snapshot.operation?.generation, 1); assert.equal(f.sends(), 0);
    assert.throws(() => f.app.aiSend.submit(f.preview.id, { ...f.request, clientRequestId: 'other-next-key', expectedGeneration: 1 }), { status: 409 });
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM ai_draft_sends').get()!.n, 2);
  } finally { await f.close(); }
});
