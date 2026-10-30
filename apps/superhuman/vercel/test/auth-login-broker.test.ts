import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeControl } from './control-sql-fixture.ts';
import type { ControlSql } from '../src/authority.ts';
import type { VerifiedGoogleIdentity } from '../src/auth-identity.ts';
import { PersonalTenantRegistry } from '../src/auth-registry.ts';
import { AppSessionAuthority } from '../src/auth-sessions.ts';
import { OneUseGoogleLoginBroker } from '../src/auth-login-broker.ts';
import { AppAuthError } from '../src/auth-values.ts';
import { origin, callbackUri, clientId, clientSecret, providerFixture, deferred, type Registration } from './auth-oidc-fixture.ts';

const baseSchema = await readFile(new URL('./auth-registry-schema.sql', import.meta.url), 'utf8');
const loginSchema = await readFile(new URL('./auth-login-schema.sql', import.meta.url), 'utf8');
const cookie = (value: { setCookie: string }) => value.setCookie.split(';')[0]!;
const code = (expected: string | RegExp) => (e: unknown) => e instanceof AppAuthError && (typeof expected === 'string' ? e.code === expected : expected.test(e.code));
let opened = 0, closed = 0;
after(() => {
  const networkAttempts = (globalThis as unknown as Record<symbol, { attempts: number }>)[Symbol.for('rea.generated-cloud.network-denied')]!.attempts;
  assert.equal(networkAttempts, 0); assert.equal(opened, closed); console.log('auth_login_metadata', JSON.stringify({ networkAttempts, opened, closed }));
});
async function fixture(purpose: 'login' | 'owner-identity-proof' = 'login') {
  const sql = new NativeControl(':memory:', { DATABASE_PATH: ':memory:' }); opened++;
  for (const statement of [baseSchema, loginSchema].flatMap(s => s.split(';')).filter(s => s.trim())) await sql.execute(statement);
  for (const name of ['A', 'B']) {
    await sql.execute("INSERT INTO app_users VALUES(?,'active',1,?)", [`user-${name}`, Date.now()]);
    await sql.execute('INSERT INTO external_identities VALUES(?,?,?,?,?)', ['https://accounts.google.com', `Subject-${name}`, `user-${name}`, 'synthetic@example.test', Date.now()]);
    await sql.execute("INSERT INTO personal_tenants VALUES(?,?,'active',1)", [`tenant-${name}`, `user-${name}`]);
    await sql.execute("INSERT INTO personal_memberships VALUES(?,?,'active',1)", [`user-${name}`, `tenant-${name}`]);
    await sql.execute("INSERT INTO tenant_storage VALUES(?,?,?,?,?,1,'active')", [`storage-${name}`, `tenant-${name}`, `primary-${name}`, `secret-${name}`, `key-${name}`]);
    await sql.execute('INSERT INTO tenant_runtimes VALUES(?,?,?,1)', [`runtime-${name}`, `tenant-${name}`, `storage-${name}`]);
  }
  let txCount = 0, loseAt = 0, offset = 0;
  const port: ControlSql = { execute: sql.execute.bind(sql), async transaction(work) {
    const ordinal = ++txCount, value = await sql.transaction(work);
    if (ordinal === loseAt) throw Error('synthetic-confirmation-lost'); return value;
  } };
  const registry = new PersonalTenantRegistry(port, ['A', 'B'].map(name => ({ storageRef: `storage-${name}`, tenantId: `tenant-${name}`, primaryRef: `primary-${name}`,
    secretRef: `secret-${name}`, keyRef: `key-${name}`, generation: 1, namespace: `runtime-${name}` })));
  const sessions = { registry, sessionKeys: new Map([[1, Buffer.alloc(32, 19)]]), currentKeyVersion: 1, csrfKey: Buffer.alloc(32, 73), webOrigin: origin };
  const provider = providerFixture(), now = () => Date.now() + offset;
  const makeBroker = (mode: typeof purpose) => new OneUseGoogleLoginBroker({ sql: port, purpose: mode, clientId, clientSecret, callbackUri,
    browserHmacKey: Buffer.alloc(32, 42), preauthCsrfKey: Buffer.alloc(32, 55), attemptSealKey: Buffer.alloc(32, 66), sessions, now, fetcher: provider.fetcher });
  const broker = makeBroker(purpose), auth = new AppSessionAuthority({ sql: port, ...sessions, now });
  const start = async (options: { browser?: ReturnType<typeof broker.bootstrapBrowser>; sessionCookieHeader?: string; registration?: Partial<Registration>; selectedBroker?: typeof broker } = {}) => {
    const selected = options.selectedBroker ?? broker, browser = options.browser ?? selected.bootstrapBrowser();
    const started = await selected.start({ browserCookieHeader: cookie(browser), csrfHeader: browser.csrfToken, host: 'mail.example.test', origin,
      sessionCookieHeader: options.sessionCookieHeader, fetchSite: 'same-origin' });
    const registered = provider.registerAuthorization(started.authorizationUrl, options.registration);
    const input = { browserCookieHeader: cookie(browser), host: 'mail.example.test', sessionCookieHeader: options.sessionCookieHeader, state: registered.state, code: registered.code };
    return { browser, started, registered, input };
  };
  return { sql, port, broker, auth, registry, provider, sessions, start, makeBroker, txCount: () => txCount,
    loseCommit: (ordinal: number) => { loseAt = ordinal; }, advance: (ms: number) => { offset += ms; },
    close: async () => { await sql.close(); closed++; } };
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, options: Parameters<typeof f.start>[0] = {}) {
  const flow = await f.start(options), result = await f.broker.callback(flow.input); assert.equal(result.purpose, 'login');
  if (result.purpose !== 'login') throw Error(); return { flow, session: result.session };
}

test('broker commits one encrypted claim, actual signed exchange and one atomic session+consumed result', async () => {
  const f = await fixture();
  try {
    const flow = await f.start(), before = (await f.sql.execute('SELECT * FROM auth_login_attempts')).rows[0]!;
    assert.equal(before.state, 'pending'); assert.ok(before.sealed instanceof Uint8Array);
    const stored = JSON.stringify(before), url = new URL(flow.started.authorizationUrl);
    for (const secret of [url.searchParams.get('state')!, url.searchParams.get('nonce')!, clientSecret, cookie(flow.browser)]) assert.ok(!stored.includes(secret));
    const result = await f.broker.callback(flow.input); assert.equal(result.purpose, 'login');
    if (result.purpose !== 'login') throw Error();
    assert.equal(result.session.session.tenantId, 'tenant-A');
    const afterRow = (await f.sql.execute('SELECT * FROM auth_login_attempts')).rows[0]!;
    assert.equal(afterRow.state, 'consumed'); assert.equal(afterRow.sealed, null); assert.equal(afterRow.outcome_session_id, result.session.session.sessionRecordId);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 1);
    await f.auth.authenticate(cookie(result.session)); assert.deepEqual(f.provider.calls.map(x => x.kind), ['token', 'jwks']);
    await assert.rejects(f.broker.callback(flow.input), code('auth_login_state_unavailable'));
    assert.equal(f.provider.calls.filter(x => x.kind === 'token').length, 1);
  } finally { await f.close(); }
});

test('simultaneous/replayed callbacks cannot exchange or mint a second time while the first token exchange is held', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); let pending: Promise<unknown> | undefined;
  try {
    const flow = await f.start({ registration: { beforeToken: async () => { entered.resolve(); await release.promise; } } });
    pending = f.broker.callback(flow.input); await entered.promise;
    const row = (await f.sql.execute('SELECT state,sealed FROM auth_login_attempts')).rows[0]!; assert.equal(row.state, 'exchanging'); assert.equal(row.sealed, null);
    await assert.rejects(f.broker.callback(flow.input), code('auth_login_state_unavailable'));
    assert.equal(f.provider.calls.filter(x => x.kind === 'token').length, 1); release.resolve(); await pending;
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 1);
  } finally { release.resolve(); await pending?.catch(() => undefined); await f.close(); }
});

test('preauth CSRF, exact browser/purpose/state and invalid existing cookies refuse without claiming/exchanging', async () => {
  const f = await fixture();
  try {
    const b = f.broker.bootstrapBrowser();
    await assert.rejects(f.broker.start({ browserCookieHeader: cookie(b), csrfHeader: 'forged', host: 'mail.example.test', origin }), code('auth_login_csrf_invalid'));
    await assert.rejects(f.broker.start({ browserCookieHeader: cookie(b), csrfHeader: b.csrfToken, host: 'mail.example.test', origin, sessionCookieHeader: '__Host-rea_session=bad' }), code('auth_login_binding_invalid'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM auth_login_attempts')).rows[0]!.n, 0);
    const flow = await f.start({ browser: b });
    const another = f.broker.bootstrapBrowser();
    for (const input of [{ ...flow.input, state: flow.input.state.slice(0, -1) + (flow.input.state.endsWith('A') ? 'B' : 'A') },
      { ...flow.input, browserCookieHeader: cookie(another) }, { ...flow.input, browserCookieHeader: `${cookie(b)}; ${cookie(b)}` },
      { ...flow.input, state: flow.input.state.replace('rea-login-v1.', 'rea-proof-v1.') }, { ...flow.input, host: 'evil.example.test' }]) await assert.rejects(f.broker.callback(input), code(/^auth_login_/));
    assert.equal(f.provider.calls.length, 0); assert.equal((await f.sql.execute('SELECT state FROM auth_login_attempts')).rows[0]!.state, 'pending');
  } finally { await f.close(); }
});

test('unknown verified subject never provisions a user/tenant or session; fixed proof purpose returns identity only', async () => {
  const f = await fixture();
  try {
    const unknown = await f.start({ registration: { subject: 'Unknown-Subject' } }); await assert.rejects(f.broker.callback(unknown.input), code('auth_login_failed'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_users')).rows[0]!.n, 2);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM personal_tenants')).rows[0]!.n, 2);
    const proof = f.makeBroker('owner-identity-proof'), flow = await f.start({ selectedBroker: proof, registration: { subject: 'Unknown-Subject' } });
    const result = await proof.callback(flow.input); assert.equal(result.purpose, 'owner-identity-proof');
    if (result.purpose !== 'owner-identity-proof') throw Error();
    assert.equal(result.identity.subject, 'Unknown-Subject'); assert.deepEqual(Object.keys(result.identity).sort(), ['issuer', 'subject', 'verifiedAtMs']);
    await assert.rejects(f.auth.createSession(result.identity as unknown as VerifiedGoogleIdentity), code('auth_identity_unverified'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
    await assert.rejects(proof.callback(flow.input), code('auth_login_state_unavailable'));
  } finally { await f.close(); }
});

test('sealed-state tamper and signed-token failure burn the claim with no authority or exchange replay', async () => {
  const f = await fixture();
  try {
    const tampered = await f.start();
    const row = (await f.sql.execute('SELECT state_digest,sealed FROM auth_login_attempts')).rows[0]!, sealed = Buffer.from(row.sealed as Uint8Array); sealed[sealed.length - 1]! ^= 1;
    await f.sql.execute('UPDATE auth_login_attempts SET sealed=? WHERE state_digest=?', [sealed, row.state_digest!]);
    await assert.rejects(f.broker.callback(tampered.input), code('auth_login_failed')); assert.equal(f.provider.calls.length, 0);
    const bad = await f.start({ registration: { badSignature: true } }); await assert.rejects(f.broker.callback(bad.input), code('auth_login_failed'));
    await assert.rejects(f.broker.callback(bad.input), code('auth_login_state_unavailable'));
    assert.equal(f.provider.calls.filter(x => x.kind === 'token').length, 1);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
    assert.deepEqual((await f.sql.execute('SELECT state,sealed FROM auth_login_attempts')).rows.map(r => [r.state, r.sealed]), [['failed', null], ['failed', null]]);
  } finally { await f.close(); }
});

test('ambiguous CLAIM commit acknowledgement performs zero exchange and never terminalizes or resumes by lookup', async () => {
  const f = await fixture();
  try {
    const flow = await f.start(); f.loseCommit(f.txCount() + 1); let authority: unknown;
    await assert.rejects(async () => { authority = await f.broker.callback(flow.input); }, code('auth_storage_outcome_unknown'));
    assert.equal(authority, undefined); assert.equal(f.provider.calls.length, 0);
    assert.equal((await f.sql.execute('SELECT state,sealed FROM auth_login_attempts')).rows[0]!.state, 'exchanging');
    assert.equal((await f.sql.execute('SELECT state,sealed FROM auth_login_attempts')).rows[0]!.sealed, null);
    await assert.rejects(f.broker.callback(flow.input), code('auth_login_state_unavailable')); assert.equal(f.provider.calls.length, 0);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
  } finally { await f.close(); }
});

test('ambiguous FINAL commit returns no cookie/CSRF/proof even when mint+consume committed, and cannot exchange/mint again', async () => {
  for (const purpose of ['login', 'owner-identity-proof'] as const) {
    const f = await fixture(purpose);
    try {
      const flow = await f.start(); f.loseCommit(f.txCount() + 2); let authority: unknown;
      await assert.rejects(async () => { authority = await f.broker.callback(flow.input); }, code('auth_login_outcome_unknown'));
      assert.equal(authority, undefined);
      const row = (await f.sql.execute('SELECT state,sealed FROM auth_login_attempts')).rows[0]!; assert.equal(row.state, 'consumed'); assert.equal(row.sealed, null);
      assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, purpose === 'login' ? 1 : 0);
      await assert.rejects(f.broker.callback(flow.input), code('auth_login_state_unavailable'));
      assert.equal(f.provider.calls.filter(x => x.kind === 'token').length, 1);
    } finally { await f.close(); }
  }
});

test('attempt expiry before/during exchange refuses publication and retains a non-replayable result', async () => {
  const early = await fixture();
  try {
    const flow = await early.start(); early.advance(600_001);
    await assert.rejects(early.broker.callback(flow.input), code('auth_login_expired')); assert.equal(early.provider.calls.length, 0);
  } finally { await early.close(); }
  const f = await fixture(), entered = deferred(), release = deferred(); let pending: Promise<unknown> | undefined;
  try {
    const flow = await f.start({ registration: { beforeToken: async () => { entered.resolve(); await release.promise; } } });
    pending = f.broker.callback(flow.input); await entered.promise; f.advance(600_001); release.resolve();
    await assert.rejects(pending, code('auth_login_failed')); assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
    await assert.rejects(f.broker.callback(flow.input), code('auth_login_state_unavailable'));
  } finally { release.resolve(); await pending?.catch(() => undefined); await f.close(); }
});

test('logout, session generation and registry changes during held exchange prevent fresh session publication', async () => {
  for (const mutation of ['logout', 'generation', 'membership'] as const) {
    const f = await fixture(), entered = deferred(), release = deferred(); let pending: Promise<unknown> | undefined;
    try {
      const prior = await complete(f), flow = await f.start({ browser: prior.flow.browser, sessionCookieHeader: cookie(prior.session),
        registration: { beforeToken: async () => { entered.resolve(); await release.promise; } } });
      pending = f.broker.callback(flow.input); await entered.promise;
      if (mutation === 'logout') {
        const p = await f.auth.authorizeCoreRequest({ cookieHeader: cookie(prior.session), csrfHeader: prior.session.csrfToken, origin, host: 'mail.example.test', method: 'POST' }); await f.auth.revoke(p);
      } else if (mutation === 'generation') await f.sql.execute('UPDATE app_sessions SET generation=generation+1');
      else await f.sql.execute("UPDATE personal_memberships SET authz_epoch=authz_epoch+1 WHERE user_id='user-A'");
      release.resolve(); await assert.rejects(pending, code('auth_login_failed'));
      assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 1);
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.close(); }
  }
});

test('server browser generation rejects an old in-flight anonymous callback after another login succeeds', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); let old: Promise<unknown> | undefined;
  try {
    const a = await f.start({ registration: { beforeToken: async () => { entered.resolve(); await release.promise; } } });
    old = f.broker.callback(a.input); await entered.promise;
    const b = await f.start({ browser: a.browser, registration: { subject: 'Subject-B' } });
    const newest = await f.broker.callback(b.input); assert.equal(newest.purpose, 'login');
    if (newest.purpose !== 'login') throw Error(); assert.equal(newest.session.session.userId, 'user-B');
    release.resolve(); await assert.rejects(old, code('auth_login_failed'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 1);
    assert.equal((await f.sql.execute('SELECT user_id FROM app_sessions')).rows[0]!.user_id, 'user-B');
  } finally { release.resolve(); await old?.catch(() => undefined); await f.close(); }
});

test('expired/malformed existing session never becomes an anonymous expectation; callback cookie switch refuses before exchange', async () => {
  const f = await fixture();
  try {
    const prior = await complete(f), flow = await f.start({ browser: prior.flow.browser, sessionCookieHeader: cookie(prior.session) });
    await assert.rejects(f.broker.callback({ ...flow.input, sessionCookieHeader: undefined }), code('auth_login_state_unavailable'));
    await assert.rejects(f.broker.callback({ ...flow.input, sessionCookieHeader: cookie(prior.session).replace('s1.1.', 's1.2.') }), code('auth_login_state_unavailable'));
    assert.equal(f.provider.calls.filter(x => x.kind === 'token').length, 1);
    f.advance(8 * 3_600_000);
    await assert.rejects(f.start({ browser: prior.flow.browser, sessionCookieHeader: cookie(prior.session) }), code('auth_session_expired'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM auth_login_attempts')).rows[0]!.n, 2);
  } finally { await f.close(); }
});

test('callback snapshots its initiating cookie before awaiting exchange and cannot rotate an unrelated session through a mutable input', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); let pending: ReturnType<typeof f.broker.callback> | undefined;
  try {
    const a = await complete(f), b = await complete(f, { registration: { subject: 'Subject-B' } });
    const flow = await f.start({ browser: a.flow.browser, sessionCookieHeader: cookie(a.session),
      registration: { beforeToken: async () => { entered.resolve(); await release.promise; } } });
    pending = f.broker.callback(flow.input); await entered.promise;
    flow.input.sessionCookieHeader = cookie(b.session); release.resolve();
    const result = await pending; assert.equal(result.purpose, 'login');
    if (result.purpose !== 'login') throw Error(); assert.equal(result.session.session.userId, 'user-A');
    await f.auth.authenticate(cookie(b.session));
    await assert.rejects(f.auth.authenticate(cookie(a.session)), code('auth_session_unavailable'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 3);
  } finally { release.resolve(); await pending?.catch(() => undefined); await f.close(); }
});
