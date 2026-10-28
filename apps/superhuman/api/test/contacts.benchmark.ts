import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import type { Thread } from '../src/types.ts';

// Synthetic data only. Always creates/removes its own temporary database; it
// never reads configuration, credentials, or the application's live store.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report')) throw new Error('Usage: contacts.benchmark.ts [--report PATH]');
const directory = mkdtempSync(join(tmpdir(), 'superhuman-recipient-benchmark-'));
const store = new Store(join(directory, 'synthetic.sqlite'), false);
const round = (value: number) => Math.round(value * 1000) / 1000;
const measure = (run: () => unknown, count: number) => {
  const durations = [];
  for (let index = 0; index < count; index++) { const start = performance.now(); run(); durations.push(performance.now() - start); }
  durations.sort((a, b) => a - b);
  return { repetitions: count, medianMs: round(durations[Math.floor(count / 2)]), maxMs: round(durations.at(-1)!) };
};
let report;
try {
  const start = performance.now(); store.db.exec('BEGIN IMMEDIATE');
  for (let index = 0; index < 10_000; index++) {
    const accountId = index % 2 ? 'synthetic-a' : 'synthetic-b'; const id = `synthetic-${String(index).padStart(5, '0')}`;
    const sender = { name: `Synthetic Person ${String(index).padStart(5, '0')}`, email: `person${String(index).padStart(5, '0')}@example.test` };
    const recipient = { name: accountId, email: `${accountId}@example.test` };
    const value: Thread = { id, accountId, subject: 'Synthetic benchmark', snippet: 'Synthetic preview', sender, participants: [sender, recipient], lastMessageAt: `2026-10-28T12:${String(index % 60).padStart(2, '0')}:00.000Z`, unread: true, starred: false, important: false, folder: 'inbox', labels: [], messages: [{ id, date: '2026-10-28T12:00:00Z', sender, to: [recipient], text: 'S'.repeat(4096), html: `<p>${'H'.repeat(1024)}</p>`, attachments: [] }] };
    store.put('thread', id, value);
  }
  store.db.exec('COMMIT'); const ingestMs = round(performance.now() - start);
  for (let index = 0; index < 5; index++) store.recipientSuggestions({ accountId: 'synthetic-a', q: 'person0042' });
  const original = JSON.parse; let jsonParses = 0;
  JSON.parse = (...args) => { jsonParses++; return original(...args); };
  let timings;
  try {
    timings = { selectivePrefix: measure(() => store.recipientSuggestions({ accountId: 'synthetic-a', q: 'person0042' }), 30), broadNamePrefix: measure(() => store.recipientSuggestions({ accountId: 'synthetic-a', q: 'synthetic' }), 10), miss: measure(() => store.recipientSuggestions({ accountId: 'synthetic-a', q: 'does-not-exist' }), 30) };
  } finally { JSON.parse = original; }
  let contextMetadataParses = 0; let contextFullMailParses = 0; let contextTimings;
  JSON.parse = (input, reviver) => { contextMetadataParses++; if (input.includes('"messages"')) contextFullMailParses++; return original(input, reviver); };
  try {
    contextTimings = { rareContact: measure(() => store.contactContext({ accountId: 'synthetic-a', email: 'person00421@example.test' }), 30), frequentContact: measure(() => store.contactContext({ accountId: 'synthetic-a', email: 'synthetic-a@example.test', excludeThreadId: 'synthetic-00001' }), 10), incompleteAddress: measure(() => store.contactContext({ accountId: 'synthetic-a', email: 'incomplete@' }), 30) };
  } finally { JSON.parse = original; }
  const context = store.contactContext({ accountId: 'synthetic-a', email: 'synthetic-a@example.test', excludeThreadId: 'synthetic-00001' });
  assert.equal(context.threads.length, 4); assert.ok(context.threads.every(thread => thread.accountId === 'synthetic-a' && !('messages' in thread))); assert.equal(contextFullMailParses, 0);
  const summary = store.threadSummaries({ accountId: 'synthetic-a', limit: 50 });
  report = { recordedAt: new Date().toISOString(), syntheticOnly: true, database: 'fresh temporary database; removed after run', threadCount: 10_000, threadsPerAccount: 5000, bodyBytesPerThread: 5127, contacts: Number(store.db.prepare('SELECT COUNT(*) AS total FROM recipient_contacts').get()!.total), ingestMs, indexedLookupTimings: timings, indexedLookupJsonParses: jsonParses, suggestionPayloadBytes: Buffer.byteLength(JSON.stringify(store.recipientSuggestions({ accountId: 'synthetic-a', q: 'person0042' }))), contextTimings, contextMetadataParses, contextFullMailParses, contextPayloadBytes: Buffer.byteLength(JSON.stringify(context)), summaryPageTimings: measure(() => store.threadSummaries({ accountId: 'synthetic-a', limit: 50 }), 10), summaryPagePayloadBytes: Buffer.byteLength(JSON.stringify(summary)), legacyFullMailReadTimings: measure(() => store.threads('synthetic-a', 'all'), 3) };
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
if (args.length) { const path = resolve(args[1]); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); }
console.log(JSON.stringify(report, null, 2));
