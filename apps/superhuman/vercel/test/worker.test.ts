import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MailWorkerRuntime, loadWorkerConfiguration } from '../src/worker.ts';
import { command, decode, deferred, fakeCloudTransport, openWorkerFixture, until, webOrigin, workerNamespace } from './worker-fixture.ts';

const actualFetch = globalThis.fetch; let escaped = 0;
globalThis.fetch = async () => { escaped++; throw Error('Worker tests forbid real provider traffic'); };
after(() => { globalThis.fetch = actualFetch; assert.equal(escaped, 0); });
function googleAccount(app: ReturnType<typeof openWorkerFixture> extends Promise<infer F> ? F extends { cores: (infer C)[] } ? C extends { app: infer A } ? A : never : never : never) {
  app.store.put('account', 'synthetic', { id: 'synthetic', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
  app.store.put('googleGrant', 'mail:synthetic', { accountId: 'synthetic', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
  app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('synthetic', 'synthetic-never-read-token');
}
async function health(worker: MailWorkerRuntime): Promise<{ status: number; body: any }> {
  const port = (worker.health.address() as AddressInfo).port;
  return new Promise((resolve, reject) => { const req = request({ hostname: '127.0.0.1', port, path: '/healthz' }, response => {
    const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
  }); req.on('error', reject); req.end(); });
}
function answer(text: string): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'synthetic-model', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

test('real Core loopback preserves OAuth state cookie and verifies a ten MiB private attachment upload/download', async () => {
  const f = await openWorkerFixture({ overrides: { providerDraftAutomatic: false } });
  try {
    const actor = await f.startActor('loopback'); const app = f.cores[0].app;
    const auth = await f.issue(actor, 'oauth-start', command('/api/auth/google/start'));
    assert.equal(auth.status, 302); assert.equal(typeof auth.headers.location, 'string');
    const cookies = auth.headers['set-cookie'] as string[]; assert.equal(cookies.length, 1);
    assert.match(cookies[0], /HttpOnly/); assert.match(cookies[0], /SameSite=Lax/); assert.match(cookies[0], /; Secure/);
    const state = new URL(String(auth.headers.location)).searchParams.get('state')!;
    const declined = command(`/api/auth/google/callback?error=access_denied&state=${state}`);
    declined.headers.cookie = `irrelevant=discard; ${cookies[0].split(';')[0]}`;
    const failed = await f.issue(actor, 'oauth-decline', declined); assert.equal(failed.status, 400); assert.equal(decode(failed).error.code, 'oauth_declined');
    assert.equal(app.store.db.prepare('SELECT state FROM oauth_states WHERE state=?').get(state), undefined);
    const saved = await f.sql.execute('SELECT request_json FROM runtime_commands WHERE id=?', ['oauth-decline']);
    assert.equal(JSON.parse(String(saved.rows[0].request_json)).headers.cookie, `rea_oauth_state=${state}`);

    const draft = app.store.saveDraft({ accountId: 'demo', subject: 'Synthetic binary transport', body: 'Fictional attachment.' });
    const bytes = Buffer.alloc(10 * 1024 ** 2); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const uploadBytes = Buffer.from(JSON.stringify({ name: 'fictional.bin', mimeType: 'application/octet-stream', data: bytes.toString('base64') }));
    const path = `/api/drafts/${draft.id}/attachments`, scope = { namespace: workerNamespace, commandId: 'large-upload', method: 'POST', path };
    const staged = await f.bodies.createRequestUpload(scope, uploadBytes.byteLength, createHash('sha256').update(uploadBytes).digest('hex'));
    f.blob.objects.set(new URL(staged.upload.url).pathname.slice(1), uploadBytes);
    const uploaded = await f.issue(actor, scope.commandId, { method: 'POST', path, headers: { origin: webOrigin, 'content-type': 'application/json' }, body: staged.body });
    assert.equal(uploaded.status, 201); const attachmentId = decode(uploaded).attachment.id;
    const downloaded = await f.issue(actor, 'large-download', command(`${path}/${attachmentId}`));
    assert.equal(downloaded.status, 200); assert.equal(downloaded.body.kind, 'blob');
    if (downloaded.body.kind !== 'blob') throw Error('Expected private download');
    assert.equal(downloaded.body.bytes, bytes.byteLength); assert.equal(downloaded.body.sha256, createHash('sha256').update(bytes).digest('hex'));
    const grant = await f.bodies.responseDownload(downloaded.body, { namespace: workerNamespace, commandId: 'large-download' });
    assert.deepEqual(f.blob.objects.get(new URL(grant.url).pathname.slice(1)), bytes);
    assert.match(String(downloaded.headers['content-disposition']), /fictional.bin/);
    const missing = await f.sql.execute("SELECT request_json,response_json FROM runtime_commands WHERE id IN ('large-upload','large-download')");
    for (const row of missing.rows) { assert.ok(String(row.request_json).length < 2048); assert.ok(String(row.response_json).length < 8192); }
  } finally { await f.close(); }
});

test('graceful Core handoff flushes queued cloud-save debounce exactly once before releasing authority', async () => {
  const cloud = fakeCloudTransport(), timers = new Set<() => void>();
  const f = await openWorkerFixture({ overrides: { providerDraftAutomatic: true, providerDraftTransport: cloud.transport,
    scheduler: { now: Date.now, schedule(callback) { timers.add(callback); return { cancel() { timers.delete(callback); } }; } } } });
  try {
    const actor = await f.startActor('cloud-old'), app = f.cores[0].app; googleAccount(app);
    const draft = app.store.saveDraft({ accountId: 'synthetic', subject: 'Synthetic debounce', body: 'Fictional Cedar sample.' }, 'composer');
    app.store.saveDraft({ id: draft.id, body: 'Latest fictional Cedar revision.' });
    assert.equal(app.providerDrafts.status('synthetic', draft.id).state, 'queued'); assert.equal(cloud.creates(), 0); assert.ok(timers.size > 0);
    await actor.close(); assert.equal(cloud.creates(), 1); assert.equal(timers.size, 0);
    assert.equal((await f.authority.current())?.state, 'quiesced');
    const next = await f.startActor('cloud-new'); assert.equal(cloud.creates(), 1);
    const status = f.cores[1].app.providerDrafts.status('synthetic', draft.id); assert.equal(status.state, 'synced');
    assert.equal(f.cores[1].app.store.required<any>('draft', draft.id).body, 'Latest fictional Cedar revision.');
    await next.close(); assert.equal(cloud.creates(), 1);
  } finally { await f.close(); }
});

test('graceful Core handoff waits for active Ask AI completion without cancelling the provider', async () => {
  const gate = deferred<Response>(); let calls = 0, aborts = 0;
  const f = await openWorkerFixture({ transport: (async (_url, input) => { calls++; input?.signal?.addEventListener('abort', () => { aborts++; }, { once: true }); return gate.promise; }), overrides: { providerDraftAutomatic: false } });
  try {
    const actor = await f.startActor('model-old'), app = f.cores[0].app, session = app.aiChat.createSession('demo');
    const accepted = await f.issue(actor, 'ask', command(`/api/ai/chat/sessions/${session.id}/turns`, 'POST', { accountId: 'demo', clientRequestId: 'synthetic-model-handoff', expectedRevision: session.revision, prompt: 'Use fictional Cedar facts only.', context: { resources: [] } }));
    assert.equal(accepted.status, 202); await until(() => calls === 1); const turnId = decode(accepted).turn.id;
    let closed = false; const closing = actor.close().then(() => { closed = true; });
    await until(async () => (await f.authority.current())?.state === 'draining');
    assert.equal(aborts, 0); assert.equal(closed, false); assert.equal(actor.activeNative, 1);
    gate.resolve(answer('Cedar has three fictional samples.')); await closing;
    assert.equal(aborts, 0); assert.equal(calls, 1); assert.equal((await f.authority.current())?.state, 'quiesced');
    const next = await f.startActor('model-new');
    const result = await f.issue(next, 'turn-status', command(`/api/ai/chat/turns/${turnId}?accountId=demo&sessionId=${session.id}`));
    assert.equal(result.status, 200); assert.equal(decode(result).turn.state, 'completed'); assert.equal(decode(result).turn.dispatchCount, 1);
    assert.equal(calls, 1);
  } finally { gate.resolve(answer('Fictional answer.')); await f.close(); }
});

test('real Core loopback keeps ten-second Send Undo and Ask AI Stop concurrent with active background work', async () => {
  let now = Date.parse('2026-10-29T12:00:00Z'), calls = 0, aborts = 0, sends = 0;
  const timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
  const f = await openWorkerFixture({ transport: (async (_url, input) => { calls++; return new Promise<Response>((_resolve, reject) => {
    const stop = () => { aborts++; reject(new DOMException('Synthetic Stop', 'AbortError')); };
    if (input?.signal?.aborted) stop(); else input?.signal?.addEventListener('abort', stop, { once: true });
  }); }), overrides: { providerDraftAutomatic: false, scheduler: { now: () => now, schedule(callback, ms) {
    const timer = { at: now + ms, callback, cancelled: false }; timers.push(timer); return { cancel() { timer.cancelled = true; } };
  } } } });
  try {
    const actor = await f.startActor('interactive'), app = f.cores[0].app; googleAccount(app);
    app.google.send = async () => { sends++; throw Error('Undo must prevent provider issue'); }; app.google.acknowledgedDeliveryMetadata = async () => undefined;
    const draft = app.store.saveDraft({ accountId: 'synthetic', to: 'recipient@example.test', subject: 'Synthetic interactive Undo', body: 'Fictional sample.' });
    const current = app.draftSend.current('synthetic', draft.id);
    const sent = await f.issue(actor, 'interactive-send', command(`/api/drafts/${draft.id}/send-operations`, 'POST', { accountId: 'synthetic', clientRequestId: 'interactive-send-key', expectedDraftRevision: current.draftRevision, expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation }));
    assert.equal(sent.status, 202); const operation = decode(sent).operation;
    assert.equal(Date.parse(operation.cancellableUntil) - Date.parse(operation.createdAt), 10_000);
    const session = app.aiChat.createSession('demo');
    const ask = await f.issue(actor, 'interactive-ask', command(`/api/ai/chat/sessions/${session.id}/turns`, 'POST', { accountId: 'demo', clientRequestId: 'interactive-ask-key', expectedRevision: session.revision, prompt: 'Fictional Cedar sample only.', context: { resources: [] } }));
    assert.equal(ask.status, 202); await until(() => calls === 1); assert.equal(actor.activeNative, 1);
    const undo = await f.issue(actor, 'interactive-undo', command(`/api/draft-send-operations/${operation.id}/cancel`, 'POST', { accountId: 'synthetic', clientRequestId: 'interactive-undo-key', expectedRevision: operation.revision }));
    assert.equal(undo.status, 200); assert.equal(decode(undo).operation.state, 'cancelled'); assert.equal(actor.activeNative, 1);
    const turnId = decode(ask).turn.id;
    const stop = await f.issue(actor, 'interactive-stop', command(`/api/ai/chat/turns/${turnId}/cancel`, 'POST', { accountId: 'demo', sessionId: session.id }));
    assert.equal(stop.status, 200); await app.aiChat.waitForIdle(); assert.equal(aborts, 1); assert.equal(calls, 1);
    now += 20_000; for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.callback(); }
    await app.draftSend.waitForIdle(); assert.equal(sends, 0); assert.equal(actor.activeNative, 0);
    const status = await f.issue(actor, 'interactive-status', command(`/api/ai/chat/turns/${turnId}?accountId=demo&sessionId=${session.id}`));
    assert.equal(decode(status).turn.state, 'cancelled'); assert.equal(decode(status).turn.dispatchCount, 1);
  } finally { await f.close(); }
});

test('two workers keep standby healthy, construct one Core, and preserve pending Send as not_dispatched through handoff', async () => {
  const f = await openWorkerFixture({ overrides: { providerDraftAutomatic: false } }); let first: MailWorkerRuntime | undefined, second: MailWorkerRuntime | undefined;
  try {
    const opts = { authority: f.authority, log: f.log, createCore: f.createCore, healthPort: 0, healthHost: '127.0.0.1' as const, pollMs: 2, acquireMs: 5, heartbeatMs: 1000 };
    first = await MailWorkerRuntime.start({ ...opts, actorId: 'worker-a', deploymentId: 'deployment-a' }); await until(() => first!.state === 'active');
    second = await MailWorkerRuntime.start({ ...opts, actorId: 'worker-b', deploymentId: 'deployment-b' });
    await until(() => second!.state === 'waiting'); assert.equal(f.cores.length, 1);
    assert.deepEqual(await health(second), { status: 200, body: { alive: true, state: 'waiting' } });
    const app = f.cores[0].app; googleAccount(app); let sends = 0;
    app.google.send = async () => { sends++; throw Error('Handoff must not send'); }; app.google.acknowledgedDeliveryMetadata = async () => undefined;
    const draft = app.store.saveDraft({ accountId: 'synthetic', to: 'recipient@example.test', subject: 'Synthetic pending handoff', body: 'Fictional only.' });
    const current = app.draftSend.current('synthetic', draft.id);
    await f.log.enqueue({ id: 'send', namespace: workerNamespace, request: command(`/api/drafts/${draft.id}/send-operations`, 'POST', { accountId: 'synthetic', clientRequestId: 'handoff-send-key', expectedDraftRevision: current.draftRevision, expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation }) });
    await until(async () => (await f.log.readResult(workerNamespace, 'send'))?.state === 'completed');
    const accepted = (await f.log.readResult(workerNamespace, 'send'))!.response!; assert.equal(accepted.status, 202); const id = decode(accepted).operation.id;
    await first.stop(); await until(() => second!.state === 'active'); assert.equal(f.cores.length, 2); assert.equal(sends, 0);
    assert.equal((await f.authority.current())?.epoch, 2);
    await f.log.enqueue({ id: 'receipt', namespace: workerNamespace, request: command(`/api/draft-send-operations/by-request/handoff-send-key?accountId=synthetic&draftId=${draft.id}`) });
    await until(async () => (await f.log.readResult(workerNamespace, 'receipt'))?.state === 'completed');
    const status = (await f.log.readResult(workerNamespace, 'receipt'))!.response!;
    assert.equal(status.status, 200); assert.equal(decode(status).operation.id, id); assert.equal(decode(status).operation.state, 'not_dispatched'); assert.equal(decode(status).operation.error.providerOutcome, 'not_dispatched'); assert.equal(sends, 0);
    await second.stop(); assert.equal((await f.authority.current())?.state, 'quiesced');
    const readonly = new DatabaseSync(f.corePath, { readOnly: true }); try { assert.equal(readonly.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='delivery'").get()!.n, 0); } finally { readonly.close(); }
  } finally { await first?.stop(); await second?.stop(); await f.close(); }
});

test('worker configuration requires separate explicit mail/control primaries and rejects URL aliases without connecting', () => {
  const env = { MAIL_RUNTIME_NAMESPACE: 'synthetic', WEB_ORIGIN: webOrigin, GOOGLE_REDIRECT_URI: `${webOrigin}/api/auth/google/callback`, TURSO_DATABASE_URL: 'libsql://synthetic-mail.turso.io', TURSO_AUTH_TOKEN: 'synthetic-mail-token', CONTROL_TURSO_DATABASE_URL: 'libsql://synthetic-control.turso.io', CONTROL_TURSO_AUTH_TOKEN: 'synthetic-control-token', TOKEN_ENCRYPTION_KEY: '1'.repeat(64), MAIL_PRIVATE_BLOB_STORE_ID: 'store_1234567890abcdef', VERCEL_DEPLOYMENT_ID: 'deployment-fixture' };
  assert.equal(loadWorkerConfiguration(env).controlUrl, env.CONTROL_TURSO_DATABASE_URL);
  for (const change of [{ CONTROL_TURSO_DATABASE_URL: '' }, { CONTROL_TURSO_AUTH_TOKEN: '' }, { CONTROL_TURSO_DATABASE_URL: env.TURSO_DATABASE_URL }, { CONTROL_TURSO_DATABASE_URL: 'https://synthetic-mail.turso.io/' }, { GOOGLE_REDIRECT_URI: 'https://wrong.example.test/api/auth/google/callback' }]) assert.throws(() => loadWorkerConfiguration({ ...env, ...change }), /invalid|primary/i);
});

test('expired dirty authority keeps a new healthy worker in standby without constructing or releasing Core', async () => {
  const f = await openWorkerFixture(); let worker: MailWorkerRuntime | undefined;
  try {
    await f.authority.initialize(); await f.log.initialize(); const acquired = await f.authority.acquire('unproven-old', 'old-deployment');
    assert.equal(acquired.acquired, true); if (!acquired.acquired) throw Error('Expected owned authority');
    await f.authority.markUncertain(acquired.lease); await f.sql.execute('UPDATE runtime_actor SET lease_until_ms=1 WHERE namespace=?', [workerNamespace]);
    worker = await MailWorkerRuntime.start({ authority: f.authority, log: f.log, actorId: 'waiting-new', deploymentId: 'new-deployment', createCore: f.createCore, healthPort: 0, healthHost: '127.0.0.1', acquireMs: 2 });
    await new Promise<void>(resolve => setTimeout(resolve, 20)); assert.equal(worker.state, 'waiting'); assert.equal(f.cores.length, 0); assert.equal((await health(worker)).status, 200);
    await worker.stop(); assert.equal((await f.authority.current())?.state, 'uncertain'); assert.equal((await f.authority.current())?.actorId, 'unproven-old');
  } finally { await worker?.stop(); await f.close(); }
});

test('periodic cleanup runs without blocking commands and drains before worker authority is released', async () => {
  const f = await openWorkerFixture({ overrides: { providerDraftAutomatic: false } });
  const gate = deferred(); let calls = 0, worker: MailWorkerRuntime | undefined;
  try {
    worker = await MailWorkerRuntime.start({ authority: f.authority, log: f.log, actorId: 'cleanup-worker', deploymentId: 'cleanup-deployment', createCore: f.createCore,
      healthPort: 0, healthHost: '127.0.0.1', pollMs: 2, housekeepingMs: 1, housekeeping: async () => { calls++; await gate.promise; await f.bodies.cleanup(); } });
    await until(() => calls === 1);
    await f.log.enqueue({ id: 'cleanup-health', namespace: workerNamespace, request: command('/api/health') });
    await until(async () => (await f.log.readResult(workerNamespace, 'cleanup-health'))?.state === 'completed');
    assert.equal((await f.log.readResult(workerNamespace, 'cleanup-health'))!.response!.status, 200); assert.equal(calls, 1);
    let stopped = false; const stopping = worker.stop().then(() => { stopped = true; });
    await until(async () => (await f.authority.current())?.state === 'draining'); assert.equal(stopped, false);
    gate.resolve(); await stopping; assert.equal(calls, 1); assert.equal((await f.authority.current())?.state, 'quiesced');
  } finally { gate.resolve(); await worker?.stop(); await f.close(); }
});

test('SIGTERM of the owned worker subprocess drains Core, exits cleanly and durably records no-dispatch', { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rea-worker-signal-'));
  const child = fork(fileURLToPath(new URL('./worker-child.ts', import.meta.url)), [], { execPath: process.execPath,
    execArgv: ['--experimental-strip-types'], env: { REA_WORKER_CHILD_TEMP: directory, PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = ''; child.stderr?.on('data', value => { errors += String(value); });
  let exited = false; const exit = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  const messages: any[] = []; child.on('message', value => messages.push(value));
  try {
    await until(() => messages.some(value => value.state === 'ready') || exited); assert.equal(exited, false, errors);
    const operationId = messages.find(value => value.state === 'ready').operationId;
    assert.equal(child.kill('SIGTERM'), true); const result = await exit; assert.deepEqual(result, { code: 0, signal: null }, errors);
    assert.deepEqual(messages.find(value => value.state === 'stopped'), { state: 'stopped', calls: 0 });
    const control = new DatabaseSync(join(directory, 'control.sqlite'), { readOnly: true });
    try { assert.equal(control.prepare('SELECT state FROM runtime_actor WHERE namespace=?').get(workerNamespace)!.state, 'quiesced'); } finally { control.close(); }
    const mail = new DatabaseSync(join(directory, 'mail.sqlite'), { readOnly: true });
    try { const receipt = JSON.parse(String(mail.prepare('SELECT data FROM draft_send_operations WHERE id=?').get(operationId)!.data));
      assert.equal(receipt.state, 'not_dispatched'); assert.equal(receipt.error.providerOutcome, 'not_dispatched');
      assert.equal(mail.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='delivery'").get()!.n, 0);
    } finally { mail.close(); }
  } finally { if (!exited) { child.kill('SIGKILL'); await exit; } rmSync(directory, { recursive: true, force: true }); }
});
