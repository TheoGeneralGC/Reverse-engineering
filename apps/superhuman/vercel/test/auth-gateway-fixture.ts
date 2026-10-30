import './auth-gateway-network.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server, type IncomingHttpHeaders } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { NativeControl } from './control-sql-fixture.ts';
import type { ControlSql, ControlTransaction } from '../src/authority.ts';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCoreActor } from '../src/actor.ts';
import { DurableCommandLog } from '../src/command-log.ts';
import { PrivateBodyTransport, type PrivateBlobPort } from '../src/blob-transport.ts';
import { PersonalTenantRegistry } from '../src/auth-registry.ts';
import { AppSessionAuthority } from '../src/auth-sessions.ts';
import { OneUseGoogleLoginBroker } from '../src/auth-login-broker.ts';
import { AuthenticatedTenantTransport, type AuthenticatedTransportOptions } from '../src/auth-command-gateway.ts';
import { AuthenticatedWorkerCommandLog, guardTenantCoreConstruction, withAuthenticatedBodies, withAuthenticatedDispatch } from '../src/auth-command-worker.ts';
import { GatewayTenantDirectory, createAuthenticatedGateway } from '../src/auth-http-gateway.ts';
import { LoopbackCoreAdapter } from '../src/core-adapter.ts';
import type { Thread } from '../../api/src/types.ts';
import { allowGatewayPort, closeGatewayPort } from './auth-gateway-network.ts';
import { origin, callbackUri, clientId, clientSecret, providerFixture } from './auth-oidc-fixture.ts';

export const fixtureFacts = { openedAuth: 0, closedAuth: 0, openedCore: 0, closedCore: 0, providerMail: 0, model: 0 };
const schemas = await Promise.all(['auth-registry-schema.sql', 'auth-login-schema.sql', 'auth-command-schema.sql'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
export const cookie = (value: string | string[] | undefined) => { assert.equal(typeof value, 'string'); return (value as string).split(';')[0]!; };
export type HttpResult = { status: number; body: any; headers: IncomingHttpHeaders; bytes: Buffer };
export type SessionFixture = { cookie: string; csrfToken: string; session: { sessionRecordId: string; userId: string }; browserScope: { key: string } };
type HttpInput = { method?: string; body?: unknown; rawBytes?: Buffer; headers?: Record<string, string | string[]>; omitOrigin?: boolean };
export async function gatewayFixture(options: { pump?: boolean; proof?: boolean; largeResponses?: boolean } = {}) {
  const raw = new NativeControl(':memory:', { DATABASE_PATH: ':memory:' }); fixtureFacts.openedAuth++;
  let failSidecar = false, failSessionReads = false, offset = 0, pumpEnabled = options.pump !== false, closed = false;
  const actors = new Map<string, DurableCoreActor>(), cores = new Map<string, LoopbackCoreAdapter>(), configs = new Map<string, AuthenticatedTransportOptions>();
  const coreCalls = new Map<string, number>(), factoryCalls: string[] = [], pumpErrors: unknown[] = [];
  let gateway: Server | undefined, gatewayPort = 0, timer: ReturnType<typeof setInterval> | undefined;
  const wrapTx = (tx: ControlTransaction): ControlTransaction => ({ async execute(sql, args) {
    if (failSessionReads && sql.includes('FROM app_sessions')) throw Error('synthetic_auth_storage_unavailable');
    if (failSidecar && sql.startsWith('INSERT INTO app_command_authorizations')) { failSidecar = false; throw Error('synthetic_sidecar_failure'); }
    return tx.execute(sql, args);
  } });
  const sql: ControlSql = { execute: (statement, args) => wrapTx(raw).execute(statement, args), transaction: work => raw.transaction(tx => work(wrapTx(tx))) };
  const now = () => Date.now() + offset;
  const fakeObjects = new Map<string, Buffer>(), blobCalls = { upload: 0, download: 0, read: 0, write: 0, remove: 0 };
  const privateOrigin = 'https://synthetic.private.blob.vercel-storage.com';
  const blob: PrivateBlobPort = {
    async uploadGrant(path) { blobCalls.upload++; return { url: `${privateOrigin}/${path}?fixture=put` }; },
    async downloadGrant(path) { blobCalls.download++; return { url: `${privateOrigin}/${path}?fixture=get` }; },
    async read(path) { blobCalls.read++; const bytes = fakeObjects.get(path); return bytes ? new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } }) : null; },
    async write(path, bytes) { blobCalls.write++; fakeObjects.set(path, Buffer.from(bytes)); }, async remove(path) { blobCalls.remove++; fakeObjects.delete(path); },
  };
  const close = async () => {
    if (closed) return; closed = true;
    if (gateway) { gateway.closeAllConnections(); await new Promise<void>(resolve => gateway!.close(() => resolve())); closeGatewayPort(gatewayPort); }
    if (timer) clearInterval(timer);
    for (const actor of actors.values()) { if (actor.state === 'active') await actor.close(); else await actor.settleUncertain().catch(() => undefined); }
    for (const core of cores.values()) { await core.close(); closeGatewayPort(core.port); }
    await raw.close(); fixtureFacts.closedAuth++;
  };
  try {
    // Existing transport tables are prepared explicitly by this owned fixture.
    await new DurableCommandLog(sql, { namespace: 'runtime-A', webOrigin: origin }).initialize();
    for (const schema of schemas) for (const statement of schema.split(';').filter(s => s.trim())) await raw.execute(statement);
    for (const name of ['A', 'B']) {
      await raw.execute("INSERT INTO app_users VALUES(?,'active',1,?)", [`user-${name}`, now()]);
      await raw.execute('INSERT INTO external_identities VALUES(?,?,?,?,?)', ['https://accounts.google.com', `Subject-${name}`, `user-${name}`, 'synthetic@example.test', now()]);
      await raw.execute("INSERT INTO personal_tenants VALUES(?,?,'active',1)", [`tenant-${name}`, `user-${name}`]);
      await raw.execute("INSERT INTO personal_memberships VALUES(?,?,'active',1)", [`user-${name}`, `tenant-${name}`]);
      await raw.execute("INSERT INTO tenant_storage VALUES(?,?,?,?,?,1,'active')", [`storage-${name}`, `tenant-${name}`, `primary-${name}`, `secret-${name}`, `key-${name}`]);
      await raw.execute('INSERT INTO tenant_runtimes VALUES(?,?,?,1)', [`runtime-${name}`, `tenant-${name}`, `storage-${name}`]);
    }
    const registry = new PersonalTenantRegistry(sql, ['A', 'B'].map(name => ({ storageRef: `storage-${name}`, tenantId: `tenant-${name}`, primaryRef: `primary-${name}`,
      secretRef: `secret-${name}`, keyRef: `key-${name}`, generation: 1, namespace: `runtime-${name}` })));
    const sessions = { registry, sessionKeys: new Map([[1, Buffer.alloc(32, 19)]]), currentKeyVersion: 1, csrfKey: Buffer.alloc(32, 73), webOrigin: origin, now };
    const auth = new AppSessionAuthority({ ...sessions, sql }), provider = providerFixture();
    const broker = (purpose: 'login' | 'owner-identity-proof') => new OneUseGoogleLoginBroker({ sql, purpose, clientId, clientSecret, callbackUri,
      browserHmacKey: Buffer.alloc(32, 42), preauthCsrfKey: Buffer.alloc(32, 55), attemptSealKey: Buffer.alloc(32, 66), sessions, now, fetcher: provider.fetcher });
    for (const name of ['A', 'B']) {
      const binding = await registry.forUser(`user-${name}`), namespace = binding.namespace;
      const configuration: AuthenticatedTransportOptions = { sql, registry, binding, webOrigin: origin, commandMacKey: Buffer.alloc(32, 91), commandMacVersion: 1,
        blob: { port: blob, privateOrigin }, now };
      configs.set(name, configuration);
      const bodies = new PrivateBodyTransport({ sql, namespace, blob, now }); await bodies.initialize();
      const authority = new ActorAuthority(sql, { namespace, now }); await authority.initialize();
      const log = new AuthenticatedWorkerCommandLog(configuration);
      const actor = await DurableCoreActor.start({ authority, log, actorId: `worker-${name}`, deploymentId: 'synthetic-deployment', initializeControl: false,
        createCore: guardTenantCoreConstruction(configuration, async context => {
          const authenticatedBodies = withAuthenticatedBodies(bodies, log, context.lease);
          const core = await LoopbackCoreAdapter.create({ context, namespace, databasePath: ':memory:', env: { DATABASE_PATH: ':memory:', WEB_ORIGIN: origin },
            databaseFactory(path) { assert.equal(path, ':memory:'); const db = new DatabaseSync(path); fixtureFacts.openedCore++;
              return { exec: db.exec.bind(db), prepare: db.prepare.bind(db), get isTransaction() { return db.isTransaction; }, close() { db.close(); fixtureFacts.closedCore++; } }; },
            bodies: authenticatedBodies, maxInlineBytes: options.largeResponses ? 128 : undefined, transport: async () => { fixtureFacts.providerMail++; throw Error('synthetic_provider_denied'); },
            overrides: { seed: false, runJobs: false, providerDraftAutomatic: false } });
          cores.set(name, core); allowGatewayPort(core.port); coreCalls.set(name, 0);
          const dispatch = core.dispatch.bind(core); core.dispatch = (request, command) => { coreCalls.set(name, coreCalls.get(name)! + 1); return dispatch(request, command); };
          core.app.google.fetcher = async () => { fixtureFacts.providerMail++; throw Error('synthetic_provider_denied'); };
          core.app.store.put('account', 'same-account', { id: 'same-account', provider: 'demo', email: `own-${name.toLowerCase()}@example.test`, name: `Private ${name}`, color: '#000000' });
          const person = { name: 'Synthetic', email: 'sender@example.test' }, thread: Thread = { id: 'same-thread', accountId: 'same-account', subject: `Private ${name}`,
            snippet: `private-${name}`, sender: person, participants: [person], lastMessageAt: '2026-10-30T00:00:00.000Z', unread: true, starred: false, important: true,
            folder: 'inbox', labels: [], messages: [{ id: 'same-message', sender: person, to: [{ name: 'Own', email: `own-${name.toLowerCase()}@example.test` }],
              date: '2026-10-30T00:00:00.000Z', text: `private-${name}`, attachments: [], internetMessageId: '<synthetic@example.test>' }] };
          core.app.store.put('thread', thread.id, thread); core.app.store.updatePreferences({ activeAccountId: 'same-account' });
          core.app.store.saveDraft({ id: 'same-draft', accountId: 'same-account', to: 'recipient@example.test', subject: `Private draft ${name}`, body: 'Synthetic only.' });
          return withAuthenticatedDispatch(core, log, context.lease, { preflightBody: (body, scope) => context.runNative(() => authenticatedBodies.readRequestBody(body, scope)) });
        }) });
      actors.set(name, actor);
    }
    const byTenant = new Map([...configs.values()].map(value => [value.binding.tenantId, value]));
    const directory = new GatewayTenantDirectory(assignment => { factoryCalls.push(assignment.tenantId); const selected = byTenant.get(assignment.tenantId);
      if (!selected) throw Error('synthetic_unprovisioned_runtime'); return new AuthenticatedTenantTransport({ ...selected, binding: assignment }); });
    const handle = createAuthenticatedGateway({ sql, sessions, login: broker('login'), directory,
      ...(options.proof ? { proof: { broker: broker('owner-identity-proof'), authorize: async request => request.headers['x-fixture-operator'] === 'allowed' } } : {}),
      bridgeDeadlineMs: 500, bridgePollMs: 2 });
    gateway = createServer((request, response) => { void handle(request, response); });
    await new Promise<void>((resolve, reject) => { gateway!.once('error', reject); gateway!.listen(0, '127.0.0.1', resolve); });
    const address = gateway.address(); assert.ok(address && typeof address !== 'string'); gatewayPort = address.port; allowGatewayPort(gatewayPort);
    timer = setInterval(() => { if (pumpEnabled) for (const actor of actors.values()) void actor.pumpOnce().catch(error => pumpErrors.push(error)); }, 2);
    const req = (path: string, input: HttpInput = {}): Promise<HttpResult> => new Promise((resolve, reject) => {
      const method = input.method ?? 'GET', bytes = input.rawBytes ?? (input.body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(input.body)));
      const request = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path, method, agent: false, signal: AbortSignal.timeout(5000),
        headers: { host: 'mail.example.test', ...(!input.omitOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { origin } : {}),
          ...(input.body === undefined && input.rawBytes === undefined ? {} : { 'content-type': 'application/json' }), ...input.headers } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.once('error', reject); response.once('end', () => {
          const bytes = Buffer.concat(chunks); let body: unknown = null; try { body = JSON.parse(bytes.toString()); } catch { body = bytes.toString(); }
          resolve({ status: response.statusCode!, body, headers: response.headers, bytes });
        });
      }); request.once('error', reject); request.end(bytes);
    });
    const login = async (name: 'A' | 'B' = 'A', previous?: SessionFixture): Promise<SessionFixture> => {
      const browser = await req('/api/_rea/auth/browser', { headers: previous ? { cookie: previous.cookie } : {} }); assert.equal(browser.status, 200);
      const browserCookie = cookie(browser.headers['set-cookie']?.[0]);
      const currentCookie = previous ? `${browserCookie}; ${previous.cookie.split('; ').find(p => p.startsWith('__Host-rea_session='))}` : browserCookie;
      const started = await req('/api/_rea/auth/login', { method: 'POST', body: { version: 1 }, headers: { cookie: currentCookie, 'x-rea-csrf': browser.body.csrfToken } });
      assert.equal(started.status, 200);
      const registered = provider.registerAuthorization(started.body.authorizationUrl, { subject: `Subject-${name}` });
      const callback = await req(`/api/auth/google/callback?${new URLSearchParams({ code: registered.code, state: registered.state, scope: 'openid email', authuser: '0', hd: 'ignored.example.test', prompt: 'consent' })}`,
        { headers: { cookie: currentCookie, 'sec-fetch-site': 'cross-site' } });
      assert.equal(callback.status, 303); assert.equal(callback.headers.location, '/');
      const appCookie = cookie(callback.headers['set-cookie']?.[0]), header = `${browserCookie}; ${appCookie}`;
      const session = await req('/api/_rea/auth/session', { headers: { cookie: header } }); assert.equal(session.status, 200);
      return { cookie: header, ...session.body };
    };
    return { sql, raw, auth, registry, sessions, actors, cores, configs, provider, blob, fakeObjects, blobCalls, coreCalls, factoryCalls, pumpErrors, req, login, close,
      failNextSidecar() { failSidecar = true; }, advance(ms: number) { offset += ms; }, setPump(value: boolean) { pumpEnabled = value; },
      setAuthUnavailable(value: boolean) { failSessionReads = value; },
      as(session: SessionFixture, path: string, input: HttpInput = {}) { return req(path, { ...input, headers: { cookie: session.cookie, 'x-rea-csrf': session.csrfToken, ...input.headers } }); } };
  } catch (error) { await close(); throw error; }
}
