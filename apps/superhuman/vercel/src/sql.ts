import Libsql from 'libsql';
import { createHash } from 'node:crypto';
import { withTransactionSelectReuse } from './statement-reuse.ts';
import type { SqlDatabase, SqlDatabaseFactory, SqlRow, SqlStatement, SqlValue } from '../../api/src/sql-database.ts';

export type SqlOperation = Readonly<{ kind: 'exec' | 'prepare' | 'get' | 'all' | 'run'; sql: string }>;
export type SqlOperationGuard = (operation: SqlOperation) => void;
const safeMaximum = BigInt(Number.MAX_SAFE_INTEGER), safeMinimum = BigInt(Number.MIN_SAFE_INTEGER);
const signedMaximum = (1n << 63n) - 1n, signedMinimum = -(1n << 63n);

function inputs(values: readonly SqlValue[]): unknown[] {
  return values.map(value => {
    if (value === null || typeof value === 'string') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('SQL numbers must be finite'); return value; }
    if (typeof value === 'bigint') { if (value < signedMinimum || value > signedMaximum) throw new RangeError('SQL integer exceeds the signed 64-bit range'); return value; }
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Unsupported SQL parameter');
  });
}
function output(value: unknown): SqlRow[string] {
  if (typeof value === 'bigint') {
    if (value < safeMinimum || value > safeMaximum) throw new RangeError('SQL integer exceeds the JavaScript safe integer range');
    return Number(value);
  }
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new TypeError('Invalid SQL result value');
}
function row(value: unknown, columns: readonly string[]): SqlRow | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== columns.length) throw new TypeError('Invalid SQL row');
  const result: SqlRow = Object.create(null);
  for (let index = 0; index < columns.length; index++) result[columns[index]] = output(value[index]);
  return result;
}

/** Wrap the native libSQL binding through only the synchronous Core contract.
 * Raw row arrays avoid libsql0.5.29's injected _metadata property and preserve
 * real SQL columns with that name. No native-only SQL function API is exposed. */
export function adaptLibsqlDatabase(database: Libsql.Database, beforeOperation?: SqlOperationGuard): SqlDatabase {
  if (beforeOperation !== undefined && typeof beforeOperation !== 'function') throw new TypeError('Invalid SQL operation guard');
  database.defaultSafeIntegers(true);
  let closed = false;
  const enter = (kind: SqlOperation['kind'], sql: string) => {
    if (closed) throw new TypeError('SQL database is closed');
    beforeOperation?.(Object.freeze({ kind, sql }));
  };
  return {
    get isTransaction() { return closed ? false : database.inTransaction; },
    exec(sql) { enter('exec', sql); database.exec(sql); },
    prepare(sql): SqlStatement {
      enter('prepare', sql);
      const statement = database.prepare(sql);
      const columns = statement.reader ? statement.columns().map(column => column.name) : [];
      if (statement.reader) statement.raw(true);
      return {
        get(...values) { enter('get', sql); return row(statement.get(inputs(values)), columns); },
        all(...values) {
          enter('all', sql);
          return statement.all(inputs(values)).map(value => {
            const result = row(value, columns);
            if (!result) throw new TypeError('Invalid SQL row');
            return result;
          });
        },
        run(...values) {
          enter('run', sql);
          const result = statement.run(inputs(values));
          if (!Number.isSafeInteger(result.changes) || result.changes < 0) throw new TypeError('Invalid SQL mutation result');
          // The pinned binding converts rowids to Number even with safeIntegers.
          // Query the same connection only when that conversion is unsafe; Core
          // uses this value to link FTS rows to their owning document.
          let lastInsertRowid = result.lastInsertRowid;
          if (typeof lastInsertRowid === 'number' && !Number.isSafeInteger(lastInsertRowid)) {
            enter('get', 'SELECT last_insert_rowid() AS rowid');
            const exact = database.prepare('SELECT last_insert_rowid() AS rowid').raw(true).get([]);
            if (!Array.isArray(exact) || exact.length !== 1 || typeof exact[0] !== 'bigint') throw new TypeError('Invalid SQL row identity');
            lastInsertRowid = exact[0];
          }
          if (typeof lastInsertRowid !== 'bigint' && (typeof lastInsertRowid !== 'number' || !Number.isSafeInteger(lastInsertRowid))) throw new TypeError('Invalid SQL row identity');
          return { changes: result.changes, lastInsertRowid };
        },
      };
    },
    close() { if (!closed) { closed = true; database.close(); } },
  };
}

type TransactionControl = { kind: 'savepoint' | 'release' | 'rollback-to' | 'begin' | 'commit' | 'rollback'; name?: string; sql: string };
const transactionWords = new Set(['SAVEPOINT', 'RELEASE', 'ROLLBACK', 'BEGIN', 'COMMIT', 'END']);
// Exact self-contained Core schema batches; unlike separate SAVEPOINT calls,
// they open and finish their transaction within one native execute_batch.
const coreSchemaBatches = new Set([
  '2fcadc7b9f9e1469b6c3894bee9d5513559e3f0f929f113c799e0c85bddaf7a2', // tracking-delivery.ts
  '78b37d666323e1a4c1bfb62eacb8b34015ce956b1860efb2c0f6c00c1bf93c13', // ai-chat-store.ts
]);
/** A deliberately narrow parser for complete control-only scripts. Ordinary SQL,
 * including strings, comments and trigger bodies, is never split or rewritten. */
function transactionControls(sql: string): TransactionControl[] | undefined {
  let cursor = 0;
  const token = (): { word: string; start: number; end: number } | undefined => {
    while (cursor < sql.length) {
      if (/\s/.test(sql[cursor])) { cursor++; continue; }
      if (sql.startsWith('--', cursor)) { const end = sql.indexOf('\n', cursor + 2); cursor = end < 0 ? sql.length : end + 1; continue; }
      if (sql.startsWith('/*', cursor)) { const end = sql.indexOf('*/', cursor + 2); if (end < 0) return { word: '<invalid>', start: cursor, end: sql.length }; cursor = end + 2; continue; }
      break;
    }
    if (cursor >= sql.length) return undefined;
    const start = cursor, match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(cursor));
    cursor += match?.[0].length ?? 1;
    return { word: match?.[0] ?? sql[start], start, end: cursor };
  };
  let current = token();
  while (current?.word === ';') current = token();
  if (!current || !transactionWords.has(current.word.toUpperCase())) return undefined;
  const result: TransactionControl[] = [];
  const invalid = () => new TypeError('Remote transaction control requires a complete supported control-only script');
  while (current) {
    const start = current.start, word = current.word.toUpperCase(); let kind: TransactionControl['kind'], name: string | undefined;
    current = token();
    const take = (expected: string) => { if (current?.word.toUpperCase() !== expected) return false; current = token(); return true; };
    if (word === 'SAVEPOINT') kind = 'savepoint';
    else if (word === 'RELEASE') { kind = 'release'; take('SAVEPOINT'); }
    else if (word === 'ROLLBACK') { take('TRANSACTION'); kind = take('TO') ? 'rollback-to' : 'rollback'; if (kind === 'rollback-to') take('SAVEPOINT'); }
    else if (word === 'COMMIT' || word === 'END') { kind = 'commit'; take('TRANSACTION'); }
    else if (word === 'BEGIN') { kind = 'begin'; if (current && ['DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'].includes(current.word.toUpperCase())) current = token(); take('TRANSACTION'); }
    else throw invalid();
    if (['savepoint', 'release', 'rollback-to'].includes(kind)) {
      if (!current || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(current.word)) throw invalid();
      name = current.word.toLowerCase(); current = token();
    }
    if (current && current.word !== ';') throw invalid();
    const end = current?.end ?? sql.length;
    result.push({ kind, name, sql: sql.slice(start, end) });
    if (current) current = token();
    while (current?.word === ';') current = token();
    if (current && !transactionWords.has(current.word.toUpperCase())) throw invalid();
  }
  return result;
}

/** libsql0.5.29 / Rust0.9.30 closes a standalone SAVEPOINT's HTTP stream because
 * TxScopeCounter ignores SAVEPOINT. An explicit deferred outer transaction keeps
 * that stream alive. Only its final root release is translated to COMMIT. */
export function withRemoteSavepoints(database: SqlDatabase): SqlDatabase {
  let roots: string[] = [], closed = false, poisoned = false;
  const enter = () => { if (closed || poisoned) throw new TypeError('Remote SQL connection is unavailable'); };
  const reconcile = () => { if (roots.length && !database.isTransaction) roots = []; };
  const poison = () => { poisoned = true; closed = true; roots = []; try { database.close(); } catch {} };
  const execute = (control: TransactionControl) => {
    reconcile();
    if (control.kind === 'savepoint' && !database.isTransaction) {
      try { database.exec(`BEGIN DEFERRED; ${control.sql}`); roots = [control.name!]; }
      catch (error) { poison(); throw error; }
      return;
    }
    const index = control.name === undefined ? -1 : roots.lastIndexOf(control.name);
    if (roots.length && (control.kind === 'commit' || control.kind === 'release' && index === 0)) {
      try { database.exec(control.kind === 'commit' ? control.sql : 'COMMIT'); roots = []; }
      catch (error) { poison(); throw error; }
      return;
    }
    database.exec(control.sql);
    if (roots.length) {
      if (control.kind === 'savepoint') roots.push(control.name!);
      else if (control.kind === 'rollback') roots = [];
      else if (index >= 0 && control.kind === 'release') roots.splice(index);
      else if (index >= 0 && control.kind === 'rollback-to') roots.splice(index + 1);
    }
    reconcile();
  };
  return {
    get isTransaction() { return !closed && !poisoned && database.isTransaction; },
    exec(sql) {
      enter();
      if (coreSchemaBatches.has(createHash('sha256').update(sql).digest('hex'))) {
        try { database.exec(sql); } finally { reconcile(); }
        return;
      }
      const controls = transactionControls(sql);
      if (controls) for (const control of controls) execute(control);
      else { try { database.exec(sql); } finally { reconcile(); } }
    },
    prepare(sql) {
      enter(); if (transactionControls(sql)) throw new TypeError('Use exec for remote transaction control');
      let transaction = database.isTransaction, statement = database.prepare(sql);
      const selected = () => { enter(); const current = database.isTransaction; if (current !== transaction) { statement = database.prepare(sql); transaction = current; } return statement; };
      const failed = (error: unknown): never => {
        // A cursor query that implicitly rolls back does not refresh the pinned
        // client's cached autocommit flag. This fixed read updates its metadata;
        // it never retries the failed user statement.
        if (database.isTransaction) { try { database.exec('SELECT 1'); } catch { poison(); } }
        throw error;
      };
      return {
        get(...values) { try { return selected().get(...values); } catch (error) { return failed(error); } finally { reconcile(); } },
        all(...values) { try { return selected().all(...values); } catch (error) { return failed(error); } finally { reconcile(); } },
        run(...values) { try { return selected().run(...values); } catch (error) { return failed(error); } finally { reconcile(); } },
      };
    },
    close() { if (!closed) { closed = true; roots = []; database.close(); } },
  };
}

const storeWalPrefix = 'PRAGMA journal_mode=WAL;';
/** Explicit remote policy for a vendor-managed WAL database. The selected
 * connection closes if its initial mode cannot be verified. Only Store's known
 * leading statement is consumed; all remaining SQL is forwarded unchanged. */
export function withVerifiedManagedWal(database: SqlDatabase): SqlDatabase {
  const verify = () => {
    if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') throw new TypeError('Remote database must already use WAL journal mode');
  };
  try { verify(); }
  catch (error) { try { database.close(); } catch {} throw error; }
  return {
    get isTransaction() { return database.isTransaction; },
    exec(sql) {
      if (sql.startsWith(storeWalPrefix)) {
        verify();
        const remaining = sql.slice(storeWalPrefix.length);
        if (remaining.trim()) database.exec(remaining);
      } else database.exec(sql);
    },
    prepare: sql => database.prepare(sql),
    close: () => database.close(),
  };
}

export type LibsqlPrimaryConfiguration = Readonly<{ url: string; authToken: string; beforeOperation?: SqlOperationGuard;
  journalMode?: 'require-set-wal' | 'verify-managed-wal'; statementReuse?: 'transaction-hot-select-v1' }>;

/** A remote primary is always explicit. There is no offline or local fallback.
 * A replica adapter can be added only after its synchronization/fencing behavior
 * has separate remote proof; a local-first sync client is not used here. */
export function createLibsqlPrimaryFactory(configuration: LibsqlPrimaryConfiguration): SqlDatabaseFactory {
  const statementReuse = configuration?.statementReuse;
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) ||
      Object.keys(configuration).some(key => !['url', 'authToken', 'beforeOperation', 'journalMode', 'statementReuse'].includes(key)) ||
      typeof configuration.url !== 'string' || typeof configuration.authToken !== 'string' ||
      !configuration.authToken || configuration.authToken.length > 16384 || /[\x00-\x20\x7f]/.test(configuration.authToken) ||
      configuration.beforeOperation !== undefined && typeof configuration.beforeOperation !== 'function' ||
      statementReuse !== undefined && statementReuse !== 'transaction-hot-select-v1' ||
      statementReuse !== undefined && typeof configuration.beforeOperation !== 'function' ||
      configuration.journalMode !== undefined && !['require-set-wal', 'verify-managed-wal'].includes(configuration.journalMode)) throw new TypeError('Invalid remote SQL configuration');
  let url: URL;
  try { url = new URL(configuration.url); } catch { throw new TypeError('Invalid remote SQL configuration'); }
  if (!['libsql:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.port ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)?\.turso\.io$/.test(url.hostname) ||
      !['', '/'].includes(url.pathname) || url.toString() !== configuration.url && url.toString() !== `${configuration.url}/`) throw new TypeError('Invalid remote SQL configuration');
  const { url: databaseUrl, authToken, beforeOperation, journalMode = 'require-set-wal' } = configuration;
  return path => {
    if (path !== databaseUrl) throw new TypeError('Remote SQL identity does not match databasePath');
    const connectionOptions: Libsql.Options & { authToken: string } = { authToken };
    const database = new Libsql(databaseUrl, connectionOptions);
    let adapted: SqlDatabase | undefined;
    try {
      const base = adaptLibsqlDatabase(database, beforeOperation);
      adapted = withRemoteSavepoints(statementReuse === 'transaction-hot-select-v1' ? withTransactionSelectReuse(base, beforeOperation!) : base);
      return journalMode === 'verify-managed-wal' ? withVerifiedManagedWal(adapted) : adapted;
    }
    catch (error) { try { if (adapted) adapted.close(); else database.close(); } catch {} throw error; }
  };
}
