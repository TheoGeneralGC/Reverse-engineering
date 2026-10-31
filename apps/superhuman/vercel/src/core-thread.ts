import { Worker } from 'node:worker_threads';
import type { ActorContext, ActorCore } from './actor.ts';
import type { CommandRequest, CommandResponse } from './command-log.ts';
import type { PrivateBodyTransport } from './blob-transport.ts';
import type { CoreStartupStage } from './startup-diagnostic.ts';
import { googleOAuthCallbackDiagnostic, writeGoogleOAuthCallbackDiagnostic } from '../../api/src/google-oauth-diagnostic.ts';
import { CORE_THREAD_VERSION, CoreThreadError, blobBody, bodyScope, bootstrap, byteArray, commandRequest, commandResponse,
  errorCode, exact, fingerprint, projectedError, record, serial, startupStage, type SqlFingerprint, type ThreadConfiguration, type ThreadOperation } from './core-thread-protocol.ts';

export type CoreThreadOptions = {
  context: ActorContext; configuration: Omit<ThreadConfiguration, 'lease'>;
  bodies: Pick<PrivateBodyTransport, 'readRequestBody' | 'writeResponseBody'>;
  onStartupStage?: (stage: CoreStartupStage) => void; onStartupSqlFingerprint?: (fingerprint: SqlFingerprint) => void;
  /** Trusted test construction seam; production uses the fixed local entrypoint. */
  workerURL?: URL; startupTimeoutMs?: number;
};
type Pending = { operation: ThreadOperation; resolve: (response?: CommandResponse) => void; reject: (error: Error) => void };
type Native = { finish: () => void; reject: (error: Error) => void; finished: boolean; granted: boolean };
const unavailable = (): CommandResponse => ({ status: 503, headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { kind: 'inline', base64: Buffer.from(JSON.stringify({ error: { code: 'worker_draining', message: 'The mail worker is updating. Check the existing request status.' } })).toString('base64') } });

/** Only asynchronous Control/authority/Blob work runs here. Synchronous Core SQL
 * executes in the owned thread, behind a parent-revocable shared fence. */
export class ThreadedCoreAdapter implements ActorCore {
  readonly failure: Promise<never>;
  private readonly worker: Worker;
  private readonly options: CoreThreadOptions;
  private readonly fence = new Int32Array(new SharedArrayBuffer(4));
  private readonly pending = new Map<number, Pending>();
  private readonly native = new Map<number, Native>();
  private readonly bodies = new Set<number>();
  private readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private failureReject!: (error: Error) => void;
  private readonly exited: Promise<void>;
  private exitResolve!: () => void;
  private failed?: CoreThreadError;
  private sequence = 0;
  private nativeSequence = 0;
  private bodySequence = 0;
  private oauthDiagnostics = 0;
  private isReady = false;
  private admitting = true;
  private closeAcknowledged = false;
  private expectExit = false;
  private hasExited = false;
  private beginning?: Promise<void>;
  private quiescing?: Promise<void>;
  private closing?: Promise<void>;

  private constructor(options: CoreThreadOptions) {
    this.options = options;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.failure = new Promise<never>((_, reject) => { this.failureReject = reject; });
    // Failure can race startup/actor binding; preserve it without an unhandled rejection.
    void this.failure.catch(() => {});
    this.exited = new Promise(resolve => { this.exitResolve = resolve; });
    Atomics.store(this.fence, 0, 1);
    const configuration = { ...options.configuration, env: { ...options.configuration.env }, lease: { ...options.context.lease } };
    const data = { version: CORE_THREAD_VERSION, configuration, fence: this.fence.buffer };
    if (!bootstrap(data)) throw new TypeError('Invalid isolated Core configuration');
    options.context.assertLocal();
    this.worker = new Worker(options.workerURL ?? new URL('./core-thread-entry.ts', import.meta.url), {
      workerData: data, execArgv: ['--experimental-strip-types'], stdout: true, stderr: true,
      // App configuration is explicit workerData. Do not inherit Control tokens or
      // unrelated parent environment into the thread's ambient process.env.
      env: { NODE_ENV: 'production', ...Object.fromEntries(['TZ', 'LANG', 'LC_ALL'].flatMap(key => typeof configuration.env[key] === 'string' ? [[key, configuration.env[key]!]] : [])), ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}) },
    });
    // Never forward arbitrary Core/native stdout, exception stacks or secrets to product logs.
    this.worker.stdout?.resume(); this.worker.stderr?.resume();
    this.worker.on('message', message => { void this.receive(message).catch(() => { this.fail('core_thread_protocol_invalid'); }); });
    this.worker.on('messageerror', () => { this.fail('core_thread_protocol_invalid'); });
    this.worker.on('error', () => { this.fail('core_thread_failure'); });
    this.worker.on('exit', code => {
      this.hasExited = true;
      if (!this.failed && !(code === 0 && this.expectExit && this.closeAcknowledged && this.pending.size === 0 && this.native.size === 0 && this.bodies.size === 0)) this.fail('core_thread_exited');
      this.exitResolve();
    });
  }
  static async create(options: CoreThreadOptions): Promise<ThreadedCoreAdapter> {
    const timeoutMs = options.startupTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new TypeError('Invalid Core startup deadline');
    const adapter = new ThreadedCoreAdapter(options);
    const timer = setTimeout(() => { adapter.fail('core_thread_start_failed'); }, timeoutMs);
    try { await adapter.ready; if (adapter.failed) throw adapter.failed; return adapter; }
    finally { clearTimeout(timer); }
  }
  /** Authority loss closes the SQL/native frontier synchronously, before any IO. */
  revokeAuthority(): void { this.fail('core_thread_authority_lost'); }
  private fail(code: string): void {
    if (this.failed) return;
    Atomics.store(this.fence, 0, 0); Atomics.notify(this.fence, 0);
    this.admitting = false; this.failed = new CoreThreadError(code);
    this.readyReject(this.failed); this.failureReject(this.failed);
    for (const pending of this.pending.values()) pending.reject(this.failed); this.pending.clear();
    for (const native of this.native.values()) native.reject(this.failed);
    // Termination is an uncertain failure, never a quiesced handoff. Already-issued
    // provider work keeps its durable issued/unknown evidence; it is not replayed.
    if (!this.hasExited) void this.worker.terminate().catch(() => {});
  }
  private send(message: object, transfer: ArrayBuffer[] = []): void {
    if (this.failed || this.hasExited) throw this.failed ?? new CoreThreadError('core_thread_exited');
    try { this.worker.postMessage(message, transfer); } catch { this.fail('core_thread_protocol_invalid'); throw this.failed!; }
  }
  private request(operation: ThreadOperation, extra: object = {}): Promise<CommandResponse | undefined> {
    if (this.failed) return Promise.reject(this.failed);
    if (!this.isReady || this.hasExited || this.pending.size >= 256 || !Number.isSafeInteger(this.sequence + 1)) return Promise.reject(new CoreThreadError('core_thread_protocol_invalid'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => { this.pending.set(id, { operation, resolve, reject });
      try { this.send({ kind: 'request', id, operation, ...extra }); } catch (error) { this.pending.delete(id); reject(error); } });
  }
  dispatch(request: CommandRequest, command: { id: string; sequence: number }): Promise<CommandResponse> {
    if (this.failed) return Promise.reject(this.failed);
    if (!this.admitting) return Promise.resolve(unavailable());
    if (!commandRequest(request) || !record(command) || !exact(command, ['id', 'sequence']) || typeof command.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(command.id) || !serial(command.sequence)) return Promise.reject(new CoreThreadError('core_thread_protocol_invalid'));
    this.options.context.assertLocal();
    return this.request('dispatch', { request, command }).then(response => { if (!response) throw new CoreThreadError('core_thread_protocol_invalid'); return response; });
  }
  beginQuiesce(): Promise<void> {
    this.admitting = false;
    return this.beginning ??= this.request('begin-quiesce').then(() => {});
  }
  quiesce(): Promise<void> { return this.quiescing ??= this.beginQuiesce().then(() => this.request('quiesce')).then(() => {}); }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      await this.quiesce(); this.expectExit = true;
      await this.request('close'); await this.exited;
      if (this.failed || !this.closeAcknowledged) throw this.failed ?? new CoreThreadError('core_thread_exited');
      Atomics.store(this.fence, 0, 0);
    })();
  }
  private async receive(value: unknown): Promise<void> {
    if (this.failed) return;
    if (!record(value) || typeof value.kind !== 'string') throw new CoreThreadError('core_thread_protocol_invalid');
    if (value.kind === 'ready' && exact(value, ['kind']) && !this.isReady && !this.expectExit) { this.isReady = true; this.readyResolve(); return; }
    if (value.kind === 'fatal' && exact(value, ['kind', 'code']) && errorCode(value.code)) { this.fail(value.code); return; }
    if (value.kind === 'startup-stage' && exact(value, ['kind', 'stage']) && !this.isReady && startupStage(value.stage)) { try { this.options.onStartupStage?.(value.stage); } catch {} return; }
    if (value.kind === 'startup-sql' && exact(value, ['kind', 'fingerprint']) && !this.isReady && fingerprint(value.fingerprint)) { try { this.options.onStartupSqlFingerprint?.(value.fingerprint); } catch {} return; }
    // Observations cannot resolve work or change authority, even when malformed.
    if (value.kind === 'oauth-callback-failure') {
      if (this.isReady && this.oauthDiagnostics < 32) {
        this.oauthDiagnostics++;
        if (exact(value, ['kind', 'diagnostic']) && googleOAuthCallbackDiagnostic(value.diagnostic)) writeGoogleOAuthCallbackDiagnostic(value.diagnostic);
      }
      return;
    }
    if (value.kind === 'response' && serial(value.id) && typeof value.ok === 'boolean') {
      const pending = this.pending.get(value.id);
      if (!pending) throw new CoreThreadError('core_thread_protocol_invalid');
      if (value.ok && exact(value, ['kind', 'id', 'ok'], ['response']) && (pending.operation === 'dispatch' ? commandResponse(value.response) : value.response === undefined)) {
        this.pending.delete(value.id); if (pending.operation === 'close') this.closeAcknowledged = true; pending.resolve(value.response as CommandResponse | undefined); return;
      }
      if (!value.ok && exact(value, ['kind', 'id', 'ok', 'code']) && errorCode(value.code)) { this.pending.delete(value.id); pending.reject(new CoreThreadError(value.code)); return; }
      throw new CoreThreadError('core_thread_protocol_invalid');
    }
    if (value.kind === 'native-begin' && exact(value, ['kind', 'id']) && serial(value.id) && value.id === this.nativeSequence + 1 && this.native.size < 256) {
      this.nativeSequence = value.id; const id = value.id;
      let finish!: () => void, reject!: (error: Error) => void;
      const completed = new Promise<void>((resolve, no) => { finish = resolve; reject = no; });
      void completed.catch(() => {});
      this.native.set(id, { finish, reject, finished: false, granted: false });
      // Registration is synchronous in ActorContext.runNative, before its first
      // authority await. The grant is sent only inside that registered callback.
      const work = this.options.context.runNative(async () => { const entry = this.native.get(id); if (!entry || entry.finished) throw new CoreThreadError('core_thread_protocol_invalid'); entry.granted = true; this.send({ kind: 'native-permit', id }); await completed; });
      void work.then(() => { this.native.delete(id); if (!this.failed) this.send({ kind: 'native-release', id }); }, error => {
        this.native.delete(id); this.fail(projectedError(error));
      }).catch(() => { this.fail('core_thread_protocol_invalid'); });
      return;
    }
    if (value.kind === 'native-finished' && exact(value, ['kind', 'id']) && serial(value.id)) {
      const native = this.native.get(value.id); if (!native || native.finished || !native.granted) throw new CoreThreadError('core_thread_protocol_invalid');
      native.finished = true; native.finish(); return;
    }
    if (['body-read', 'body-write'].includes(value.kind) && serial(value.id) && value.id === this.bodySequence + 1 && this.bodies.size < 64 && bodyScope(value.scope, this.options.configuration.namespace)) {
      const read = value.kind === 'body-read';
      if (read ? !exact(value, ['kind', 'id', 'nativeId', 'scope', 'body']) || !blobBody(value.body) : !exact(value, ['kind', 'id', 'nativeId', 'scope', 'bytes']) || !byteArray(value.bytes)) throw new CoreThreadError('core_thread_protocol_invalid');
      const native = serial(value.nativeId) ? this.native.get(value.nativeId) : undefined; if (!native?.granted || native.finished) throw new CoreThreadError('core_thread_protocol_invalid');
      this.bodySequence = value.id; const id = value.id; this.bodies.add(id);
      try {
        this.options.context.assertLocal();
        if (read) {
          const result = await this.options.bodies.readRequestBody(value.body as Parameters<PrivateBodyTransport['readRequestBody']>[0], value.scope);
          if (!byteArray(result)) throw new CoreThreadError('core_thread_protocol_invalid');
          const copy = new Uint8Array(result); this.send({ kind: 'body-result', id, ok: true, bytes: copy }, [copy.buffer]);
        } else {
          const result = await this.options.bodies.writeResponseBody(value.scope, Buffer.from(value.bytes as Uint8Array));
          if (!blobBody(result)) throw new CoreThreadError('core_thread_protocol_invalid');
          this.send({ kind: 'body-result', id, ok: true, body: result });
        }
      } catch (error) { if (!this.failed) this.send({ kind: 'body-result', id, ok: false, code: projectedError(error) }); }
      finally { this.bodies.delete(id); }
      return;
    }
    throw new CoreThreadError('core_thread_protocol_invalid');
  }
}
