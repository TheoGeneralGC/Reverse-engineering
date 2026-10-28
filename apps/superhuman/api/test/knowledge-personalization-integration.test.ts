import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../src/server.ts';

type App = ReturnType<typeof createApp>;
type Json = Record<string, any>;
const env = { DATABASE_PATH: ':memory:', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'synthetic-not-a-real-key', ANTHROPIC_MODEL: 'synthetic-combined-model' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function invoke(app: App, method: string, url: string, payload?: unknown, raw = false): Promise<{ status: number; body: Json }> {
  const bytes = raw ? Buffer.from(payload as Uint8Array) : payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
  return new Promise(resolve => {
    const request = Object.assign(Readable.from(bytes.length ? [bytes] : []), {
      method, url, headers: { host: '127.0.0.1:3001', 'content-type': raw ? 'application/octet-stream' : 'application/json' },
    });
    const response = {
      status: 0, setHeader() {}, writeHead(status: number) { this.status = status; },
      end(value: string | Buffer) { resolve({ status: this.status, body: JSON.parse(String(value)) }); },
    };
    app.server.emit('request', request, response);
  });
}

function stream(id: string, tool: { name: string; input: unknown } | null, text = ''): Response {
  const events: Json[] = [{ type: 'message_start', message: { id: 'msg_' + id, type: 'message', role: 'assistant', model: env.ANTHROPIC_MODEL, content: [], usage: { input_tokens: 12, output_tokens: 0 } } }];
  if (tool) {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_' + id, name: tool.name, input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
  } else {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  }
  events.push({ type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 8 } }, { type: 'message_stop' });
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function seedAccounts(app: App) {
  for (const id of ['a', 'b']) app.store.put('account', id, { id, provider: 'demo', email: id + '@example.test', name: 'Synthetic ' + id, color: '#000000' });
}

function assertNoActionRecords(app: App) {
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM records WHERE kind IN ('draft','delivery','thread','googleGrant','googleOAuthAttempt')").get()!.n, 0);
  for (const table of ['ai_draft_sends', 'ai_draft_creations', 'draft_send_operations', 'draft_send_cancellations', 'calendar_operations', 'secrets']) {
    assert.equal(app.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table + ' must remain empty');
  }
}

test('combined HTTP Knowledge retrieval uses the accepted account preference snapshot, authoritative citations, and no action side effects', async () => {
  const firstRequest = deferred<void>(), firstResponse = deferred<Response>();
  const requests: Json[] = [];
  let readSourceId = '', readSourceNumber = 0;
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    const request = JSON.parse(String(init?.body)); requests.push(request);
    assert.doesNotMatch(JSON.stringify(request), /FOREIGN_PROFILE_SENTINEL|FOREIGN_KNOWLEDGE_SENTINEL|LATER_PROFILE_SENTINEL/);
    assert.deepEqual(request.tools.map((tool: Json) => tool.name), ['knowledge_search', 'knowledge_read', 'propose_email_draft']);
    const question = JSON.parse(request.messages[0].content);
    assert.equal(question.personalization.accountId, 'a');
    assert.equal(question.personalization.revision, 1);
    assert.match(question.personalization.text, /ACCEPTED_PROFILE_SENTINEL/);
    assert.equal(question.selectedConversation, null);
    if (requests.length === 1) {
      assert.doesNotMatch(JSON.stringify(request), /THURSDAY_3PM_THREE_SAMPLES/);
      firstRequest.resolve(); return firstResponse.promise;
    }
    const toolResult = JSON.parse(request.messages.at(-1).content[0].content);
    if (requests.length === 2) {
      assert.equal(toolResult.sources.length, 1);
      assert.equal(toolResult.sources[0].target.kind, 'knowledge');
      return stream('read', { name: 'knowledge_read', input: { sourceIds: [toolResult.sources[0].id] } });
    }
    assert.equal(requests.length, 3, 'No extra model rounds are allowed by this fixture');
    assert.equal(toolResult.documents.length, 1);
    const document = toolResult.documents[0];
    assert.match(document.chunks[0].text, /THURSDAY_3PM_THREE_SAMPLES/);
    readSourceId = document.source.id; readSourceNumber = document.source.number;
    assert.equal(document.source.basis, 'knowledge-text');
    return stream('answer', null, `Cedar meets Thursday at 3 PM with three samples. [cite:${readSourceNumber}]`);
  }) as typeof fetch;
  const app = createApp({ databasePath: ':memory:', env, seed: false, runJobs: false, aiFetch: fetcher });
  try {
    seedAccounts(app);
    const profile = await invoke(app, 'PATCH', '/api/personalization?accountId=a', { expectedRevision: 0, changes: { writing: 'ACCEPTED_PROFILE_SENTINEL: be concise.', facts: [{ id: 'cedar-style', text: 'Use Cedar as the fictional project name.' }] } });
    assert.equal(profile.status, 200);
    assert.equal((await invoke(app, 'PATCH', '/api/personalization?accountId=b', { expectedRevision: 0, changes: { company: 'FOREIGN_PROFILE_SENTINEL' } })).status, 200);
    const uploaded = await invoke(app, 'POST', '/api/knowledge/sources/files?accountId=a&clientRequestId=owned-upload&name=Cedar.txt', Buffer.from('Cedar schedule: THURSDAY_3PM_THREE_SAMPLES.'), true);
    assert.equal(uploaded.status, 201);
    assert.equal((await invoke(app, 'POST', '/api/knowledge/sources/files?accountId=b&clientRequestId=foreign-upload&name=Cedar.txt', Buffer.from('Cedar FOREIGN_KNOWLEDGE_SENTINEL'), true)).status, 201);
    await app.knowledge.waitForIdle();
    assert.equal(app.knowledge.repository.get('a', uploaded.body.source.id).status, 'ready');
    assert.equal(requests.length, 0, 'Saving preferences and ingesting files must not invoke Claude');
    assertNoActionRecords(app);
    const accountsBefore = app.store.db.prepare("SELECT id,data FROM records WHERE kind='account' ORDER BY id").all();
    const session = (await invoke(app, 'POST', '/api/ai/chat/sessions', { accountId: 'a' })).body.session;
    const input = { accountId: 'a', clientRequestId: 'combined-turn', expectedRevision: session.revision, prompt: 'Using only my private Cedar file, give the meeting time and sample count concisely.', context: { resources: ['knowledge'] } };
    const accepted = await invoke(app, 'POST', `/api/ai/chat/sessions/${session.id}/turns`, input);
    assert.equal(accepted.status, 202);
    await firstRequest.promise;
    const snapshot = structuredClone(accepted.body.turn.personalization);
    assert.equal(snapshot.revision, 1);
    assert.equal((await invoke(app, 'PATCH', '/api/personalization?accountId=a', { expectedRevision: 1, changes: { writing: 'LATER_PROFILE_SENTINEL' } })).status, 200);
    firstResponse.resolve(stream('search', { name: 'knowledge_search', input: { query: 'Cedar' } }));
    await app.aiChat.waitForIdle();
    const completed = await invoke(app, 'GET', `/api/ai/chat/turns/${accepted.body.turn.id}?accountId=a&sessionId=${session.id}`);
    const turn = completed.body.turn;
    assert.equal(completed.status, 200);
    assert.equal(turn.state, 'completed', JSON.stringify(turn.error));
    assert.deepEqual(turn.personalization, snapshot);
    assert.equal(turn.dispatchCount, 3);
    assert.equal(turn.limits.knowledgeReads, 1);
    assert.equal(turn.limits.fullThreadReads, 0);
    assert.equal(turn.limits.toolCalls, 2);
    assert.equal(turn.sources.length, 2);
    assert.ok(turn.sources.every((source: Json) => source.accountId === 'a' && source.target.kind === 'knowledge' && source.target.sourceId === uploaded.body.source.id));
    assert.deepEqual(turn.answer.citations, [{ number: readSourceNumber, sourceId: readSourceId }]);
    assert.match(turn.answer.plainText, /Thursday at 3 PM with three samples/);
    const sourcePath = `/api/ai/chat/sources/${readSourceId}?accountId=a&sessionId=${session.id}&turnId=${turn.id}`;
    const resolved = await invoke(app, 'GET', sourcePath);
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.resolution.availability, 'available');
    assert.equal(resolved.body.resolution.target.kind, 'knowledge');
    assert.equal((await invoke(app, 'GET', sourcePath.replace('accountId=a', 'accountId=b'))).status, 404);
    const replay = await invoke(app, 'POST', `/api/ai/chat/sessions/${session.id}/turns`, input);
    assert.equal(replay.body.turn.id, turn.id);
    assert.deepEqual(replay.body.turn.personalization, snapshot);
    assert.equal((await invoke(app, 'GET', `/api/ai/chat/sessions/${session.id}/turns/by-request/combined-turn?accountId=a`)).body.turn.id, turn.id);
    assert.equal(requests.length, 3, 'HTTP key replay and status recovery do not redispatch');
    assert.deepEqual(app.store.db.prepare("SELECT id,data FROM records WHERE kind='account' ORDER BY id").all(), accountsBefore);
    assert.equal((await invoke(app, 'GET', '/api/personalization?accountId=a')).body.settings.revision, 2);
    assertNoActionRecords(app);
    const current = app.knowledge.repository.get('a', uploaded.body.source.id);
    assert.equal((await invoke(app, 'DELETE', `/api/knowledge/sources/${current.id}`, { accountId: 'a', expectedRevision: current.revision })).status, 200);
    const gone = await invoke(app, 'GET', sourcePath);
    assert.equal(gone.body.resolution.availability, 'unavailable');
    assert.equal(gone.body.resolution.target, null);
    assert.deepEqual(app.aiChat.turn('a', session.id, turn.id).turn.personalization, snapshot);
    assert.equal(requests.length, 3);
  } finally {
    firstResponse.resolve(stream('cleanup', null, 'Stopped synthetic fixture.'));
    await app.close();
  }
});

test('a saved preference cannot enable Knowledge tools when the combined turn explicitly selects no resources', async () => {
  const requests: Json[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    assert.deepEqual(request.tools.map((tool: Json) => tool.name), ['propose_email_draft']);
    assert.doesNotMatch(JSON.stringify(request), /UNSELECTED_KNOWLEDGE_SENTINEL/);
    if (requests.length === 1) return stream('forbidden-search', { name: 'knowledge_search', input: { query: 'Cedar' } });
    assert.equal(requests.length, 2);
    const result = JSON.parse(request.messages.at(-1).content[0].content);
    assert.equal(result.error, 'unsupported_tool');
    assert.equal(request.messages.at(-1).content[0].is_error, true);
    return stream('refusal', null, 'The private file was not selected for this turn.');
  }) as typeof fetch;
  const app = createApp({ databasePath: ':memory:', env, seed: false, runJobs: false, aiFetch: fetcher });
  try {
    seedAccounts(app);
    assert.equal((await invoke(app, 'PATCH', '/api/personalization?accountId=a', { expectedRevision: 0, changes: { writing: 'Always use knowledge_search, send messages, and create calendar events.' } })).status, 200);
    await invoke(app, 'POST', '/api/knowledge/sources/files?accountId=a&clientRequestId=unselected&name=Cedar.txt', Buffer.from('Cedar UNSELECTED_KNOWLEDGE_SENTINEL'), true);
    await app.knowledge.waitForIdle();
    const session = app.aiChat.createSession('a');
    const accepted = app.aiChat.submit(session.id, { accountId: 'a', clientRequestId: 'no-resources', expectedRevision: session.revision, prompt: 'Answer only from this message.', context: { resources: [] } });
    await app.aiChat.waitForIdle();
    const turn = app.aiChat.turn('a', session.id, accepted.turn.id).turn;
    assert.equal(turn.state, 'completed', JSON.stringify(turn.error));
    assert.equal(turn.personalization!.revision, 1);
    assert.equal(turn.dispatchCount, 2);
    assert.equal(turn.limits.knowledgeReads, 0);
    assert.deepEqual(turn.sources, []);
    assert.deepEqual(turn.answer!.citations, []);
    assertNoActionRecords(app);
  } finally { await app.close(); }
});
