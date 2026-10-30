import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CommandLogError, type CommandRequest, type CommandResponse, type CommandResult, type DurableCommandLog, type WireBody } from './command-log.ts';

export type BlobBody = Extract<WireBody, { kind: 'blob' }>;
export type BodyScope = { namespace: string; commandId: string; method: string; path: string };
export interface TransportBodyAdapter {
  /** Verify stored object identity, scope, byte count and digest, without accepting a caller URL. */
  validateRequestBody(body: BlobBody, scope: BodyScope): Promise<void>;
  responseDownload(body: BlobBody, scope: Pick<BodyScope, 'namespace' | 'commandId'>): Promise<{ url: string; expiresAt: number }>;
  createRequestUpload?(scope: BodyScope, bytes: number, sha256: string): Promise<{ body: BlobBody; upload: { url: string; expiresAt: number } }>;
}
export type BridgeCommandLog = Pick<DurableCommandLog, 'namespace' | 'webOrigin' | 'maxInlineBytes' | 'maxBlobBytes' | 'enqueue' | 'readResult'>;
export type HttpBridgeOptions = {
  commandLog: BridgeCommandLog; webOrigin: string; allowedHosts: readonly string[];
  bodyAdapter?: TransportBodyAdapter; blobDownloadOrigin?: string;
  deadlineMs?: number; pollMs?: number; now?: () => number;
};
export type BridgeContext = { signal?: AbortSignal };
const noStore = {
  'cache-control': 'private, no-store, max-age=0', 'cdn-cache-control': 'no-store',
  'vercel-cdn-cache-control': 'no-store', 'x-vercel-enable-rewrite-caching': '0', 'x-content-type-options': 'nosniff',
};
const allowedResponseHeaders = new Set(['content-type', 'content-disposition', 'location', 'etag', 'last-modified', 'pragma', 'expires', 'set-cookie']);
const methods = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(code = 'invalid_worker_request', status = 400): never { throw new CommandLogError(code, status); }
const exactKeys = (value: Record<string, unknown>, keys: string[]) => { if (Object.keys(value).some(key => !keys.includes(key))) invalid(); };
function canonicalOrigin(value: string): string {
  let url: URL; try { url = new URL(value); } catch { throw new TypeError('Invalid bridge origin'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new TypeError('Invalid bridge origin');
  return url.origin;
}
function canonicalHost(value: string): string {
  if (!value || value !== value.toLowerCase() || /[\s/@\\?#]/.test(value)) throw new TypeError('Invalid bridge host');
  const url = new URL(`https://${value}`);
  if (url.host !== value || url.hostname.endsWith('.')) throw new TypeError('Invalid bridge host');
  return value;
}
function body(value: unknown, inlineLimit: number, blobLimit: number): WireBody {
  if (!isRecord(value)) return invalid();
  if (value.kind === 'inline') {
    exactKeys(value, ['kind', 'base64']);
    if (typeof value.base64 !== 'string' || value.base64.length > Math.ceil(inlineLimit / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return invalid();
    const bytes = Buffer.from(value.base64, 'base64');
    if (bytes.length > inlineLimit || bytes.toString('base64') !== value.base64) return invalid();
    return { kind: 'inline', base64: value.base64 };
  }
  exactKeys(value, ['kind', 'ref', 'sha256', 'bytes']);
  if (value.kind !== 'blob' || typeof value.ref !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(value.ref) ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) ||
      Number(value.bytes) < 1 || Number(value.bytes) > blobLimit) return invalid();
  return { kind: 'blob', ref: value.ref, sha256: value.sha256, bytes: Number(value.bytes) };
}
class Interrupted extends Error { readonly disconnected: boolean; constructor(disconnected: boolean) { super('Bridge wait interrupted'); this.disconnected = disconnected; } }
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function readBody(request: IncomingMessage, limit: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', fail); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { cleanup(); request.resume(); reject(error); };
    const abort = () => fail(signal.reason);
    const data = (chunk: Buffer | string) => { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
      if (size > limit) { fail(new CommandLogError('worker_body_too_large', 413)); return; } chunks.push(bytes); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    if (signal.aborted) { abort(); return; }
    request.on('data', data); request.once('end', end); request.once('error', fail); signal.addEventListener('abort', abort, { once: true });
  });
}
function requestMetadata(request: IncomingMessage, webOrigin: string, hosts: Set<string>): Omit<CommandRequest, 'body'> & { commandId: string; blob: boolean } {
  const unique = new Set(['host', 'origin', 'content-type', 'x-rea-transport-id', 'x-rea-transport-body']);
  const seen = new Set<string>();
  for (let i = 0; i < request.rawHeaders.length; i += 2) { const key = request.rawHeaders[i].toLowerCase();
    if (unique.has(key) && seen.has(key)) invalid(); seen.add(key); }
  const host = request.headers.host;
  if (typeof host !== 'string' || !hosts.has(host)) invalid('worker_host_not_allowed', 403);
  const method = request.method ?? '', path = request.url ?? '';
  if (!methods.has(method)) invalid('worker_method_not_allowed', 405);
  if (path.length > 8192 || !/^\/api(?:[/?]|$)/.test(path) || /[\x00-\x20\x7f\\#]/.test(path)) invalid();
  const parsed = new URL(path, webOrigin);
  if (parsed.origin !== webOrigin || parsed.pathname + parsed.search !== path) invalid();
  const headers: Record<string, string> = {};
  for (const key of ['origin', 'content-type', 'cookie']) {
    const value = request.headers[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) invalid();
    if (key === 'cookie') {
      const states = value.split(';').map(part => part.trim()).filter(part => part.startsWith('rea_oauth_state='));
      if (states.length > 1 || (states[0] && !/^rea_oauth_state=[A-Za-z0-9_-]{10,256}$/.test(states[0]))) invalid();
      if (states.length) headers.cookie = states[0];
    } else headers[key] = value;
  }
  if ((headers.origin !== undefined && headers.origin !== webOrigin) || (!safeMethods.has(method) && headers.origin !== webOrigin)) invalid('worker_origin_not_allowed', 403);
  const commandId = request.headers['x-rea-transport-id'] ?? randomUUID();
  if (typeof commandId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(commandId)) invalid();
  const mode = request.headers['x-rea-transport-body'];
  if (mode !== undefined && mode !== 'blob-v1') invalid();
  return { method, path, headers, commandId, blob: mode === 'blob-v1' };
}
function responseHeaders(input: unknown): Record<string, string | string[]> {
  if (!isRecord(input)) return invalid('worker_response_invalid', 503);
  const headers: Record<string, string | string[]> = {};
  if (Object.keys(input).length > 32) return invalid('worker_response_invalid', 503);
  for (const [raw, value] of Object.entries(input)) {
    const key = raw.toLowerCase(); if (!allowedResponseHeaders.has(key)) continue;
    const list = Array.isArray(value) ? value : [value];
    if (!list.length || list.length > 16 || (Array.isArray(value) && key !== 'set-cookie') ||
        list.some(item => typeof item !== 'string' || item.length > 8192 || /[\x00-\x1f\x7f]/.test(item))) return invalid('worker_response_invalid', 503);
    if (key === 'set-cookie') {
      // The Core owns only this cookie; Vercel's authentication cookies never enter the command log.
      const cookies = (list as string[]).filter(item => /^rea_oauth_state=(?:[A-Za-z0-9_-]{10,256})?(?:;|$)/.test(item));
      if (cookies.some(item => /(?:^|;)\s*Domain=/i.test(item))) return invalid('worker_response_invalid', 503);
      if (cookies.length) headers[key] = cookies.map(item => `${item}${/(?:^|;)\s*Secure(?:;|$)/i.test(item) ? '' : '; Secure'}${/(?:^|;)\s*HttpOnly(?:;|$)/i.test(item) ? '' : '; HttpOnly'}`);
    } else {
      if (key === 'location') { let url: URL; try { url = new URL(String(value), 'https://bridge.invalid'); } catch { return invalid('worker_response_invalid', 503); }
        if (url.protocol !== 'https:' || url.username || url.password) return invalid('worker_response_invalid', 503); }
      headers[key] = String(list[0]);
    }
  }
  return { ...headers, ...noStore };
}

/** HTTP waits observe a durable command; disconnects and deadlines never cancel or repeat it. */
export function createHttpBridge(options: HttpBridgeOptions): (request: IncomingMessage, response: ServerResponse, context?: BridgeContext) => Promise<void> {
  const { commandLog: log, bodyAdapter } = options;
  const webOrigin = canonicalOrigin(options.webOrigin);
  if (log.webOrigin !== webOrigin) throw new TypeError('Bridge and command log origins differ');
  const hosts = new Set(options.allowedHosts.map(canonicalHost));
  if (!hosts.size || !hosts.has(new URL(webOrigin).host)) throw new TypeError('Bridge host allowlist must include the mail origin');
  const blobOrigin = options.blobDownloadOrigin ? canonicalOrigin(options.blobDownloadOrigin) : undefined;
  if (bodyAdapter && !blobOrigin) throw new TypeError('A private Blob download origin is required');
  const inlineLimit = Math.min(log.maxInlineBytes, 2 * 1024 * 1024);
  if (!Number.isSafeInteger(inlineLimit) || inlineLimit < 1 || !Number.isSafeInteger(log.maxBlobBytes) || log.maxBlobBytes < 1) throw new TypeError('Invalid bridge body limits');
  const deadlineMs = options.deadlineMs ?? 25_000, pollMs = options.pollMs ?? 50, now = options.now ?? Date.now;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 240_000 || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw new TypeError('Invalid bridge wait limits');
  return async (request, response, context = {}) => {
    const controller = new AbortController(); let commandId: string | undefined;
    const disconnected = () => { if (!response.writableEnded) controller.abort(new Interrupted(true)); };
    const externalAbort = () => controller.abort(new Interrupted(true));
    const timer = setTimeout(() => controller.abort(new Interrupted(false)), deadlineMs);
    request.once('aborted', disconnected); response.once('close', disconnected);
    context.signal?.addEventListener('abort', externalAbort, { once: true });
    if (context.signal?.aborted) externalAbort();
    const signal = controller.signal;
    const wait = <T>(value: Promise<T>) => withSignal(value, signal);
    const jsonError = (status: number, code: string, state?: 'pending' | 'uncertain') => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { ...noStore, 'content-type': 'application/json; charset=utf-8', ...(commandId ? { 'x-rea-transport-id': commandId } : {}), ...(state ? { 'x-rea-transport-state': state } : {}) });
      response.end(JSON.stringify({ error: { code, message: code === 'worker_request_pending' ? 'The existing request is still pending. Check its status before trying again.' : 'The mail request could not be confirmed.' }, ...(commandId ? { commandId } : {}) }));
    };
    try {
      const metadata = requestMetadata(request, webOrigin, hosts); commandId = metadata.commandId;
      const receiptPrefix = '/api/_rea/transport/results/';
      const receipt = metadata.path.startsWith('/api/_rea/transport/results');
      if (receipt && (metadata.method !== 'GET' || metadata.blob || !/^[A-Za-z0-9_-]{1,128}$/.test(metadata.path.slice(receiptPrefix.length)))) invalid();
      if (receipt) commandId = metadata.path.slice(receiptPrefix.length);
      const uploadGrant = metadata.path === '/api/_rea/transport/uploads';
      if (uploadGrant && (metadata.method !== 'POST' || metadata.blob || metadata.headers['content-type'] !== 'application/json')) invalid();
      const bytes = await readBody(request, metadata.blob || uploadGrant ? 8192 : inlineLimit, signal);
      if (uploadGrant) {
        if (!bodyAdapter?.createRequestUpload) invalid('worker_blob_unavailable', 503);
        let value: unknown; try { value = JSON.parse(bytes.toString('utf8')); } catch { invalid(); }
        if (!isRecord(value)) invalid();
        exactKeys(value, ['commandId', 'method', 'path', 'bytes', 'sha256']);
        if (typeof value.commandId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.commandId) || value.method !== 'POST' ||
            typeof value.path !== 'string' || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > log.maxBlobBytes ||
            typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) invalid();
        const grant = await wait(bodyAdapter.createRequestUpload({ namespace: log.namespace, commandId: value.commandId, method: value.method, path: value.path }, Number(value.bytes), value.sha256));
        if (signal.aborted) throw signal.reason;
        response.writeHead(200, { ...noStore, 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(grant)); return;
      }
      let result: CommandResult;
      if (receipt) {
        if (bytes.length) invalid();
        const found = await wait(log.readResult(log.namespace, commandId));
        if (!found) { jsonError(404, 'worker_command_not_found'); return; }
        if (found.id !== commandId) invalid('worker_response_invalid', 503);
        result = found;
        if (result.state === 'queued' || result.state === 'claimed') {
          response.writeHead(202, { ...noStore, 'content-type': 'application/json; charset=utf-8', 'x-rea-transport-id': commandId, 'x-rea-transport-state': 'pending' });
          response.end(JSON.stringify({ commandId, state: 'pending' })); return;
        }
      } else {
        let requestBody: WireBody;
        if (metadata.blob) {
        if (!bodyAdapter) invalid('worker_blob_unavailable', 503);
        let value: unknown; try { value = JSON.parse(bytes.toString('utf8')); } catch { invalid(); }
        requestBody = body(value, inlineLimit, log.maxBlobBytes);
        if (requestBody.kind !== 'blob') invalid();
        await wait(bodyAdapter.validateRequestBody(requestBody, { namespace: log.namespace, commandId, method: metadata.method, path: metadata.path }));
        } else requestBody = { kind: 'inline', base64: bytes.toString('base64') };
        result = (await wait(log.enqueue({ id: commandId, namespace: log.namespace,
        request: { method: metadata.method, path: metadata.path, headers: metadata.headers, body: requestBody } }))).command;
      }
      for (;;) {
        if (result.id !== commandId) invalid('worker_response_invalid', 503);
        if (result.state === 'completed' || result.state === 'uncertain') break;
        if (result.state !== 'queued' && result.state !== 'claimed') invalid('worker_response_invalid', 503);
        await wait(new Promise<void>(resolve => setTimeout(resolve, pollMs)));
        const current = await wait(log.readResult(log.namespace, commandId));
        if (!current) invalid('worker_command_unavailable', 503); result = current;
      }
      if (!result.response && result.state === 'uncertain') { jsonError(503, 'worker_command_uncertain', 'uncertain'); return; }
      if (!result.response) invalid('worker_response_invalid', 503);
      const reply: CommandResponse = result.response;
      if (!Number.isSafeInteger(reply.status) || reply.status < 200 || reply.status > 599) invalid('worker_response_invalid', 503);
      const headers = responseHeaders(reply.headers); let responseBody: WireBody;
      try { responseBody = body(reply.body, inlineLimit, log.maxBlobBytes); } catch { invalid('worker_response_invalid', 503); }
      headers['x-rea-transport-id'] = commandId;
      if (responseBody.kind === 'inline') {
        if (signal.aborted) throw signal.reason;
        response.writeHead(reply.status, { ...headers, 'x-rea-transport-state': result.state });
        response.end(metadata.method === 'HEAD' || reply.status === 204 || reply.status === 304 ? undefined : Buffer.from(responseBody.base64, 'base64'));
      } else {
        if (!bodyAdapter || !blobOrigin || reply.status === 204 || reply.status === 304 || metadata.method === 'HEAD') invalid('worker_blob_unavailable', 503);
        const download = await wait(bodyAdapter.responseDownload(responseBody, { namespace: log.namespace, commandId }));
        let url: URL; try { url = new URL(download.url); } catch { invalid('worker_blob_unavailable', 503); }
        if (url!.origin !== blobOrigin || url!.protocol !== 'https:' || url!.username || url!.password || url!.hash || download.url.length > 8192 ||
            !Number.isSafeInteger(download.expiresAt) || download.expiresAt <= now() || download.expiresAt > now() + 15 * 60_000) invalid('worker_blob_unavailable', 503);
        const { 'set-cookie': cookies, ...publicHeaders } = headers;
        response.writeHead(reply.status, { ...noStore, 'content-type': 'application/json; charset=utf-8', 'x-rea-transport-id': commandId,
          'x-rea-transport-body': 'blob-v1', 'x-rea-transport-state': result.state, ...(cookies ? { 'set-cookie': cookies } : {}) });
        response.end(JSON.stringify({ version: 1, response: { status: reply.status, headers: publicHeaders, body: responseBody }, download }));
      }
    } catch (error) {
      if (error instanceof Interrupted) { if (!error.disconnected) jsonError(504, 'worker_request_pending', 'pending'); }
      else if (error instanceof CommandLogError) jsonError(error.status, error.code);
      else jsonError(503, 'worker_command_unavailable');
    } finally {
      clearTimeout(timer); request.off('aborted', disconnected); response.off('close', disconnected);
      context.signal?.removeEventListener('abort', externalAbort);
    }
  };
}
