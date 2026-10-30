import '../../api/test/archive-network-deny.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Libsql from 'libsql';
import { adaptLibsqlDatabase, createLibsqlPrimaryFactory, withRemoteSavepoints, type SqlOperationGuard } from '../src/sql.ts';
import { withTransactionSelectReuse } from '../src/statement-reuse.ts';
import type { SqlDatabase, SqlStatement } from '../../api/src/sql-database.ts';

const records = 'SELECT data FROM records WHERE kind=? AND id=?';
const registry = 'SELECT * FROM auto_draft_ready_accounts WHERE account_id=?';
const ingress = 'SELECT * FROM google_ingress_meta WHERE account_id=?';
function fixture(path = ':memory:', guard?: SqlOperationGuard, decorate?: (port: SqlDatabase) => SqlDatabase) {
  const native = new Libsql(path);
  native.exec(`PRAGMA journal_mode=WAL; CREATE TABLE records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id));
    INSERT INTO records VALUES('fixture','a','one'),('fixture','b','two');
    CREATE TABLE auto_draft_ready_accounts(account_id TEXT PRIMARY KEY,facts TEXT);
    INSERT INTO auto_draft_ready_accounts VALUES('a','first'),('b','second');
    CREATE TABLE google_ingress_meta(account_id TEXT PRIMARY KEY,data TEXT);
    INSERT INTO google_ingress_meta VALUES('a','first'),('b','second');`);
  const preparations: string[] = [], operations: { kind: string; sql: string }[] = [], executions: { kind: string; sql: string }[] = [];
  const original = native.prepare.bind(native);
  native.prepare = ((sql: string) => {
    preparations.push(sql); const statement = original(sql);
    for (const method of ['get', 'all', 'run'] as const) {
      const call = statement[method].bind(statement);
      statement[method] = ((...values: unknown[]) => { executions.push({ kind: method, sql }); return Reflect.apply(call, undefined, values); }) as never;
    }
    return statement;
  }) as typeof native.prepare;
  const observe: SqlOperationGuard = operation => { operations.push(operation); guard?.(operation); };
  const base = adaptLibsqlDatabase(native, observe);
  const port = decorate ? decorate(base) : base;
  const db = withRemoteSavepoints(withTransactionSelectReuse(port, observe));
  return { db, native, preparations, operations, executions, prepared: (sql: string) => preparations.filter(value => value === sql).length };
}
const data = (statement: SqlStatement, id = 'a') => statement.get('fixture', id)?.data;

test('three exact active-transaction reads reuse description while bindings, rows and every guard remain fresh', () => {
  const f = fixture();
  try {
    f.db.exec('BEGIN');
    assert.equal(data(f.db.prepare(records)), 'one');
    assert.equal(data(f.db.prepare(records), 'b'), 'two');
    assert.equal(data(f.db.prepare(records), 'missing'), undefined);
    const row = f.db.prepare(records).get('fixture', 'a')!; row.data = 'caller-only';
    assert.equal(data(f.db.prepare(records)), 'one');
    assert.equal(f.db.prepare(registry).get('a')!.facts, 'first');
    assert.equal(f.db.prepare(registry).get('b')!.facts, 'second');
    assert.equal(f.db.prepare(ingress).get('a')!.data, 'first');
    assert.equal(f.db.prepare(ingress).get('b')!.data, 'second');
    assert.equal(f.prepared(records), 1); assert.equal(f.prepared(registry), 1); assert.equal(f.prepared(ingress), 1);
    assert.equal(f.operations.filter(x => x.kind === 'prepare' && x.sql === records).length, 5);
    assert.equal(f.operations.filter(x => x.kind === 'get' && x.sql === records).length, 5);
    assert.equal(f.executions.filter(x => x.kind === 'get' && x.sql === records).length, 5);
    f.db.exec('COMMIT');
  } finally { f.db.close(); }
});

test('autocommit, byte-different SQL and non-get methods remain uncached barriers', () => {
  const f = fixture();
  try {
    data(f.db.prepare(records)); data(f.db.prepare(records)); assert.equal(f.prepared(records), 2);
    f.db.exec('BEGIN'); data(f.db.prepare(records));
    const different = records + ' '; data(f.db.prepare(different)); data(f.db.prepare(different));
    assert.equal(f.prepared(different), 2); data(f.db.prepare(records)); assert.equal(f.prepared(records), 4);
    assert.equal(f.db.prepare(records).all('fixture', 'a').length, 1);
    data(f.db.prepare(records)); assert.equal(f.prepared(records), 5);
    f.db.prepare(records).run('fixture', 'a'); data(f.db.prepare(records)); assert.equal(f.prepared(records), 6);
    f.db.exec('ROLLBACK');
  } finally { f.db.close(); }
});

test('held facades reprepare across equal-boolean roots, nested/duplicate rollback, ordinary exec and schema barriers', () => {
  const f = fixture();
  try {
    const before = f.db.prepare(records);
    f.db.exec('SAVEPOINT root_a'); assert.equal(data(before), 'one');
    const held = f.db.prepare(records); assert.equal(data(held), 'one');
    f.db.exec('RELEASE root_a'); f.db.exec('SAVEPOINT root_b'); assert.equal(data(held), 'one');
    f.db.exec('SAVEPOINT child');
    f.db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run('changed', 'fixture', 'a');
    f.db.exec('SAVEPOINT duplicate'); f.db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run('older', 'fixture', 'a');
    f.db.exec('SAVEPOINT duplicate'); f.db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run('younger', 'fixture', 'a');
    assert.equal(data(held), 'younger'); f.db.exec('ROLLBACK TO duplicate'); assert.equal(data(held), 'older');
    f.db.exec('RELEASE duplicate'); f.db.exec('ROLLBACK TO duplicate'); assert.equal(data(held), 'changed');
    f.db.exec('RELEASE duplicate');
    assert.equal(data(held), 'changed'); f.db.exec('ROLLBACK TO child'); assert.equal(data(held), 'one');
    f.db.exec('RELEASE child'); f.db.exec('SELECT 1'); assert.equal(data(held), 'one');
    const columns = f.db.prepare(registry); assert.equal(columns.get('a')!.facts, 'first');
    f.db.exec("ALTER TABLE auto_draft_ready_accounts ADD COLUMN marker TEXT DEFAULT 'new'");
    assert.equal(columns.get('a')!.marker, 'new');
    f.db.exec("DROP TABLE auto_draft_ready_accounts; CREATE TABLE auto_draft_ready_accounts(account_id TEXT PRIMARY KEY,marker TEXT); INSERT INTO auto_draft_ready_accounts VALUES('a','recreated')");
    assert.deepEqual({ ...columns.get('a') }, { account_id: 'a', marker: 'recreated' });
    f.db.exec('ROLLBACK'); assert.equal(data(before), 'one'); assert(f.prepared(records) >= 7);
  } finally { f.db.close(); }
});

test('fresh clients see only committed data; external schema changes respect the original read snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rea-select-reuse-')), path = join(directory, 'fixture.sqlite');
  let f: ReturnType<typeof fixture> | undefined, writer: Libsql.Database | undefined;
  try {
    f = fixture(path); writer = new Libsql(path);
    f.db.exec('BEGIN'); const held = f.db.prepare(registry); assert.equal(held.get('a')!.facts, 'first');
    writer.exec("ALTER TABLE auto_draft_ready_accounts ADD COLUMN marker TEXT DEFAULT 'external'");
    assert.equal(held.get('a')!.marker, undefined);
    f.db.exec('COMMIT');
    // The unchanged pinned adapter also has this external-DDL column race.
    // A separate baseline/prototype reproduction and fresh reader bind it.
    assert.throws(() => held.get('a'), /Invalid SQL row/);
    const fresh = new Libsql(path);
    try { assert.equal((fresh.prepare(registry).get('a') as { marker?: unknown } | undefined)?.marker, 'external'); } finally { fresh.close(); }
    f.db.exec('BEGIN');
    // An unconsumed description must not become another facade's cached metadata.
    f.db.prepare(ingress); const consumed = f.db.prepare(ingress); assert.equal(f.prepared(ingress), 2);
    assert.equal(consumed.get('a')!.data, 'first'); f.db.prepare(ingress).get('a'); assert.equal(f.prepared(ingress), 2);
    f.db.exec('COMMIT');
    f.db.exec('BEGIN'); f.db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run('committed', 'fixture', 'a');
    assert.equal((writer.prepare(records).get('fixture', 'a') as { data?: unknown } | undefined)?.data, 'one');
    f.db.exec('COMMIT'); assert.equal((writer.prepare(records).get('fixture', 'a') as { data?: unknown } | undefined)?.data, 'committed');
    f.db.exec('BEGIN'); f.db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run('rolled-back', 'fixture', 'a');
    f.db.exec('ROLLBACK'); assert.equal((writer.prepare(records).get('fixture', 'a') as { data?: unknown } | undefined)?.data, 'committed');
  } finally { f?.db.close(); writer?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('cache-hit prepare and stale facade execution keep the owner fence; reprepare cannot bypass a later revocation', () => {
  const fence = new Int32Array(new SharedArrayBuffer(4)); Atomics.store(fence, 0, 1);
  const denied = new Error('Controlled owner revocation');
  const f = fixture(':memory:', operation => {
    if (Atomics.load(fence, 0) !== 1) throw denied;
  });
  try {
    f.db.exec('BEGIN'); const held = f.db.prepare(records); assert.equal(data(held), 'one');
    const before = f.prepared(records), reads = f.executions.filter(x => x.kind === 'get' && x.sql === records).length;
    Atomics.store(fence, 0, 0); assert.throws(() => f.db.prepare(records), error => error === denied); assert.equal(f.prepared(records), before);
    assert.throws(() => data(held), error => error === denied); assert.equal(f.prepared(records), before);
    assert.equal(f.executions.filter(x => x.kind === 'get' && x.sql === records).length, reads);
    Atomics.store(fence, 0, 1); assert.throws(() => data(held), /unavailable/);
  } finally { Atomics.store(fence, 0, 1); f.db.close(); }
  let revokeAfterPrepare = false;
  const next = fixture(':memory:', operation => {
    if (Atomics.load(fence, 0) !== 1) throw denied;
    if (revokeAfterPrepare && operation.kind === 'prepare' && operation.sql === records) Atomics.store(fence, 0, 0);
  });
  try {
    next.db.exec('BEGIN'); const held = next.db.prepare(records); data(held); next.db.exec('SELECT 1');
    const before = next.prepared(records), reads = next.executions.filter(x => x.kind === 'get' && x.sql === records).length;
    revokeAfterPrepare = true; assert.throws(() => data(held), error => error === denied);
    assert.equal(next.prepared(records), before + 1); assert.equal(next.executions.filter(x => x.kind === 'get' && x.sql === records).length, reads);
    Atomics.store(fence, 0, 1); assert.throws(() => data(held), /unavailable/);
  } finally { Atomics.store(fence, 0, 1); next.db.close(); }
});

test('noneligible repeated statements preserve baseline preparation count and their mutations invalidate hot reads', () => {
  const f = fixture(); const insert = 'INSERT INTO records VALUES(?,?,?)';
  try {
    f.db.exec('BEGIN'); const statement = f.db.prepare(insert);
    for (let i = 0; i < 3; i++) { statement.run('fixture', 'new-' + i, 'value-' + i); assert.equal(data(f.db.prepare(records), 'new-' + i), 'value-' + i); }
    assert.equal(f.prepared(insert), 1); assert.equal(f.prepared(records), 3);
    const held = f.db.prepare(records); assert.equal(data(held), 'one');
    assert.throws(() => f.db.prepare('SELECT missing_column FROM records'));
    const before = f.prepared(records); assert.equal(data(held), 'one'); assert.equal(f.prepared(records), before + 1);
    assert.throws(() => held.get('fixture', Number.NaN));
    const again = f.prepared(records); assert.equal(data(held), 'one'); assert.equal(f.prepared(records), again + 1);
    f.db.exec('ROLLBACK');
  } finally { f.db.close(); }
});

test('a busy cached handle is not shared by a reentrant guarded read', () => {
  let nested = false, invoke = false, inner: unknown, db: SqlDatabase;
  const f = fixture(':memory:', operation => {
    if (invoke && !nested && operation.kind === 'get' && operation.sql === records) {
      nested = true; inner = data(db.prepare(records), 'b');
    }
  }); db = f.db;
  try {
    db.exec('BEGIN'); data(db.prepare(records)); invoke = true;
    assert.equal(data(db.prepare(records)), 'one'); assert.equal(inner, 'two'); assert.equal(f.prepared(records), 2);
    db.exec('ROLLBACK');
  } finally { db.close(); }
});

test('an error after an issued mutation is propagated once; existing rollback and uncertain-commit poison stay authoritative', () => {
  const failure = new Error('Controlled issued response loss'); let issues = 0;
  const f = fixture(':memory:', undefined, base => ({ ...base,
    get isTransaction() { return base.isTransaction; },
    prepare(sql) { const statement = base.prepare(sql); return sql === 'INSERT INTO records VALUES(?,?,?)' ? { ...statement,
      run(...values) { issues++; statement.run(...values); throw failure; },
    } : statement; },
  }));
  try {
    f.db.exec('BEGIN'); const held = f.db.prepare(records); data(held);
    assert.throws(() => f.db.prepare('INSERT INTO records VALUES(?,?,?)').run('fixture', 'issued', 'once'), error => error === failure);
    assert.equal(issues, 1); assert.equal(data(f.db.prepare(records), 'issued'), 'once');
    f.db.exec('ROLLBACK'); assert.equal(data(held, 'issued'), undefined); assert.equal(issues, 1);
  } finally { f.db.close(); }
  let commits = 0, closes = 0;
  const p = fixture(':memory:', undefined, base => ({ ...base,
    get isTransaction() { return base.isTransaction; },
    exec(sql) { base.exec(sql); if (sql === 'COMMIT') { commits++; throw failure; } },
    close() { closes++; base.close(); },
  }));
  try {
    p.db.exec('SAVEPOINT root'); const held = p.db.prepare(records); data(held);
    assert.throws(() => p.db.exec('RELEASE root'), error => error === failure); assert.equal(commits, 1); assert.equal(closes, 1);
    assert.throws(() => data(held), /unavailable/); assert.throws(() => p.db.prepare(records), /unavailable/);
  } finally { p.db.close(); }
});

test('closed facades and malformed opt-in refuse; default factory remains an unactivated connection factory', () => {
  const f = fixture(); f.db.exec('BEGIN'); const held = f.db.prepare(records); data(held); f.db.close();
  const before = f.prepared(records); assert.throws(() => data(held)); assert.throws(() => f.db.prepare(records)); assert.equal(f.prepared(records), before);
  const configuration = { url: 'libsql://synthetic.turso.io', authToken: 'fictional-only' };
  assert.equal(typeof createLibsqlPrimaryFactory(configuration), 'function');
  assert.equal(typeof createLibsqlPrimaryFactory({ ...configuration, beforeOperation() {}, statementReuse: 'transaction-hot-select-v1' }), 'function');
  assert.throws(() => createLibsqlPrimaryFactory({ ...configuration, statementReuse: 'transaction-hot-select-v1' }));
  assert.throws(() => withTransactionSelectReuse({} as never, undefined as never));
  for (const value of ['', true, 'global', {}, null]) assert.throws(() => createLibsqlPrimaryFactory({ ...configuration, statementReuse: value } as never));
  assert.throws(() => createLibsqlPrimaryFactory({ ...configuration, cacheResults: true } as never));
});

test('factory freezes the validated opt-in against default-OFF to ON and ON to other/undefined caller mutation', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-test-module-mocks',
    fileURLToPath(new URL('./statement-reuse-factory-fixture.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, TZ: 'UTC' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.status, 'pass'); assert.equal(report.realNativeConstructors, 0); assert.equal(report.externalAttempts, 0);
  assert.deepEqual(report.cases.map((row: { nativePreparations: number }) => row.nativePreparations), [2, 1, 1]);
});
