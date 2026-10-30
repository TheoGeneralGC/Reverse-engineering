import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMailFetch, MailTransportError } from '../src/mail-fetch.ts';
import { downloadMailFile } from '../src/mail-download.ts';

const origin = 'https://mail.example.test', downloadOrigin = 'https://synthetic.private.blob.vercel-storage.com';
const commandId = 'synthetic-transport-01', ref = 'synthetic_blob_ref_0001', pathname = `mail-rpc/${'a'.repeat(32)}/${ref}`, now = 1_000_000;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown, options: ResponseInit = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...options });
const error = (value: unknown) => value instanceof MailTransportError;
const headers = (init?: RequestInit) => new Headers(init?.headers);
const options = { enabled: true, origin, downloadOrigin, uuid: () => commandId, now: () => now };
const uploadUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}&signature=synthetic`;
function envelope(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return { version: 1, response: { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fictional.bin"' },
    body: { kind: 'blob', ref, bytes: bytes.byteLength, sha256: sha(bytes) } }, download: { url: `${downloadOrigin}/${pathname}?signed=synthetic`, expiresAt: now + 60_000 }, ...overrides };
}
function blobResponse(value: unknown, status = 200) { return json(value, { status, headers: { 'content-type': 'application/json', 'x-rea-transport-body': 'blob-v1', 'x-rea-transport-id': commandId } }); }

test('disabled hosted transport is exact fetch passthrough, including caller body, options and returned promise', async () => {
  const body = new Uint8Array([0, 255]).buffer, init = { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } };
  const expected = Promise.resolve(json({ ok: true })); let calls = 0;
  const request = createMailFetch({ enabled: false, fetch: (input, passed) => { calls++; assert.equal(input, '/api/knowledge/sources/files'); assert.equal(passed, init); assert.equal(passed?.body, body); return expected; } });
  assert.equal(request('/api/knowledge/sources/files', init), expected); await expected; assert.equal(calls, 1);
});

test('50 MiB raw Knowledge upload stages exact bytes once and submits a scope-bound stub with the original content type', async () => {
  const bytes = new Uint8Array(50 * 1024 ** 2).fill(17); bytes[0] = 0; bytes[bytes.length - 1] = 255;
  const path = '/api/knowledge/sources/files?accountId=synthetic&name=a%2Bb.txt&clientRequestId=owned-key', calls: string[] = [];
  const body = { kind: 'blob', ref, bytes: bytes.length, sha256: sha(bytes) };
  const request = createMailFetch({ ...options, fetch: async (input, init) => {
    calls.push(String(input));
    if (input === '/api/_rea/transport/uploads') {
      assert.equal(init?.method, 'POST'); assert.deepEqual(JSON.parse(String(init?.body)), { commandId, method: 'POST', path, bytes: bytes.length, sha256: sha(bytes) });
      return json({ body, upload: { url: uploadUrl, expiresAt: now + 600_000 } });
    }
    if (input === uploadUrl) {
      assert.equal(init?.method, 'PUT'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(headers(init).get('content-type'), 'application/octet-stream'); assert.equal(sha(init.body as Uint8Array), sha(bytes)); return json({ stored: true });
    }
    assert.equal(input, path); assert.equal(headers(init).get('x-rea-transport-id'), commandId); assert.equal(headers(init).get('x-rea-transport-body'), 'blob-v1');
    assert.equal(headers(init).get('content-type'), 'application/octet-stream'); assert.deepEqual(JSON.parse(String(init?.body)), body); return json({ source: { id: 'synthetic' } });
  } });
  const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.buffer });
  assert.deepEqual(await response.json(), { source: { id: 'synthetic' } }); assert.deepEqual(calls, ['/api/_rea/transport/uploads', uploadUrl, path]);
});

test('a 10 MiB attachment’s JSON/base64 body crosses direct upload unchanged and remains JSON for native dispatch', async () => {
  const bodyText = JSON.stringify({ name: 'fictional.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(10 * 1024 ** 2, 73).toString('base64') });
  const bytes = new TextEncoder().encode(bodyText), body = { kind: 'blob', ref, bytes: bytes.length, sha256: sha(bytes) }; let calls = 0;
  const request = createMailFetch({ ...options, fetch: async (input, init) => {
    calls++; if (input === '/api/_rea/transport/uploads') return json({ body, upload: { url: uploadUrl, expiresAt: now + 1000 } });
    if (input === uploadUrl) { assert.equal(new TextDecoder().decode(init?.body as Uint8Array), bodyText); return json({ stored: true }); }
    assert.equal(input, '/api/drafts/owned-draft/attachments'); assert.equal(headers(init).get('content-type'), 'application/json'); return json({ draft: { id: 'owned-draft' } });
  } });
  await request('/api/drafts/owned-draft/attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: bodyText }); assert.equal(calls, 3);
});

test('failed, expired, wrong-origin and redirected uploads never dispatch a native command or retry the PUT', async () => {
  const bytes = new Uint8Array([0, 255, 1]), body = { kind: 'blob', ref, bytes: bytes.length, sha256: sha(bytes) };
  for (const failure of ['staging', 'expired', 'wrong-origin', 'wrong-ref', 'put', 'redirected-put', 'network-put'] as const) {
    const calls: string[] = []; const request = createMailFetch({ ...options, inlineBytes: 1, fetch: async (input, init) => {
      calls.push(String(input));
      if (input === '/api/_rea/transport/uploads') {
        if (failure === 'staging') return json({ error: true }, { status: 503 });
        return json({ body, upload: { url: failure === 'wrong-origin' ? uploadUrl.replace('vercel.com', 'attacker.example.test') : failure === 'wrong-ref' ? uploadUrl.replace(encodeURIComponent(ref), 'foreign-reference') : uploadUrl,
          expiresAt: failure === 'expired' ? now : now + 1000 } });
      }
      assert.equal(input, uploadUrl); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
      if (failure === 'network-put') throw new Error('Synthetic lost PUT acknowledgement');
      const response = json({}, { status: failure === 'put' ? 500 : 200 }); if (failure === 'redirected-put') Object.defineProperty(response, 'redirected', { value: true }); return response;
    } });
    await assert.rejects(request('/api/knowledge/sources/files', { method: 'POST', body: bytes }), error, failure);
    assert.ok(calls.length <= 2, failure); assert.ok(!calls.includes('/api/knowledge/sources/files'), failure);
  }
});

test('large binary response is fetched from its pinned private origin, verified and reconstructed before saving the trusted filename', async () => {
  const bytes = new Uint8Array(3 * 1024 ** 2).fill(42); bytes[0] = 0; bytes[bytes.length - 1] = 255; const value = envelope(bytes); let calls = 0;
  const request = createMailFetch({ ...options, fetch: async (input, init) => {
    calls++; if (String(input).startsWith('/api/')) return blobResponse(value);
    assert.equal(input, value.download.url); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); assert.equal(init?.referrerPolicy, 'no-referrer');
    return new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' } });
  } });
  let saved = 0;
  await downloadMailFile('/api/accounts/owned/messages/owned/attachments/owned', 'trusted-name.bin', { request, save: async (blob, name) => {
    saved++; assert.equal(name, 'trusted-name.bin'); assert.equal(blob.size, bytes.length); assert.equal(blob.type, 'application/octet-stream');
    assert.equal(sha(new Uint8Array(await blob.arrayBuffer())), sha(bytes));
  } });
  assert.equal(saved, 1); assert.equal(calls, 2);
});

test('response envelope validation rejects foreign/expired grants, leaked cookies, changed status and wrong refs before downloading', async () => {
  const bytes = new Uint8Array([0, 127, 255]);
  for (const mutate of [
    (value: any) => { value.download.url = value.download.url.replace('synthetic.private.blob.vercel-storage.com', 'attacker.example.test'); },
    (value: any) => { value.download.expiresAt = now; },
    (value: any) => { value.download.url = value.download.url.replace(ref, 'foreign-ref'); },
    (value: any) => { value.response.headers['set-cookie'] = 'rea_oauth_state=leaked'; },
    (value: any) => { value.response.headers['content-encoding'] = 'gzip'; },
    (value: any) => { value.response.status = 201; },
    (value: any) => { value.response.body.url = 'https://attacker.example.test'; },
  ]) {
    let calls = 0; const value = envelope(bytes); mutate(value);
    const request = createMailFetch({ ...options, fetch: async () => { calls++; return blobResponse(value); } });
    await assert.rejects(request('/api/attachment'), error); assert.equal(calls, 1);
  }
});

test('download failures, redirects, length changes and digest mismatches never expose unverified content or replay the API', async () => {
  const bytes = new Uint8Array([0, 127, 255]);
  for (const failure of ['status', 'redirect', 'wrong-final-host', 'length-header', 'short', 'long', 'digest', 'network'] as const) {
    let apiCalls = 0, downloadCalls = 0, saved = 0;
    const request = createMailFetch({ ...options, fetch: async input => {
      if (String(input).startsWith('/api/')) { apiCalls++; return blobResponse(envelope(bytes)); } downloadCalls++;
      if (failure === 'network') throw new Error('Synthetic download interruption');
      const response = new Response(failure === 'short' ? bytes.subarray(0, 2) : failure === 'long' ? new Uint8Array([0, 127, 255, 1]) : failure === 'digest' ? new Uint8Array([1, 2, 3]) : bytes,
        { status: failure === 'status' ? 404 : 200, ...(failure === 'length-header' ? { headers: { 'content-length': '2' } } : {}) });
      if (failure === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
      if (failure === 'wrong-final-host') Object.defineProperty(response, 'url', { value: 'https://attacker.example.test/foreign' }); return response;
    } });
    await assert.rejects(downloadMailFile('/api/attachment', 'fictional.bin', { request, save: () => { saved++; } }), error, failure);
    assert.equal(apiCalls, 1); assert.equal(downloadCalls, 1); assert.equal(saved, 0);
  }
});

test('a pending mutation or lost native acknowledgement is returned once without retries; Abort only stops client transport', async () => {
  for (const failure of ['pending', 'network', 'abort'] as const) {
    let calls = 0; const controller = new AbortController(); const reason = new Error('Synthetic caller stopped waiting');
    const request = createMailFetch({ ...options, fetch: async (_input, init) => {
      calls++; assert.equal(headers(init).get('x-rea-transport-id'), commandId);
      if (failure === 'network') throw new Error('Synthetic lost native acknowledgement');
      if (failure === 'abort') { controller.abort(reason); throw reason; }
      return json({ error: { code: 'worker_request_pending' }, commandId }, { status: 504 });
    } });
    const work = request('/api/send', { method: 'POST', body: '{}', signal: controller.signal });
    if (failure === 'pending') { const response = await work; assert.equal(response.status, 504); assert.equal((await response.json()).commandId, commandId); }
    else await assert.rejects(work, failure === 'abort' ? value => value === reason : error);
    assert.equal(calls, 1);
  }
});
