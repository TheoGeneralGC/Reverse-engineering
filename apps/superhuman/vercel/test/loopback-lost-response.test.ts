import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCoreActor } from '../src/actor.ts';
import { DurableCommandLog, type CommandRequest } from '../src/command-log.ts';
import { LoopbackCoreAdapter } from '../src/core-adapter.ts';
import { NativeControl } from './control-sql-fixture.ts';

test('a committed Core mutation with a lost loopback response stays uncertain without retry while later reads complete', { timeout: 15_000 }, async () => {
  const databasePath = ':memory:', namespace = 'lost-loopback-response', webOrigin = 'https://loopback.example.test';
  const sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath });
  const authority = new ActorAuthority(sql, { namespace });
  const log = new DurableCommandLog(sql, { namespace, webOrigin });
  const actualFetch = globalThis.fetch; let external = 0, native = 0, bodies = 0, posts = 0, committedAtLoss = false;
  globalThis.fetch = async () => { external++; throw Error('This isolated Core test forbids external traffic'); };
  let core: LoopbackCoreAdapter | undefined, actor: DurableCoreActor | undefined;
  const request = (path: string, method: string, value?: unknown): CommandRequest => ({ method, path,
    headers: { origin: webOrigin, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    body: { kind: 'inline', base64: value === undefined ? '' : Buffer.from(JSON.stringify(value)).toString('base64') } });
  const subject = 'Synthetic committed mutation with lost response';
  try {
    actor = await DurableCoreActor.start({ authority, log, actorId: 'owned-loopback-test', deploymentId: 'dpl_SyntheticLoopback',
      async createCore(context) {
        core = await LoopbackCoreAdapter.create({ context, namespace, databasePath, env: { DATABASE_PATH: databasePath, WEB_ORIGIN: webOrigin },
          databaseFactory(path) { assert.equal(path, databasePath); return new DatabaseSync(path); },
          bodies: { async readRequestBody() { bodies++; throw Error('No staged body is expected'); }, async writeResponseBody() { bodies++; throw Error('No staged response is expected'); } },
          transport: async () => { native++; throw Error('No provider or model call is expected'); },
          overrides: { runJobs: false, providerDraftAutomatic: false },
        });
        // The real handler still parses, validates and commits the POST. Only its
        // owned HTTP response is lost after commit; no second domain invocation is made.
        core.app.server.prependListener('request', (incoming, response) => {
          if (incoming.method !== 'POST' || incoming.url !== '/api/drafts') return;
          posts++;
          Object.defineProperty(response, 'end', { configurable: true, value() {
            committedAtLoss = core!.app.store.list<{ subject?: string }>('draft').filter(draft => draft.subject === subject).length === 1;
            response.destroy(); return response;
          } });
        });
        return core;
      },
    });
    const create = request('/api/drafts', 'POST', { accountId: 'demo', subject, body: 'Fictional test only.' });
    assert.equal((await log.enqueue({ namespace, id: 'one-owned-mutation', request: create })).created, true);
    await actor.pumpOnce(); await actor.waitForRequests();
    const result = await log.readResult(namespace, 'one-owned-mutation'); assert.ok(result);
    assert.equal(result?.state, 'uncertain'); assert.equal(result.response?.status, 503);
    assert.equal(result.response?.body.kind, 'inline');
    assert.equal(JSON.parse(Buffer.from((result.response!.body as { base64: string }).base64, 'base64').toString()).error.code, 'worker_command_uncertain');
    assert.equal(committedAtLoss, true); assert.equal(posts, 1);
    assert.equal(core!.app.store.list<{ subject?: string }>('draft').filter(draft => draft.subject === subject).length, 1);
    assert.equal(actor.state, 'active'); assert.equal((await authority.current())?.state, 'active');

    // Reaccepting the same operation key must retain its receipt, not replay the
    // HTTP mutation or manufacture a new request after the connection reset.
    const existing = await log.enqueue({ namespace, id: 'one-owned-mutation', request: create });
    assert.equal(existing.created, false); assert.equal(existing.command.state, 'uncertain');
    assert.equal(await actor.pumpOnce(), 0); await actor.waitForRequests(); assert.equal(posts, 1);

    await log.enqueue({ namespace, id: 'later-owned-read', request: request('/api/bootstrap?includeThreads=false', 'GET') });
    await actor.pumpOnce(); await actor.waitForRequests();
    const later = await log.readResult(namespace, 'later-owned-read'); assert.ok(later);
    assert.equal(later?.state, 'completed'); assert.equal(later.response?.status, 200);
    assert.equal(later.response?.body.kind, 'inline');
    const payload = JSON.parse(Buffer.from((later.response!.body as { base64: string }).base64, 'base64').toString());
    assert.equal(payload.drafts.filter((draft: { subject?: string }) => draft.subject === subject).length, 1);
    assert.equal((await log.readResult(namespace, 'one-owned-mutation'))?.state, 'uncertain');
    assert.equal(actor.state, 'active'); assert.equal(posts, 1); assert.equal(native, 0); assert.equal(bodies, 0); assert.equal(external, 0);
  } finally {
    try { if (actor) await actor.close(); else await core?.close(); }
    finally { try { await sql.close(); } finally { globalThis.fetch = actualFetch; } }
  }
});
