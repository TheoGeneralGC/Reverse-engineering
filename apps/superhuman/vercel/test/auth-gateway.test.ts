import './auth-gateway-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gatewayNetworkFacts } from './auth-gateway-network.ts';
import { gatewayFixture, fixtureFacts } from './auth-gateway-fixture.ts';
import { createGatewayBoundary } from '../src/auth-http-gateway.ts';
import { AuthenticatedWorkerCommandLog, guardTenantCoreConstruction, withAuthenticatedDispatch, withTenantNativeAuthority } from '../src/auth-command-worker.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import { AppAuthError } from '../src/auth-values.ts';

after(() => { const network = gatewayNetworkFacts(); assert.equal(network.attempts, 0); assert.equal(network.remainingPorts, 0);
  assert.equal(fixtureFacts.openedAuth, fixtureFacts.closedAuth); assert.equal(fixtureFacts.openedCore, fixtureFacts.closedCore); assert.equal(fixtureFacts.providerMail, 0);
  console.log('auth_gateway_metadata', JSON.stringify({ ...network, ...fixtureFacts })); });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
  assert.fail('The bounded synthetic state was not reached');
}
const rowCount = async (f: Awaited<ReturnType<typeof gatewayFixture>>, table: string) => (await f.raw.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n;

test('default-off boundary returns the exact legacy handler without constructing auth/tenant dependencies', async () => {
  let constructed = 0; const legacy = async () => undefined;
  assert.equal(createGatewayBoundary({ legacy, createAuthenticated() { constructed++; throw Error(); } }), legacy);
  assert.equal(createGatewayBoundary({ mode: 'off', legacy, createAuthenticated() { constructed++; throw Error(); } }), legacy);
  assert.equal(constructed, 0);
});

test('actual HTTP login/session/bridge/actor/Core stores isolate identical IDs and owner receipt reauthentication', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A'), b = await f.login('B');
    assert.equal(a.session.userId, 'user-A'); assert.equal(b.session.userId, 'user-B'); assert.notEqual(a.browserScope.key, b.browserScope.key);
    const [ra, rb] = await Promise.all([f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'same-command-id' } }),
      f.as(b, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'same-command-id' } })]);
    assert.equal(ra.status, 200); assert.equal(rb.status, 200);
    assert.equal(ra.body.thread.subject, 'Private A'); assert.equal(rb.body.thread.subject, 'Private B');
    assert.equal(f.coreCalls.get('A'), 1); assert.equal(f.coreCalls.get('B'), 1);
    const rows = (await f.raw.execute('SELECT namespace,id,request_json FROM runtime_commands')).rows;
    assert.deepEqual(new Set(rows.map(r => r.namespace)), new Set(['runtime-A', 'runtime-B'])); assert.ok(rows.every(r => r.id === 'same-command-id'));
    for (const r of rows) { assert.ok(!String(r.request_json).includes('__Host-rea_session')); assert.ok(!String(r.request_json).includes(a.csrfToken)); }
    const saved = (await f.raw.execute("SELECT authorization_json FROM app_command_authorizations WHERE namespace='runtime-A'")).rows[0]!.authorization_json;
    const newer = await f.login('A', a); assert.notEqual(newer.session.sessionRecordId, a.session.sessionRecordId); assert.equal(newer.browserScope.key, a.browserScope.key);
    const receipt = await f.as(newer, '/api/_rea/transport/results/same-command-id'); assert.equal(receipt.status, 200); assert.equal(receipt.body.thread.subject, 'Private A');
    const duplicate = await f.as(newer, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'same-command-id' } }); assert.equal(duplicate.status, 200);
    assert.equal(f.coreCalls.get('A'), 1); assert.equal((await f.raw.execute("SELECT authorization_json FROM app_command_authorizations WHERE namespace='runtime-A'")).rows[0]!.authorization_json, saved);
    assert.equal((await f.as(b, '/api/_rea/transport/results/same-command-id')).body.thread.subject, 'Private B');
    assert.deepEqual(new Set(f.factoryCalls), new Set(['tenant-A', 'tenant-B'])); assert.equal(f.pumpErrors.length, 0);
  } finally { await f.close(); }
});

test('forged/absent/revoked/expired/CSRF/selector HTTP requests cause no Core, provider or Blob work', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A'), b = await f.login('B');
    const vectors = [
      () => f.req('/api/threads/same-thread'),
      () => f.req('/api/threads/same-thread', { headers: { cookie: '__Host-rea_session=s1.1.' + 'A'.repeat(43), 'x-rea-csrf': a.csrfToken } }),
      () => f.req('/api/threads/same-thread', { headers: { cookie: a.cookie } }),
      () => f.as(a, '/api/threads/same-thread', { headers: { origin: 'https://evil.example.test' } }),
      () => f.as(a, '/api/threads/same-thread', { headers: { 'sec-fetch-site': 'cross-site' } }),
      () => f.as(a, '/api/threads/same-thread', { headers: { 'x-tenant-id': 'tenant-B' } }),
      () => f.as(a, '/api/threads/same-thread?tenantId=tenant-B'),
      () => f.as(a, '/api/preferences', { method: 'PATCH', body: { namespace: 'runtime-B' } }),
      () => f.as(a, '/api/auth/google/start'),
    ];
    for (const run of vectors) { const result = await run(); assert.ok(result.status >= 400); }
    const logout = await f.as(a, '/api/_rea/auth/logout', { method: 'POST', body: { version: 1 } }); assert.equal(logout.status, 204);
    assert.equal((await f.as(a, '/api/threads/same-thread')).status, 401);
    f.advance(8 * 3_600_000); assert.equal((await f.as(b, '/api/threads/same-thread')).status, 401);
    assert.equal(f.coreCalls.get('A'), 0); assert.equal(f.coreCalls.get('B'), 0); assert.equal(await rowCount(f, 'runtime_commands'), 0);
    assert.equal(await rowCount(f, 'app_command_authorizations'), 0); assert.deepEqual(f.blobCalls, { upload: 0, download: 0, read: 0, write: 0, remove: 0 });
  } finally { await f.close(); }
});

test('sidecar insertion failure rolls back actual command and request-body binding in the same primary transaction', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A'), bytes = Buffer.from(JSON.stringify({ name: 'synthetic.txt', mimeType: 'text/plain', data: Buffer.from('synthetic').toString('base64') }));
    const upload = await f.as(a, '/api/_rea/transport/uploads', { method: 'POST', body: { commandId: 'body-command', method: 'POST', path: '/api/drafts/same-draft/attachments', bytes: bytes.length, sha256: digest(bytes) } });
    assert.equal(upload.status, 200); f.fakeObjects.set(new URL(upload.body.upload.url).pathname.slice(1), bytes);
    f.failNextSidecar();
    const result = await f.as(a, '/api/drafts/same-draft/attachments', { method: 'POST', body: upload.body.body, headers: { 'x-rea-transport-id': 'body-command', 'x-rea-transport-body': 'blob-v1' } });
    assert.equal(result.status, 503); assert.equal(await rowCount(f, 'runtime_commands'), 0); assert.equal(await rowCount(f, 'app_command_authorizations'), 0);
    assert.equal((await f.raw.execute('SELECT state FROM runtime_body_objects')).rows[0]!.state, 'reserved');
    assert.equal(f.blobCalls.read, 0); assert.equal(f.coreCalls.get('A'), 0);
  } finally { await f.close(); }
});

test('revoked queued work becomes known terminal403 before Core while owner can read it after reauthentication', async () => {
  const f = await gatewayFixture({ pump: false }); let request: Promise<unknown> | undefined;
  try {
    const a = await f.login('A'); request = f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'queued-revoked' } });
    await until(async () => await rowCount(f, 'runtime_commands') === 1);
    const p = await f.auth.authorizeCoreRequest({ cookieHeader: a.cookie, csrfHeader: a.csrfToken, host: 'mail.example.test', origin: 'https://mail.example.test', method: 'POST' }); await f.auth.revoke(p);
    await f.actors.get('A')!.pumpOnce(); await request;
    const row = (await f.raw.execute("SELECT state,response_json FROM runtime_commands WHERE id='queued-revoked'")).rows[0]!;
    assert.equal(row.state, 'completed'); assert.equal(JSON.parse(String(row.response_json)).status, 403);
    assert.equal(f.actors.get('A')!.state, 'active'); assert.equal(f.coreCalls.get('A'), 0);
    const newer = await f.login('A'), receipt = await f.as(newer, '/api/_rea/transport/results/queued-revoked');
    assert.equal(receipt.status, 403); assert.equal(receipt.body.error.code, 'auth_command_not_dispatched');
  } finally { await request?.catch(() => undefined); await f.close(); }
});

test('authority revoked after claim is checked again before actual Core handoff, without uncertain/native replay', async () => {
  const f = await gatewayFixture({ pump: false }); let request: Promise<unknown> | undefined;
  try {
    const a = await f.login('A'); request = f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'claimed-revoked' } });
    await until(async () => await rowCount(f, 'runtime_commands') === 1);
    const log = new AuthenticatedWorkerCommandLog(f.configs.get('A')!), lease = { namespace: 'runtime-A', actorId: 'worker-A', epoch: 1 }, claimed = await log.claimNext(lease); assert.ok(claimed);
    await f.raw.execute("UPDATE app_sessions SET state='revoked' WHERE user_id='user-A'");
    const wrapper = withAuthenticatedDispatch(f.cores.get('A')!, log, lease);
    const response = await wrapper.dispatch(claimed.request, { id: claimed.id, sequence: claimed.sequence }); assert.equal(response.status, 403);
    await log.complete(lease, claimed.id, response); await request;
    assert.equal(f.coreCalls.get('A'), 0); assert.equal((await f.raw.execute("SELECT state FROM runtime_commands WHERE id='claimed-revoked'")).rows[0]!.state, 'completed');
  } finally { await request?.catch(() => undefined); await f.close(); }
});

test('legacy no-sidecar receipts stay hidden and queued work stays unchanged rather than being adopted by first login', async () => {
  const f = await gatewayFixture({ pump: false });
  try {
    const a = await f.login('A'), log = new DurableCommandLog(f.sql, { namespace: 'runtime-A', webOrigin: 'https://mail.example.test' });
    const input = { method: 'GET', path: '/api/threads/same-thread', headers: {}, body: { kind: 'inline' as const, base64: '' } };
    await log.enqueue({ namespace: 'runtime-A', id: 'legacy-command', request: input });
    const before = (await f.raw.execute('SELECT * FROM runtime_commands')).rows;
    assert.equal((await f.as(a, '/api/_rea/transport/results/legacy-command')).status, 404);
    assert.equal((await f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'legacy-command' } })).status, 403);
    const protectedLog = new AuthenticatedWorkerCommandLog(f.configs.get('A')!);
    await assert.rejects(protectedLog.claimNext({ namespace: 'runtime-A', actorId: 'worker-A', epoch: 1 }), e => e instanceof AppAuthError && e.code === 'auth_legacy_command_unbound');
    assert.deepEqual((await f.raw.execute('SELECT * FROM runtime_commands')).rows, before);
    assert.equal(await rowCount(f, 'app_command_authorizations'), 0); assert.equal(f.coreCalls.get('A'), 0);
  } finally { await f.close(); }
});

test('same-id sidecar copy/tamper cannot expose another tenant result and corrupt queued claims remain unissued', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A'), b = await f.login('B');
    await f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'same-id' } });
    await f.as(b, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'same-id' } });
    const source = (await f.raw.execute("SELECT authorization_json,mac FROM app_command_authorizations WHERE namespace='runtime-A'")).rows[0]!;
    await f.raw.execute("UPDATE app_command_authorizations SET authorization_json=?,mac=? WHERE namespace='runtime-B'", [source.authorization_json!, source.mac!]);
    assert.equal((await f.as(b, '/api/_rea/transport/results/same-id')).status, 503);
    assert.equal((await f.as(a, '/api/_rea/transport/results/same-id')).body.thread.subject, 'Private A');
    assert.equal(f.coreCalls.get('A'), 1); assert.equal(f.coreCalls.get('B'), 1);
    f.setPump(false);
    const pending = f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'tampered-queued' } });
    await until(async () => await rowCount(f, 'runtime_commands') === 3);
    await f.raw.execute("UPDATE app_command_authorizations SET mac=zeroblob(32) WHERE id='tampered-queued'");
    const protectedLog = new AuthenticatedWorkerCommandLog(f.configs.get('A')!);
    await assert.rejects(protectedLog.claimNext({ namespace: 'runtime-A', actorId: 'worker-A', epoch: 1 }), e => e instanceof AppAuthError && e.code === 'auth_command_corrupt');
    await pending;
    assert.equal((await f.raw.execute("SELECT state FROM runtime_commands WHERE id='tampered-queued'")).rows[0]!.state, 'queued');
    assert.equal(f.coreCalls.get('A'), 1);
  } finally { await f.close(); }
});

test('actual 10MiB binary attachment binds identical command IDs per tenant and rejects cross-tenant refs or payload selectors before Core', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A'), b = await f.login('B'), path = '/api/drafts/same-draft/attachments';
    const file = Buffer.alloc(10 * 1024 * 1024, 0x93), bytes = Buffer.from(JSON.stringify({ name: 'synthetic.bin', mimeType: 'application/octet-stream', data: file.toString('base64') }));
    const grant = (session: typeof a, id: string, payload: Buffer) => f.as(session, '/api/_rea/transport/uploads', { method: 'POST', body: { commandId: id, method: 'POST', path, bytes: payload.length, sha256: digest(payload) } });
    const ga = await grant(a, 'same-upload-command', bytes); assert.equal(ga.status, 200);
    const crossed = await f.as(b, path, { method: 'POST', body: ga.body.body, headers: { 'x-rea-transport-id': 'same-upload-command', 'x-rea-transport-body': 'blob-v1' } });
    assert.equal(crossed.status, 409); assert.equal(f.blobCalls.read, 0); assert.equal(f.coreCalls.get('B'), 0);
    const gb = await grant(b, 'same-upload-command', bytes); assert.equal(gb.status, 200); assert.notEqual(gb.body.body.ref, ga.body.body.ref);
    f.fakeObjects.set(new URL(gb.body.upload.url).pathname.slice(1), bytes);
    const valid = await f.as(b, path, { method: 'POST', body: gb.body.body, headers: { 'x-rea-transport-id': 'same-upload-command', 'x-rea-transport-body': 'blob-v1' } });
    assert.equal(valid.status, 201); assert.equal(f.coreCalls.get('B'), 1);
    const stored = f.cores.get('B')!.app.store.attachmentBytes('same-draft', valid.body.draft.attachments[0].id);
    assert.equal(stored.length, file.length); assert.equal(digest(stored), digest(file));
    assert.equal(f.cores.get('A')!.app.store.db.prepare('SELECT count(*) AS n FROM draft_attachments').get()!.n, 0);
    assert.equal(f.cores.get('B')!.app.store.db.prepare('SELECT count(*) AS n FROM draft_attachments').get()!.n, 1);
    const malicious = Buffer.from(JSON.stringify({ tenantId: 'tenant-B', name: 'synthetic.txt', mimeType: 'text/plain', data: 'eA==' }));
    const bad = await grant(a, 'selector-upload', malicious); assert.equal(bad.status, 200); f.fakeObjects.set(new URL(bad.body.upload.url).pathname.slice(1), malicious);
    const refused = await f.as(a, path, { method: 'POST', body: bad.body.body, headers: { 'x-rea-transport-id': 'selector-upload', 'x-rea-transport-body': 'blob-v1' } });
    assert.equal(refused.status, 403); assert.equal(refused.body.error.code, 'auth_command_not_dispatched'); assert.equal(f.coreCalls.get('A'), 0);
    assert.equal((await f.raw.execute("SELECT state FROM runtime_commands WHERE id='selector-upload'")).rows[0]!.state, 'completed');
  } finally { await f.close(); }
});

test('large response/download grants require current result ownership; logout blocks new grants without pretending to revoke an issued URL', async () => {
  const f = await gatewayFixture({ largeResponses: true });
  try {
    const a = await f.login('A'), b = await f.login('B');
    const result = await f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-transport-id': 'large-result' } }); assert.equal(result.status, 200);
    assert.equal(result.headers['x-rea-transport-body'], 'blob-v1');
    assert.equal(JSON.parse(f.fakeObjects.get(new URL(result.body.download.url).pathname.slice(1))!.toString()).thread.subject, 'Private A');
    const before = f.blobCalls.download;
    assert.equal((await f.as(b, '/api/_rea/transport/results/large-result')).status, 404); assert.equal(f.blobCalls.download, before);
    await f.as(a, '/api/_rea/auth/logout', { method: 'POST', body: { version: 1 } });
    assert.equal((await f.as(a, '/api/_rea/transport/results/large-result')).status, 401); assert.equal(f.blobCalls.download, before);
    const newer = await f.login('A'), receipt = await f.as(newer, '/api/_rea/transport/results/large-result'); assert.equal(receipt.status, 200);
    assert.equal(f.blobCalls.download, before + 1); assert.equal(f.coreCalls.get('A'), 1);
  } finally { await f.close(); }
});

test('operator proof is disabled by default and explicitly gated HTTP proof never grants a session or Core access', async () => {
  const off = await gatewayFixture();
  try {
    const browser = await off.req('/api/_rea/auth/browser'), header = browser.headers['set-cookie']![0]!.split(';')[0]!;
    const result = await off.req('/api/_rea/auth/proof', { method: 'POST', body: { version: 1 }, headers: { cookie: header, 'x-rea-csrf': browser.body.csrfToken } });
    assert.equal(result.status, 403); assert.equal(await rowCount(off, 'auth_login_attempts'), 0);
  } finally { await off.close(); }
  const f = await gatewayFixture({ proof: true });
  try {
    const browser = await f.req('/api/_rea/auth/browser'), header = browser.headers['set-cookie']![0]!.split(';')[0]!;
    const started = await f.req('/api/_rea/auth/proof', { method: 'POST', body: { version: 1 }, headers: { cookie: header, 'x-rea-csrf': browser.body.csrfToken, 'x-fixture-operator': 'allowed' } });
    assert.equal(started.status, 200); const registered = f.provider.registerAuthorization(started.body.authorizationUrl, { subject: 'Unknown-Proof-Subject' });
    const path = `/api/auth/google/callback?${new URLSearchParams({ code: registered.code, state: registered.state, scope: 'openid email', hd: 'ignored.example.test' })}`;
    assert.equal((await f.req(path, { headers: { cookie: header } })).status, 403);
    const result = await f.req(path, { headers: { cookie: header, 'x-fixture-operator': 'allowed', 'sec-fetch-site': 'cross-site' } }); assert.equal(result.status, 200);
    assert.equal(result.body.identity.subject, 'Unknown-Proof-Subject'); assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(await rowCount(f, 'app_sessions'), 0); assert.equal(await rowCount(f, 'app_users'), 2); assert.equal(f.factoryCalls.length, 0);
    assert.equal((await f.req('/api/_rea/auth/unknown')).status, 404);
    assert.equal((await f.req('/api/auth/google/callback?code=synthetic&state=legacy-state')).status, 403);
  } finally { await f.close(); }
});

test('duplicate auth headers and fake SessionView do not authorize; expired cleanup is pure and storage failure cannot ACK logout', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A');
    assert.ok((await f.as(a, '/api/threads/same-thread', { headers: { 'x-rea-csrf': [a.csrfToken, a.csrfToken] } })).status >= 400);
    assert.equal((await f.req('/api/preferences', { method: 'PATCH', body: { authContext: { userId: 'user-A', tenantId: 'tenant-A', namespace: 'runtime-A' } }, headers: { 'x-rea-csrf': 'A'.repeat(43) } })).status, 401);
    f.setAuthUnavailable(true);
    const failed = await f.as(a, '/api/_rea/auth/logout', { method: 'POST', body: { version: 1 } }); assert.equal(failed.status, 503); assert.equal(failed.headers['set-cookie'], undefined);
    f.setAuthUnavailable(false); assert.equal((await f.raw.execute('SELECT state FROM app_sessions')).rows[0]!.state, 'active');
    f.advance(8 * 3_600_000);
    const cleared = await f.as(a, '/api/_rea/auth/logout', { method: 'POST', body: { version: 1 } }); assert.equal(cleared.status, 204); assert.match(String(cleared.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await f.raw.execute('SELECT state FROM app_sessions')).rows[0]!.state, 'active'); assert.equal(f.coreCalls.get('A'), 0);
  } finally { await f.close(); }
});

test('construction and every new native admission use fixed tenant assignment; revoked ownership cannot issue even under an active actor lease', async () => {
  const f = await gatewayFixture();
  try {
    const actor = f.actors.get('A')!, configuration = f.configs.get('A')!; let constructions = 0, issues = 0;
    await assert.rejects(guardTenantCoreConstruction({ ...configuration, binding: { ...configuration.binding, tenantId: 'tenant-B' } }, () => { constructions++; throw Error(); })(actor.context), e => e instanceof AppAuthError && e.code === 'auth_command_denied');
    assert.equal(constructions, 0);
    const guarded = withTenantNativeAuthority(actor.context, configuration); await guarded.runNative(async () => { issues++; });
    await f.raw.execute("UPDATE personal_memberships SET status='revoked' WHERE user_id='user-A'");
    await assert.rejects(guarded.runNative(async () => { issues++; }), e => e instanceof AppAuthError && e.code === 'auth_assignment_unavailable');
    assert.equal(issues, 1); assert.equal(actor.activeNative, 0); assert.equal(f.coreCalls.get('A'), 0);
  } finally { await f.close(); }
});

test('every JSON MIME prefix accepted by actual Core is scanned for selectors for inline and Blob inputs before dispatch', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A');
    for (const type of ['application/jsonx', 'application/json-patch+json']) {
      const inline = await f.as(a, '/api/preferences', { method: 'PATCH', body: { tenantId: 'tenant-B', theme: 'light' }, headers: { 'content-type': type } });
      assert.equal(inline.status, 403); assert.equal(f.coreCalls.get('A'), 0);
      const path = '/api/drafts/same-draft/attachments', id = type.endsWith('jsonx') ? 'mime-jsonx' : 'mime-jsonpatch';
      const bytes = Buffer.from(JSON.stringify({ tenantId: 'tenant-B', name: 'synthetic.txt', mimeType: 'text/plain', data: 'eA==' }));
      const grant = await f.as(a, '/api/_rea/transport/uploads', { method: 'POST', body: { commandId: id, method: 'POST', path, bytes: bytes.length, sha256: digest(bytes) } });
      assert.equal(grant.status, 200); f.fakeObjects.set(new URL(grant.body.upload.url).pathname.slice(1), bytes);
      const blob = await f.as(a, path, { method: 'POST', body: grant.body.body, headers: { 'content-type': type, 'x-rea-transport-id': id, 'x-rea-transport-body': 'blob-v1' } });
      assert.equal(blob.status, 403); assert.equal(f.coreCalls.get('A'), 0);
    }
  } finally { await f.close(); }
});

test('selector scanning matches Core UTF-8 replacement decoding for both inline and immutable Blob JSON bytes', async () => {
  const f = await gatewayFixture();
  try {
    const a = await f.login('A'), inline = Buffer.concat([Buffer.from('{"tenantId":"tenant-B","signature":"'), Buffer.from([0x93]), Buffer.from('"}')]);
    assert.equal((await f.as(a, '/api/preferences', { method: 'PATCH', rawBytes: inline })).status, 403); assert.equal(f.coreCalls.get('A'), 0);
    const path = '/api/drafts/same-draft/attachments', bytes = Buffer.concat([Buffer.from('{"tenantId":"tenant-B","name":"synthetic'), Buffer.from([0x93]), Buffer.from('.txt","mimeType":"text/plain","data":"eA=="}')]);
    const grant = await f.as(a, '/api/_rea/transport/uploads', { method: 'POST', body: { commandId: 'utf8-selector', method: 'POST', path, bytes: bytes.length, sha256: digest(bytes) } });
    assert.equal(grant.status, 200); f.fakeObjects.set(new URL(grant.body.upload.url).pathname.slice(1), bytes);
    const result = await f.as(a, path, { method: 'POST', body: grant.body.body, headers: { 'x-rea-transport-id': 'utf8-selector', 'x-rea-transport-body': 'blob-v1' } });
    assert.equal(result.status, 403); assert.equal(f.coreCalls.get('A'), 0);
  } finally { await f.close(); }
});
