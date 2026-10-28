// Independent Undo-controller checks. Requests/storage are synthetic; no browser or provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiDraftSend } from '../src/ai-draft-send.ts';
import { ApiError } from '../src/api.ts';
import type { AiDraftPreview, AiDraftRequest, AiDraftStorage } from '../src/ai-draft.ts';
import type { AiDraftSendSnapshot, AiDraftSendCancelResponse } from '../../api/src/ai-draft-send-types.ts';
const at = '2026-10-28T21:00:00Z', deadline = '2026-10-28T21:00:10Z';
const scope = { accountId: 'account-a', sessionId: 'session-a', turnId: 'turn-a' };
const preview = (): AiDraftPreview => ({ id: 'preview-a', ...scope, kind: 'draft-preview', createdAt: at, payloadHash: 'b'.repeat(64), sourceIds: [], payload: { to: [{ email: 'recipient@example.test' }], cc: [], bcc: [], subject: 'Synthetic Undo', body: 'Three fictional samples.' } });
function queued(): AiDraftSendSnapshot {
 const p = preview(), creation = { id: 'creation-a', ...scope, previewId: p.id, payloadHash: p.payloadHash, draftId: 'draft-a', generation: 0, createdAt: at };
 return { preview: p, creation, operation: { id: 'operation-a', ...scope, previewId: p.id, generation: 0, creationId: creation.id, draftId: creation.draftId, clientRequestId: 'send-original', payloadHash: p.payloadHash, state: 'queued', revision: 0, createdAt: at, startedAt: null, confirmedAt: null, deliveryAttemptId: null, providerMessageId: null, cancellableUntil: deadline, cancelledAt: null, error: null }, eligibility: { eligible: false, createGeneration: null, reason: 'send_claimed' }, serverNow: at, canCancel: true, latestGeneration: 0 };
}
function cancelled(key = 'undo-1'): AiDraftSendCancelResponse {
 const value = queued(); value.operation = { ...value.operation!, state: 'cancelled', revision: 1, cancelledAt: at, cancelledFromRevision: 0 }; value.canCancel = false;
 return { ...value, restoredResolution: { availability: 'available', draftId: 'draft-a' }, restoredDraft: { id: 'draft-a', accountId: scope.accountId, to: 'recipient@example.test', cc: '', bcc: '', subject: 'Human updated subject', body: 'Current user edit, distinct from immutable preview.', attachments: [], status: 'draft', updatedAt: at }, cancellation: { id: 'cancellation-a', operationId: 'operation-a', ...scope, clientRequestId: key, createdAt: at } };
}
function sent(): AiDraftSendSnapshot { const v = queued(); v.operation = { ...v.operation!, state: 'sent', revision: 2, startedAt: at, confirmedAt: at, deliveryAttemptId: 'attempt-a', providerMessageId: 'provider-a' }; v.canCancel = false; return v; }
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const drain = () => new Promise<void>(resolve => setImmediate(resolve));
function memory() { const values = new Map<string, string>(); const storage: AiDraftStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }; return { values, storage }; }
type Call = { path: string; method: string; body: any; signal?: AbortSignal };
function fixture(handler?: (call: Call) => unknown | Promise<unknown>, saved = memory(), options: { isCurrent?: () => boolean; sendRequestId?: string } = {}) {
 const calls: Call[] = []; let key = 0;
 const request: AiDraftRequest = async (path, body, method = 'GET', opts) => { const call = { path, method, body: structuredClone(body), signal: opts?.signal }; calls.push(call); const value = await handler?.(call); if (value !== undefined) return value; if (method === 'GET') return queued(); throw Error('Unexpected synthetic POST'); };
 const controller = createAiDraftSend({ preview: preview(), request, storage: saved.storage, uuid: () => 'undo-' + ++key, pollMs: 0, ...options });
 return { controller, calls, ...saved, ready: async () => { controller.resume(); await drain(); }, close: () => controller.dispose() };
}

test('Undo journals its exact operation/revision before one POST despite duplicate clicks', async () => {
 const ack = deferred<unknown>(), f = fixture(call => call.method === 'POST' ? ack.promise : undefined);
 try { await f.ready(); const one = f.controller.cancel(); void f.controller.cancel(); const posts = f.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1); assert.equal(f.values.size, 1);
  assert.ok(posts[0].path.endsWith('/send-actions/operation-a/cancel')); assert.deepEqual(posts[0].body, { ...scope, clientRequestId: 'undo-1', expectedRevision: 0 });
  const journal = JSON.parse([...f.values.values()][0]); assert.equal(journal.operationId, 'operation-a'); assert.equal(journal.draftId, 'draft-a'); assert.equal(journal.payloadHash, preview().payloadHash);
  ack.resolve(cancelled()); const result = await one; assert.equal(result?.operation?.state, 'cancelled'); assert.equal(f.values.size, 0); assert.equal(result?.restoredDraft?.body, 'Current user edit, distinct from immutable preview.');
  await f.controller.cancel(); await f.controller.send(); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
 } finally { f.close(); }
});

test('unknown Undo survives remount and by-key404; it never retries cancellation or sends again', async () => {
 const saved = memory(), handler = (call: Call) => { if (call.method === 'POST') throw new TypeError('Lost cancellation ACK'); if (call.path.includes('/send-cancellations/by-request/')) throw new ApiError('Not visible', 404, 'ai_draft_send_not_found'); };
 const first = fixture(handler, saved); try { await first.ready(); await first.controller.cancel(); assert.equal(first.controller.getSnapshot().cancelUnknown, true); first.close(); const next = fixture(handler, saved);
  try { await next.ready(); assert.ok(next.calls[0].path.includes('/send-cancellations/by-request/undo-1')); const q = new URL('http://synthetic.test' + next.calls[0].path).searchParams; assert.equal(q.get('operationId'), 'operation-a'); assert.equal(q.get('accountId'), scope.accountId);
   await next.controller.cancel(); await next.controller.send(); await next.controller.reconcile(); assert.equal(next.calls.some(c => c.method === 'POST'), false); assert.equal(next.controller.getSnapshot().cancelUnknown, true); assert.equal(saved.values.size, 1);
  } finally { next.close(); }
 } finally { first.close(); }
});

test('substituted receipt, generation, restored account and incomplete cancellation remain unknown without applying a draft', async () => {
 const mutations: ((v: AiDraftSendCancelResponse) => void)[] = [v => { v.cancellation.clientRequestId = 'wrong-key'; }, v => { v.cancellation.operationId = 'wrong-operation'; }, v => { v.cancellation.accountId = 'wrong-account'; }, v => { v.operation!.generation = 1; v.creation!.generation = 1; }, v => { v.restoredDraft!.id = 'another-draft'; }, v => { v.restoredDraft!.accountId = 'another-account'; }, v => { v.operation!.startedAt = at; }, v => { delete v.operation!.cancelledFromRevision; }, v => { delete (v as Partial<AiDraftSendCancelResponse>).cancellation; }];
 for (const mutate of mutations) { const f = fixture(call => { if (call.method === 'POST') { const value = cancelled(); mutate(value); return value; } }); try { await f.ready(); assert.equal(await f.controller.cancel(), null); assert.equal(f.controller.getSnapshot().cancelUnknown, true); assert.equal(f.controller.getSnapshot().response?.operation?.state, 'queued'); assert.equal(f.controller.getSnapshot().response?.restoredDraft, undefined); assert.equal(f.values.size, 1); } finally { f.close(); } }
});

test('late status reads cannot replace confirmed cancellation or restore an obsolete queued view', async () => {
 const late = deferred<unknown>(); let gets = 0; const f = fixture(call => call.method === 'POST' ? cancelled() : ++gets === 2 ? late.promise : undefined);
 try { await f.ready(); const stale = f.controller.load(); await f.controller.cancel(); late.resolve(queued()); await stale; assert.equal(f.controller.getSnapshot().response?.operation?.state, 'cancelled'); assert.equal(f.controller.getSnapshot().response?.restoredDraft?.subject, 'Human updated subject'); assert.equal(f.controller.getSnapshot().cancellation?.id, 'cancellation-a'); } finally { f.close(); }
});

test('mode/account loss aborts pending Undo; late acknowledgement cannot clear the durable key or expose restored content', async () => {
 let current = true; const ack = deferred<unknown>(), f = fixture(call => call.method === 'POST' ? ack.promise : undefined, memory(), { isCurrent: () => current });
 try { await f.ready(); const pending = f.controller.cancel(), post = f.calls.find(c => c.method === 'POST')!; current = false; f.controller.suspend(); assert.equal(post.signal?.aborted, true); ack.resolve(cancelled()); assert.equal(await pending, null); assert.equal(f.controller.getSnapshot().response?.restoredDraft, undefined); assert.equal(f.values.size, 1); } finally { f.close(); }
});

test('only server availability authorizes Undo; a client-clock guess cannot reopen a closed window', async () => {
 for (const variant of ['closed', 'inconsistent'] as const) { const f = fixture(() => { const value = queued(); value.canCancel = variant === 'inconsistent'; value.serverNow = deadline; return value; });
  try { await f.ready(); await f.controller.cancel(); assert.equal(f.calls.some(c => c.method === 'POST'), false); if (variant === 'inconsistent') { assert.equal(f.controller.getSnapshot().loaded, false); assert.match(f.controller.getSnapshot().error, /availability/); } } finally { f.close(); }
 }
});

test('unavailable or silently dropping cancellation storage prevents POST, and corrupt journals fail closed', async () => {
 for (const mode of ['throws', 'silently-drops', 'corrupt'] as const) { const saved = memory(); if (mode === 'corrupt') saved.values.set('reconstruction.ai-draft-cancel.v1:' + JSON.stringify([scope.accountId, scope.sessionId, scope.turnId, 'preview-a']), '{malformed'); else saved.storage.setItem = () => { if (mode === 'throws') throw Error('Synthetic storage outage'); };
  const f = fixture(undefined, saved); try { await f.ready(); await f.controller.cancel(); assert.equal(f.calls.some(c => c.method === 'POST'), false); assert.ok(f.controller.getSnapshot().error); if (mode === 'corrupt') assert.equal(f.controller.getSnapshot().cancelUnknown, true); } finally { f.close(); }
 }
});

test('a stale server refusal releases only the refused key and refreshes authoritative Sent without restoration', async () => {
 let reads = 0; const f = fixture(call => { if (call.method === 'POST') throw new ApiError('Window closed', 409, 'ai_draft_send_not_cancellable'); return ++reads === 1 ? queued() : sent(); });
 try { await f.ready(); assert.equal(await f.controller.cancel(), null); await drain(); assert.equal(f.values.size, 0); assert.equal(f.controller.getSnapshot().cancelUnknown, false); assert.equal(f.controller.getSnapshot().response?.operation?.state, 'sent'); assert.equal(f.controller.getSnapshot().response?.restoredDraft, undefined); await f.controller.send(); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1); } finally { f.close(); }
});

test('an older cancellation ACK cannot erase a newer tab journal or automatically resolve its distinct receipt', async () => {
 const saved = memory(), ack = deferred<unknown>(), f = fixture(call => call.method === 'POST' ? ack.promise : undefined, saved);
 try { await f.ready(); const pending = f.controller.cancel(), key = [...saved.values.keys()][0], later = JSON.parse(saved.values.get(key)!); later.request.clientRequestId = 'undo-another-tab'; saved.values.set(key, JSON.stringify(later)); ack.resolve(cancelled()); await pending;
  assert.equal(JSON.parse(saved.values.get(key)!).request.clientRequestId, 'undo-another-tab'); assert.equal(f.controller.getSnapshot().cancelUnknown, true); await f.controller.cancel(); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
 } finally { f.close(); }
});

test('cancelled state and deadline cannot be replaced by a later Send receipt for the same operation', async () => {
 for (const change of ['sent', 'deadline'] as const) { let reads = 0; const f = fixture(call => { if (call.method === 'POST') return cancelled(); if (++reads === 1) return queued(); const value = change === 'sent' ? sent() : cancelled(); if (change === 'deadline') value.operation!.cancellableUntil = '2026-10-28T21:01:00Z'; return value; });
  try { await f.ready(); await f.controller.cancel(); assert.equal(await f.controller.load(), null); assert.equal(f.controller.getSnapshot().response?.operation?.state, 'cancelled'); assert.equal(f.controller.getSnapshot().response?.operation?.cancellableUntil, deadline); assert.equal(f.controller.getSnapshot().response?.restoredDraft?.id, 'draft-a'); } finally { f.close(); }
 }
});

function cancelledMissing(): AiDraftSendSnapshot {
 const value = cancelled(); delete value.restoredDraft; value.restoredResolution = { availability: 'unavailable', draftId: null };
 value.eligibility = { eligible: true, createGeneration: 1, reason: 'eligible' }; return value;
}
function newerQueued(): AiDraftSendSnapshot {
 const value = queued(); value.latestGeneration = 1; value.creation = { ...value.creation!, id: 'creation-next', draftId: 'draft-next', generation: 1 };
 value.operation = { ...value.operation!, id: 'operation-next', generation: 1, creationId: 'creation-next', draftId: 'draft-next', clientRequestId: 'undo-1' };
 return value;
}

test('a fresh explicit Send after proven cancelled-target absence binds the new generation and permits a different operation ID', async () => {
 const f = fixture(call => call.method === 'POST' ? newerQueued() : cancelledMissing());
 try { await f.ready(); assert.equal(f.controller.getSnapshot().response?.operation?.state, 'cancelled'); const result = await f.controller.send();
  const post = f.calls.find(c => c.method === 'POST')!; assert.equal(post.body.expectedGeneration, 1); assert.equal(result?.operation?.id, 'operation-next'); assert.equal(result?.operation?.generation, 1);
  assert.equal(f.values.size, 0); assert.equal(f.controller.getSnapshot().unknown, false);
 } finally { f.close(); }
});

test('a current newer Create without a Send operation supersedes old cancellation without exposing another Send', async () => {
 let reads = 0; const f = fixture(() => { if (++reads === 1) return cancelledMissing(); const value = newerQueued(); value.operation = null; value.canCancel = false; value.eligibility = { eligible: false, createGeneration: null, reason: 'already_created' }; return value; });
 try { await f.ready(); const result = await f.controller.load(); assert.equal(result?.operation, null); assert.equal(result?.creation?.id, 'creation-next'); assert.equal(result?.creation?.generation, 1); await f.controller.send(); assert.equal(f.calls.some(c => c.method === 'POST'), false); } finally { f.close(); }
});

test('old historical cancellation and queued snapshots cannot downgrade a newer generation even with a larger revision', async () => {
 for (const oldState of ['cancelled', 'queued'] as const) { let reads = 0; const f = fixture(() => { if (++reads === 1) return newerQueued(); const value = oldState === 'cancelled' ? cancelled() : queued(); value.operation!.revision = 100; value.latestGeneration = 1; return value; });
  try { await f.ready(); await f.controller.load(); assert.equal(f.controller.getSnapshot().response?.operation?.id, 'operation-next'); assert.equal(f.controller.getSnapshot().response?.creation?.generation, 1); assert.equal(f.calls.some(c => c.method === 'POST'), false); } finally { f.close(); }
 }
});

test('changed operation identities require a strictly newer valid generation after cancellation; confirmed Sent never rearms', async () => {
 for (const mode of ['same-generation', 'after-sent'] as const) { let reads = 0; const f = fixture(() => { if (++reads === 1) return mode === 'after-sent' ? sent() : cancelledMissing(); const value = newerQueued(); if (mode === 'same-generation') { value.creation!.generation = 0; value.operation!.generation = 0; } return value; });
  try { await f.ready(); const before = f.controller.getSnapshot().response; assert.equal(await f.controller.load(), null); assert.equal(f.controller.getSnapshot().response?.operation?.id, before?.operation?.id); assert.equal(f.controller.getSnapshot().response?.operation?.state, before?.operation?.state); } finally { f.close(); }
 }
});

test('a generation transition cannot change immutable preview content or retain a restored draft from the previous generation', async () => {
 for (const mode of ['changed-preview', 'old-restored'] as const) { const f = fixture(call => { if (call.method !== 'POST') return cancelledMissing(); const value = newerQueued(); if (mode === 'changed-preview') value.preview.payload.body = 'Unreviewed replacement.'; else { value.restoredResolution = { availability: 'available', draftId: 'draft-a' }; value.restoredDraft = cancelled().restoredDraft; } return value; });
  try { await f.ready(); assert.equal(await f.controller.send(), null); assert.equal(f.controller.getSnapshot().unknown, true); assert.equal(f.controller.getSnapshot().response?.operation?.id, 'operation-a'); assert.equal(f.values.size, 1); } finally { f.close(); }
 }
});

test('a rejected same-generation identity swap cannot poison the trusted generation floor and prevent later recovery', async () => {
 let reads = 0; const f = fixture(() => { if (++reads === 2) { const invalid = cancelledMissing(); invalid.creation!.id = 'substituted-creation'; invalid.operation!.creationId = 'substituted-creation'; invalid.latestGeneration = 9; invalid.eligibility = { eligible: false, createGeneration: null, reason: 'historical_operation' }; return invalid; } return cancelledMissing(); });
 try { await f.ready(); assert.equal(f.controller.getSnapshot().loaded, true); assert.equal(await f.controller.load(), null); assert.equal(f.controller.getSnapshot().loaded, false);
  await f.controller.load(); assert.equal(f.controller.getSnapshot().loaded, true); assert.equal(f.controller.getSnapshot().response?.creation?.id, 'creation-a'); assert.equal(f.controller.getSnapshot().response?.eligibility.createGeneration, 1);
 } finally { f.close(); }
});

test('an immutable old-Send observer reads only its bound key and cannot consume a newer generation journal', async () => {
 const saved = memory(), storageKey = 'reconstruction.ai-draft-send.v1:' + JSON.stringify([scope.accountId, scope.sessionId, scope.turnId, 'preview-a']);
 const journal = JSON.stringify({ version: 1, previewId: 'preview-a', request: { ...scope, clientRequestId: 'send-new-generation', expectedPreviewHash: preview().payloadHash, expectedGeneration: 1 } }); saved.values.set(storageKey, journal);
 const f = fixture(() => { const value = cancelled(); value.latestGeneration = 1; return value; }, saved, { sendRequestId: 'send-original' });
 try { await f.ready(); assert.ok(f.calls[0].path.includes('/send-actions/by-request/send-original?')); assert.equal(f.calls.some(c => c.path.includes('send-new-generation')), false); assert.equal(f.controller.getSnapshot().response?.operation?.id, 'operation-a'); assert.equal(saved.values.get(storageKey), journal); await f.controller.send(); assert.equal(f.calls.some(c => c.method === 'POST'), false); } finally { f.close(); }
});

test('an old-Send observer cannot adopt a newer operation cancellation journal from the same preview', async () => {
 const saved = memory(), key = 'reconstruction.ai-draft-cancel.v1:' + JSON.stringify([scope.accountId, scope.sessionId, scope.turnId, 'preview-a']);
 const journal = JSON.stringify({ version: 1, previewId: 'preview-a', payloadHash: preview().payloadHash, operationId: 'operation-next', creationId: 'creation-next', draftId: 'draft-next', generation: 1, request: { ...scope, clientRequestId: 'cancel-next', expectedRevision: 0 } }); saved.values.set(key, journal);
 const f = fixture(() => { const value = cancelled(); value.latestGeneration = 1; return value; }, saved, { sendRequestId: 'send-original' });
 try { await f.ready(); assert.ok(f.calls[0].path.includes('/send-actions/by-request/send-original?')); assert.equal(f.calls.some(c => c.path.includes('cancel-next')), false); assert.equal(f.controller.getSnapshot().response?.operation?.id, 'operation-a'); assert.equal(saved.values.get(key), journal); } finally { f.close(); }
});

test('a deferred old-Send recovery never adopts storage replaced while its request is pending', async () => {
 const saved = memory(), key = 'reconstruction.ai-draft-send.v1:' + JSON.stringify([scope.accountId, scope.sessionId, scope.turnId, 'preview-a']);
 const original = { version: 1, previewId: 'preview-a', request: { ...scope, clientRequestId: 'send-original', expectedPreviewHash: preview().payloadHash, expectedGeneration: 0 } };
 saved.values.set(key, JSON.stringify(original)); const ack = deferred<unknown>(); let reads = 0;
 const f = fixture(call => { assert.equal(call.method, 'GET'); return ++reads === 1 ? ack.promise : queued(); }, saved, { sendRequestId: 'send-original' });
 try { await f.ready(); assert.equal(f.controller.getSnapshot().checking, true); assert.ok(f.calls[0].path.includes('/by-request/send-original?'));
  const newer = JSON.stringify({ ...original, request: { ...original.request, clientRequestId: 'newer-tab-send', expectedGeneration: 1 } }); saved.values.set(key, newer);
  ack.resolve(queued()); await drain(); assert.equal(f.controller.getSnapshot().unknown, false); assert.equal(f.controller.getSnapshot().response?.operation?.clientRequestId, 'send-original');
  await f.controller.recover(); await f.controller.load(); assert.equal(f.calls.every(c => c.method === 'GET' && c.path.includes('/by-request/send-original?')), true); assert.equal(saved.values.get(key), newer); assert.equal(f.controller.getSnapshot().unknown, false);
 } finally { f.close(); }
});

test('a deferred bound Undo recovery preserves replacement storage and never adopts its different key on later loads', async () => {
 const saved = memory(), key = 'reconstruction.ai-draft-cancel.v1:' + JSON.stringify([scope.accountId, scope.sessionId, scope.turnId, 'preview-a']);
 const pending = { version: 1, previewId: 'preview-a', payloadHash: preview().payloadHash, operationId: 'operation-a', creationId: 'creation-a', draftId: 'draft-a', generation: 0, request: { ...scope, clientRequestId: 'undo-a', expectedRevision: 0 } };
 saved.values.set(key, JSON.stringify(pending)); const ack = deferred<unknown>(); let recovered = false;
 const f = fixture(call => { assert.equal(call.method, 'GET'); if (call.path.includes('/send-cancellations/')) return ack.promise; return recovered ? cancelled('undo-a') : queued(); }, saved, { sendRequestId: 'send-original' });
 try { await f.ready(); assert.equal(f.controller.getSnapshot().cancelUnknown, true); const recovering = f.controller.recoverCancel(); assert.ok(f.calls.at(-1)!.path.includes('/send-cancellations/by-request/undo-a?'));
  const replacement = JSON.stringify({ ...pending, request: { ...pending.request, clientRequestId: 'undo-b' } }); saved.values.set(key, replacement); recovered = true; ack.resolve(cancelled('undo-a'));
  assert.equal((await recovering)?.operation?.state, 'cancelled'); assert.equal(f.controller.getSnapshot().cancelUnknown, false); assert.equal(f.controller.getSnapshot().cancellation?.clientRequestId, 'undo-a');
  await f.controller.recoverCancel(); await f.controller.recover(); await f.controller.load(); assert.equal(f.calls.some(c => c.path.includes('/by-request/undo-b?')), false); assert.equal(saved.values.get(key), replacement); assert.equal(f.controller.getSnapshot().cancelUnknown, false); assert.equal(f.controller.getSnapshot().cancellation?.clientRequestId, 'undo-a');
 } finally { f.close(); }
});
