import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import type { HostedConfiguration } from './config.ts';

function noStore(response: ServerResponse): void {
  response.setHeader('cache-control', 'private, no-store, max-age=0');
  response.setHeader('cdn-cache-control', 'no-store');
  response.setHeader('vercel-cdn-cache-control', 'no-store');
  response.setHeader('x-vercel-enable-rewrite-caching', '0');
  response.setHeader('pragma', 'no-cache');
  response.setHeader('expires', '0');
  response.setHeader('x-content-type-options', 'nosniff');
}

/** Preserve response streaming while applying the hosted transport boundary. */
function protectResponse(response: ServerResponse): void {
  const writeHead = response.writeHead;
  response.writeHead = function (this: ServerResponse, status: number, messageOrHeaders?: string | OutgoingHttpHeaders | readonly string[], headers?: OutgoingHttpHeaders | readonly string[]) {
    const message = typeof messageOrHeaders === 'string' ? messageOrHeaders : undefined;
    const supplied = typeof messageOrHeaders === 'string' || messageOrHeaders === undefined ? headers : messageOrHeaders;
    if (Array.isArray(supplied)) {
      const grouped = new Map<string, string[]>();
      for (let index = 0; index < supplied.length; index += 2) {
        const key = supplied[index].toLowerCase();
        grouped.set(key, [...(grouped.get(key) ?? []), supplied[index + 1]]);
      }
      for (const [key, values] of grouped) this.setHeader(key, values.length === 1 ? values[0] : values);
    } else if (supplied && typeof supplied === 'object') {
      for (const [key, value] of Object.entries(supplied)) if (value !== undefined) this.setHeader(key, value);
    }
    const cookies = this.getHeader('set-cookie');
    if (cookies !== undefined) {
      const secure = (value: string) => /(?:^|;)\s*secure(?:;|$)/i.test(value) ? value : `${value}; Secure`;
      this.setHeader('set-cookie', Array.isArray(cookies) ? cookies.map(secure) : secure(String(cookies)));
    }
    noStore(this);
    return Reflect.apply(writeHead, this, message === undefined ? [status] : [status, message]) as ServerResponse;
  } as typeof response.writeHead;
  noStore(response);
}

function reject(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: { code, message: status === 503 ? 'Service is shutting down' : 'Request is not allowed' } }));
}

/** The only public resource is the static liveness response. No database is read. */
export function createHostedGateway(configuration: HostedConfiguration, core: Server): { server: Server; beginShutdown: () => void; close: () => Promise<void> } {
  const expectedSecret = Buffer.from(configuration.originSecret, 'ascii');
  const expectedHost = new URL(configuration.apiOrigin).host;
  const listeners = core.listeners('request');
  if (listeners.length !== 1) throw new TypeError('Hosted API requires one core request owner.');
  const handle = listeners[0] as (request: IncomingMessage, response: ServerResponse) => unknown;
  const requests = new Set<Promise<unknown>>();
  let stopping = false;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    protectResponse(response);
    if (stopping) { reject(response, 503, 'server_stopping'); return; }
    if (request.url === '/healthz' && (request.method === 'GET' || request.method === 'HEAD')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : '{"ok":true}');
      return;
    }
    const suppliedSecret = request.headers['x-origin-secret'];
    const suppliedBytes = typeof suppliedSecret === 'string' && suppliedSecret.length === 64 && /^[a-f0-9]{64}$/.test(suppliedSecret)
      ? Buffer.from(suppliedSecret, 'ascii') : Buffer.alloc(0);
    if (suppliedBytes.length !== expectedSecret.length || !timingSafeEqual(suppliedBytes, expectedSecret)) {
      reject(response, 403, 'origin_not_authenticated'); return;
    }
    if (request.headers.host !== expectedHost) { reject(response, 403, 'host_not_allowed'); return; }
    const origin = request.headers.origin;
    if ((origin !== undefined && origin !== configuration.webOrigin) ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') && origin !== configuration.webOrigin)) {
      reject(response, 403, 'origin_not_allowed'); return;
    }
    // HTTP origin-form only: an absolute target must never redirect core routing.
    if (!request.url || !/^\/api(?:[/?]|$)/.test(request.url) || /[\r\n\\]/.test(request.url)) {
      reject(response, 404, 'not_found'); return;
    }
    // The authenticated gateway owns this conversion. Never trust forwarded Host.
    for (const name of Object.keys(request.headers)) {
      if (name === 'x-origin-secret' || name === 'forwarded' || name.startsWith('x-forwarded-')) delete request.headers[name];
    }
    request.headers.host = '127.0.0.1';
    const raw: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index].toLowerCase();
      if (name === 'x-origin-secret' || name === 'forwarded' || name.startsWith('x-forwarded-')) continue;
      raw.push(request.rawHeaders[index], name === 'host' ? '127.0.0.1' : request.rawHeaders[index + 1]);
    }
    request.rawHeaders = raw;
    // Server.emit does not await an async listener. Keep its actual work alive
    // through shutdown even if a disconnected client has already closed HTTP.
    const work = Promise.resolve().then(() => handle.call(core, request, response)).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) reject(response, 500, 'internal_error');
      else if (!response.writableEnded && !response.destroyed) response.destroy();
    }).finally(() => { requests.delete(work); });
    requests.add(work);
  });
  let closing: Promise<void> | undefined;
  return { server, beginShutdown() { stopping = true; }, close() {
    if (closing) return closing;
    stopping = true;
    closing = (async () => {
      if (server.listening) {
        // Bound the client drain, not the durable provider operation. A platform
        // hard stop may still leave an issued receipt uncertain; never replay it.
        const timer = setTimeout(() => server.closeAllConnections(), 20_000); timer.unref();
        try { await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); }
        finally { clearTimeout(timer); }
      }
      while (requests.size) await Promise.allSettled([...requests]);
      expectedSecret.fill(0);
    })();
    return closing;
  } };
}
