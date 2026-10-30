import type { SqlDatabase, SqlStatement, SqlValue } from '../../api/src/sql-database.ts';
import type { SqlOperationGuard } from './sql.ts';

const hotSelects = new Set([
  'SELECT data FROM records WHERE kind=? AND id=?',
  'SELECT * FROM auto_draft_ready_accounts WHERE account_id=?',
  'SELECT * FROM google_ingress_meta WHERE account_id=?',
]);
type Entry = { statement: SqlStatement; generation: symbol; transaction: boolean; busy: boolean };

/** Reuse only native preparation metadata inside a conservative transaction
 * segment. Each invocation still binds and executes through the original port. */
export function withTransactionSelectReuse(database: SqlDatabase, beforePrepare: SqlOperationGuard): SqlDatabase {
  if (typeof beforePrepare !== 'function') throw new TypeError('Statement reuse requires the original SQL operation guard');
  let closed = false, generation = Symbol(), transaction = database.isTransaction;
  const entries = new Map<string, Entry>();
  const enter = () => { if (closed) throw new TypeError('SQL database is closed'); };
  const invalidate = () => {
    entries.clear();
    generation = Symbol();
  };
  const observe = () => {
    enter(); const current = database.isTransaction;
    if (current !== transaction) { invalidate(); transaction = current; }
    return current;
  };
  const failed = (error: unknown): never => {
    invalidate(); try { transaction = database.isTransaction; } catch {}
    throw error;
  };
  const prepareEntry = (sql: string): Entry => {
    const current = observe(), selectedGeneration = generation;
    const statement = database.prepare(sql);
    if (observe() !== current || generation !== selectedGeneration) {
      invalidate(); throw new TypeError('SQL preparation generation changed');
    }
    return { statement, generation, transaction: current, busy: false };
  };
  const barrier = <T>(work: () => T): T => {
    enter(); invalidate();
    try { const value = work(); observe(); return value; }
    catch (error) { return failed(error); }
    finally { invalidate(); }
  };
  return {
    get isTransaction() { return closed ? false : observe(); },
    exec(sql) { barrier(() => database.exec(sql)); },
    prepare(sql) {
      try {
        enter(); const current = observe();
        if (!hotSelects.has(sql)) {
          const statement = database.prepare(sql);
          return {
            get: (...values) => barrier(() => statement.get(...values)),
            all: (...values) => barrier(() => statement.all(...values)),
            run: (...values) => barrier(() => statement.run(...values)),
          };
        }
        let privateEntry: Entry | undefined;
        const cached = current ? entries.get(sql) : undefined;
        if (cached && !cached.busy) beforePrepare(Object.freeze({ kind: 'prepare', sql }));
        else privateEntry = prepareEntry(sql);
        const select = (): Entry => {
          const active = observe();
          const cached = active ? entries.get(sql) : undefined;
          if (cached && !cached.busy) return cached;
          if (privateEntry && privateEntry.generation === generation && privateEntry.transaction === active && !privateEntry.busy) return privateEntry;
          const entry = prepareEntry(sql);
          privateEntry = entry;
          return entry;
        };
        const execute = <T>(method: 'get' | 'all' | 'run', values: SqlValue[]): T => {
          try {
            enter(); const entry = select(); entry.busy = true;
            try {
              const invoke = () => entry.statement[method](...values) as T;
              const value = method === 'get' ? invoke() : barrier(invoke);
              const active = observe();
              // A successful read establishes the transaction's schema snapshot.
              // Described-but-unconsumed handles are never shared.
              if (method === 'get' && active && entry.generation === generation && !entries.get(sql)?.busy) {
                entries.set(sql, entry); privateEntry = undefined;
              }
              return value;
            } finally { entry.busy = false; }
          } catch (error) { return failed(error); }
        };
        return {
          get: (...values) => execute<ReturnType<SqlStatement['get']>>('get', values),
          all: (...values) => execute<ReturnType<SqlStatement['all']>>('all', values),
          run: (...values) => execute<ReturnType<SqlStatement['run']>>('run', values),
        };
      } catch (error) { return failed(error); }
    },
    close() { if (!closed) { closed = true; invalidate(); database.close(); } },
  };
}
