import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import * as blobSdk from '@vercel/blob';
import { VercelPrivateBlobStore, type PrivateBlobSdk } from '../src/vercel-blob-sdk.ts';
import { LibsqlControl } from '../src/control-libsql.ts';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import { createHttpBridge, type BridgeCommandLog } from '../src/http-bridge.ts';
import { createMailFetch } from '../../web/src/mail-fetch.ts';

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('Browser receipt controls forbid external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });

test('real local HTTP bridge recovers one delayed durable command through receipt reads without another enqueue/dispatch', async () => {
  const databasePath = 'file::memory:', env = { DATABASE_PATH: databasePath };
  assert.equal(env.DATABASE_PATH, databasePath);
  const sql = new LibsqlControl(createClient({ url: databasePath, intMode: 'bigint' }));
  const namespace = 'fictional-browser-bridge', webOrigin = 'https://mail.example.test', id = 'fictional-late-answer';
  const authority = new ActorAuthority(sql, { namespace }); await authority.initialize();
  const acquired = await authority.acquire('fictional-actor', 'fictional-deployment'); assert.equal(acquired.acquired, true);
  if (!acquired.acquired) throw new Error('Fixture lease unavailable');
  const log = new DurableCommandLog(sql, { namespace, webOrigin }); await log.initialize();
  let enqueues = 0, dispatches = 0, release!: () => void, work: Promise<void> | undefined;
  const finish = new Promise<void>(resolve => { release = resolve; });
  const commandLog: BridgeCommandLog = { namespace, webOrigin, maxInlineBytes: log.maxInlineBytes, maxBlobBytes: log.maxBlobBytes,
    readResult: (...args) => log.readResult(...args), enqueue: async input => {
      enqueues++; const accepted = await log.enqueue(input);
      if (accepted.created) {
        work = (async () => {
          const claimed = await log.claimNext(acquired.lease); assert.ok(claimed); dispatches++;
          assert.equal(claimed.request.path, '/api/ai'); assert.equal(claimed.request.method, 'POST');
          await finish;
          await log.complete(acquired.lease, claimed.id, { status: 200, headers: { 'content-type': 'application/json' },
            body: { kind: 'inline', base64: Buffer.from(JSON.stringify({ text: 'Fictional Cedar answer after initial timeout' })).toString('base64') } });
        })();
        void work.catch(() => {});
      }
      return accepted;
    } };
  const bridge = createHttpBridge({ commandLog, webOrigin, allowedHosts: ['mail.example.test'], deadlineMs: 10, pollMs: 1 });
  const server = createServer((request, response) => { void bridge(request, response); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const calls: { path: string; method: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = createMailFetch({ enabled: true, origin: webOrigin, downloadOrigin: 'https://fictional.private.blob.vercel-storage.com',
    uuid: () => id, resultPollMs: 2, resultTimeoutMs: 1000, fetch: (input, init) => {
      const path = String(input), method = init?.method ?? 'GET'; calls.push({ path, method });
      // Release only after the original HTTP wait has timed out and the browser
      // demonstrably requests its existing receipt, independent of machine load.
      if (path === `/api/_rea/transport/results/${id}` && !timer) timer = setTimeout(release, 5);
      return new Promise<Response>((resolve, reject) => {
        const body = init?.body === undefined ? Buffer.alloc(0) : Buffer.from(String(init.body));
        const headers = Object.fromEntries(new Headers(init?.headers));
        const connection = httpRequest({ host: '127.0.0.1', port: address.port, method, path,
          headers: { ...headers, host: 'mail.example.test', origin: webOrigin, 'content-length': String(body.byteLength) }, signal: init?.signal ?? undefined }, response => {
          const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.once('error', reject);
          response.once('end', () => {
            const resultHeaders = new Headers(); for (const [key, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) value.forEach(item => resultHeaders.append(key, item)); else if (value !== undefined) resultHeaders.set(key, value);
            }
            resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: resultHeaders }));
          });
        }); connection.once('error', reject); connection.end(body);
      });
    } });
  try {
    const response = await request('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"Cedar"}' });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'Fictional Cedar answer after initial timeout' });
    assert.equal(enqueues, 1); assert.equal(dispatches, 1); assert.ok(calls.length > 1);
    assert.ok(calls.slice(1).every(call => call.method === 'GET' && call.path === `/api/_rea/transport/results/${id}`));
    assert.equal((await sql.execute('SELECT COUNT(*) AS n FROM runtime_commands')).rows[0].n, 1);
    assert.equal((await log.readResult(namespace, id))?.state, 'completed'); await work;
  } finally {
    if (timer) clearTimeout(timer); release(); await work?.catch(() => {});
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await sql.close();
  }
});

test('real SDK-generated scoped upload/download URL forms interoperate with the browser transport', async () => {
  const storeId = 'store_AbCdEf1234567890', namespace = 'fictional-browser-grants', ref = 'A'.repeat(32);
  const path = `mail-rpc/${createHash('sha256').update(namespace).digest('hex').slice(0, 32)}/${ref}`;
  const bytes = new Uint8Array([0, 1, 255]), sha256 = createHash('sha256').update(bytes).digest('hex'), now = Date.now();
  const body = { kind: 'blob', ref, sha256, bytes: bytes.length }, id = 'fictional-sdk-command';
  let tokens = 0, uploadUrl = '', downloadUrl = '', uploaded: Uint8Array | undefined, commands = 0;
  const sdk: PrivateBlobSdk = { ...blobSdk, issueSignedToken: async options => {
    const { pathname, operations, validUntil, maximumSizeInBytes, allowedContentTypes } = options;
    return { delegationToken: `${Buffer.from(JSON.stringify({ storeId, pathname, operations, validUntil, maximumSizeInBytes, allowedContentTypes })).toString('base64url')}.${'S'.repeat(43)}`,
      clientSigningToken: 'K'.repeat(43), validUntil: validUntil! };
  } };
  const store = new VercelPrivateBlobStore({ storeId, namespace, sdk, getOidcToken: async () => `fictional-oidc-${++tokens}` });
  const webOrigin = 'https://mail.example.test';
  const request = createMailFetch({ enabled: true, origin: webOrigin, downloadOrigin: store.privateOrigin, uuid: () => id, inlineBytes: 1,
    fetch: async (input, init) => {
      if (input === '/api/_rea/transport/uploads') {
        const grant = await store.uploadGrant(path, bytes.length, now + 60_000); uploadUrl = grant.url;
        return new Response(JSON.stringify({ body, upload: { ...grant, expiresAt: now + 60_000 } }));
      }
      if (input === uploadUrl) {
        assert.equal(init?.method, 'PUT'); assert.equal(init?.credentials, 'omit'); uploaded = new Uint8Array(init!.body as Uint8Array);
        const parsed = new URL(uploadUrl); assert.equal(parsed.searchParams.get('vercel-blob-maximum-size-in-bytes'), String(bytes.length));
        assert.equal(parsed.searchParams.get('vercel-blob-allow-overwrite'), 'false'); return new Response('{}');
      }
      if (String(input).startsWith('/api/knowledge/sources/files')) {
        commands++; assert.deepEqual(uploaded, bytes); assert.deepEqual(JSON.parse(String(init?.body)), body); return new Response('{"ok":true}');
      }
      if (input === '/api/attachment') {
        commands++; const grant = await store.downloadGrant(path, now + 60_000); downloadUrl = grant.url;
        return new Response(JSON.stringify({ version: 1, response: { status: 200, headers: { 'content-type': 'application/octet-stream' }, body }, download: { ...grant, expiresAt: now + 60_000 } }),
          { headers: { 'x-rea-transport-body': 'blob-v1', 'x-rea-transport-id': id } });
      }
      assert.equal(input, downloadUrl); assert.equal(init?.credentials, 'omit'); assert.equal(new URL(downloadUrl).searchParams.get('cache'), '0');
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    } });
  assert.equal((await request('/api/knowledge/sources/files?name=cedar.txt', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })).status, 200);
  assert.deepEqual(new Uint8Array(await (await request('/api/attachment')).arrayBuffer()), bytes);
  assert.equal(commands, 2); assert.equal(tokens, 2);
});
