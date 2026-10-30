import test from 'node:test';
import assert from 'node:assert/strict';
import { LibsqlError } from '@libsql/client/http';
import { ControlSqlError } from '../src/control-libsql.ts';
import { CoreStartupDiagnostic, reportWorkerFailure, safeWorkerErrorCode } from '../src/startup-diagnostic.ts';

const privateValue = 'synthetic-private-query-credential-content';
const identity = { namespace: 'namespace-neutral-fixture', actorId: '11111111-2222-4333-8444-555555555555', deploymentId: 'dpl_SyntheticThread', epoch: 3 };
function privateError(error: Error) {
  for (const key of ['message', 'stack', 'cause']) Object.defineProperty(error, key, { configurable: true, get() { assert.fail('Private error property was inspected: ' + key); } });
  return error;
}
function record(error: unknown) {
  const lines: string[] = []; reportWorkerFailure('pump', error, identity, undefined, line => lines.push(line));
  assert.equal(lines.length, 1); assert.equal(lines[0].includes(privateValue), false); const result = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(result).sort(), ['actorId', 'code', 'deploymentId', 'epoch', 'errorKind', 'event', 'namespace', 'phase'].sort());
  return result;
}

test('actual Control and SDK errors retain only fixed useful codes without reading their private fields', () => {
  for (const code of ['control_commit_uncertain', 'control_rollback_uncertain', 'control_result_invalid', 'control_closed',
    'control_transaction_closed', 'control_transaction_failed', 'control_nested_transaction_unsupported', 'control_close_during_transaction']) {
    const error = privateError(new ControlSqlError(code));
    assert.equal(safeWorkerErrorCode(error), code); assert.equal(record(error).errorKind, 'control'); assert.equal(record(error).code, code);
  }
  for (const code of ['STREAM_EXPIRED', 'TRANSACTION_CLOSED', 'HRANA_PROTO_ERROR', 'HRANA_CLOSED_ERROR', 'SERVER_ERROR', 'PROTOCOL_VERSION_ERROR']) {
    const error = privateError(new LibsqlError(privateValue, code));
    assert.equal(safeWorkerErrorCode(error), code); assert.equal(record(error).errorKind, 'libsql'); assert.equal(record(error).code, code);
  }
});

test('thread failures expose only the named fixed code and preserve namespace-neutral identity', () => {
  for (const code of ['core_thread_failure', 'core_thread_protocol_invalid', 'core_thread_exited', 'core_thread_authority_lost', 'core_thread_start_failed']) {
    const error = privateError(Object.assign(new Error(privateValue), { code, secret: privateValue, sql: privateValue }));
    assert.equal(safeWorkerErrorCode(error), code); const projected = record(error); assert.equal(projected.errorKind, 'thread');
    assert.equal(projected.namespace, identity.namespace); assert.equal(projected.actorId, identity.actorId); assert.equal(projected.code, code);
  }
});

test('the shared code projection rejects unknown, malformed, hostile and cause-only codes without expanding the inspection boundary', () => {
  const throwing = new Proxy({}, { get() { throw Error(privateValue); } });
  for (const value of [undefined, null, 'STREAM_EXPIRED', new Error(privateValue), throwing, { code: privateValue }, { code: 'stream_expired' },
    { code: new String('STREAM_EXPIRED') }, { code: ['STREAM_EXPIRED'] }, { code: 'STREAM_EXPIRED\n' }, { cause: { code: 'STREAM_EXPIRED' } }]) {
    assert.equal(safeWorkerErrorCode(value), undefined);
    const lines: string[] = []; assert.doesNotThrow(() => reportWorkerFailure('pump', value, identity, undefined, line => lines.push(line)));
    assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).code, undefined); assert.equal(lines[0].includes(privateValue), false);
  }
  let reads = 0; const error = Object.defineProperty({}, 'code', { get() { reads++; return 'STREAM_EXPIRED'; } });
  assert.equal(safeWorkerErrorCode(error), 'STREAM_EXPIRED'); assert.equal(reads, 1);
});

test('existing SQLite and actor classifications remain exact and logger failure cannot affect a caller', () => {
  assert.equal(record(Object.assign(Error(), { code: 'SQLITE_BUSY' })).errorKind, 'sqlite');
  assert.equal(record(Object.assign(Error(), { code: 'actor_authority_lost' })).errorKind, 'actor');
  assert.doesNotThrow(() => reportWorkerFailure('pump', new ControlSqlError('control_commit_uncertain'), identity, undefined, () => { throw Error(privateValue); }));
});

test('child SQL fingerprints preserve the original hash and parent ordinal while malformed/private extras never escape', () => {
  const trace = new CoreStartupDiagnostic(), sha256 = 'a'.repeat(64);
  trace.observeSqlFingerprint({ kind: 'run', sha256 }); assert.deepEqual(trace.snapshot(), {});
  trace.begin(); trace.observeStage('app-construction');
  const fingerprint = { kind: 'run', sha256, ordinal: 999 };
  for (const key of ['sql', 'parameters', 'message']) Object.defineProperty(fingerprint, key, { get() { assert.fail('Private fingerprint property was inspected'); } });
  trace.observeSqlFingerprint(fingerprint); assert.deepEqual(trace.snapshot().lastSql, { ordinal: 1, kind: 'run', sha256 });
  const invalid = [null, undefined, [], 'run', { kind: 'execute', sha256 }, { kind: 'run', sha256: sha256.toUpperCase() },
    { kind: 'run', sha256: 'a'.repeat(63) }, { kind: 'run', sha256: privateValue }, new Proxy({}, { get() { throw Error(privateValue); } })];
  for (const value of invalid) trace.observeSqlFingerprint(value);
  assert.deepEqual(trace.snapshot().lastSql, { ordinal: 1, kind: 'run', sha256 });
  trace.observeSqlFingerprint({ kind: 'all', sha256: 'b'.repeat(64) }); assert.equal(trace.snapshot().lastSql!.ordinal, 2);
  const lines: string[] = []; reportWorkerFailure('create-core', Error(privateValue), identity, trace, line => lines.push(line));
  assert.equal(lines[0].includes(privateValue), false); assert.deepEqual(JSON.parse(lines[0]).lastSql, { ordinal: 2, kind: 'all', sha256: 'b'.repeat(64) });
  trace.clear(); trace.observeSqlFingerprint({ kind: 'run', sha256 }); assert.deepEqual(trace.snapshot(), {});
});
