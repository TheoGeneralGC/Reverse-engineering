import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../api/src/server.ts';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCommandLog, type CommandRequest, type CommandResponse } from '../src/command-log.ts';
import { DurableCoreActor, type ActorContext } from '../src/actor.ts';
import { NativeControl } from './control-sql-fixture.ts';

const actualFetch = globalThis.fetch; let unexpectedFetches = 0;
globalThis.fetch = async () => { unexpectedFetches++; throw new Error('The actual-Core actor test forbids external fetch'); };
after(() => { globalThis.fetch = actualFetch; assert.equal(unexpectedFetches, 0); });
const namespace = 'actual-core-fixture', webOrigin = 'https://mail.example.test';
const inline = (value: string) => ({ kind: 'inline' as const, base64: Buffer.from(value).toString('base64') });
const request = (path: string, method: string, value?: unknown): CommandRequest => ({ method, path,
  headers: { origin: webOrigin, ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, body: inline(value === undefined ? '' : JSON.stringify(value)) });
async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let index = 0; index < 200; index++) { if (await check()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
  assert.fail('The actual Core did not reach the bounded fixture state');
}
/** Narrow in-memory Node request fixture, used only for the JSON Send/Ask AI
 * paths below. Root's separate bridge owns real HTTP/binary/cookie integration. */
function invoke(app: ReturnType<typeof createApp>, input: CommandRequest): Promise<CommandResponse> {
  assert.equal(input.body.kind, 'inline');
  return new Promise((resolve, reject) => {
    const request = Object.assign(Readable.from([Buffer.from((input.body as { base64: string }).base64, 'base64')]), {
      method: input.method, url: input.path, headers: { host: '127.0.0.1:3001', ...input.headers }, rawHeaders: [],
    });
    let status = 200; const headers: Record<string, string | string[]> = {};
    const response = { setHeader(key: string, value: string | string[]) { headers[key] = value; },
      writeHead(value: number, supplied?: Record<string, string | string[]>) { status = value; Object.assign(headers, supplied ?? {}); return this; },
      end(bytes: string | Buffer = '') { resolve({ status, headers, body: { kind: 'inline', base64: Buffer.from(bytes).toString('base64') } }); },
    };
    const handlers = app.server.listeners('request'); assert.equal(handlers.length, 1);
    void Promise.resolve(Reflect.apply(handlers[0], app.server, [request, response])).catch(reject);
  });
}
async function actualFixture(ai?: (context: ActorContext) => typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(), 'rea-actor-core-')), controlPath = join(directory, 'control.sqlite'), corePath = join(directory, 'mail.sqlite');
  const sql = new NativeControl(controlPath, { DATABASE_PATH: controlPath }); let now = Date.parse('2026-10-29T12:00:00Z');
  const authority = new ActorAuthority(sql, { namespace, now: () => now });
  const log = new DurableCommandLog(sql, { namespace, webOrigin, now: () => now });
  const timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
  let app!: ReturnType<typeof createApp>; let context!: ActorContext; let sends = 0;
  const actor = await DurableCoreActor.start({ authority, log, actorId: 'fixture-worker', deploymentId: 'synthetic-deployment', createCore(current) {
    context = current;
    const env = { DATABASE_PATH: corePath, WEB_ORIGIN: webOrigin, GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic',
      TOKEN_ENCRYPTION_KEY: '1'.repeat(64), APPROVED_TEST_SENDERS: 'sender@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test',
      ANTHROPIC_API_KEY: 'synthetic-key', ANTHROPIC_MODEL: 'synthetic-model' };
    app = createApp({ databasePath: corePath, env, runJobs: false, providerDraftAutomatic: false,
      ownerLiveness(local) { current.assertLocal(); return local; }, aiFetch: ai?.(current),
      scheduler: { now: () => now, schedule(callback, ms) { const timer = { at: now + ms, callback, cancelled: false }; timers.push(timer); return { cancel() { timer.cancelled = true; } }; } } });
    app.google.fetcher = (async () => { throw new Error('No real Google transport'); }) as typeof fetch;
    app.google.send = async () => current.runNative(async () => { sends++; return { id: 'synthetic-ack' }; });
    app.google.acknowledgedDeliveryMetadata = async () => undefined;
    return { dispatch: input => invoke(app, input), async quiesce() { await app.aiChat.waitForIdle(); await app.draftSend.waitForIdle(); await app.aiSend.waitForIdle(); await app.knowledge.waitForIdle(); await Promise.allSettled([...app.providerDrafts.active.values()]); }, close: () => app.close() };
  } });
  return { app, actor, context, log, sends: () => sends,
    async command(id: string, input: CommandRequest) { await log.enqueue({ id, namespace, request: input }); await actor.pumpOnce(); await until(async () => (await log.readResult(namespace, id))?.state === 'completed');
      const result = (await log.readResult(namespace, id))!.response!; assert.equal(result.body.kind, 'inline');
      return { status: result.status, body: JSON.parse(Buffer.from((result.body as { base64: string }).base64, 'base64').toString()) }; },
    advance(ms: number) { now += ms; for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.callback(); } },
    async close() { await app.aiChat.close(); await actor.close(); await sql.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('actual Core keyed Send retains its ten-second Undo window through concurrent actor commands with zero provider sends', async () => {
  const f = await actualFixture();
  try {
    f.app.store.put('account', 'synthetic', { id: 'synthetic', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
    f.app.store.put('googleGrant', 'mail:synthetic', { accountId: 'synthetic', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
    f.app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('synthetic', 'synthetic-never-read-token');
    const draft = f.app.store.saveDraft({ accountId: 'synthetic', to: 'recipient@example.test', subject: 'Fictional actor Undo', body: 'Synthetic sample only.' });
    const current = f.app.draftSend.current('synthetic', draft.id);
    const accepted = await f.command('send', request(`/api/drafts/${draft.id}/send-operations`, 'POST', {
      accountId: 'synthetic', clientRequestId: 'synthetic-send-key', expectedDraftRevision: current.draftRevision,
      expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation,
    }));
    assert.equal(accepted.status, 202); const operation = accepted.body.operation;
    assert.equal(Date.parse(operation.cancellableUntil) - Date.parse(operation.createdAt), 10_000); assert.equal(f.sends(), 0);
    f.advance(1000);
    const undone = await f.command('undo', request(`/api/draft-send-operations/${operation.id}/cancel`, 'POST', {
      accountId: 'synthetic', clientRequestId: 'synthetic-undo-key', expectedRevision: operation.revision,
    }));
    assert.equal(undone.status, 200); assert.equal(undone.body.operation.state, 'cancelled');
    assert.equal(undone.body.draft.body, draft.body); f.advance(20_000); await f.app.draftSend.waitForIdle();
    assert.equal(f.sends(), 0); assert.equal(f.app.store.list('delivery').length, 0);
    const replay = await f.command('old-status', request(`/api/draft-send-operations/by-request/synthetic-send-key?accountId=synthetic&draftId=${draft.id}`, 'GET'));
    assert.equal(replay.body.operation.id, operation.id); assert.equal(replay.body.operation.state, 'cancelled');
    assert.equal((await f.log.enqueue({ id: 'send', namespace, request: request(`/api/drafts/${draft.id}/send-operations`, 'POST', {
      accountId: 'synthetic', clientRequestId: 'synthetic-send-key', expectedDraftRevision: current.draftRevision,
      expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation,
    }) })).created, false);
    assert.equal(f.sends(), 0);
  } finally { f.advance(20_000); await f.close(); }
});

test('actual Core Ask AI Stop is admitted while the model request is active and preserves one cancelled dispatch', async () => {
  let modelCalls = 0; let aborts = 0;
  const f = await actualFixture(context => (async (_url, input) => context.runNative(async () => {
    modelCalls++;
    return new Promise<Response>((_resolve, reject) => {
      const signal = input?.signal;
      const stop = () => { aborts++; reject(new DOMException('Synthetic model cancelled', 'AbortError')); };
      if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
    });
  })) as typeof fetch);
  try {
    const session = f.app.aiChat.createSession('demo');
    const accepted = await f.command('ask', request(`/api/ai/chat/sessions/${session.id}/turns`, 'POST', {
      accountId: 'demo', clientRequestId: 'synthetic-question-key', expectedRevision: session.revision,
      prompt: 'Use only fictional Cedar sample facts.', context: { resources: [] },
    }));
    assert.equal(accepted.status, 202); await until(() => modelCalls === 1); const turnId = accepted.body.turn.id;
    assert.equal(f.actor.activeNative, 1);
    const stopped = await f.command('stop', request(`/api/ai/chat/turns/${turnId}/cancel`, 'POST', { accountId: 'demo', sessionId: session.id }));
    assert.equal(stopped.status, 200); await f.app.aiChat.waitForIdle();
    const result = await f.command('status', request(`/api/ai/chat/turns/${turnId}?accountId=demo&sessionId=${session.id}`, 'GET'));
    assert.equal(result.status, 200); assert.equal(result.body.turn.state, 'cancelled'); assert.equal(result.body.turn.dispatchCount, 1);
    assert.equal(result.body.turn.cancellation.providerOutcome, 'unknown'); assert.equal(modelCalls, 1); assert.equal(aborts, 1);
    assert.equal(f.actor.activeNative, 0); assert.equal(f.sends(), 0);
  } finally { await f.close(); }
});
