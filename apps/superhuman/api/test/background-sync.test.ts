import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppScheduler } from '../src/server.ts';
import { HttpError } from '../src/types.ts';
import type { Account, Draft, Thread } from '../src/types.ts';

const environment = { GOOGLE_CLIENT_ID: 'offline-client', GOOGLE_CLIENT_SECRET: 'offline-secret', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64), APPROVED_TEST_RECIPIENTS: 'approved@example.test', APPROVED_TEST_SENDERS: 'a@example.test,b@example.test' };
const result = (partial = false) => ({ imported: 1, pages: 1, partial, phase: partial ? 'initial' as const : 'history' as const, resultSizeEstimate: undefined, scope: 'offline mock' });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class Clock implements AppScheduler {
  time = Date.parse('2026-10-27T12:00:00Z');
  tasks = new Set<{ at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => { const task = { at: this.time + delay, callback }; this.tasks.add(task); return { cancel: () => { this.tasks.delete(task); } }; };
  async advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const task = [...this.tasks].filter(task => task.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!task) break;
      this.time = task.at; this.tasks.delete(task); task.callback(); await settle();
    }
    this.time = end; await settle();
  }
}
function account(app: ReturnType<typeof createApp>, suffix = 'a') {
  const value: Account = { id: `google:${suffix}`, provider: 'google', email: `${suffix}@example.test`, name: suffix, color: '#888' };
  app.store.put('account', value.id, value); return value;
}

test('automatic import continues bounded slices then polls history without any UI requests', async () => {
  const clock = new Clock(); const app = createApp({ databasePath: ':memory:', env: { ...environment, DATABASE_PATH: ':memory:' }, scheduler: clock }); const owner = account(app);
  const requests: unknown[] = [];
  app.google.sync = async (id, limits) => { assert.equal(id, owner.id); requests.push(limits); return result(requests.length === 1); };
  try {
    await clock.advance(0); assert.equal(requests.length, 1); assert.deepEqual(requests[0], { maxPages: 1, pageSize: 5, catchupDuringInitial: true });
    assert.equal(app.syncStatus(owner.id).nextSyncAt, new Date(clock.now() + 1500).toISOString());
    await clock.advance(1499); assert.equal(requests.length, 1);
    await clock.advance(501); assert.equal(requests.length, 2);
    assert.equal(app.syncStatus(owner.id).nextSyncAt, new Date(clock.now() + 30_000).toISOString());
    await clock.advance(29_999); assert.equal(requests.length, 2);
    await clock.advance(1); assert.equal(requests.length, 3);
    assert.equal(app.syncStatus(owner.id).failureCount, 0);
  } finally { await app.close(); }
  assert.equal(clock.tasks.size, 0); await clock.advance(60_000); assert.equal(requests.length, 3);
});

test('runJobs false disables all automatic timers while explicit mocked sync remains usable', async () => {
  const clock = new Clock(); const app = createApp({ databasePath: ':memory:', env: { ...environment, DATABASE_PATH: ':memory:' }, scheduler: clock, runJobs: false }); const owner = account(app); let calls = 0;
  app.google.sync = async () => { calls++; return result(); };
  try { assert.equal(clock.tasks.size, 0); await clock.advance(86_400_000); assert.equal(calls, 0); await app.requestSync(owner.id); assert.equal(calls, 1); }
  finally { await app.close(); }
});

test('provider retry delay is persisted, survives restart and cannot be bypassed by manual quota retries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-auto-sync-')); const path = join(dir, 'mail.sqlite'); const clock = new Clock();
  let app = createApp({ databasePath: path, env: { ...environment, DATABASE_PATH: path }, scheduler: clock, runJobs: false }); const owner = account(app);
  app.google.sync = async () => { throw Object.assign(new HttpError(429, 'Google rate limit reached', 'google_rate_limited'), { diagnostic: { pathFamily: 'threads', httpStatus: 429, reasons: ['rateLimitExceeded'], retryAfterSeconds: 120 } }); };
  try {
    await assert.rejects(() => app.requestSync(owner.id), /rate limit/);
    const health = app.syncStatus(owner.id); assert.equal(health.failureCount, 1); assert.equal(health.nextSyncAt, new Date(clock.now() + 120_000).toISOString()); assert.equal(health.diagnostic?.retryAfterSeconds, 120);
    await app.close(); app = createApp({ databasePath: path, env: { ...environment, DATABASE_PATH: path }, scheduler: clock, runJobs: false }); let calls = 0;
    app.google.sync = async () => { calls++; return result(); };
    await assert.rejects(() => app.requestSync(owner.id), error => error instanceof HttpError && error.code === 'sync_retry_pending');
    assert.equal(app.runSyncJobs(), 0); await clock.advance(119_999); assert.equal(app.runSyncJobs(), 0); assert.equal(calls, 0);
    await clock.advance(1); assert.equal(app.runSyncJobs(), 1); await settle(); assert.equal(calls, 1); assert.equal(app.syncStatus(owner.id).status, 'ready'); assert.equal(app.syncStatus(owner.id).failureCount, 0); assert.equal(app.syncStatus(owner.id).error, undefined);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('transient failures use exponential durable backoff; successful retry clears the prior error only after completion', async () => {
  const clock = new Clock(); const app = createApp({ databasePath: ':memory:', env: { ...environment, DATABASE_PATH: ':memory:' }, scheduler: clock, runJobs: false }); const owner = account(app); let calls = 0;
  const gate = deferred(); const entered = deferred();
  app.google.sync = async () => { calls++; if (calls < 3) throw new Error('Synthetic temporary failure'); entered.resolve(); await gate.promise; return result(); };
  try {
    await assert.rejects(() => app.requestSync(owner.id)); assert.equal(app.syncStatus(owner.id).nextSyncAt, new Date(clock.now() + 30_000).toISOString());
    await clock.advance(30_000); await assert.rejects(() => app.requestSync(owner.id)); assert.equal(app.syncStatus(owner.id).failureCount, 2); assert.equal(app.syncStatus(owner.id).nextSyncAt, new Date(clock.now() + 60_000).toISOString());
    await clock.advance(59_999); assert.equal(app.runSyncJobs(), 0); await clock.advance(1); assert.equal(app.runSyncJobs(), 1); await entered.promise;
    assert.equal(app.syncStatus(owner.id).status, 'running'); assert.equal(app.syncStatus(owner.id).code, 'sync_failed'); assert.ok(app.syncStatus(owner.id).error);
    gate.resolve(); await settle(); assert.equal(app.syncStatus(owner.id).error, undefined); assert.equal(app.syncStatus(owner.id).failureCount, 0);
  } finally { gate.resolve(); await app.close(); }
});

test('authorization failure requires explicit reconnect/retry and never starts an automatic authentication flow', async () => {
  const clock = new Clock(); const app = createApp({ databasePath: ':memory:', env: { ...environment, DATABASE_PATH: ':memory:' }, scheduler: clock, runJobs: false }); const owner = account(app); let calls = 0;
  app.google.sync = async () => { calls++; if (calls === 1) throw new HttpError(401, 'Reconnect this account', 'reconnect_required'); return result(); };
  app.google.startAuth = () => { throw new Error('Automatic authentication must not occur'); };
  try {
    await assert.rejects(() => app.requestSync(owner.id), /Reconnect/); assert.equal(app.syncStatus(owner.id).requiresReconnect, true); assert.equal(app.syncStatus(owner.id).nextSyncAt, undefined);
    await clock.advance(86_400_000); assert.equal(app.runSyncJobs(), 0); assert.equal(calls, 1);
    await app.requestSync(owner.id); assert.equal(calls, 2); assert.equal(app.syncStatus(owner.id).requiresReconnect, false);
  } finally { await app.close(); }
});

test('an interrupted saved running import resumes automatically after restart without resetting its cursor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superhuman-sync-resume-')); const path = join(dir, 'mail.sqlite'); const clock = new Clock();
  let app = createApp({ databasePath: path, env: { ...environment, DATABASE_PATH: path }, scheduler: clock, runJobs: false }); const owner = account(app);
  app.store.put('sync', owner.id, { phase: 'initial', historyId: '10', generation: 'preserve', pageToken: 'saved-page', partial: true });
  app.store.put('syncHealth', owner.id, { status: 'running', updatedAt: new Date(clock.now()).toISOString() });
  await app.close(); app = createApp({ databasePath: path, env: { ...environment, DATABASE_PATH: path }, scheduler: clock }); let calls = 0;
  app.google.sync = async () => { calls++; assert.equal(app.store.get<{ pageToken: string }>('sync', owner.id)?.pageToken, 'saved-page'); return result(true); };
  try { await clock.advance(0); assert.equal(calls, 1); assert.equal(app.syncStatus(owner.id).status, 'ready'); }
  finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('background sync deduplicates active slices and skips accounts with due authorized deliveries', async () => {
  const clock = new Clock(); const app = createApp({ databasePath: ':memory:', env: { ...environment, DATABASE_PATH: ':memory:' }, scheduler: clock, runJobs: false }); const owner = account(app); let calls = 0; const gate = deferred(); const entered = deferred();
  app.google.sync = async () => { calls++; entered.resolve(); await gate.promise; return result(true); };
  try {
    assert.equal(app.runSyncJobs(), 1); await entered.promise; assert.equal(app.runSyncJobs(), 0); assert.equal(calls, 1);
    const same = app.requestSync(owner.id); assert.equal(calls, 1); gate.resolve(); await same;
    await clock.advance(2000); const draft = app.store.saveDraft({ accountId: owner.id, to: 'approved@example.test', status: 'scheduled', scheduledAt: new Date(clock.now()).toISOString() });
    assert.equal(app.runSyncJobs(), 0); assert.equal(app.store.required<Draft>('draft', draft.id).status, 'scheduled'); assert.equal(calls, 1);
  } finally { gate.resolve(); await app.close(); }
});

test('a slow import and queued snooze wake on account A do not delay scheduled delivery on account B', async () => {
  const clock = new Clock(); const app = createApp({ databasePath: ':memory:', env: { ...environment, DATABASE_PATH: ':memory:' }, scheduler: clock, runJobs: false }); const a = account(app); const b = account(app, 'b');
  const gate = deferred(); const entered = deferred(); const bSent = deferred(); const sent: string[] = [];
  app.google.sync = async id => { if (id === a.id) { entered.resolve(); await gate.promise; } return result(true); };
  app.google.updateThread = async () => {};
  app.google.send = async draft => { sent.push(draft.accountId); if (draft.accountId === b.id) bSent.resolve(); return { id: 'mock-sent' }; };
  try {
    app.runSyncJobs(); await entered.promise; await settle();
    const original = app.store.required<Thread>('thread', 'demo-thread-1');
    app.store.put<Thread>('thread', 'due-snooze', { ...original, id: 'due-snooze', accountId: a.id, folder: 'done', providerId: 'mock-thread', providerLabels: [], snoozedUntil: new Date(clock.now() - 1000).toISOString() });
    for (const owner of [a, b]) app.store.saveDraft({ accountId: owner.id, to: 'approved@example.test', status: 'scheduled', scheduledAt: new Date(clock.now() - 1000).toISOString() });
    const jobs = app.runJobs(); await bSent.promise; assert.deepEqual(sent, [b.id]);
    gate.resolve(); await jobs; assert.deepEqual(sent, [b.id, a.id]);
  } finally { gate.resolve(); await app.close(); }
});
