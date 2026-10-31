import './archive-network-deny.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { createApp } from '../src/server.ts';
import { CALENDAR_REQUEST_SCOPES } from '../src/google-scopes.ts';
import { googleOAuthCallbackDiagnostic, reportGoogleOAuthCallbackFailure, writeGoogleOAuthCallbackDiagnostic } from '../src/google-oauth-diagnostic.ts';

const accountId = 'google:owner@example.test';
const env = { DATABASE_PATH: ':memory:', GOOGLE_CLIENT_ID: 'fictional-client', GOOGLE_CLIENT_SECRET: 'fictional-secret', TOKEN_ENCRYPTION_KEY: 'e'.repeat(64), GOOGLE_CALENDAR_ENABLED: 'true' };
const identity = () => Response.json({ email: 'owner@example.test', email_verified: true, sub: 'fictional-subject' });

test('an invalid trusted observer is rejected before any database is constructed', () => {
  let opened = 0;
  assert.throws(() => createApp({ databasePath: ':memory:', env, googleOAuthDiagnostic: 7 as unknown as () => void,
    databaseFactory() { opened++; throw Error('No database construction expected'); }, runJobs: false }), /Invalid OAuth diagnostic observer/);
  assert.equal(opened, 0);
});

test('diagnostics project only fixed fields, do not invoke exception getters, and contain sink failures', () => {
  let touched = 0; const entries: unknown[] = []; const observe = (entry: unknown) => { entries.push(entry); };
  {
    const hostile = Object.create(Error.prototype);
    for (const key of ['message', 'stack', 'cause', 'name', 'code']) Object.defineProperty(hostile, key, { get() { touched++; throw Error('private'); } });
    reportGoogleOAuthCallbackFailure('calendar-userinfo-fetch', hostile, observe);
    reportGoogleOAuthCallbackFailure('calendar-commit', Object.assign(new Error('PRIVATE_TOKEN_BODY'), { code: 'SQLITE_BUSY', private: 'PRIVATE_ACCOUNT' }), observe);
    reportGoogleOAuthCallbackFailure('calendar-token-save', Object.assign(new Error('PRIVATE_CODE'), { code: 'PRIVATE_CODE' }), observe);
    assert.equal(touched, 0); assert(entries.every(entry => Object.isFrozen(entry)));
    assert.deepEqual(entries, [
      { event: 'google_oauth_callback_failed', phase: 'calendar-userinfo-fetch', errorClass: 'Error' },
      { event: 'google_oauth_callback_failed', phase: 'calendar-commit', errorClass: 'Error', code: 'SQLITE_BUSY' },
      { event: 'google_oauth_callback_failed', phase: 'calendar-token-save', errorClass: 'Error' },
    ]);
    assert(!JSON.stringify(entries).includes('PRIVATE_'));
    assert.doesNotThrow(() => reportGoogleOAuthCallbackFailure('calendar-commit', new Error('original'), () => { throw Error('observer failure'); }));
  }
});

test('parent log validation refuses extra keys and arbitrary phases/codes, and contains logger failures', () => {
  const valid = { event: 'google_oauth_callback_failed', phase: 'calendar-userinfo-json', errorClass: 'SyntaxError' } as const;
  assert.equal(googleOAuthCallbackDiagnostic(valid), true);
  for (const value of [{ ...valid, accountId }, { ...valid, phase: 'PRIVATE' }, { ...valid, code: 'PRIVATE' }, { ...valid, errorClass: 'PRIVATE' }, { ...valid, code: undefined }]) assert.equal(googleOAuthCallbackDiagnostic(value), false);
  const original = console.error; let calls = 0;
  try { console.error = () => { calls++; throw Error('logger failed'); }; assert.doesNotThrow(() => writeGoogleOAuthCallbackDiagnostic(valid)); assert.equal(calls, 1); }
  finally { console.error = original; }
});

test('no observer leaves console unchanged for both direct reporting and a real failed Calendar callback', async () => {
  let logs = 0, inspected = 0, calls = 0; const original = console.error;
  const store = new Store(':memory:', false);
  const google = new GoogleProvider(store, env, (async input => {
    calls++;
    if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fictional', refresh_token: 'fictional-refresh', expires_in: 3600, scope: CALENDAR_REQUEST_SCOPES.join(' ') });
    assert.equal(String(input), 'https://openidconnect.googleapis.com/v1/userinfo'); return new Response('PRIVATE_NOT_JSON');
  }) as typeof fetch);
  try {
    console.error = () => { logs++; };
    const hostile = new Proxy({}, { getPrototypeOf() { inspected++; throw Error('Must remain uninspected'); }, getOwnPropertyDescriptor() { inspected++; throw Error('Must remain uninspected'); } });
    reportGoogleOAuthCallbackFailure('calendar-userinfo-json', hostile);
    assert.equal(inspected, 0);
    store.put('account', accountId, { id: accountId, name: 'Owner', email: 'owner@example.test', provider: 'google', color: '#888' });
    google.saveTokens(accountId, { access_token: 'fictional-mail', refresh_token: 'fictional-mail-refresh', expires_at: Date.now() + 3600_000 });
    const mail = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value;
    const auth = google.startAuth({ service: 'calendar', accountId });
    await assert.rejects(google.finishAuth(auth.state, auth.state, 'fictional-code'), SyntaxError);
    assert.equal(calls, 2); assert.equal(logs, 0); assert.equal(google.oauthDiagnostic, undefined);
    assert.equal(store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value, mail);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM oauth_states').get()!.n, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='googleGrant'").get()!.n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM secrets WHERE account_id=?').get(`calendar:${accountId}`)!.n, 0);
  } finally { console.error = original; store.close(); }
});

test('failed Calendar callback stages preserve original exceptions, consumed state, rollback and Gmail ciphertext', async () => {
  for (const mode of ['token-exchange', 'calendar-userinfo-fetch', 'calendar-userinfo-json', 'calendar-begin', 'calendar-grant-write', 'calendar-token-save', 'calendar-commit', 'calendar-rollback'] as const) {
    const store = new Store(':memory:', false), entries: unknown[] = [], failure = Object.assign(new Error('PRIVATE_CALLBACK_DETAIL'), { code: 'SQLITE_BUSY' });
    let calls = 0; const google = new GoogleProvider(store, env, (async input => {
      calls++;
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        if (mode === 'token-exchange') throw failure;
        return Response.json({ access_token: 'fictional', refresh_token: 'fictional-refresh', expires_in: 3600, scope: CALENDAR_REQUEST_SCOPES.join(' ') });
      }
      assert.equal(String(input), 'https://openidconnect.googleapis.com/v1/userinfo');
      if (mode === 'calendar-userinfo-fetch') throw failure;
      if (mode === 'calendar-userinfo-json') return new Response('PRIVATE_NOT_JSON');
      return identity();
    }) as typeof fetch);
    google.oauthDiagnostic = entry => { entries.push(entry); };
    try {
      store.put('account', accountId, { id: accountId, name: 'Owner', email: 'owner@example.test', provider: 'google', color: '#888' });
      google.saveTokens(accountId, { access_token: 'fictional-mail', refresh_token: 'fictional-mail-refresh', expires_at: Date.now() + 3600_000 });
      const mail = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value;
      const auth = google.startAuth({ service: 'calendar', accountId });
      const exec = store.db.exec.bind(store.db), put = store.put.bind(store), save = google.saveTokens.bind(google);
      store.db.exec = sql => {
        if (mode === 'calendar-begin' && sql === 'BEGIN IMMEDIATE' || mode === 'calendar-commit' && sql === 'COMMIT' || mode === 'calendar-rollback' && sql === 'ROLLBACK') throw failure;
        return exec(sql);
      };
      store.put = ((kind: string, id: string, value: unknown) => { if (kind === 'googleGrant' && (mode === 'calendar-grant-write' || mode === 'calendar-rollback')) throw failure; return put(kind, id, value); }) as typeof store.put;
      google.saveTokens = (id, tokens, service) => { if (service === 'calendar' && mode === 'calendar-token-save') throw failure; return save(id, tokens, service); };
      await assert.rejects(google.finishAuth(auth.state, auth.state, 'fictional-code'), error => mode === 'calendar-userinfo-json' ? error instanceof SyntaxError : error === failure);
      assert.equal(calls, mode === 'token-exchange' ? 1 : 2); assert.equal(entries.length, 1);
      assert.equal((entries[0] as { phase: string }).phase, mode);
      assert(!JSON.stringify(entries).includes('PRIVATE_'));
      // A failed ROLLBACK leaves the original transaction pending, exactly as before.
      if (mode === 'calendar-rollback') exec('ROLLBACK');
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM oauth_states').get()!.n, 0);
      assert.equal(store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='googleGrant'").get()!.n, 0);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM secrets WHERE account_id=?').get(`calendar:${accountId}`)!.n, 0);
      assert.equal(store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value, mail);
    } finally { store.close(); }
  }
});
