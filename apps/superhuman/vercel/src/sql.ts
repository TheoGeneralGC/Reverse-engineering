import Libsql from 'libsql';
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
  journalMode?: 'require-set-wal' | 'verify-managed-wal' }>;

/** A remote primary is always explicit. There is no offline or local fallback.
 * A replica adapter can be added only after its synchronization/fencing behavior
 * has separate remote proof; a local-first sync client is not used here. */
export function createLibsqlPrimaryFactory(configuration: LibsqlPrimaryConfiguration): SqlDatabaseFactory {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) ||
      Object.keys(configuration).some(key => !['url', 'authToken', 'beforeOperation', 'journalMode'].includes(key)) ||
      typeof configuration.url !== 'string' || typeof configuration.authToken !== 'string' ||
      !configuration.authToken || configuration.authToken.length > 16384 || /[\x00-\x20\x7f]/.test(configuration.authToken) ||
      configuration.beforeOperation !== undefined && typeof configuration.beforeOperation !== 'function' ||
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
    try { adapted = adaptLibsqlDatabase(database, beforeOperation); return journalMode === 'verify-managed-wal' ? withVerifiedManagedWal(adapted) : adapted; }
    catch (error) { try { if (adapted) adapted.close(); else database.close(); } catch {} throw error; }
  };
}
