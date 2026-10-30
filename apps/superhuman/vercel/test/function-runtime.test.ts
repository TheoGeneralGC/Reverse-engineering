import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request as httpRequest } from 'node:http';
import { createClient } from '@libsql/client';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCoreActor } from '../src/actor.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import { PrivateBodyTransport, type PrivateBlobPort } from '../src/blob-transport.ts';
import { createFunctionRuntime, createFunctionHandler, loadFunctionConfiguration } from '../src/function-runtime.ts';
import { LibsqlControl, type ControlClient } from '../src/control-libsql.ts';
import { NativeControl } from './control-sql-fixture.ts';
const namespace = 'synthetic-mail', origin = 'https://mail.example.test';
const env = { VERCEL_ENV: 'production', MAIL_RUNTIME_NAMESPACE: namespace, WEB_ORIGIN: origin,
  CONTROL_TURSO_DATABASE_URL: 'libsql://synthetic-control.turso.io', CONTROL_TURSO_AUTH_TOKEN: 'synthetic-token', MAIL_PRIVATE_BLOB_STORE_ID: 'store_AbCdEfGhIjKlMnOp' };
class BlobFixture implements PrivateBlobPort {
  readonly privateOrigin = 'https://abcdefghijklmnop.private.blob.vercel-storage.com';
  values = new Map<string, Uint8Array>(); grants: string[] = [];
  async uploadGrant(pathname: string) { this.grants.push(pathname); return { url: `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}` }; }
  async downloadGrant(pathname: string) { return { url: `${this.privateOrigin}/${pathname}?synthetic=grant` }; }
  async read(pathname: string) { const bytes = this.values.get(pathname); return bytes ? new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) : null; }
  async write(pathname: string, bytes: Uint8Array) { this.values.set(pathname, bytes.slice()); }
  async remove(pathname: string) { this.values.delete(pathname); }
}
async function fixture() {
  const sql = new NativeControl(':memory:', { DATABASE_PATH: ':memory:' }), blob = new BlobFixture(); let closes = 0;
  const runtime = await createFunctionRuntime({ env, createControl: () => ({ execute: sql.execute.bind(sql), transaction: sql.transaction.bind(sql), close: async () => { closes++; } }), createBlob: () => blob, deadlineMs: 2000, pollMs: 2 });
  const server = createServer((request, response) => { void runtime.handle(request, response); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = (value: unknown, options: { path?: string; method?: string; headers?: Record<string, string>; bytes?: string } = {}) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; json: any }>((done, fail) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: options.path ?? '/api/_rea/transport/uploads', method: options.method ?? 'POST', headers: { host: 'mail.example.test', origin, 'content-type': 'application/json', ...options.headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.once('error', fail);
      response.once('end', () => { try { done({ status: response.statusCode!, headers: response.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { fail(error); } });
    }); request.once('error', fail); request.end(options.bytes ?? JSON.stringify(value));
  });
  return { sql, blob, send, closes: () => closes, close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await runtime.close(); await sql.close(); } };
}
const input = { commandId: 'attachment-fixture', method: 'POST', path: '/api/drafts/synthetic/attachments', bytes: 10 * 1024 ** 2, sha256: 'a'.repeat(64) };
test('Function configuration refuses Preview and invalid identities before opening storage; never needs Core credentials', async () => {
  assert.equal(loadFunctionConfiguration(env).namespace, namespace); let opened = 0;
  for (const patch of [{ VERCEL_ENV: 'preview' }, { WEB_ORIGIN: `${origin}/` }, { CONTROL_TURSO_DATABASE_URL: 'file:local.db' }, { CONTROL_TURSO_DATABASE_URL: 'https://synthetic-control.turso.io/?token=forbidden' }, { MAIL_PRIVATE_BLOB_STORE_ID: 'store_bad' }, { CONTROL_TURSO_AUTH_TOKEN: '' }]) {
    await assert.rejects(createFunctionRuntime({ env: { ...env, ...patch }, createControl() { opened++; throw new Error('must not open'); } }), /configuration is invalid/);
  } assert.equal(opened, 0);
});
test('HTTP upload grants require canonical host/origin, bounded exact metadata and eligible routes before mutation', async () => {
  const f = await fixture(); try {
    const badRequests: Parameters<typeof f.send>[1][] = [{ headers: { origin: 'https://other.example.test' } }, { headers: { host: 'other.example.test' } }, { method: 'GET' }, { headers: { 'content-type': 'text/plain' } }, { headers: { 'x-rea-transport-body': 'blob-v1' } }, { bytes: '{' }, { bytes: ' '.repeat(8193) }];
    for (const options of badRequests) assert.ok([400, 403, 413].includes((await f.send(input, options)).status));
    for (const value of [{ ...input, url: 'https://attacker.example' }, { ...input, method: 'DELETE' }, { ...input, path: '/api/send' }, { ...input, path: '/api/drafts/a/../attachments' }, { ...input, bytes: 64 * 1024 ** 2 + 1 }, { ...input, sha256: 'z'.repeat(64) }]) assert.ok([400, 409, 413].includes((await f.send(value)).status));
    assert.equal(f.blob.grants.length, 0); assert.equal((await f.sql.execute('SELECT * FROM runtime_body_objects')).rows.length, 0); assert.equal((await f.sql.execute('SELECT * FROM runtime_commands')).rows.length, 0);
    const result = await f.send(input); assert.equal(result.status, 200); assert.match(String(result.headers['cache-control']), /private, no-store/);
    assert.equal(result.json.body.bytes, input.bytes); assert.equal(result.json.body.sha256, input.sha256); assert.equal(new URL(result.json.upload.url).searchParams.get('pathname'), f.blob.grants[0]);
    assert.equal((await f.sql.execute('SELECT * FROM runtime_commands')).rows.length, 0); assert.equal((await f.sql.execute('SELECT * FROM runtime_body_objects')).rows.length, 1);
  } finally { await f.close(); } assert.equal(f.closes(), 1);
});
test('real Function/control/actor assembly transfers 10MiB immutable bytes, caches duplicate mutation and rejects changed identity', async () => {
  const f = await fixture(); let actor: DurableCoreActor | undefined, pumping: ReturnType<typeof setInterval> | undefined;
  const bytes = Buffer.alloc(10 * 1024 ** 2, 173), sha256 = createHash('sha256').update(bytes).digest('hex'); let dispatches = 0;
  try {
    const grant = await f.send({ ...input, sha256 }); assert.equal(grant.status, 200); await f.blob.write(f.blob.grants[0], bytes);
    const bodies = new PrivateBodyTransport({ sql: f.sql, blob: f.blob, namespace }), authority = new ActorAuthority(f.sql, { namespace }), log = new DurableCommandLog(f.sql, { namespace, webOrigin: origin });
    actor = await DurableCoreActor.start({ authority, log, actorId: 'synthetic-worker', deploymentId: 'synthetic-deployment', createCore: context => ({
      async dispatch(request, command) {
        dispatches++; context.assertLocal(); assert.equal(request.body.kind, 'blob'); if (request.body.kind !== 'blob') throw new Error('Missing body');
        const scope = { namespace, commandId: command.id, method: request.method, path: request.path }, actual = await bodies.readRequestBody(request.body, scope); assert.deepEqual(actual, bytes);
        return { status: 201, headers: { 'content-type': 'application/octet-stream' }, body: await bodies.writeResponseBody(scope, actual) };
      }, async quiesce() {}, async close() {},
    }) });
    let pump = Promise.resolve(); pumping = setInterval(() => { pump = pump.then(() => actor!.pumpOnce()).then(() => {}); }, 2);
    const options = { path: input.path, headers: { 'x-rea-transport-id': input.commandId, 'x-rea-transport-body': 'blob-v1' } };
    const result = await f.send(grant.json.body, options); assert.equal(result.status, 201); assert.equal(result.headers['x-rea-transport-body'], 'blob-v1'); assert.deepEqual(f.blob.values.get(new URL(result.json.download.url).pathname.slice(1)), bytes);
    assert.equal((await f.send(grant.json.body, options)).status, 201); assert.equal(dispatches, 1);
    assert.equal((await f.send({ ...grant.json.body, sha256: 'b'.repeat(64) }, options)).status, 409); assert.equal(dispatches, 1);
    clearInterval(pumping); pumping = undefined; await pump; assert.equal((await f.sql.execute('SELECT state FROM runtime_commands')).rows[0]?.state, 'completed');
  } finally { if (pumping) clearInterval(pumping); await actor?.close(); await f.close(); }
});

test('a genuinely committed command with a lost acknowledgement retires the poisoned runtime without replaying it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rea-function-retire-')), databasePath = join(directory, 'control.sqlite');
  const selectedEnv = { ...env, DATABASE_PATH: databasePath }, blob = new BlobFixture();
  let opened = 0, lostCommit = true; const runtimes: Awaited<ReturnType<typeof createFunctionRuntime>>[] = [];
  const handle = createFunctionHandler(async () => {
    const runtime = await createFunctionRuntime({ env: selectedEnv, createBlob: () => blob, deadlineMs: 30, pollMs: 2,
      createControl: () => {
        assert.equal(selectedEnv.DATABASE_PATH, databasePath); opened++;
        const client = createClient({ url: `file:${databasePath}`, intMode: 'bigint' });
        const wrapped: ControlClient = { execute: client.execute.bind(client), close: client.close.bind(client), transaction: async mode => {
          const transaction = await client.transaction(mode);
          return { execute: transaction.execute.bind(transaction), close: transaction.close.bind(transaction), rollback: transaction.rollback.bind(transaction),
            commit: async () => { await transaction.commit(); if (lostCommit) { lostCommit = false; throw new Error('Synthetic lost acknowledgement AFTER real SQL commit'); } } };
        } }; return new LibsqlControl(wrapped);
      } }); runtimes.push(runtime); return runtime;
  });
  const server = createServer((request, response) => { void handle(request, response); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = (path: string, value: unknown, id: string) => new Promise<{ status: number; body: any }>((done, fail) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method: 'POST',
      headers: { host: 'mail.example.test', origin, 'content-type': 'application/json', 'x-rea-transport-id': id } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.once('error', fail);
      response.once('end', () => { try { done({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { fail(error); } });
    }); request.once('error', fail); request.end(JSON.stringify(value));
  });
  try {
    const first = await send('/api/action', {}, 'committed-before-ack-loss'); assert.equal(first.status, 503);
    const next = await send('/api/_rea/transport/uploads', { ...input, bytes: 16 }, 'distinct-upload-intent');
    assert.equal(next.status, 200, 'a later distinct request must receive a fresh control client'); assert.equal(opened, 2);
    const duplicate = await send('/api/action', {}, 'committed-before-ack-loss'); assert.equal(duplicate.status, 504); assert.equal(duplicate.body.error.code, 'worker_request_pending');
    const reader = createClient({ url: `file:${databasePath}`, intMode: 'bigint' });
    try { assert.equal((await reader.execute('SELECT count(*) AS n FROM runtime_commands')).rows[0].n, 1n);
      assert.equal((await reader.execute('SELECT state FROM runtime_commands')).rows[0].state, 'queued'); } finally { reader.close(); }
    assert.equal(blob.grants.length, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await Promise.all(runtimes.map(runtime => runtime.close())); rmSync(directory, { recursive: true, force: true }); }
});

test('a retiring generation drains existing handlers and cannot evict a healthy successor', async () => {
  let held!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { held = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const generations: { healthy: boolean; handled: string[]; closes: number }[] = [];
  const handle = createFunctionHandler(async () => {
    const current = { healthy: true, handled: [] as string[], closes: 0 }; generations.push(current);
    const generation = generations.length;
    return { healthy: () => current.healthy, close: async () => { current.closes++; }, handle: async (request, response) => {
      current.handled.push(request.url!);
      if (request.url === '/api/held') { held(); await resume; }
      if (request.url === '/api/fatal') current.healthy = false;
      response.writeHead(current.healthy ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ generation }));
    } };
  });
  const server = createServer((request, response) => { void handle(request, response); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = (path: string) => new Promise<{ status: number; generation: number }>((done, fail) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.once('error', fail);
      response.once('end', () => { try { done({ status: response.statusCode!, generation: JSON.parse(Buffer.concat(chunks).toString()).generation }); } catch (error) { fail(error); } });
    }); request.once('error', fail); request.end();
  });
  let first: ReturnType<typeof send> | undefined;
  try {
    first = send('/api/held'); await started;
    assert.equal((await send('/api/fatal')).status, 503); assert.equal(generations[0].closes, 0);
    assert.deepEqual(await send('/api/successor'), { status: 200, generation: 2 }); assert.equal(generations[0].closes, 0);
    release(); await first; assert.equal(generations[0].closes, 1);
    assert.deepEqual(await send('/api/still-successor'), { status: 200, generation: 2 }); assert.equal(generations.length, 2); assert.equal(generations[1].closes, 0);
    assert.deepEqual(generations[0].handled, ['/api/held', '/api/fatal']); assert.deepEqual(generations[1].handled, ['/api/successor', '/api/still-successor']);
  } finally { release(); await first?.catch(() => {}); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
