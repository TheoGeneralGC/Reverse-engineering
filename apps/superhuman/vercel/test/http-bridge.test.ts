import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { createHttpBridge, type BridgeCommandLog, type HttpBridgeOptions, type TransportBodyAdapter } from '../src/http-bridge.ts';
import { CommandLogError, type CommandRequest, type CommandResponse, type CommandResult } from '../src/command-log.ts';

const webOrigin = 'https://mail.example.test', host = 'mail.example.test', namespace = 'synthetic-mail';
const inline = (value: Buffer | string) => ({ kind: 'inline' as const, base64: Buffer.from(value).toString('base64') });
const reply = (value: Buffer | string = '{"ok":true}', status = 200): CommandResponse => ({ status, headers: { 'content-type': 'application/json' }, body: inline(value) });
const blob = { kind: 'blob' as const, ref: 'synthetic_blob_ref_0001', sha256: 'a'.repeat(64), bytes: 256 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
class MemoryCommandLog implements BridgeCommandLog {
  readonly namespace = namespace; readonly webOrigin = webOrigin; readonly maxInlineBytes = 4096; readonly maxBlobBytes = 64 * 1024 * 1024;
  calls = 0; created = 0; reads = 0;
  commands = new Map<string, { fingerprint: string; request: CommandRequest; result: CommandResult }>();
  makeResponse: (request: CommandRequest) => CommandResponse | undefined = () => reply();
  onRead?: (id: string) => void;
  async enqueue(input: { id: string; namespace: string; request: CommandRequest }) {
    this.calls++; assert.equal(input.namespace, namespace);
    const fingerprint = createHash('sha256').update(JSON.stringify(input.request)).digest('hex');
    const old = this.commands.get(input.id);
    if (old) { if (old.fingerprint !== fingerprint) throw new CommandLogError('worker_command_key_conflict', 409); return { created: false, command: old.result }; }
    this.created++; const response = this.makeResponse(input.request);
    const command: CommandResult = { id: input.id, sequence: this.created, state: response ? 'completed' : 'queued', ...(response ? { response } : {}) };
    this.commands.set(input.id, { fingerprint, request: input.request, result: command });
    return { created: true, command };
  }
  async readResult(inputNamespace: string, id: string) { assert.equal(inputNamespace, namespace); this.reads++; this.onRead?.(id); return this.commands.get(id)?.result ?? null; }
}
type HttpResult = { status: number; headers: IncomingHttpHeaders; bytes: Buffer };
type HttpOptions = { path?: string; method?: string; headers?: Record<string, string | string[]>; bytes?: Buffer | string };
async function fixture(overrides: Partial<HttpBridgeOptions> = {}, log = new MemoryCommandLog()) {
  const bridge = createHttpBridge({ commandLog: log, webOrigin, allowedHosts: [host], pollMs: 2, deadlineMs: 200, ...overrides });
  const server: Server = createServer((request, response) => { void bridge(request, response); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = (options: HttpOptions = {}): Promise<HttpResult> => new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, method: options.method ?? 'POST', path: options.path ?? '/api/action',
      headers: { host, origin: webOrigin, 'content-type': 'application/json', 'x-rea-transport-id': 'synthetic-command-01', ...options.headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.once('end', () => resolve({ status: response.statusCode!, headers: response.headers, bytes: Buffer.concat(chunks) })); response.once('error', reject);
    }); request.once('error', reject); request.end(options.bytes ?? '{}');
  });
  return { log, server, port: address.port, send, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
const json = (result: HttpResult) => JSON.parse(result.bytes.toString('utf8'));

test('Host, Origin, method and canonical raw path are checked before any command is persisted', async () => {
  const f = await fixture();
  try {
    const invalidRequests: HttpOptions[] = [
      { headers: { host: 'other.example.test', 'x-forwarded-host': host } },
      { headers: { origin: 'https://other.example.test' } },
      { headers: { origin: '' } },
      { headers: { origin: [webOrigin, webOrigin] } },
      { path: '/api/parent/../action' }, { path: '/api/action#fragment' }, { path: '//other.example.test/api/action' },
      { path: '/api/action%20bad\n' }, { method: 'TRACE' },
    ];
    for (const options of invalidRequests) {
      // Node itself refuses a newline in request targets before the server can receive it.
      if (options.path?.includes('\n')) { await assert.rejects(f.send(options)); continue; }
      const result = await f.send(options); assert.ok([400, 403, 405].includes(result.status));
      assert.match(String(result.headers['cache-control']), /no-store/);
    }
    assert.equal(f.log.calls, 0);
  } finally { await f.close(); }
});

test('only OAuth state, content type and Origin enter durable storage; credentials and host hints do not', async () => {
  const f = await fixture();
  try {
    f.log.makeResponse = () => ({ ...reply(), headers: { 'set-cookie': ['rea_oauth_state=synthetic_state_value; HttpOnly; Path=/api/auth/google', 'vercel_session=forbidden'],
      'cache-control': 'public, max-age=999', 'content-length': '99999', 'content-encoding': 'gzip', 'x-untrusted': 'discarded' } });
    const result = await f.send({ headers: { cookie: '_vercel_sso=synthetic_credential; rea_oauth_state=synthetic_state_value; another=secret',
      authorization: 'Bearer synthetic-credential', 'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'http' } });
    assert.equal(result.status, 200);
    assert.deepEqual(f.log.commands.get('synthetic-command-01')?.request.headers, { origin: webOrigin, 'content-type': 'application/json', cookie: 'rea_oauth_state=synthetic_state_value' });
    assert.deepEqual(result.headers['set-cookie'], ['rea_oauth_state=synthetic_state_value; HttpOnly; Path=/api/auth/google; Secure']);
    assert.equal(result.headers['content-encoding'], undefined); assert.notEqual(result.headers['content-length'], '99999'); assert.equal(result.headers['x-untrusted'], undefined);
    assert.match(String(result.headers['cache-control']), /private, no-store/); assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store');
    assert.equal((await f.send({ headers: { cookie: 'rea_oauth_state=synthetic_state_value; rea_oauth_state=another_state_value' } })).status, 400);
    assert.equal(f.log.created, 1);
  } finally { await f.close(); }
});

test('raw encoded path/query and binary bodies survive HTTP without decoding or JSON conversion', async () => {
  const f = await fixture(); const bytes = Buffer.from([0, 1, 2, 127, 128, 255, 13, 10]);
  try {
    f.log.makeResponse = request => ({ status: 206, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="synthetic.bin"' }, body: request.body });
    const path = '/api/attachments/a%2Fb?name=a%20b&plus=%2B&again=1&again=2';
    const result = await f.send({ path, method: 'PUT', bytes, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(result.status, 206); assert.deepEqual(result.bytes, bytes); assert.equal(result.headers['content-type'], 'application/octet-stream');
    assert.equal(f.log.commands.get('synthetic-command-01')?.request.path, path);
    assert.equal(f.log.commands.get('synthetic-command-01')?.request.method, 'PUT');
  } finally { await f.close(); }
});

test('a transport key returns its cached result and rejects a different payload instead of executing twice', async () => {
  const f = await fixture();
  try {
    const first = await f.send({ bytes: '{"draft":"synthetic"}' }); const second = await f.send({ bytes: '{"draft":"synthetic"}' });
    assert.deepEqual(first.bytes, second.bytes); assert.equal(f.log.created, 1);
    const conflict = await f.send({ bytes: '{"draft":"changed"}' });
    assert.equal(conflict.status, 409); assert.equal(json(conflict).error.code, 'worker_command_key_conflict'); assert.equal(f.log.created, 1);
  } finally { await f.close(); }
});

test('claimed and uncertain commands are observed without re-enqueue or automatic replay', async () => {
  const f = await fixture();
  try {
    f.log.makeResponse = () => undefined;
    f.log.onRead = id => { const row = f.log.commands.get(id)!;
      if (f.log.reads === 1) row.result.state = 'claimed';
      else { row.result.state = 'uncertain'; row.result.response = reply('{"error":{"code":"worker_command_uncertain"}}', 503); } };
    const result = await f.send(); assert.equal(result.status, 503); assert.equal(json(result).error.code, 'worker_command_uncertain');
    assert.equal(f.log.calls, 1); assert.equal(f.log.created, 1); assert.equal(f.log.reads, 2);
  } finally { await f.close(); }
});

test('deadline bounds a hung SQL acknowledgement but does not cancel its later durable acceptance', async () => {
  const log = new MemoryCommandLog(), acknowledgement = deferred<{ created: boolean; command: CommandResult }>();
  const original = log.enqueue.bind(log); let accepted: Awaited<ReturnType<typeof log.enqueue>> | undefined;
  log.enqueue = async input => { accepted = await original(input); return acknowledgement.promise; };
  const f = await fixture({ deadlineMs: 30 }, log);
  try {
    const result = await f.send(); assert.equal(result.status, 504); assert.equal(json(result).error.code, 'worker_request_pending');
    assert.equal(result.headers['x-rea-transport-id'], 'synthetic-command-01'); assert.equal(json(result).commandId, 'synthetic-command-01');
    assert.equal(log.created, 1); acknowledgement.resolve(accepted!); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(log.calls, 1);
  } finally { acknowledgement.resolve(accepted!); await f.close(); }
});

test('a dropped caller leaves the accepted command intact and permits its later completion', async () => {
  const f = await fixture(); f.log.makeResponse = () => undefined;
  try {
    const accepted = deferred<void>(); f.log.onRead = () => accepted.resolve();
    const request = httpRequest({ hostname: '127.0.0.1', port: f.port, method: 'POST', path: '/api/action',
      headers: { host, origin: webOrigin, 'content-type': 'application/json', 'x-rea-transport-id': 'aborted-caller-01' } });
    request.on('error', () => {}); request.end('{}'); await accepted.promise; request.destroy();
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    const row = f.log.commands.get('aborted-caller-01')!; assert.equal(row.result.state, 'queued'); assert.equal(f.log.calls, 1);
    row.result.state = 'completed'; row.result.response = reply('{"saved":true}');
    const recovered = await f.send({ headers: { 'x-rea-transport-id': 'aborted-caller-01' } });
    assert.equal(recovered.status, 200); assert.equal(json(recovered).saved, true); assert.equal(f.log.created, 1); assert.equal(row.result.state, 'completed');
  } finally { await f.close(); }
});

test('inline overflow and invalid blob stubs fail before enqueue; a valid stub is scoped and verified first', async () => {
  const seen: unknown[] = [];
  const adapter: TransportBodyAdapter = { async validateRequestBody(value, scope) { seen.push({ value, scope }); }, async responseDownload() { throw new Error('Not used'); } };
  const f = await fixture({ bodyAdapter: adapter, blobDownloadOrigin: 'https://synthetic.private.blob.vercel-storage.com' });
  try {
    assert.equal((await f.send({ bytes: Buffer.alloc(4097) })).status, 413);
    assert.equal((await f.send({ headers: { 'x-rea-transport-body': 'blob-v1' }, bytes: JSON.stringify({ ...blob, ref: 'https://attacker.test/file' }) })).status, 400);
    assert.equal((await f.send({ headers: { 'x-rea-transport-body': 'blob-v1' }, bytes: JSON.stringify({ ...blob, url: 'https://attacker.test/file' }) })).status, 400);
    assert.equal(f.log.calls, 0); assert.equal(seen.length, 0);
    const result = await f.send({ headers: { 'x-rea-transport-body': 'blob-v1' }, bytes: JSON.stringify(blob) });
    assert.equal(result.status, 200); assert.equal(f.log.calls, 1);
    assert.deepEqual(seen, [{ value: blob, scope: { namespace, commandId: 'synthetic-command-01', method: 'POST', path: '/api/action' } }]);
    assert.deepEqual(f.log.commands.get('synthetic-command-01')?.request.body, blob);
  } finally { await f.close(); }
});

test('blob results use a versioned JSON envelope with a pinned grant and preserve cookies outside JavaScript metadata', async () => {
  let grantOrigin = 'https://synthetic.private.blob.vercel-storage.com'; const expiresAt = Date.now() + 60_000;
  const adapter: TransportBodyAdapter = { async validateRequestBody() {}, async responseDownload(value, scope) {
    assert.deepEqual(value, blob); assert.deepEqual(scope, { namespace, commandId: 'synthetic-command-01' }); return { url: `${grantOrigin}/synthetic?signature=fixture`, expiresAt }; } };
  const f = await fixture({ bodyAdapter: adapter, blobDownloadOrigin: grantOrigin });
  try {
    f.log.makeResponse = () => ({ status: 200, headers: { 'content-type': 'application/pdf', 'content-length': '256', 'content-encoding': 'gzip',
      'content-disposition': 'attachment; filename="fictional.pdf"', 'set-cookie': 'rea_oauth_state=; HttpOnly; Path=/api/auth/google; Max-Age=0' }, body: blob });
    const result = await f.send(); const envelope = json(result);
    assert.equal(result.status, 200); assert.equal(result.headers['x-rea-transport-body'], 'blob-v1'); assert.match(String(result.headers['content-type']), /^application\/json/);
    assert.equal(result.headers['content-encoding'], undefined); assert.notEqual(result.headers['content-length'], '256');
    assert.deepEqual(result.headers['set-cookie'], ['rea_oauth_state=; HttpOnly; Path=/api/auth/google; Max-Age=0; Secure']);
    assert.equal(envelope.version, 1); assert.equal(envelope.response.status, 200); assert.equal(envelope.response.headers['content-type'], 'application/pdf');
    assert.equal(envelope.response.headers['set-cookie'], undefined); assert.equal(envelope.response.headers['content-length'], undefined); assert.equal(envelope.response.headers['content-encoding'], undefined);
    assert.deepEqual(envelope.response.body, blob); assert.equal(envelope.download.expiresAt, expiresAt);
    grantOrigin = 'https://attacker.example.test'; const forbidden = await f.send(); assert.equal(forbidden.status, 503); assert.equal(f.log.created, 1);
  } finally { await f.close(); }
});

test('a timed-out command has a read-only receipt route which recovers its eventual response without enqueuing again', async () => {
  const f = await fixture({ deadlineMs: 25 });
  try {
    f.log.makeResponse = () => undefined;
    const initial = await f.send(); assert.equal(initial.status, 504); assert.equal(initial.headers['x-rea-transport-state'], 'pending');
    assert.equal(initial.headers['x-rea-transport-id'], 'synthetic-command-01'); assert.equal(json(initial).commandId, 'synthetic-command-01');
    const path = '/api/_rea/transport/results/synthetic-command-01';
    const queued = await f.send({ method: 'GET', path, bytes: '' }); assert.equal(queued.status, 202); assert.equal(queued.headers['x-rea-transport-state'], 'pending'); assert.equal(queued.headers['x-rea-transport-id'], 'synthetic-command-01');
    const command = f.log.commands.get('synthetic-command-01')!; command.result = { ...command.result, state: 'completed', response: reply('{"error":{"code":"synthetic_domain_error"}}', 422) };
    const result = await f.send({ method: 'GET', path, bytes: '' }); assert.equal(result.status, 422); assert.equal(result.headers['x-rea-transport-state'], 'completed'); assert.equal(json(result).error.code, 'synthetic_domain_error');
    assert.equal(f.log.created, 1); assert.equal(f.log.calls, 1);
    assert.equal((await f.send({ method: 'GET', path: '/api/_rea/transport/results/absent-command', bytes: '' })).status, 404);
    const uncertain = { ...command.result, state: 'uncertain' as const, response: undefined }; command.result = uncertain;
    const unknown = await f.send({ method: 'GET', path, bytes: '' }); assert.equal(unknown.status, 503); assert.equal(unknown.headers['x-rea-transport-state'], 'uncertain'); assert.equal(json(unknown).error.code, 'worker_command_uncertain');
    for (const invalid of [{ method: 'POST', path, bytes: '{}' }, { method: 'GET', path: `${path}?extra=1`, bytes: '' }, { method: 'GET', path: '/api/_rea/transport/results', bytes: '' }, { method: 'GET', path, bytes: '{}' }]) assert.equal((await f.send(invalid)).status, 400);
    assert.equal(f.log.created, 1); assert.equal(f.log.calls, 1);
  } finally { await f.close(); }
});

test('an existing completed Blob receipt returns its original bounded envelope with no new command', async () => {
  const adapter: TransportBodyAdapter = { async validateRequestBody() {}, async responseDownload() { return { url: 'https://synthetic.private.blob.vercel-storage.com/mail-rpc/fixture/ref?signature=synthetic', expiresAt: Date.now() + 30_000 }; } };
  const f = await fixture({ bodyAdapter: adapter, blobDownloadOrigin: 'https://synthetic.private.blob.vercel-storage.com' });
  try {
    f.log.makeResponse = () => ({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: blob });
    assert.equal((await f.send()).status, 200);
    const result = await f.send({ method: 'GET', path: '/api/_rea/transport/results/synthetic-command-01', bytes: '', headers: { 'x-rea-transport-id': 'unrelated-request-id' } });
    assert.equal(result.status, 200); assert.equal(result.headers['x-rea-transport-state'], 'completed'); assert.equal(result.headers['x-rea-transport-id'], 'synthetic-command-01');
    assert.equal(result.headers['x-rea-transport-body'], 'blob-v1'); assert.deepEqual(json(result).response.body, blob); assert.equal(f.log.calls, 1);
  } finally { await f.close(); }
});
