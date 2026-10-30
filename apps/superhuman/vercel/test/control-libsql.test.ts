import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import type { InStatement, ResultSet } from '@libsql/client';
import type { ControlTransaction } from '../src/authority.ts';
import { LibsqlControl, createLibsqlControl, type ControlClient } from '../src/control-libsql.ts';

const originalFetch = globalThis.fetch; let network = 0;
globalThis.fetch = async () => { network++; throw new Error('Control tests prohibit external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(network, 0); });
const empty = (): ResultSet => ({ columns: [], columnTypes: [], rows: [], rowsAffected: 0, lastInsertRowid: undefined, toJSON: () => null });
function fake(options: { commitFailure?: boolean; rollbackFailure?: boolean; statementFailure?: boolean } = {}) {
  const calls: string[] = [], inputs: InStatement[] = [];
  const client: ControlClient = {
    execute: async input => { calls.push('outside'); inputs.push(input); return empty(); },
    transaction: async (mode?: 'write' | 'read' | 'deferred') => {
      calls.push(`begin:${mode}`);
      return {
        execute: async (input: InStatement) => { calls.push('inside'); inputs.push(input); if (options.statementFailure) throw new Error('synthetic failed SQL'); return empty(); },
        commit: async () => { calls.push('commit'); if (options.commitFailure) throw new Error('synthetic lost acknowledgement'); },
        rollback: async () => { calls.push('rollback'); if (options.rollbackFailure) throw new Error('synthetic rollback failure'); },
        close: () => { calls.push('close-transaction'); }
      };
    }, close: () => { calls.push('close-client'); }
  };
  return { client, calls, inputs, sql: new LibsqlControl(client) };
}
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

test('actual isolated SDK memory database commits atomically, rolls back, preserves BLOB and exact integers', async () => {
  const client = createClient({ url: 'file::memory:', intMode: 'bigint' });
  const sql = new LibsqlControl(client);
  try {
    await sql.execute('CREATE TABLE fictional(id INTEGER PRIMARY KEY,body BLOB,label TEXT)');
    await sql.transaction(async tx => {
      await tx.execute('INSERT INTO fictional VALUES(?,?,?)', [9007199254740993n, new Uint8Array([0, 1, 255]), 'Cedar']);
      assert.equal((await sql.execute('SELECT count(*) AS n FROM fictional')).rows[0].n, 1);
    });
    const row = (await sql.execute('SELECT id,body,label,7 AS "__proto__" FROM fictional')).rows[0];
    assert.equal(Object.getPrototypeOf(row), null); assert.equal(row.__proto__, 7);
    assert.equal(row.id, 9007199254740993n); assert.deepEqual(row.body, new Uint8Array([0, 1, 255]));
    await assert.rejects(sql.transaction(async tx => { await tx.execute("INSERT INTO fictional VALUES(2,X'01','rollback')"); throw new Error('Cedar rollback'); }), /Cedar rollback/);
    assert.equal((await sql.execute('SELECT count(*) AS n FROM fictional')).rows[0].n, 1);
  } finally { await sql.close(); }
});

test('top-level work serializes around a real write transaction and callback executes share its connection', async () => {
  const f = fake(), started = gate(), resume = gate();
  const first = f.sql.transaction(async tx => {
    await tx.execute('SELECT 1'); started.release(); await resume.promise;
    await f.sql.execute('SELECT 2');
    await Promise.all([tx.execute('SELECT 3'), tx.execute('SELECT 4')]);
  });
  await started.promise;
  const outside = f.sql.execute('SELECT 5');
  await Promise.resolve(); assert.deepEqual(f.calls, ['begin:write', 'inside']);
  resume.release(); await Promise.all([first, outside]);
  assert.deepEqual(f.calls, ['begin:write', 'inside', 'inside', 'inside', 'inside', 'commit', 'close-transaction', 'outside']);
  await f.sql.close();
});

test('nested callback transaction refuses explicitly without committing or deadlocking the outer callback', async () => {
  const f = fake();
  await f.sql.transaction(async tx => {
    await assert.rejects(f.sql.transaction(async nested => { await nested.execute('SELECT 0'); }), { code: 'control_nested_transaction_unsupported' });
    await tx.execute('SELECT 1');
  });
  assert.deepEqual(f.calls, ['begin:write', 'inside', 'commit', 'close-transaction']); await f.sql.close();
});

test('unknown commit acknowledgement poisons the instance, with no retry, rollback, replay or fallback', async () => {
  const f = fake({ commitFailure: true });
  await assert.rejects(f.sql.transaction(async tx => { await tx.execute('UPDATE fictional SET id=1'); }), { code: 'control_commit_uncertain' });
  await assert.rejects(f.sql.execute('SELECT 1'), { code: 'control_commit_uncertain' });
  await assert.rejects(f.sql.transaction(async () => {}), { code: 'control_commit_uncertain' });
  assert.deepEqual(f.calls, ['begin:write', 'inside', 'commit', 'close-transaction']); await f.sql.close();
});

test('accepted unawaited statements drain before commit, and SDK row decoration cannot replace SQL columns', async () => {
  const f = fake(), start = gate(), resume = gate();
  f.client.transaction = async () => ({
    execute: async () => { f.calls.push('inside'); start.release(); await resume.promise; return empty(); },
    commit: async () => { f.calls.push('commit'); }, rollback: async () => { f.calls.push('rollback'); }, close: () => { f.calls.push('close-transaction'); }
  });
  const pending = f.sql.transaction(async tx => { void tx.execute('SELECT 1'); });
  await start.promise; assert.deepEqual(f.calls, ['inside']); resume.release(); await pending;
  assert.deepEqual(f.calls, ['inside', 'commit', 'close-transaction']);
  const bytes = new Uint8Array([0, 7, 255]);
  f.client.execute = async () => ({ ...empty(), columns: ['value', '__proto__', 'bytes'], rows: [
    Object.assign([9n, 'Cedar', bytes.buffer], { value: 'decorated-wrong-value', _metadata: 'ignore-this' })
  ] } as unknown as ResultSet);
  const row = (await f.sql.execute('SELECT value,"__proto__",bytes FROM fictional')).rows[0];
  assert.equal(row.value, 9); assert.equal(row.__proto__, 'Cedar'); assert.equal(Object.getPrototypeOf(row), null);
  bytes.fill(99); assert.deepEqual(row.bytes, new Uint8Array([0, 7, 255])); assert.equal('_metadata' in row, false);
  f.client.execute = async () => ({ ...empty(), columns: ['unsafe'], rows: [[9007199254740992]] } as unknown as ResultSet);
  await assert.rejects(f.sql.execute('SELECT unsafe FROM fictional'), { code: 'control_result_invalid' }); await f.sql.close();
});

test('statement failure cannot be caught to authorize a partial commit; failed rollback poisons the instance', async () => {
  const f = fake({ statementFailure: true, rollbackFailure: true });
  await assert.rejects(f.sql.transaction(async tx => { await tx.execute('UPDATE fictional SET id=1').catch(() => {}); }), { code: 'control_rollback_uncertain' });
  await assert.rejects(f.sql.execute('SELECT 1'), { code: 'control_commit_uncertain' });
  assert.deepEqual(f.calls, ['begin:write', 'inside', 'rollback', 'close-transaction']); await f.sql.close();
});

test('escaped handles and detached async-context work cannot run after the callback boundary', async () => {
  const f = fake(), late = gate(); let escaped!: ControlTransaction; let detached!: Promise<void>;
  await f.sql.transaction(async tx => {
    escaped = tx;
    detached = (async () => { await late.promise; await assert.rejects(f.sql.execute('SELECT 99'), { code: 'control_transaction_closed' }); })();
    await tx.execute('SELECT 1');
  });
  await assert.rejects(escaped.execute('SELECT 2'), { code: 'control_transaction_closed' });
  late.release(); await detached;
  assert.deepEqual(f.calls, ['begin:write', 'inside', 'commit', 'close-transaction']); await f.sql.close();
});

test('input bytes are snapshotted at admission, invalid bindings fail before SDK work, and close drains accepted work', async () => {
  const f = fake(), start = gate(), resume = gate();
  const first = f.sql.transaction(async () => { start.release(); await resume.promise; await assert.rejects(f.sql.close(), { code: 'control_close_during_transaction' }); });
  await start.promise;
  const bytes = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
  const write = f.sql.execute('SELECT ?', [bytes]); bytes.fill(99);
  for (const value of [NaN, Infinity, 9007199254740992, 2n ** 63n, true, new Date()]) await assert.rejects(f.sql.execute('SELECT ?', [value as never]), /Invalid control binding/);
  const close = f.sql.close(); await assert.rejects(f.sql.execute('SELECT 3'), { code: 'control_closed' });
  resume.release(); await Promise.all([first, write, close]);
  assert.deepEqual((f.inputs[0] as { args: Uint8Array[] }).args[0], new Uint8Array([1, 2]));
  assert.equal(f.calls.at(-1), 'close-client'); await f.sql.close();
});

test('production factory refuses local, credential-free and noncanonical configurations before any network call', () => {
  for (const url of ['file::memory:', 'http://sample.turso.io', 'https://example.org', 'libsql://sample.turso.io/path', 'libsql://sample.turso.io?authToken=x', 'libsql://sample.turso.io/', 'libsql://user:pass@sample.turso.io', 'https://SAMPLE.turso.io'])
    assert.throws(() => createLibsqlControl({ url, authToken: 'fictional-token' }), /Invalid durable control configuration/);
  assert.throws(() => createLibsqlControl({ url: 'libsql://sample.turso.io', authToken: '' }), /Invalid durable control configuration/);
});
