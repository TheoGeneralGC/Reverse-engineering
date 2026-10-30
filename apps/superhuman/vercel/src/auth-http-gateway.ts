import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ControlSql } from './authority.ts';
import { AppSessionAuthority } from './auth-sessions.ts';
import { OneUseGoogleLoginBroker } from './auth-login-broker.ts';
import { GOOGLE_OIDC } from './auth-google-oidc.ts';
import { AppAuthError, canonicalAuthOrigin } from './auth-values.ts';
import { AuthenticatedTenantTransport, authStatus } from './auth-command-gateway.ts';
import { GatewayRequestAuthority, assignmentFrom, assertCoreOrTransportPath, browserScope, readOnlyAuthSql, strictHttpMetadata,
  type GatewaySessionOptions, type CoreCredentials } from './auth-gateway-authority.ts';
import { createHttpBridge } from './http-bridge.ts';
import type { PersonalAssignment } from './auth-registry.ts';

export type HttpGatewayHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;
const noStore = { 'cache-control': 'private, no-store, max-age=0', 'cdn-cache-control': 'no-store', 'vercel-cdn-cache-control': 'no-store',
  'x-vercel-enable-rewrite-caching': '0', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const clearCookie = '__Host-rea_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
function send(response: ServerResponse, status: number, value?: unknown, headers: Record<string, string | string[]> = {}): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...noStore, 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}
async function versionBody(request: IncomingMessage): Promise<void> {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] ?? ''))) throw new AppAuthError('auth_http_body_invalid');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 2048) throw new AppAuthError('auth_http_body_invalid'); chunks.push(Buffer.from(chunk)); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new AppAuthError('auth_http_body_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'version' || (value as { version: unknown }).version !== 1) throw new AppAuthError('auth_http_body_invalid');
}
function callbackParameters(url: URL): { code: string; state: string } {
  if ([...url.searchParams].length > 32 || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.has('error') || url.searchParams.getAll('iss').length > 1 || url.searchParams.has('iss') && url.searchParams.get('iss') !== GOOGLE_OIDC.issuer) throw new AppAuthError('auth_login_input_invalid');
  for (const [name, value] of url.searchParams) if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new AppAuthError('auth_login_input_invalid');
  return { code: url.searchParams.get('code')!, state: url.searchParams.get('state')! };
}

/** Server-only directory. The cached object contains assignment/ports, never a
 * request cookie/proof. Failed/mismatched selection has no owner fallback. */
export class GatewayTenantDirectory {
  private readonly create: (assignment: PersonalAssignment) => Promise<AuthenticatedTenantTransport> | AuthenticatedTenantTransport;
  private readonly entries = new Map<string, Promise<AuthenticatedTenantTransport>>();
  constructor(create: (assignment: PersonalAssignment) => Promise<AuthenticatedTenantTransport> | AuthenticatedTenantTransport) { this.create = create; }
  async get(assignment: PersonalAssignment): Promise<AuthenticatedTenantTransport> {
    const binding = assignmentFrom(assignment), key = JSON.stringify(binding);
    let pending = this.entries.get(key);
    if (!pending) { pending = Promise.resolve().then(() => this.create(binding)); this.entries.set(key, pending);
      void pending.catch(() => { if (this.entries.get(key) === pending) this.entries.delete(key); }); }
    return pending;
  }
}
export type AuthenticatedGatewayOptions = { sql: ControlSql; sessions: GatewaySessionOptions; login: OneUseGoogleLoginBroker;
  directory: GatewayTenantDirectory; proof?: { broker: OneUseGoogleLoginBroker; authorize: (request: IncomingMessage) => Promise<boolean> };
  bridgeDeadlineMs?: number; bridgePollMs?: number };

/** No Core import/creation, schema initialization or environment lookup. This
 * function is not imported by any production entrypoint in this private slice. */
export function createAuthenticatedGateway(options: AuthenticatedGatewayOptions): HttpGatewayHandler {
  const origin = canonicalAuthOrigin(options.sessions.webOrigin), host = new URL(origin).host;
  const guard = (credentials: CoreCredentials, unsafe: boolean, callback = false) => {
    if (credentials.host !== host || credentials.origin !== undefined && credentials.origin !== origin || unsafe && credentials.origin !== origin ||
        !callback && credentials.fetchSite !== undefined && (typeof credentials.fetchSite !== 'string' || !['same-origin', 'none'].includes(credentials.fetchSite))) throw new AppAuthError('auth_origin_invalid');
  };
  return async (request, response) => {
    try {
      const { path, url, credentials } = strictHttpMetadata(request), method = request.method ?? '', route = url.pathname;
      if (route === '/api/_rea/health' && method === 'GET' && !url.search) { guard(credentials, false); send(response, 200, { ok: true }); return; }
      if (route === '/api/auth/google/callback') {
        if (method !== 'GET') throw new AppAuthError('auth_http_method_invalid'); guard(credentials, false, true);
        const parsed = callbackParameters(url), isProof = parsed.state.startsWith('rea-proof-v1.');
        if (!parsed.state.startsWith('rea-login-v1.') && !isProof) throw new AppAuthError('auth_mailbox_consent_unavailable');
        if (isProof && (!options.proof || !await options.proof.authorize(request))) throw new AppAuthError('auth_operator_proof_forbidden');
        const result = await (isProof ? options.proof!.broker : options.login).callback({ ...parsed, browserCookieHeader: credentials.cookieHeader,
          sessionCookieHeader: credentials.cookieHeader, host: credentials.host, origin: credentials.origin, fetchSite: credentials.fetchSite });
        if (result.purpose === 'login') send(response, 303, undefined, { location: '/', 'set-cookie': result.session.setCookie });
        else send(response, 200, { version: 1, purpose: result.purpose, identity: result.identity });
        return;
      }
      if (route.startsWith('/api/_rea/auth')) {
        if (url.search) throw new AppAuthError('auth_http_metadata_invalid');
        if (route === '/api/_rea/auth/browser' && method === 'GET') {
          guard(credentials, false); const browser = options.login.bootstrapBrowser();
          send(response, 200, { version: 1, csrfToken: browser.csrfToken }, { 'set-cookie': browser.setCookie }); return;
        }
        if (route === '/api/_rea/auth/session' && method === 'GET') {
          guard(credentials, false);
          const result = await options.sql.transaction(async tx => {
            const service = new AppSessionAuthority({ ...options.sessions, sql: readOnlyAuthSql(tx) });
            const info = await service.sessionInfo(await service.authenticate(credentials.cookieHeader)), a = await options.sessions.registry.forUser(info.session.userId, tx);
            return { version: 1, authenticated: true, ...info, browserScope: browserScope(a) };
          });
          send(response, 200, result); return;
        }
        if ((route === '/api/_rea/auth/login' || route === '/api/_rea/auth/proof') && method === 'POST') {
          guard(credentials, true); await versionBody(request);
          const proof = route.endsWith('/proof');
          if (proof && (!options.proof || !await options.proof.authorize(request))) throw new AppAuthError('auth_operator_proof_forbidden');
          const result = await (proof ? options.proof!.broker : options.login).start({ browserCookieHeader: credentials.cookieHeader,
            sessionCookieHeader: credentials.cookieHeader, csrfHeader: credentials.csrfHeader, host: credentials.host, origin: credentials.origin, fetchSite: credentials.fetchSite });
          send(response, 200, { version: 1, ...result }); return;
        }
        if (route === '/api/_rea/auth/logout' && method === 'POST') {
          guard(credentials, true); await versionBody(request);
          const service = new AppSessionAuthority({ ...options.sessions, sql: options.sql });
          try { const proof = await service.authorizeCoreRequest(credentials); const revoked = await service.revoke(proof); send(response, 204, undefined, { 'set-cookie': revoked.setCookie }); }
          catch (error) {
            if (!(error instanceof AppAuthError) || !/^auth_(?:session|cookie)_/.test(error.code) || typeof credentials.csrfHeader !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credentials.csrfHeader)) throw error;
            // Pure browser cleanup of absent/expired/revoked/invalid cookie.
            // No raw cookie is sent to a state-changing service method.
            send(response, 204, undefined, { 'set-cookie': clearCookie });
          }
          return;
        }
        throw new AppAuthError('auth_http_route_not_found');
      }
      assertCoreOrTransportPath(path);
      const authority = new GatewayRequestAuthority({ sql: options.sql, sessions: options.sessions, credentials });
      const grant = await authority.authorize(), metadata = authority.metadata(grant);
      const selected = await options.directory.get(assignmentFrom(metadata)), view = selected.forRequest(authority, grant);
      const bridge = createHttpBridge({ ...view, webOrigin: origin, allowedHosts: [host], deadlineMs: options.bridgeDeadlineMs, pollMs: options.bridgePollMs });
      await bridge(request, response);
    } catch (error) {
      if (error instanceof AppAuthError) send(response, error.code === 'auth_http_route_not_found' ? 404 : authStatus(error), { error: { code: error.code, message: 'The request could not be authorized.' } });
      else send(response, 503, { error: { code: 'auth_gateway_unavailable', message: 'The request could not be confirmed.' } });
    }
  };
}

/** Default-off assembly preserves the exact legacy handler and has no auth IO. */
export function createGatewayBoundary(options: { mode?: 'off' | 'auth'; legacy: HttpGatewayHandler; createAuthenticated?: () => HttpGatewayHandler }): HttpGatewayHandler {
  if (options.mode === undefined || options.mode === 'off') return options.legacy;
  if (options.mode !== 'auth' || !options.createAuthenticated) throw new AppAuthError('auth_configuration_invalid');
  return options.createAuthenticated();
}
