import { request as httpRequest, type ClientRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../api/src/server.ts';
import type { SqlDatabaseFactory } from '../../api/src/sql-database.ts';
import type { ProviderDraftTransport } from '../../api/src/provider-draft-transport.ts';
import { loadAutoDraftRuntimeConfiguration } from '../../api/src/auto-drafts-runtime-configuration.ts';
import { loadTrackingRuntimeConfiguration } from '../../api/src/tracking-runtime-config.ts';
import type { ActorContext, ActorCore } from './actor.ts';
import type { CommandRequest, CommandResponse } from './command-log.ts';
import type { PrivateBodyTransport } from './blob-transport.ts';
import type { CoreStartupStage } from './startup-diagnostic.ts';

type TestOverrides = Pick<NonNullable<Parameters<typeof createApp>[0]>, 'seed' | 'runJobs' | 'scheduler' | 'undoWindowMs' | 'providerDraftTransport' | 'providerDraftAutomatic'>;
export type LoopbackCoreOptions = {
  context: ActorContext; namespace: string; env: NodeJS.ProcessEnv; databasePath: string; databaseFactory: SqlDatabaseFactory;
  bodies: Pick<PrivateBodyTransport, 'readRequestBody' | 'writeResponseBody'>;
  maxInlineBytes?: number; maxResponseBytes?: number; transport?: typeof fetch;
  onStartupStage?: (stage: CoreStartupStage) => void;
  /** Trusted construction seam for isolated tests; the production worker does not supply overrides. */
  overrides?: TestOverrides;
};
function transport(context: ActorContext, fetcher: typeof fetch): typeof fetch {
  return ((input, init) => context.runNative(() => fetcher(input, init))) as typeof fetch;
}
function providerTransport(context: ActorContext, port: ProviderDraftTransport | undefined): ProviderDraftTransport | undefined {
  if (!port) return undefined;
  return { ready(account) { context.assertLocal(); port.ready(account); },
    profile: (...args) => context.runNative(() => port.profile(...args)), create: (...args) => context.runNative(() => port.create(...args)),
    update: (...args) => context.runNative(() => port.update(...args)), get: (...args) => context.runNative(() => port.get(...args)),
    list: (...args) => context.runNative(() => port.list(...args)), metadata: (...args) => context.runNative(() => port.metadata(...args)),
    delete: (...args) => context.runNative(() => port.delete(...args)),
  };
}
const unavailable = (): CommandResponse => ({ status: 503, headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { kind: 'inline', base64: Buffer.from(JSON.stringify({ error: { code: 'worker_draining', message: 'The mail worker is updating. Check the existing request status.' } })).toString('base64') } });

/** The real Core listens only on an ephemeral loopback port inside the Daemon.
 * Standard Node HTTP carries cookies/binary bytes; no fake ServerResponse is used. */
export class LoopbackCoreAdapter implements ActorCore {
  readonly app: ReturnType<typeof createApp>;
  readonly port: number;
  private readonly options: LoopbackCoreOptions;
  private readonly inlineLimit: number;
  private readonly responseLimit: number;
  private admitting = true;
  private largeTail: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private constructor(options: LoopbackCoreOptions, app: ReturnType<typeof createApp>, port: number) {
    this.options = options; this.app = app; this.port = port;
    this.inlineLimit = options.maxInlineBytes ?? 1_000_000; this.responseLimit = options.maxResponseBytes ?? 64 * 1024 ** 2;
  }
  static async create(options: LoopbackCoreOptions): Promise<LoopbackCoreAdapter> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.namespace) || options.env.DATABASE_PATH !== options.databasePath ||
        typeof options.databaseFactory !== 'function' || options.onStartupStage !== undefined && typeof options.onStartupStage !== 'function' || !Number.isSafeInteger(options.maxInlineBytes ?? 1_000_000) ||
        (options.maxInlineBytes ?? 1_000_000) < 1 || (options.maxInlineBytes ?? 1_000_000) > 3_000_000 ||
        !Number.isSafeInteger(options.maxResponseBytes ?? 64 * 1024 ** 2) || (options.maxResponseBytes ?? 64 * 1024 ** 2) < 1 ||
        (options.maxResponseBytes ?? 64 * 1024 ** 2) > 128 * 1024 ** 2) throw new TypeError('Invalid worker Core configuration');
    options.context.assertLocal();
    const observe = (stage: CoreStartupStage) => { try { options.onStartupStage?.(stage); } catch {} };
    const fenced = transport(options.context, options.transport ?? fetch);
    observe('tracking-config');
    const collector = loadTrackingRuntimeConfiguration(options.env, fenced);
    let automatic: ReturnType<typeof loadAutoDraftRuntimeConfiguration> | undefined, app: ReturnType<typeof createApp> | undefined;
    try {
      observe('auto-draft-config');
      automatic = loadAutoDraftRuntimeConfiguration(options.env, { modelFetch: fenced });
      observe('app-construction');
      app = createApp({ ...options.overrides, databasePath: options.databasePath, databaseFactory: options.databaseFactory, env: options.env,
        ownerLiveness(localRegistered) { options.context.assertLocal(); return localRegistered; },
        aiFetch: fenced, trackingCollector: collector,
        autoDraftGeneration: automatic.generation ? { ...automatic.generation, googleFetch: fenced } : undefined,
        providerDraftTransport: providerTransport(options.context, options.overrides?.providerDraftTransport),
      });
    } finally { collector?.key.fill(0); automatic?.clear(); }
    observe('loopback-listen');
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { app!.server.removeListener('listening', ready); reject(error); };
        const ready = () => { app!.server.removeListener('error', failed); resolve(); };
        app!.server.once('error', failed); app!.server.once('listening', ready); app!.server.listen(0, '127.0.0.1');
      });
      const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Worker Core did not bind loopback');
      return new LoopbackCoreAdapter(options, app, (address as AddressInfo).port);
    } catch (error) { await app.close().catch(() => {}); throw error; }
  }
  private async large<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.largeTail; let release!: () => void;
    this.largeTail = new Promise<void>(resolve => { release = resolve; });
    await previous; try { return await work(); } finally { release(); }
  }
  dispatch(input: CommandRequest, command: { id: string; sequence: number }): Promise<CommandResponse> {
    const large = input.body.kind === 'blob' || input.method === 'GET' && /(?:\/attachments\/[^/?]+|\/download)(?:\?|$)/.test(input.path);
    return large ? this.large(() => this.perform(input, command)) : this.perform(input, command);
  }
  private async perform(input: CommandRequest, command: { id: string; sequence: number }): Promise<CommandResponse> {
    if (!this.admitting) return unavailable(); this.options.context.assertLocal();
    const scope = { namespace: this.options.namespace, commandId: command.id, method: input.method, path: input.path };
    const bytes = input.body.kind === 'inline' ? Buffer.from(input.body.base64, 'base64')
      : await this.options.context.runNative(() => this.options.bodies.readRequestBody(input.body as Extract<CommandRequest['body'], { kind: 'blob' }>, scope));
    if (!this.admitting) return unavailable();
    const result = await new Promise<{ status: number; headers: Record<string, string | string[]>; bytes: Buffer }>((resolve, reject) => {
      let client: ClientRequest;
      try {
        // A synchronous Core burst can outlive an idle keep-alive socket. Each
        // admitted command gets one fresh local connection; never replay it.
        client = httpRequest({ agent: false, hostname: '127.0.0.1', port: this.port, method: input.method, path: input.path,
          headers: { ...input.headers, host: `127.0.0.1:${this.port}`, 'content-length': bytes.byteLength } }, response => {
          const declared = response.headers['content-length'];
          if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > this.responseLimit)) { response.destroy(); reject(new Error('Worker response exceeds the transfer limit')); return; }
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', (chunk: Buffer) => { size += chunk.byteLength; if (size > this.responseLimit) { response.destroy(); reject(new Error('Worker response exceeds the transfer limit')); } else chunks.push(Buffer.from(chunk)); });
          response.once('error', reject); response.once('end', () => {
            const headers: Record<string, string | string[]> = {};
            for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key] = value;
            resolve({ status: response.statusCode ?? 500, headers, bytes: Buffer.concat(chunks, size) });
          });
        });
        client.once('error', reject); client.end(bytes);
      } catch (error) { reject(error); }
    });
    const body = result.bytes.byteLength <= this.inlineLimit ? { kind: 'inline' as const, base64: result.bytes.toString('base64') }
      : await this.options.context.runNative(() => this.options.bodies.writeResponseBody(scope, result.bytes));
    return { status: result.status, headers: result.headers, body };
  }
  beginQuiesce(): void | Promise<void> { this.admitting = false; return this.app.beginQuiesce(); }
  quiesce(): Promise<void> { this.admitting = false; return this.app.quiesce(); }
  close(): Promise<void> { this.admitting = false; this.closing ??= this.app.close(); return this.closing; }
}
