import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeControl } from './control-sql-fixture.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import { PersonalTenantRegistry } from '../src/auth-registry.ts';
import { CommandAuthorizationRecords } from '../src/auth-command-record.ts';
import type { CommandAuthorization } from '../src/auth-sessions.ts';
import { AppAuthError } from '../src/auth-values.ts';
const schema = await Promise.all(['auth-registry-schema.sql', 'auth-command-schema.sql'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
let opened = 0, closed = 0;
after(() => { const networkAttempts = (globalThis as unknown as Record<symbol, { attempts: number }>)[Symbol.for('rea.generated-cloud.network-denied')]!.attempts;
  assert.equal(networkAttempts, 0); assert.equal(opened, closed); console.log('auth_records_metadata', JSON.stringify({ networkAttempts, opened, closed })); });
const denied = (e: unknown) => e instanceof AppAuthError && e.code === 'auth_command_denied';
const corrupt = (e: unknown) => e instanceof AppAuthError && e.code === 'auth_command_corrupt';
async function fixture() {
  const sql = new NativeControl(':memory:', { DATABASE_PATH: ':memory:' }); opened++; const now = Date.now();
  await new DurableCommandLog(sql, { namespace: 'runtime-A', webOrigin: 'https://mail.example.test' }).initialize();
  for (const value of schema) for (const statement of value.split(';').filter(s => s.trim())) await sql.execute(statement);
  const metadata = new Map<string, CommandAuthorization>(), fingerprints = new Map<string, string>();
  for (const name of ['A', 'B']) {
    await sql.execute("INSERT INTO app_users VALUES(?,'active',1,?)", [`user-${name}`, now]);
    await sql.execute("INSERT INTO personal_tenants VALUES(?,?,'active',1)", [`tenant-${name}`, `user-${name}`]);
    await sql.execute("INSERT INTO personal_memberships VALUES(?,?,'active',1)", [`user-${name}`, `tenant-${name}`]);
    await sql.execute("INSERT INTO tenant_storage VALUES(?,?,?,?,?,1,'active')", [`storage-${name}`, `tenant-${name}`, `primary-${name}`, `secret-${name}`, `key-${name}`]);
    await sql.execute('INSERT INTO tenant_runtimes VALUES(?,?,?,1)', [`runtime-${name}`, `tenant-${name}`, `storage-${name}`]);
    await sql.execute("INSERT INTO app_sessions VALUES(?,?,?,?,1,1,'interactive-product',?,'active',?,?,?,?)", [`session-${name}`, Buffer.alloc(32, name === 'A' ? 1 : 2), 1,
      `user-${name}`, Buffer.alloc(32, name === 'A' ? 3 : 4), now, now, now + 8 * 3_600_000, now + 7 * 24 * 3_600_000]);
    const log = new DurableCommandLog(sql, { namespace: `runtime-${name}`, webOrigin: 'https://mail.example.test' });
    await log.enqueue({ namespace: `runtime-${name}`, id: 'same-id', request: { method: 'GET', path: '/api/threads/same-thread', headers: {}, body: { kind: 'inline', base64: '' } } });
    const fp = (await sql.execute('SELECT fingerprint FROM runtime_commands WHERE namespace=?', [`runtime-${name}`])).rows[0]!.fingerprint;
    fingerprints.set(name, String(fp));
    metadata.set(name, { userId: `user-${name}`, userAuthEpoch: 1, tenantId: `tenant-${name}`, tenantAuthzEpoch: 1, membershipAuthzEpoch: 1,
      storageRef: `storage-${name}`, storageGeneration: 1, namespace: `runtime-${name}`, sessionRecordId: `session-${name}`, sessionGeneration: 1, purpose: 'interactive-product', policyVersion: 1 });
  }
  const registry = new PersonalTenantRegistry(sql, ['A', 'B'].map(name => ({ storageRef: `storage-${name}`, tenantId: `tenant-${name}`, primaryRef: `primary-${name}`,
    secretRef: `secret-${name}`, keyRef: `key-${name}`, generation: 1, namespace: `runtime-${name}` })));
  const key = Buffer.alloc(32, 91), records = new Map(['A', 'B'].map(name => [name, new CommandAuthorizationRecords({ registry, namespace: `runtime-${name}`, macKey: key, keyVersion: 1, now: () => now })]));
  for (const name of ['A', 'B']) await sql.transaction(tx => records.get(name)!.bind(tx, { id: 'same-id', fingerprint: fingerprints.get(name)!, authorization: metadata.get(name)! }));
  return { sql, registry, key, records, metadata, fingerprints, now,
    read: (name: string) => sql.transaction(tx => records.get(name)!.read(tx, { id: 'same-id', fingerprint: fingerprints.get(name)! })),
    close: async () => { await sql.close(); closed++; } };
}

test('actual keyed sidecars bind namespace/fingerprint/owner, copy keys and refuse foreign or serialized record evidence', async () => {
  const f = await fixture();
  try {
    const a = f.records.get('A')!, record = await f.read('A'); assert.ok(record); assert.deepEqual(JSON.parse(JSON.stringify(record)), {});
    a.assertReader(record, f.metadata.get('A')!); assert.throws(() => a.assertReader(record, f.metadata.get('B')!), denied);
    assert.throws(() => a.metadata(JSON.parse(JSON.stringify(record))), corrupt);
    const before = (await f.sql.execute('SELECT * FROM app_command_authorizations')).rows;
    await assert.rejects(f.sql.transaction(tx => a.bind(tx, { id: 'same-id', fingerprint: f.fingerprints.get('A')!, authorization: f.metadata.get('B')! })), denied);
    assert.deepEqual((await f.sql.execute('SELECT * FROM app_command_authorizations')).rows, before);
    f.key.fill(0); assert.ok(await f.read('A'));
    const wrong = new CommandAuthorizationRecords({ registry: f.registry, namespace: 'runtime-A', macKey: Buffer.alloc(32, 92), keyVersion: 1 });
    await assert.rejects(f.sql.transaction(tx => wrong.read(tx, { id: 'same-id', fingerprint: f.fingerprints.get('A')! })), corrupt);
  } finally { await f.close(); }
});

test('malformed stored authorization or key version is corruption rather than a known user denial', async () => {
  const f = await fixture();
  try {
    const original = (await f.sql.execute("SELECT authorization_json FROM app_command_authorizations WHERE namespace='runtime-A'")).rows[0]!.authorization_json;
    await f.sql.execute("UPDATE app_command_authorizations SET authorization_json=? WHERE namespace='runtime-A'", [JSON.stringify({ ...f.metadata.get('A')!, userId: 'bad user id' })]);
    await assert.rejects(f.read('A'), corrupt);
    await f.sql.execute("UPDATE app_command_authorizations SET authorization_json=?,key_version='malformed' WHERE namespace='runtime-A'", [original!]);
    await assert.rejects(f.read('A'), corrupt);
  } finally { await f.close(); }
});

test('unissued work requires current session/epochs while completed receipt access permits same-owner reauthentication', async () => {
  const f = await fixture();
  try {
    const a = f.records.get('A')!, record = await f.read('A'); assert.ok(record);
    await f.sql.transaction(tx => a.assertWorkerCurrent(tx, record));
    await f.sql.execute("UPDATE app_sessions SET state='revoked' WHERE user_id='user-A'");
    await assert.rejects(f.sql.transaction(tx => a.assertWorkerCurrent(tx, record)), denied);
    await f.sql.transaction(tx => a.assertWorkerCurrent(tx, record, { requireSession: false }));
    a.assertReader(record, { ...f.metadata.get('A')!, userAuthEpoch: 2, sessionRecordId: 'new-session', sessionGeneration: 2 });
    await f.sql.execute("UPDATE personal_memberships SET authz_epoch=2 WHERE user_id='user-A'");
    await assert.rejects(f.sql.transaction(tx => a.assertWorkerCurrent(tx, record, { requireSession: false })), denied);
  } finally { await f.close(); }
});

test('malformed current registry epochs fail as corruption rather than manufacturing a known denial', async () => {
  const f = await fixture();
  try {
    const a = f.records.get('A')!, record = await f.read('A'); assert.ok(record);
    await f.sql.execute("UPDATE personal_memberships SET authz_epoch='malformed' WHERE user_id='user-A'");
    assert.equal((await f.sql.execute("SELECT authz_epoch FROM personal_memberships WHERE user_id='user-A'")).rows[0]!.authz_epoch, 'malformed');
    await assert.rejects(f.sql.transaction(tx => a.assertWorkerCurrent(tx, record)), corrupt);
  } finally { await f.close(); }
});
