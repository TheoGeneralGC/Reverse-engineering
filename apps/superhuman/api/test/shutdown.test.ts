import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import type { Account } from '../src/types.ts';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }

test('repeated shutdown shares one promise, waits for owned sync and closes the Store once', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false });
  const owner: Account = { id: 'google:shutdown-fixture', provider: 'google', email: 'offline@example.test', name: 'Offline', color: '#888' }; app.store.put('account', owner.id, owner);
  const entered = deferred(); const release = deferred(); let syncFinished = false;
  app.google.sync = async () => { entered.resolve(); await release.promise; syncFinished = true; return { imported: 0, pages: 1, partial: false, phase: 'history' as const, resultSizeEstimate: undefined, scope: 'offline shutdown fixture' }; };
  const originalClose = app.store.close.bind(app.store); let storeCloses = 0;
  app.store.close = () => { assert.equal(syncFinished, true); storeCloses++; originalClose(); };
  const sync = app.requestSync(owner.id); await entered.promise;
  try {
    const first = app.close(); const second = app.close(); assert.equal(first, second);
    let closed = false; void first.then(() => { closed = true; });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(closed, false); assert.equal(storeCloses, 0); assert.equal(syncFinished, false);
    release.resolve(); await Promise.all([first, second, sync]);
    assert.equal(storeCloses, 1); assert.equal(closed, true); assert.equal(app.close(), first); await app.close(); assert.equal(storeCloses, 1);
    assert.throws(() => app.store.list('account'), /database is not open/);
  } finally { release.resolve(); await Promise.allSettled([sync, app.close()]); }
});
