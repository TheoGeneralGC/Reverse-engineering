import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Libsql from 'libsql';
import { adaptLibsqlDatabase, withRemoteSavepoints } from '../src/sql.ts';
import type { SqlDatabase, SqlValue } from '../../api/src/sql-database.ts';

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('Savepoint controls prohibit external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });

function fixture(kind: 'native' | 'shim', work: (db: SqlDatabase, reader: DatabaseSync) => void) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'rea-savepoints-')), path = join(directory, 'mail.sqlite');
  const db: SqlDatabase = kind === 'native' ? new DatabaseSync(path) : withRemoteSavepoints(adaptLibsqlDatabase(new Libsql(path)));
  let reader: DatabaseSync | undefined;
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE fixture(id INTEGER PRIMARY KEY,value TEXT UNIQUE);');
    reader = new DatabaseSync(path, { readOnly: true }); work(db, reader);
  } finally { db.close(); reader?.close(); rmSync(directory, { recursive: true, force: true }); }
}
function both(work: (db: SqlDatabase, reader: DatabaseSync) => void) { for (const kind of ['native', 'shim'] as const) fixture(kind, work); }
const ids = (db: SqlDatabase) => db.prepare('SELECT id FROM fixture ORDER BY id').all().map(row => Number(row.id));
function instrument(backing: SqlDatabase, options: { fail?: (sql: string) => Error | undefined; transaction?: () => boolean } = {}) {
  const executions: string[] = [], preparations: string[] = []; let closes = 0;
  const db: SqlDatabase = {
    get isTransaction() { return options.transaction ? options.transaction() : backing.isTransaction; },
    exec(sql) { executions.push(sql); const error = options.fail?.(sql); if (error) throw error; backing.exec(sql); },
    prepare(sql) { preparations.push(sql); return backing.prepare(sql); },
    close() { closes++; backing.close(); },
  };
  return { db, executions, preparations, closes: () => closes };
}

test('standalone savepoint has native deferred isolation and root release commits younger savepoints', () => both((db, reader) => {
  const insert = db.prepare('INSERT INTO fixture VALUES(?,?)');
  db.exec('SAVEPOINT root'); assert.equal(db.isTransaction, true);
  insert.run(1, 'outer'); assert.deepEqual(reader.prepare('SELECT id FROM fixture').all(), []);
  db.exec('SAVEPOINT child'); insert.run(2, 'inner'); db.exec('RELEASE root');
  assert.equal(db.isTransaction, false); assert.deepEqual(ids(db), [1, 2]);
  assert.deepEqual(reader.prepare('SELECT id FROM fixture ORDER BY id').all().map(row => row.id), [1, 2]);
}));

test('duplicate savepoint names select the nearest match and rollback-to preserves the root', () => both(db => {
  const put = (id: number) => db.prepare('INSERT INTO fixture VALUES(?,?)').run(id, String(id));
  db.exec('SAVEPOINT Root'); put(1); db.exec('SAVEPOINT duplicate'); put(2);
  db.exec('SAVEPOINT duplicate'); put(3); db.exec('SAVEPOINT younger'); put(4);
  db.exec('ROLLBACK TRANSACTION TO SAVEPOINT duplicate'); assert.deepEqual(ids(db), [1, 2]);
  db.exec('RELEASE SAVEPOINT duplicate'); assert.equal(db.isTransaction, true);
  db.exec('ROLLBACK TO duplicate'); assert.deepEqual(ids(db), [1]); db.exec('RELEASE duplicate');
  db.exec('ROLLBACK TO ROOT'); assert.deepEqual(ids(db), []); assert.equal(db.isTransaction, true);
  put(5); db.exec('RELEASE root'); assert.equal(db.isTransaction, false); assert.deepEqual(ids(db), [5]);
}));

test('prepared-before-BEGIN and prepared-inside prior transaction remain usable across transaction boundaries', () => both(db => {
  const before = db.prepare('INSERT INTO fixture VALUES(?,?)');
  db.exec('BEGIN IMMEDIATE'); before.run(1, 'explicit');
  const inside = db.prepare('INSERT INTO fixture VALUES(?,?)'); inside.run(2, 'inside');
  db.exec('COMMIT'); before.run(3, 'outside');
  db.exec('SAVEPOINT a'); before.run(4, 'root-a'); inside.run(5, 'reused-a'); db.exec('RELEASE a');
  db.exec('SAVEPOINT b'); inside.run(6, 'reused-b'); db.exec('ROLLBACK');
  assert.equal(db.isTransaction, false); assert.deepEqual(ids(db), [1, 2, 3, 4, 5]);
  inside.run(7, 'finally-outside'); assert.deepEqual(ids(db), [1, 2, 3, 4, 5, 7]);
}));

test('explicit BEGIN retains its transaction boundary and a constraint error does not commit prior writes', () => both((db, reader) => {
  db.exec('BEGIN DEFERRED'); db.exec('SAVEPOINT nested');
  db.prepare('INSERT INTO fixture VALUES(?,?)').run(1, 'same');
  assert.throws(() => db.prepare('INSERT INTO fixture VALUES(?,?)').run(2, 'same'), /UNIQUE/);
  assert.equal(db.isTransaction, true); db.exec('RELEASE nested'); assert.equal(db.isTransaction, true);
  assert.deepEqual(reader.prepare('SELECT id FROM fixture').all(), []);
  assert.throws(() => db.exec('BEGIN'), /transaction/); db.exec('ROLLBACK'); assert.deepEqual(ids(db), []);
  db.exec('SAVEPOINT root'); db.prepare('INSERT INTO fixture VALUES(1,?)').run('committed'); db.exec('END TRANSACTION');
  assert.equal(db.isTransaction, false); assert.deepEqual(ids(db), [1]);
}));

test('implicit rollback through mutations and RETURNING queries clears synthetic savepoints without replay', () => both(db => {
  for (const method of ['run', 'get', 'all'] as const) {
    db.exec('SAVEPOINT abandoned'); db.prepare('INSERT INTO fixture VALUES(1,?)').run('collision');
    const statement = db.prepare('INSERT OR ROLLBACK INTO fixture VALUES(1,?) RETURNING id');
    assert.throws(() => statement[method]('collision'), /UNIQUE/);
    assert.equal(db.isTransaction, false); assert.deepEqual(ids(db), []);
    db.exec('SAVEPOINT next'); db.prepare('INSERT INTO fixture VALUES(2,?)').run(method); db.exec('RELEASE next');
    assert.deepEqual(ids(db), [2]); db.prepare('DELETE FROM fixture').run();
  }
}));

test('ordinary scripts preserve strings, comments and trigger bytes; supported control comments do not change names', () => {
  const native = new DatabaseSync(':memory:'), port = instrument(native), db = withRemoteSavepoints(port.db);
  try {
    const script = "CREATE TABLE fixture(id INTEGER); CREATE TRIGGER control_words AFTER INSERT ON fixture BEGIN SELECT 'SAVEPOINT root; RELEASE root'; END; INSERT INTO fixture VALUES(1); -- ROLLBACK";
    db.exec(script); assert.equal(port.executions[0], script);
    const literal = "/* SAVEPOINT hidden */ SELECT 'COMMIT', '; ROLLBACK';"; db.exec(literal); assert.equal(port.executions.at(-1), literal);
    db.exec('-- comment\n SAVEPOINT visible; /* between */ SAVEPOINT child; ROLLBACK TO child; RELEASE child; RELEASE visible;');
    assert.equal(db.isTransaction, false); assert.equal(db.prepare('SELECT count(*) AS n FROM fixture').get()!.n, 1);
  } finally { db.close(); }
});

function schemaBatch(file: string) {
  const source = readFileSync(new URL('../../api/src/' + file, import.meta.url), 'utf8');
  const match = /\.exec\(`((?:SAVEPOINT|BEGIN IMMEDIATE)[\s\S]*?)`\);/.exec(source);
  assert.ok(match, 'Known exact Core schema batch remains discoverable'); return match[1];
}
test('only the two exact complete Core schema batches pass byte-for-byte and their changed/prepare forms refuse before writes', () => {
  for (const file of ['tracking-delivery.ts', 'ai-chat-store.ts']) {
    const native = new DatabaseSync(':memory:'), port = instrument(native), db = withRemoteSavepoints(port.db), script = schemaBatch(file);
    try {
      db.exec(script); assert.equal(port.executions[0], script); assert.equal(db.isTransaction, false);
      const before = port.executions.length, prepares = port.preparations.length;
      assert.throws(() => db.exec(script + '\n'), /complete supported/);
      assert.throws(() => db.prepare(script), /complete supported/);
      assert.equal(port.executions.length, before); assert.equal(port.preparations.length, prepares);
    } finally { db.close(); }
  }
});

test('unsupported control scripts and prepared controls are refused before any prefix can mutate', () => {
  const native = new DatabaseSync(':memory:'), port = instrument(native), db = withRemoteSavepoints(port.db);
  try {
    for (const sql of ['SAVEPOINT root; CREATE TABLE refused(id INTEGER); RELEASE root;', 'BEGIN; INSERT INTO absent VALUES(1);',
      'SAVEPOINT "quoted"', 'SAVEPOINT root; RELEASE "root"', 'SAVEPOINT root; /* unclosed', 'SAVEPOINT root; SELECT 1', 'SAVEPOINT root; RELEASE root; INVALID']) {
      assert.throws(() => db.exec(sql), /complete supported/); assert.deepEqual(port.executions, []);
    }
    for (const sql of ['SAVEPOINT root', 'ROLLBACK', 'BEGIN IMMEDIATE', 'RELEASE root']) assert.throws(() => db.prepare(sql), /Use exec/);
    assert.deepEqual(port.preparations, []); assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});

test('uncertain synthetic BEGIN/COMMIT failures close the owned connection without retries or later writes', () => {
  for (const failAt of ['begin', 'commit']) {
    const native = new DatabaseSync(':memory:'), failure = new Error('Controlled acknowledgement failure');
    const port = instrument(native, { fail: sql => failAt === 'begin' && sql.startsWith('BEGIN DEFERRED;') || failAt === 'commit' && sql === 'COMMIT' ? failure : undefined });
    const db = withRemoteSavepoints(port.db);
    if (failAt === 'begin') assert.throws(() => db.exec('SAVEPOINT root'), error => error === failure);
    else { db.exec('SAVEPOINT root'); assert.throws(() => db.exec('RELEASE root'), error => error === failure); }
    assert.equal(port.closes(), 1); assert.equal(db.isTransaction, false);
    const count = port.executions.length;
    assert.throws(() => db.exec('SAVEPOINT again'), /unavailable/); assert.throws(() => db.prepare('SELECT 1'), /unavailable/);
    assert.equal(port.executions.length, count);
    assert.doesNotThrow(() => db.close()); assert.doesNotThrow(() => db.close()); assert.equal(port.closes(), 1);
  }
});

test('metadata refresh failure never replays the failed mutation', () => {
  const native = new DatabaseSync(':memory:'); let allowed = true, mutations = 0, metadata = 0, closed = 0;
  native.exec('CREATE TABLE fixture(id INTEGER)');
  const failure = new Error('Controlled metadata refusal'), mutation = new Error('Controlled native failure');
  const port: SqlDatabase = {
    get isTransaction() { return !closed; },
    exec(sql) { if (sql === 'SELECT 1') { metadata++; throw failure; } native.exec(sql); },
    prepare(sql) {
      const selected = native.prepare(sql);
      return { get: (...values: SqlValue[]) => selected.get(...values), all: (...values: SqlValue[]) => selected.all(...values),
        run: () => { assert.equal(allowed, true); mutations++; throw mutation; } };
    },
    close() { closed++; native.close(); },
  };
  const db = withRemoteSavepoints(port), selected = db.prepare('INSERT INTO fixture VALUES(?)');
  assert.throws(() => selected.run(1), error => error === mutation);
  assert.equal(mutations, 1); assert.equal(metadata, 1); assert.equal(closed, 1); assert.equal(db.isTransaction, false);
  allowed = false; assert.throws(() => selected.run(2), /unavailable/); assert.equal(mutations, 1);
});

test('a prepared statement still calls the native operation fence immediately before execution', () => {
  const native = new Libsql(':memory:'); native.exec('CREATE TABLE fixture(id INTEGER)');
  const failure = new Error('Controlled owner fence revocation'); let allowed = true;
  const db = withRemoteSavepoints(adaptLibsqlDatabase(native, () => { if (!allowed) throw failure; }));
  try {
    const statement = db.prepare('INSERT INTO fixture VALUES(?)'); allowed = false;
    assert.throws(() => statement.run(1), error => error === failure);
    assert.equal((native.prepare('SELECT count(*) AS n FROM fixture').get() as { n: bigint }).n, 0n);
    allowed = true; statement.run(2); assert.equal((native.prepare('SELECT count(*) AS n FROM fixture').get() as { n: bigint }).n, 1n);
  } finally { db.close(); }
});
