import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActorAuthority, ActorAuthorityError } from './authority.ts';
import { DurableCommandLog } from './command-log.ts';
import { DurableCoreActor, type ActorContext, type ActorCore } from './actor.ts';
import { createLibsqlControl } from './control-libsql.ts';
import { createLibsqlPrimaryFactory } from './sql.ts';
import { PrivateBodyTransport } from './blob-transport.ts';
import { VercelPrivateBlobStore } from './vercel-blob-sdk.ts';
import { LoopbackCoreAdapter } from './core-adapter.ts';

export type WorkerConfiguration = Readonly<{ namespace: string; webOrigin: string; databaseUrl: string; databaseToken: string; controlUrl: string; controlToken: string;
  storeId: string; deploymentId: string; actorId: string; healthPort: number; pollMs: number; acquireMs: number; heartbeatMs: number }>;
const invalid = () => new TypeError('Mail worker configuration is invalid.');
function number(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value !== undefined && !/^[1-9]\d*$/.test(value)) throw invalid();
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid(); return parsed;
}
export function loadWorkerConfiguration(env: Readonly<NodeJS.ProcessEnv>): WorkerConfiguration {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw invalid();
  const namespace = env.MAIL_RUNTIME_NAMESPACE, webOrigin = env.WEB_ORIGIN, databaseUrl = env.TURSO_DATABASE_URL,
    databaseToken = env.TURSO_AUTH_TOKEN, controlUrl = env.CONTROL_TURSO_DATABASE_URL, controlToken = env.CONTROL_TURSO_AUTH_TOKEN, storeId = env.MAIL_PRIVATE_BLOB_STORE_ID, deploymentId = env.VERCEL_DEPLOYMENT_ID;
  if (!namespace || !/^[A-Za-z0-9_-]{1,128}$/.test(namespace) || !webOrigin || !databaseUrl || !databaseToken || !controlUrl || !controlToken || controlUrl === databaseUrl ||
      !storeId || !/^store_[A-Za-z0-9]{16}$/.test(storeId) || !deploymentId || !/^[A-Za-z0-9_-]{1,128}$/.test(deploymentId) ||
      !/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY ?? '')) throw invalid();
  let web: URL; try { web = new URL(webOrigin); } catch { throw invalid(); }
  if (web.protocol !== 'https:' || web.origin !== webOrigin || web.username || web.password || web.port ||
      !web.hostname.includes('.') || env.GOOGLE_REDIRECT_URI !== `${webOrigin}/api/auth/google/callback`) throw invalid();
  // Both factories validate this exact primary identity. Merely loading config
  // must not open any database or trigger a local/replica fallback.
  createLibsqlPrimaryFactory({ url: databaseUrl, authToken: databaseToken });
  createLibsqlPrimaryFactory({ url: controlUrl, authToken: controlToken });
  if (new URL(databaseUrl).hostname === new URL(controlUrl).hostname) throw invalid();
  const heartbeatMs = number(env.MAIL_HEARTBEAT_MS, 10_000, 1000, 60_000);
  return Object.freeze({ namespace, webOrigin, databaseUrl, databaseToken, controlUrl, controlToken, storeId, deploymentId, actorId: randomUUID(),
    healthPort: number(env.MAIL_HEALTH_PORT, 3002, 1024, 65535), pollMs: number(env.MAIL_POLL_MS, 100, 25, 5000),
    acquireMs: number(env.MAIL_ACQUIRE_MS, 1000, 100, 30_000), heartbeatMs });
}

export type WorkerRuntimeOptions = { authority: ActorAuthority; log: DurableCommandLog; actorId: string; deploymentId: string;
  createCore: (context: ActorContext) => Promise<ActorCore> | ActorCore; healthPort?: number; healthHost?: '0.0.0.0' | '127.0.0.1'; pollMs?: number; acquireMs?: number; heartbeatMs?: number;
  housekeeping?: () => Promise<unknown>; housekeepingMs?: number };
export class MailWorkerRuntime {
  readonly health: Server;
  readonly completion: Promise<void>;
  private readonly options: WorkerRuntimeOptions;
  private actor?: DurableCoreActor;
  private stopping = false;
  private phase: 'waiting' | 'active' | 'draining' | 'stopped' | 'uncertain' = 'waiting';
  private wake?: () => void;
  private closing?: Promise<void>;
  private housekeeping?: Promise<void>;
  private constructor(options: WorkerRuntimeOptions, health: Server) {
    this.options = options; this.health = health;
    this.completion = this.loop(); void this.completion.catch(() => {});
  }
  static async start(options: WorkerRuntimeOptions): Promise<MailWorkerRuntime> {
    for (const value of [options.pollMs ?? 100, options.acquireMs ?? 1000, options.heartbeatMs ?? 10_000]) if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) throw new TypeError('Invalid worker interval');
    if (options.housekeeping !== undefined && typeof options.housekeeping !== 'function' || !Number.isSafeInteger(options.housekeepingMs ?? 60_000) || (options.housekeepingMs ?? 60_000) < 1 || (options.housekeepingMs ?? 60_000) > 3600_000) throw new TypeError('Invalid worker housekeeping');
    const port = options.healthPort ?? 3002; if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid worker liveness port');
    if (options.healthHost !== undefined && !['0.0.0.0', '127.0.0.1'].includes(options.healthHost)) throw new TypeError('Invalid worker liveness host');
    let runtime: MailWorkerRuntime | undefined;
    const health = createServer((request, response) => {
      if (request.url !== '/healthz' || !['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(404); response.end(); return; }
      // Process liveness is separate from actor ownership: a new deployment must
      // become healthy while awaiting the old deployment's graceful handoff.
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ alive: true, state: runtime?.phase ?? 'waiting' }));
    });
    try { await new Promise<void>((done, fail) => { health.once('error', fail); health.listen(port, options.healthHost ?? '0.0.0.0', done); });
      await options.authority.initialize(); await options.log.initialize();
      runtime = new MailWorkerRuntime(options, health); return runtime;
    } catch (error) { if (health.listening) await new Promise<void>(done => health.close(() => done())); throw error; }
  }
  get state(): string { return this.phase; }
  get ownsCore(): boolean { return !!this.actor; }
  private pause(milliseconds: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise<void>(resolve => { const timer = setTimeout(() => { this.wake = undefined; resolve(); }, milliseconds);
      this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); }; });
  }
  private async loop(): Promise<void> {
    let nextHeartbeat = Date.now(), nextHousekeeping = Date.now() + (this.options.housekeepingMs ?? 60_000);
    try {
      while (!this.stopping) {
        if (!this.actor) {
          try { this.actor = await DurableCoreActor.start({ authority: this.options.authority, log: this.options.log,
            actorId: this.options.actorId, deploymentId: this.options.deploymentId, createCore: this.options.createCore, initializeControl: false }); this.phase = 'active'; }
          catch (error) { if (!(error instanceof ActorAuthorityError) || error.code !== 'actor_already_owned') throw error;
            this.phase = 'waiting'; await this.pause(this.options.acquireMs ?? 1000); continue; }
        }
        if (this.stopping) break;
        if (this.actor.state !== 'active') throw new ActorAuthorityError('actor_not_quiescent');
        if (Date.now() >= nextHeartbeat) { await this.actor.heartbeat(); nextHeartbeat = Date.now() + (this.options.heartbeatMs ?? 10_000); }
        if (this.options.housekeeping && !this.housekeeping && Date.now() >= nextHousekeeping) {
          nextHousekeeping = Date.now() + (this.options.housekeepingMs ?? 60_000);
          // Cleanup owns its durable releasing marker. Failure retains quota and
          // may be retried next period; it never retries a mail command. Native
          // registration makes graceful actor shutdown drain this task too.
          const work = this.actor.context.runNative(this.options.housekeeping).then(() => {}, () => {}).finally(() => { if (this.housekeeping === work) this.housekeeping = undefined; });
          this.housekeeping = work;
        }
        await this.actor.pumpOnce(); await this.pause(this.options.pollMs ?? 100);
      }
      this.phase = 'draining'; if (this.actor) await this.actor.close(); this.phase = 'stopped';
    } catch (error) { this.phase = 'uncertain'; if (this.actor) await this.options.authority.markUncertain(this.actor.context.lease).catch(() => {}); throw error; }
    finally { if (this.health.listening) await new Promise<void>(done => this.health.close(() => done())); }
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true; this.wake?.(); this.closing = this.completion; return this.closing;
  }
}

export async function startProductionWorker(env: NodeJS.ProcessEnv = process.env): Promise<{ runtime: MailWorkerRuntime; stop: () => Promise<void> }> {
  const configuration = loadWorkerConfiguration(env);
  const sql = createLibsqlControl({ url: configuration.controlUrl, authToken: configuration.controlToken });
  const blob = new VercelPrivateBlobStore({ storeId: configuration.storeId, namespace: configuration.namespace });
  const bodies = new PrivateBodyTransport({ sql, blob, namespace: configuration.namespace });
  const authority = new ActorAuthority(sql, { namespace: configuration.namespace, leaseMs: Math.max(configuration.heartbeatMs * 3, 30_000) });
  const log = new DurableCommandLog(sql, { namespace: configuration.namespace, webOrigin: configuration.webOrigin,
    authorizeBody: async (transaction, request, scope) => { if (request.body.kind !== 'blob') throw invalid(); await bodies.authorizeRequestBody(transaction, request.body, scope); } });
  try {
    await bodies.initialize();
    const runtime = await MailWorkerRuntime.start({ authority, log, actorId: configuration.actorId, deploymentId: configuration.deploymentId,
      healthPort: configuration.healthPort, pollMs: configuration.pollMs, acquireMs: configuration.acquireMs, heartbeatMs: configuration.heartbeatMs,
      housekeeping: () => bodies.cleanup(),
      createCore: context => LoopbackCoreAdapter.create({ context, bodies, namespace: configuration.namespace,
        env: { ...env, DATABASE_PATH: configuration.databaseUrl }, databasePath: configuration.databaseUrl,
        databaseFactory: createLibsqlPrimaryFactory({ url: configuration.databaseUrl, authToken: configuration.databaseToken, beforeOperation: () => context.assertLocal() }),
      }) });
    let stopping: Promise<void> | undefined;
    const stop = () => stopping ??= runtime.stop().finally(() => sql.close());
    void runtime.completion.then(() => sql.close(), () => sql.close()).catch(() => {});
    return { runtime, stop };
  } catch (error) { await sql.close().catch(() => {}); throw error; }
}
/** Production and the owned subprocess fixture use the same signal contract.
 * A second signal never launches a second shutdown; platform hard termination
 * cannot mark authority quiesced and requires independent recovery proof. */
export function attachWorkerShutdown(stop: () => Promise<void>): () => void {
  let closing: Promise<void> | undefined;
  const shutdown = () => { closing ??= Promise.resolve().then(stop); void closing.then(() => { process.exitCode = 0; }, () => {
    console.error('Mail worker shutdown is uncertain.'); process.exitCode = 1;
  }); };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
  return () => { for (const signal of ['SIGINT', 'SIGTERM'] as const) process.off(signal, shutdown); };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startProductionWorker().then(worker => {
    attachWorkerShutdown(worker.stop);
    void worker.runtime.completion.catch(() => { console.error('Mail worker stopped with uncertain ownership.'); process.exit(1); });
  }).catch(() => { console.error('Mail worker setup failed. Check private server configuration.'); process.exit(1); });
}
