import '../../api/test/archive-network-deny.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCoreActor } from '../src/actor.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import { LoopbackCoreAdapter } from '../src/core-adapter.ts';
import { NativeControl } from './control-sql-fixture.ts';
import { CALENDAR_REQUEST_SCOPES } from '../../api/src/google-scopes.ts';

test('current hosted Actor and full Core finish fictional incremental Calendar consent atomically without changing Gmail', { timeout: 15_000 }, async () => {
  const databasePath = ':memory:', namespace = 'calendar-callback-fictional', webOrigin = 'https://calendar.example.test';
  const env = { DATABASE_PATH: databasePath, WEB_ORIGIN: webOrigin, GOOGLE_CLIENT_ID: 'fictional-client', GOOGLE_CLIENT_SECRET: 'fictional-secret',
    TOKEN_ENCRYPTION_KEY: 'd'.repeat(64), GOOGLE_CALENDAR_ENABLED: 'true', AUTO_DRAFTS_PERSISTENCE: 'managed' };
  const sql = new NativeControl(databasePath, { DATABASE_PATH: databasePath });
  const authority = new ActorAuthority(sql, { namespace });
  const log = new DurableCommandLog(sql, { namespace, webOrigin });
  const accountId = 'google:owner@example.test'; let core: LoopbackCoreAdapter | undefined, actor: DurableCoreActor | undefined;
  const calls: string[] = []; let background = 0;
  try {
    actor = await DurableCoreActor.start({ authority, log, actorId: 'fictional-calendar-owner', deploymentId: 'dpl_FictionalCalendar', async createCore(context) {
      core = await LoopbackCoreAdapter.create({ context, namespace, databasePath, env,
        databaseFactory(path) { assert.equal(path, databasePath); return new DatabaseSync(path); },
        bodies: { async readRequestBody() { throw Error('No staged request expected'); }, async writeResponseBody() { throw Error('No staged response expected'); } },
        transport: (async (input, init) => {
          const url = String(input); calls.push(url);
          if (url === 'https://oauth2.googleapis.com/token') { assert.equal(init?.method, 'POST'); return Response.json({ access_token: 'fictional-calendar-access', refresh_token: 'fictional-calendar-refresh', expires_in: 3600, token_type: 'Bearer', scope: [...CALENDAR_REQUEST_SCOPES, 'https://www.googleapis.com/auth/gmail.modify'].join(' ') }); }
          assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo'); assert.equal(init?.method ?? 'GET', 'GET');
          return Response.json({ email: 'owner@example.test', email_verified: true, sub: 'fictional-subject' });
        }) as typeof fetch,
        overrides: { runJobs: false, providerDraftAutomatic: false },
      }); return core;
    } });
    assert.ok(core!.app.autoDraftGeneration);
    core!.app.store.put('account', accountId, { id: accountId, name: 'Fictional owner', email: 'owner@example.test', provider: 'google', color: '#888' });
    core!.app.google.saveTokens(accountId, { access_token: 'fictional-mail', refresh_token: 'fictional-mail-refresh', expires_at: Date.now() + 3600_000 });
    const before = core!.app.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value;
    const preferences = core!.app.store.preferences();
    core!.app.calendar.syncCalendarList = async () => { background++; return { partial: false, imported: 0, reset: false }; };
    const auth = core!.app.google.startAuth({ service: 'calendar', accountId });
    await log.enqueue({ namespace, id: 'one-fictional-calendar-callback', request: { method: 'GET', path: `/api/auth/google/callback?state=${auth.state}&code=fictional-code`,
      headers: { cookie: `rea_oauth_state=${auth.state}` }, body: { kind: 'inline', base64: '' } } });
    await actor.pumpOnce(); await actor.waitForRequests();
    const result = await log.readResult(namespace, 'one-fictional-calendar-callback');
    assert.equal(result?.state, 'completed'); assert.equal(result?.response?.status, 302); assert.equal(result?.response?.headers.location, webOrigin);
    assert.equal(calls.length, 2); assert.equal(background, 1);
    assert.equal(core!.app.google.grant(accountId, 'calendar')?.outcome, 'granted');
    assert.ok(core!.app.store.db.prepare('SELECT 1 FROM secrets WHERE account_id=?').get(`calendar:${accountId}`));
    assert.equal(core!.app.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value, before);
    assert.deepEqual(core!.app.store.preferences(), preferences); assert.equal(core!.app.store.db.prepare('SELECT count(*) AS n FROM oauth_states').get()!.n, 0);
    assert.equal(actor.state, 'active');
  } finally { try { if (actor) await actor.close(); else await core?.close(); } finally { await sql.close(); } }
});
