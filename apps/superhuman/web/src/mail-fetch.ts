export type MailFetch = (path: string, init?: RequestInit) => Promise<Response>;
type BlobBody = { kind: 'blob'; ref: string; sha256: string; bytes: number };
type FetchOptions = { enabled: boolean; downloadOrigin?: string; origin?: string; fetch?: typeof fetch; uuid?: () => string; now?: () => number; inlineBytes?: number;
  resultTimeoutMs?: number; resultPollMs?: number };
const MAX_BODY = 64 * 1024 ** 2, MAX_METADATA = 256 * 1024;
const UPLOAD_ORIGIN = 'https://vercel.com', UPLOAD_PATH = '/api/blob/';
const headerNames = new Set(['content-type', 'content-disposition', 'cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control',
  'x-vercel-enable-rewrite-caching', 'x-content-type-options', 'location', 'etag', 'last-modified', 'pragma', 'expires', 'x-rea-transport-id']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
export class MailTransportError extends Error {
  readonly code: string; readonly commandId?: string;
  constructor(code: string, commandId?: string) { super('The email request could not be confirmed. Check its status before trying again.'); this.name = 'MailTransportError'; this.code = code; this.commandId = commandId; }
}
function invalid(commandId?: string): never { throw new MailTransportError('mail_transport_invalid', commandId); }
function origin(value: string | undefined): string {
  let url: URL; try { url = new URL(value ?? ''); } catch { return invalid(); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) return invalid();
  return url.origin;
}
function blobBody(value: unknown, commandId: string): BlobBody {
  if (!object(value) || !exact(value, ['kind', 'ref', 'sha256', 'bytes']) || value.kind !== 'blob' ||
      typeof value.ref !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(value.ref) || typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > MAX_BODY) return invalid(commandId);
  return { kind: 'blob', ref: value.ref, sha256: value.sha256, bytes: Number(value.bytes) };
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function checkAbort(signal: AbortSignal | null | undefined): void { signal?.throwIfAborted(); }
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function payload(value: BodyInit | null | undefined, commandId: string): Promise<Uint8Array<ArrayBuffer>> {
  if (value === undefined || value === null) return new Uint8Array();
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
  if (value instanceof Blob) { if (value.size > MAX_BODY) return invalid(commandId); return new Uint8Array(await value.arrayBuffer()); }
  return invalid(commandId);
}
async function boundedBytes(response: Response, expectedMax: number, commandId: string, signal?: AbortSignal | null): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > expectedMax)) return invalid(commandId);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let count = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) { checkAbort(signal); const next = await reader.read(); if (next.done) break;
      count += next.value.byteLength; if (count > expectedMax) { await reader.cancel().catch(() => {}); return invalid(commandId); } chunks.push(next.value); }
    checkAbort(signal);
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(count); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes;
}
async function metadata(response: Response, commandId: string, signal?: AbortSignal | null): Promise<unknown> {
  const bytes = await boundedBytes(response, MAX_METADATA, commandId, signal);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return invalid(commandId); }
}
function grant(value: unknown, expectedOrigin: string, body: BlobBody, now: number, maxLifetime: number, upload: boolean, commandId: string): { url: string; expiresAt: number } {
  if (!object(value) || !exact(value, ['url', 'expiresAt']) || typeof value.url !== 'string' || value.url.length > 16_384 ||
      !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= now || Number(value.expiresAt) > now + maxLifetime) return invalid(commandId);
  let url: URL; try { url = new URL(value.url); } catch { return invalid(commandId); }
  if (url.origin !== expectedOrigin || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return invalid(commandId);
  const pathname = upload ? url.searchParams.get('pathname') : url.pathname.slice(1);
  if (upload && url.pathname !== UPLOAD_PATH || !pathname || !new RegExp(`^mail-rpc/[a-f0-9]{32}/${body.ref}$`).test(pathname)) return invalid(commandId);
  return { url: value.url, expiresAt: Number(value.expiresAt) };
}
function responseHeaders(value: unknown, commandId: string): Headers {
  if (!object(value) || Object.keys(value).length > 32) return invalid(commandId);
  const headers = new Headers();
  for (const [key, item] of Object.entries(value)) {
    if (key !== key.toLowerCase() || !headerNames.has(key) || typeof item !== 'string' || item.length > 8192 || /[\x00-\x1f\x7f]/.test(item)) return invalid(commandId);
    headers.set(key, item);
  }
  return headers;
}

/** Explicit same-origin mail transport. It never retries or cancels a durable provider operation. */
export function createMailFetch(options: FetchOptions): MailFetch {
  const request = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  if (!options.enabled) return (path, init) => request(path, init);
  const mailOrigin = origin(options.origin), downloadOrigin = origin(options.downloadOrigin), now = options.now ?? Date.now;
  const inlineBytes = options.inlineBytes ?? 1_000_000, resultTimeoutMs = options.resultTimeoutMs ?? 90_000, resultPollMs = options.resultPollMs ?? 250;
  if (!Number.isSafeInteger(inlineBytes) || inlineBytes < 1 || inlineBytes > 2 * 1024 ** 2 ||
      !Number.isSafeInteger(resultTimeoutMs) || resultTimeoutMs < 1 || resultTimeoutMs > 90_000 ||
      !Number.isSafeInteger(resultPollMs) || resultPollMs < 1 || resultPollMs > 1000) throw new TypeError('Invalid mail transport limit');
  async function existingResult(initial: Response, commandId: string, caller?: AbortSignal | null): Promise<Response> {
    if (initial.status !== 504 || initial.headers.get('x-rea-transport-state') !== 'pending' ||
        initial.headers.get('x-rea-transport-id') !== commandId) return initial;
    const value = await metadata(initial.clone(), commandId, caller);
    if (!object(value) || value.commandId !== commandId || !object(value.error) || value.error.code !== 'worker_request_pending') return invalid(commandId);
    const deadline = new AbortController(), signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => deadline.abort(new DOMException('Receipt wait timed out', 'TimeoutError')), resultTimeoutMs);
    try {
      for (;;) {
        checkAbort(signal);
        // This observes the original durable command. It never enqueues,
        // repeats or cancels the native/model operation that produced it.
        const receipt = await abortable(request(`/api/_rea/transport/results/${commandId}`, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        }), signal);
        if (receipt.redirected || receipt.headers.get('x-rea-transport-id') !== commandId) return invalid(commandId);
        const state = receipt.headers.get('x-rea-transport-state');
        if (state === 'completed') return receipt;
        if (state === 'uncertain' && receipt.status === 503) return receipt;
        if (state !== 'pending' || receipt.status !== 202) throw new MailTransportError('mail_transport_receipt_unavailable', commandId);
        const pending = await abortable(metadata(receipt, commandId, signal), signal);
        if (!object(pending) || pending.commandId !== commandId || pending.state !== 'pending') return invalid(commandId);
        await delay(resultPollMs, signal);
      }
    } catch (error) {
      if (caller?.aborted) throw caller.reason;
      if (deadline.signal.aborted) return initial;
      throw error;
    } finally { clearTimeout(timer); }
  }
  return async (path, init = {}) => {
    const headers = new Headers(init.headers), commandId = headers.get('x-rea-transport-id') ?? (options.uuid ?? (() => crypto.randomUUID()))();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(commandId)) return invalid();
    try {
      const parsed = new URL(path, mailOrigin), method = (init.method ?? 'GET').toUpperCase();
      if (!/^\/api(?:[/?]|$)/.test(path) || /[\x00-\x20\x7f\\#]/.test(path) || path.length > 8192 || parsed.origin !== mailOrigin || parsed.pathname + parsed.search !== path ||
          !['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return invalid(commandId);
      checkAbort(init.signal); const bytes = await payload(init.body, commandId); checkAbort(init.signal);
      if (bytes.length > MAX_BODY) return invalid(commandId);
      headers.set('x-rea-transport-id', commandId); headers.delete('x-rea-transport-body');
      let body = init.body;
      if (bytes.length > inlineBytes) {
        if (method !== 'POST' || !(parsed.pathname === '/api/knowledge/sources/files' || /^\/api\/drafts\/[^/]+\/attachments$/.test(parsed.pathname))) return invalid(commandId);
        const sha256 = await digest(bytes); checkAbort(init.signal);
        const staging = await request('/api/_rea/transport/uploads', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commandId, method, path, bytes: bytes.length, sha256 }), signal: init.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
        if (!staging.ok || staging.redirected) throw new MailTransportError('mail_upload_unavailable', commandId);
        const value = await metadata(staging, commandId, init.signal);
        if (!object(value) || !exact(value, ['body', 'upload'])) return invalid(commandId);
        const uploadedBody = blobBody(value.body, commandId);
        if (uploadedBody.bytes !== bytes.length || uploadedBody.sha256 !== sha256) return invalid(commandId);
        const upload = grant(value.upload, UPLOAD_ORIGIN, uploadedBody, now(), 3600_000, true, commandId);
        checkAbort(init.signal);
        const stored = await request(upload.url, { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream' }, signal: init.signal,
          credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (!stored.ok || stored.redirected || stored.url && new URL(stored.url).origin !== UPLOAD_ORIGIN) throw new MailTransportError('mail_upload_unavailable', commandId);
        if (now() >= upload.expiresAt) return invalid(commandId); checkAbort(init.signal);
        body = JSON.stringify(uploadedBody); headers.set('x-rea-transport-body', 'blob-v1');
      }
      const initial = await request(path, { ...init, method, headers, body, redirect: 'error', credentials: 'same-origin' });
      const response = await existingResult(initial, commandId, init.signal);
      if (response.redirected) return invalid(commandId);
      const mode = response.headers.get('x-rea-transport-body');
      if (mode === null) return response;
      if (mode !== 'blob-v1' || response.headers.get('x-rea-transport-id') !== commandId) return invalid(commandId);
      const envelope = await metadata(response, commandId, init.signal);
      if (!object(envelope) || !exact(envelope, ['version', 'response', 'download']) || envelope.version !== 1 || !object(envelope.response) ||
          !exact(envelope.response, ['status', 'headers', 'body']) || !Number.isSafeInteger(envelope.response.status) ||
          Number(envelope.response.status) < 200 || Number(envelope.response.status) > 599 || [204, 205, 304].includes(Number(envelope.response.status)) ||
          envelope.response.status !== response.status) return invalid(commandId);
      const responseBody = blobBody(envelope.response.body, commandId), restoredHeaders = responseHeaders(envelope.response.headers, commandId);
      const download = grant(envelope.download, downloadOrigin, responseBody, now(), 15 * 60_000, false, commandId);
      checkAbort(init.signal);
      const file = await request(download.url, { method: 'GET', signal: init.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (file.status !== 200 || file.redirected || file.url && (new URL(file.url).origin !== downloadOrigin || new URL(file.url).pathname !== new URL(download.url).pathname)) return invalid(commandId);
      const length = file.headers.get('content-length'); if (length !== null && length !== String(responseBody.bytes)) return invalid(commandId);
      const downloaded = await boundedBytes(file, responseBody.bytes, commandId, init.signal); checkAbort(init.signal);
      if (downloaded.length !== responseBody.bytes || await digest(downloaded) !== responseBody.sha256) return invalid(commandId);
      checkAbort(init.signal); restoredHeaders.set('content-length', String(downloaded.length));
      return new Response(downloaded, { status: Number(envelope.response.status), headers: restoredHeaders });
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      if (error instanceof MailTransportError) throw error;
      throw new MailTransportError('mail_transport_unavailable', commandId);
    }
  };
}
type BuildEnvironment = { VITE_REA_HOSTED_TRANSPORT?: string; VITE_REA_BLOB_DOWNLOAD_ORIGIN?: string };
const buildEnvironment = () => (import.meta as ImportMeta & { env?: BuildEnvironment }).env;
export const hostedMailTransportEnabled = () => buildEnvironment()?.VITE_REA_HOSTED_TRANSPORT === '1';
export const mailFetch: MailFetch = (path, init) => createMailFetch({ enabled: hostedMailTransportEnabled(),
  downloadOrigin: buildEnvironment()?.VITE_REA_BLOB_DOWNLOAD_ORIGIN, origin: globalThis.location?.origin })(path, init);
