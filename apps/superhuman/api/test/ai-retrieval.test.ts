import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { AiChatRepository } from '../src/ai-chat-store.ts';
import { AiRetrieval, initializeAiMailIndex, refreshAiMailIndex, mailCoverage } from '../src/ai-retrieval.ts';
import { CalendarStore } from '../src/calendar-store.ts';
import { CALENDAR_SCOPES } from '../src/google-scopes.ts';
import type { Thread } from '../src/types.ts';

const at = Date.parse('2026-10-28T12:00:00Z');
const person = { name: 'Synthetic Sender', email: 'sender@example.test' };
export function thread(id: string, accountId = 'a', text = 'Cedar has three samples.'): Thread { return { id, accountId, subject: `Synthetic ${id}`, snippet: 'Synthetic preview', sender: person, participants: [person], lastMessageAt: '2026-10-28T10:00:00Z', unread: true, starred: false, important: false, folder: 'inbox', labels: [], messages: [{ id: `m-${id}`, sender: person, to: [], date: '2026-10-28T10:00:00Z', text, attachments: [] }] }; }
function fixture(path = ':memory:') {
  const store = new Store(path, false); for (const id of ['a', 'b']) store.put('account', id, { id, email: `${id}@example.test`, name: id, provider: 'demo', color: '#000000' });
  const repository = new AiChatRepository(store.db, () => at); initializeAiMailIndex(store.db); const session = repository.createSession('a'); const turn = repository.accept(session.id, { accountId: 'a', clientRequestId: 'synthetic-key', expectedRevision: 0, prompt: 'Find Cedar', context: { resources: ['mail', 'calendar'] } }, 'synthetic-model').turn;
  repository.update(turn.id, t => { t.state = 'running'; });
  const retrieval = new AiRetrieval(store, repository, turn.id, () => at); return { store, repository, session, turn, retrieval, close: () => store.close() };
}
test('local FTS search isolates accounts, reads no full bodies after indexing, and exposes bounded projection coverage', () => {
  const f = fixture(); try {
    f.store.put('thread', 'a1', thread('a1', 'a', 'CEDAR FULL_BODY_SENTINEL')); f.store.put('thread', 'b1', thread('b1', 'b', 'CEDAR FOREIGN_BODY_SENTINEL'));
    assert.equal(mailCoverage(f.store, 'a').pendingRecords, 1); refreshAiMailIndex(f.store, 'a', 1); assert.equal(mailCoverage(f.store, 'a').indexedRecords, 1); assert.equal(mailCoverage(f.store, 'b').pendingRecords, 1);
    const parse = JSON.parse; let bodyParses = 0; JSON.parse = ((s: string, ...args: unknown[]) => { if (/FULL_BODY_SENTINEL|FOREIGN_BODY_SENTINEL/.test(s)) bodyParses++; return parse(s, ...(args as [])); }) as typeof JSON.parse;
    try { const result = f.retrieval.search({ query: 'Cedar', limit: 5 }); assert.equal(result.sources.length, 1); assert.equal(result.sources[0].target.kind, 'mail'); assert.equal(result.sources[0].accountId, 'a'); assert.equal(bodyParses, 0); } finally { JSON.parse = parse; }
    assert.throws(() => f.retrieval.search({ query: 'Cedar', accountId: 'b' })); assert.throws(() => f.retrieval.search({ query: 'x'.repeat(513) })); assert.throws(() => f.retrieval.search({ query: 'Cedar', limit: 11 }));
  } finally { f.close(); }
});
test('pure SQL invalidation works from a legacy second connection and old bodies disappear before projection rebuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-index-')); const path = join(dir, 'test.sqlite'); const f = fixture(path); const legacy = new DatabaseSync(path);
  try {
    f.store.put('thread', 'legacy', thread('legacy', 'a', 'Cedar')); refreshAiMailIndex(f.store, 'a'); assert.equal(f.retrieval.search({ query: 'Cedar' }).sources.length, 1);
    legacy.prepare("UPDATE records SET data=? WHERE kind='thread' AND id=?").run(JSON.stringify(thread('legacy', 'a', 'Birch')), 'legacy'); assert.equal(f.retrieval.search({ query: 'Cedar' }).sources.length, 0); assert.equal(mailCoverage(f.store, 'a').pendingRecords, 1);
    refreshAiMailIndex(f.store, 'a'); assert.equal(f.retrieval.search({ query: 'Birch' }).sources.length, 1);
    legacy.prepare("DELETE FROM records WHERE kind='thread' AND id=?").run('legacy'); assert.equal(f.retrieval.search({ query: 'Birch' }).sources.length, 0); assert.equal(mailCoverage(f.store, 'a').indexedRecords, 0);
  } finally { legacy.close(); f.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('mail reads require actually served source IDs, are bounded and sanitize HTML-only text without remote media', () => {
  const f = fixture(); try {
    const t = thread('html'); t.messages = Array.from({ length: 12 }, (_, index) => ({ ...t.messages[0], id: `m${index}`, text: '', html: `<p>Cedar ${'😀'.repeat(2000)}</p><script>BAD_SCRIPT</script><img src="https://remote.example.test/pixel">` })); f.store.put('thread', t.id, t); refreshAiMailIndex(f.store, 'a');
    const hit = f.retrieval.search({ query: 'Cedar' }).sources[0]; assert.throws(() => f.retrieval.read({ sourceIds: [hit.id] }));
    f.repository.dispatch(f.turn.id, [hit.id], { synthetic: true }); const result = f.retrieval.read({ sourceIds: [hit.id] }); const conversation = result.conversations[0];
    assert.equal(conversation.messages.length, 10); assert.equal(conversation.omittedMessageCount, 2); assert.equal(conversation.truncated, true); assert.ok(conversation.messages.every(m => Buffer.byteLength(m.text) <= 4500 && !m.text.endsWith('�'))); assert.doesNotMatch(JSON.stringify(result), /BAD_SCRIPT|remote\.example\.test|<p>/);
    assert.throws(() => f.retrieval.read({ sourceIds: [hit.id, hit.id] })); assert.throws(() => f.retrieval.read({ sourceIds: ['invented'] }));
  } finally { f.close(); }
});
test('all-draft conversations are excluded but a mixed received/draft conversation remains searchable', () => {
  const f = fixture(); try { const draft = thread('draft'); draft.messages[0].providerLabels = ['DRAFT']; draft.providerLabels = ['DRAFT']; const mixed = thread('mixed'); mixed.messages.push({ ...mixed.messages[0], id: 'draft-reply', providerLabels: ['DRAFT'] }); f.store.put('thread', draft.id, draft); f.store.put('thread', mixed.id, mixed); refreshAiMailIndex(f.store, 'a'); assert.deepEqual(f.retrieval.search({ query: 'Cedar' }).sources.map(s => s.target.kind === 'mail' && s.target.threadId), ['mixed']); } finally { f.close(); }
});
test('known user draft text and a draft-derived preview never become implicit indexed or selected context', () => {
  const f = fixture(); try {
    const mixed = thread('mixed-private-draft'); mixed.messages.push({ ...mixed.messages[0], id: 'draft-message', text: 'UNSENT_DRAFT_PRIVATE_MARKER', providerLabels: ['DRAFT'] }); mixed.snippet = 'UNSENT_DRAFT_PRIVATE_MARKER'; f.store.put('thread', mixed.id, mixed); refreshAiMailIndex(f.store, 'a');
    assert.equal(f.retrieval.search({ query: 'UNSENT_DRAFT_PRIVATE_MARKER' }).sources.length, 0); const hit = f.retrieval.search({ query: 'Cedar' }).sources[0]; assert.doesNotMatch(JSON.stringify(hit), /UNSENT_DRAFT_PRIVATE_MARKER/);
    const selected = f.retrieval.readThread(mixed.id, 'selected-thread'); assert.equal(selected.omittedDraftMessageCount, 1); assert.equal(selected.messages.length, 1); assert.equal(selected.truncated, true); assert.doesNotMatch(JSON.stringify(selected), /UNSENT_DRAFT_PRIVATE_MARKER/);
  } finally { f.close(); }
});
test('index migration rolls back malformed legacy records and repeated initialization preserves queued work', () => {
  const db = new DatabaseSync(':memory:'); try { db.exec("CREATE TABLE records(kind TEXT,id TEXT,data TEXT);CREATE TABLE schema_migrations(name TEXT PRIMARY KEY);INSERT INTO records VALUES('thread','bad','not-json');"); assert.throws(() => initializeAiMailIndex(db)); assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ai_mail_fts'").get(), undefined); assert.equal(db.prepare("SELECT 1 FROM schema_migrations WHERE name='ai-mail-index-v1'").get(), undefined); assert.equal(db.prepare('SELECT data FROM records').get()!.data, 'not-json'); } finally { db.close(); }
  const f = fixture(); try { f.store.put('thread', 'queued', thread('queued')); initializeAiMailIndex(f.store.db); initializeAiMailIndex(f.store.db); assert.equal(mailCoverage(f.store, 'a').pendingRecords, 1); } finally { f.close(); }
});
test('one invalid legacy body cannot starve other queued records and repair invalidates its bounded error marker', () => {
  const f = fixture(); try {
    f.store.put('thread', 'a-invalid', { ...thread('a-invalid'), messages: null }); f.store.put('thread', 'b-valid', thread('b-valid'));
    const slice = refreshAiMailIndex(f.store, 'a', 10); assert.equal(slice.indexed, 1); assert.equal(slice.failed, 1); assert.equal(mailCoverage(f.store, 'a').errorRecords, 1); assert.ok(mailCoverage(f.store, 'a').reasons.includes('index_projection_error')); assert.equal(f.retrieval.search({ query: 'Cedar' }).sources.length, 1);
    assert.deepEqual(refreshAiMailIndex(f.store, 'a', 10), { indexed: 0, failed: 0 }); assert.doesNotMatch(JSON.stringify(f.store.db.prepare('SELECT * FROM ai_mail_errors').all()), /Cedar|Synthetic Sender/);
    f.store.put('thread', 'a-invalid', thread('a-invalid')); assert.equal(mailCoverage(f.store, 'a').errorRecords, 0); assert.equal(refreshAiMailIndex(f.store, 'a').indexed, 1); assert.equal(f.retrieval.search({ query: 'Cedar' }).sources.length, 2);
  } finally { f.close(); }
});
test('a derived-index version rebuild clears obsolete errors/orphans without rewriting any original mail', () => {
  const f = fixture(); try {
    f.store.put('thread', 'versioned', thread('versioned')); refreshAiMailIndex(f.store, 'a'); const before = f.store.db.prepare("SELECT data FROM records WHERE kind='thread' AND id='versioned'").get()!.data;
    f.store.db.exec("DELETE FROM schema_migrations WHERE name='ai-mail-index-v4'; INSERT INTO schema_migrations VALUES('ai-mail-index-v3'); INSERT INTO ai_mail_pending VALUES('orphan','a'); INSERT INTO ai_mail_errors VALUES('orphan','a','invalid_local_record','2026-10-28T00:00:00Z')");
    initializeAiMailIndex(f.store.db); assert.equal(mailCoverage(f.store, 'a').pendingRecords, 1); assert.equal(mailCoverage(f.store, 'a').errorRecords, 0); assert.equal(mailCoverage(f.store, 'a').indexedRecords, 0); assert.equal(f.store.db.prepare("SELECT data FROM records WHERE kind='thread' AND id='versioned'").get()!.data, before); assert.equal(refreshAiMailIndex(f.store, 'a').indexed, 1); assert.equal(f.retrieval.search({ query: 'Cedar' }).sources.length, 1);
  } finally { f.close(); }
});
test('Calendar local range coverage is honest, role/grant scoped and all-day comparisons use Calendar IANA midnight', () => {
  const f = fixture(); try {
    const c = new CalendarStore(f.store.db); f.store.put('googleGrant', 'calendar:a', { grantedScopes: [CALENDAR_SCOPES.read] });
    c.saveCalendar({ accountId: 'a', id: 'owned', summary: 'Synthetic', accessRole: 'owner', timeZone: 'America/Los_Angeles', updatedAt: new Date(at).toISOString() });
    const event = { accountId: 'a', calendarId: 'owned', id: 'day', status: 'confirmed' as const, summary: 'Cedar day', start: { date: '2026-10-28' }, end: { date: '2026-10-29' }, updated: '2026-10-28T00:00:00Z' };
    c.saveEvent(event);
    const raw = { query: 'Cedar', timeMin: '2026-10-29T05:00:00Z', timeMax: '2026-10-29T06:00:00Z', timeZone: 'UTC', calendarIds: ['owned'] };
    const partial = f.retrieval.calendar(raw); assert.equal(partial.sources.length, 1); assert.equal(partial.coverage.status, 'partial'); assert.equal(partial.availabilityChecked, false);
    c.saveRange('a', 'owned', { calendarId: 'owned', range: { timeMin: '2026-10-28T00:00:00Z', timeMax: '2026-10-30T00:00:00Z', timeZone: 'UTC' }, events: [event], cache: { key: 'synthetic', partial: false, updatedAt: new Date(at).toISOString(), expiresAt: new Date(at + 60000).toISOString() } }, at);
    const full = f.retrieval.calendar(raw); assert.equal(full.coverage.status, 'complete-local-snapshot'); assert.equal(full.sources.length, 1);
    f.store.put('googleGrant', 'calendar:a', { grantedScopes: [] }); const missing = f.retrieval.calendar({ ...raw, calendarIds: undefined }); assert.equal(missing.coverage.status, 'unavailable'); assert.equal(missing.sources.length, 0);
    assert.equal(f.retrieval.resolve('a', f.session.id, f.turn.id, full.sources[0].id).resolution.availability, 'unavailable');
  } finally { f.close(); }
});
