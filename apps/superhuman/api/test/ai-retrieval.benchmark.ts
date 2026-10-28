// Explicitly invoked synthetic-only benchmark. Never opens the live Store.
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../src/store.ts';
import { AiChatRepository } from '../src/ai-chat-store.ts';
import { AiRetrieval, initializeAiMailIndex, refreshAiMailIndex } from '../src/ai-retrieval.ts';
import type { Thread } from '../src/types.ts';

const store = new Store(':memory:', false); const accountId = 'synthetic-a'; const other = 'synthetic-b';
for (const id of [accountId, other]) store.put('account', id, { id, email: `${id}@example.test`, name: id, provider: 'demo', color: '#000000' });
const repository = new AiChatRepository(store.db); initializeAiMailIndex(store.db); const person = { name: 'Synthetic Sender', email: 'sender@example.test' };
const insert = store.db.prepare('INSERT INTO records VALUES(?,?,?)'); const setup = performance.now(); store.db.exec('BEGIN');
for (let i = 0; i < 10000; i++) {
  const id = `synthetic-${i}`; const text = `Synthetic body ${i}. ${i % 997 === 0 ? 'CEDARNEEDLE ' : ''}${'Moderate synthetic fixture text. '.repeat(40)}`;
  const thread: Thread = { id, accountId: i < 9000 ? accountId : other, subject: `Synthetic subject ${i}`, snippet: 'Synthetic preview', sender: person, participants: [person], lastMessageAt: new Date(1793188800000 + i * 1000).toISOString(), unread: false, starred: false, important: false, folder: 'inbox', labels: [], messages: [{ id: `message-${i}`, sender: person, to: [], date: '2026-10-28T00:00:00Z', text, attachments: [] }] }; insert.run('thread', id, JSON.stringify(thread));
}
store.db.exec('COMMIT'); const seededMs = performance.now() - setup; const indexStart = performance.now(); while (refreshAiMailIndex(store, undefined, 100).indexed) { /* bounded projection slices */ } const indexMs = performance.now() - indexStart;
const session = repository.createSession(accountId); const turn = repository.accept(session.id, { accountId, clientRequestId: 'benchmark', expectedRevision: 0, prompt: 'Synthetic query', context: { resources: ['mail'] } }, 'synthetic-model').turn; const retrieval = new AiRetrieval(store, repository, turn.id);
const baselineStart = performance.now(); const baseline = store.threads(accountId, 'all', 'CEDARNEEDLE'); const baselineMs = performance.now() - baselineStart; const baselineBytes = Buffer.byteLength(JSON.stringify(baseline));
const times: number[] = []; let last: ReturnType<typeof retrieval.search> | undefined; let fullBodyParses = 0; const parse = JSON.parse;
JSON.parse = ((text: string, ...args: unknown[]) => { if (text.includes('Moderate synthetic fixture text.')) fullBodyParses++; return parse(text, ...(args as [])); }) as typeof JSON.parse;
try { for (let i = 0; i < 5; i++) { const start = performance.now(); last = retrieval.search({ query: 'CEDARNEEDLE', limit: 10 }); times.push(performance.now() - start); } } finally { JSON.parse = parse; }
const report = { at: new Date().toISOString(), fixtures: { totalThreads: 10000, selectedAccountThreads: 9000, otherAccountThreads: 1000, textBytesApproximately: 1320, database: ':memory:' }, seededMs, indexMs, legacySearch: { durationMs: baselineMs, results: baseline.length, payloadBytes: baselineBytes }, indexedSearch: { durationMs: times, meanMs: times.reduce((a, b) => a + b, 0) / times.length, results: last!.sources.length, payloadBytes: Buffer.byteLength(JSON.stringify(last)), fullBodyParses }, plan: store.db.prepare('EXPLAIN QUERY PLAN SELECT d.thread_id FROM ai_mail_fts f JOIN ai_mail_documents d ON d.thread_id=f.thread_id AND d.account_id=f.account_id WHERE ai_mail_fts MATCH ? AND d.account_id=? LIMIT 10').all('CEDARNEEDLE', accountId).map(row => row.detail), limits: 'Warm isolated synthetic benchmark; indexed projection has explicit text truncation and local-only coverage. No provider calls.' };
mkdirSync('.local/benchmarks', { recursive: true, mode: 0o700 }); writeFileSync('.local/benchmarks/ai-retrieval-20261028.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); console.log(JSON.stringify(report)); store.close();
