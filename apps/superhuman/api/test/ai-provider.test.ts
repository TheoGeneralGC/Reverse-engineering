import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/store.ts';
import { AiProvider } from '../src/ai.ts';
import { HttpError } from '../src/types.ts';
import type { Thread } from '../src/types.ts';

const env = { ANTHROPIC_API_KEY: 'synthetic-claude-key', ANTHROPIC_MODEL: 'explicit-test-model' };
const complete = { id: 'msg_test', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Generated draft.' }] };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const rejectCode = (code: string, status?: number) => (error: unknown) => error instanceof HttpError && error.code === code && (status === undefined || error.status === status);

function harness(data: unknown = complete, status = 200, overrides: NodeJS.ProcessEnv = {}) {
  const store = new Store(':memory:'); const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const ai = new AiProvider(store, { ...env, ...overrides }, (async (url, init) => { requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) }); return reply(data, status); }) as typeof fetch);
  return { store, ai, requests };
}

test('Claude is default, requires both explicit settings and never falls back to present OpenAI credentials', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const ai = new AiProvider(store, { OPENAI_API_KEY: 'other-key', OPENAI_MODEL: 'other-model' }, (async () => { calls++; return reply(complete); }) as typeof fetch);
  const status = ai.status(); assert.equal(status.provider, 'anthropic'); assert.equal(status.displayName, 'Claude'); assert.equal(status.configured, false); assert.equal(status.model, null); assert.equal(status.liveVerified, false); assert.deepEqual(status.missing, ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']);
  await assert.rejects(() => ai.generate({ mode: 'write', prompt: 'Write a greeting' }), error => rejectCode('ai_not_configured', 503)(error) && (error as Error).message === 'Configure ANTHROPIC_API_KEY and ANTHROPIC_MODEL to enable Claude');
  for (const configured of [{ ANTHROPIC_API_KEY: 'key' }, { ANTHROPIC_MODEL: 'model' }, { ANTHROPIC_API_KEY: ' ', ANTHROPIC_MODEL: ' ' }]) assert.equal(new AiProvider(store, configured).status().configured, false);
  assert.equal(calls, 0); assert.ok(!JSON.stringify(status).includes('other-key')); store.close();
});

test('explicit unsupported selector fails closed and explicit OpenAI retains Responses request contract', async () => {
  const h = harness({}, 200, { AI_PROVIDER: 'unknown' }); assert.deepEqual(h.ai.status().missing, ['AI_PROVIDER']); assert.equal(h.ai.status().implemented, false);
  await assert.rejects(() => h.ai.generate({ mode: 'write', prompt: 'Hello' }), rejectCode('ai_not_configured')); assert.equal(h.requests.length, 0); h.store.close();
  const openai = harness({ id: 'response_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OpenAI draft' }] }] }, 200, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'openai-only', OPENAI_MODEL: 'chosen-openai-model' });
  const result = await openai.ai.generate({ mode: 'write', prompt: 'Hello' }); assert.equal(result.text, 'OpenAI draft'); assert.equal(result.model, 'chosen-openai-model');
  assert.equal(openai.requests[0].url, 'https://api.openai.com/v1/responses'); assert.equal(openai.requests[0].body.store, false); assert.equal(openai.requests[0].body.max_output_tokens, 4096); assert.equal((openai.requests[0].init.headers as Record<string, string>).authorization, 'Bearer openai-only'); openai.store.close();
});

test('Claude request uses official Messages contract, explicit model, bounded selected context, and no tools', async () => {
  const h = harness(complete, 200, { ANTHROPIC_WORKSPACE_ID: 'workspace-test' });
  const base = h.store.required<Thread>('thread', 'demo-thread-1');
  h.store.put('thread', base.id, { ...base, messages: Array.from({ length: 12 }, (_, index) => ({ ...base.messages[0], id: `message-${index}`, text: index === 11 ? 'Z'.repeat(20000) : `message-${index}` })) });
  const result = await h.ai.generate({ accountId: 'demo', mode: 'summarize', prompt: '', threadId: base.id }); assert.equal(result.responseId, 'msg_test'); assert.equal(result.contextThreadId, base.id); assert.equal(result.model, 'explicit-test-model');
  const { url, init, body } = h.requests[0]; const headers = init.headers as Record<string, string>;
  assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(init.method, 'POST'); assert.ok(init.signal instanceof AbortSignal); assert.equal(headers.authorization, 'Bearer synthetic-claude-key'); assert.equal(headers['anthropic-version'], '2026-10-21'); assert.equal(headers['anthropic-workspace-id'], 'workspace-test'); assert.equal(headers['content-type'], 'application/json');
  assert.equal(body.model, 'explicit-test-model'); assert.equal(body.max_tokens, 4096); assert.equal(body.stream, false); assert.equal(body.tools, undefined); assert.equal(body.temperature, undefined); assert.match(String(body.system), /untrusted data/); assert.match(String(body.system), /You have no tools/);
  const messages = body.messages as { role: string; content: string }[]; assert.equal(messages.length, 1); assert.equal(messages[0].role, 'user'); const input = JSON.parse(messages[0].content);
  assert.equal(input.request, 'Summarize this conversation.'); assert.equal(input.selectedConversation.messages.length, 10); assert.equal(input.selectedConversation.messages[0].text, 'message-2'); assert.equal(input.selectedConversation.messages[9].text.length, 4500); assert.equal(input.selectedConversation.messages[9].truncated, true); assert.ok(!messages[0].content.includes('Design review')); assert.equal(h.requests.length, 1); h.store.close();
});

test('unselected requests provide no mailbox context and text extraction excludes thinking or tool blocks', async () => {
  const h = harness({ ...complete, content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'First.' }, null, { type: 'tool_use', text: 'not a draft' }, { type: 'text', text: 'Second.' }] });
  const result = await h.ai.generate({ mode: 'write', prompt: 'A short greeting' }); assert.equal(result.text, 'First.\nSecond.'); assert.equal(result.contextThreadId, null); assert.equal(JSON.parse((h.requests[0].body.messages as { content: string }[])[0].content).selectedConversation, null); assert.equal((h.requests[0].init.headers as Record<string, string>)['anthropic-workspace-id'], undefined); h.store.close();
});

test('Claude truncation, incomplete/tool/unknown stops and refusal never become usable draft output', async () => {
  for (const stop_reason of ['max_tokens', 'model_context_window_exceeded', 'tool_use', 'pause_turn', 'stop_sequence', null, 'future_unknown']) {
    const h = harness({ ...complete, stop_reason }); await assert.rejects(() => h.ai.generate({ mode: 'write', prompt: 'Hello' }), rejectCode('ai_incomplete_response', 502)); assert.equal(h.requests.length, 1); h.store.close();
  }
  const h = harness({ ...complete, stop_reason: 'refusal' }); await assert.rejects(() => h.ai.generate({ mode: 'ask', prompt: 'Hello' }), rejectCode('ai_refused', 422)); h.store.close();
  for (const data of [{ ...complete, content: [] }, { ...complete, role: 'user' }, { ...complete, type: 'error' }, null]) { const empty = harness(data); await assert.rejects(() => empty.ai.generate({ mode: 'write', prompt: 'Hello' }), error => error instanceof HttpError && ['ai_incomplete_response', 'ai_invalid_response'].includes(error.code)); empty.store.close(); }
});

test('Claude HTTP failures are sanitized, name the provider, and are not retried or sent to OpenAI', async () => {
  for (const [providerStatus, localStatus, message] of [[401, 502, /authentication/], [403, 502, /permission/], [402, 502, /billing/], [404, 502, /model/], [429, 429, /rate limit/], [529, 503, /temporarily unavailable/], [500, 502, /request failed/]] as const) {
    const h = harness({ error: { message: 'provider-secret synthetic-claude-key and email context' } }, providerStatus, { OPENAI_API_KEY: 'other-key', OPENAI_MODEL: 'other-model' });
    await assert.rejects(() => h.ai.generate({ mode: 'write', prompt: 'Hello' }), error => { assert.ok(rejectCode('ai_provider_error', localStatus)(error)); assert.match((error as Error).message, /^Claude /); assert.match((error as Error).message, message); assert.doesNotMatch((error as Error).message, /provider-secret|synthetic-claude-key|email context/); return true; }); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, 'https://api.anthropic.com/v1/messages'); h.store.close();
  }
});

test('invalid JSON, network loss and timeout are explicit failures without generated fallback', async () => {
  for (const [fetcher, code, status] of [
    [(async () => new Response('not-json')) as typeof fetch, 'ai_invalid_response', 502],
    [(async () => { throw new Error('secret connection detail'); }) as typeof fetch, 'ai_provider_unavailable', 502],
    [(async () => { const error = new Error('secret timeout'); error.name = 'TimeoutError'; throw error; }) as typeof fetch, 'ai_provider_timeout', 504],
    [(async () => { const response = reply(complete); response.json = async () => { const error = new Error('secret body timeout'); error.name = 'AbortError'; throw error; }; return response; }) as typeof fetch, 'ai_provider_timeout', 504],
  ] as const) {
    const store = new Store(':memory:'); const ai = new AiProvider(store, env, fetcher);
    await assert.rejects(() => ai.generate({ mode: 'write', prompt: 'Hello' }), error => { assert.ok(rejectCode(code, status)(error)); assert.match((error as Error).message, /^Claude /); assert.doesNotMatch((error as Error).message, /secret/); return true; }); store.close();
  }
});

test('invalid prompt/mode and summary without a selected thread fail before generation', async () => {
  const h = harness();
  await assert.rejects(() => h.ai.generate({ mode: 'ask', prompt: ' ' }), /Enter a prompt/); await assert.rejects(() => h.ai.generate({ mode: 'write', prompt: 'x'.repeat(10001) }), /too long/); await assert.rejects(() => h.ai.generate({ mode: 'unsupported' as 'ask', prompt: 'Hello' }), /Unknown AI mode/); await assert.rejects(() => h.ai.generate({ mode: 'summarize', prompt: '' }), /Select a thread/); assert.equal(h.requests.length, 0); h.store.close();
});

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
function configFixture() {
  const root = mkdtempSync(join(tmpdir(), 'superhuman-ai-config-')); const script = join(root, 'scripts/configure-superhuman.mjs'); const destination = join(root, 'apps/superhuman/api/.env'); mkdirSync(dirname(script), { recursive: true }); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(join(repositoryRoot, 'scripts/configure-superhuman.mjs'), script); writeFileSync(`${destination}.example`, 'TOKEN_ENCRYPTION_KEY=\nAI_PROVIDER=anthropic\nANTHROPIC_API_KEY=\nANTHROPIC_MODEL=\nOPENAI_API_KEY=\nOPENAI_MODEL=\n'); const key = join(root, 'key.txt'); writeFileSync(key, 'offline-key-never-printed\n');
  return { root, script, destination, key, run: (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }) };
}

test('local configuration helper defaults to Claude, routes flags independent of order, and preserves Google import', () => {
  const f = configFixture(); try {
    const google = join(f.root, 'google.json'); writeFileSync(google, JSON.stringify({ web: { client_id: 'synthetic-id', client_secret: 'synthetic-secret' } }));
    const result = f.run(['--ai-key-file', f.key, '--model', 'chosen-claude-model', '--ai-workspace', 'wrkspc_test', '--google', google]); assert.equal(result.status, 0, result.stderr); const source = readFileSync(f.destination, 'utf8'); assert.match(source, /^AI_PROVIDER="anthropic"$/m); assert.match(source, /^ANTHROPIC_API_KEY="offline-key-never-printed"$/m); assert.match(source, /^ANTHROPIC_MODEL="chosen-claude-model"$/m); assert.match(source, /^ANTHROPIC_WORKSPACE_ID="wrkspc_test"$/m); assert.match(source, /^GOOGLE_CLIENT_ID="synthetic-id"$/m); assert.match(source, /^GOOGLE_CLIENT_SECRET="synthetic-secret"$/m); assert.match(source, /^OPENAI_API_KEY=$/m); assert.doesNotMatch(result.stdout + result.stderr, /offline-key-never-printed|synthetic-secret/); assert.equal(statSync(f.destination).mode & 0o777, 0o600);
    const openai = f.run(['--model', 'chosen-openai-model', '--ai-key-file', f.key, '--ai-provider=openai']); assert.equal(openai.status, 0, openai.stderr); const updated = readFileSync(f.destination, 'utf8'); assert.match(updated, /^AI_PROVIDER="openai"$/m); assert.match(updated, /^OPENAI_MODEL="chosen-openai-model"$/m); assert.match(updated, /^OPENAI_API_KEY="offline-key-never-printed"$/m); assert.match(updated, /^ANTHROPIC_MODEL="chosen-claude-model"$/m);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('local configuration helper rejects invalid provider/workspace/empty key without writing credentials', () => {
  for (const kind of ['provider', 'workspace', 'empty-key', 'missing-model']) {
    const f = configFixture(); try { if (kind === 'empty-key') writeFileSync(f.key, ' \n'); const args = kind === 'provider' ? ['--ai-provider', 'unknown'] : kind === 'workspace' ? ['--ai-provider', 'openai', '--ai-workspace', 'workspace'] : kind === 'missing-model' ? ['--model', '--ai-provider=anthropic'] : ['--ai-key-file', f.key]; const result = f.run(args); assert.notEqual(result.status, 0); assert.throws(() => readFileSync(f.destination)); assert.doesNotMatch(result.stdout + result.stderr, /offline-key-never-printed/); } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
