/** NOT an automatic test. Use only a newly provisioned, empty disposable libSQL
 * resource, with explicit server-side credentials. No provider requests occur. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createLibsqlPrimaryFactory } from '../src/sql.ts';
import type { SqlDatabase } from '../../api/src/sql-database.ts';

if (process.env.REA_SQL_SPIKE_DISPOSABLE_REMOTE !== '1') throw new Error('Explicit disposable remote authorization required');
const databasePath = process.env.LIBSQL_URL;
if (!databasePath || !process.env.LIBSQL_AUTH_TOKEN) throw new Error('Explicit remote SQL configuration required');
const factory = createLibsqlPrimaryFactory({ url: databasePath, authToken: process.env.LIBSQL_AUTH_TOKEN });
const timings: Record<string, number> = {};
function timed<T>(name: string, work: () => T): T { const start = performance.now(); const value = work(); timings[name] = Math.round((performance.now() - start) * 1000) / 1000; return value; }
let first: SqlDatabase | undefined, second: SqlDatabase | undefined, ownsFixtures = false;
try {
  first = timed('connectMs', () => factory(databasePath));
  const existing = first.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all();
  if (existing.length) throw new Error('Refusing a nonempty disposable database');
  timed('schemaMs', () => first!.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE rea_sql_spike_item(id INTEGER PRIMARY KEY,value TEXT NOT NULL,bytes BLOB);
    CREATE TABLE rea_sql_spike_child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES rea_sql_spike_item(id));
    CREATE TABLE rea_sql_spike_receipt(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
    CREATE TRIGGER rea_sql_spike_insert AFTER INSERT ON rea_sql_spike_item BEGIN INSERT INTO rea_sql_spike_receipt(value) VALUES(new.value); END;
    CREATE VIRTUAL TABLE rea_sql_spike_fts USING fts5(value);`));
  ownsFixtures = true;
  first.exec('BEGIN IMMEDIATE'); assert.equal(first.isTransaction, true);
  const inserted = first.prepare('INSERT INTO rea_sql_spike_item(id,value,bytes) VALUES(?,?,?)').run(9007199254740993n, 'fictional remote fixture', new Uint8Array([0, 1, 255]));
  assert.equal(inserted.lastInsertRowid, 9007199254740993n);
  first.prepare('INSERT INTO rea_sql_spike_fts(rowid,value) VALUES(?,?)').run(inserted.lastInsertRowid, 'owned fixture text');
  first.exec('SAVEPOINT nested'); first.prepare('UPDATE rea_sql_spike_item SET value=? WHERE id=?').run('must roll back', inserted.lastInsertRowid);
  first.exec('ROLLBACK TO nested; RELEASE nested'); timed('commitMs', () => first!.exec('COMMIT')); assert.equal(first.isTransaction, false);
  first.close(); first = undefined;
  second = timed('freshConnectionMs', () => factory(databasePath)); second.exec('PRAGMA foreign_keys=ON');
  const row = timed('freshReadMs', () => second!.prepare('SELECT CAST(id AS TEXT) AS id,value,bytes FROM rea_sql_spike_item').get())!;
  assert.equal(row.id, '9007199254740993'); assert.equal(row.value, 'fictional remote fixture'); assert.deepEqual([...row.bytes as Uint8Array], [0, 1, 255]);
  assert.equal(second.prepare('SELECT CAST(rowid AS TEXT) AS rowid FROM rea_sql_spike_fts').get()!.rowid, row.id);
  assert.equal(second.prepare('SELECT count(*) AS n FROM rea_sql_spike_receipt').get()!.n, 1);
  assert.throws(() => second!.prepare('INSERT INTO rea_sql_spike_child VALUES(?,?)').run(7, 999), /FOREIGN KEY/);
  second.exec('BEGIN IMMEDIATE'); second.prepare('UPDATE rea_sql_spike_item SET value=?').run('must disappear'); second.exec('ROLLBACK');
  assert.equal(second.prepare('SELECT value FROM rea_sql_spike_item').get()!.value, 'fictional remote fixture');
  console.log(JSON.stringify({ passed: true, timings, byteSha256: createHash('sha256').update(row.bytes as Uint8Array).digest('hex'),
    scope: 'Remote primary transactions/savepoints/FK/trigger/BLOB/exact unsafe rowid and FTS linkage/fresh connection; no Core or provider behavior proof' }));
} catch { console.error(JSON.stringify({ passed: false, timings, error: 'Remote SQL probe failed; inspect the isolated resource without printing credentials' })); process.exitCode = 1; }
finally {
  const cleanup = first ?? second;
  if (ownsFixtures && cleanup) {
    try { if (cleanup.isTransaction) cleanup.exec('ROLLBACK'); cleanup.exec('DROP TABLE IF EXISTS rea_sql_spike_child; DROP TABLE IF EXISTS rea_sql_spike_item; DROP TABLE IF EXISTS rea_sql_spike_receipt; DROP TABLE IF EXISTS rea_sql_spike_fts;'); }
    catch { console.error('Isolated SQL fixture cleanup needs review'); process.exitCode = 1; }
  } else if (ownsFixtures) { console.error('Isolated SQL fixture cleanup needs review'); process.exitCode = 1; }
  first?.close(); second?.close();
}
