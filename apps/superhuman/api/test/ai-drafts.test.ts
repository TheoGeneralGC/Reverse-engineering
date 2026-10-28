import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from '../src/store.ts';
import { AiChatService } from '../src/ai-chat.ts';
import { createApp } from '../src/server.ts';
import { AiDraftService } from '../src/ai-drafts.ts';
import { hash } from '../src/ai-chat-store.ts';
import type { AiChatSubmit } from '../src/ai-chat-types.ts';
import type { AiDraftPreview } from '../src/ai-draft-types.ts';

const env = { DATABASE_PATH: ':memory:', ANTHROPIC_API_KEY: 'synthetic-only', ANTHROPIC_MODEL: 'synthetic-model' };
const payload = { to: [{ email: 'cedar@example.test', name: 'Cedar, Example' }], cc: [{ email: 'birch@example.test' }], bcc: [], subject: 'Fictional samples', body: 'Thursday at 3 PM. Three samples.' };
function response(text: string, proposal?: unknown, stop = proposal ? 'tool_use' : 'end_turn') {
  const events: any[] = [{ type: 'message_start', message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic-model', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }];
  let index = 0;
  if (text) { events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index }); index++; }
  if (proposal) events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: 'tool_propose', name: 'propose_email_draft', input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(proposal) } }, { type: 'content_block_stop', index });
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 30 } }, { type: 'message_stop' });
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function request(sessionRevision = 0): AiChatSubmit { return { accountId: 'demo', clientRequestId: 'synthetic-turn', expectedRevision: sessionRevision, prompt: 'Write a new fictional email. Do not send or save it.', context: { resources: [] } }; }
function fixture(fetcher: typeof fetch) { const store = new Store(':memory:'); const service = new AiChatService(store, env, fetcher); const session = service.createSession('demo'); return { store, service, session, close: async () => { await service.close(); store.close(); } }; }
const count = (store: Store, table: string) => Number(store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
function scope(preview: AiDraftPreview) { return { accountId: preview.accountId, sessionId: preview.sessionId, turnId: preview.turnId }; }

test('proposal tool creates no Draft until completed preview is explicitly activated; replay returns current user edits', async () => {
  let calls = 0; const f = fixture((async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)); assert.deepEqual(body.tools.map((t: any) => t.name), ['propose_email_draft']);
    if (calls === 1) return response('', payload);
    assert.equal(count(f.store, 'ai_draft_previews'), 0); assert.equal(f.store.list('draft').length, baseline);
    const ack = JSON.parse(body.messages.at(-1).content[0].content); assert.equal(ack.persistence, 'preview-only'); assert.equal(ack.requiresUserCreateDraft, true); assert.equal(ack.draftId, undefined);
    return response('Review this fictional preview.');
  }) as typeof fetch); const baseline = f.store.list('draft').length;
  try {
    const accepted = f.service.submit(f.session.id, request()); await f.service.waitForIdle(); const turn = f.service.turn('demo', f.session.id, accepted.turn.id).turn;
    assert.equal(turn.state, 'completed', JSON.stringify(turn.error)); assert.equal(turn.previews?.length, 1); assert.equal(count(f.store, 'ai_draft_previews'), 1); assert.equal(f.store.list('draft').length, baseline);
    const preview = turn.previews![0]; const progress = f.service.events('demo', f.session.id, turn.id).events;
    assert.equal(progress.filter(e => e.payload.kind === 'preview').length, 1); assert.equal(progress.at(-1)?.payload.kind, 'terminal');
    const input = { ...scope(preview), clientRequestId: 'explicit-action', expectedGeneration: 0, expectedPreviewHash: preview.payloadHash };
    const created = f.service.drafts.create(preview.id, input); assert.equal(created.created, true); assert.equal(created.result.draft?.to, '"Cedar, Example" <cedar@example.test>'); assert.equal(created.result.draft?.cc, 'birch@example.test'); assert.equal(created.result.draft?.status, 'draft');
    assert.equal(f.store.list('draft').length, baseline + 1); assert.equal(calls, 2);
    const original = created.result.draft!; f.store.saveDraft({ ...original, subject: 'User changed subject', body: 'User authored content' });
    const replay = f.service.drafts.create(preview.id, input); assert.equal(replay.created, false); assert.equal(replay.result.draft?.id, original.id); assert.equal(replay.result.draft?.subject, 'User changed subject'); assert.equal(replay.result.draft?.body, 'User authored content');
    assert.equal(f.service.drafts.byRequest(scope(preview), preview.id, 'explicit-action').request?.id, created.result.request?.id); assert.equal(calls, 2);
  } finally { await f.close(); }
});

test('incomplete, cancelled and duplicate proposal turns expose no actionable artifact or new Draft', async () => {
  for (const scenario of ['incomplete', 'cancelled', 'duplicate'] as const) {
    let calls = 0; let release!: (value: Response) => void; let entered!: () => void; const waiting = new Promise<void>(r => { entered = r; });
    const f = fixture((async () => { calls++; if (calls === 1) return response('', payload); if (scenario === 'cancelled') { entered(); return new Promise<Response>(r => { release = r; }); } return scenario === 'duplicate' ? response('', payload) : response('Incomplete prose', undefined, 'max_tokens'); }) as typeof fetch); const baseline = f.store.list('draft').length;
    try {
      const accepted = f.service.submit(f.session.id, request()); if (scenario === 'cancelled') { await waiting; f.service.cancel('demo', f.session.id, accepted.turn.id); }
      await f.service.waitForIdle(); const turn = f.service.turn('demo', f.session.id, accepted.turn.id).turn;
      assert.equal(turn.state, scenario === 'cancelled' ? 'cancelled' : 'failed'); assert.equal(turn.answer, null); assert.equal(turn.previews?.length ?? 0, 0); assert.equal(count(f.store, 'ai_draft_previews'), 0); assert.equal(f.store.list('draft').length, baseline); assert.ok(!f.service.events('demo', f.session.id, turn.id).events.some(e => e.payload.kind === 'preview')); assert.equal(calls, 2);
      if (release) { release(response('Late answer')); await Promise.resolve(); assert.equal(count(f.store, 'ai_draft_previews'), 0); }
    } finally { await f.close(); }
  }
});

test('completed preview insertion and its final answer/events commit atomically on database failure', async () => {
  let calls = 0; const f = fixture((async () => ++calls === 1 ? response('', payload) : response('Ready.')) as typeof fetch); const baseline = f.store.list('draft').length;
  try {
    f.store.db.exec("CREATE TRIGGER synthetic_preview_commit_failure BEFORE INSERT ON ai_draft_previews BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const accepted = f.service.submit(f.session.id, request()); await f.service.waitForIdle(); const turn = f.service.turn('demo', f.session.id, accepted.turn.id).turn;
    assert.equal(turn.state, 'failed'); assert.equal(turn.answer, null); assert.equal(turn.previews?.length ?? 0, 0); assert.equal(count(f.store, 'ai_draft_previews'), 0); assert.equal(f.store.list('draft').length, baseline); assert.ok(!f.service.events('demo', f.session.id, turn.id).events.some(e => e.payload.kind === 'preview')); assert.equal(calls, 2);
  } finally { await f.close(); }
});

async function invoke(app: ReturnType<typeof createApp>, method: string, url: string, value?: unknown) { return new Promise<{ status: number; body: any }>(resolve => { const request = Object.assign(Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]), { method, url, headers: { host: '127.0.0.1:3001', 'content-type': 'application/json' } }); const response = { setHeader() {}, writeHead(status: number) { this.status = status; }, status: 0, end(body: string) { resolve({ status: this.status, body: JSON.parse(body) }); } }; app.server.emit('request', request, response); }); }
test('HTTP preview/create/lost-ACK lookup is account-scoped, local-only and preserves sanitized rich alternatives', async () => {
  let calls = 0; const app = createApp({ databasePath: ':memory:', env, runJobs: false, aiFetch: (async () => ++calls === 1 ? response('', { ...payload, body: 'Untrusted competing plain alternative', html: '<p>Thursday <strong>3 PM</strong>. Three samples.</p><script>bad()</script>' }) : response('Review before creating.')) as typeof fetch });
  try {
    const session = (await invoke(app, 'POST', '/api/ai/chat/sessions', { accountId: 'demo' })).body.session;
    const submitted = await invoke(app, 'POST', `/api/ai/chat/sessions/${session.id}/turns`, request()); assert.equal(submitted.status, 202); await app.aiChat.waitForIdle();
    const turn = app.aiChat.turn('demo', session.id, submitted.body.turn.id).turn; assert.equal(turn.state, 'completed', JSON.stringify(turn.error)); const preview = turn.previews![0]; const query = new URLSearchParams(scope(preview)).toString(); const route = `/api/ai/chat/artifacts/${preview.id}`;
    assert.equal((await invoke(app, 'GET', `${route}?${query}`)).body.creation, null);
    const created = await invoke(app, 'POST', `${route}/create-draft`, { ...scope(preview), clientRequestId: 'http-action', expectedGeneration: 0, expectedPreviewHash: preview.payloadHash }); assert.equal(created.status, 201); assert.equal(created.body.draft.body, 'Thursday 3 PM. Three samples.'); assert.doesNotMatch(created.body.draft.html, /script|bad\(\)/); assert.equal(created.body.draft.providerDraftId, undefined);
    const found = await invoke(app, 'GET', `/api/ai/chat/draft-actions/by-request/http-action?${query}&previewId=${preview.id}`); assert.equal(found.status, 200); assert.equal(found.body.request.id, created.body.request.id); assert.equal(found.body.draft.id, created.body.draft.id);
    assert.equal((await invoke(app, 'GET', `${route}?${query}&foreign=true`)).status, 400); assert.equal((await invoke(app, 'GET', `${route}?accountId=other&sessionId=${session.id}&turnId=${turn.id}`)).status, 404); assert.equal((await invoke(app, 'POST', `${route}/create-draft`, { ...scope(preview), clientRequestId: 'different-key', expectedGeneration: 0, expectedPreviewHash: preview.payloadHash, body: 'forged' })).status, 400); assert.equal(calls, 2);
  } finally { await app.close(); }
});


test('legacy single-creation prototype upgrades atomically to generation zero without rewriting mail or action identity', async () => {
  let calls = 0; const f = fixture((async () => ++calls === 1 ? response('', payload) : response('Ready.')) as typeof fetch);
  try {
    const turn = f.service.submit(f.session.id, request()).turn; await f.service.waitForIdle(); const preview = f.service.turn('demo', f.session.id, turn.id).turn.previews![0];
    const input = { ...scope(preview), clientRequestId: 'legacy-action', expectedGeneration: 0, expectedPreviewHash: preview.payloadHash }; const created = f.service.drafts.create(preview.id, input).result;
    const mail = f.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(created.draft!.id)!.data;
    // Model the unreleased prototype schema and fingerprint, in this memory DB.
    f.store.db.exec(`ALTER TABLE ai_draft_creations RENAME TO synthetic_new_creations;
      CREATE TABLE ai_draft_creations(id TEXT PRIMARY KEY,preview_id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
      INSERT INTO ai_draft_creations SELECT id,preview_id,account_id,session_id,turn_id,draft_id,json_remove(data,'$.generation') FROM synthetic_new_creations;
      DROP TABLE synthetic_new_creations;
      UPDATE ai_draft_requests SET data=json_remove(data,'$.generation');`);
    const legacyFingerprint = hash({ ...scope(preview), previewId: preview.id, expectedPreviewHash: preview.payloadHash }); f.store.db.prepare('UPDATE ai_draft_requests SET fingerprint=?').run(legacyFingerprint);
    const upgraded = new AiDraftService(f.store, f.service.repository); const recovered = upgraded.create(preview.id, input).result;
    assert.equal(recovered.creation?.generation, 0); assert.equal(recovered.request?.generation, 0); assert.equal(recovered.request?.id, created.request?.id); assert.equal(recovered.draft?.id, created.draft?.id); assert.equal(f.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(created.draft!.id)!.data, mail);
    new AiDraftService(f.store, f.service.repository); assert.equal(count(f.store, 'ai_draft_creations'), 1); assert.equal(count(f.store, 'ai_draft_requests'), 1);
    f.store.deleteDraft(created.draft!.id); assert.equal(upgraded.get(scope(preview), preview.id).createGeneration, 1);
    const next = upgraded.create(preview.id, { ...input, clientRequestId: 'generation-one', expectedGeneration: 1 }).result; assert.equal(next.creation?.generation, 1); assert.notEqual(next.draft?.id, created.draft?.id); assert.equal(upgraded.byRequest(scope(preview), preview.id, input.clientRequestId).creation?.draftId, created.draft?.id); assert.equal(upgraded.byRequest(scope(preview), preview.id, input.clientRequestId).resolution.availability, 'unavailable');
  } finally { await f.close(); }
});

test('a failed legacy-generation upgrade rolls back schema, receipts and original records', async () => {
  const f = fixture((async () => response('Unused')) as typeof fetch);
  try {
    f.store.db.exec(`DROP TABLE ai_draft_creations;
      CREATE TABLE ai_draft_creations(id TEXT PRIMARY KEY,preview_id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL);`);
    const bad = { id: 'bad-request', accountId: 'demo', sessionId: 'missing-session', turnId: 'missing-turn', previewId: 'missing-preview', creationId: 'missing-creation', clientRequestId: 'bad-key', createdAt: '2026-10-28T00:00:00.000Z' };
    f.store.db.prepare('INSERT INTO ai_draft_requests VALUES(?,?,?,?,?,?,?,?,?)').run(bad.id, bad.accountId, bad.sessionId, bad.turnId, bad.previewId, bad.clientRequestId, 'old-fingerprint', bad.creationId, JSON.stringify(bad));
    const records = f.store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all();
    assert.throws(() => new AiDraftService(f.store, f.service.repository), /Legacy draft action has no owned preview/);
    assert.ok(!f.store.db.prepare('PRAGMA table_info(ai_draft_creations)').all().some(r => r.name === 'generation')); assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='ai_draft_creations_legacy'").get(), undefined); assert.equal(f.store.db.prepare('SELECT data FROM ai_draft_requests WHERE id=?').get(bad.id)!.data, JSON.stringify(bad)); assert.deepEqual(f.store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all(), records);
  } finally { await f.close(); }
});
