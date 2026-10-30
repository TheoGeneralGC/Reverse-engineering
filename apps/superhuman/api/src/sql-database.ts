import type { SQLInputValue, SQLOutputValue, StatementResultingChanges } from 'node:sqlite';

/** The synchronous surface used by Core. Native-only instrumentation is not a
 * remote capability. The local default remains the actual Node DatabaseSync. */
export type SqlValue = SQLInputValue;
export type SqlRow = Record<string, SQLOutputValue>;
export interface SqlStatement {
  get(...values: SqlValue[]): SqlRow | undefined;
  all(...values: SqlValue[]): SqlRow[];
  run(...values: SqlValue[]): Pick<StatementResultingChanges, 'changes' | 'lastInsertRowid'>;
}
export interface SqlDatabase {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}
export type SqlDatabaseFactory = (path: string) => SqlDatabase;

export function assertSqlDatabase(value: unknown): asserts value is SqlDatabase {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof (value as SqlDatabase).exec !== 'function' ||
      typeof (value as SqlDatabase).prepare !== 'function' ||
      typeof (value as SqlDatabase).close !== 'function' ||
      typeof (value as SqlDatabase).isTransaction !== 'boolean') {
    throw new TypeError('Database factory must return a synchronous SQL database');
  }
}
