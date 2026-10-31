// Trusted fictional Core. Deny every foreign transport before importing it.
import { parentPort, workerData } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls';
let denied = 0;
const deny = () => { denied++; throw Error('fictional_external_transport_denied'); };
const loopback = (value: unknown) => value === '127.0.0.1';
function host(args: unknown[]): unknown {
  let first = args[0]; if (Array.isArray(first)) first = first[0];
  if (first && typeof first === 'object') return (first as { hostname?: unknown; host?: unknown }).hostname ?? (first as { host?: unknown }).host;
  if (typeof first === 'number') return args[1]; return undefined;
}
for (const module of [http, https]) for (const key of ['request', 'get'] as const) {
  const original = module[key]; module[key] = function (this: unknown, ...args: unknown[]) { if (!loopback(host(args))) return deny(); return Reflect.apply(original, this, args); } as typeof module[typeof key];
}
globalThis.fetch = async () => deny();
for (const [module, key] of [[net, 'connect'], [net, 'createConnection'], [tls, 'connect']] as const) {
  const original = (module as unknown as Record<string, (...args: unknown[]) => unknown>)[key]!; (module as unknown as Record<string, unknown>)[key] = function (this: unknown, ...args: unknown[]) { if (!loopback(host(args))) return deny(); return Reflect.apply(original, this, args); };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) { if (!loopback(host(args))) return deny(); return Reflect.apply(connect, this, args); } as typeof net.Socket.prototype.connect;
syncBuiltinESMExports();
const { DatabaseSync } = await import('node:sqlite');
const { serveCoreThread } = await import('../src/core-thread-entry.ts');
const { LoopbackCoreAdapter } = await import('../src/core-adapter.ts');
const { CALENDAR_REQUEST_SCOPES } = await import('../../api/src/google-scopes.ts');
if (!parentPort || workerData.configuration.databaseUrl !== ':memory:' || workerData.configuration.env.DATABASE_PATH !== ':memory:') throw Error('Explicit memory fixture required');
const port = parentPort, configuration = workerData.configuration;
await serveCoreThread(port, workerData, async ({ context, bodies, oauth, stage }) => {
  let calls = 0;
  const core = await LoopbackCoreAdapter.create({ context, bodies, namespace: configuration.namespace, env: configuration.env, databasePath: ':memory:', googleOAuthDiagnostic: oauth, onStartupStage: stage,
    databaseFactory(path) { if (path !== ':memory:') throw Error('Explicit memory fixture required'); return new DatabaseSync(path); },
    overrides: { seed: true, runJobs: false, providerDraftAutomatic: false },
    transport: (async input => {
      calls++;
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fictional-calendar', refresh_token: 'fictional-calendar-refresh', expires_in: 3600, scope: CALENDAR_REQUEST_SCOPES.join(' ') });
      if (String(input) !== 'https://openidconnect.googleapis.com/v1/userinfo') return deny();
      return new Response('PRIVATE_FICTIONAL_USERINFO_BODY');
    }) as typeof fetch,
  });
  const accountId = 'google:owner@example.test';
  core.app.store.put('account', accountId, { id: accountId, name: 'Owner', email: 'owner@example.test', color: '#888', provider: 'google' });
  core.app.google.saveTokens(accountId, { access_token: 'fictional-mail', refresh_token: 'fictional-mail-refresh', expires_at: Date.now() + 3600_000 });
  const mailCiphertext = core.app.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value;
  const close = core.close.bind(core), dispatch = core.dispatch.bind(core);
  core.close = async () => {
    if (denied || calls !== 2 || core.app.store.db.prepare('SELECT count(*) AS n FROM oauth_states').get()!.n !== 0 ||
        core.app.store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='googleGrant'").get()!.n !== 0 ||
        core.app.store.db.prepare('SELECT count(*) AS n FROM secrets WHERE account_id=?').get(`calendar:${accountId}`)!.n !== 0 ||
        core.app.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value !== mailCiphertext) throw Error('Fictional callback preservation mismatch');
    await close();
  };
  core.dispatch = async (request, command) => {
    if (request.path.startsWith('/api/auth/google/callback')) {
      console.error('PRIVATE_CHILD_STDERR_MARKER');
      if (configuration.env.FIXTURE_MODE === 'malformed') {
        port.postMessage({ kind: 'oauth-callback-failure', diagnostic: { event: 'google_oauth_callback_failed', phase: 'PRIVATE_PHASE', errorClass: 'Error' } });
        port.postMessage({ kind: 'oauth-callback-failure', diagnostic: { event: 'google_oauth_callback_failed', phase: 'calendar-begin', errorClass: 'Error', private: 'PRIVATE_EXTRA' } });
      }
      if (configuration.env.FIXTURE_MODE === 'flood') for (let i = 0; i < 40; i++) port.postMessage({ kind: 'oauth-callback-failure', diagnostic: { event: 'google_oauth_callback_failed', phase: 'calendar-begin', errorClass: 'Error' } });
    }
    return dispatch(request, command);
  };
  return core;
});
