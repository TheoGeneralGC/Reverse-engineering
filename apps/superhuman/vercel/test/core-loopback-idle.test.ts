import test from 'node:test';
import assert from 'node:assert/strict';
import http, { type ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate as immediate } from 'node:timers/promises';
import type { SqlDatabase } from '../../api/src/sql-database.ts';
import type { LoopbackCoreAdapter as Core } from '../src/core-adapter.ts';

test('distinct Core reads survive a synchronous burst beyond the default idle socket lifetime without replay', async () => {
  const actualFetch = globalThis.fetch, originalRequest = http.request;
  let escaped = 0, native = 0, core: Core | undefined;
  const clients: { reused?: boolean }[] = [], arrivals: string[] = [], connections = new Set<Socket>();
  globalThis.fetch = async () => { escaped++; throw Error('Idle socket fixture forbids providers, models and Blob'); };
  Reflect.set(http, 'request', (...args: unknown[]) => {
    const request = Reflect.apply(originalRequest, http, args) as ClientRequest, entry: { reused?: boolean } = {};
    clients.push(entry); request.once('socket', () => { entry.reused = request.reusedSocket; }); return request;
  });
  syncBuiltinESMExports();
  try {
    const { LoopbackCoreAdapter } = await import('../src/core-adapter.ts');
    const unused = async (): Promise<never> => { throw Error('No private body operation'); };
    core = await LoopbackCoreAdapter.create({ namespace: 'idle-socket-fixture',
      context: { lease: { namespace: 'idle-socket-fixture', epoch: 1, actorId: 'synthetic-owner' }, assertLocal() {}, async runNative() { native++; throw Error('No native operation'); } },
      env: { DATABASE_PATH: ':memory:', WEB_ORIGIN: 'https://fixture.example.test' }, databasePath: ':memory:',
      databaseFactory(path) { assert.equal(path, ':memory:'); return new DatabaseSync(path) as unknown as SqlDatabase; },
      bodies: { readRequestBody: unused, writeResponseBody: unused }, transport: globalThis.fetch,
      overrides: { seed: true, runJobs: false, providerDraftAutomatic: false },
    });
    assert.equal(Reflect.get(http.globalAgent, 'keepAlive'), true, 'The old default pool must be enabled for this regression to discriminate');
    core.app.server.prependListener('request', request => { arrivals.push(request.url ?? ''); });
    core.app.server.on('connection', socket => { connections.add(socket); });
    const input = { method: 'GET', path: '/api/bootstrap?includeThreads=false', headers: {}, body: { kind: 'inline' as const, base64: '' } };
    assert.equal((await core.dispatch(input, { id: 'first-distinct-read', sequence: 1 })).status, 200);
    await immediate();
    // Reproduces a Core SQL publication that blocks its own event loop past the
    // server's default5s idle timeout plus1s buffer. No request is retried.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6200);
    assert.equal((await core.dispatch(input, { id: 'second-distinct-read', sequence: 2 })).status, 200);
    assert.deepEqual(arrivals, [input.path, input.path]);
    assert.equal(connections.size, 2); assert.equal(clients.length, 2);
    assert(clients.every(client => client.reused === false)); assert.equal(native, 0); assert.equal(escaped, 0);
  } finally {
    try { if (core) { await core.beginQuiesce(); await core.quiesce(); await core.close(); } }
    finally { Reflect.set(http, 'request', originalRequest); syncBuiltinESMExports(); globalThis.fetch = actualFetch; http.globalAgent.destroy(); }
  }
});
