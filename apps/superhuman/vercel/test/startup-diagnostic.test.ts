import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Libsql from 'libsql';
import { CoreStartupDiagnostic, reportWorkerFailure, type CoreStartupStage } from '../src/startup-diagnostic.ts';
import { MailWorkerRuntime } from '../src/worker.ts';
import { LoopbackCoreAdapter } from '../src/core-adapter.ts';
import { adaptLibsqlDatabase } from '../src/sql.ts';
import { NativeControl } from './control-sql-fixture.ts';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import type { ActorContext } from '../src/actor.ts';

const originalFetch = globalThis.fetch; let escaped = 0;
globalThis.fetch = async () => { escaped++; throw new Error('Startup diagnostics prohibit external fetch'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(escaped, 0); });
const identity = { namespace: 'synthetic-startup', actorId: '11111111-2222-4333-8444-555555555555', deploymentId: 'dpl_SyntheticBoot', epoch: 7 };
const secret = 'synthetic-private-message-token';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('failure projection emits one fixed record and never reads private error fields or outputs SQL/parameters', () => {
  const trace = new CoreStartupDiagnostic(); trace.begin(); trace.observeStage('app-construction');
  trace.observeSql({ kind: 'prepare', sql: `SELECT '${secret}'` }); trace.observeSql({ kind: 'get', sql: `SELECT '${secret}'` });
  const error = new Error(); Object.defineProperty(error, 'code', { value: 'SQLITE_ERROR' });
  for (const name of ['message', 'stack', 'cause']) Object.defineProperty(error, name, { get() { assert.fail(`Must not read ${name}`); } });
  const lines: string[] = []; reportWorkerFailure('create-core', error, identity, trace, line => lines.push(line));
  assert.equal(lines.length, 1); assert.ok(lines[0].length < 1024); assert.equal(lines[0].includes(secret), false);
  assert.deepEqual(JSON.parse(lines[0]), { event: 'mail_worker_failure', phase: 'create-core', errorKind: 'sqlite', ...identity, code: 'SQLITE_ERROR',
    coreStage: 'app-construction', lastSql: { ordinal: 2, kind: 'get', sha256: hash(`SELECT '${secret}'`) } });
});

test('tracking only covers active construction and clearing prevents later SQL fingerprints', () => {
  const trace = new CoreStartupDiagnostic(); trace.observeSql({ kind: 'get', sql: secret }); assert.deepEqual(trace.snapshot(), {});
  trace.begin(); trace.observeStage('tracking-config'); trace.observeSql({ kind: 'prepare', sql: 'PRAGMA journal_mode' });
  assert.equal(trace.snapshot().lastSql!.ordinal, 1); trace.clear(); trace.observeStage('app-construction'); trace.observeSql({ kind: 'get', sql: secret });
  const lines: string[] = []; reportWorkerFailure('heartbeat', Error(secret), identity, trace, line => lines.push(line));
  const record = JSON.parse(lines[0]); assert.equal(record.coreStage, undefined); assert.equal(record.lastSql, undefined);
  trace.begin(); trace.observeSql({ kind: 'get', sql: 'SELECT 1' }); assert.equal(trace.snapshot().lastSql!.ordinal, 1);
});

test('invalid identity/code fields and forged descriptor extras cannot escape the fixed projection', () => {
  const trace = new CoreStartupDiagnostic(); trace.begin(); trace.observeSql({ kind: 'exec', sql: 'CREATE TABLE fictional(id)' });
  const snapshot = trace.snapshot();
  trace.snapshot = () => ({ ...snapshot, lastSql: { ...snapshot.lastSql!, rawSql: secret, params: [secret] } });
  const lines: string[] = [];
  reportWorkerFailure('create-core', { code: secret, message: secret, cause: secret }, { namespace: 'bad\nnamespace', actorId: secret, deploymentId: secret, epoch: -1 }, trace, line => lines.push(line));
  const record = JSON.parse(lines[0]); assert.equal(lines[0].includes(secret), false); assert.deepEqual(Object.keys(record.lastSql).sort(), ['kind', 'ordinal', 'sha256']);
  for (const field of ['namespace', 'actorId', 'deploymentId', 'epoch', 'code']) assert.equal(record[field], undefined);
});

test('throwing loggers and hostile error getters cannot change the caller error path', () => {
  const error = new Proxy({}, { get() { throw Error(secret); } });
  assert.doesNotThrow(() => reportWorkerFailure('acquire', error, identity, undefined, () => { throw Error(secret); }));
  let emitted = 0; reportWorkerFailure('acquire', error, identity, undefined, line => { emitted++; assert.equal(line.includes(secret), false); }); assert.equal(emitted, 1);
});

test('actual worker construction failure logs its acquired epoch once and preserves uncertain ownership even if the logger throws', async () => {
  for (const loggerThrows of [false, true]) {
    const databasePath = ':memory:', sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath });
    const authority = new ActorAuthority(sql, { namespace: identity.namespace });
    const log = new DurableCommandLog(sql, { namespace: identity.namespace, webOrigin: 'https://mail.example.test' });
    const trace = new CoreStartupDiagnostic(), refusal = Object.assign(new Error(secret), { code: 'SQLITE_ERROR' }), lines: string[] = [];
    try {
      const runtime = await MailWorkerRuntime.start({ authority, log, actorId: identity.actorId, deploymentId: identity.deploymentId,
        healthHost: '127.0.0.1', healthPort: 0, startupDiagnostic: trace,
        failureLogger(line) { lines.push(line); if (loggerThrows) throw Error('Synthetic logger refusal'); },
        createCore() { trace.begin(); trace.observeStage('app-construction'); trace.observeSql({ kind: 'exec', sql: 'CREATE TABLE fictional(id)' }); throw refusal; } });
      await assert.rejects(runtime.completion, error => error === refusal);
      assert.equal((await authority.current())!.state, 'uncertain'); assert.equal(lines.length, 1);
      const record = JSON.parse(lines[0]); assert.equal(record.phase, 'create-core'); assert.equal(record.epoch, 1); assert.equal(record.coreStage, 'app-construction');
      assert.equal(record.actorId, identity.actorId); assert.equal(record.lastSql.sha256, hash('CREATE TABLE fictional(id)')); assert.equal(lines[0].includes(secret), false);
    } finally { await sql.close(); }
  }
});

test('the actual worker clears constructor diagnostics after successful Core construction and preserves clean shutdown', async () => {
  const databasePath = ':memory:', sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath });
  const authority = new ActorAuthority(sql, { namespace: identity.namespace }), trace = new CoreStartupDiagnostic(), lines: string[] = [];
  const log = new DurableCommandLog(sql, { namespace: identity.namespace, webOrigin: 'https://mail.example.test' });
  let runtime: MailWorkerRuntime | undefined;
  try {
    runtime = await MailWorkerRuntime.start({ authority, log, actorId: identity.actorId, deploymentId: identity.deploymentId,
      healthHost: '127.0.0.1', healthPort: 0, startupDiagnostic: trace, failureLogger: line => lines.push(line),
      createCore() { trace.begin(); trace.observeStage('app-construction'); trace.observeSql({ kind: 'exec', sql: 'CREATE TABLE fictional(id)' });
        return { async dispatch() { return { status: 200, headers: {}, body: { kind: 'inline', base64: '' } }; }, async quiesce() {}, async close() {} }; } });
    for (let count = 0; count < 100 && !runtime.ownsCore; count++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(runtime.ownsCore, true); assert.deepEqual(trace.snapshot(), {});
    trace.observeSql({ kind: 'get', sql: secret }); assert.deepEqual(trace.snapshot(), {});
    await runtime.stop(); assert.equal((await authority.current())!.state, 'quiesced'); assert.deepEqual(lines, []);
  } finally { await runtime?.stop(); await sql.close(); }
});

function coreOptions(databasePath: string, stages: CoreStartupStage[]) {
  const context: ActorContext = { lease: { namespace: identity.namespace, actorId: identity.actorId, epoch: 1 }, assertLocal() {}, runNative: async operation => operation() };
  return { context, namespace: identity.namespace, databasePath, env: { DATABASE_PATH: databasePath, WEB_ORIGIN: 'https://mail.example.test', TOKEN_ENCRYPTION_KEY: '51'.repeat(32) },
    databaseFactory: (path: string) => { assert.equal(path, databasePath); return adaptLibsqlDatabase(new Libsql(path)); },
    bodies: { async readRequestBody(): Promise<Buffer> { throw Error('No body expected'); }, async writeResponseBody(): Promise<never> { throw Error('No body expected'); } },
    onStartupStage(stage: CoreStartupStage) { stages.push(stage); }, overrides: { runJobs: false, providerDraftAutomatic: false } };
}

test('actual Core adapter reports ordered construction stages and observer exceptions do not prevent startup/close', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rea-startup-stage-')), databasePath = join(directory, 'mail.sqlite'), stages: CoreStartupStage[] = [];
  try {
    const options = coreOptions(databasePath, stages), observe = options.onStartupStage;
    const core = await LoopbackCoreAdapter.create({ ...options, onStartupStage(stage) { observe(stage); throw Error(secret); } });
    try { assert.deepEqual(stages, ['tracking-config', 'auto-draft-config', 'app-construction', 'loopback-listen']); assert.equal(core.app.store.list('account').length, 1); }
    finally { await core.quiesce(); await core.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('configuration and factory failures preserve the last actual stage and never manufacture a later construction step', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rea-startup-boundary-'));
  try {
    for (const failure of ['tracking', 'automatic', 'factory']) {
      const stages: CoreStartupStage[] = [], options = coreOptions(join(directory, `${failure}.sqlite`), stages); let opened = 0;
      const env = failure === 'tracking' ? { ...options.env, TRACKING_PUBLIC_ORIGIN: 'https://collector.example.test' } : failure === 'automatic' ? { ...options.env, AUTO_DRAFTS_PERSISTENCE: 'bad' } : options.env;
      await assert.rejects(LoopbackCoreAdapter.create({ ...options, env, databaseFactory() { opened++; throw Error(secret); } }));
      assert.deepEqual(stages, failure === 'tracking' ? ['tracking-config'] : failure === 'automatic' ? ['tracking-config', 'auto-draft-config'] : ['tracking-config', 'auto-draft-config', 'app-construction']);
      assert.equal(opened, failure === 'factory' ? 1 : 0);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
