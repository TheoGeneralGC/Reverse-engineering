import '../../api/test/archive-network-deny.ts';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// Exercise the actual factory without constructing a native remote connection.
// The existing native-file controls cover statement/value behavior separately.
const databases = [];
class FakeNative {
  inTransaction = true;
  preparations = 0;
  executions = 0;
  closed = false;
  constructor() { databases.push(this); }
  defaultSafeIntegers() {}
  prepare() {
    this.preparations++;
    return {
      reader: true,
      columns: () => [{ name: 'data' }],
      raw() { return this; },
      get: () => [String(++this.executions)],
    };
  }
  close() { this.closed = true; }
}
mock.module('libsql', { defaultExport: FakeNative });
const source = process.argv[2] ?? new URL('../src/sql.ts', import.meta.url).href;
const { createLibsqlPrimaryFactory } = await import(source);
const mode = 'transaction-hot-select-v1', rows = [];
for (const spec of [
  { name: 'default-off-mutated-on', initial: undefined, mutation: mode, expected: 2 },
  { name: 'on-mutated-other', initial: mode, mutation: 'other', expected: 1 },
  { name: 'on-mutated-undefined', initial: mode, mutation: undefined, expected: 1 },
]) {
  let prepares = 0, executions = 0;
  const configuration = { url: 'libsql://fictional.turso.io', authToken: 'fictional-only', statementReuse: spec.initial,
    beforeOperation(operation) { if (operation.kind === 'prepare') prepares++; if (operation.kind === 'get') executions++; } };
  const factory = createLibsqlPrimaryFactory(configuration);
  configuration.statementReuse = spec.mutation;
  const db = factory(configuration.url), raw = databases.at(-1);
  try {
    const sql = 'SELECT data FROM records WHERE kind=? AND id=?';
    assert.equal(db.prepare(sql).get('fixture', 'a').data, '1');
    assert.equal(db.prepare(sql).get('fixture', 'b').data, '2');
    rows.push({ name: spec.name, nativePreparations: raw.preparations, nativeExecutions: raw.executions, prepareGuards: prepares, executionGuards: executions });
  } finally { db.close(); }
}
assert.equal(databases.length, 3); assert(databases.every(db => db.closed));
assert.deepEqual(rows.map(row => row.nativePreparations), [2, 1, 1]);
assert(rows.every(row => row.nativeExecutions === 2 && row.prepareGuards === 2 && row.executionGuards === 2));
assert.equal(globalThis[Symbol.for('rea.generated-cloud.network-denied')].attempts, 0);
console.log(JSON.stringify({ status: 'pass', cases: rows, realNativeConstructors: 0, externalAttempts: 0 }));
