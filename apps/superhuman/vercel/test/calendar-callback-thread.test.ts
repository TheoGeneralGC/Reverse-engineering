import '../../api/test/archive-network-deny.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCoreActor } from '../src/actor.ts';
import { DurableCommandLog, type CommandRequest } from '../src/command-log.ts';
import { ThreadedCoreAdapter } from '../src/core-thread.ts';
import { NativeControl } from './control-sql-fixture.ts';

test('actual child Calendar failure observation reaches parent safely without changing HTTP, native admission, actor health or close', { timeout: 20_000 }, async () => {
  for (const mode of ['malformed', 'flood', 'logger-throws']) {
    const namespace = 'fictional-calendar-thread', databasePath = ':memory:', webOrigin = 'https://calendar.example.test';
    const env = { DATABASE_PATH: databasePath, WEB_ORIGIN: webOrigin, GOOGLE_CLIENT_ID: 'fictional-client', GOOGLE_CLIENT_SECRET: 'fictional-secret',
      TOKEN_ENCRYPTION_KEY: 'f'.repeat(64), GOOGLE_CALENDAR_ENABLED: 'true', AUTO_DRAFTS_PERSISTENCE: 'managed', FIXTURE_MODE: mode };
    const sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath }), authority = new ActorAuthority(sql, { namespace }), log = new DurableCommandLog(sql, { namespace, webOrigin });
    let actor: DurableCoreActor | undefined, native = 0, logs = 0; const entries: unknown[] = [], original = console.error, stages: string[] = [];
    try {
      console.error = (...args: unknown[]) => { logs++; if (mode === 'logger-throws') throw Error('fictional logger failure'); assert.equal(args.length, 1); const line = args[0]; assert.equal(typeof line, 'string'); assert(!String(line).includes('PRIVATE_')); entries.push(JSON.parse(String(line))); };
      actor = await DurableCoreActor.start({ authority, log, actorId: 'fictional-calendar-actor', deploymentId: 'dpl_FictionalCalendar', async createCore(context) {
        return ThreadedCoreAdapter.create({ context: { ...context, runNative(operation) { native++; return context.runNative(operation); } },
          configuration: { namespace, databaseUrl: databasePath, authToken: 'fictional', journalMode: 'verify-managed-wal', env },
          bodies: { async readRequestBody() { assert.fail('No staged request expected'); }, async writeResponseBody() { assert.fail('No staged response expected'); } },
          onStartupStage: stage => { stages.push(stage); }, workerURL: new URL('./calendar-callback-thread-fixture.ts', import.meta.url),
        });
      } });
      const issue = async (id: string, request: CommandRequest) => {
        await log.enqueue({ namespace, id, request }); await actor!.pumpOnce(); await actor!.waitForRequests();
        const result = await log.readResult(namespace, id); assert.equal(result?.state, 'completed'); return result!.response!;
      };
      const start = await issue('fictional-start', { method: 'GET', path: '/api/auth/google/start?service=calendar&accountId=google%3Aowner%40example.test', headers: {}, body: { kind: 'inline', base64: '' } });
      assert.equal(start.status, 302); const state = new URL(String(start.headers.location)).searchParams.get('state'); assert.ok(state);
      const callback = await issue('fictional-callback', { method: 'GET', path: `/api/auth/google/callback?state=${state}&code=fictional-code`, headers: { cookie: `rea_oauth_state=${state}` }, body: { kind: 'inline', base64: '' } });
      assert.equal(callback.status, 500); assert.equal(callback.body.kind, 'inline');
      assert.deepEqual(JSON.parse(Buffer.from((callback.body as { base64: string }).base64, 'base64').toString()), { error: { code: 'internal_error', message: 'Unexpected server error' } });
      assert.equal(native, 2); assert.equal(logs, mode === 'flood' ? 32 : 1);
      if (mode === 'malformed') assert.deepEqual(entries, [{ event: 'google_oauth_callback_failed', phase: 'calendar-userinfo-json', errorClass: 'SyntaxError' }]);
      if (mode === 'flood') assert(entries.every(entry => JSON.stringify(entry) === JSON.stringify({ event: 'google_oauth_callback_failed', phase: 'calendar-begin', errorClass: 'Error' })));
      assert.equal(actor.state, 'active'); assert.equal((await authority.current())?.state, 'active');
      assert.equal((await issue('fictional-later-read', { method: 'GET', path: '/api/bootstrap?includeThreads=false', headers: {}, body: { kind: 'inline', base64: '' } })).status, 200);
      await actor.close(); assert.equal((await authority.current())?.state, 'quiesced');
    } catch (error) { throw new Error(`fictional fixture stages=${stages.join(',')}`, { cause: error }); } finally { console.error = original; try { await actor?.close().catch(() => {}); } finally { await sql.close(); } }
  }
});
