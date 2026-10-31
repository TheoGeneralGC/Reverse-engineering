import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { isMainThread, parentPort, workerData, type MessagePort } from 'node:worker_threads';
import type { ActorContext, ActorCore } from './actor.ts';
import { LoopbackCoreAdapter } from './core-adapter.ts';
import { createLibsqlPrimaryFactory } from './sql.ts';
import { CoreThreadError, blobBody, bodyScope, bootstrap, byteArray, commandRequest, commandResponse, errorCode, exact, name,
  projectedError, record, serial, type BlobBody, type BodyScope, type SqlFingerprint, type ThreadBootstrap } from './core-thread-protocol.ts';
import type { CoreStartupStage } from './startup-diagnostic.ts';
import { googleOAuthCallbackDiagnostic, type GoogleOAuthCallbackDiagnostic } from '../../api/src/google-oauth-diagnostic.ts';

export type ThreadCoreFactory = (options: { context: ActorContext; bodies: {
  readRequestBody: (body: BlobBody, scope: BodyScope) => Promise<Buffer>;
  writeResponseBody: (scope: BodyScope, bytes: Buffer) => Promise<BlobBody>;
}; oauth: (diagnostic: GoogleOAuthCallbackDiagnostic) => void; stage: (stage: CoreStartupStage) => void; sql: (kind: SqlFingerprint['kind'], text: string) => void }) => Promise<ActorCore>;

/** Exported only as a trusted isolated-test construction seam. The production
 * entrypoint below always chooses the validated remote-primary factory. */
export async function serveCoreThread(port: MessagePort, data: unknown, createCore: ThreadCoreFactory): Promise<void> {
  if (!bootstrap(data)) { port.postMessage({ kind: 'fatal', code: 'core_thread_start_failed' }); port.close(); return; }
  const selected: ThreadBootstrap = data, fence = new Int32Array(selected.fence), configuration = selected.configuration;
  let core: ActorCore | undefined, failed = false, ready = false, closed = false, closing = false, requestSequence = 0, nativeSequence = 0, bodySequence = 0;
  const nativeScope = new AsyncLocalStorage<number>();
  const requests = new Set<number>();
  const native = new Map<number, { stage: 'waiting' | 'running' | 'finished'; permit: () => void; release: () => void; reject: (error: Error) => void }>();
  const bodies = new Map<number, { read: boolean; resolve: (value: Buffer | BlobBody) => void; reject: (error: Error) => void }>();
  const assertLocal = () => { if (failed || closed || Atomics.load(fence, 0) !== 1) throw new CoreThreadError('core_thread_authority_lost'); };
  const send = (message: object, transfer: ArrayBuffer[] = []) => { port.postMessage(message, transfer); };
  let oauthDiagnostics = 0;
  const oauth = (diagnostic: GoogleOAuthCallbackDiagnostic) => {
    try { if (ready && !closed && oauthDiagnostics < 32 && googleOAuthCallbackDiagnostic(diagnostic)) { oauthDiagnostics++; send({ kind: 'oauth-callback-failure', diagnostic }); } } catch {}
  };
  const fatal = (error: unknown) => {
    if (failed || closed) return; failed = true; Atomics.store(fence, 0, 0);
    const selectedError = new CoreThreadError(projectedError(error));
    for (const pending of native.values()) pending.reject(selectedError);
    for (const pending of bodies.values()) pending.reject(selectedError);
    try { send({ kind: 'fatal', code: selectedError.code }); } catch {}
    // This cleanup cannot authorize a handoff: parent treats fatal/exit as uncertain.
    void Promise.resolve().then(() => core?.close()).catch(() => {});
  };
  const context: ActorContext = Object.freeze({ lease: Object.freeze({ ...configuration.lease }), assertLocal,
    async runNative<T>(operation: () => Promise<T>): Promise<T> {
      assertLocal(); if (typeof operation !== 'function' || native.size >= 256 || !serial(nativeSequence + 1)) throw new CoreThreadError('core_thread_protocol_invalid');
      const id = ++nativeSequence;
      let permit!: () => void, release!: () => void, rejectPermit!: (error: Error) => void, rejectRelease!: (error: Error) => void;
      const permission = new Promise<void>((resolve, reject) => { permit = resolve; rejectPermit = reject; });
      const released = new Promise<void>((resolve, reject) => { release = resolve; rejectRelease = reject; });
      void permission.catch(() => {}); void released.catch(() => {});
      native.set(id, { stage: 'waiting', permit, release, reject(error) { rejectPermit(error); rejectRelease(error); } });
      try {
        send({ kind: 'native-begin', id }); await permission;
        // No await separates this check from invoking the actual operation.
        assertLocal(); const selectedNative = native.get(id); if (!selectedNative || selectedNative.stage !== 'running') throw new CoreThreadError('core_thread_protocol_invalid');
        let result!: T, operationError: unknown, operationFailed = false;
        try { result = await nativeScope.run(id, operation); } catch (error) { operationFailed = true; operationError = error; }
        selectedNative.stage = 'finished'; send({ kind: 'native-finished', id }); await released;
        if (operationFailed) throw operationError; return result;
      } finally { native.delete(id); }
    },
  });
  const bodyRequest = (read: boolean, scope: BodyScope, value: BlobBody | Buffer): Promise<Buffer | BlobBody> => {
    assertLocal(); const nativeId = nativeScope.getStore(), selectedNative = nativeId === undefined ? undefined : native.get(nativeId);
    if (!selectedNative || selectedNative.stage !== 'running' || !bodyScope(scope, configuration.namespace) || bodies.size >= 64 || !serial(bodySequence + 1) || (read ? !blobBody(value) : !byteArray(value))) return Promise.reject(new CoreThreadError('core_thread_protocol_invalid'));
    const id = ++bodySequence;
    return new Promise((resolve, reject) => {
      bodies.set(id, { read, resolve, reject });
      if (read) send({ kind: 'body-read', id, nativeId, scope, body: value });
      else { const bytes = new Uint8Array(value as Buffer); send({ kind: 'body-write', id, nativeId, scope, bytes }, [bytes.buffer]); }
    });
  };
  const bodyPort = {
    readRequestBody: (body: BlobBody, scope: BodyScope) => bodyRequest(true, scope, body) as Promise<Buffer>,
    writeResponseBody: (scope: BodyScope, bytes: Buffer) => bodyRequest(false, scope, bytes) as Promise<BlobBody>,
  };
  const receive = async (value: unknown): Promise<void> => {
    if (failed || closed) return;
    if (!record(value) || typeof value.kind !== 'string') throw new CoreThreadError('core_thread_protocol_invalid');
    if (value.kind === 'native-permit' && exact(value, ['kind', 'id']) && serial(value.id)) {
      const selectedNative = native.get(value.id); if (!selectedNative || selectedNative.stage !== 'waiting') throw new CoreThreadError('core_thread_protocol_invalid');
      assertLocal(); selectedNative.stage = 'running'; selectedNative.permit(); return;
    }
    if (value.kind === 'native-release' && exact(value, ['kind', 'id']) && serial(value.id)) {
      const selectedNative = native.get(value.id); if (!selectedNative || selectedNative.stage !== 'finished') throw new CoreThreadError('core_thread_protocol_invalid');
      selectedNative.release(); return;
    }
    if (value.kind === 'native-denied' && exact(value, ['kind', 'id', 'code']) && serial(value.id) && errorCode(value.code)) {
      const selectedNative = native.get(value.id); if (!selectedNative || selectedNative.stage !== 'waiting') throw new CoreThreadError('core_thread_protocol_invalid');
      selectedNative.reject(new CoreThreadError(value.code)); return;
    }
    if (value.kind === 'body-result' && serial(value.id) && typeof value.ok === 'boolean') {
      const pending = bodies.get(value.id); if (!pending) throw new CoreThreadError('core_thread_protocol_invalid');
      if (value.ok && (pending.read ? exact(value, ['kind', 'id', 'ok', 'bytes']) && byteArray(value.bytes) : exact(value, ['kind', 'id', 'ok', 'body']) && blobBody(value.body))) {
        bodies.delete(value.id); pending.resolve(pending.read ? Buffer.from(value.bytes as Uint8Array) : value.body as BlobBody); return;
      }
      if (!value.ok && exact(value, ['kind', 'id', 'ok', 'code']) && errorCode(value.code)) { bodies.delete(value.id); pending.reject(new CoreThreadError(value.code)); return; }
      throw new CoreThreadError('core_thread_protocol_invalid');
    }
    if (value.kind === 'request' && ready && !closing && serial(value.id) && value.id === requestSequence + 1 && typeof value.operation === 'string') {
      const id = value.id, operation = value.operation;
      if (operation === 'dispatch' ? !exact(value, ['kind', 'id', 'operation', 'request', 'command']) || !commandRequest(value.request) || !record(value.command) || !exact(value.command, ['id', 'sequence']) || !name(value.command.id) || !serial(value.command.sequence)
        : !['begin-quiesce', 'quiesce', 'close'].includes(operation) || !exact(value, ['kind', 'id', 'operation'])) throw new CoreThreadError('core_thread_protocol_invalid');
      assertLocal(); requestSequence = id; requests.add(id);
      try {
        if (operation === 'close') {
          closing = true; await core!.close();
          if (requests.size !== 1 || native.size !== 0 || bodies.size !== 0) throw new CoreThreadError('core_thread_protocol_invalid');
          closed = true; send({ kind: 'response', id, ok: true }); port.close(); return;
        }
        let response;
        if (operation === 'dispatch') {
          response = await core!.dispatch(value.request as Parameters<ActorCore['dispatch']>[0], value.command as Parameters<ActorCore['dispatch']>[1]);
          if (!commandResponse(response)) throw new CoreThreadError('core_thread_protocol_invalid');
        } else if (operation === 'begin-quiesce') await core!.beginQuiesce?.();
        else await core!.quiesce();
        send({ kind: 'response', id, ok: true, ...(response ? { response } : {}) });
      } catch (error) {
        if (operation === 'close' || operation === 'quiesce') { fatal(error); return; }
        send({ kind: 'response', id, ok: false, code: projectedError(error) });
      } finally { requests.delete(id); }
      return;
    }
    throw new CoreThreadError('core_thread_protocol_invalid');
  };
  port.on('message', value => { void receive(value).catch(fatal); });
  port.on('messageerror', () => fatal(new CoreThreadError('core_thread_protocol_invalid')));
  port.on('close', () => { if (!closed) fatal(new CoreThreadError('core_thread_exited')); });
  try {
    assertLocal();
    core = await createCore({ context, bodies: bodyPort, oauth,
      stage: stage => { if (!ready) send({ kind: 'startup-stage', stage }); },
      sql: (kind, text) => { assertLocal(); if (!ready) send({ kind: 'startup-sql', fingerprint: { kind, sha256: createHash('sha256').update(text).digest('hex') } }); },
    });
    if (!core || typeof core.dispatch !== 'function' || typeof core.quiesce !== 'function' || typeof core.close !== 'function') throw new CoreThreadError('core_thread_start_failed');
    assertLocal(); ready = true; send({ kind: 'ready' });
  } catch (error) { fatal(error); }
}

if (!isMainThread && parentPort && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void serveCoreThread(parentPort, workerData, async options => {
    const selected = workerData as ThreadBootstrap, configuration = selected.configuration;
    return LoopbackCoreAdapter.create({ context: options.context, bodies: options.bodies, namespace: configuration.namespace,
      env: configuration.env, databasePath: configuration.databaseUrl, onStartupStage: options.stage, googleOAuthDiagnostic: options.oauth,
      databaseFactory: createLibsqlPrimaryFactory({ url: configuration.databaseUrl, authToken: configuration.authToken, journalMode: configuration.journalMode, statementReuse: 'transaction-hot-select-v1',
        beforeOperation: operation => { options.context.assertLocal(); options.sql(operation.kind, operation.sql); } }),
    });
  });
}
