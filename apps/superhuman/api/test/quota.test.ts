import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { GoogleProvider, GoogleRequestError } from '../src/google.ts';
import type { Account, Thread } from '../src/types.ts';

function testProvider(fetcher: typeof fetch) {
  const store = new Store(':memory:'); let now = 0; const waits: number[] = [];
  const provider = new GoogleProvider(store, { GOOGLE_CLIENT_ID: 'fake', GOOGLE_CLIENT_SECRET: 'fake', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) }, fetcher, { now: () => now, sleep: async delay => { waits.push(delay); now += delay; }, random: () => 0 });
  provider.saveTokens('google:test', { access_token: 'fake-token', refresh_token: 'fake-refresh', expires_at: Date.now() + 3600_000 });
  return { store, provider, waits, now: () => now };
}
const rateError = (headers = {}) => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', errors: [{ reason: 'rateLimitExceeded' }], message: 'Untrusted provider message' } }), { status: 403, headers: { 'content-type': 'application/json', ...headers } });
const ok = () => new Response('{}', { status: 200 });

test('parallel full-thread reads share account pacing at4800quotaunits/minute with an explicit fakeclock', async () => {
  const starts: number[] = []; const fixture = testProvider((async () => { starts.push(fixture.now()); return ok(); }) as typeof fetch);
  await Promise.all(['one', 'two', 'three'].map(id => fixture.provider.request('google:test', `threads/${id}?format=full`)));
  assert.deepEqual(starts, [0, 1500, 3000]); assert.deepEqual(fixture.waits, [1500, 1500]); fixture.store.close();
});

test('Google403 rateLimitExceeded gets bounded GET-only exponential backoff and safe diagnostics', async () => {
  let attempts = 0; const fixture = testProvider((async () => { attempts++; return rateError(); }) as typeof fetch);
  await assert.rejects(() => fixture.provider.request('google:test', 'threads/private-thread-identifier?format=full'), error => {
    assert.ok(error instanceof GoogleRequestError); assert.equal(error.code, 'google_rate_limited'); assert.equal(error.status, 429); assert.deepEqual(error.diagnostic, { pathFamily: 'threads.get.full', httpStatus: 403, status: 'PERMISSION_DENIED', reasons: ['rateLimitExceeded'] }); assert.ok(!JSON.stringify(error).includes('private-thread-identifier')); assert.ok(!JSON.stringify(error).includes('Untrusted provider message')); return true;
  });
  assert.equal(attempts, 4); assert.ok(fixture.waits.includes(1000)); assert.ok(fixture.waits.includes(2000)); assert.ok(fixture.waits.includes(4000)); fixture.store.close();
});

test('read recovery succeeds after quota backoff while POST sends never retry', async () => {
  let calls = 0; const fixture = testProvider((async () => ++calls < 3 ? rateError() : ok()) as typeof fetch);
  await fixture.provider.request('google:test', 'profile'); assert.equal(calls, 3); assert.deepEqual(fixture.waits, [1000, 2000]);
  calls = 0; fixture.provider.fetcher = (async () => { calls++; return rateError(); }) as typeof fetch;
  await assert.rejects(() => fixture.provider.request('google:test', 'messages/send', { method: 'POST', body: '{}' }), error => error instanceof GoogleRequestError && error.diagnostic.pathFamily === 'messages.send'); assert.equal(calls, 1); fixture.store.close();
});

test('long Retry-After is surfaced without blocking retry and unknown error details are discarded', async () => {
  let calls = 0; const fixture = testProvider((async () => { calls++; return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded' }, { reason: 'private_identity_or_token' }], message: 'secret-token-value' } }), { status: 429, headers: { 'retry-after': '120' } }); }) as typeof fetch);
  await assert.rejects(() => fixture.provider.request('google:test', 'profile'), error => { assert.ok(error instanceof GoogleRequestError); assert.equal(error.diagnostic.retryAfterSeconds, 120); assert.deepEqual(error.diagnostic.reasons, ['rateLimitExceeded']); assert.ok(!JSON.stringify(error).includes('private_identity')); assert.ok(!JSON.stringify(error).includes('secret-token')); return true; }); assert.equal(calls, 1); assert.deepEqual(fixture.waits, []); fixture.store.close();
});

test('initial resume skips samegeneration threads and pending history checkpoint bounds each slice', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account);
  const provider = new GoogleProvider(store, {}); const original = store.required<Thread>('thread', 'demo-thread-1');
  store.put('thread', `${account.id}:cached`, { ...original, id: `${account.id}:cached`, accountId: account.id, providerId: 'cached', syncGeneration: 'generation' });
  store.put('sync', account.id, { phase: 'initial', historyId: '10', generation: 'generation', partial: true });
  const reads: string[] = []; let historyPages = 0;
  provider.request = async (_id, path) => {
    if (path === 'labels') return { labels: [] };
    if (path.startsWith('threads?')) return { threads: [{ id: 'cached' }, { id: 'new' }] };
    if (path.startsWith('history?')) { historyPages++; return { historyId: '20', history: [{ messages: Array.from({ length: 8 }, (_, index) => ({ id: `message-${index}`, threadId: `changed-${index}` })) }] }; }
    const id = path.split('/')[1].split('?')[0]; reads.push(id); return { id, messages: [{ id: `m-${id}`, threadId: id, snippet: 'Text', internalDate: '1000000', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [], body: { data: 'VGV4dA' } } }] };
  };
  await provider.sync(account.id, { maxPages: 1, pageSize: 5 }); assert.deepEqual(reads, ['new']); assert.equal(store.get<{ phase: string }>('sync', account.id)?.phase, 'history');
  reads.length = 0; const first = await provider.sync(account.id, { maxPages: 1, pageSize: 5 }); assert.equal(first.partial, true); assert.equal(reads.length, 5); assert.equal(store.get<{ historyId: string }>('sync', account.id)?.historyId, '10');
  reads.length = 0; const second = await provider.sync(account.id, { maxPages: 1, pageSize: 5 }); assert.equal(second.partial, false); assert.equal(reads.length, 3); assert.equal(historyPages, 1); assert.equal(store.get<{ historyId: string }>('sync', account.id)?.historyId, '20'); store.close();
});

test('initial backfill prioritizes new history mail and deletions without waiting for the full scan', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account); const template = store.required<Thread>('thread', 'demo-thread-1');
  store.put('thread', `${account.id}:deleted`, { ...template, id: `${account.id}:deleted`, accountId: account.id, providerId: 'deleted', syncGeneration: 'g' });
  store.put('sync', account.id, { phase: 'initial', historyId: '10', generation: 'g', partial: true, pending: { ids: Array.from({ length: 10 }, (_, index) => `old-${index}`), nextPageToken: 'next-scan-page' } });
  const provider = new GoogleProvider(store, {}); const reads: string[] = []; let historyCalls = 0;
  provider.request = async (_id, path) => {
    if (path === 'labels') return { labels: [] };
    if (path.startsWith('history?')) { historyCalls++; return historyCalls === 1 ? { historyId: '20', history: [{ messagesAdded: [{ message: { id: 'incoming-message', threadId: 'incoming' } }] }] } : { historyId: '21', history: [{ messagesDeleted: [{ message: { id: 'deleted-message', threadId: 'deleted' } }] }] }; }
    const id = path.split('/')[1].split('?')[0]; reads.push(id); if (id === 'deleted') { const error = new GoogleRequestError(404, 'Not found', 'google_not_found', { pathFamily: 'threads.get.full', httpStatus: 404, reasons: ['notFound'] }); throw error; }
    return { id, messages: [{ id: `m-${id}`, threadId: id, snippet: 'Synthetic content', internalDate: '1000000', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'subject', value: id }], body: { data: 'VGV4dA' } } }] };
  };
  const first = await provider.sync(account.id, { maxPages: 1, pageSize: 5, catchupDuringInitial: true }); assert.equal(first.phase, 'initial'); assert.equal(first.partial, true); assert.equal(reads.length, 5); assert.equal(reads[0], 'incoming'); assert.ok(store.threads(account.id, 'inbox').some(thread => thread.providerId === 'incoming')); assert.ok(provider.syncStatus(account.id).catchupAt);
  reads.length = 0; await provider.sync(account.id, { maxPages: 1, pageSize: 5, catchupDuringInitial: true }); assert.equal(reads.length, 5); assert.equal(reads[0], 'deleted'); assert.equal(store.get('thread', `${account.id}:deleted`), undefined); assert.equal(provider.syncStatus(account.id).phase, 'initial'); store.close();
});

test('large initial catchup pages preserve their cursor until every pending ID completes within shared slice budget', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account);
  store.put('sync', account.id, { phase: 'initial', historyId: '10', generation: 'g', partial: true, pending: { ids: ['backfill-one', 'backfill-two', 'backfill-three'], nextPageToken: 'more-backfill' } });
  const provider = new GoogleProvider(store, {}); let historyCalls = 0; const reads: string[] = [];
  provider.request = async (_id, path) => { if (path === 'labels') return { labels: [] }; if (path.startsWith('history?')) { historyCalls++; return { historyId: '20', history: [{ messages: Array.from({ length: 8 }, (_, index) => ({ id: `message-${index}`, threadId: `new-${index}` })) }] }; } const id = path.split('/')[1].split('?')[0]; reads.push(id); return { id, messages: [{ id: `m-${id}`, threadId: id, snippet: 'Text', internalDate: '1000000', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [], body: { data: 'VGV4dA' } } }] }; };
  await provider.sync(account.id, { maxPages: 1, pageSize: 5, catchupDuringInitial: true }); assert.deepEqual(reads, ['new-0', 'new-1', 'new-2', 'new-3', 'new-4']);
  let saved = store.get<{ catchup: { historyId: string; pending?: { ids: string[] } } }>('sync', account.id)!; assert.equal(saved.catchup.historyId, '10'); assert.equal(saved.catchup.pending?.ids.length, 3);
  reads.length = 0; await provider.sync(account.id, { maxPages: 1, pageSize: 5, catchupDuringInitial: true }); assert.deepEqual(reads, ['new-5', 'new-6', 'new-7', 'backfill-one', 'backfill-two']); assert.equal(historyCalls, 1);
  saved = store.get('sync', account.id)!; assert.equal(saved.catchup.historyId, '20'); assert.equal(saved.catchup.pending, undefined); store.close();
});

test('expired initial catchup restarts the scan generation and defers deletion reconciliation until scan completion', async () => {
  const store = new Store(':memory:'); const account: Account = { id: 'google:test', provider: 'google', name: 'Test', email: 'test@example.test', color: '#888' }; store.put('account', account.id, account); const old = store.required<Thread>('thread', 'demo-thread-1');
  store.put('thread', `${account.id}:old`, { ...old, id: `${account.id}:old`, accountId: account.id, providerId: 'old', syncGeneration: 'expired-generation' }); store.put('sync', account.id, { phase: 'initial', historyId: 'expired', generation: 'expired-generation', partial: true });
  const provider = new GoogleProvider(store, {}); let expired = true;
  provider.request = async (_id, path) => { if (path === 'labels') return { labels: [] }; if (path === 'profile') return { historyId: '50' }; if (path.startsWith('history?')) { if (expired) { expired = false; throw new GoogleRequestError(404, 'Expired', 'google_not_found', { pathFamily: 'history.list', httpStatus: 404, reasons: [] }); } return { historyId: '51', history: [] }; } if (path.includes('pageToken=continue')) return { threads: [] }; return { threads: [], nextPageToken: 'continue' }; };
  await provider.sync(account.id, { maxPages: 1, pageSize: 5, catchupDuringInitial: true }); assert.ok(store.get('thread', `${account.id}:old`)); assert.equal(provider.syncStatus(account.id).lastResetReason, 'history_expired');
  await provider.sync(account.id, { maxPages: 1, pageSize: 5, catchupDuringInitial: true }); assert.equal(store.get('thread', `${account.id}:old`), undefined); assert.equal(provider.syncStatus(account.id).phase, 'history'); store.close();
});
