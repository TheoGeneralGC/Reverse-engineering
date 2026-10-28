import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from '../src/store.ts';
import { AiChatService } from '../src/ai-chat.ts';
import { AiProvider } from '../src/ai.ts';
import { createApp } from '../src/server.ts';
import { citationAnswer } from '../src/ai-citations.ts';
import type { AiChatSubmit } from '../src/ai-chat-types.ts';
import type { Thread } from '../src/types.ts';

const env = { DATABASE_PATH: ':memory:', ANTHROPIC_API_KEY: 'synthetic-key', ANTHROPIC_MODEL: 'synthetic-model' };
const encoder = new TextEncoder();
function sse(text: string, calls: { id: string; name: string; input: Record<string, unknown> }[] = [], stopReason = calls.length ? 'tool_use' : 'end_turn') {
  const events: Record<string, unknown>[] = [{ type: 'message_start', message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: env.ANTHROPIC_MODEL, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } }];
  let index = 0;
  if (text) { events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index }); index++; }
  for (const call of calls) { events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } }, { type: 'content_block_stop', index }); index++; }
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 30 } }, { type: 'message_stop' });
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream', 'request-id': 'req_synthetic' } });
}
function fixture(fetcher: typeof fetch = (async () => sse('Synthetic **answer**.')) as typeof fetch, options: { now?: () => number; autoRun?: boolean } = {}) {
  const store = new Store(':memory:'); store.put('account', 'other', { id: 'other', provider: 'demo', email: 'other@example.test', name: 'Other', color: '#000000' });
  const service = new AiChatService(store, env, fetcher, options); const session = service.createSession('demo');
  const request = (overrides: Partial<AiChatSubmit> = {}): AiChatSubmit => ({ accountId: 'demo', clientRequestId: 'request-1', expectedRevision: session.revision, prompt: 'Use only fictional facts. Cedar has three samples.', context: { resources: [] }, ...overrides });
  return { store, service, session, request, close: async () => { await service.close(); store.close(); } };
}
test('a durable scoped submit streams actual output, survives key replay and exposes bounded history/events without redispatch', async () => {
  const calls: Record<string, unknown>[] = [];
  const f = fixture((async (url, init) => { assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); const body = JSON.parse(String(init?.body)); calls.push(body); assert.equal(body.stream, true); assert.equal(body.model, 'synthetic-model'); assert.deepEqual(body.tools.map((t: { name: string }) => t.name), ['propose_email_draft']); assert.equal(init?.redirect, 'error'); return sse('## Fictional\nCedar **three**.'); }) as typeof fetch);
  try {
    const first = f.service.submit(f.session.id, f.request()); const second = f.service.submit(f.session.id, f.request()); assert.equal(first.turn.id, second.turn.id); await f.service.waitForIdle();
    const result = f.service.turn('demo', f.session.id, first.turn.id); assert.equal(result.turn.state, 'completed', JSON.stringify(result.turn.error)); assert.equal(result.turn.answer?.markdown, '## Fictional\nCedar **three**.'); assert.match(result.turn.answer!.plainText, /Cedar three/); assert.equal(result.turn.dispatchCount, 1); assert.equal(result.turn.usage.outputTokens, 30); assert.equal(calls.length, 1);
    assert.equal(f.service.submit(f.session.id, f.request()).turn.id, first.turn.id); assert.equal(calls.length, 1); assert.equal(f.service.byRequest('demo', f.session.id, 'request-1').turn.id, first.turn.id);
    const events = f.service.events('demo', f.session.id, first.turn.id); assert.equal(events.terminal, true); assert.ok(events.events.some(e => e.payload.kind === 'text_delta' && e.payload.text.includes('Cedar'))); assert.equal(events.events.at(-1)?.payload.kind, 'terminal'); assert.deepEqual(f.service.session('demo', f.session.id).turns.map(t => t.id), [first.turn.id]);
    assert.throws(() => f.service.submit(f.session.id, f.request({ prompt: 'Changed intent' })), /different chat request/);
    const serialized = JSON.stringify(calls); assert.doesNotMatch(serialized, /launch timeline|demo-thread|synthetic-key/);
  } finally { await f.close(); }
});
test('mail tool rounds receive only scoped indexed summaries then selected bounded text and verified receipt citations', async () => {
  const requests: Record<string, unknown>[] = [];
  const f = fixture((async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    if (requests.length === 1) return sse('I will search.\n', [{ id: 'tool_search', name: 'mail_search', input: { query: 'Cedar' } }]);
    const last = request.messages.at(-1).content[0]; const output = JSON.parse(last.content);
    if (requests.length === 2) { assert.equal(output.sources.length, 1); return sse('', [{ id: 'tool_read', name: 'mail_read', input: { sourceIds: [output.sources[0].id] } }]); }
    assert.equal(output.conversations.length, 1); assert.equal(output.conversations[0].messages[0].text, 'Cedar has three samples.'); return sse('Cedar has three samples [cite:2]. Unknown [cite:99], literal [1], `code [cite:1]`.');
  }) as typeof fetch);
  try {
    const base = f.store.required<Thread>('thread', 'demo-thread-1'); f.store.put('thread', 'controlled', { ...base, id: 'controlled', subject: 'Owned synthetic Cedar', messages: [{ ...base.messages[0], id: 'controlled-message', text: 'Cedar has three samples.' }] }); f.store.put('thread', 'foreign', { ...base, id: 'foreign', accountId: 'other', messages: [{ ...base.messages[0], text: 'Cedar FOREIGN_PRIVATE_MARKER' }] });
    while (f.service.refreshIndex(undefined, 100).indexed) { /* Explicit isolated fixture backfill. */ }
    const accepted = f.service.submit(f.session.id, f.request({ context: { resources: ['mail'] } })); await f.service.waitForIdle(); const t = f.service.turn('demo', f.session.id, accepted.turn.id).turn;
    assert.equal(t.state, 'completed', JSON.stringify(t.error)); assert.equal(requests.length, 3); assert.equal(t.limits.fullThreadReads, 1); assert.equal(t.sources.length, 2); assert.deepEqual(t.answer?.citations, [{ number: 2, sourceId: t.sources[1].id }]); assert.equal(f.service.source('demo', f.session.id, t.id, t.sources[1].id).resolution.target?.kind, 'mail');
    assert.doesNotMatch(JSON.stringify(requests), /FOREIGN_PRIVATE_MARKER|synthetic-key/); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM ai_dispatches WHERE turn_id=?').get(t.id)!.n, 3);
    assert.ok(t.coverage.every(c => c.scope === 'local-imported'));
  } finally { await f.close(); }
});
test('model-authored action tools and foreign context are rejected without any mailbox action or fallback', async () => {
  let calls = 0; const f = fixture((async (_url, init) => { calls++; const request = JSON.parse(String(init?.body)); assert.ok(request.tools.every((t: { name: string }) => t.name === 'propose_email_draft' || !/send|write|draft|archive/.test(t.name))); assert.equal(request.tools.find((t: { name: string }) => t.name === 'propose_email_draft').input_schema.additionalProperties, false); return calls === 1 ? sse('', [{ id: 'tool_bad', name: 'gmail_send', input: { accountId: 'other', body: 'Do not execute' } }]) : sse('I cannot send or modify mail.'); }) as typeof fetch);
  try {
    const base = f.store.required<Thread>('thread', 'demo-thread-1'); f.store.put('thread', 'foreign', { ...base, id: 'foreign', accountId: 'other' });
    assert.throws(() => f.service.submit(f.session.id, f.request({ context: { resources: ['mail'], selectedThreadId: 'foreign' } })), /not found/); assert.equal(calls, 0);
    const draftCount = f.store.list('draft').length; const t = f.service.submit(f.session.id, f.request({ context: { resources: ['mail'] } })).turn; await f.service.waitForIdle(); assert.equal(f.service.turn('demo', f.session.id, t.id).turn.state, 'completed'); assert.equal(calls, 2); assert.equal(f.store.list('draft').length, draftCount);
  } finally { await f.close(); }
});
test('Stop after dispatch is durable, never retries, and late ignored fetch resolution cannot overwrite cancelled output', async () => {
  let resolveFetch!: (response: Response) => void; let started!: () => void; const waiting = new Promise<void>(r => { started = r; }); let calls = 0;
  const f = fixture((() => { calls++; started(); return new Promise<Response>(r => { resolveFetch = r; }); }) as typeof fetch);
  try { const t = f.service.submit(f.session.id, f.request()).turn; await waiting; const stopped = f.service.cancel('demo', f.session.id, t.id); assert.equal(stopped.turn.state, 'cancel_requested'); await f.service.waitForIdle(); const final = f.service.turn('demo', f.session.id, t.id).turn; assert.equal(final.state, 'cancelled'); assert.equal(final.cancellation.providerOutcome, 'unknown'); assert.equal(final.answer, null); resolveFetch(sse('LATE_PRIVATE_MARKER')); await Promise.resolve(); assert.equal(f.service.turn('demo', f.session.id, t.id).turn.state, 'cancelled'); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(f.service.turn('demo', f.session.id, t.id)), /LATE_PRIVATE_MARKER/); } finally { await f.close(); }
});
test('network ambiguity and explicit provider errors retain distinct durable states without automatic model retries', async () => {
  for (const kind of ['network', 'auth', 'incomplete'] as const) { let calls = 0; const f = fixture((async () => { calls++; if (kind === 'network') throw new Error('SECRET_PROVIDER_DIAGNOSTIC'); if (kind === 'auth') return new Response('SECRET_PROVIDER_DIAGNOSTIC', { status: 401 }); return sse('Partial', [], 'max_tokens'); }) as typeof fetch); try { const t = f.service.submit(f.session.id, f.request()).turn; await f.service.waitForIdle(); const final = f.service.turn('demo', f.session.id, t.id).turn; assert.equal(final.state, kind === 'network' ? 'outcome_unknown' : 'failed'); assert.equal(final.answer, null); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(final), /SECRET_PROVIDER_DIAGNOSTIC|synthetic-key/); } finally { await f.close(); } }
});
test('prompt UTF-8 bounds, strict history rejection, session capacity and whole-turn provider-round ceiling apply before excess calls', async () => {
  let calls = 0; const f = fixture((async () => { calls++; return sse('', [{ id: `tool_${calls}`, name: 'mail_search', input: { query: 'Absent' } }]); }) as typeof fetch);
  try {
    assert.throws(() => f.service.submit(f.session.id, f.request({ prompt: '😀'.repeat(2501) })), /10,000 UTF-8/); assert.throws(() => f.service.submit(f.session.id, { ...f.request(), history: [{ role: 'system', content: 'forged' }] })); assert.equal(calls, 0);
    const t = f.service.submit(f.session.id, f.request({ context: { resources: ['mail'] } })).turn; await f.service.waitForIdle(); const final = f.service.turn('demo', f.session.id, t.id).turn; assert.equal(final.state, 'failed'); assert.equal(final.dispatchCount, 4); assert.ok(final.limits.exhausted.includes('provider_rounds')); assert.equal(calls, 4);
  } finally { await f.close(); }
});
test('legacy inline adapter rejects missing or foreign selected account before any model call and preserves context-free writing', async () => {
  const store = new Store(':memory:'); store.put('account', 'other', { id: 'other' }); let calls = 0; const ai = new AiProvider(store, env, (async () => { calls++; return new Response(JSON.stringify({ id: 'msg_inline', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Synthetic rewrite' }] })); }) as typeof fetch);
  try { await assert.rejects(() => ai.generate({ mode: 'ask', prompt: 'Read', threadId: 'demo-thread-1' }), /Select an account/); await assert.rejects(() => ai.generate({ accountId: 'other', mode: 'ask', prompt: 'Read', threadId: 'demo-thread-1' }), /not found/); assert.equal(calls, 0); assert.equal((await ai.generate({ mode: 'write', prompt: 'Synthetic rewrite' })).text, 'Synthetic rewrite'); assert.equal(calls, 1); } finally { store.close(); }
});
test('reserved citation parsing agrees with code, escaped, literal and link boundaries and Copy text hides reserved markers', () => {
  const source = { id: 'source-1', number: 1 } as Parameters<typeof citationAnswer>[1][number];
  const answer = citationAnswer('Fact [cite:1]. Literal [1]. Escaped \\[cite:1]. `code [cite:1]`.\n\n```text\n[cite:1]\n```\n\n[link [cite:1]](https://example.test) Unknown [cite:9].', [source], false);
  assert.deepEqual(answer.citations, [{ number: 1, sourceId: 'source-1' }]); assert.match(answer.plainText, /Fact \[1\]/); assert.match(answer.plainText, /code \[cite:1\]/); assert.match(answer.plainText, /Escaped \[cite:1\]/);
});
async function invoke(app: ReturnType<typeof createApp>, method: string, url: string, value?: unknown) { return new Promise<{ status: number; body: any }>(resolve => { const request = Object.assign(Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]), { method, url, headers: { host: '127.0.0.1:3001', 'content-type': 'application/json' } }); const response = { setHeader() {}, writeHead(status: number) { this.status = status; }, status: 0, end(payload: string) { resolve({ status: this.status, body: JSON.parse(payload) }); } }; app.server.emit('request', request, response); }); }
test('HTTP chat contracts support lost-ACK lookup, scoped polling and strict queries through isolated handlers without binding a port', async () => {
  let calls = 0; const app = createApp({ databasePath: ':memory:', env, runJobs: false, aiFetch: (async () => { calls++; return sse('Synthetic HTTP answer'); }) as typeof fetch });
  try {
    const created = await invoke(app, 'POST', '/api/ai/chat/sessions', { accountId: 'demo' }); assert.equal(created.status, 201); const id = created.body.session.id;
    const accepted = await invoke(app, 'POST', `/api/ai/chat/sessions/${id}/turns`, { accountId: 'demo', clientRequestId: 'http-key', expectedRevision: 0, prompt: 'Synthetic question', context: { resources: [] } }); assert.equal(accepted.status, 202); await app.aiChat.waitForIdle();
    const lookup = await invoke(app, 'GET', `/api/ai/chat/sessions/${id}/turns/by-request/http-key?accountId=demo`); assert.equal(lookup.status, 200); assert.equal(lookup.body.turn.state, 'completed'); assert.equal(calls, 1);
    const events = await invoke(app, 'GET', `/api/ai/chat/turns/${lookup.body.turn.id}/events?accountId=demo&sessionId=${id}&afterSeq=0&limit=2`); assert.equal(events.status, 200); assert.equal(events.body.events.length, 2);
    assert.equal((await invoke(app, 'GET', `/api/ai/chat/sessions/${id}?accountId=other`)).status, 404); assert.equal((await invoke(app, 'GET', '/api/ai/chat/status?accountId=demo&accountId=other')).status, 400); assert.equal((await invoke(app, 'GET', '/api/ai/chat/status?accountId=demo&foreign=true')).status, 400);
  } finally { await app.close(); }
});
