import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Worker } from 'node:worker_threads';
import { ThreadedCoreAdapter } from '../src/core-thread.ts';
import { ActorAuthority, ActorAuthorityError } from '../src/authority.ts';
import { DurableCommandLog, type CommandRequest } from '../src/command-log.ts';
import { DurableCoreActor, type ActorContext } from '../src/actor.ts';
import { NativeControl } from './control-sql-fixture.ts';
const denial = (globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
assert(denial, 'External denial preload is mandatory before the source graph');
after(() => assert.equal(denial.attempts, 0));
const namespace = 'synthetic-thread', webOrigin = 'https://thread.example.test';
const workerURL = new URL('./core-thread-fixture.ts', import.meta.url);
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>) { const end = Date.now() + 5000; while (Date.now() < end) { if (await predicate()) return; await sleep(5); } assert.fail('Bounded child condition did not settle'); }
const request = (path = '/api/fixture/native'): CommandRequest => ({ method: 'POST', path, headers: { origin: webOrigin }, body: { kind: 'inline', base64: '' } });
function fixture(mode = 'normal', exitDelay = false) {
  const directory = mkdtempSync(join(tmpdir(), 'rea-core-thread-')), databasePath = join(directory, 'effects.sqlite');
  const configuration = { namespace, databaseUrl: databasePath, authToken: 'synthetic-only', journalMode: 'verify-managed-wal' as const, env: { DATABASE_PATH: databasePath, TEST_DIRECTORY: directory, TEST_MODE: mode, TEST_EXIT_DELAY: String(exitDelay) } };
  const effects = () => { if (!existsSync(databasePath)) return []; const db = new DatabaseSync(databasePath, { readOnly: true }); try { return db.prepare('SELECT kind FROM effects ORDER BY rowid').all().map(r => String(r.kind)); } finally { db.close(); } };
  return { directory, configuration, effects, release() { writeFileSync(join(directory, 'release'), 'synthetic'); }, cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}
function parentContext(gate: Promise<void> = Promise.resolve()) {
  let active = 0, registered = 0, revoked = false; const granted = deferred(); const tasks = new Set<Promise<unknown>>();
  const context: ActorContext = { lease: { namespace, epoch: 1, actorId: 'synthetic-owner' }, assertLocal() { if (revoked) throw new ActorAuthorityError(); }, runNative<T>(operation: () => Promise<T>) {
    registered++; active++;
    const work = (async () => { try { await gate; context.assertLocal(); const result = operation(); granted.resolve(); return await result; } finally { active--; } })(); tasks.add(work); void work.finally(() => tasks.delete(work)).catch(() => {}); return work;
  } };
  return { context, granted, get active() { return active; }, get registered() { return registered; }, revoke() { revoked = true; }, async idle() { while (tasks.size) await Promise.allSettled([...tasks]); } };
}
const noBodies = { async readRequestBody(): Promise<Buffer> { assert.fail('Unselected Blob read'); }, async writeResponseBody(): Promise<never> { assert.fail('Unselected Blob write'); } };
const actualWorker = (core: ThreadedCoreAdapter) => (core as unknown as { worker: Worker }).worker;

test('child native effects wait for parent authority and remain tracked until actual operation completion', async () => {
  const f = fixture(), gate = deferred(), parent = parentContext(gate.promise); let core: ThreadedCoreAdapter | undefined;
  try {
    core = await ThreadedCoreAdapter.create({ context: parent.context, configuration: f.configuration, bodies: noBodies, workerURL });
    const pending = core.dispatch(request(), { id: 'one', sequence: 1 });
    await until(() => parent.registered === 1); assert.deepEqual(f.effects(), []); assert.equal(parent.active, 1);
    gate.resolve(); await until(() => f.effects().includes('native-start')); assert.equal(parent.active, 1); assert(!f.effects().includes('native-finish'));
    f.release(); assert.equal((await pending).status, 200); await parent.idle(); assert.equal(parent.active, 0); assert.deepEqual(f.effects(), ['native-start', 'native-finish']); await core.close();
  } finally { gate.resolve(); f.release(); if (core) await core.close().catch(() => {}); await parent.idle(); f.cleanup(); }
});

test('revocation while a granted permit is queued behind child work prevents its SQL/native effect', async () => {
  const f = fixture('blocked-after-begin'), gate = deferred(), parent = parentContext(gate.promise); let core: ThreadedCoreAdapter | undefined;
  try {
    core = await ThreadedCoreAdapter.create({ context: parent.context, configuration: f.configuration, bodies: noBodies, workerURL });
    const exited = new Promise<void>(done => actualWorker(core!).once('exit', () => done()));
    const pending = core.dispatch(request(), { id: 'revoked', sequence: 1 }); void pending.catch(() => {});
    await until(() => existsSync(join(f.directory, 'child-blocked')) && parent.registered === 1); gate.resolve(); await parent.granted.promise;
    core.revokeAuthority(); await assert.rejects(pending); await exited; await parent.idle(); assert.deepEqual(f.effects(), []); assert.equal(parent.active, 0); await assert.rejects(core.close());
  } finally { gate.resolve(); writeFileSync(join(f.directory, 'unblock'), 'synthetic'); core?.revokeAuthority(); await parent.idle(); f.cleanup(); }
});

test('binary Blob bytes cross only live native grants and preserve the exact scoped response', async () => {
  const f = fixture(), parent = parentContext(), bytes = Buffer.alloc(10 * 1024 ** 2); for (let i = 0; i < bytes.length; i++) bytes[i] = [0, 255, 1, 128, 10, 0][i % 6]!; const hash = createHash('sha256').update(bytes).digest('hex'); let core: ThreadedCoreAdapter | undefined, reads = 0, writes = 0;
  const blob = { kind: 'blob' as const, ref: 'fictional-ref-aaaaaaaaaaaa', bytes: bytes.length, sha256: hash };
  try {
    core = await ThreadedCoreAdapter.create({ context: parent.context, configuration: f.configuration, workerURL, bodies: {
      async readRequestBody(input, scope) { reads++; assert.equal(parent.active, 1); assert.deepEqual(input, blob); assert.deepEqual(scope, { namespace, commandId: 'binary', method: 'POST', path: '/api/fixture/body' }); return bytes; },
      async writeResponseBody(scope, input) { writes++; assert.equal(parent.active, 1); assert.deepEqual(scope, { namespace, commandId: 'binary', method: 'POST', path: '/api/fixture/body' }); assert.deepEqual(input, bytes); assert.equal(createHash('sha256').update(input).digest('hex'), hash); return { ...blob, ref: 'fictional-output-aaaaaaaaaa' }; },
    } });
    const refused = await core.dispatch(request('/api/fixture/body-without-native'), { id: 'ungranted', sequence: 1 }); assert.equal(Buffer.from((refused.body as { base64: string }).base64, 'base64').toString(), 'refused-without-live-native'); assert.equal(reads, 0); assert.equal(parent.registered, 0);
    const result = await core.dispatch({ ...request('/api/fixture/body'), body: blob }, { id: 'binary', sequence: 2 }); assert.deepEqual(result.body, { ...blob, ref: 'fictional-output-aaaaaaaaaa' }); assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(parent.registered, 2); assert.equal(bytes.byteLength, 10 * 1024 ** 2); assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); await parent.idle(); await core.close();
  } finally { core?.revokeAuthority(); await parent.idle(); f.cleanup(); }
});

test('throwing startup diagnostics are contained across a real worker', async () => {
  const f = fixture(), parent = parentContext(); let core: ThreadedCoreAdapter | undefined, stage = 0, sql = 0;
  try { core = await ThreadedCoreAdapter.create({ context: parent.context, configuration: f.configuration, bodies: noBodies, workerURL, onStartupStage() { stage++; throw Error('diagnostic-only'); }, onStartupSqlFingerprint() { sql++; throw Error('diagnostic-only'); } }); assert(stage > 0 && sql > 0); await core.close(); }
  finally { core?.revokeAuthority(); await parent.idle(); f.cleanup(); }
});

test('unexpected clean exit, crash, wrong response, duplicate native ID and ungranted body all fail closed', async () => {
  for (const mode of ['exit-zero', 'crash', 'bad-response', 'duplicate-native', 'bad-body']) {
    const f = fixture(mode), parent = parentContext(); let core: ThreadedCoreAdapter | undefined;
    try { core = await ThreadedCoreAdapter.create({ context: parent.context, configuration: f.configuration, bodies: noBodies, workerURL }); const exited = new Promise<void>(done => actualWorker(core!).once('exit', () => done())); const failure = assert.rejects(core.failure); await assert.rejects(core.dispatch(request(), { id: 'failed', sequence: 1 })); await failure; await exited; await assert.rejects(core.close()); await parent.idle(); assert.deepEqual(f.effects(), [], mode); }
    finally { core?.revokeAuthority(); await parent.idle(); f.cleanup(); }
  }
});

test('Actor handoff waits for held native completion, close ACK and observed child exit', async () => {
  const f = fixture('normal', true), controlPath = join(f.directory, 'control.sqlite'), sql = new NativeControl(controlPath, { DATABASE_PATH: controlPath }), authority = new ActorAuthority(sql, { namespace }), log = new DurableCommandLog(sql, { namespace, webOrigin }); let actor: DurableCoreActor | undefined, core: ThreadedCoreAdapter | undefined;
  try {
    actor = await DurableCoreActor.start({ authority, log, actorId: 'actor-one', deploymentId: 'deployment-one', createCore: async context => core = await ThreadedCoreAdapter.create({ context, configuration: f.configuration, bodies: noBodies, workerURL }) });
    await log.enqueue({ id: 'native', namespace, request: request() }); await actor.pumpOnce(); await until(() => f.effects().includes('native-start')); assert.equal(actor.activeNative, 1);
    let complete = false; const closing = actor.close().then(() => { complete = true; }); await until(async () => (await authority.current())?.state === 'draining'); assert.equal(complete, false); assert.equal((await authority.acquire('other', 'deployment-two')).acquired, false);
    f.release(); await until(() => existsSync(join(f.directory, 'close-returned'))); assert.equal(complete, false); assert.equal((await authority.current())?.state, 'draining'); writeFileSync(join(f.directory, 'exit-release'), 'synthetic');
    await closing; assert(existsSync(join(f.directory, 'exit-timer-fired'))); assert.equal((await authority.current())?.state, 'quiesced'); assert.equal((await log.readResult(namespace, 'native'))?.state, 'completed'); assert.deepEqual(f.effects(), ['native-start', 'native-finish', 'closed']);
    assert.equal((await log.enqueue({ id: 'native', namespace, request: request() })).created, false); assert.equal(await actor.pumpOnce(), 0);
  } finally { f.release(); core?.revokeAuthority(); await actor?.close().catch(() => {}); await sql.close(); f.cleanup(); }
});

test('crashed child native work remains uncertain and the same accepted key cannot execute again', async () => {
  const f = fixture('native-crash'), controlPath = join(f.directory, 'control.sqlite'), sql = new NativeControl(controlPath, { DATABASE_PATH: controlPath }), authority = new ActorAuthority(sql, { namespace }), log = new DurableCommandLog(sql, { namespace, webOrigin }); let actor: DurableCoreActor | undefined, core: ThreadedCoreAdapter | undefined;
  try {
    actor = await DurableCoreActor.start({ authority, log, actorId: 'crash-owner', deploymentId: 'deployment-one', createCore: async context => core = await ThreadedCoreAdapter.create({ context, configuration: f.configuration, bodies: noBodies, workerURL }) });
    const exited = new Promise<void>(done => actualWorker(core!).once('exit', () => done()));
    await log.enqueue({ id: 'issued-once', namespace, request: request() }); await actor.pumpOnce(); await exited; await actor.settleUncertain();
    assert.equal(actor.state, 'uncertain'); assert.equal((await log.readResult(namespace, 'issued-once'))?.state, 'uncertain'); assert.deepEqual(f.effects(), ['native-start']);
    assert.equal((await log.enqueue({ id: 'issued-once', namespace, request: request() })).created, false); assert.equal(await actor.pumpOnce(), 0); assert.deepEqual(f.effects(), ['native-start']);
    await authority.markUncertain(actor.context.lease); assert.equal((await authority.acquire('next', 'deployment-two')).acquired, false); await assert.rejects(actor.close());
  } finally { core?.revokeAuthority(); await actor?.settleUncertain(); await sql.close(); f.cleanup(); }
});
