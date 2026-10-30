import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ControlSql } from './authority.ts';
import { BlobTransportError, PrivateBodyTransport, type PrivateBlobPort } from './blob-transport.ts';
import { CommandLogError, DurableCommandLog } from './command-log.ts';
import { ControlSqlError, createLibsqlControl } from './control-libsql.ts';
import { createHttpBridge } from './http-bridge.ts';
import { VercelPrivateBlobStore } from './vercel-blob-sdk.ts';

export type FunctionConfiguration = Readonly<{ namespace: string; webOrigin: string; controlUrl: string; controlToken: string; storeId: string }>;
const invalid = () => new TypeError('Mail Function configuration is invalid.');
export function loadFunctionConfiguration(env: Readonly<NodeJS.ProcessEnv>): FunctionConfiguration {
  const namespace = env.MAIL_RUNTIME_NAMESPACE, webOrigin = env.WEB_ORIGIN, controlUrl = env.CONTROL_TURSO_DATABASE_URL,
    controlToken = env.CONTROL_TURSO_AUTH_TOKEN, storeId = env.MAIL_PRIVATE_BLOB_STORE_ID;
  if (env.VERCEL_ENV !== 'production' || !namespace || !/^[A-Za-z0-9_-]{1,128}$/.test(namespace) || !webOrigin ||
      !controlUrl || !controlToken || /[\x00-\x20\x7f]/.test(controlToken) || !storeId || !/^store_[A-Za-z0-9]{16}$/.test(storeId)) throw invalid();
  let web: URL, control: URL;
  try { web = new URL(webOrigin); control = new URL(controlUrl); } catch { throw invalid(); }
  if (web.protocol !== 'https:' || web.origin !== webOrigin || web.username || web.password || web.port || !web.hostname.includes('.') ||
      !['libsql:', 'https:'].includes(control.protocol) || !/^[a-z0-9][a-z0-9-]*\.turso\.io$/.test(control.hostname) ||
      controlUrl !== `${control.protocol}//${control.hostname}` || control.username || control.password || control.port || control.search || control.hash) throw invalid();
  return Object.freeze({ namespace, webOrigin, controlUrl, controlToken, storeId });
}
type FunctionControl = ControlSql & { close(): Promise<void> };
type FunctionBlob = PrivateBlobPort & { privateOrigin: string };
export type FunctionRuntimeOptions = {
  env: Readonly<NodeJS.ProcessEnv>;
  createControl?: (configuration: FunctionConfiguration) => FunctionControl;
  createBlob?: (configuration: FunctionConfiguration) => FunctionBlob;
  deadlineMs?: number; pollMs?: number;
};
export type FunctionRuntime = {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  close(): Promise<void>; healthy(): boolean;
};

/** HTTP Functions never construct Core or run provider/model work. Durable
 * command acceptance is the sole boundary to the persistent worker. */
export async function createFunctionRuntime(options: FunctionRuntimeOptions): Promise<FunctionRuntime> {
  const configuration = loadFunctionConfiguration(options.env);
  const primary = options.createControl?.(configuration) ?? createLibsqlControl({ url: configuration.controlUrl, authToken: configuration.controlToken });
  let healthy = true, closePromise: Promise<void> | undefined;
  const observe = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) {
      if (error instanceof ControlSqlError && ['control_commit_uncertain', 'control_rollback_uncertain', 'control_closed'].includes(error.code)) healthy = false;
      throw error;
    }
  };
  const sql: FunctionControl = {
    execute: (statement, args) => observe(() => primary.execute(statement, args)),
    transaction: work => observe(() => primary.transaction(work)),
    close: () => { healthy = false; return closePromise ??= Promise.resolve().then(() => primary.close()); },
  };
  try {
    const blob = options.createBlob?.(configuration) ?? new VercelPrivateBlobStore({ storeId: configuration.storeId, namespace: configuration.namespace });
    const bodies = new PrivateBodyTransport({ sql, blob, namespace: configuration.namespace });
    const log = new DurableCommandLog(sql, { namespace: configuration.namespace, webOrigin: configuration.webOrigin,
      authorizeBody: async (transaction, request, scope) => {
        if (request.body.kind !== 'blob') throw new CommandLogError();
        await bodies.authorizeRequestBody(transaction, request.body, scope);
      } });
    await log.initialize(); await bodies.initialize();
    const translated = async <T>(work: () => Promise<T>): Promise<T> => {
      try { return await work(); } catch (error) {
        if (error instanceof BlobTransportError) throw new CommandLogError(error.code, error.status);
        throw error;
      }
    };
    const handle = createHttpBridge({ commandLog: log, webOrigin: configuration.webOrigin, allowedHosts: [new URL(configuration.webOrigin).host],
      blobDownloadOrigin: blob.privateOrigin, deadlineMs: options.deadlineMs ?? 90_000, pollMs: options.pollMs,
      bodyAdapter: {
        validateRequestBody: (body, scope) => translated(() => bodies.validateRequestBody(body, scope)),
        responseDownload: (body, scope) => translated(() => bodies.responseDownload(body, scope)),
        createRequestUpload: (scope, bytes, sha256) => translated(() => bodies.createRequestUpload(scope, bytes, sha256)),
      } });
    return { handle, close: () => sql.close(), healthy: () => healthy };
  } catch (error) { await sql.close().catch(() => {}); throw error; }
}

export function createFunctionHandler(initialize: () => ReturnType<typeof createFunctionRuntime>): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  let production: ReturnType<typeof createFunctionRuntime> | undefined;
  const active = new Map<FunctionRuntime, number>();
  return async (request, response) => {
    let runtime: FunctionRuntime | undefined, selected: ReturnType<typeof createFunctionRuntime> | undefined;
    try {
      if (!production) {
        const pending = initialize().catch(error => { if (production === pending) production = undefined; throw error; });
        production = pending;
      }
      selected = production; runtime = await selected;
      active.set(runtime, (active.get(runtime) ?? 0) + 1);
      if (!runtime.healthy()) throw new ControlSqlError('control_closed');
      await runtime.handle(request, response);
    } catch {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
        'cdn-cache-control': 'no-store', 'vercel-cdn-cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify({ error: { code: 'mail_runtime_unavailable', message: 'Email is temporarily unavailable.' } }));
    } finally {
      if (runtime) {
        const remaining = (active.get(runtime) ?? 1) - 1;
        if (remaining) active.set(runtime, remaining); else active.delete(runtime);
        if (!runtime.healthy()) {
          // Retire only this generation. A distinct request may already have
          // opened a successor; no handler or durable command is replayed here.
          if (production === selected) production = undefined;
          if (!remaining) await runtime.close().catch(() => {});
        }
      }
    }
  };
}
export const productionFunction = createFunctionHandler(() => createFunctionRuntime({ env: process.env }));
