import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createActionAdmission } from '../src/action-admission.ts';
import { createTrashQueue, decodeTrashResult, type TrashIntent, type TrashRecord, type TrashResult } from '../src/trash-actions.ts';
import type { TrashNativeStatus, TrashUndoStatus } from '../../api/src/trash-action-contract.ts';

const denied = (globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
assert.ok(denied, 'deny-first.mjs must be preloaded before this test imports');
after(() => assert.equal(denied.attempts, 0));
const intent = (threadId = 't', source = 'b'.repeat(64)): TrashIntent => ({ version: 1, action: 'trash', accountId: 'a', accountVersion: 'a'.repeat(64), expectedSourceVersion: source, clientRequestId: randomUUID(), threadId });
const native = (mode: 'local' | 'google' | null = 'local', confirmed = true): TrashNativeStatus => ({ mode, issuePossible: mode === 'google', ackKnown: mode === 'google' && confirmed, effectVerified: confirmed });
const envelope = (i: TrashIntent, changes: Partial<TrashResult> = {}): TrashResult => ({ version: 1, scopeCurrent: true, receipt: { version: 1, action: 'trash', clientRequestId: i.clientRequestId, accountId: i.accountId, accountVersion: i.accountVersion, threadId: i.threadId, state: 'confirmed', undoId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', locked: false, reason: null, native: native() }, undo: null, ...changes });
const inverse = (key: string, state: TrashUndoStatus['state'] = 'confirmed'): TrashUndoStatus => ({ version: 1, clientRequestId: key, state, reason: state === 'refused' ? 'trash_undo_expired' : null, native: native('local', state === 'confirmed') });
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const stored = (s: ReturnType<typeof storage>) => JSON.parse([...s.data.values()][0]).records as TrashRecord[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('durable acceptance and binding precede pending observers; issue marker and exact body precede the only POST', async () => {
  const s = storage(), i = intent(), events: string[] = [], calls: unknown[] = [];
  const q = createTrashQueue('a', { storage: s, onChange(record, value) {
    assert.equal(stored(s)[0].phase, record.phase);
    if (record.phase === 'queued') events.push('pending');
    if (value) assert.equal(value.thread!.id, 't');
  }, transport: async (path, body, method) => {
    assert.equal(stored(s)[0].phase, 'issue-possible'); calls.push({ path, body, method });
    return envelope(i, { thread: { id: 't', accountId: 'a', messages: [{ text: 'never persist this body' }], subject: 'private subject' } as any });
  } });
  const submitted = q.submit(i, { onAccepted(record) { assert.equal(q.get(i.clientRequestId), record); assert.equal(stored(s)[0].intent.clientRequestId, i.clientRequestId); events.push('binding'); } });
  assert.equal(q.get(i.clientRequestId)?.phase, 'queued');
  assert.deepEqual(events, ['binding', 'pending']); assert.deepEqual(calls, []);
  assert.equal((await submitted).phase, 'confirmed');
  const { threadId, ...body } = i;
  assert.deepEqual(calls, [{ path: '/threads/t/trash-actions', body, method: 'POST' }]);
  const raw = [...s.data.values()][0];
  for (const field of ['thread', 'messages', 'subject', 'snippet', 'sender', 'recipients', 'body', 'html', 'providerId']) assert.equal(raw.includes('"' + field + '"'), false);
  assert.equal(raw.includes('never persist'), false); assert.equal(raw.includes('private subject'), false);
  assert.ok(s.data.has('rea:trash-actions:v1:a')); q.dispose();
});

test('one broker preserves mixed-kind reentrant order and supplied batch seats without a second waiting tail', async () => {
  const admission = createActionAdmission(), calls: string[] = [], held = deferred<void>();
  const archive = admission.reserve('a').run(async () => { calls.push('archive-first'); await held.promise; });
  let reentrant: Promise<unknown> | undefined;
  const i = intent();
  const q = createTrashQueue('a', { admission, storage: storage(), onChange(record) {
    if (record.phase === 'queued') reentrant = admission.reserve('a').run(async () => { calls.push('archive-next'); });
  }, transport: async () => { calls.push('trash'); return envelope(i); } });
  const trash = q.submit(i);
  await admission.reserve('b').run(async () => { calls.push('independent'); });
  assert.deepEqual(calls, ['archive-first', 'independent']);
  held.resolve(); await Promise.all([archive, trash, reentrant]);
  assert.deepEqual(calls, ['archive-first', 'independent', 'trash', 'archive-next']);
  q.dispose();
  const batch = createTrashQueue('a', { admission, storage: storage(), transport: async (_path, body) => { calls.push((body as TrashIntent).clientRequestId); return envelope((body as TrashIntent).clientRequestId === one.clientRequestId ? one : two); } });
  const one = intent('one'), two = intent('two'), seats = [admission.reserve('a'), admission.reserve('a')];
  const later = batch.submit(two, { ticket: seats[1] }), earlier = batch.submit(one, { ticket: seats[0] });
  await Promise.all([later, earlier]);
  assert.deepEqual(calls.slice(-2), [one.clientRequestId, two.clientRequestId]); batch.dispose(); admission.dispose();
});

test('duplicate keys and unresolved targets never repeat a write; changed key tuples are rejected', async () => {
  const i = intent(), held = deferred<TrashResult>(); let posts = 0;
  const q = createTrashQueue('a', { storage: storage(), transport: async () => { posts++; return held.promise; } });
  const first = q.submit(i);
  await q.submit({ threadId: i.threadId, ...Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'threadId')) } as TrashIntent);
  await assert.rejects(q.submit({ ...i, threadId: 'foreign' }), /another intent/);
  await assert.rejects(q.submit({ ...i, clientRequestId: randomUUID() }), /pending Trash/);
  held.resolve(envelope(i)); await first; assert.equal(posts, 1); q.dispose();
});

test('initial save, accepted callback, issue save and the adjacent context guard fail before transport with definite local outcomes', async () => {
  for (const failure of ['initial', 'binding', 'issue', 'guard']) {
    const s = storage(), i = intent(); let posts = 0, pending = 0, canIssue = true;
    const q = createTrashQueue('a', { storage: { getItem: s.getItem, setItem(key, value) {
      if (failure === 'initial' || failure === 'issue' && JSON.parse(value).records[0].phase === 'issue-possible') throw Error('synthetic disk failure');
      s.setItem(key, value);
    } }, onChange(record) { if (record.phase === 'queued') pending++; if (record.phase === 'issue-possible' && failure === 'guard') canIssue = false; }, transport: async () => { posts++; return envelope(i); } });
    const work = q.submit(i, { canIssue: () => canIssue, onAccepted() { if (failure === 'binding') throw Error('changed owner'); } });
    if (failure === 'initial' || failure === 'binding') await assert.rejects(work);
    else await work;
    assert.equal(posts, 0);
    if (failure === 'initial') { assert.equal(q.get(i.clientRequestId), undefined); assert.equal(pending, 0); }
    else { assert.equal(q.get(i.clientRequestId)?.phase, 'refused'); assert.equal(q.get(i.clientRequestId)?.receipt, null); assert.equal(q.get(i.clientRequestId)?.localReason, failure === 'issue' ? 'trash-not-saved' : 'trash-context-changed'); }
    q.dispose();
  }
});

test('disposing an owner cancels its waiting seat without cancelling another kind; issued outcomes still settle without publication', async () => {
  const admission = createActionAdmission(), release = deferred<void>(), held = deferred<TrashResult>(), i = intent(); let posts = 0, events = 0;
  const blocker = admission.reserve('a').run(async () => release.promise);
  const q = createTrashQueue('a', { admission, storage: storage(), transport: async () => { posts++; return held.promise; }, onChange() { events++; } });
  const never = q.submit(i); q.dispose();
  const next = admission.reserve('a').run(async () => 'other kind');
  release.resolve(); await blocker; assert.equal((await never).phase, 'refused'); assert.equal(await next, 'other kind'); assert.equal(posts, 0);
  const issued = createTrashQueue('a', { admission, storage: storage(), transport: async () => { posts++; return held.promise; }, onChange() { events++; } });
  const work = issued.submit(i); await Promise.resolve(); assert.equal(posts, 1);
  const before = events; issued.dispose(); held.resolve(envelope(i)); assert.equal((await work).phase, 'confirmed'); assert.equal(events, before); admission.dispose();
});

test('an accepted inverse is durable before pending and waits its parent before one exact versioned keyed POST', async () => {
  const s = storage(), i = intent(), inverseKey = randomUUID(), held = deferred<TrashResult>(), calls: string[] = [];
  const q = createTrashQueue('a', { storage: s, onChange(record) {
    if (record.undo?.state === 'pending') assert.deepEqual(stored(s)[0].undoDispatch, record.undoDispatch);
  }, transport: async (path, body, method) => {
    calls.push(method + ':' + path);
    if (path.endsWith('/trash-actions')) return held.promise;
    assert.equal(stored(s)[0].undoDispatch?.state, 'issue-possible');
    assert.deepEqual(body, { version: 1, accountId: 'a', accountVersion: i.accountVersion, clientRequestId: inverseKey });
    return envelope(i, { undo: inverse(inverseKey) });
  } });
  const forward = q.submit(i), undo = q.undo(i.clientRequestId, inverseKey);
  assert.equal(q.get(i.clientRequestId)?.undo?.state, 'pending');
  assert.deepEqual(stored(s)[0].undoDispatch, { clientRequestId: inverseKey, state: 'not-issued' });
  held.resolve(envelope(i)); await Promise.all([forward, undo]);
  assert.deepEqual(calls, ['POST:/threads/t/trash-actions', 'POST:/threads/t/trash-action-operations/' + i.clientRequestId + '/undo']);
  assert.equal(q.get(i.clientRequestId)?.undoDispatch?.state, 'settled'); q.dispose();
});

test('live known-not-issued inverse continues only on a later explicit action with its original key after GET confirmation', async () => {
  const i = intent(), acceptedKey = randomUUID(), calls: string[] = [];
  const q = createTrashQueue('a', { storage: storage(), transport: async (path, body, method) => {
    calls.push(method + ':' + path);
    if (path.endsWith('/trash-actions')) throw Error('lost forward ACK');
    if (method === 'GET') return envelope(i);
    assert.equal((body as any).clientRequestId, acceptedKey);
    return envelope(i, { undo: inverse(acceptedKey) });
  } });
  await q.submit(i); await q.undo(i.clientRequestId, acceptedKey);
  assert.equal(q.get(i.clientRequestId)?.localReason, 'trash-not-confirmed');
  assert.equal(q.get(i.clientRequestId)?.undo?.reason, null);
  assert.equal(q.get(i.clientRequestId)?.undoDispatch?.state, 'not-issued');
  await q.recover(i.clientRequestId);
  assert.equal(calls.filter(v => v.includes('/undo')).length, 0);
  await q.undo(i.clientRequestId, randomUUID());
  assert.equal(calls.filter(v => v.includes('/undo')).length, 1);
  assert.equal(q.get(i.clientRequestId)?.undo?.clientRequestId, acceptedKey); q.dispose();
});

test('reload loses live continuation privilege and keeps the same inverse key GET-only across null, malformed and404 recovery', async () => {
  for (const issued of [false, true]) {
    const s = storage(), i = intent(), acceptedKey = randomUUID();
    const first = createTrashQueue('a', { storage: s, transport: async path => { if (path.endsWith('/trash-actions') && issued) return envelope(i); throw Error('lost ACK'); } });
    await first.submit(i); await first.undo(i.clientRequestId, acceptedKey); first.dispose();
    let posts = 0, reads = 0;
    const next = createTrashQueue('a', { storage: s, transport: async (_path, _body, method) => {
      if (method !== 'GET') posts++;
      reads++;
      if (reads === 2) throw Object.assign(Error('not found'), { status: 404 });
      if (reads === 3) return { ...envelope(i), undo: { ...inverse(acceptedKey), clientRequestId: randomUUID() } };
      return envelope(i);
    } });
    assert.equal(reads, 0); assert.equal(next.get(i.clientRequestId)?.phase, 'unknown');
    assert.equal(next.get(i.clientRequestId)?.undoDispatch?.state, 'issue-possible');
    for (let turn = 0; turn < 4; turn++) { await next.recover(i.clientRequestId); await next.undo(i.clientRequestId, randomUUID()); assert.equal(next.get(i.clientRequestId)?.undo?.clientRequestId, acceptedKey); }
    assert.equal(posts, 0); assert.equal(next.get(i.clientRequestId)?.undo?.state, 'unknown'); next.dispose();
  }
});

test('ordinary unavailable409 retains the accepted inverse lock; only a saved expired refusal settles it', async () => {
  const s = storage(), i = intent(), acceptedKey = randomUUID(); let posts = 0, saved = false;
  const q = createTrashQueue('a', { storage: s, transport: async (path, _body, method) => {
    if (path.endsWith('/trash-actions')) return envelope(i);
    if (method === 'POST') { posts++; throw Object.assign(Error('ordinary Undo missing'), { status: 409, code: 'trash_undo_unavailable' }); }
    return envelope(i, { undo: saved ? inverse(acceptedKey, 'refused') : null });
  } });
  await q.submit(i); await q.undo(i.clientRequestId, acceptedKey);
  await q.recover(i.clientRequestId); await q.undo(i.clientRequestId, randomUUID());
  assert.equal(posts, 1); assert.equal(q.get(i.clientRequestId)?.undo?.state, 'unknown'); assert.equal(q.get(i.clientRequestId)?.undoDispatch?.state, 'issue-possible');
  saved = true; await q.recover(i.clientRequestId);
  assert.equal(q.get(i.clientRequestId)?.undo?.reason, 'trash_undo_expired'); assert.equal(q.get(i.clientRequestId)?.undoDispatch?.state, 'settled'); assert.equal(q.get(i.clientRequestId)?.receipt?.locked, false); q.dispose();
});

test('inverse save failures and a changed context never issue or manufacture remote uncertainty', async () => {
  for (const failure of ['initial', 'issue', 'guard']) {
    const s = storage(), i = intent(), acceptedKey = randomUUID(); let fail = false, inversePosts = 0, pending = 0, current = true;
    const q = createTrashQueue('a', { storage: { getItem: s.getItem, setItem(key, value) {
      const dispatch = JSON.parse(value).records[0].undoDispatch;
      if (fail && (failure === 'initial' || failure === 'issue' && dispatch?.state === 'issue-possible')) throw Error('disk');
      s.setItem(key, value);
    } }, onChange(record) { if (record.undo?.state === 'pending') { pending++; if (failure === 'guard' && record.undoDispatch?.state === 'issue-possible') current = false; } }, transport: async path => { if (path.endsWith('/undo')) inversePosts++; return envelope(i); } });
    await q.submit(i); fail = true;
    const work = q.undo(i.clientRequestId, acceptedKey, () => current);
    if (failure === 'initial') { await assert.rejects(work, /saved safely/); assert.equal(q.get(i.clientRequestId)?.undo, null); assert.equal(pending, 0); }
    else { await work; assert.equal(q.get(i.clientRequestId)?.undo?.state, 'refused'); assert.equal(q.get(i.clientRequestId)?.undo?.reason, null); assert.equal(q.get(i.clientRequestId)?.undoDispatch?.state, 'not-issued'); assert.equal(q.get(i.clientRequestId)?.localReason, failure === 'issue' ? 'trash-not-saved' : 'trash-context-changed'); }
    assert.equal(inversePosts, 0); q.dispose();
  }
});

test('contextual decoder rejects foreign, Archive-shaped, incoherent and extra fields while accepting the actual local native shape', () => {
  const i = intent(), u = randomUUID(), value = envelope(i);
  assert.deepEqual(decodeTrashResult(value, i).receipt.native, { mode: 'local', issuePossible: false, ackKnown: false, effectVerified: true });
  const mutations: ((v: any) => void)[] = [
    v => { v.version = 2; }, v => { v.receipt.accountId = 'foreign'; }, v => { v.receipt.accountVersion = 'f'.repeat(64); },
    v => { v.receipt.threadId = 'foreign'; }, v => { v.receipt.clientRequestId = randomUUID(); }, v => { v.receipt.action = 'archive'; },
    v => { v.receipt.reason = 'invented'; }, v => { v.receipt.locked = true; }, v => { v.receipt.native.ackKnown = 1; },
    v => { v.receipt.native.issuePossible = true; }, v => { v.undoId = v.receipt.undoId; }, v => { v.currentThread = {}; },
    v => { v.scopeCurrent = false; v.thread = { id: 't', accountId: 'a', messages: [] }; },
    v => { v.thread = { id: 't', accountId: 'foreign', messages: [] }; },
    v => { v.undo = inverse(randomUUID()); }, v => { delete v.undo; },
    v => { v.receipt.native = { mode: 'google', issuePossible: false, ackKnown: true, effectVerified: true }; },
  ];
  for (const mutate of mutations) { const raw = structuredClone(value); mutate(raw); assert.throws(() => decodeTrashResult(raw, i, u), /verified/); }
  const refusal = envelope(i, { receipt: { ...value.receipt, state: 'refused', reason: 'trash_local_conflict', locked: true, native: native('local', false) } });
  assert.equal(decodeTrashResult(refusal, i).receipt.locked, true);
});

test('known native ACK bits survive failed storage, malformed recovery, and a stale response that would remove them', async () => {
  const s = storage(), i = intent(); let fail = false, reads = 0;
  const known = envelope(i, { receipt: { ...envelope(i).receipt, state: 'unknown', locked: true, reason: 'trash_effect_unconfirmed', native: { mode: 'google', issuePossible: true, ackKnown: true, effectVerified: false } } });
  const q = createTrashQueue('a', { storage: { getItem: s.getItem, setItem(key, value) { if (fail) throw Error('disk'); s.setItem(key, value); } }, transport: async (_path, _body, method) => {
    if (method === 'POST') { fail = true; return known; }
    reads++;
    if (reads === 1) return { ...known, receipt: { ...known.receipt, native: { ...known.receipt.native, ackKnown: false } } };
    throw Error('lost status');
  } });
  await q.submit(i);
  assert.equal(q.get(i.clientRequestId)?.receipt?.native.ackKnown, true);
  await q.recover(i.clientRequestId); await q.recover(i.clientRequestId);
  assert.equal(q.get(i.clientRequestId)?.receipt?.native.ackKnown, true); assert.equal(q.get(i.clientRequestId)?.phase, 'unknown'); q.dispose();
});

test('invalid or oversized history blocks new Trash without rewriting; finite history never evicts unresolved keys', async () => {
  const namespace = 'rea:trash-actions:v1:a';
  for (const raw of ['not JSON', ' '.repeat(400001), JSON.stringify({ version: 1, accountId: 'a', records: [{ intent: intent(), phase: 'unknown', receipt: null, undo: null, restored: false, scopeCurrent: true, thread: { body: 'forbidden' } }] })]) {
    const s = storage(); s.data.set(namespace, raw); let posts = 0;
    const q = createTrashQueue('a', { storage: s, transport: async () => { posts++; throw Error(); } });
    assert.ok(q.blocked()); await assert.rejects(q.submit(intent())); assert.equal(s.data.get(namespace), raw); assert.equal(posts, 0); q.dispose();
  }
  for (const phase of ['unknown', 'refused'] as const) {
    const s = storage(), rows = Array.from({ length: 200 }, (_, n) => ({ intent: intent('t-' + n), phase, receipt: null, undo: null, restored: false, scopeCurrent: true }));
    s.data.set(namespace, JSON.stringify({ version: 1, accountId: 'a', records: rows }));
    const fresh = intent('fresh'); let posts = 0;
    const q = createTrashQueue('a', { storage: s, transport: async () => { posts++; return envelope(fresh); } });
    assert.equal(q.blocked(), null);
    if (phase === 'unknown') { await assert.rejects(q.submit(fresh), /saved safely/); assert.ok(q.get(rows[0].intent.clientRequestId)); assert.equal(q.get(fresh.clientRequestId), undefined); assert.equal(posts, 0); }
    else { await q.submit(fresh); assert.equal(q.get(rows[0].intent.clientRequestId), undefined); assert.equal(posts, 1); }
    assert.equal(q.all().length, 200); q.dispose();
  }
});

test('owner-only alignment accepts actual serialized corrected V2 local HTTP success, missing409 and saved200 expiry', async () => {
  const [{ createApp }, { AccountIncarnationAuthority }, { verifiedActionBasis }] = await Promise.all([
    import('../../api/src/server.ts'), import('../../api/src/account-incarnation.ts'), import('../../api/src/archive-action-basis.ts'),
  ]);
  let nativeCalls = 0;
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, providerDraftAutomatic: false, trashNative: {
    async read() { nativeCalls++; throw Error('native read forbidden'); }, async modify() { nativeCalls++; throw Error('native write forbidden'); },
  } });
  const http = (method: string, path: string, body?: unknown) => new Promise<{ status: number; body: any }>(done => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url: '/api' + path, headers: { host: '127.0.0.1:3001', 'content-type': 'application/json' } });
    const res = { status: 0, setHeader() {}, writeHead(status: number) { this.status = status; }, end(raw: unknown) { done({ status: this.status, body: JSON.parse(String(raw)) }); } };
    app.server.emit('request', req, res);
  });
  const requests: string[] = [];
  const q = createTrashQueue('a', { storage: storage(), transport: async (path, body, method = 'GET') => {
    requests.push(method + ':' + path);
    const value = await http(method, path, body);
    if (value.status !== 200) throw Object.assign(Error(value.body.error?.message ?? 'HTTP failure'), { status: value.status, code: value.body.error?.code });
    return value.body;
  } });
  try {
    assert.equal(app.server.listening, false);
    app.store.put('account', 'a', { id: 'a', provider: 'demo', email: 'own@example.test', name: 'Fictional', color: '#000' });
    new AccountIncarnationAuthority(app.store).adoptAccount('a');
    for (const kind of ['success', 'missing', 'expired']) {
      const threadId = 'fixture-' + kind;
      app.store.put('thread', threadId, { id: threadId, accountId: 'a', subject: 'Fictional alignment', snippet: 'Synthetic only', sender: { name: 'Fictional', email: 'own@example.test' }, participants: [], lastMessageAt: '2026-10-30T00:00:00.000Z', unread: true, starred: false, important: false, folder: 'inbox', labels: [], messages: [] });
      const basis = verifiedActionBasis(app.store, threadId, 'a')!;
      const i = { ...intent(threadId, basis.sourceVersion), accountVersion: basis.accountVersion }, acceptedKey = randomUUID();
      const forward = await q.submit(i);
      assert.equal(forward.phase, 'confirmed'); assert.deepEqual(forward.receipt!.native, { mode: 'local', issuePossible: false, ackKnown: false, effectVerified: true });
      if (kind === 'missing') app.store.db.prepare('DELETE FROM undo WHERE id=?').run(forward.receipt!.undoId!);
      if (kind === 'expired') app.store.db.prepare('UPDATE undo SET expires=0 WHERE id=?').run(forward.receipt!.undoId!);
      await q.undo(i.clientRequestId, acceptedKey);
      if (kind === 'success') { assert.equal(forward.undo!.state, 'confirmed'); assert.equal(app.store.required<any>('thread', threadId).folder, 'inbox'); }
      if (kind === 'missing') {
        assert.equal(forward.undo!.state, 'unknown'); assert.equal(forward.undoDispatch!.state, 'issue-possible');
        await q.recover(i.clientRequestId); const before = requests.length; await q.undo(i.clientRequestId, randomUUID()); assert.equal(requests.length, before); assert.equal(forward.undo!.clientRequestId, acceptedKey);
      }
      if (kind === 'expired') { assert.equal(forward.undo!.state, 'refused'); assert.equal(forward.undo!.reason, 'trash_undo_expired'); assert.equal(forward.undoDispatch!.state, 'settled'); assert.equal(forward.receipt!.locked, false); }
    }
    assert.equal(nativeCalls, 0); assert.equal(denied.attempts, 0); assert.equal(app.server.listening, false);
  } finally { q.dispose(); await app.close(); }
});
