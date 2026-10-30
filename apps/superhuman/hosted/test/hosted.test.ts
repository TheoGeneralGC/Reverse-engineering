import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest, type Server, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHostedConfiguration } from '../src/config.ts';
import { createHostedGateway } from '../src/gateway.ts';
import { createHostedApplication } from '../src/server.ts';
import type { Draft } from '../../api/src/types.ts';

const actualFetch = globalThis.fetch; let externalFetchAttempts = 0;
globalThis.fetch = async () => { externalFetchAttempts++; throw new Error('Hosted tests forbid external fetch'); };
after(() => { globalThis.fetch = actualFetch; assert.equal(externalFetchAttempts, 0); });

const secret = '19'.repeat(32);
const webOrigin = 'https://mail.example.test';
const apiOrigin = 'https://api.example.test';
const apiHost = 'api.example.test';
function environment(directory: string): NodeJS.ProcessEnv {
  return { WEB_ORIGIN: webOrigin, HOSTED_API_ORIGIN: apiOrigin, ORIGIN_SECRET: secret,
    TOKEN_ENCRYPTION_KEY: '29'.repeat(32), HOSTED_DATA_DIR: directory,
    DATABASE_PATH: join(directory, 'mail.sqlite'), GOOGLE_REDIRECT_URI: `${webOrigin}/api/auth/google/callback`,
    GOOGLE_CLIENT_ID: 'synthetic-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-client-secret', TZ: 'America/Los_Angeles' };
}
const temporary = () => mkdtempSync(join(realpathSync(tmpdir()), 'rea-hosted-'));
async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); return address.port;
}
async function close(server: Server): Promise<void> {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function call(port: number, path: string, options: { method?: string; headers?: Record<string, string | string[]>; body?: string | Buffer } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET',
      headers: { host: apiHost, ...options.headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('error', reject); request.end(options.body);
  });
}
const authenticated = { 'x-origin-secret': secret };
const mutation = { ...authenticated, origin: webOrigin, 'content-type': 'application/json' };

test('hosted configuration fails closed before any database or default path can be used', () => {
  const directory = temporary();
  try {
    const valid = environment(directory);
    assert.equal(loadHostedConfiguration(valid).databasePath, valid.DATABASE_PATH);
    assert.equal(loadHostedConfiguration(valid).port, 3001);
    for (const key of ['WEB_ORIGIN', 'HOSTED_API_ORIGIN', 'ORIGIN_SECRET', 'TOKEN_ENCRYPTION_KEY', 'HOSTED_DATA_DIR', 'DATABASE_PATH', 'GOOGLE_REDIRECT_URI']) {
      const missing = { ...valid }; delete missing[key];
      assert.throws(() => loadHostedConfiguration(missing), /^TypeError: Hosted API configuration is invalid\.$/);
    }
    for (const values of [
      { WEB_ORIGIN: 'http://mail.example.test' }, { WEB_ORIGIN: `${webOrigin}/` },
      { WEB_ORIGIN: `https://user:password@mail.example.test` }, { WEB_ORIGIN: 'https://localhost' },
      { HOSTED_API_ORIGIN: webOrigin }, { ORIGIN_SECRET: 'AB'.repeat(32) },
      { ORIGIN_SECRET: 'short' }, { TOKEN_ENCRYPTION_KEY: 'broken' },
      { HOSTED_DATA_DIR: 'relative' }, { DATABASE_PATH: ':memory:' },
      { DATABASE_PATH: join(directory, '../mail.sqlite') }, { GOOGLE_REDIRECT_URI: `${apiOrigin}/api/auth/google/callback` },
      { PORT: '0' }, { PORT: '65536' }, { PORT: '3001\n' },
    ]) assert.throws(() => loadHostedConfiguration({ ...valid, ...values }), /^TypeError: Hosted API configuration is invalid\.$/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('only minimal health is public; invalid secrets, hosts and origins cannot reach the core', async () => {
  const directory = temporary(); let requests = 0;
  const core = createServer((_request, response) => { requests++; response.end('owned'); });
  const gateway = createHostedGateway(loadHostedConfiguration(environment(directory)), core);
  const port = await listen(gateway.server);
  try {
    const health = await call(port, '/healthz'); assert.equal(health.status, 200); assert.equal(health.body.toString(), '{"ok":true}');
    assert.equal((await call(port, '/healthz', { method: 'HEAD' })).body.length, 0);
    assert.equal((await call(port, '/healthz?details=true')).status, 403);
    const invalidHeaders: Record<string, string | string[]>[] = [{}, { 'x-origin-secret': '18'.repeat(32) }, { 'x-origin-secret': 'wrong' }, { 'x-origin-secret': [secret, secret] }];
    for (const headers of invalidHeaders) {
      const result = await call(port, '/api/bootstrap', { headers });
      assert.equal(result.status, 403); assert.ok(!result.body.includes(secret));
    }
    for (const headers of [
      { ...authenticated, host: 'attacker.example.test', 'x-forwarded-host': apiHost },
      { ...authenticated, origin: 'https://attacker.example.test' },
      { ...authenticated, origin: 'http://127.0.0.1:5173' },
      { ...authenticated, origin: 'null' },
    ]) assert.equal((await call(port, '/api/bootstrap', { headers })).status, 403);
    for (const headers of [authenticated, { ...authenticated, origin: 'https://attacker.example.test', 'x-forwarded-origin': webOrigin }]) {
      assert.equal((await call(port, '/api/preferences', { method: 'PATCH', headers, body: '{}' })).status, 403);
    }
    for (const path of ['/not-api', '//api/bootstrap', 'https://attacker.example.test/api/bootstrap', '/api\\bootstrap']) {
      assert.equal((await call(port, path, { headers: authenticated })).status, 404);
    }
    assert.equal(requests, 0);
    assert.equal((await call(port, '/api/bootstrap', { headers: authenticated })).status, 200);
    assert.equal((await call(port, '/api/preferences', { method: 'PATCH', headers: mutation, body: '{}' })).status, 200);
    assert.equal(requests, 2);
    gateway.beginShutdown(); assert.equal((await call(port, '/healthz')).status, 503);
    assert.equal(requests, 2);
  } finally { await close(gateway.server); rmSync(directory, { recursive: true, force: true }); }
});

test('noncanonical Unicode cannot authenticate by ASCII truncation; one async core owner is required', async () => {
  const directory = temporary(); const configuration = loadHostedConfiguration(environment(directory));
  let requests = 0; const core = createServer((_request, response) => { requests++; response.end('owned'); });
  const gateway = createHostedGateway(configuration, core);
  try {
    const mapped = String.fromCharCode(0x131, 0x139).repeat(32);
    assert.equal(Buffer.from(mapped, 'ascii').toString('ascii'), secret);
    // Node's real HTTP parser rejects these codepoints before they become header
    // values; direct dispatch also proves the gateway's own canonical boundary.
    const fakeRequest = { url: '/api/bootstrap', method: 'GET', headers: { host: apiHost, 'x-origin-secret': mapped }, rawHeaders: [] };
    const headers = new Map<string, unknown>(); let status = 0;
    const fakeResponse = { headersSent: false, setHeader(name: string, value: unknown) { headers.set(name, value); },
      getHeader(name: string) { return headers.get(name); }, writeHead(value: number) { status = value; return this; }, end() {} };
    gateway.server.emit('request', fakeRequest, fakeResponse);
    assert.equal(status, 403); assert.equal(requests, 0);
    assert.throws(() => createHostedGateway(configuration, createServer()), /one core request owner/);
    core.on('request', () => {}); assert.throws(() => createHostedGateway(configuration, core), /one core request owner/);
  } finally { await gateway.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('trusted normalization strips credentials and forwarding hints while no-store and Secure override core headers', async () => {
  const directory = temporary();
  const core = createServer((request, response) => {
    assert.equal(request.headers.host, '127.0.0.1');
    assert.equal(request.headers['x-origin-secret'], undefined);
    assert.equal(request.headers['x-forwarded-host'], undefined);
    assert.equal(request.headers.forwarded, undefined);
    assert.ok(!request.rawHeaders.includes(secret));
    assert.equal(request.headers.origin, webOrigin);
    if (request.url === '/api/header-array') {
      response.writeHead(200, undefined, ['Set-Cookie', 'first=value; HttpOnly', 'Set-Cookie', 'second=value; HttpOnly', 'Cache-Control', 'public']);
      response.end('raw headers'); return;
    }
    response.setHeader('set-cookie', ['first=value; HttpOnly', 'second=value; Secure; SameSite=Lax']);
    response.setHeader('cache-control', 'public, max-age=86400');
    response.writeHead(200, 'Synthetic', { 'cdn-cache-control': 'public, s-maxage=86400',
      'vercel-cdn-cache-control': 'public, s-maxage=86400', 'x-vercel-enable-rewrite-caching': '1' });
    response.end('owned');
  });
  const gateway = createHostedGateway(loadHostedConfiguration(environment(directory)), core); const port = await listen(gateway.server);
  try {
    const result = await call(port, '/api/bootstrap', { headers: { ...mutation,
      'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'http', forwarded: 'host=attacker.example.test' } });
    assert.equal(result.status, 200); assert.equal(result.body.toString(), 'owned');
    assert.deepEqual(result.headers['set-cookie'], ['first=value; HttpOnly; Secure', 'second=value; Secure; SameSite=Lax']);
    assert.equal(result.headers['cache-control'], 'private, no-store, max-age=0');
    assert.equal(result.headers['cdn-cache-control'], 'no-store');
    assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store');
    assert.equal(result.headers['x-vercel-enable-rewrite-caching'], '0');
    const arrayResult = await call(port, '/api/header-array', { headers: mutation });
    assert.equal(arrayResult.status, 200); assert.equal(arrayResult.body.toString(), 'raw headers');
    assert.deepEqual(arrayResult.headers['set-cookie'], ['first=value; HttpOnly; Secure', 'second=value; HttpOnly; Secure']);
    assert.equal(arrayResult.headers['cache-control'], 'private, no-store, max-age=0');
  } finally { await close(gateway.server); rmSync(directory, { recursive: true, force: true }); }
});

test('response streaming is forwarded before the core finishes, without buffering at the gateway', async () => {
  const directory = temporary(); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const core = createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('data: first\n\n');
    await wait; response.end('data: done\n\n');
  });
  const gateway = createHostedGateway(loadHostedConfiguration(environment(directory)), core); const port = await listen(gateway.server);
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, path: '/api/events', headers: { host: apiHost, ...authenticated } }, response => {
        assert.equal(response.headers['content-type'], 'text/event-stream'); let output = ''; let first = true;
        response.on('data', chunk => { output += String(chunk); if (first) { first = false; assert.equal(output, 'data: first\n\n'); release(); } });
        response.on('end', () => resolve(output)); response.on('error', reject);
      }); request.on('error', reject); request.end();
    });
    assert.equal(result, 'data: first\n\ndata: done\n\n');
  } finally { release(); await close(gateway.server); rmSync(directory, { recursive: true, force: true }); }
});

test('shutdown rejects new work and drains the held async core before resource closure, even after the response ends', async () => {
  const directory = temporary(); let release!: () => void; let started!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); const start = new Promise<void>(resolve => { started = resolve; });
  let completed = false; let resourceClosed = false;
  const core = createServer(async function (this: Server, _request, response) {
    assert.equal(this, core); response.end('response finished'); started();
    await wait; assert.equal(resourceClosed, false); completed = true;
  });
  const gateway = createHostedGateway(loadHostedConfiguration(environment(directory)), core); const port = await listen(gateway.server);
  try {
    const response = await call(port, '/api/held', { headers: authenticated }); await start;
    assert.equal(response.body.toString(), 'response finished');
    gateway.beginShutdown(); assert.equal((await call(port, '/api/after-shutdown', { headers: authenticated })).status, 503);
    let closed = false; const closing = gateway.close().then(() => { assert.equal(completed, true); resourceClosed = true; closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false); assert.equal(resourceClosed, false);
    release(); await closing; assert.equal(resourceClosed, true);
  } finally { release(); await gateway.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('the 20-second client drain disconnects a held stream but still waits for its durable core work', async context => {
  const directory = temporary(); let release!: () => void; let started!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); const start = new Promise<void>(resolve => { started = resolve; });
  const core = createServer(async (_request, response) => { response.write('held stream'); started(); await wait; response.end('completed'); });
  const gateway = createHostedGateway(loadHostedConfiguration(environment(directory)), core); const port = await listen(gateway.server);
  const client = call(port, '/api/held-stream', { headers: authenticated }).then(value => ({ success: true, value }), () => ({ success: false }));
  try {
    await start;
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let closed = false; const closing = gateway.close().then(() => { closed = true; });
    context.mock.timers.tick(20_000);
    const disconnected = await client; assert.equal(disconnected.success, false);
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    release(); await closing; assert.equal(closed, true);
  } finally { release(); await gateway.close(); context.mock.timers.reset(); rmSync(directory, { recursive: true, force: true }); }
});

test('an unexpected async core error produces a generic response without leaking its text', async () => {
  const directory = temporary(); const core = createServer(async () => { throw new Error(`do not disclose ${secret}`); });
  const gateway = createHostedGateway(loadHostedConfiguration(environment(directory)), core); const port = await listen(gateway.server);
  try {
    const result = await call(port, '/api/fault', { headers: authenticated });
    assert.equal(result.status, 500); assert.equal(JSON.parse(result.body.toString()).error.code, 'internal_error');
    assert.ok(!result.body.includes(secret)); assert.ok(!result.body.includes('do not disclose'));
  } finally { await gateway.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('real API OAuth start retains PKCE state and marks the HTTPS cookie Secure without provider calls', async () => {
  const directory = temporary(); const env = environment(directory);
  const hosted = createHostedApplication(env, { runJobs: false }); const port = await listen(hosted.server);
  try {
    const start = await call(port, '/api/auth/google/start', { headers: authenticated });
    assert.equal(start.status, 302);
    const location = new URL(start.headers.location!);
    assert.equal(location.origin, 'https://accounts.google.com');
    assert.equal(location.searchParams.get('redirect_uri'), env.GOOGLE_REDIRECT_URI);
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    const cookies = start.headers['set-cookie']; assert.equal(cookies?.length, 1);
    assert.match(cookies![0], /^rea_oauth_state=[^;]+; HttpOnly; SameSite=Lax; Path=\/api\/auth\/google; Max-Age=600; Secure$/);
    assert.equal(start.headers['cache-control'], 'private, no-store, max-age=0');
    assert.ok(!start.body.includes(secret));
  } finally { await hosted.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('hosted API persists a synthetic 10MiB attachment and draft across restart; interrupted delivery stays locked', async () => {
  const directory = temporary(); const env = environment(directory);
  const bytes = Buffer.alloc(10 * 1024 * 1024, 0x39); const digest = createHash('sha256').update(bytes).digest('hex');
  let hosted = createHostedApplication(env, { runJobs: false }); let port = await listen(hosted.server);
  let draftId = ''; let attachmentId = ''; let unknownId = '';
  try {
    const bootstrap = await call(port, '/api/bootstrap?includeThreads=false', { headers: authenticated });
    assert.equal(bootstrap.status, 200); const accountId = JSON.parse(bootstrap.body.toString()).activeAccountId;
    const created = await call(port, '/api/drafts', { method: 'POST', headers: mutation,
      body: JSON.stringify({ accountId, subject: 'Hosted synthetic persistence', body: 'Fictional fixture only.' }) });
    assert.equal(created.status, 201); draftId = JSON.parse(created.body.toString()).draft.id;
    const uploaded = await call(port, `/api/drafts/${draftId}/attachments`, { method: 'POST', headers: mutation,
      body: JSON.stringify({ name: 'synthetic.bin', mimeType: 'application/octet-stream', data: bytes.toString('base64') }) });
    assert.equal(uploaded.status, 201); attachmentId = JSON.parse(uploaded.body.toString()).attachment.id;
    const unknown = hosted.app.store.saveDraft({ accountId, to: 'fixture@example.test', subject: 'Synthetic interrupted delivery' }); unknownId = unknown.id;
    hosted.app.store.beginDelivery(unknownId);
    await hosted.close();
    hosted = createHostedApplication(env, { runJobs: false }); port = await listen(hosted.server);
    const read = await call(port, `/api/drafts/${draftId}`, { headers: authenticated }); assert.equal(read.status, 200);
    assert.equal(JSON.parse(read.body.toString()).draft.subject, 'Hosted synthetic persistence');
    const downloaded = await call(port, `/api/drafts/${draftId}/attachments/${attachmentId}`, { headers: authenticated });
    assert.equal(downloaded.status, 200); assert.equal(downloaded.body.length, bytes.length);
    assert.equal(createHash('sha256').update(downloaded.body).digest('hex'), digest);
    assert.equal(hosted.app.store.required<Draft>('draft', unknownId).status, 'delivery_unknown');
    const overwrite = await call(port, `/api/drafts/${unknownId}`, { method: 'PATCH', headers: mutation, body: '{"body":"must stay locked"}' });
    assert.equal(overwrite.status, 409);
    assert.equal(hosted.app.store.required<Draft>('draft', unknownId).status, 'delivery_unknown');
    assert.equal(hosted.app.store.list('delivery').length, 1);
    const closing = hosted.close(); assert.equal(hosted.close(), closing); await closing;
  } finally { await hosted.close(); rmSync(directory, { recursive: true, force: true }); }
});
