import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ControlSql, ControlTransaction } from './authority.ts';
import { AppSessionAuthority, type CommandAuthorization } from './auth-sessions.ts';
import { AppAuthError } from './auth-values.ts';
import type { PersonalAssignment } from './auth-registry.ts';

export type GatewaySessionOptions = Omit<ConstructorParameters<typeof AppSessionAuthority>[0], 'sql'>;
export type CoreCredentials = Readonly<{ cookieHeader: unknown; csrfHeader: unknown; host: unknown; origin: unknown; fetchSite: unknown; method: string }>;
declare const grantBrand: unique symbol;
export type RequestGrant = Readonly<{ [grantBrand]: true }>;
const selectors = new Set(['tenant', 'tenantid', 'userid', 'namespace', 'storageref', 'storagegeneration', 'databaseurl', 'databasepath', 'keyref', 'browserscope', 'authcontext']);
const forbiddenHeaders = new Set(['x-tenant', 'x-tenant-id', 'x-user-id', 'x-namespace', 'x-rea-tenant', 'x-rea-user', 'x-rea-namespace', 'x-database-url', 'x-storage-ref']);
export function readOnlyAuthSql(tx: ControlTransaction): ControlSql {
  return Object.freeze({ execute: (sql, args) => tx.execute(sql, args), async transaction() { throw new AppAuthError('auth_nested_transaction_forbidden'); } } satisfies ControlSql);
}
export function strictHttpMetadata(request: IncomingMessage): { path: string; url: URL; credentials: CoreCredentials } {
  const singles = new Set(['host', 'origin', 'cookie', 'content-type', 'x-rea-csrf', 'sec-fetch-site', 'x-rea-transport-id', 'x-rea-transport-body']);
  const seen = new Set<string>();
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    const name = request.rawHeaders[i]!.toLowerCase();
    if (forbiddenHeaders.has(name) || singles.has(name) && seen.has(name)) throw new AppAuthError('auth_http_metadata_invalid'); seen.add(name);
  }
  const path = request.url ?? '';
  if (path.length > 8192 || !/^\/api(?:[/?]|$)/.test(path) || /[\x00-\x20\x7f\\#]/.test(path)) throw new AppAuthError('auth_http_metadata_invalid');
  const url = new URL(path, 'https://auth.invalid');
  if (url.origin !== 'https://auth.invalid' || url.pathname + url.search !== path) throw new AppAuthError('auth_http_metadata_invalid');
  return { path, url, credentials: Object.freeze({ cookieHeader: request.headers.cookie, csrfHeader: request.headers['x-rea-csrf'],
    host: request.headers.host, origin: request.headers.origin, fetchSite: request.headers['sec-fetch-site'], method: request.method ?? '' }) };
}
export function assertCoreOrTransportPath(path: string): void {
  if (path === '/api/_rea/transport/uploads' || /^\/api\/_rea\/transport\/results\/[A-Za-z0-9_-]{1,128}$/.test(path)) return;
  assertCorePath(path);
}
export function assertCorePath(path: string): void {
  if (typeof path !== 'string' || path.length > 8192 || !/^\/api(?:[/?]|$)/.test(path) || /[\x00-\x20\x7f\\#]/.test(path)) throw new AppAuthError('auth_http_metadata_invalid');
  const url = new URL(path, 'https://auth.invalid');
  if (url.origin !== 'https://auth.invalid' || url.pathname + url.search !== path || url.pathname.startsWith('/api/auth/') ||
      url.pathname === '/api/auth' || url.pathname.startsWith('/api/_rea')) throw new AppAuthError('auth_core_route_forbidden');
  for (const name of url.searchParams.keys()) if (selectors.has(name.toLowerCase())) throw new AppAuthError('auth_selector_forbidden');
}
export function assertCoreBody(headers: Readonly<Record<string, string>>, bytes: Uint8Array): void {
  // Match every prefix the unchanged Core body parser accepts, including its
  // permissive JSON subtype handling. Never let a MIME variant skip this gate.
  if (!(headers['content-type'] ?? '').startsWith('application/json') || !bytes.byteLength) return;
  let value: unknown;
  try { value = JSON.parse((Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).toString('utf8')); } catch { return; } // Match Core decoding; Core owns normal JSON validation.
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(name => selectors.has(name.toLowerCase()))) throw new AppAuthError('auth_selector_forbidden');
}
export function browserScope(a: PersonalAssignment): Readonly<{ version: 1; key: string }> {
  return Object.freeze({ version: 1, key: createHash('sha256').update(JSON.stringify(['rea/browser-storage-scope', 1, a.userId, a.tenantId,
    a.storageRef, a.storageGeneration, a.namespace, a.userAuthEpoch, a.tenantAuthzEpoch, a.membershipAuthzEpoch])).digest('hex') });
}
export function assignmentFrom(a: PersonalAssignment): PersonalAssignment {
  return Object.freeze({ userId: a.userId, userAuthEpoch: a.userAuthEpoch, tenantId: a.tenantId, tenantAuthzEpoch: a.tenantAuthzEpoch,
    membershipAuthzEpoch: a.membershipAuthzEpoch, storageRef: a.storageRef, storageGeneration: a.storageGeneration, namespace: a.namespace });
}
/** Request-scoped. Raw credentials never leave this closure or enter Mail JSON.
 * Reauthentication inside an explicit tx uses the actual unchanged primitives. */
export class GatewayRequestAuthority {
  private readonly sql: ControlSql;
  private readonly options: GatewaySessionOptions;
  private readonly credentials: CoreCredentials;
  private readonly grants = new WeakMap<object, CommandAuthorization>();
  constructor(options: { sql: ControlSql; sessions: GatewaySessionOptions; credentials: CoreCredentials }) {
    this.sql = options.sql; this.options = options.sessions; this.credentials = Object.freeze({ ...options.credentials });
  }
  async authorize(tx?: ControlTransaction): Promise<RequestGrant> {
    const service = new AppSessionAuthority({ ...this.options, sql: tx ? readOnlyAuthSql(tx) : this.sql });
    const proof = await service.authorizeCoreRequest(this.credentials);
    const metadata = await service.commandAuthorization(proof), grant = Object.freeze(Object.create(null)) as RequestGrant;
    this.grants.set(grant, metadata); return grant;
  }
  metadata(grant: RequestGrant): CommandAuthorization {
    const found = grant && typeof grant === 'object' ? this.grants.get(grant) : undefined;
    if (!found) throw new AppAuthError('auth_request_grant_invalid'); return found;
  }
}
