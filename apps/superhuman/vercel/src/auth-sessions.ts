import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ControlSql, ControlTransaction, SqlRow } from './authority.ts';
import type { VerifiedGoogleIdentity } from './auth-identity.ts';
import { PersonalTenantRegistry, type PersonalAssignment } from './auth-registry.ts';
import { AppAuthError, authInteger, authTime, canonicalAuthOrigin, authStorageDatabase } from './auth-values.ts';

const cookieName = '__Host-rea_session';
const idleMs = 8 * 60 * 60 * 1000, absoluteMs = 7 * 24 * 60 * 60 * 1000, recentMs = 15 * 60 * 1000;
declare const authorizedRequest: unique symbol;
export type AuthorizedAppSession = Readonly<{ [authorizedRequest]: true }>;
export type CommandAuthorization = Readonly<PersonalAssignment & { sessionRecordId: string; sessionGeneration: number;
  purpose: 'interactive-product'; policyVersion: 1 }>;
export type AppSessionSummary = Readonly<{ userId: string; tenantId: string; sessionRecordId: string; sessionGeneration: number; idleExpiresMs: number; absoluteExpiresMs: number }>;
type SessionRecord = Readonly<{ id: string; userId: string; userAuthEpoch: number; generation: number; createdMs: number;
  lastInteractiveMs: number; idleExpiresMs: number; absoluteExpiresMs: number; csrfDigest: Uint8Array }>;
type Authorization = Readonly<{ record: SessionRecord; assignment: PersonalAssignment; csrf: string; coreAuthorized: boolean }>;
function same(a: Uint8Array, b: Uint8Array): boolean { return a.byteLength === b.byteLength && timingSafeEqual(a, b); }
function digestKey(source: Uint8Array): Buffer {
  if (!(source instanceof Uint8Array) || source.byteLength < 32 || source.byteLength > 128) throw new AppAuthError('auth_configuration_invalid');
  return Buffer.from(source);
}
function tokenCookie(header: unknown, optional = false): string | undefined {
  if (header === undefined || header === '') { if (optional) return undefined; throw new AppAuthError('auth_session_required'); }
  if (typeof header !== 'string' || header.length > 8192 || /[\x00-\x1f\x7f]/.test(header)) throw new AppAuthError('auth_cookie_invalid');
  const matches = header.split(';').map(part => part.trim()).filter(part => part.split('=', 1)[0] === cookieName);
  if (!matches.length && optional) return undefined;
  if (matches.length !== 1) throw new AppAuthError('auth_cookie_invalid');
  const value = matches[0]!.slice(cookieName.length + 1);
  if (matches[0] !== `${cookieName}=${value}` || !/^s1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{43}$/.test(value)) throw new AppAuthError('auth_cookie_invalid');
  const raw = value.split('.')[2]!;
  if (Buffer.from(raw, 'base64url').toString('base64url') !== raw || Buffer.from(raw, 'base64url').byteLength !== 32) throw new AppAuthError('auth_cookie_invalid');
  return value;
}
function blob(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) throw new AppAuthError('auth_record_invalid');
  return new Uint8Array(value);
}
function parseRecord(row: SqlRow, now: number): SessionRecord {
  if (row.state !== 'active' || row.authority_class !== 'interactive-product' || typeof row.session_record_id !== 'string' || typeof row.user_id !== 'string') throw new AppAuthError('auth_session_unavailable');
  const record = Object.freeze({ id: row.session_record_id, userId: row.user_id, userAuthEpoch: authInteger(row.user_auth_epoch), generation: authInteger(row.generation),
    createdMs: authTime(row.created_ms), lastInteractiveMs: authTime(row.last_interactive_ms), idleExpiresMs: authTime(row.idle_expires_ms),
    absoluteExpiresMs: authTime(row.absolute_expires_ms), csrfDigest: blob(row.csrf_digest) });
  if (record.createdMs > now || record.lastInteractiveMs < record.createdMs || record.lastInteractiveMs > now || record.lastInteractiveMs >= record.absoluteExpiresMs ||
      record.idleExpiresMs > record.absoluteExpiresMs || record.idleExpiresMs <= now || record.absoluteExpiresMs <= now ||
      record.absoluteExpiresMs - record.createdMs > absoluteMs || record.idleExpiresMs - record.lastInteractiveMs > idleMs) throw new AppAuthError('auth_session_expired');
  return record;
}
function authorizationSnapshot(record: SessionRecord, assignment: PersonalAssignment): CommandAuthorization {
  return Object.freeze({ ...assignment, sessionRecordId: record.id, sessionGeneration: record.generation, purpose: 'interactive-product', policyVersion: 1 });
}
function sessionSummary(record: SessionRecord, assignment: PersonalAssignment): AppSessionSummary {
  return Object.freeze({ userId: assignment.userId, tenantId: assignment.tenantId, sessionRecordId: record.id, sessionGeneration: record.generation,
    idleExpiresMs: record.idleExpiresMs, absoluteExpiresMs: record.absoluteExpiresMs });
}

/** Feature-OFF service. It only touches an explicitly provided auth SQL port.
 * There are no schema creation, provisioning, route, Core, queue or Blob calls. */
export class AppSessionAuthority {
  private readonly sql: ControlSql;
  private readonly registry: PersonalTenantRegistry;
  private readonly keys = new Map<number, Buffer>();
  private readonly currentKeyVersion: number;
  private readonly csrfKey: Buffer;
  private readonly origin: string;
  private readonly host: string;
  private readonly now: () => number;
  private readonly proofs = new WeakMap<object, Authorization>();
  constructor(options: { sql: ControlSql; registry: PersonalTenantRegistry; sessionKeys: ReadonlyMap<number, Uint8Array>;
    currentKeyVersion: number; csrfKey: Uint8Array; webOrigin: string; now?: () => number }) {
    this.sql = authStorageDatabase(options.sql); this.registry = options.registry; this.currentKeyVersion = authInteger(options.currentKeyVersion);
    if (this.currentKeyVersion > 999999999) throw new AppAuthError('auth_configuration_invalid');
    this.csrfKey = digestKey(options.csrfKey); this.origin = canonicalAuthOrigin(options.webOrigin); this.now = options.now ?? Date.now;
    this.host = new URL(this.origin).host;
    for (const [version, source] of options.sessionKeys) {
      authInteger(version); const key = digestKey(source);
      if (same(key, this.csrfKey) || [...this.keys.values()].some(old => same(old, key))) throw new AppAuthError('auth_configuration_invalid');
      this.keys.set(version, key);
    }
    if (!this.keys.has(this.currentKeyVersion)) throw new AppAuthError('auth_configuration_invalid');
  }
  private tokenDigest(token: string): { version: number; digest: Buffer } {
    const version = authInteger(Number(token.split('.')[1]));
    const key = this.keys.get(version);
    if (!key) throw new AppAuthError('auth_session_unavailable');
    return { version, digest: createHmac('sha256', key).update('rea/app-session/v1\0').update(token).digest() };
  }
  private csrfToken(id: string, generation: number): string {
    return createHmac('sha256', this.csrfKey).update('rea/app-csrf/v1\0').update(id).update('\0').update(String(generation)).digest('base64url');
  }
  private csrfDigest(token: string): Buffer { return createHash('sha256').update('rea/app-csrf-digest/v1\0').update(token).digest(); }
  private async read(token: string, sql: ControlTransaction = this.sql): Promise<Authorization> {
    const { version, digest } = this.tokenDigest(token);
    const { rows } = await sql.execute('SELECT * FROM app_sessions WHERE token_digest=? AND hash_key_version=?', [digest, version]);
    if (rows.length !== 1) throw new AppAuthError('auth_session_unavailable');
    const record = parseRecord(rows[0]!, authTime(this.now()));
    const assignment = await this.registry.forUser(record.userId, sql);
    if (assignment.userAuthEpoch !== record.userAuthEpoch) throw new AppAuthError('auth_session_unavailable');
    const csrf = this.csrfToken(record.id, record.generation);
    if (!same(this.csrfDigest(csrf), record.csrfDigest)) throw new AppAuthError('auth_session_unavailable');
    return Object.freeze({ record, assignment, csrf, coreAuthorized: false });
  }
  private proof(value: AuthorizedAppSession): Authorization {
    const proof = value && typeof value === 'object' ? this.proofs.get(value) : undefined;
    if (!proof) throw new AppAuthError('auth_session_unverified');
    return proof;
  }
  private branded(value: Authorization): AuthorizedAppSession {
    const result = Object.freeze(Object.create(null)) as AuthorizedAppSession; this.proofs.set(result, value); return result;
  }
  private async current(proof: Authorization, sql: ControlTransaction = this.sql): Promise<Authorization> {
    const { rows } = await sql.execute('SELECT * FROM app_sessions WHERE session_record_id=?', [proof.record.id]);
    if (rows.length !== 1) throw new AppAuthError('auth_session_unavailable');
    const record = parseRecord(rows[0]!, authTime(this.now())), assignment = await this.registry.forUser(record.userId, sql);
    if (record.generation !== proof.record.generation || record.userAuthEpoch !== assignment.userAuthEpoch ||
        JSON.stringify(assignment) !== JSON.stringify(proof.assignment) || !same(record.csrfDigest, proof.record.csrfDigest)) throw new AppAuthError('auth_session_unavailable');
    return Object.freeze({ ...proof, record, assignment });
  }
  async createSession(identity: VerifiedGoogleIdentity, options: { previousCookieHeader?: string } = {}): Promise<Readonly<{
    setCookie: string; csrfToken: string; session: AppSessionSummary }>> {
    // Only verifier-issued evidence reaches this path. Neither an email nor a
    // caller-provided user/tenant can provision or select an identity.
    const previousToken = tokenCookie(options.previousCookieHeader, true), now = authTime(this.now());
    return this.sql.transaction(async tx => {
      const assignment = await this.registry.forVerifiedIdentity(identity, tx);
      const token = `s1.${this.currentKeyVersion}.${randomBytes(32).toString('base64url')}`, { version, digest } = this.tokenDigest(token);
      const id = randomUUID(), generation = 1, csrf = this.csrfToken(id, generation), absoluteExpiry = now + absoluteMs;
      if (!Number.isSafeInteger(absoluteExpiry)) throw new AppAuthError('auth_record_invalid');
      if (previousToken) {
        const old = this.tokenDigest(previousToken);
        await tx.execute("UPDATE app_sessions SET state='revoked' WHERE token_digest=? AND hash_key_version=? AND state='active'", [old.digest, old.version]);
      }
      await tx.execute(`INSERT INTO app_sessions(session_record_id,token_digest,hash_key_version,user_id,user_auth_epoch,generation,authority_class,
        csrf_digest,state,created_ms,last_interactive_ms,idle_expires_ms,absolute_expires_ms) VALUES(?,?,?,?,?,?,'interactive-product',?,'active',?,?,?,?)`,
      [id, digest, version, assignment.userId, assignment.userAuthEpoch, generation, this.csrfDigest(csrf), now, now, now + idleMs, absoluteExpiry]);
      const record: SessionRecord = { id, userId: assignment.userId, userAuthEpoch: assignment.userAuthEpoch, generation, csrfDigest: this.csrfDigest(csrf),
        createdMs: now, lastInteractiveMs: now, idleExpiresMs: now + idleMs, absoluteExpiresMs: absoluteExpiry };
      return Object.freeze({ setCookie: `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${absoluteMs / 1000}`,
        csrfToken: csrf, session: sessionSummary(record, assignment) });
    });
  }
  async authenticate(cookieHeader: unknown): Promise<AuthorizedAppSession> { return this.branded(await this.read(tokenCookie(cookieHeader)!)); }
  /** Authenticated session bootstrap only; no Core/queue access is implied. */
  async sessionInfo(session: AuthorizedAppSession): Promise<Readonly<{ csrfToken: string; session: AppSessionSummary }>> {
    const p = await this.current(this.proof(session)); return Object.freeze({ csrfToken: p.csrf, session: sessionSummary(p.record, p.assignment) });
  }
  async authorizeCoreRequest(input: { cookieHeader: unknown; csrfHeader: unknown; origin: unknown; method: string; host?: unknown; fetchSite?: unknown }): Promise<AuthorizedAppSession> {
    if (Object.keys(input).some(k => !['cookieHeader', 'csrfHeader', 'origin', 'method', 'host', 'fetchSite'].includes(k))) throw new AppAuthError('auth_selector_forbidden');
    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(input.method);
    if (input.host !== this.host || (input.fetchSite !== undefined && input.fetchSite !== 'same-origin') ||
        (input.origin !== undefined && input.origin !== this.origin) || (!safeMethod && input.origin !== this.origin)) throw new AppAuthError('auth_origin_invalid');
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(input.method) ||
        typeof input.csrfHeader !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.csrfHeader)) throw new AppAuthError('auth_csrf_invalid');
    const p = await this.read(tokenCookie(input.cookieHeader)!);
    if (!same(this.csrfDigest(input.csrfHeader), p.record.csrfDigest)) throw new AppAuthError('auth_csrf_invalid');
    return this.branded(Object.freeze({ ...p, coreAuthorized: true }));
  }
  /** A snapshot is safe metadata for later trusted command integration, not a
   * bearer capability. This step does not authorize any existing command log. */
  async commandAuthorization(session: AuthorizedAppSession): Promise<CommandAuthorization> {
    const proof = this.proof(session);
    if (!proof.coreAuthorized) throw new AppAuthError('auth_csrf_required');
    const p = await this.current(proof); return authorizationSnapshot(p.record, p.assignment);
  }
  async requireRecentAuthentication(session: AuthorizedAppSession): Promise<void> {
    const p = await this.current(this.proof(session)), now = authTime(this.now());
    if (now < p.record.createdMs || now - p.record.createdMs >= recentMs || now >= p.record.idleExpiresMs || now >= p.record.absoluteExpiresMs) throw new AppAuthError('auth_recent_login_required');
  }
  /** Server-classified user activity only. Polling must never call this. */
  async recordInteractiveActivity(session: AuthorizedAppSession): Promise<void> {
    const p = this.proof(session);
    if (!p.coreAuthorized) throw new AppAuthError('auth_csrf_required');
    await this.sql.transaction(async tx => {
      const { record: current } = await this.current(p, tx), now = authTime(this.now());
      if (now < current.lastInteractiveMs) throw new AppAuthError('auth_record_invalid');
      const changed = await tx.execute("UPDATE app_sessions SET last_interactive_ms=?,idle_expires_ms=? WHERE session_record_id=? AND state='active' AND generation=?",
        [now, Math.min(now + idleMs, current.absoluteExpiresMs), current.id, current.generation]);
      if (changed.rowsAffected !== 1) throw new AppAuthError('auth_session_unavailable');
    });
  }
  async revoke(session: AuthorizedAppSession): Promise<Readonly<{ setCookie: string }>> {
    const p = this.proof(session);
    if (!p.coreAuthorized) throw new AppAuthError('auth_csrf_required');
    await this.sql.transaction(async tx => {
      const { record } = await this.current(p, tx);
      const changed = await tx.execute("UPDATE app_sessions SET state='revoked' WHERE session_record_id=? AND generation=? AND state='active'", [record.id, record.generation]);
      if (changed.rowsAffected !== 1) throw new AppAuthError('auth_session_unavailable');
    });
    return Object.freeze({ setCookie: `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
  }
}
