import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailFetch } from '../src/mail-fetch.ts';
import { api, ApiError } from '../src/api.ts';
import { createHash } from 'node:crypto';

const id = 'fictional-receipt-01', origin = 'https://mail.example.test', downloadOrigin = 'https://synthetic.private.blob.vercel-storage.com';
const json = (value: unknown, status = 200, state?: string) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'x-rea-transport-id': id, ...(state ? { 'x-rea-transport-state': state } : {}) } });
const pending = () => json({ error: { code: 'worker_request_pending', message: 'Existing request pending' }, commandId: id }, 504, 'pending');

test('a timed-out native mutation waits for its existing read-only receipt without replaying POST', async () => {
  const calls: { path: string; method: string; body: BodyInit | null | undefined }[] = [];
  const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, fetch: async (path, init) => {
    calls.push({ path: String(path), method: init?.method ?? 'GET', body: init?.body });
    if (calls.length === 1) return pending();
    assert.equal(path, `/api/_rea/transport/results/${id}`); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    return calls.length === 2 ? json({ commandId: id, state: 'pending' }, 202, 'pending') : json({ text: 'Fictional completed Cedar rewrite' }, 200, 'completed');
  } });
  const response = await request('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mode":"write","prompt":"Fictional Cedar"}' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'Fictional completed Cedar rewrite' });
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET']);
});

test('ApiError retains a validated transport receipt id for an unresolved request', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => pending();
    await assert.rejects(api('/ai', { mode: 'write', prompt: 'Cedar' }), error => {
      assert.ok(error instanceof ApiError); assert.equal((error as ApiError & { commandId?: string }).commandId, id); return true;
    });
  } finally { globalThis.fetch = original; }
});

test('bounded receipt waiting returns the original pending response without another mutation', async () => {
  const calls: string[] = [];
  const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, resultTimeoutMs: 20, resultPollMs: 1,
    fetch: async (path, init) => { calls.push(init?.method ?? 'GET'); return calls.length === 1 ? pending() : json({ commandId: id, state: 'pending' }, 202, 'pending'); } });
  const response = await request('/api/ai', { method: 'POST', body: '{}' });
  assert.equal(response.status, 504); assert.equal((await response.json()).commandId, id);
  assert.equal(calls[0], 'POST'); assert.ok(calls.length > 1 && calls.length < 100); assert.ok(calls.slice(1).every(method => method === 'GET'));
});

test('caller Abort stops an in-flight receipt fetch even if its transport ignores signal, without replay or cancellation', async () => {
  const caller = new AbortController(), reason = new Error('Fictional caller stopped waiting'); let started!: () => void;
  const observing = new Promise<void>(resolve => { started = resolve; }); const calls: string[] = [];
  const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, resultPollMs: 1,
    fetch: async (path, init) => { calls.push(`${init?.method}:${String(path)}`); if (calls.length === 1) return pending();
      assert.equal(init?.signal?.aborted, false); started(); return new Promise<Response>(() => {}); } });
  const work = request('/api/send', { method: 'POST', body: '{}', signal: caller.signal });
  await observing; caller.abort(reason); await assert.rejects(work, value => value === reason);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.deepEqual(calls, ['POST:/api/send', `GET:/api/_rea/transport/results/${id}`]);
});

test('missing, mismatched, redirected and uncertain receipts never become safe-to-replay domain absence', async () => {
  for (const failure of ['missing', 'mismatched-id', 'mismatched-body', 'no-state', 'redirected', 'uncertain', 'network']) {
    let calls = 0;
    const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, resultPollMs: 1, fetch: async (_path, init) => {
      calls++; if (calls === 1) return pending(); assert.equal(init?.method, 'GET');
      if (failure === 'network') throw new Error('Fictional receipt read failed');
      const response = failure === 'missing' ? json({ error: { code: 'worker_command_not_found' }, commandId: id }, 404)
        : failure === 'uncertain' ? json({ error: { code: 'worker_command_uncertain' }, commandId: id }, 503, 'uncertain')
        : failure === 'mismatched-body' ? json({ commandId: 'foreign-id', state: 'pending' }, 202, 'pending')
        : json({ text: 'Cedar' }, 200, failure === 'no-state' ? undefined : 'completed');
      if (failure === 'mismatched-id') response.headers.set('x-rea-transport-id', 'foreign-id');
      if (failure === 'redirected') Object.defineProperty(response, 'redirected', { value: true }); return response;
    } });
    if (failure === 'uncertain') { const response = await request('/api/send', { method: 'POST', body: '{}' }); assert.equal(response.status, 503); assert.equal(response.headers.get('x-rea-transport-state'), 'uncertain'); }
    else await assert.rejects(request('/api/send', { method: 'POST', body: '{}' }), error => {
      assert.equal((error as { commandId?: string }).commandId, id); assert.equal('status' in (error as object), false); return true;
    });
    assert.equal(calls, 2);
  }
});

test('a completed original422 stays a domain error, while a late Blob response is verified through its existing grant', async () => {
  let calls = 0;
  const rejected = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, fetch: async () => ++calls === 1 ? pending() : json({ error: { code: 'fictional_native_refusal' } }, 422, 'completed') });
  const refusal = await rejected('/api/send', { method: 'POST', body: '{}' }); assert.equal(refusal.status, 422); assert.equal(calls, 2);
  const bytes = new Uint8Array([0, 1, 127, 255]), ref = 'A'.repeat(32), now = Date.now(), path = `mail-rpc/${'a'.repeat(32)}/${ref}`;
  const sha256 = createHash('sha256').update(bytes).digest('hex'); calls = 0;
  const download = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, now: () => now, fetch: async (url, init) => {
    calls++; if (calls === 1) return pending();
    if (calls === 2) { const response = json({ version: 1, response: { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-rea-transport-id': id }, body: { kind: 'blob', ref, bytes: bytes.length, sha256 } },
      download: { url: `${downloadOrigin}/${path}?synthetic=1`, expiresAt: now + 60_000 } }, 200, 'completed'); response.headers.set('x-rea-transport-body', 'blob-v1'); return response; }
    assert.equal(url, `${downloadOrigin}/${path}?synthetic=1`); assert.equal(init?.credentials, 'omit'); return new Response(bytes);
  } });
  const response = await download('/api/attachments/fictional'); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes); assert.equal(calls, 3);
});

test('aborting a stalled Blob body cancels its reader and never yields a partial reconstructed response', async () => {
  const caller = new AbortController(), reason = new Error('Fictional download stopped'); let ready!: () => void, cancelled = 0, calls = 0;
  const started = new Promise<void>(resolve => { ready = resolve; }), ref = 'A'.repeat(32), now = Date.now();
  const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, now: () => now, fetch: async () => {
    calls++; if (calls === 1) { const response = json({ version: 1, response: { status: 200, headers: {}, body: { kind: 'blob', ref, bytes: 3, sha256: 'a'.repeat(64) } },
      download: { url: `${downloadOrigin}/mail-rpc/${'a'.repeat(32)}/${ref}?synthetic=1`, expiresAt: now + 60_000 } }); response.headers.set('x-rea-transport-body', 'blob-v1'); return response; }
    return new Response(new ReadableStream<Uint8Array>({ pull() { ready(); return new Promise<void>(() => {}); }, cancel() { cancelled++; } }));
  } });
  const work = request('/api/attachment', { signal: caller.signal }); await started; caller.abort(reason);
  await assert.rejects(work, value => value === reason); assert.equal(cancelled, 1); assert.equal(calls, 2);
});
