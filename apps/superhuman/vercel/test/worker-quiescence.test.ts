import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../api/src/store.ts';
import { createApp } from '../../api/src/server.ts';
import { ProviderDraftService } from '../../api/src/provider-drafts.ts';
import { deferred, fakeCloudTransport } from './worker-fixture.ts';

function cloud(options: { queueFailure?: Error; lostAck?: boolean } = {}) {
  const store = new Store(':memory:', false), fake = fakeCloudTransport();
  store.put('account', 'synthetic', { id: 'synthetic', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
  if (options.lostAck) { const create = fake.transport.create; fake.transport.create = async (...args) => { await create(...args); throw Error('Synthetic lost cloud ACK'); }; }
  const service = new ProviderDraftService(store, fake.transport, { automatic: true, resume: false,
    clock: { now: Date.now, schedule() { return { cancel() {} }; } },
    ...(options.queueFailure ? { queue: { run<T>(): Promise<T> { return Promise.reject(options.queueFailure); } } } : {}),
  });
  const draft = store.saveDraft({ accountId: 'synthetic', subject: 'Fictional drain failure', body: 'Cedar sample only.' }, 'composer');
  return { service, draft, fake, close: async () => { await service.close(); store.close(); } };
}

test('unexpected cloud-save queue failure rejects graceful handoff without retry or provider issue', async () => {
  const failure = Error('Synthetic control queue is unavailable'), f = cloud({ queueFailure: failure });
  try { await assert.rejects(f.service.quiesce(), error => error === failure); assert.equal(f.fake.creates(), 0); assert.equal(f.service.status('synthetic', f.draft.id).state, 'queued'); }
  finally { await f.close(); }
});

test('known lost cloud-save ACK persists unknown once and permits safe drain without redispatch', async () => {
  const f = cloud({ lostAck: true });
  try { await f.service.quiesce(); assert.equal(f.fake.creates(), 1); assert.equal(f.service.status('synthetic', f.draft.id).state, 'outcome_unknown');
    await f.service.quiesce(); assert.equal(f.fake.creates(), 1); assert.equal(f.fake.resources.size, 1); }
  finally { await f.close(); }
});

test('cancelled reminder timer cannot admit a stale tick while already accepted work drains', async () => {
  const timers: { callback: () => void; cancelled: boolean }[] = [];
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, providerDraftAutomatic: false,
    scheduler: { now: Date.now, schedule(callback) { const timer = { callback, cancelled: false }; timers.push(timer); return { cancel() { timer.cancelled = true; } }; } },
    reminderNative: { key: new Uint8Array(32).fill(7), keyId: 'synthetic-reminder', automatic: true, googleFetch: async () => { throw Error('No external reminder traffic'); } },
  });
  const gate = deferred(); let finished = false, ticks = 0;
  try {
    const owner = app.reminderNative!; const running = owner.work(async () => { await gate.promise; finished = true; });
    await Promise.resolve(); owner.start(); const timer = timers.at(-1)!; assert.ok(timer);
    owner.tick = async () => { ticks++; }; owner.stopScheduling(); assert.equal(timer.cancelled, true);
    timer.callback(); await Promise.resolve(); assert.equal(ticks, 0); assert.equal(finished, false);
    gate.resolve(); await running; await owner.waitForIdle(); assert.equal(finished, true);
  } finally { gate.resolve(); await app.close(); }
});
