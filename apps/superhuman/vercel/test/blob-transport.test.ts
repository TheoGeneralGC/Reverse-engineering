import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateBodyTransport, BlobTransportError, type PrivateBlobPort, type BodyScope, type BlobBody } from '../src/blob-transport.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import type { ControlSql, ControlTransaction, SqlResult, SqlValue } from '../src/authority.ts';

const actualFetch = globalThis.fetch; let externalFetches = 0;
globalThis.fetch = async () => { externalFetches++; throw new Error('No external fetch in private Blob tests'); };
after(() => { globalThis.fetch = actualFetch; assert.equal(externalFetches, 0); });
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const namespace = 'synthetic-mail';
const scope = (commandId: string, path = '/api/knowledge/sources/files'): BodyScope => ({ namespace, commandId, method: 'POST', path });
const code = (wanted: string) => (error: unknown) => error instanceof BlobTransportError && error.code === wanted;

class NativeControl implements ControlSql {
  private db: DatabaseSync; private tail: Promise<void> = Promise.resolve();
  constructor(databasePath: string, env: { DATABASE_PATH: string }) { assert.equal(databasePath, env.DATABASE_PATH); this.db = new DatabaseSync(databasePath); }
  private raw(sql: string, args: readonly SqlValue[] = []): SqlResult {
    const statement = this.db.prepare(sql);
    if (/^\s*(SELECT|PRAGMA)\b/i.test(sql)) return { rows: statement.all(...args), rowsAffected: 0 };
    return { rows: [], rowsAffected: Number(statement.run(...args).changes) };
  }
  private async lock<T>(work: () => Promise<T>): Promise<T> { const before = this.tail; let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; }); await before; try { return await work(); } finally { release(); } }
  execute(sql: string, args?: readonly SqlValue[]): Promise<SqlResult> { return this.lock(async () => this.raw(sql, args)); }
  transaction<T>(work: (transaction: ControlTransaction) => Promise<T>): Promise<T> {
    return this.lock(async () => { this.db.exec('BEGIN IMMEDIATE'); try { const value = await work({ execute: async (sql, args) => this.raw(sql, args) }); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; } });
  }
  async close() { await this.tail; this.db.close(); }
}
class ImmutableBlob implements PrivateBlobPort {
  objects = new Map<string, Buffer>(); grants = new Map<string, { pathname: string; bytes: number; expiresAt: number }>();
  downloads: { pathname: string; expiresAt: number }[] = []; removed: string[] = []; readPaths: string[] = [];
  uploadError = false; removeError = false; nextGrant = 0;
  beforeRemove?: (pathname: string) => Promise<void>;
  readOverride?: (pathname: string, bytes: Buffer) => Buffer;
  readonly now: () => number;
  constructor(now: () => number) { this.now = now; }
  async uploadGrant(pathname: string, bytes: number, expiresAt: number) {
    if (this.uploadError) throw new Error('Synthetic SDK grant failure');
    const url = `https://synthetic.private.blob.vercel-storage.com/upload/fixture-${++this.nextGrant}`;
    this.grants.set(url, { pathname, bytes, expiresAt }); return { url };
  }
  upload(url: string, bytes: Uint8Array) {
    const grant = this.grants.get(url); assert.ok(grant, 'only an issued upload grant is accepted');
    assert.ok(grant.expiresAt > this.now(), 'the grant has not expired'); assert.equal(bytes.byteLength, grant.bytes);
    assert.equal(this.objects.has(grant.pathname), false, 'uploads cannot overwrite a previously staged object');
    this.objects.set(grant.pathname, Buffer.from(bytes));
  }
  async downloadGrant(pathname: string, expiresAt: number) { this.downloads.push({ pathname, expiresAt }); return { url: `https://synthetic.private.blob.vercel-storage.com/${pathname}?signed=fixture` }; }
  async read(pathname: string) {
    this.readPaths.push(pathname); const stored = this.objects.get(pathname); if (!stored) return null;
    const bytes = this.readOverride?.(pathname, stored) ?? stored; let offset = 0;
    return new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length); controller.enqueue(bytes.subarray(offset, end)); offset = end; } });
  }
  async write(pathname: string, bytes: Uint8Array) { assert.equal(this.objects.has(pathname), false); this.objects.set(pathname, Buffer.from(bytes)); }
  async remove(pathname: string) { await this.beforeRemove?.(pathname); if (this.removeError) throw new Error('Synthetic SDK removal failure'); this.removed.push(pathname); this.objects.delete(pathname); }
}
async function fixture(options: { quotaBytes?: number; maxBodyBytes?: number; lifetimeMs?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rea-private-blob-')), databasePath = join(directory, 'control.sqlite');
  const sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath }); let now = 1_000_000;
  const blob = new ImmutableBlob(() => now); const transport = new PrivateBodyTransport({ sql, blob, namespace, now: () => now, ...options });
  const log = new DurableCommandLog(sql, { namespace, webOrigin: 'https://mail.example.test', now: () => now,
    authorizeBody: async (tx, request, inputScope) => { assert.equal(request.body.kind, 'blob');
      if (request.body.kind === 'blob') await transport.authorizeRequestBody(tx, request.body, inputScope); } });
  await log.initialize(); await transport.initialize();
  async function command(body: BlobBody, inputScope: BodyScope, state: 'queued' | 'claimed' | 'completed' | 'uncertain') {
    await log.enqueue({ id: inputScope.commandId, namespace, request: { method: inputScope.method, path: inputScope.path, headers: { origin: log.webOrigin }, body } });
    await sql.execute('UPDATE runtime_commands SET state=? WHERE namespace=? AND id=?', [state, namespace, inputScope.commandId]);
  }
  return { sql, blob, transport, log, command, getNow: () => now, setNow(value: number) { now = value; },
    rows: async () => (await sql.execute('SELECT * FROM runtime_body_objects ORDER BY created_at,ref')).rows,
    async upload(inputScope: BodyScope, bytes: Uint8Array) { const value = await transport.createRequestUpload(inputScope, bytes.byteLength, sha(bytes)); blob.upload(value.upload.url, bytes); return value.body; },
    async close() { await sql.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('10 MiB and 50 MiB synthetic bodies pass immutable upload, scoped streaming read and exact digest verification', async () => {
  const f = await fixture();
  try {
    for (const size of [10, 50]) {
      const bytes = Buffer.alloc(size * 1024 ** 2, size); bytes[0] = 0; bytes[bytes.length - 1] = 255;
      const inputScope = scope(`large-${size}`, '/api/drafts/synthetic-draft/attachments');
      const grant = await f.transport.createRequestUpload(inputScope, bytes.length, sha(bytes)); f.blob.upload(grant.upload.url, bytes);
      assert.throws(() => f.blob.upload(grant.upload.url, bytes), /overwrite/);
      await f.transport.validateRequestBody(grant.body, inputScope);
      const actual = await f.transport.readRequestBody(grant.body, inputScope);
      assert.equal(actual.byteLength, bytes.byteLength); assert.equal(sha(actual), sha(bytes)); assert.equal(actual[actual.length - 1], 255);
      assert.equal(grant.body.bytes, bytes.length); assert.equal(grant.body.sha256, sha(bytes));
      assert.ok(f.blob.readPaths.at(-1)?.startsWith('mail-rpc/')); assert.ok(!f.blob.readPaths.at(-1)?.includes('https:'));
    }
  } finally { await f.close(); }
});

test('scope, digest and length mismatches cannot read or reuse another command’s staged object', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('Fictional Cedar attachment'); const original = scope('scoped-upload'); const body = await f.upload(original, bytes);
    for (const wrong of [ { ...original, commandId: 'other-command' }, { ...original, method: 'PUT' },
      { ...original, path: '/api/drafts/another-draft/attachments' }, { ...original, namespace: 'other-namespace' } ]) {
      await assert.rejects(f.transport.readRequestBody(body, wrong), error => error instanceof BlobTransportError);
    }
    for (const wrong of [{ ...body, sha256: 'f'.repeat(64) }, { ...body, bytes: body.bytes - 1 }, { ...body, ref: 'https://attacker.test/file' }]) {
      await assert.rejects(f.transport.readRequestBody(wrong, original), error => error instanceof BlobTransportError);
    }
    assert.equal(f.blob.readPaths.length, 0);
    const wrongDigest = await f.transport.createRequestUpload(scope('bad-content'), bytes.length, sha(Buffer.alloc(bytes.length, 1)));
    f.blob.upload(wrongDigest.upload.url, bytes);
    await assert.rejects(f.transport.readRequestBody(wrongDigest.body, scope('bad-content')), code('transport_body_mismatch'));
    f.blob.readOverride = (_pathname, stored) => stored.subarray(0, stored.length - 1);
    await assert.rejects(f.transport.readRequestBody(body, original), code('transport_body_mismatch'));
    f.blob.readOverride = (_pathname, stored) => Buffer.concat([stored, Buffer.from([1])]);
    await assert.rejects(f.transport.readRequestBody(body, original), code('transport_body_mismatch'));
  } finally { await f.close(); }
});

test('only canonical allowed upload API paths receive grants; caller URLs and unrelated paths never reach the SDK', async () => {
  const f = await fixture();
  try {
    for (const path of ['https://attacker.test/api/knowledge/sources/files', '//attacker.test/api/knowledge/sources/files',
      '/api/drafts/a/../b/attachments', '/api/knowledge/sources/files#fragment', '/api/send', '/api/drafts/synthetic/attachments/extra']) {
      await assert.rejects(f.transport.createRequestUpload(scope('invalid-path', path), 8, sha(Buffer.alloc(8))), error => error instanceof BlobTransportError);
    }
    assert.equal(f.blob.grants.size, 0); assert.equal((await f.rows()).length, 0);
  } finally { await f.close(); }
});

test('concurrent quota reservations commit atomically and cannot overbook staging storage', async () => {
  const f = await fixture({ quotaBytes: 1024 });
  try {
    const result = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => f.transport.createRequestUpload(scope(`parallel-${i}`), 256, sha(Buffer.alloc(256, i)))));
    assert.equal(result.filter(value => value.status === 'fulfilled').length, 4);
    const failed = result.filter(value => value.status === 'rejected'); assert.equal(failed.length, 4);
    assert.ok(failed.every(value => value.status === 'rejected' && code('transport_staging_quota')(value.reason)));
    assert.equal((await f.rows()).reduce((sum, row) => sum + Number(row.bytes), 0), 1024); assert.equal(f.blob.grants.size, 4);
  } finally { await f.close(); }
});

test('response downloads are scoped, retain binary bytes, expire within 60 seconds and cannot borrow request objects', async () => {
  const f = await fixture({ lifetimeMs: 100_000 });
  try {
    const inputScope = scope('response-owner', '/api/attachments/fictional-download'); const bytes = Buffer.from([0, 127, 128, 255]);
    const body = await f.transport.writeResponseBody(inputScope, bytes); const responseGrant = await f.transport.responseDownload(body, inputScope);
    assert.equal(responseGrant.expiresAt, f.getNow() + 60_000); assert.equal(sha(f.blob.objects.values().next().value!), sha(bytes));
    await assert.rejects(f.transport.responseDownload(body, { namespace, commandId: 'different-command' }), code('transport_body_not_available'));
    await assert.rejects(f.transport.responseDownload(body, { namespace: 'different-namespace', commandId: inputScope.commandId }), error => error instanceof BlobTransportError);
    const requestBody = await f.upload(scope('request-only'), bytes);
    await assert.rejects(f.transport.responseDownload(requestBody, { namespace, commandId: 'request-only' }), code('transport_body_not_available'));
    f.setNow(f.getNow() + 90_000); const shortGrant = await f.transport.responseDownload(body, inputScope);
    assert.equal(shortGrant.expiresAt, 1_100_000); assert.equal(shortGrant.expiresAt - f.getNow(), 10_000);
    f.setNow(1_100_000); await assert.rejects(f.transport.responseDownload(body, inputScope), code('transport_body_not_available'));
    assert.equal(f.blob.downloads.length, 2);
  } finally { await f.close(); }
});

test('expiry cleanup deletes only its own expired completed bodies and preserves active and uncertain commands', async () => {
  const f = await fixture({ lifetimeMs: 1000 }); const bytes = Buffer.alloc(8);
  try {
    const bodies = new Map<string, BlobBody>();
    for (const state of ['queued', 'claimed', 'completed', 'uncertain'] as const) {
      const inputScope = scope(`cleanup-${state}`); const body = await f.upload(inputScope, bytes); bodies.set(state, body);
      await f.command(body, inputScope, state); if (state === 'completed' || state === 'uncertain') await f.transport.settle(inputScope.commandId, state);
    }
    const other = new PrivateBodyTransport({ sql: f.sql, blob: f.blob, namespace: 'other-namespace', now: f.getNow, lifetimeMs: 1000 });
    await other.initialize(); const foreign = await other.createRequestUpload({ ...scope('foreign'), namespace: 'other-namespace' }, bytes.length, sha(bytes)); f.blob.upload(foreign.upload.url, bytes);
    const retained = new Set(f.blob.objects.keys());
    f.setNow(1_001_000); assert.deepEqual(await f.transport.readRequestBody(bodies.get('queued')!, scope('cleanup-queued')), bytes);
    assert.equal(await f.transport.cleanup(), 0); // One-minute cleanup grace protects recently issued transfers.
    f.setNow(1_061_001); assert.equal(await f.transport.cleanup(), 1);
    assert.equal(f.blob.removed.length, 1); assert.ok(f.blob.removed[0].endsWith(bodies.get('completed')!.ref));
    retained.delete(f.blob.removed[0]); assert.deepEqual(new Set(f.blob.objects.keys()), retained);
    const rows = await f.rows(); assert.equal(rows.find(row => row.ref === bodies.get('completed')!.ref)?.state, 'released');
    assert.notEqual(rows.find(row => row.ref === foreign.body.ref)?.state, 'released');
  } finally { await f.close(); }
});

test('failed grant and removal calls retain quota until confirmed cleanup releases the reserved object', async () => {
  const f = await fixture({ quotaBytes: 512, lifetimeMs: 1000 }); const bytes = Buffer.alloc(512);
  try {
    f.blob.uploadError = true;
    await assert.rejects(f.transport.createRequestUpload(scope('failed-grant'), bytes.length, sha(bytes)), /SDK grant failure/);
    f.blob.uploadError = false;
    await assert.rejects(f.transport.createRequestUpload(scope('second-grant'), bytes.length, sha(bytes)), code('transport_staging_quota'));
    assert.equal((await f.rows())[0].state, 'reserved');
    f.setNow(1_061_001); f.blob.removeError = true; await assert.rejects(f.transport.cleanup(), /SDK removal failure/);
    assert.notEqual((await f.rows())[0].state, 'released', 'failed removal cannot reclaim reserved quota');
    await assert.rejects(f.transport.createRequestUpload(scope('third-grant'), bytes.length, sha(bytes)), code('transport_staging_quota'));
    f.blob.removeError = false; assert.equal(await f.transport.cleanup(), 1);
    assert.equal((await f.rows())[0].state, 'released'); await f.transport.createRequestUpload(scope('after-release'), bytes.length, sha(bytes));
  } finally { await f.close(); }
});

test('cleanup winning the atomic claim rejects a delayed enqueue instead of creating a command with missing bytes', async () => {
  const f = await fixture({ lifetimeMs: 1000 });
  try {
    const inputScope = scope('racing-enqueue'); const body = await f.upload(inputScope, Buffer.alloc(16));
    await f.transport.validateRequestBody(body, inputScope); // HTTP validated before a delayed SQL enqueue.
    f.setNow(1_061_001);
    let attempted = false;
    f.blob.beforeRemove = async () => { attempted = true; await assert.rejects(f.command(body, inputScope, 'queued'), code('transport_body_not_available')); };
    assert.equal(await f.transport.cleanup(), 1); assert.equal(attempted, true);
    assert.equal(f.blob.removed.length, 1); assert.equal(f.blob.objects.size, 0);
    assert.equal(await f.log.readResult(namespace, inputScope.commandId), null);
  } finally { await f.close(); }
});

test('acceptance winning the atomic bind keeps queued bytes readable past upload expiry and returns an existing command', async () => {
  const f = await fixture({ lifetimeMs: 1000 });
  try {
    const inputScope = scope('accepted-before-expiry'); const bytes = Buffer.from('Fictional accepted body'); const body = await f.upload(inputScope, bytes);
    await f.command(body, inputScope, 'queued'); f.setNow(1_061_001);
    assert.equal(await f.transport.cleanup(), 0); assert.equal(f.blob.removed.length, 0);
    await f.transport.validateRequestBody(body, inputScope); assert.deepEqual(await f.transport.readRequestBody(body, inputScope), bytes);
    const duplicate = await f.log.enqueue({ namespace, id: inputScope.commandId, request: { method: inputScope.method, path: inputScope.path, headers: { origin: f.log.webOrigin }, body } });
    assert.equal(duplicate.created, false); assert.equal(duplicate.command.state, 'queued');
  } finally { await f.close(); }
});

test('a completed command remains a cached duplicate after its expired request bytes have been cleaned', async () => {
  const f = await fixture({ lifetimeMs: 1000 });
  try {
    const inputScope = scope('completed-duplicate'); const body = await f.upload(inputScope, Buffer.alloc(16));
    await f.command(body, inputScope, 'completed'); await f.transport.settle(inputScope.commandId, 'completed'); f.setNow(1_061_001);
    assert.equal(await f.transport.cleanup(), 1); assert.equal(f.blob.objects.size, 0);
    await f.transport.validateRequestBody(body, inputScope);
    const duplicate = await f.log.enqueue({ namespace, id: inputScope.commandId, request: { method: inputScope.method, path: inputScope.path, headers: { origin: f.log.webOrigin }, body } });
    assert.equal(duplicate.created, false); assert.equal(duplicate.command.state, 'completed');
    await assert.rejects(f.transport.readRequestBody(body, inputScope), code('transport_body_not_available'));
  } finally { await f.close(); }
});

test('a settled uncertain command can return its existing status without treating the preserved body as a fresh upload', async () => {
  const f = await fixture({ lifetimeMs: 1000 });
  try {
    const inputScope = scope('uncertain-duplicate'); const body = await f.upload(inputScope, Buffer.alloc(16));
    await f.command(body, inputScope, 'uncertain'); await f.transport.settle(inputScope.commandId, 'uncertain'); f.setNow(1_061_001);
    assert.equal(await f.transport.cleanup(), 0);
    await f.transport.validateRequestBody(body, inputScope);
    const duplicate = await f.log.enqueue({ namespace, id: inputScope.commandId, request: { method: inputScope.method, path: inputScope.path, headers: { origin: f.log.webOrigin }, body } });
    assert.equal(duplicate.created, false); assert.equal(duplicate.command.state, 'uncertain'); assert.equal(f.blob.objects.size, 1);
    await assert.rejects(f.transport.readRequestBody(body, inputScope), code('transport_body_not_available')); assert.equal(f.blob.readPaths.length, 0);
  } finally { await f.close(); }
});

test('busy old commands cannot permanently starve later eligible cleanup within a bounded batch', async () => {
  const f = await fixture({ lifetimeMs: 1000 });
  try {
    for (const [i, state] of (['queued', 'claimed', 'completed'] as const).entries()) {
      f.setNow(1_000_000 + i * 10); const inputScope = scope(`cleanup-progress-${i}`); const body = await f.upload(inputScope, Buffer.alloc(16));
      await f.command(body, inputScope, state); if (state === 'completed') await f.transport.settle(inputScope.commandId, 'completed');
    }
    f.setNow(1_061_100);
    assert.equal(await f.transport.cleanup(2), 1, 'a batch must reach eligible objects even when older commands remain active');
    assert.equal(f.blob.removed.length, 1); assert.equal(f.blob.objects.size, 2);
  } finally { await f.close(); }
});

test('corrupted storage metadata cannot turn an owned reference into a foreign read or destructive deletion path', async () => {
  const f = await fixture({ lifetimeMs: 1000 });
  try {
    const inputScope = scope('corrupt-path'); const body = await f.upload(inputScope, Buffer.alloc(16));
    await f.sql.execute('UPDATE runtime_body_objects SET pathname=? WHERE ref=?', ['mail-rpc/foreign-namespace/foreign-object', body.ref]);
    await assert.rejects(f.transport.readRequestBody(body, inputScope), code('transport_body_not_available')); assert.equal(f.blob.readPaths.length, 0);
    f.setNow(1_061_001); await assert.rejects(f.transport.cleanup(), code('transport_body_not_available'));
    assert.equal(f.blob.removed.length, 0); assert.equal(f.blob.objects.size, 1);
  } finally { await f.close(); }
});
