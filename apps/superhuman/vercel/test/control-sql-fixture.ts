import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { ControlSql, ControlTransaction, SqlResult, SqlValue } from '../src/authority.ts';

export class NativeControl implements ControlSql {
  private db: DatabaseSync; private tail: Promise<void> = Promise.resolve();
  constructor(databasePath: string, env: { DATABASE_PATH: string }) { assert.equal(databasePath, env.DATABASE_PATH); this.db = new DatabaseSync(databasePath); }
  private raw(sql: string, args: readonly SqlValue[] = []): SqlResult {
    const statement = this.db.prepare(sql);
    if (/^\s*(?:SELECT|PRAGMA)\b/i.test(sql)) return { rows: statement.all(...args), rowsAffected: 0 };
    const result = statement.run(...args); return { rows: [], rowsAffected: Number(result.changes) };
  }
  private async lock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail; let release!: () => void; this.tail = new Promise(resolve => { release = resolve; });
    await previous; try { return await work(); } finally { release(); }
  }
  execute(sql: string, args?: readonly SqlValue[]): Promise<SqlResult> { return this.lock(async () => this.raw(sql, args)); }
  transaction<T>(work: (transaction: ControlTransaction) => Promise<T>): Promise<T> {
    return this.lock(async () => { this.db.exec('BEGIN IMMEDIATE'); try { const value = await work({ execute: async (sql, args) => this.raw(sql, args) }); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; } });
  }
  async close(): Promise<void> { await this.tail; this.db.close(); }
}
