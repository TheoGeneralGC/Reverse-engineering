import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Libsql from 'libsql';
import { preflightNativeMail } from '../src/worker.ts';
import { adaptLibsqlDatabase, withVerifiedManagedWal, type SqlOperation } from '../src/sql.ts';

const originalFetch = globalThis.fetch; let network = 0;
globalThis.fetch = async () => { network++; throw new Error('Preflight controls forbid external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(network, 0); });
const configuration = { databaseUrl: 'libsql://synthetic-mail.aws-us-east-1.turso.io', databaseToken: 'synthetic-not-a-credential' };
function fixture(wal = true) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'rea-native-preflight-')), path = join(directory, 'mail.sqlite');
  const setup = new Libsql(path);
  try { if (wal) setup.exec('PRAGMA journal_mode=WAL'); setup.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES(\'fictional untouched\')'); }
  finally { setup.close(); }
  const snapshot = () => { const db = new DatabaseSync(path, { readOnly: true }); try { return { schema: db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(), rows: db.prepare('SELECT * FROM sentinel').all() }; } finally { db.close(); } };
  return { directory, path, snapshot, remove() { rmSync(directory, { recursive: true, force: true }); } };
}

test('native preflight selects its exact mail identity, reads WAL on an actual temporary primary and closes without schema/data changes', () => {
  const f = fixture(), before = f.snapshot(), operations: SqlOperation[] = []; let opens = 0, closes = 0, selected: Libsql.Database | undefined;
  try {
    preflightNativeMail(configuration, spec => {
      assert.equal(spec.url, configuration.databaseUrl); assert.equal(spec.authToken, configuration.databaseToken);
      assert.equal(spec.journalMode, 'verify-managed-wal'); assert.equal(typeof spec.beforeOperation, 'function');
      return selectedPath => {
        assert.equal(selectedPath, configuration.databaseUrl); opens++;
        selected = new Libsql(f.path); selected.exec('PRAGMA query_only=ON');
        const db = adaptLibsqlDatabase(selected, operation => { operations.push(operation); spec.beforeOperation!(operation); });
        const close = db.close; db.close = () => { closes++; close(); };
        return withVerifiedManagedWal(db);
      };
    });
    assert.equal(opens, 1); assert.equal(closes, 1); assert.equal(selected!.open, false);
    assert.deepEqual(operations, [{ kind: 'prepare', sql: 'PRAGMA journal_mode' }, { kind: 'get', sql: 'PRAGMA journal_mode' }]);
    assert.deepEqual(f.snapshot(), before);
  } finally { selected?.close(); f.remove(); }
});

test('a non-WAL temporary primary refuses before construction can proceed and its selected native connection closes', () => {
  const f = fixture(false), before = f.snapshot(); let selected: Libsql.Database | undefined, returned = false;
  try {
    assert.throws(() => { preflightNativeMail(configuration, spec => path => {
      assert.equal(path, configuration.databaseUrl); selected = new Libsql(f.path);
      return withVerifiedManagedWal(adaptLibsqlDatabase(selected, spec.beforeOperation));
    }); returned = true; }, /must already use WAL/);
    assert.equal(returned, false); assert.equal(selected!.open, false); assert.deepEqual(f.snapshot(), before);
  } finally { selected?.close(); f.remove(); }
});

test('the operation guard rejects mutation, transaction and alternate-read forms before native execution', () => {
  const f = fixture(), before = f.snapshot(); let selected: Libsql.Database | undefined;
  try {
    preflightNativeMail(configuration, spec => path => {
      assert.equal(path, configuration.databaseUrl); selected = new Libsql(f.path);
      const db = adaptLibsqlDatabase(selected, spec.beforeOperation);
      for (const sql of ['BEGIN IMMEDIATE', 'CREATE TABLE forbidden(id INTEGER)', 'PRAGMA journal_mode=WAL;', "INSERT INTO sentinel VALUES('must not exist')"]) assert.throws(() => db.exec(sql), /only the WAL mode read/);
      for (const sql of ['SELECT 1', 'PRAGMA foreign_keys', 'PRAGMA journal_mode;', 'pragma journal_mode', 'PRAGMA main.journal_mode']) assert.throws(() => db.prepare(sql), /only the WAL mode read/);
      const known = db.prepare('PRAGMA journal_mode'); assert.equal(known.get()!.journal_mode, 'wal');
      assert.throws(() => known.all(), /only the WAL mode read/); assert.throws(() => known.run(), /only the WAL mode read/);
      return withVerifiedManagedWal(db);
    });
    assert.equal(selected!.open, false); assert.deepEqual(f.snapshot(), before);
  } finally { selected?.close(); f.remove(); }
});

test('native factory/verification failure and close failure propagate rather than continuing or retrying', () => {
  const refused = new Error('Synthetic native TLS refusal'); let opens = 0;
  assert.throws(() => preflightNativeMail(configuration, () => () => { opens++; throw refused; }), error => error === refused);
  assert.equal(opens, 1);
  const closed = new Error('Synthetic selected connection close failure'); let closes = 0;
  assert.throws(() => preflightNativeMail(configuration, () => () => ({ isTransaction: false, exec() { throw Error('No execution permitted'); }, prepare() { throw Error('Factory already verified'); }, close() { closes++; throw closed; } })), error => error === closed);
  assert.equal(closes, 1);
});

test('a WAL verification read failure closes the actual selected connection without hiding the original error', () => {
  const f = fixture(), before = f.snapshot(), refused = new Error('Synthetic read refusal'); let selected: Libsql.Database | undefined;
  try {
    assert.throws(() => preflightNativeMail(configuration, spec => () => {
      selected = new Libsql(f.path);
      const db = adaptLibsqlDatabase(selected, operation => { spec.beforeOperation!(operation); if (operation.kind === 'get') throw refused; });
      return withVerifiedManagedWal(db);
    }), error => error === refused);
    assert.equal(selected!.open, false); assert.deepEqual(f.snapshot(), before);
  } finally { selected?.close(); f.remove(); }
});

test('the default production factory still rejects an invalid identity before opening native storage', () => {
  for (const databaseUrl of [':memory:', '/tmp/must-not-open.sqlite', 'https://foreign.example.test']) assert.throws(() => preflightNativeMail({ ...configuration, databaseUrl }), /Invalid remote SQL configuration/);
  assert.equal(network, 0);
});
