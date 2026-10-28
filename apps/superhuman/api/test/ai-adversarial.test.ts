import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/store.ts';
import { AiProvider } from '../src/ai.ts';
import type { Thread } from '../src/types.ts';

const env = { ANTHROPIC_API_KEY: 'synthetic-review-key', ANTHROPIC_MODEL: 'explicit-synthetic-model', OPENAI_API_KEY: 'must-not-be-used', OPENAI_MODEL: 'must-not-be-used' };
const complete = { id: 'msg_synthetic', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Synthetic generated text.' }] };
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
function configFixture() {
  const root = mkdtempSync(join(tmpdir(), 'superhuman-config-adversarial-')), script = join(root, 'scripts/configure-superhuman.mjs'), destination = join(root, 'apps/superhuman/api/.env');
  mkdirSync(dirname(script), { recursive: true }); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(join(repositoryRoot, 'scripts/configure-superhuman.mjs'), script);
  writeFileSync(`${destination}.example`, 'TOKEN_ENCRYPTION_KEY=\nAI_PROVIDER=anthropic\nANTHROPIC_API_KEY=\nANTHROPIC_MODEL=\n');
  return { root, script, destination, run: (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }), close: () => rmSync(root, { recursive: true, force: true }) };
}
function selectedThread(id: string, messages: number, sender = { name: 'Synthetic Sender', email: 'sender@example.test' }): Thread {
  return { id, accountId: 'synthetic-account', subject: 'Synthetic selected conversation', snippet: 'Synthetic preview', sender, participants: [sender], lastMessageAt: '2026-10-27T12:00:00Z', unread: true, starred: false, important: true, folder: 'inbox', labels: [], messages: Array.from({ length: messages }, (_, index) => ({ id: `${id}-${index}`, sender, to: [], date: '2026-10-27T12:00:00Z', text: `Synthetic message ${index}`, attachments: [] })) };
}
function contextFixture(thread: Thread) {
  const store = new Store(':memory:', false); store.put('account', 'synthetic-account', { id: 'synthetic-account', email: 'owner@example.test', name: 'Synthetic', provider: 'demo', color: '#000000' }); store.put('thread', thread.id, thread); store.put('thread', 'unselected', selectedThread('unselected', 1, { name: 'UNSELECTED_PRIVATE_MARKER', email: 'other@example.test' }));
  store.threads = () => { throw new Error('AI must not scan the mailbox'); }; let payload: Record<string, unknown> | undefined;
  const ai = new AiProvider(store, env, (async (url, init) => { assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); payload = JSON.parse(String(init?.body)); return new Response(JSON.stringify(complete), { status: 200 }); }) as typeof fetch);
  return { store, ai, payload: () => payload!, context: () => JSON.parse((payload!.messages as { content: string }[])[0].content).selectedConversation };
}

test('malformed Google import diagnostics cannot print a misselected private key file', () => {
  const f = configFixture(); try {
    const secret = 'offline-secret-only', wrongDocument = join(f.root, 'wrong-oauth.json'); writeFileSync(wrongDocument, secret);
    const result = f.run(['--google', wrongDocument]); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret)); assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});

test('unknown option diagnostics do not echo accidental command-line credential values', () => {
  const f = configFixture(); try {
    const secret = 'offline-key-never-echo', result = f.run([`--ai-key=${secret}`]);
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret)); assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});

test('selected context projects and bounds sender headers instead of serializing arbitrary sender data', async () => {
  const sender = { name: 'N'.repeat(100_000), email: 'E'.repeat(100_000), unrelatedPrivateData: 'SENDER_EXTRA_PRIVATE_MARKER' };
  const thread = selectedThread('selected', 10, sender); for (const message of thread.messages) { message.date = 'D'.repeat(100_000); message.text = 'T'.repeat(5000); }
  const f = contextFixture(thread); try {
    await f.ai.generate({ accountId: thread.accountId, mode: 'summarize', prompt: '', threadId: thread.id }); const payload = JSON.stringify(f.payload());
    assert.ok(payload.length < 80_000, `Selected context must have a total bound; received ${payload.length} characters`); assert.doesNotMatch(payload, /SENDER_EXTRA_PRIVATE_MARKER|UNSELECTED_PRIVATE_MARKER/);
    for (const message of f.context().messages) { assert.deepEqual(Object.keys(message.from).sort(), ['email', 'name']); assert.ok(message.from.name.length <= 1000); assert.ok(message.from.email.length <= 320); assert.ok(message.date.length <= 64); }
  } finally { f.store.close(); }
});

test('a truncated conversation explicitly tells the model how many older messages were omitted', async () => {
  const f = contextFixture(selectedThread('selected', 12)); try {
    await f.ai.generate({ accountId: 'synthetic-account', mode: 'summarize', prompt: '', threadId: 'selected' }); const context = f.context();
    assert.equal(context.messages.length, 10); assert.equal(context.totalMessageCount, 12); assert.equal(context.omittedMessageCount, 2); assert.equal(context.messages[0].text, 'Synthetic message 2');
    assert.match(String(f.payload().system), /untrusted data/); assert.doesNotMatch(JSON.stringify(f.payload()), /UNSELECTED_PRIVATE_MARKER/);
  } finally { f.store.close(); }
});

test('HTML-only mail supplies bounded visible text without scripts, styles or remote media', async () => {
  const thread = selectedThread('html-selected', 2);
  thread.messages[0].text = ''; thread.messages[0].html = '<p>Visible &amp; available</p><p>Meeting at 2 pm.</p><script>PRIVATE_SCRIPT_MARKER</script><style>PRIVATE_STYLE_MARKER</style><img src="https://untrusted.example.test/pixel">';
  thread.messages[1].text = ''; thread.messages[1].html = '<p>' + 'Z'.repeat(6000) + '</p>';
  const f = contextFixture(thread); try {
    await f.ai.generate({ accountId: thread.accountId, mode: 'summarize', prompt: '', threadId: thread.id }); const context = f.context();
    assert.match(context.messages[0].text, /Visible & available/); assert.match(context.messages[0].text, /Meeting at 2 pm\./);
    assert.equal(context.messages[1].text.length, 4500); assert.equal(context.messages[1].truncated, true);
    assert.doesNotMatch(JSON.stringify(f.payload()), /PRIVATE_SCRIPT_MARKER|PRIVATE_STYLE_MARKER|untrusted\.example\.test|<p>/); assert.equal(Object.hasOwn(context.messages[0], 'html'), false);
  } finally { f.store.close(); }
});

test('the real request deadline aborts both header and body waits without retrying or changing provider', async () => {
  const originalTimeout = AbortSignal.timeout;
  try {
    for (const phase of ['headers', 'body']) {
      const abort = new AbortController(); let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
      AbortSignal.timeout = milliseconds => { assert.equal(milliseconds, 60_000); return abort.signal; };
      const store = new Store(':memory:', false), ai = new AiProvider(store, env, (async (url, init) => {
        calls++; assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); assert.equal(init?.signal, abort.signal);
        const wait = () => new Promise<never>((_resolve, reject) => { abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true }); entered(); });
        if (phase === 'headers') return wait();
        const response = new Response(JSON.stringify(complete), { status: 200 }); response.json = wait; return response;
      }) as typeof fetch);
      try {
        const pending = ai.generate({ mode: 'write', prompt: 'Synthetic prompt' }); await waiting;
        abort.abort(new DOMException('PRIVATE_TIMEOUT_DETAILS', 'TimeoutError'));
        await assert.rejects(pending, error => { assert.equal((error as { code: string }).code, 'ai_provider_timeout'); assert.equal((error as { status: number }).status, 504); assert.doesNotMatch((error as Error).message, /PRIVATE_TIMEOUT_DETAILS/); return true; }); assert.equal(calls, 1);
      } finally { store.close(); }
    }
  } finally { AbortSignal.timeout = originalTimeout; }
});

test('invalid key-file content preserves existing credentials byte-for-byte and never prints the key', () => {
  const f = configFixture(); try {
    const original = 'TOKEN_ENCRYPTION_KEY="synthetic-existing-encryption-key"\nGOOGLE_CLIENT_SECRET="synthetic-existing-google-secret"\n'; writeFileSync(f.destination, original, { mode: 0o600 });
    const key = join(f.root, 'invalid-key.txt'); writeFileSync(key, 'offline-key-part-one\noffline-key-part-two'); const result = f.run(['--ai-key-file', key, '--model', 'explicit-model']);
    assert.notEqual(result.status, 0); assert.equal(readFileSync(f.destination, 'utf8'), original); assert.doesNotMatch(result.stdout + result.stderr, /offline-key-part-one|offline-key-part-two|synthetic-existing-google-secret/);
  } finally { f.close(); }
});
