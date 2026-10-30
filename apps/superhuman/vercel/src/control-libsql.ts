import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client/http';
import type { Client, ResultSet, Transaction } from '@libsql/client';
import type { ControlSql, ControlTransaction, SqlResult, SqlRow, SqlValue } from './authority.ts';

type ControlSdkTransaction = Pick<Transaction, 'execute' | 'commit' | 'rollback' | 'close'>;
export type ControlClient = Pick<Client, 'execute' | 'close'> & { transaction(mode: 'write'): Promise<ControlSdkTransaction> };
type TransactionScope = { transaction: ControlSdkTransaction; accepting: boolean; active: boolean;
  tail: Promise<void>; failed: boolean; failure?: unknown };
export class ControlSqlError extends Error {
  readonly code: string;
  constructor(code: string) { super('The durable control database is unavailable.'); this.code = code; }
}
const minimumInteger = -(2n ** 63n), maximumInteger = 2n ** 63n - 1n;
function statement(sql: string, args: readonly SqlValue[] = []): { sql: string; args: SqlValue[] } {
  if (typeof sql !== 'string' || !sql.trim() || sql.includes('\0') || !Array.isArray(args)) throw new TypeError('Invalid control statement');
  return { sql, args: args.map(value => {
    if (value === null || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    if (typeof value === 'bigint' && value >= minimumInteger && value <= maximumInteger) return value;
    if (value instanceof Uint8Array) return new Uint8Array(value);
    throw new TypeError('Invalid control binding');
  }) };
}
function result(source: ResultSet): SqlResult {
  if (!Number.isSafeInteger(source.rowsAffected) || source.rowsAffected < 0 ||
      !Array.isArray(source.columns) || source.columns.some(column => typeof column !== 'string')) throw new ControlSqlError('control_result_invalid');
  const rows = source.rows.map(values => {
    if (values.length !== source.columns.length) throw new ControlSqlError('control_result_invalid');
    const row: SqlRow = Object.create(null);
    source.columns.forEach((column, index) => {
      const value = values[index];
      if (value === null || typeof value === 'string') row[column] = value;
      else if (typeof value === 'bigint') row[column] = value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
      else if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) row[column] = value;
      else if (value instanceof ArrayBuffer) row[column] = new Uint8Array(value.slice(0));
      else if (ArrayBuffer.isView(value)) row[column] = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      else throw new ControlSqlError('control_result_invalid');
    });
    return row;
  });
  return { rows, rowsAffected: source.rowsAffected };
}

/** All authority statements use the primary. A transaction callback holds a real
 * SDK write transaction and one adapter admission slot until commit/rollback.
 * This adapter never retries an uncertain commit or switches to a local file. */
export class LibsqlControl implements ControlSql {
  private readonly client: ControlClient;
  private readonly context = new AsyncLocalStorage<TransactionScope>();
  private tail: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;
  private poisoned = false;
  private closePromise?: Promise<void>;
  constructor(client: ControlClient) { this.client = client; }
  private available(): void {
    if (this.poisoned || this.closed) throw new ControlSqlError(this.poisoned ? 'control_commit_uncertain' : 'control_closed');
  }
  private admit<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new ControlSqlError('control_closed'));
    const pending = this.tail.then(async () => { this.available(); return work(); });
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
  private within(scope: TransactionScope, input: ReturnType<typeof statement>): Promise<SqlResult> {
    if (!scope.accepting || !scope.active) return Promise.reject(new ControlSqlError('control_transaction_closed'));
    const pending = scope.tail.then(async () => {
      this.available();
      if (!scope.active || scope.failed) throw new ControlSqlError('control_transaction_failed');
      try { return result(await scope.transaction.execute(input)); }
      catch (error) { scope.failed = true; scope.failure = error; throw error; }
    });
    // Record failure even when a callback starts a statement without awaiting it.
    scope.tail = pending.then(() => undefined, error => { if (!scope.failed) { scope.failed = true; scope.failure = error; } });
    return pending;
  }
  execute(sql: string, args?: readonly SqlValue[]): Promise<SqlResult> {
    let input: ReturnType<typeof statement>;
    try { input = statement(sql, args); } catch (error) { return Promise.reject(error); }
    const scope = this.context.getStore();
    if (scope) return this.within(scope, input);
    return this.admit(async () => result(await this.client.execute(input)));
  }
  transaction<T>(work: (transaction: ControlTransaction) => Promise<T>): Promise<T> {
    if (typeof work !== 'function') return Promise.reject(new TypeError('Invalid control transaction callback'));
    // The SDK has no nested transaction callback API. Never pretend a second
    // callback has independent rollback semantics or accidentally deadlock it.
    if (this.context.getStore()) return Promise.reject(new ControlSqlError('control_nested_transaction_unsupported'));
    return this.admit(async () => {
      const transaction = await this.client.transaction('write');
      const scope: TransactionScope = { transaction, accepting: true, active: true, tail: Promise.resolve(), failed: false };
      const port: ControlTransaction = { execute: (sql, args) => {
        try { return this.within(scope, statement(sql, args)); } catch (error) { return Promise.reject(error); }
      } };
      let value!: T, failure: unknown, failed = false;
      try {
        try { value = await this.context.run(scope, () => work(port)); }
        catch (error) { failure = error; failed = true; }
        scope.accepting = false;
        await scope.tail;
        if (scope.failed) { if (!failed) failure = scope.failure; failed = true; }
        if (failed) {
          try { await transaction.rollback(); }
          catch { this.poisoned = true; throw new ControlSqlError('control_rollback_uncertain'); }
          throw failure;
        }
        try { await transaction.commit(); }
        catch { this.poisoned = true; throw new ControlSqlError('control_commit_uncertain'); }
        return value;
      } finally {
        scope.accepting = false; scope.active = false;
        try { transaction.close(); } catch { this.poisoned = true; }
      }
    });
  }
  close(): Promise<void> {
    if (this.context.getStore()) return Promise.reject(new ControlSqlError('control_close_during_transaction'));
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.tail.then(() => { this.closed = true; this.client.close(); });
    return this.closePromise;
  }
}

/** Explicit production configuration; file URLs, replicas and environment
 * credential defaults are intentionally absent. No connection is opened here. */
export function createLibsqlControl(options: { url: string; authToken: string }): LibsqlControl {
  if (!options || typeof options.url !== 'string' || typeof options.authToken !== 'string' ||
      !options.authToken || /[\x00-\x20\x7f]/.test(options.authToken)) throw new TypeError('Invalid durable control configuration');
  let url: URL;
  try { url = new URL(options.url); } catch { throw new TypeError('Invalid durable control configuration'); }
  if (!['libsql:', 'https:'].includes(url.protocol) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)?\.turso\.io$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname) ||
      options.url !== `${url.protocol}//${url.hostname}`) throw new TypeError('Invalid durable control configuration');
  return new LibsqlControl(createClient({ url: options.url, authToken: options.authToken, intMode: 'bigint', concurrency: 1 }));
}
