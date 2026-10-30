import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type AppScheduler } from '../src/server.ts';
import type { Account } from '../src/types.ts';

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('Quiescence tests forbid external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { release, promise }; }

test('graceful handoff stops future timer/delivery admission, drains an owned sync, and leaves Store open until close', async () => {
  const timers: { callback: () => void; cancelled: boolean }[] = [];
  const scheduler: AppScheduler = { now: Date.now, schedule(callback) {
    const timer = { callback, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true; } };
  } };
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, scheduler });
  const account: Account = { id: 'google:quiesce-fictional', provider: 'google', email: 'fictional@example.test', name: 'Cedar', color: '#888' };
  app.store.put('account', account.id, account);
  const entered = gate(), finish = gate(); let completed = false, closed = 0, flushed = 0;
  app.google.sync = async () => { entered.release(); await finish.promise; completed = true;
    return { imported: 0, pages: 1, partial: false, phase: 'history' as const, resultSizeEstimate: undefined, scope: 'fictional quiescence test' };
  };
  const closeStore = app.store.close.bind(app.store); app.store.close = () => { closed++; closeStore(); };
  const flush = app.providerDrafts.quiesce.bind(app.providerDrafts); app.providerDrafts.quiesce = async () => { flushed++; await flush(); };
  const sync = app.requestSync(account.id); await entered.promise;
  try {
    const before = timers.length; assert.ok(before >= 2);
    app.beginQuiesce(); assert.ok(timers.every(timer => timer.cancelled));
    // Even a stale timer callback which was already enqueued cannot re-admit.
    for (const timer of [...timers]) timer.callback(); assert.equal(timers.length, before);
    assert.equal(app.runSyncJobs(), 0); assert.equal(await app.runAutoDraftJobs(), 0); await app.runJobs();
    assert.deepEqual(await app.wakeSnoozes(), { woken: 0, failed: 0 });
    await assert.rejects(app.requestSync('new-unadmitted-account'), { status: 503 });
    await assert.rejects(app.deliver('new-unadmitted-draft'), { status: 503 });
    const first = app.quiesce(), second = app.quiesce(); assert.equal(first, second);
    let drained = false; void first.then(() => { drained = true; });
    for (let index = 0; index < 5; index++) await Promise.resolve();
    assert.equal(drained, false); assert.equal(completed, false); assert.equal(closed, 0); assert.equal(flushed, 0);
    finish.release(); await Promise.all([sync, first]);
    assert.equal(completed, true); assert.equal(drained, true); assert.equal(flushed, 1); assert.equal(closed, 0);
    assert.equal(app.store.required<Account>('account', account.id).email, account.email);
    app.beginQuiesce(); assert.equal(app.quiesce(), first); await app.quiesce(); assert.equal(flushed, 1);
    await app.close(); assert.equal(closed, 1);
  } finally { finish.release(); await Promise.allSettled([sync, app.close()]); }
});

test('a failed hosted flush rejects the shared quiescence promise without prematurely closing the database', async () => {
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, runJobs: false });
  app.providerDrafts.quiesce = async () => { throw new Error('fictional handoff flush failed'); };
  try {
    const first = app.quiesce(); assert.equal(app.quiesce(), first);
    await assert.rejects(first, /fictional handoff flush failed/);
    assert.ok(app.store.list('account').length > 0);
    await assert.rejects(app.quiesce(), /fictional handoff flush failed/);
  } finally { await app.close(); }
});
