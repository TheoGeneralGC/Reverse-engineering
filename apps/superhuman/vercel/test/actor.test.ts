import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ActorAuthority, ActorAuthorityError, assertFenceRow, type ActorLease } from '../src/authority.ts';
import { DurableCommandLog, CommandLogError, type CommandRequest, type CommandResponse } from '../src/command-log.ts';
import { DurableCoreActor, type ActorCore } from '../src/actor.ts';
import { NativeControl } from './control-sql-fixture.ts';

const actualFetch = globalThis.fetch; let attempts = 0;
globalThis.fetch = async () => { attempts++; throw new Error('No external fetch in actor spike'); };
after(() => { globalThis.fetch = actualFetch; assert.equal(attempts, 0); });
const namespace = 'synthetic-mail', webOrigin = 'https://mail.example.test';
const body = (value: string) => ({ kind: 'inline' as const, base64: Buffer.from(value).toString('base64') });
function response(value: unknown, status = 200): CommandResponse { return { status, headers: { 'content-type': 'application/json' }, body: body(JSON.stringify(value)) }; }
function request(path: string, method = 'POST', value = ''): CommandRequest { return { method, path, headers: method === 'GET' ? {} : { origin: webOrigin, 'content-type': 'application/json' }, body: body(value) }; }
function deferred<T = void>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'rea-vercel-actor-')), databasePath = join(directory, 'control.sqlite');
  const sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath }); let now = 10_000;
  const authority = new ActorAuthority(sql, { namespace, leaseMs: 1000, now: () => now });
  const log = new DurableCommandLog(sql, { namespace, webOrigin, now: () => now });
  return { sql, authority, log, setNow(value: number) { now = value; },
    enqueue: (id: string, value: CommandRequest) => log.enqueue({ id, namespace, request: value }),
    async close() { await sql.close(); rmSync(directory, { recursive: true, force: true }); } };
}
async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let turn = 0; turn < 100; turn++) { if (await check()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
  assert.fail('The bounded actor check did not settle');
}
async function noopCore(): Promise<ActorCore> { return { dispatch: async () => response({ ok: true }), quiesce: async () => {}, close: async () => {} }; }

test('actor authority is acquired before Core construction, and expiry never permits a second Core', async () => {
  const f = await fixture(); let constructed = 0;
  try {
    const first = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'first', deploymentId: 'deployment-one', createCore: async context => {
      const current = await f.authority.current(); assert.equal(current?.actorId, context.lease.actorId); constructed++; return noopCore(); } });
    f.setNow(1_000_000);
    await assert.rejects(DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'second', deploymentId: 'deployment-two', createCore: async () => { constructed++; return noopCore(); } }), (error: unknown) => error instanceof ActorAuthorityError && error.code === 'actor_already_owned');
    assert.equal(constructed, 1); await first.heartbeat(); await first.close();
    const second = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'second', deploymentId: 'deployment-two', createCore: async () => { constructed++; return noopCore(); } });
    assert.equal(second.context.lease.epoch, 2); assert.equal(constructed, 2);
    await assert.rejects(f.authority.assertCurrent(first.context.lease)); await second.close();
  } finally { await f.close(); }
});

test('a held synthetic Send deadline does not block a second Undo command or status response', async () => {
  const f = await fixture(); const deadline = deferred(); let nativeSends = 0, cancelled = false; let sendWork: Promise<void> | undefined;
  try {
    const actor = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'send-actor', deploymentId: 'deployment-one', createCore: async context => ({
      async dispatch(input) {
        if (input.path === '/api/send') { sendWork = deadline.promise.then(async () => { if (!cancelled) await context.runNative(async () => { nativeSends++; }); }); return response({ accepted: true, cancellableUntil: 20_000 }, 202); }
        if (input.path === '/api/undo') { cancelled = true; return response({ cancelled: true }); }
        return response({ cancelled, nativeSends });
      }, async quiesce() { deadline.resolve(); await sendWork; }, async close() {},
    }) });
    await f.enqueue('send', request('/api/send')); await actor.pumpOnce();
    await until(async () => (await f.log.readResult(namespace, 'send'))?.state === 'completed');
    await f.enqueue('undo', request('/api/undo')); await f.enqueue('status', request('/api/status', 'GET'));
    await actor.pumpOnce(); await actor.waitForRequests();
    assert.equal((await f.log.readResult(namespace, 'undo'))?.response?.status, 200);
    assert.equal(cancelled, true); deadline.resolve(); await sendWork; assert.equal(nativeSends, 0); await actor.close();
  } finally { deadline.resolve(); await f.close(); }
});

test('a long active callback still permits concurrent Stop and persisted event/status reads', async () => {
  const f = await fixture(); const model = deferred(); let started = false, stopped = false; const handled: string[] = [];
  try {
    const actor = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'model-actor', deploymentId: 'deployment-one', createCore: async context => ({
      async dispatch(input) {
        handled.push(input.path);
        if (input.path === '/api/model') { started = true; await context.runNative(async () => model.promise); return response({ stopped }); }
        if (input.path === '/api/stop') { stopped = true; model.resolve(); return response({ stopped }); }
        return response({ started });
      }, async quiesce() { await model.promise; }, async close() {},
    }) });
    await f.enqueue('model', request('/api/model')); await actor.pumpOnce(); await until(() => started);
    assert.equal((await f.log.readResult(namespace, 'model'))?.state, 'claimed');
    await f.enqueue('stop', request('/api/stop')); await f.enqueue('events', request('/api/events', 'GET'));
    await actor.pumpOnce(); await actor.waitForRequests();
    assert.equal(stopped, true); assert.deepEqual(handled, ['/api/model', '/api/stop', '/api/events']);
    assert.equal((await f.log.readResult(namespace, 'events'))?.state, 'completed'); await actor.close();
  } finally { model.resolve(); await f.close(); }
});

test('cloud debounce is explicitly flushed during quiescence before Core close and handoff', async () => {
  const f = await fixture(); const debounce = deferred(); let pending: Promise<void> | undefined, writes = 0, closed = false; const order: string[] = [];
  try {
    const actor = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'cloud-actor', deploymentId: 'deployment-one', createCore: async context => ({
      async dispatch() { pending = debounce.promise.then(() => context.runNative(async () => { assert.equal(closed, false); order.push('write'); writes++; })); return response({ savedLocally: true }); },
      async quiesce() { order.push('quiesce'); debounce.resolve(); await pending; },
      async close() { assert.equal(writes, 1); closed = true; order.push('close'); },
    }) });
    await f.enqueue('edit', request('/api/drafts/local', 'PATCH', '{"body":"Fictional draft"}')); await actor.pumpOnce(); await actor.waitForRequests();
    assert.equal(writes, 0); await actor.close(); assert.deepEqual(order, ['quiesce', 'write', 'close']);
    assert.equal((await f.authority.current())?.state, 'quiesced');
    await assert.rejects(async () => actor.context.runNative(async () => { writes++; })); assert.equal(writes, 1);
  } finally { debounce.resolve(); await f.close(); }
});

test('ordered atomic claims and repeated wakes never replay a completed command or changed payload', async () => {
  const f = await fixture(); const seen: string[] = [];
  try {
    const actor = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'ordered-actor', deploymentId: 'deployment-one', createCore: async () => ({
      async dispatch(input) { seen.push(input.path); return response({ ok: true }); }, async quiesce() {}, async close() {},
    }) });
    const a = await f.enqueue('a', request('/api/a')), b = await f.enqueue('b', request('/api/b'));
    assert.ok(a.command.sequence < b.command.sequence);
    assert.equal((await f.enqueue('a', request('/api/a'))).created, false);
    const pumping = actor.pumpOnce(); assert.equal(actor.pumpOnce(), pumping); await pumping; await actor.waitForRequests();
    assert.deepEqual(seen, ['/api/a', '/api/b']); assert.equal(await actor.pumpOnce(), 0);
    assert.equal((await f.enqueue('a', request('/api/a'))).command.state, 'completed');
    await assert.rejects(f.enqueue('a', request('/api/changed')), (error: unknown) => error instanceof CommandLogError && error.status === 409);
    assert.deepEqual(seen, ['/api/a', '/api/b']); await actor.close();
  } finally { await f.close(); }
});

test('a failed callback becomes uncertain without native replay, even when its enqueue is repeated', async () => {
  const f = await fixture(); let dispatches = 0;
  try {
    const actor = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'fault-actor', deploymentId: 'deployment-one', createCore: async () => ({
      async dispatch() { dispatches++; throw new Error('Fictional secret and prompt must not enter result'); }, async quiesce() {}, async close() {},
    }) });
    await f.enqueue('uncertain', request('/api/send')); await actor.pumpOnce(); await actor.waitForRequests();
    const result = await f.log.readResult(namespace, 'uncertain'); assert.equal(result?.state, 'uncertain');
    const repeated = await f.enqueue('uncertain', request('/api/send')); assert.equal(repeated.created, false);
    assert.equal(await actor.pumpOnce(), 0); assert.equal(dispatches, 1); assert.ok(!JSON.stringify(result).includes('Fictional secret'));
    await actor.close();
  } finally { await f.close(); }
});

test('an abandoned claimed command and dirty expired owner remain held instead of becoming queued', async () => {
  const f = await fixture();
  try {
    await f.authority.initialize(); await f.log.initialize(); const owner = await f.authority.acquire('crashed', 'deployment-old'); assert.ok(owner.acquired);
    await f.enqueue('claimed-before-crash', request('/api/send')); assert.equal((await f.log.claimNext(owner.lease))?.id, 'claimed-before-crash');
    f.setNow(10_000_000); await f.authority.markUncertain(owner.lease);
    const next = await f.authority.acquire('new', 'deployment-new'); assert.equal(next.acquired, false);
    assert.equal((await f.log.readResult(namespace, 'claimed-before-crash'))?.state, 'claimed');
    assert.equal((await f.enqueue('claimed-before-crash', request('/api/send'))).created, false);
    await assert.rejects(f.log.claimNext(owner.lease));
  } finally { await f.close(); }
});

test('request envelopes discard unrelated cookies and credentials, bound bytes and reject origin/path confusion', async () => {
  const f = await fixture();
  try {
    await f.log.initialize();
    const input = request('/api/auth/google/callback?state=synthetic-state&code=synthetic-code', 'GET');
    input.headers = { cookie: 'vercel_sso=private-visitor; rea_oauth_state=synthetic_state_1234; other=ignored', authorization: 'Bearer private-visitor', 'x-forwarded-host': 'attacker.invalid' };
    await f.enqueue('oauth', input);
    const row = (await f.sql.execute('SELECT request_json FROM runtime_commands WHERE id=?', ['oauth'])).rows[0];
    const saved = JSON.parse(String(row.request_json)); assert.deepEqual(saved.headers, { cookie: 'rea_oauth_state=synthetic_state_1234' });
    assert.ok(!String(row.request_json).includes('private-visitor')); assert.ok(!String(row.request_json).includes('attacker.invalid'));
    for (const path of ['//attacker.invalid/api', '/api/../admin', '/api/%2e%2e/admin', '/api/x#fragment', '/api\\x', '/api/x\n']) await assert.rejects(f.enqueue('bad', request(path)));
    for (const origin of ['https://attacker.invalid', 'null', 'http://127.0.0.1:5173']) { const value = request('/api/save'); value.headers.origin = origin; await assert.rejects(f.enqueue('bad', value)); }
    const missingOrigin = request('/api/save'); missingOrigin.headers = {}; await assert.rejects(f.enqueue('bad', missingOrigin));
    const duplicateCookie = request('/api/save'); duplicateCookie.headers.cookie = 'rea_oauth_state=synthetic_state_1234; rea_oauth_state=synthetic_state_5678'; await assert.rejects(f.enqueue('bad', duplicateCookie));
    const oversized = request('/api/save'); oversized.body = body('x'.repeat(1_000_001)); await assert.rejects(f.enqueue('bad', oversized));
    const badBlob = request('/api/save'); badBlob.body = { kind: 'blob', ref: 'https://attacker.invalid/file', sha256: 'a'.repeat(64), bytes: 1 }; await assert.rejects(f.enqueue('bad', badBlob));
    const validBlob = request('/api/knowledge/sources/upload'); validBlob.body = { kind: 'blob', ref: 'opaque_blob_handle_1234', sha256: 'a'.repeat(64), bytes: 50 * 1024 * 1024 };
    assert.equal(f.log.normalizeRequest(validBlob).body.kind, 'blob');
    await assert.rejects(f.enqueue('knowledge', validBlob), (error: unknown) => error instanceof CommandLogError && error.code === 'worker_body_authority_required');
  } finally { await f.close(); }
});

test('responses preserve repeated secure OAuth cookies and download metadata while forbidding public cache', async () => {
  const f = await fixture();
  try {
    const value = f.log.normalizeResponse({ status: 302, headers: { 'Set-Cookie': ['rea_oauth_state=synthetic_state_1234; HttpOnly; SameSite=Lax', 'second=value; Secure'],
      'Location': 'https://accounts.google.com/authorize', 'Content-Disposition': "attachment; filename*=UTF-8''synthetic.txt", 'Cache-Control': 'public, max-age=86400', 'X-Internal': 'not public' }, body: body('') });
    assert.deepEqual(value.headers['set-cookie'], ['rea_oauth_state=synthetic_state_1234; HttpOnly; SameSite=Lax; Secure', 'second=value; Secure']);
    assert.equal(value.headers['content-disposition'], "attachment; filename*=UTF-8''synthetic.txt");
    assert.equal(value.headers['cache-control'], 'private, no-store, max-age=0'); assert.equal(value.headers['x-internal'], undefined);
    await assert.rejects(async () => f.log.normalizeResponse({ ...value, headers: { location: 'https://example.test/\r\nInjected: value' } }));
  } finally { await f.close(); }
});

test('construction failure keeps its dirty authority held; stale epoch rows cannot grant local fencing', async () => {
  const f = await fixture();
  try {
    await assert.rejects(DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'failed', deploymentId: 'deployment-one', createCore: async () => { throw new Error('synthetic factory failure'); } }));
    assert.equal((await f.authority.current())?.state, 'uncertain');
    assert.equal((await f.authority.acquire('replacement', 'deployment-two')).acquired, false);
    const lease: ActorLease = { namespace, actorId: 'failed', epoch: 1 };
    assert.throws(() => assertFenceRow(lease, { namespace, actor_nonce: 'failed', epoch: 2, deployment_id: 'deployment-two', state: 'active', lease_until_ms: 1000, heartbeat_ms: 1000 }), ActorAuthorityError);
  } finally { await f.close(); }
});

test('stored request or response corruption cannot bypass the original command fingerprint', async () => {
  const f = await fixture(); let dispatched = 0, revoked = 0, closed = 0;
  try {
    const actor = await DurableCoreActor.start({ authority: f.authority, log: f.log, actorId: 'integrity-actor', deploymentId: 'deployment-one', createCore: async () => ({
      async dispatch() { dispatched++; return response({ ok: true }); }, async quiesce() {}, async close() { closed++; }, revokeAuthority() { revoked++; },
    }) });
    await f.enqueue('first', request('/api/first')); await actor.pumpOnce(); await actor.waitForRequests();
    await f.sql.execute('UPDATE runtime_commands SET response_json=? WHERE id=?', [JSON.stringify(response({ forged: true })), 'first']);
    await assert.rejects(f.log.readResult(namespace, 'first'), (error: unknown) => error instanceof CommandLogError && error.code === 'worker_command_corrupt');
    await f.enqueue('second', request('/api/read')); await f.sql.execute('UPDATE runtime_commands SET request_json=? WHERE id=?', [JSON.stringify(request('/api/send')), 'second']);
    await assert.rejects(actor.pumpOnce(), (error: unknown) => error instanceof CommandLogError && error.code === 'worker_command_corrupt');
    assert.equal(dispatched, 1); assert.equal((await f.log.readResult(namespace, 'second'))?.state, 'queued');
    assert.equal(actor.state, 'uncertain'); assert.equal(revoked, 1);
    await assert.rejects(actor.close(), (error: unknown) => error instanceof ActorAuthorityError && error.code === 'actor_not_quiescent');
    assert.equal(closed, 0); assert.notEqual((await f.authority.current())?.state, 'quiesced');
    assert.equal((await f.authority.acquire('standby-after-corruption', 'deployment-two')).acquired, false);
  } finally { await f.close(); }
});


test('Blob authorization and command acceptance commit atomically; a duplicate never reauthorizes expired bytes', async () => {
  const f = await fixture(); let calls = 0;
  try {
    await f.log.initialize();
    await f.sql.execute('CREATE TABLE synthetic_body(ref TEXT PRIMARY KEY,state TEXT NOT NULL,bound TEXT)');
    await f.sql.execute("INSERT INTO synthetic_body VALUES(?,'active',NULL)", ['opaque_fixture_body_1234']);
    const log = new DurableCommandLog(f.sql, { namespace, webOrigin, authorizeBody: async (tx, input, scope) => {
      calls++; assert.equal(input.body.kind, 'blob');
      assert.deepEqual(scope, { namespace, commandId: scope.commandId, method: 'POST', path: '/api/knowledge/sources/upload' });
      const changed = await tx.execute("UPDATE synthetic_body SET bound=? WHERE ref=? AND state='active' AND bound IS NULL", [scope.commandId, (input.body as { ref: string }).ref]);
      if (changed.rowsAffected !== 1) throw new CommandLogError('synthetic_body_unavailable', 409);
      if (scope.commandId === 'rollback') throw new Error('Synthetic refusal after binding');
    } });
    const input = request('/api/knowledge/sources/upload'); input.body = { kind: 'blob', ref: 'opaque_fixture_body_1234', sha256: 'a'.repeat(64), bytes: 50 * 1024 * 1024 };
    await assert.rejects(log.enqueue({ id: 'rollback', namespace, request: input }));
    assert.equal((await f.sql.execute('SELECT bound FROM synthetic_body')).rows[0].bound, null);
    assert.equal(await log.readResult(namespace, 'rollback'), null);
    assert.equal((await log.enqueue({ id: 'accepted', namespace, request: input })).created, true);
    assert.equal((await f.sql.execute('SELECT bound FROM synthetic_body')).rows[0].bound, 'accepted');
    await f.sql.execute("UPDATE synthetic_body SET state='expired'");
    assert.equal((await log.enqueue({ id: 'accepted', namespace, request: input })).created, false);
    assert.equal(calls, 2);
    await assert.rejects(log.enqueue({ id: 'new-command', namespace, request: input }));
    assert.equal(await log.readResult(namespace, 'new-command'), null); assert.equal(calls, 3);
  } finally { await f.close(); }
});
