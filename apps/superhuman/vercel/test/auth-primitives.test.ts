import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NativeControl } from './control-sql-fixture.ts';
import type { ControlSql, ControlTransaction, SqlValue } from '../src/authority.ts';
import { GoogleLoginIdentityVerifier, readVerifiedIdentity, type GoogleVerifiedClaims, type VerifiedGoogleIdentity } from '../src/auth-identity.ts';
import { PersonalTenantRegistry, type TenantStorageDescriptor } from '../src/auth-registry.ts';
import { AppSessionAuthority, type AuthorizedAppSession } from '../src/auth-sessions.ts';
import { AppAuthError } from '../src/auth-values.ts';

const origin = 'https://mail.example.test', clientId = 'synthetic-client.apps.googleusercontent.com';
const start = 1_800_000_000_000, hour = 3_600_000;
const denyKey = Symbol.for('rea.generated-cloud.network-denied');
let openedAuth = 0, closedAuth = 0, openedCore = 0, closedCore = 0;
after(() => {
  const networkAttempts = (globalThis as unknown as Record<symbol, { attempts: number }>)[denyKey]!.attempts;
  assert.equal(networkAttempts, 0); assert.equal(openedAuth, closedAuth); assert.equal(openedCore, closedCore);
  console.log('auth_primitives_metadata', JSON.stringify({ networkAttempts, openedAuth, closedAuth, openedCore, closedCore }));
});
const schema = await readFile(new URL('./auth-registry-schema.sql', import.meta.url), 'utf8');
const key1 = Buffer.alloc(32, 19), key2 = Buffer.alloc(32, 42), csrfKey = Buffer.alloc(32, 73);
const catalogs: TenantStorageDescriptor[] = [
  { storageRef: 'storage-A', tenantId: 'tenant-A', primaryRef: 'primary-A', secretRef: 'secret-A', keyRef: 'key-A', generation: 1, namespace: 'runtime-A' },
  { storageRef: 'storage-B', tenantId: 'tenant-B', primaryRef: 'primary-B', secretRef: 'secret-B', keyRef: 'key-B', generation: 1, namespace: 'runtime-B' }
];
function claims(now: number, subject = 'Subject-A', overrides: Partial<GoogleVerifiedClaims> = {}): GoogleVerifiedClaims {
  return { issuer: 'https://accounts.google.com', subject, audience: clientId, nonce: 'synthetic-nonce',
    expiresAtSeconds: Math.floor(now / 1000) + 600, issuedAtSeconds: Math.floor(now / 1000), displayEmail: 'same@example.test', ...overrides };
}
function attempt(now: number) { return { state: 'synthetic-state', nonce: 'synthetic-nonce', codeVerifier: 'A'.repeat(43), expiresAtMs: now + 300_000 }; }
function identityVerifier(now: () => number, response: () => GoogleVerifiedClaims, onCall: () => void = () => undefined) {
  return new GoogleLoginIdentityVerifier({ now, clientId, redirectUri: `${origin}/api/auth/login/google/callback`,
    port: { async exchangeAndVerify(input) { onCall(); assert.equal(input.clientId, clientId); assert.equal(input.expectedState, 'synthetic-state');
      assert.equal(input.expectedNonce, 'synthetic-nonce'); assert.equal(input.codeVerifier, 'A'.repeat(43)); return response(); } } });
}
async function identity(now: () => number, subject = 'Subject-A', overrides: Partial<GoogleVerifiedClaims> = {}) {
  return identityVerifier(now, () => claims(now(), subject, overrides)).verify({ code: 'synthetic-code', state: 'synthetic-state' }, attempt(now()));
}
async function provision(sql: ControlTransaction, name: 'A' | 'B') {
  await sql.execute("INSERT INTO app_users VALUES(?,'active',1,?)", [`user-${name}`, start]);
  await sql.execute('INSERT INTO external_identities VALUES(?,?,?,?,?)', ['https://accounts.google.com', `Subject-${name}`, `user-${name}`, 'same@example.test', start]);
  await sql.execute("INSERT INTO personal_tenants VALUES(?,?,'active',1)", [`tenant-${name}`, `user-${name}`]);
  await sql.execute("INSERT INTO personal_memberships VALUES(?,?,'active',1)", [`user-${name}`, `tenant-${name}`]);
  await sql.execute("INSERT INTO tenant_storage VALUES(?,?,?,?,?,1,'active')", [`storage-${name}`, `tenant-${name}`, `primary-${name}`, `secret-${name}`, `key-${name}`]);
  await sql.execute('INSERT INTO tenant_runtimes VALUES(?,?,?,1)', [`runtime-${name}`, `tenant-${name}`, `storage-${name}`]);
}
async function fixture(options: { sqlWrap?: (sql: ControlSql) => ControlSql; catalog?: TenantStorageDescriptor[] } = {}) {
  const sql = new NativeControl(':memory:', { DATABASE_PATH: ':memory:' });
  openedAuth++;
  for (const statement of schema.split(';').filter(s => s.trim())) await sql.execute(statement);
  await sql.transaction(async tx => { await provision(tx, 'A'); await provision(tx, 'B'); });
  let now = start;
  const port = options.sqlWrap?.(sql) ?? sql;
  const registry = new PersonalTenantRegistry(port, options.catalog ?? catalogs);
  const auth = new AppSessionAuthority({ sql: port, registry, sessionKeys: new Map([[1, key1]]), currentKeyVersion: 1, csrfKey, webOrigin: origin, now: () => now });
  return { sql, port, registry, auth, now: () => now, advance: (ms: number) => { now += ms; }, close: async () => { await sql.close(); closedAuth++; } };
}
const cookie = (session: { setCookie: string }) => session.setCookie.split(';')[0]!;
function expectCode(code: string | RegExp) { return (error: unknown) => error instanceof AppAuthError && (typeof code === 'string' ? error.code === code : code.test(error.code)); }
async function login(f: Awaited<ReturnType<typeof fixture>>, name: 'A' | 'B' = 'A') { return f.auth.createSession(await identity(f.now, `Subject-${name}`)); }
async function core(f: Awaited<ReturnType<typeof fixture>>, session: { setCookie: string; csrfToken: string }, method = 'GET') {
  return f.auth.authorizeCoreRequest({ cookieHeader: cookie(session), csrfHeader: session.csrfToken, origin, method, host: 'mail.example.test' });
}

test('constructors are inert; no schema/provisioning, handler, default tenant or network is installed', async () => {
  let io = 0;
  const port: ControlSql = { async execute() { io++; throw Error('synthetic denial'); }, async transaction() { io++; throw Error('synthetic denial'); } };
  const registry = new PersonalTenantRegistry(port, catalogs);
  new AppSessionAuthority({ sql: port, registry, sessionKeys: new Map([[1, key1]]), currentKeyVersion: 1, csrfKey, webOrigin: origin });
  assert.equal(io, 0);
  await assert.rejects(registry.forVerifiedIdentity({} as VerifiedGoogleIdentity), expectCode('auth_identity_unverified'));
  assert.equal(io, 0);
});

test('verified evidence is nonserializable/unforgeable and claim policy rejects wrong issuer/audience/azp/nonce/time before sessions', async () => {
  const f = await fixture();
  try {
    const proof = await identity(f.now, 'Subject-A', { issuer: 'accounts.google.com' });
    assert.equal(readVerifiedIdentity(proof).issuer, 'https://accounts.google.com');
    assert.deepEqual(JSON.parse(JSON.stringify(proof)), {});
    await assert.rejects(f.auth.createSession(JSON.parse(JSON.stringify(proof))), expectCode('auth_identity_unverified'));
    let calls = 0;
    await assert.rejects(identityVerifier(f.now, () => claims(f.now()), () => calls++).verify({ code: 'synthetic-code', state: 'wrong' }, attempt(f.now())), expectCode('auth_login_attempt_invalid'));
    assert.equal(calls, 0);
    const invalid: Partial<GoogleVerifiedClaims>[] = [
      { issuer: 'https://evil.example.test' }, { subject: '' }, { audience: 'other-client' },
      { audience: [clientId, 'second'], authorizedParty: undefined }, { audience: clientId, authorizedParty: 'other-client' },
      { audience: [clientId, clientId] }, { nonce: 'wrong' }, { expiresAtSeconds: f.now() / 1000 },
      { issuedAtSeconds: f.now() / 1000 + 61 }, { issuedAtSeconds: f.now() / 1000 + 600 }
    ];
    for (const bad of invalid) await assert.rejects(identity(f.now, 'Subject-A', bad), expectCode('auth_identity_invalid'));
    const throwing = new GoogleLoginIdentityVerifier({ clientId, redirectUri: `${origin}/callback`, now: f.now,
      port: { async exchangeAndVerify() { throw Error('sensitive-synthetic-provider-error'); } } });
    await assert.rejects(throwing.verify({ code: 'synthetic-code', state: 'synthetic-state' }, attempt(f.now())), error => error instanceof AppAuthError && !JSON.stringify(error).includes('sensitive'));
    const mutableAttempt = attempt(f.now());
    const expiryCheck = new GoogleLoginIdentityVerifier({ clientId, redirectUri: `${origin}/callback`, now: f.now,
      port: { async exchangeAndVerify() { f.advance(300_001); mutableAttempt.expiresAtMs += 600_000; return claims(f.now()); } } });
    await assert.rejects(expiryCheck.verify({ code: 'synthetic-code', state: 'synthetic-state' }, mutableAttempt), expectCode('auth_identity_invalid'));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
  } finally { await f.close(); }
});

test('login requires explicit issuer/sub provisioning: email changes survive, same email/different or secondary sub cannot claim a tenant', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.registry.forVerifiedIdentity(await identity(f.now, 'Subject-A', { displayEmail: 'renamed@example.test' }))).userId, 'user-A');
    for (const subject of ['subject-A', 'Secondary-Mailbox', 'Unknown']) {
      await assert.rejects(f.auth.createSession(await identity(f.now, subject)), expectCode('auth_identity_not_provisioned'));
    }
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 0);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_users')).rows[0]!.n, 2);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM personal_tenants')).rows[0]!.n, 2);
  } finally { await f.close(); }
});

test('registry pins protected catalog identity/generation and refuses missing, cross-tenant or disabled assignments', async () => {
  const corruptions: [string, (readonly SqlValue[])?][] = [
    ["UPDATE app_users SET status='disabled' WHERE user_id='user-A'"],
    ["UPDATE personal_memberships SET status='revoked' WHERE user_id='user-A'"],
    ["UPDATE personal_tenants SET status='suspended' WHERE tenant_id='tenant-A'"],
    ["UPDATE tenant_storage SET status='disabled' WHERE storage_ref='storage-A'"],
    ["UPDATE tenant_storage SET generation=2 WHERE storage_ref='storage-A'"],
    ["UPDATE tenant_runtimes SET storage_generation=2 WHERE namespace='runtime-A'"],
    ["UPDATE tenant_storage SET primary_ref='primary-wrong' WHERE storage_ref='storage-A'"],
    ["DELETE FROM tenant_runtimes WHERE namespace='runtime-A'"]
  ];
  for (const [query, args] of corruptions) {
    const f = await fixture();
    try { await f.sql.execute(query, args); await assert.rejects(f.registry.forUser('user-A'), expectCode('auth_assignment_unavailable')); }
    finally { await f.close(); }
  }
  const f = await fixture();
  try {
    await assert.rejects(f.sql.execute("UPDATE tenant_runtimes SET storage_ref='storage-B' WHERE namespace='runtime-A'"));
    const wrong = new PersonalTenantRegistry(f.sql, [{ ...catalogs[0]!, tenantId: 'tenant-B' }]);
    await assert.rejects(wrong.forUser('user-A'), expectCode('auth_assignment_unavailable'));
    assert.throws(() => new PersonalTenantRegistry(f.sql, [catalogs[0]!, { ...catalogs[1]!, primaryRef: 'primary-A' }]), expectCode('auth_configuration_invalid'));
    const mutable = { ...catalogs[0]! }, snapshotted = new PersonalTenantRegistry(f.sql, [mutable]);
    mutable.primaryRef = 'primary-attacker'; mutable.tenantId = 'tenant-B';
    assert.equal((await snapshotted.forUser('user-A')).namespace, 'runtime-A');
  } finally { await f.close(); }
});

test('real random sessions store only independent-key HMAC/CSRF digests and exact host-bound cookie attributes', async () => {
  const f = await fixture();
  try {
    const a = await login(f), b = await login(f); assert.notEqual(cookie(a), cookie(b)); assert.notEqual(a.csrfToken, b.csrfToken);
    assert.match(a.setCookie, /^__Host-rea_session=s1\.1\.[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800$/);
    assert.ok(!a.setCookie.includes('Domain='));
    const token = cookie(a).split('=')[1]!, rows = (await f.sql.execute('SELECT * FROM app_sessions')).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.some(row => Buffer.from(row.token_digest as Uint8Array).equals(createHmac('sha256', key1).update('rea/app-session/v1\0').update(token).digest())));
    const stored = JSON.stringify(rows);
    assert.ok(!stored.includes(token)); assert.ok(!stored.includes(a.csrfToken));
    assert.ok(!stored.includes(key1.toString('hex'))); assert.ok(!stored.includes(csrfKey.toString('hex')));
    assert.ok(!JSON.stringify(a.session).includes(token)); assert.ok(!JSON.stringify(a.session).includes(a.csrfToken));
  } finally { await f.close(); }
});

test('cookie tampering/duplicates and missing GET CSRF fail before protected routing; authentication alone cannot mint command authority', async () => {
  const f = await fixture();
  try {
    const session = await login(f), authOnly = await f.auth.authenticate(cookie(session));
    await assert.rejects(f.auth.commandAuthorization(authOnly), expectCode('auth_csrf_required'));
    for (const header of [undefined, '', cookie(session) + '; ' + cookie(session), [cookie(session)], cookie(session).replace('s1.1.', 's1.2.'),
      cookie(session).slice(0, -2) + 'AA', cookie(session).replace('s1.', '%73%31.'), '__Host-rea_session=bad']) {
      await assert.rejects(f.auth.authenticate(header), expectCode(/^auth_(?:cookie|session)_/));
    }
    const denied = [
      { cookieHeader: cookie(session), csrfHeader: undefined, origin, method: 'GET' },
      { cookieHeader: cookie(session), csrfHeader: session.csrfToken, origin: 'https://evil.example.test', method: 'POST' },
      { cookieHeader: cookie(session), csrfHeader: session.csrfToken, origin: 'https://evil.example.test', method: 'GET' },
      { cookieHeader: cookie(session), csrfHeader: session.csrfToken, origin: undefined, method: 'POST' },
      { cookieHeader: cookie(session), csrfHeader: [session.csrfToken], origin, method: 'GET' },
      { cookieHeader: cookie(session), csrfHeader: session.csrfToken, origin, method: 'GET', namespace: 'runtime-B' }
    ];
    let protectedIo = 0;
    for (const input of denied) await assert.rejects(async () => { await f.auth.authorizeCoreRequest({ ...input, host: 'mail.example.test' }); protectedIo++; }, expectCode(/^auth_(?:csrf|selector|origin)_/));
    assert.equal(protectedIo, 0);
    const authorized = await core(f, session);
    assert.equal((await f.auth.commandAuthorization(authorized)).namespace, 'runtime-A');
    const browserGet = await f.auth.authorizeCoreRequest({ cookieHeader: cookie(session), csrfHeader: session.csrfToken, origin: undefined, method: 'GET', host: 'mail.example.test' });
    assert.equal((await f.auth.commandAuthorization(browserGet)).namespace, 'runtime-A');
    await assert.rejects(f.auth.commandAuthorization(JSON.parse(JSON.stringify(authorized))), expectCode('auth_session_unverified'));
  } finally { await f.close(); }
});

test('actual A/B isolation allows identical Core/request/body IDs without routing or receipt collisions', async () => {
  const f = await fixture(), aCore = new DatabaseSync(':memory:'), bCore = new DatabaseSync(':memory:');
  openedCore += 2;
  try {
    for (const [db, tenant] of [[aCore, 'A'], [bCore, 'B']] as const) { db.exec('CREATE TABLE synthetic_records(id TEXT PRIMARY KEY,value TEXT)'); db.prepare('INSERT INTO synthetic_records VALUES(?,?)').run('same-core-id', `private-${tenant}`); }
    const a = await login(f, 'A'), b = await login(f, 'B'), stores = new Map([['runtime-A', aCore], ['runtime-B', bCore]]);
    const results = new Map([['runtime-A', new Map([['same-command-id', 'receipt-A'], ['same-body-id', 'bytes-A']])], ['runtime-B', new Map([['same-command-id', 'receipt-B'], ['same-body-id', 'bytes-B']])]]);
    let protectedReads = 0;
    async function read(session: typeof a, objectId: string) {
      const ctx = await f.auth.commandAuthorization(await core(f, session)); protectedReads++;
      return { record: stores.get(ctx.namespace)!.prepare('SELECT value FROM synthetic_records WHERE id=?').get(objectId)?.value,
        receipt: results.get(ctx.namespace)!.get('same-command-id'), body: results.get(ctx.namespace)!.get('same-body-id') };
    }
    assert.deepEqual(await read(a, 'same-core-id'), { record: 'private-A', receipt: 'receipt-A', body: 'bytes-A' });
    assert.deepEqual(await read(b, 'same-core-id'), { record: 'private-B', receipt: 'receipt-B', body: 'bytes-B' });
    const snapshot = await f.auth.commandAuthorization(await core(f, a));
    assert.deepEqual(Object.keys(snapshot).sort(), ['membershipAuthzEpoch', 'namespace', 'policyVersion', 'purpose', 'sessionGeneration', 'sessionRecordId', 'storageGeneration', 'storageRef', 'tenantAuthzEpoch', 'tenantId', 'userAuthEpoch', 'userId'].sort());
    await assert.rejects(f.auth.commandAuthorization(snapshot as unknown as AuthorizedAppSession), expectCode('auth_session_unverified'));
    assert.equal(protectedReads, 2);
  } finally { aCore.close(); bCore.close(); closedCore += 2; await f.close(); }
});

test('logout/rotation invalidate old cookies AND existing authority proofs without rewriting tenant data', async () => {
  const f = await fixture();
  try {
    const a = await login(f), old = await core(f, a), before = (await f.sql.execute('SELECT * FROM tenant_storage')).rows;
    const b = await f.auth.createSession(await identity(f.now, 'Subject-B'), { previousCookieHeader: cookie(a) });
    await assert.rejects(f.auth.authenticate(cookie(a)), expectCode('auth_session_unavailable'));
    await assert.rejects(f.auth.commandAuthorization(old), expectCode('auth_session_unavailable'));
    assert.equal((await f.auth.commandAuthorization(await core(f, b))).tenantId, 'tenant-B');
    const p = await core(f, b), logout = await f.auth.revoke(p); assert.match(logout.setCookie, /Max-Age=0$/);
    await assert.rejects(f.auth.commandAuthorization(p), expectCode('auth_session_unavailable'));
    await assert.rejects(f.auth.sessionInfo(p), expectCode('auth_session_unavailable'));
    assert.deepEqual((await f.sql.execute('SELECT * FROM tenant_storage')).rows, before);
  } finally { await f.close(); }
});

test('idle/absolute/recent-auth boundaries use actual persisted times; background reads never extend idle', async () => {
  const f = await fixture();
  try {
    const s = await login(f); let p = await core(f, s); await f.auth.requireRecentAuthentication(p);
    f.advance(15 * 60_000); await assert.rejects(f.auth.requireRecentAuthentication(p), expectCode('auth_recent_login_required'));
    f.advance(7 * hour - 15 * 60_000); p = await core(f, s);
    assert.equal((await f.sql.execute('SELECT last_interactive_ms FROM app_sessions')).rows[0]!.last_interactive_ms, start);
    await f.auth.recordInteractiveActivity(p);
    assert.equal((await f.sql.execute('SELECT idle_expires_ms FROM app_sessions')).rows[0]!.idle_expires_ms, start + 15 * hour);
    for (let i = 0; i < 22; i++) { f.advance(7 * hour); p = await core(f, s); await f.auth.recordInteractiveActivity(p); }
    assert.equal(f.now(), start + 161 * hour);
    assert.equal((await f.sql.execute('SELECT idle_expires_ms FROM app_sessions')).rows[0]!.idle_expires_ms, start + 168 * hour);
    f.advance(7 * hour); await assert.rejects(f.auth.authenticate(cookie(s)), expectCode('auth_session_expired'));
  } finally { await f.close(); }
  const idle = await fixture();
  try { const s = await login(idle); idle.advance(8 * hour); await assert.rejects(idle.auth.authenticate(cookie(s)), expectCode('auth_session_expired')); }
  finally { await idle.close(); }
});

test('revoked memberships, changed epochs and storage assignment generations invalidate previously accepted interactive context', async () => {
  for (const query of ["UPDATE app_users SET auth_epoch=2 WHERE user_id='user-A'", "UPDATE personal_memberships SET authz_epoch=2 WHERE user_id='user-A'",
    "UPDATE personal_tenants SET authz_epoch=2 WHERE tenant_id='tenant-A'", "UPDATE personal_memberships SET status='revoked' WHERE user_id='user-A'",
    "UPDATE tenant_storage SET generation=2 WHERE storage_ref='storage-A'"]) {
    const f = await fixture();
    try {
      const s = await login(f), old = await core(f, s); await f.sql.execute(query);
      await assert.rejects(f.auth.commandAuthorization(old), expectCode(/^auth_(?:session|assignment)_/));
    } finally { await f.close(); }
  }
});

test('session rotation is atomic on SQL failure and never retries an ambiguous commit', async () => {
  let failInsert = false, inserts = 0, uncertain = false;
  const f = await fixture({ sqlWrap(sql) { return { execute: sql.execute.bind(sql), async transaction(work) {
    const value = await sql.transaction(tx => work({ async execute(query, args) {
      if (query.includes('INSERT INTO app_sessions')) { inserts++; if (failInsert) throw Error('synthetic-insert-failure'); }
      return tx.execute(query, args);
    } }));
    if (uncertain) throw Error('synthetic-commit-uncertain'); return value;
  } }; } });
  try {
    const s = await login(f); failInsert = true;
    await assert.rejects(f.auth.createSession(await identity(f.now), { previousCookieHeader: cookie(s) }));
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 1);
    await f.auth.authenticate(cookie(s)); failInsert = false; uncertain = true;
    const before = inserts; await assert.rejects(login(f), expectCode('auth_storage_outcome_unknown')); assert.equal(inserts - before, 1);
    assert.equal((await f.sql.execute('SELECT count(*) AS n FROM app_sessions')).rows[0]!.n, 2);
  } finally { await f.close(); }
});

test('key material is copied, domain separated and not caller-selectable; independently rotated rings reject retired keys', async () => {
  const f = await fixture();
  try {
    assert.throws(() => new AppSessionAuthority({ sql: f.sql, registry: f.registry, sessionKeys: new Map([[1, key1]]), currentKeyVersion: 1, csrfKey: key1, webOrigin: origin }), expectCode('auth_configuration_invalid'));
    assert.throws(() => new AppSessionAuthority({ sql: f.sql, registry: f.registry, sessionKeys: new Map([[1, Buffer.alloc(8)]]), currentKeyVersion: 1, csrfKey, webOrigin: origin }), expectCode('auth_configuration_invalid'));
    const copied = Buffer.from(key1), localCsrf = Buffer.from(csrfKey);
    const auth = new AppSessionAuthority({ sql: f.sql, registry: f.registry, sessionKeys: new Map([[1, copied]]), currentKeyVersion: 1, csrfKey: localCsrf, webOrigin: origin, now: f.now });
    copied.fill(0); localCsrf.fill(0);
    const old = await auth.createSession(await identity(f.now)); await f.auth.authenticate(cookie(old));
    const rotated = new AppSessionAuthority({ sql: f.sql, registry: f.registry, sessionKeys: new Map([[1, key1], [2, key2]]), currentKeyVersion: 2, csrfKey, webOrigin: origin, now: f.now });
    await rotated.authenticate(cookie(old)); const next = await rotated.createSession(await identity(f.now)); assert.match(cookie(next), /=s1\.2\./);
    const retired = new AppSessionAuthority({ sql: f.sql, registry: f.registry, sessionKeys: new Map([[2, key2]]), currentKeyVersion: 2, csrfKey, webOrigin: origin, now: f.now });
    await assert.rejects(retired.authenticate(cookie(old)), expectCode('auth_session_unavailable')); await retired.authenticate(cookie(next));
    const proof = await rotated.authorizeCoreRequest({ cookieHeader: cookie(next), csrfHeader: next.csrfToken, origin, method: 'GET', host: 'mail.example.test' });
    await assert.rejects(retired.commandAuthorization(proof), expectCode('auth_session_unverified'));
    const token = cookie(old).split('=')[1]!;
    const normalHash = createHash('sha256').update(token).digest();
    assert.notDeepEqual((await f.sql.execute('SELECT token_digest FROM app_sessions LIMIT 1')).rows[0]!.token_digest, normalHash);
  } finally { await f.close(); }
});

test('session creation/bootstrap return display metadata only, never a command authorization snapshot', async () => {
  const f = await fixture();
  try {
    const s = await login(f);
    assert.equal('authorization' in s, false);
    const info = await f.auth.sessionInfo(await f.auth.authenticate(cookie(s)));
    assert.equal('authorization' in info, false);
    assert.deepEqual(Object.keys(info.session).sort(), ['absoluteExpiresMs', 'idleExpiresMs', 'sessionGeneration', 'sessionRecordId', 'tenantId', 'userId']);
    assert.ok(!JSON.stringify(info).includes('runtime-A')); assert.ok(!JSON.stringify(info).includes('storage-A'));
  } finally { await f.close(); }
});

test('browser-style Core GET requires canonical Host and CSRF; missing safe Origin is allowed but hostile Origin/Fetch Metadata is refused', async () => {
  const f = await fixture();
  try {
    const s = await login(f);
    await assert.rejects(f.auth.authorizeCoreRequest({ cookieHeader: cookie(s), csrfHeader: s.csrfToken, origin: undefined, method: 'GET' }), expectCode('auth_origin_invalid'));
    const request = { cookieHeader: cookie(s), csrfHeader: s.csrfToken, origin: undefined, method: 'GET', host: 'mail.example.test', fetchSite: 'same-origin' };
    const p = await f.auth.authorizeCoreRequest(request); assert.equal((await f.auth.commandAuthorization(p)).namespace, 'runtime-A');
    for (const bad of [{ ...request, host: 'evil.example.test' }, { ...request, host: ['mail.example.test'] },
      { ...request, origin: 'null' }, { ...request, origin: 'https://evil.example.test' },
      { ...request, fetchSite: 'cross-site' }, { ...request, fetchSite: 'same-site' }, { ...request, fetchSite: ['same-origin'] }]) {
      await assert.rejects(f.auth.authorizeCoreRequest(bad), expectCode('auth_origin_invalid'));
    }
  } finally { await f.close(); }
});

test('a changed registry namespace is refused even when every storage identity and generation still matches', async () => {
  const f = await fixture();
  try {
    await f.sql.execute("UPDATE tenant_runtimes SET namespace='runtime-attacker' WHERE namespace='runtime-A'");
    await assert.rejects(f.registry.forUser('user-A'), expectCode('auth_assignment_unavailable'));
  } finally { await f.close(); }
});

test('auth SQL failures expose fixed codes only and never retain raw port errors or retry', async () => {
  let broken = false, calls = 0;
  const f = await fixture({ sqlWrap(sql) { return { transaction: sql.transaction.bind(sql), async execute(query, args) {
    calls++; if (broken) throw Error('sensitive-synthetic-endpoint-and-credential'); return sql.execute(query, args);
  } }; } });
  try {
    const s = await login(f); broken = true;
    for (const work of [() => f.registry.forUser('user-A'), () => f.auth.authenticate(cookie(s))]) {
      const before = calls;
      await assert.rejects(work, error => error instanceof AppAuthError && error.code === 'auth_storage_unavailable' &&
        !JSON.stringify(error).includes('sensitive') && !error.message.includes('sensitive') && !('cause' in error));
      assert.equal(calls - before, 1);
    }
  } finally { await f.close(); }
});

test('logout and idle mutation require a current CSRF-authorized proof; raw cookies and auth-only/stale proofs cannot write', async () => {
  const f = await fixture();
  try {
    const s = await login(f), authOnly = await f.auth.authenticate(cookie(s)), accepted = await core(f, s);
    const before = (await f.sql.execute('SELECT * FROM app_sessions')).rows;
    await assert.rejects(f.auth.recordInteractiveActivity(authOnly), expectCode('auth_csrf_required'));
    await assert.rejects(f.auth.revoke(authOnly), expectCode('auth_csrf_required'));
    await assert.rejects(f.auth.revoke(cookie(s) as unknown as AuthorizedAppSession), expectCode('auth_session_unverified'));
    assert.deepEqual((await f.sql.execute('SELECT * FROM app_sessions')).rows, before);
    await f.auth.revoke(accepted);
    await assert.rejects(f.auth.recordInteractiveActivity(accepted), expectCode('auth_session_unavailable'));
    await assert.rejects(f.auth.revoke(accepted), expectCode('auth_session_unavailable'));
  } finally { await f.close(); }
});
