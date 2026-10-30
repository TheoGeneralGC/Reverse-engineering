import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Libsql from 'libsql';
import { adaptLibsqlDatabase, createLibsqlPrimaryFactory, type SqlOperation } from '../src/sql.ts';
import type { SqlDatabase } from '../../api/src/sql-database.ts';
import { createApp } from '../../api/src/server.ts';
import { loadAutoDraftRuntimeConfiguration } from '../../api/src/auto-drafts-runtime-configuration.ts';
import type { Draft } from '../../api/src/types.ts';

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('SQL adapter tests forbid external fetch'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });
const temporary = () => mkdtempSync(join(realpathSync(tmpdir()), 'rea-libsql-seam-'));
const adapted = () => adaptLibsqlDatabase(new Libsql(':memory:'));

function sqlVector(database: SqlDatabase) {
  database.exec('PRAGMA foreign_keys=ON; CREATE TABLE item(id INTEGER PRIMARY KEY,value TEXT NOT NULL,bytes BLOB); CREATE TABLE child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES item(id)); CREATE TABLE receipt(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TRIGGER item_insert AFTER INSERT ON item BEGIN INSERT INTO receipt(value) VALUES(new.value); END;');
  const saved = database.prepare('INSERT INTO item(value,bytes) VALUES(?,?) RETURNING id,value,bytes').get('Fictional 雪', new Uint8Array([0, 1, 255]))!;
  database.exec('BEGIN IMMEDIATE'); assert.equal(database.isTransaction, true);
  database.prepare('INSERT INTO child(id,parent) VALUES(?,?)').run(2, saved.id);
  database.exec('SAVEPOINT nested'); database.prepare('UPDATE item SET value=? WHERE id=?').run('must roll back', saved.id);
  database.exec('ROLLBACK TO nested; RELEASE nested; COMMIT'); assert.equal(database.isTransaction, false);
  assert.throws(() => database.prepare('INSERT INTO child(id,parent) VALUES(?,?)').run(3, 999), /FOREIGN KEY/);
  const row = database.prepare('SELECT * FROM item WHERE id=?').get(saved.id)!;
  return { row: { ...row, bytes: [...row.bytes as Uint8Array] }, receipt: database.prepare('SELECT count(*) AS n FROM receipt').get()!.n,
    missing: database.prepare('SELECT id FROM item WHERE id=?').get(999), changes: database.prepare('UPDATE item SET value=value WHERE id=?').run(999).changes };
}

test('Core-used SQL preserves transactions, nested savepoints, triggers, foreign keys and BLOBs', () => {
  const database = adapted(), native = new DatabaseSync(':memory:');
  try { assert.deepEqual(sqlVector(database), sqlVector(native)); } finally { database.close(); native.close(); }
});

test('SQL rows preserve real metadata and prototype column names without injected metadata', () => {
  const database = adapted(), native = new DatabaseSync(':memory:');
  try {
    const sql = "SELECT 7 AS _metadata,'owned' AS __proto__,'kept' AS constructor,9 AS duplicate,11 AS duplicate";
    assert.deepEqual(database.prepare(sql).get(), native.prepare(sql).get());
    assert.equal(Object.getPrototypeOf(database.prepare('SELECT 1 AS value').get()), null);
    assert.deepEqual(database.prepare('SELECT 1 AS value UNION ALL SELECT 2 AS value').all(), native.prepare('SELECT 1 AS value UNION ALL SELECT 2 AS value').all());
  } finally { database.close(); native.close(); }
});

test('unsafe SQLite integers fail closed; mutation row identities retain exact values for FTS linkage', () => {
  const database = adapted();
  try {
    assert.throws(() => database.prepare('SELECT ? AS value').get(9007199254740993n), RangeError);
    assert.throws(() => database.prepare('SELECT ? AS value').all(-9007199254740993n), RangeError);
    assert.equal(database.prepare('SELECT ? AS value').get(9007199254740991n)!.value, Number.MAX_SAFE_INTEGER);
    database.exec('CREATE TABLE rowid_fixture(id INTEGER PRIMARY KEY,value TEXT)');
    const result = database.prepare('INSERT INTO rowid_fixture(id,value) VALUES(?,?)').run(9007199254740993n, 'owned');
    assert.deepEqual(result, { changes: 1, lastInsertRowid: 9007199254740993n });
    database.exec('CREATE VIRTUAL TABLE rowid_fts USING fts5(value)');
    database.prepare('INSERT INTO rowid_fts(rowid,value) VALUES(?,?)').run(result.lastInsertRowid, 'owned');
    // Compare both sides without coercing the unsafe rowid through Number.
    assert.equal(database.prepare('SELECT CAST(rowid AS TEXT) AS rowid FROM rowid_fts').get()!.rowid, '9007199254740993');
    assert.throws(() => database.prepare('SELECT id FROM rowid_fixture').get(), RangeError);
  } finally { database.close(); }
});

test('unsupported parameters are rejected before native binding; binary view offsets are retained', () => {
  const database = adapted();
  try {
    const query = database.prepare('SELECT ? AS value');
    for (const value of [true, false, undefined, {}, [], () => {}, Number.NaN, Infinity, (1n << 63n), -(1n << 63n) - 1n]) {
      assert.throws(() => query.get(value as never), error => error instanceof TypeError || error instanceof RangeError);
    }
    const backing = new Uint8Array([99, 1, 2, 88]), view = new DataView(backing.buffer, 1, 2);
    assert.deepEqual([...query.get(view)!.value as Uint8Array], [1, 2]); assert.deepEqual([...backing], [99, 1, 2, 88]);
  } finally { database.close(); }
});

test('a revoked local operation guard prevents prepared work while close remains available', () => {
  const native = new Libsql(':memory:'); let revoked = false; const operations: SqlOperation[] = [];
  const database = adaptLibsqlDatabase(native, operation => { operations.push(operation); if (revoked) throw new Error('Controlled actor revocation'); });
  database.exec('CREATE TABLE item(value TEXT)'); const insert = database.prepare('INSERT INTO item VALUES(?)'); revoked = true;
  assert.throws(() => insert.run('must not issue'), /Controlled actor revocation/);
  assert.equal((native.prepare('SELECT count(*) AS n FROM item').get() as { n: bigint }).n, 0n);
  database.close(); assert.equal(native.open, false);
  assert.throws(() => insert.run('must stay closed'), /SQL database is closed/);
  assert.ok(operations.some(value => value.kind === 'run' && value.sql === 'INSERT INTO item VALUES(?)'));
});

test('remote primary configuration and selected identity fail before any remote connection', () => {
  const valid = { url: 'libsql://synthetic.turso.io', authToken: 'fictional-not-a-token' };
  for (const configuration of [null, [], {}, { ...valid, offline: true }, { ...valid, url: 'file:mail.sqlite' },
    { ...valid, url: 'http://synthetic.turso.io' }, { ...valid, url: 'https://attacker.example.test' },
    { ...valid, url: 'https://user:password@synthetic.turso.io' }, { ...valid, url: 'https://synthetic.turso.io/?token=secret' },
    { ...valid, authToken: '' }, { ...valid, authToken: 'must not contain whitespace' }, { ...valid, beforeOperation: 7 }]) {
    assert.throws(() => createLibsqlPrimaryFactory(configuration as never), /Invalid remote SQL configuration/);
  }
  const factory = createLibsqlPrimaryFactory(valid);
  assert.throws(() => factory(':memory:'), /does not match databasePath/);
  assert.throws(() => factory('libsql://different.turso.io'), /does not match databasePath/);
});

test('actual createApp uses the explicit libSQL factory and preserves schema and owned draft bytes across restart', async () => {
  const directory = temporary(), databasePath = join(directory, 'adapted.sqlite'), controlPath = join(directory, 'native.sqlite');
  const common = { TOKEN_ENCRYPTION_KEY: '29'.repeat(32), WEB_ORIGIN: 'http://127.0.0.1:5173', TZ: 'America/Los_Angeles' };
  const control = createApp({ databasePath: controlPath, env: { ...common, DATABASE_PATH: controlPath }, runJobs: false, providerDraftAutomatic: false });
  const controlSchema = control.store.db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(); await control.close();
  const environment = { ...common, DATABASE_PATH: databasePath };
  const databaseFactory = (path: string) => { assert.equal(path, databasePath); return adaptLibsqlDatabase(new Libsql(path)); };
  let app = createApp({ databasePath, env: environment, databaseFactory, runJobs: false, providerDraftAutomatic: false });
  try {
    assert.deepEqual(app.store.db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(), controlSchema);
    const draft = app.store.saveDraft({ accountId: 'demo', subject: 'SQL seam fixture', body: 'Fictional persisted bytes.' });
    await app.close(); app = createApp({ databasePath, env: environment, databaseFactory, runJobs: false, providerDraftAutomatic: false });
    assert.equal(app.store.required<Draft>('draft', draft.id).body, 'Fictional persisted bytes.');
    assert.equal(app.store.db.isTransaction, false);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('the local fake provider observes a committed Core delivery marker and commit refusal prevents issue', async () => {
  const directory = temporary(), databasePath = join(directory, 'mail.sqlite'), env = { DATABASE_PATH: databasePath };
  let refuseCommit = false, issued = 0;
  const app = createApp({ databasePath, env, runJobs: false, providerDraftAutomatic: false,
    databaseFactory: path => adaptLibsqlDatabase(new Libsql(path), operation => { if (refuseCommit && operation.kind === 'exec' && operation.sql === 'COMMIT') throw new Error('Controlled commit refusal'); }) });
  try {
    const first = app.store.saveDraft({ accountId: 'demo', to: 'fixture@example.test', subject: 'Owned marker fixture' });
    const pending = app.store.beginDelivery(first.id);
    const fakeProvider = () => {
      const reader = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const draft = JSON.parse(String(reader.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(first.id)!.data));
        const attempt = JSON.parse(String(reader.prepare("SELECT data FROM records WHERE kind='delivery' AND id=?").get(pending.deliveryAttemptId!)!.data));
        assert.equal(draft.status, 'sending'); assert.equal(attempt.status, 'dispatching'); assert.equal(draft.deliveryAttemptId, attempt.id); issued++;
      } finally { reader.close(); }
    };
    fakeProvider(); assert.equal(issued, 1);
    app.store.unknownDelivery(first.id, 'Synthetic acknowledged boundary remains uncertain');
    assert.throws(() => app.store.beginDelivery(first.id), { code: 'delivery_requires_reconciliation' }); assert.equal(issued, 1);
    const second = app.store.saveDraft({ accountId: 'demo', to: 'fixture@example.test', subject: 'No issue before commit' });
    refuseCommit = true;
    assert.throws(() => { app.store.beginDelivery(second.id); fakeProvider(); }, /Controlled commit refusal/);
    assert.equal(issued, 1); assert.equal(app.store.required<Draft>('draft', second.id).status, 'draft');
    refuseCommit = false; assert.equal(app.store.list('delivery').length, 1);
  } finally { refuseCommit = false; await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('the actual Core mail index links an unsafe autogenerated document rowid to the exact FTS row', async () => {
  const databasePath = ':memory:', env = { DATABASE_PATH: databasePath };
  const app = createApp({ databasePath, env, runJobs: false, providerDraftAutomatic: false,
    databaseFactory: path => adaptLibsqlDatabase(new Libsql(path)) });
  try {
    app.store.db.prepare('INSERT INTO ai_mail_documents(rowid,thread_id,account_id,updated_at,truncated,snapshot_hash,safe_snippet) VALUES(?,?,?,?,?,?,?)')
      .run(9007199254740992n, 'synthetic-rowid-sentinel', 'demo', '2026-10-29T00:00:00.000Z', 0, '0'.repeat(64), '');
    assert.deepEqual(app.aiChat.refreshIndex('demo', 1), { indexed: 1, failed: 0 });
    const linked = app.store.db.prepare('SELECT CAST(d.rowid AS TEXT) AS document,CAST(f.rowid AS TEXT) AS fts FROM ai_mail_documents d JOIN ai_mail_fts f ON f.thread_id=d.thread_id AND f.account_id=d.account_id WHERE d.thread_id=?')
      .get('demo-archived')!;
    assert.equal(linked.document, '9007199254740993'); assert.equal(linked.fts, linked.document);
  } finally { await app.close(); }
});

test('the normal managed runtime configuration builds the same optional Core schema on the libSQL adapter', async () => {
  const databasePath = ':memory:', env = { DATABASE_PATH: databasePath, TOKEN_ENCRYPTION_KEY: '29'.repeat(32), AUTO_DRAFTS_PERSISTENCE: 'managed', TZ: 'America/Los_Angeles' };
  const create = (useAdapter: boolean) => {
    const runtime = loadAutoDraftRuntimeConfiguration(env);
    try { assert.ok(runtime.generation); return createApp({ databasePath, env, runJobs: false, providerDraftAutomatic: true, autoDraftGeneration: runtime.generation,
      ...(useAdapter ? { databaseFactory: (path: string) => adaptLibsqlDatabase(new Libsql(path)) } : {}) }); }
    finally { runtime.clear(); }
  };
  const native = create(false), app = create(true);
  try {
    const schema = (database: SqlDatabase) => database.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    assert.deepEqual(schema(app.store.db), schema(native.store.db)); assert.ok(app.archiveActions); assert.ok(app.autoDraftGeneration);
    assert.equal(app.store.db.isTransaction, false);
  } finally { await app.close(); await native.close(); }
});
