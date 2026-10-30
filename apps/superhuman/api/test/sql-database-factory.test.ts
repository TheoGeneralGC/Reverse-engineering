import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import type { SqlDatabase, SqlDatabaseFactory } from '../src/sql-database.ts';

const actualFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('SQL factory tests forbid external fetch'); };
after(() => { globalThis.fetch = actualFetch; assert.equal(external, 0); });
const temporary = () => mkdtempSync(join(realpathSync(tmpdir()), 'rea-sql-factory-'));

test('the default Store remains the native Node database with protected file permissions', () => {
  const directory = temporary(), path = join(directory, 'nested', 'mail.sqlite');
  const store = new Store(path, false);
  try {
    assert.ok(store.db instanceof DatabaseSync);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(store.db.isTransaction, false);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM records').get()!.n, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an explicit factory receives its exact path and does not create or chmod a local fallback', () => {
  const directory = temporary(), path = join(directory, 'must-not-exist', 'mail.sqlite');
  const memory = new DatabaseSync(':memory:'); let calls = 0;
  const store = new Store(path, false, { databaseFactory: supplied => { calls++; assert.equal(supplied, path); return memory; } });
  try {
    assert.equal(calls, 1); assert.equal(store.db, memory); assert.equal(existsSync(join(directory, 'must-not-exist')), false);
    store.db.prepare('INSERT INTO records VALUES(?,?,?)').run('fixture', 'one', '{"retained":true}');
    assert.equal(store.get<{ retained: boolean }>('fixture', 'one')!.retained, true);
  } finally { store.close(); assert.equal(memory.isOpen, false); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid factory configuration is rejected before factory or filesystem work', () => {
  const directory = temporary(), path = join(directory, 'must-not-exist', 'mail.sqlite');
  try {
    for (const configuration of [null, [], { other: true }, { databaseFactory: 7 }]) {
      assert.throws(() => new Store(path, false, configuration as never), /Invalid Store database configuration/);
    }
    for (const factory of [null, 7, {}, 'file']) {
      assert.throws(() => createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, databaseFactory: factory as never, runJobs: false }), /databaseFactory must be a function/);
    }
    assert.equal(existsSync(join(directory, 'must-not-exist')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('factory refusal and malformed returned databases never fall back to a local file', () => {
  const directory = temporary(), path = join(directory, 'must-not-exist', 'mail.sqlite'), refused = new Error('Controlled database refusal');
  let closes = 0;
  try {
    assert.throws(() => new Store(path, false, { databaseFactory: () => { throw refused; } }), error => error === refused);
    const malformed = { close() { closes++; } };
    assert.throws(() => new Store(path, false, { databaseFactory: (() => malformed) as unknown as SqlDatabaseFactory }), /synchronous SQL database/);
    assert.equal(closes, 1); assert.equal(existsSync(join(directory, 'must-not-exist')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('an injected schema failure closes only the supplied database and preserves the failure', () => {
  const directory = temporary(), path = join(directory, 'must-not-exist', 'mail.sqlite'), refused = new Error('Controlled schema failure');
  let closes = 0;
  const supplied: SqlDatabase = { isTransaction: false, exec() { throw refused; }, prepare() { throw new Error('No statement expected'); }, close() { closes++; } };
  try {
    assert.throws(() => new Store(path, false, { databaseFactory: () => supplied }), error => error === refused);
    assert.equal(closes, 1); assert.equal(existsSync(join(directory, 'must-not-exist')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('createApp forwards the explicit selected path and closes its injected database', async () => {
  const databasePath = ':memory:', env = { DATABASE_PATH: databasePath }; const memory = new DatabaseSync(':memory:'); let calls = 0;
  const app = createApp({ databasePath, env, runJobs: false, providerDraftAutomatic: false,
    databaseFactory: path => { calls++; assert.equal(path, databasePath); return memory; } });
  try { assert.equal(calls, 1); assert.equal(app.store.db, memory); assert.equal(app.store.preferences().activeAccountId, 'demo'); }
  finally { await app.close(); assert.equal(memory.isOpen, false); }
});

test('owner liveness keeps the native fallback by default and accepts only an explicit trusted boolean decision', () => {
  const local = new Store(':memory:', false); let nativeCalls = 0;
  try { assert.equal(local.ownerLiveness(false, () => { nativeCalls++; return true; }), true); assert.equal(nativeCalls, 1); }
  finally { local.close(); }
  const selected = new Store(':memory:', false, { ownerLiveness: localRegistered => localRegistered });
  try { assert.equal(selected.ownerLiveness(false, () => { throw new Error('Native PID must not be consulted'); }), false);
    assert.equal(selected.ownerLiveness(true, () => { throw new Error('Native PID must not be consulted'); }), true);
  } finally { selected.close(); }
  const invalid = new Store(':memory:', false, { ownerLiveness: (() => 'not-a-boolean') as never });
  try { assert.throws(() => invalid.ownerLiveness(false, () => true), /must return a boolean/); }
  finally { invalid.close(); }
  assert.throws(() => new Store(':memory:', false, { ownerLiveness: 7 as never }), /Invalid Store database configuration/);
  assert.throws(() => createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, ownerLiveness: 7 as never, runJobs: false }), /ownerLiveness must be a function/);
});
