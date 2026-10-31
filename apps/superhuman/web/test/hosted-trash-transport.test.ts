import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createMailFetch } from '../src/mail-fetch.ts';
import { createActionAdmission } from '../src/action-admission.ts';
import { createTrashQueue, type TrashIntent, type TrashRecord, type TrashResult } from '../src/trash-actions.ts';

const denied = (globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
assert.ok(denied, 'deny-first must be preloaded before composite imports');
after(() => assert.equal(denied.attempts, 0));
const origin = 'https://mail.example.test', downloadOrigin = 'https://synthetic.private.blob.vercel-storage.com';
const intent = (): TrashIntent => ({ version: 1, action: 'trash', accountId: 'fictional', accountVersion: 'a'.repeat(64),
  expectedSourceVersion: 'b'.repeat(64), clientRequestId: randomUUID(), threadId: 'fictional-thread' });
const confirmed = (i: TrashIntent): TrashResult => ({ version: 1, scopeCurrent: true, receipt: { version: 1, action: 'trash',
  clientRequestId: i.clientRequestId, accountId: i.accountId, accountVersion: i.accountVersion, threadId: i.threadId,
  state: 'confirmed', undoId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', locked: false, reason: null,
  native: { mode: 'google', issuePossible: true, ackKnown: true, effectVerified: true } }, undo: null });
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const journal = (s: ReturnType<typeof storage>): TrashRecord[] => JSON.parse([...s.values.values()][0]).records;
const response = (value: unknown, id: string, status = 200, state?: string) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'x-rea-transport-id': id, ...(state ? { 'x-rea-transport-state': state } : {}) } });
const pending = (id: string) => response({ error: { code: 'worker_request_pending' }, commandId: id }, id, 504, 'pending');
type Call = { path: string; method: string; body: BodyInit | null | undefined };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('hosted Trash confirms a late Blob receipt after one domain POST, preserving the domain key and durable issue marker', async () => {
  const i = intent(), s = storage(), admission = createActionAdmission(), calls: Call[] = [], id = 'fictional-trash-transport', now = Date.now();
  const bytes = new TextEncoder().encode(JSON.stringify(confirmed(i))), sha256 = createHash('sha256').update(bytes).digest('hex');
  const ref = 'A'.repeat(32), download = `${downloadOrigin}/mail-rpc/${'d'.repeat(32)}/${ref}?synthetic=1`;
  let receipts = 0;
  const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => id, now: () => now, resultPollMs: 1,
    fetch: async (path, init) => {
      calls.push({ path: String(path), method: init?.method ?? 'GET', body: init?.body });
      if (calls.length === 1) {
        assert.equal(journal(s)[0].phase, 'issue-possible');
        assert.equal(path, '/api/threads/fictional-thread/trash-actions'); assert.equal(init?.method, 'POST');
        const { threadId, ...body } = i; assert.deepEqual(JSON.parse(String(init?.body)), body);
        assert.equal(new Headers(init?.headers).get('x-rea-transport-id'), id); return pending(id);
      }
      if (path === `/api/_rea/transport/results/${id}`) {
        receipts++; assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
        assert.equal(journal(s)[0].phase, 'issue-possible');
        if (receipts === 1) return response({ commandId: id, state: 'pending' }, id, 202, 'pending');
        const result = response({ version: 1, response: { status: 200, headers: { 'content-type': 'application/json' },
          body: { kind: 'blob', ref, bytes: bytes.length, sha256 } }, download: { url: download, expiresAt: now + 60_000 } }, id, 200, 'completed');
        result.headers.set('x-rea-transport-body', 'blob-v1'); return result;
      }
      assert.equal(path, download); assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'omit');
      return new Response(bytes);
    } });
  const q = createTrashQueue(i.accountId, { storage: s, admission, transport: async (path, body, method) => {
    const result = await request('/api' + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(65_000) });
    if (!result.ok) throw Error('Trash status unavailable'); return result.json();
  } });
  try {
    const result = await q.submit(i); assert.equal(result.phase, 'confirmed'); assert.equal(result.receipt?.native.effectVerified, true);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1); assert.equal(receipts, 2);
    assert.equal(journal(s).length, 1); assert.deepEqual(journal(s)[0].intent, i); assert.equal(journal(s)[0].phase, 'confirmed');
    assert.equal(journal(s)[0].receipt?.clientRequestId, i.clientRequestId);
  } finally { q.dispose(); admission.dispose(); }
});

test('a caller abort leaves hosted Trash unknown, frees shared admission, and explicit Check reads the same domain operation without replay', async () => {
  const i = intent(), s = storage(), admission = createActionAdmission(), calls: Call[] = [], caller = new AbortController();
  const observing = deferred<void>(), held = deferred<Response>(); let allocated = 0, follower = 0;
  const id = 'fictional-aborted-trash', checkId = 'fictional-check-trash';
  const request = createMailFetch({ enabled: true, origin, downloadOrigin, uuid: () => ++allocated === 1 ? id : checkId, resultPollMs: 1,
    fetch: async (path, init) => {
      calls.push({ path: String(path), method: init?.method ?? 'GET', body: init?.body });
      if (calls.length === 1) { assert.equal(init?.method, 'POST'); return pending(id); }
      if (path === `/api/_rea/transport/results/${id}`) {
        assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); observing.resolve();
        return held.promise; // Deliberately ignores AbortSignal: the real transport must stop waiting itself.
      }
      assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
      const url = new URL(String(path), origin);
      assert.equal(url.pathname, `/api/threads/fictional-thread/trash-action-operations/${i.clientRequestId}`);
      assert.equal(url.searchParams.get('accountId'), i.accountId); assert.equal(url.searchParams.get('accountVersion'), i.accountVersion);
      assert.equal(new Headers(init?.headers).get('x-rea-transport-id'), checkId); return response(confirmed(i), checkId);
    } });
  const q = createTrashQueue(i.accountId, { storage: s, admission, transport: async (path, body, method) => {
    const result = await request('/api' + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: method === 'POST' ? AbortSignal.any([caller.signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000) });
    if (!result.ok) throw Error('Trash status unavailable'); return result.json();
  } });
  try {
    const submitted = q.submit(i); await observing.promise;
    const followingDone = admission.reserve(i.accountId).run(async () => { follower++; });
    await Promise.resolve(); assert.equal(follower, 0); assert.equal(journal(s)[0].phase, 'issue-possible');
    caller.abort(new Error('Fictional caller stopped waiting'));
    assert.equal((await submitted).phase, 'unknown'); await followingDone; assert.equal(follower, 1);
    assert.equal(journal(s)[0].phase, 'unknown'); assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    held.resolve(response({ commandId: id, state: 'pending' }, id, 202, 'pending')); await Promise.resolve();
    assert.equal((await q.recover(i.clientRequestId)).phase, 'confirmed');
    assert.equal(journal(s).length, 1); assert.deepEqual(journal(s)[0].intent, i); assert.equal(journal(s)[0].phase, 'confirmed');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1); assert.equal(allocated, 2);
  } finally { held.resolve(response({ commandId: id, state: 'pending' }, id, 202, 'pending')); q.dispose(); admission.dispose(); }
});
