import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Libsql from 'libsql';
import { adaptLibsqlDatabase, createLibsqlPrimaryFactory, withVerifiedManagedWal, type SqlOperationGuard } from '../src/sql.ts';
import { loadWorkerConfiguration } from '../src/worker.ts';
import { createApp } from '../../api/src/server.ts';
import { Store } from '../../api/src/store.ts';
import type { Draft } from '../../api/src/types.ts';
import type { SqlDatabase } from '../../api/src/sql-database.ts';

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('Managed WAL controls prohibit external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });
const prefix = 'PRAGMA journal_mode=WAL;';
const temporary = () => mkdtempSync(join(realpathSync(tmpdir()), 'rea-managed-wal-'));
const common = { TOKEN_ENCRYPTION_KEY: '25'.repeat(32), WEB_ORIGIN: 'http://127.0.0.1:5173', TZ: 'America/Los_Angeles' };
type PolicyOptions = { wal?: boolean; mode?: string | number | null; readError?: Error; execError?: (sql: string) => Error | undefined; guard?: SqlOperationGuard };
function policy(databasePath: string, options: PolicyOptions = {}) {
  const native = new Libsql(databasePath);
  if (options.wal !== false) native.exec('PRAGMA journal_mode=WAL');
  const adapted = adaptLibsqlDatabase(native, options.guard), executions: string[] = [], reads: string[] = [];
  let setterCalls = 0, closes = 0;
  const database: SqlDatabase = {
    get isTransaction() { return adapted.isTransaction; },
    exec(sql) {
      executions.push(sql);
      if (/^\s*PRAGMA\s+(?:main\.)?journal_mode\s*=/i.test(sql)) { setterCalls++; throw new Error('Controlled server journal setter refusal'); }
      const failure = options.execError?.(sql); if (failure) throw failure;
      adapted.exec(sql);
    },
    prepare(sql) {
      reads.push(sql); if (sql === 'PRAGMA journal_mode' && options.readError) throw options.readError;
      const statement = adapted.prepare(sql);
      if (sql === 'PRAGMA journal_mode' && Object.hasOwn(options, 'mode')) return { ...statement, get: () => options.mode === null ? undefined : { journal_mode: options.mode! } };
      return statement;
    },
    close() { closes++; adapted.close(); },
  };
  return { database, native, executions, reads, setterCalls: () => setterCalls, closes: () => closes };
}
function objects(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(); }
  finally { db.close(); }
}

test('actual Store strict policy still sends the setter and fails, while default local Node SQLite stays native', () => {
  const directory = temporary(), path = join(directory, 'strict.sqlite'), p = policy(path);
  try {
    assert.throws(() => new Store(path, false, { databaseFactory: supplied => { assert.equal(supplied, path); return p.database; } }), /setter refusal/);
    assert.equal(p.setterCalls(), 1); assert.equal(p.native.open, false); assert.deepEqual(objects(path), []);
    const native = new Store(':memory:', false); try { assert.ok(native.db instanceof DatabaseSync); assert.equal(native.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1); } finally { native.close(); }
  } finally { p.database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('actual managed Core startup preserves the exact Store suffix, schema, FK enforcement and fictional draft across restart', async () => {
  const directory = temporary(), nativePath = join(directory, 'native.sqlite'), databasePath = join(directory, 'managed.sqlite');
  let startup = '';
  const baseline = createApp({ databasePath: nativePath, env: { ...common, DATABASE_PATH: nativePath }, runJobs: false, providerDraftAutomatic: false,
    databaseFactory: path => { assert.equal(path, nativePath); const db = new DatabaseSync(path), exec = db.exec.bind(db); db.exec = sql => { if (!startup) startup = sql; exec(sql); }; return db; } });
  const baselineObjects = objects(nativePath); await baseline.close(); assert.ok(startup.startsWith(prefix));
  const selected: ReturnType<typeof policy>[] = [];
  const factory = (path: string) => { assert.equal(path, databasePath); const p = policy(path); selected.push(p); return withVerifiedManagedWal(p.database); };
  let app = createApp({ databasePath, env: { ...common, DATABASE_PATH: databasePath }, databaseFactory: factory, runJobs: false, providerDraftAutomatic: false });
  try {
    assert.deepEqual(objects(databasePath), baselineObjects); assert.equal(selected[0].setterCalls(), 0);
    assert.equal(selected[0].executions[0], startup.slice(prefix.length));
    assert.equal(app.store.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
    app.store.db.exec('CREATE TABLE managed_parent(id INTEGER PRIMARY KEY); CREATE TABLE managed_child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES managed_parent(id)); INSERT INTO managed_parent VALUES(1)');
    app.store.db.prepare('INSERT INTO managed_child VALUES(?,?)').run(1, 1);
    assert.throws(() => app.store.db.prepare('INSERT INTO managed_child VALUES(?,?)').run(2, 999), /FOREIGN KEY/);
    const draft = app.store.saveDraft({ accountId: 'demo', subject: 'Managed WAL fictional fixture', body: 'Fictional Cedar bytes.' });
    await app.close(); app = createApp({ databasePath, env: { ...common, DATABASE_PATH: databasePath }, databaseFactory: factory, runJobs: false, providerDraftAutomatic: false });
    assert.equal(app.store.required<Draft>('draft', draft.id).body, 'Fictional Cedar bytes.');
    assert.ok(selected.every(p => p.setterCalls() === 0));
  } finally { await app.close(); assert.ok(selected.every(p => p.native.open === false)); rmSync(directory, { recursive: true, force: true }); }
});

test('non-WAL/missing/unrecognized mode and read errors close the selected connection before any startup DDL', () => {
  for (const options of [{ wal: false }, { mode: null }, { mode: 'WAL' }, { mode: 'unknown' }, { mode: 1 }, { readError: new Error('Controlled mode read failure') }]) {
    const directory = temporary(), path = join(directory, 'refused.sqlite'), p = policy(path, options);
    try {
      assert.throws(() => createApp({ databasePath: path, env: { ...common, DATABASE_PATH: path }, runJobs: false,
        databaseFactory: supplied => { assert.equal(supplied, path); return withVerifiedManagedWal(p.database); } }), options.readError ? error => error === options.readError : /must already use WAL/);
      assert.equal(p.native.open, false); assert.deepEqual(p.executions, []); assert.deepEqual(objects(path), []);
    } finally { p.database.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('the exact known prefix is reverified; changed mode prevents its suffix rather than relying on cached readiness', () => {
  const directory = temporary(), path = join(directory, 'changed.sqlite'), p = policy(path), db = withVerifiedManagedWal(p.database);
  try {
    p.native.exec('PRAGMA journal_mode=DELETE');
    assert.throws(() => db.exec(prefix + ' CREATE TABLE must_not_exist(id INTEGER)'), /must already use WAL/);
    assert.deepEqual(p.executions, []); assert.deepEqual(objects(path), []); assert.equal(p.reads.filter(sql => sql === 'PRAGMA journal_mode').length, 2);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('quoted/comment/trigger/later prefix text and alternate PRAGMAs are forwarded byte-exact without broad rewrite', () => {
  const directory = temporary(), path = join(directory, 'literal.sqlite');
  const later = "SELECT 1; PRAGMA journal_mode=WAL;", refused = new Error('Controlled later setter refusal');
  const p = policy(path, { execError: sql => sql === later ? refused : undefined }), db = withVerifiedManagedWal(p.database);
  try {
    const scripts = ["SELECT 'PRAGMA journal_mode=WAL;'", '/* PRAGMA journal_mode=WAL; */ SELECT 1',
      "CREATE TABLE trigger_fixture(id INTEGER); CREATE TRIGGER literal_trigger AFTER INSERT ON trigger_fixture BEGIN SELECT 'PRAGMA journal_mode=WAL;'; END; INSERT INTO trigger_fixture VALUES(1)"];
    for (const script of scripts) { db.exec(script); assert.equal(p.executions.at(-1), script); }
    assert.throws(() => db.exec(later), error => error === refused); assert.equal(p.executions.at(-1), later);
    for (const script of ['pragma journal_mode=wal;', 'PRAGMA main.journal_mode=WAL;', 'PRAGMA journal_mode=DELETE;']) {
      assert.throws(() => db.exec(script), /setter refusal/); assert.equal(p.executions.at(-1), script);
    }
    assert.equal(p.reads.filter(sql => sql === 'PRAGMA journal_mode').length, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('forwarded FK and DDL failures propagate unchanged and close failed Store startup', () => {
  for (const kind of ['foreign-key', 'ddl']) {
    const directory = temporary(), path = join(directory, 'suffix.sqlite'), refused = new Error(`Controlled ${kind} failure`);
    const p = policy(path, { execError: sql => kind === 'foreign-key' && sql.startsWith(' PRAGMA foreign_keys=ON;') || kind === 'ddl' && sql.includes('CREATE TABLE IF NOT EXISTS records') ? refused : undefined });
    try {
      assert.throws(() => new Store(path, false, { databaseFactory: supplied => { assert.equal(supplied, path); return withVerifiedManagedWal(p.database); } }), error => error === refused);
      assert.equal(p.setterCalls(), 0); assert.equal(p.native.open, false); assert.deepEqual(objects(path), []);
    } finally { p.database.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('live transaction, prepared statement, close and local actor revocation semantics survive the wrapper', () => {
  const directory = temporary(), path = join(directory, 'guarded.sqlite'); let revoked = false;
  const p = policy(path, { guard: () => { if (revoked) throw new Error('Controlled actor revocation'); } }), db = withVerifiedManagedWal(p.database);
  try {
    db.exec(prefix + ' CREATE TABLE guarded(value TEXT)'); const insert = db.prepare('INSERT INTO guarded VALUES(?)');
    db.exec('BEGIN IMMEDIATE'); assert.equal(db.isTransaction, true); db.exec('ROLLBACK'); assert.equal(db.isTransaction, false);
    const before = p.executions.length; revoked = true;
    assert.throws(() => db.exec(prefix + " INSERT INTO guarded VALUES('must not execute')"), /actor revocation/); assert.equal(p.executions.length, before);
    assert.throws(() => insert.run('must not execute'), /actor revocation/);
    assert.equal((p.native.prepare('SELECT count(*) AS n FROM guarded').get() as { n: bigint }).n, 0n);
    db.close(); assert.equal(p.native.open, false); assert.equal(db.isTransaction, false); assert.throws(() => insert.run('closed'), /SQL database is closed/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('factory policy is explicit/validated and production worker config selects managed WAL without opening storage', () => {
  const config = { url: 'libsql://fictional.aws-us-east-1.turso.io', authToken: 'fictional-not-a-token' };
  for (const journalMode of [undefined, 'require-set-wal', 'verify-managed-wal'] as const) assert.equal(typeof createLibsqlPrimaryFactory({ ...config, journalMode }), 'function');
  for (const journalMode of [null, false, 7, 'ignore', 'WAL', 'auto']) assert.throws(() => createLibsqlPrimaryFactory({ ...config, journalMode } as never), /Invalid remote SQL configuration/);
  const webOrigin = 'https://mail.example.test';
  const env = { MAIL_RUNTIME_NAMESPACE: 'fictional-worker', WEB_ORIGIN: webOrigin, GOOGLE_REDIRECT_URI: `${webOrigin}/api/auth/google/callback`,
    TURSO_DATABASE_URL: config.url, TURSO_AUTH_TOKEN: config.authToken, CONTROL_TURSO_DATABASE_URL: 'libsql://fictional-control.aws-us-east-1.turso.io', CONTROL_TURSO_AUTH_TOKEN: 'fictional-control-token',
    TOKEN_ENCRYPTION_KEY: '1'.repeat(64), MAIL_PRIVATE_BLOB_STORE_ID: 'store_1234567890abcdef', VERCEL_DEPLOYMENT_ID: 'fixture-deployment' };
  assert.equal(loadWorkerConfiguration(env).journalMode, 'verify-managed-wal'); assert.equal(external, 0);
});
