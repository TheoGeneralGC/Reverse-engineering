import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ControlSql, ControlTransaction, SqlRow } from './authority.ts';
import { GoogleLoginIdentityVerifier, readVerifiedIdentity } from './auth-identity.ts';
import { PinnedGoogleOidcVerifier, GOOGLE_OIDC } from './auth-google-oidc.ts';
import { AppSessionAuthority } from './auth-sessions.ts';
import type { PersonalAssignment } from './auth-registry.ts';
import { AppAuthError, authInteger, authRef, authStorageDatabase, authTime, canonicalAuthOrigin } from './auth-values.ts';

type Purpose = 'login' | 'owner-identity-proof';
type SessionOptions = Omit<ConstructorParameters<typeof AppSessionAuthority>[0], 'sql' | 'now'>;
type SessionExpectation = Readonly<{ recordId: string; generation: number; assignment: PersonalAssignment }>;
type Attempt = Readonly<{ stateDigest: Buffer; browserDigest: Buffer; browserGeneration: number; sessionCookieDigest: Buffer | null; session: SessionExpectation | null;
  purpose: Purpose; clientId: string; callback: string; createdMs: number; expiresMs: number; sealed: Buffer | null; claimId: string | null; state: string }>;
type BrowserInput = { browserCookieHeader: unknown; sessionCookieHeader?: unknown; host: unknown; origin?: unknown; fetchSite?: unknown };
type SessionResult = Awaited<ReturnType<AppSessionAuthority['createSession']>>;
export type LoginBrokerResult = Readonly<{ purpose: 'login'; session: SessionResult }> | Readonly<{ purpose: 'owner-identity-proof'; identity: Readonly<{
  issuer: 'https://accounts.google.com'; subject: string; verifiedAtMs: number }> }>;
const browserName = '__Host-rea_login_browser', sessionName = '__Host-rea_session', lifetime = 10 * 60_000;
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.byteLength === b.byteLength && timingSafeEqual(a, b); }
function key(value: Uint8Array): Buffer { if (!(value instanceof Uint8Array) || value.byteLength !== 32) throw new AppAuthError('auth_configuration_invalid'); return Buffer.from(value); }
function visible(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x20\x7f]/.test(value)) throw new AppAuthError('auth_login_input_invalid'); return value;
}
function cookie(header: unknown, name: string, required: boolean): string | null {
  if (header === undefined || header === '') { if (!required) return null; throw new AppAuthError('auth_login_binding_invalid'); }
  if (typeof header !== 'string' || header.length > 8192 || /[\x00-\x1f\x7f]/.test(header)) throw new AppAuthError('auth_login_binding_invalid');
  const rows = header.split(';').map(s => s.trim()).filter(s => s.split('=', 1)[0] === name);
  if (!rows.length && !required) return null;
  if (rows.length !== 1) throw new AppAuthError('auth_login_binding_invalid');
  const value = rows[0]!.slice(name.length + 1), pattern = name === browserName ? /^b1\.[A-Za-z0-9_-]{43}$/ : /^s1\.[1-9][0-9]{0,8}\.[A-Za-z0-9_-]{43}$/;
  if (rows[0] !== `${name}=${value}` || !pattern.test(value)) throw new AppAuthError('auth_login_binding_invalid');
  const encoded = value.split('.').at(-1)!;
  if (Buffer.from(encoded, 'base64url').toString('base64url') !== encoded) throw new AppAuthError('auth_login_binding_invalid');
  return value;
}
function binary(value: unknown, nullable = false): Buffer | null {
  if (value === null && nullable) return null;
  if (!(value instanceof Uint8Array) || !value.byteLength) throw new AppAuthError('auth_login_record_invalid'); return Buffer.from(value);
}
function immutable(a: Attempt) {
  return { state: a.stateDigest.toString('hex'), browser: a.browserDigest.toString('hex'), browserGeneration: a.browserGeneration, sessionCookie: a.sessionCookieDigest?.toString('hex') ?? null,
    session: a.session, purpose: a.purpose, clientId: a.clientId, callback: a.callback, createdMs: a.createdMs, expiresMs: a.expiresMs };
}
function sameAttempt(a: Attempt, b: Attempt): boolean { return JSON.stringify(immutable(a)) === JSON.stringify(immutable(b)); }

/** No routes/schema defaults. A claimed callback owns one exchange and at most
 * one confirmed session/proof publication; there is no resume/retry API. */
export class OneUseGoogleLoginBroker {
  private readonly sql: ControlSql;
  private readonly purpose: Purpose;
  private readonly clientId: string;
  private readonly callbackUri: string;
  private readonly origin: string;
  private readonly host: string;
  private readonly browserKey: Buffer;
  private readonly csrfKey: Buffer;
  private readonly sealKey: Buffer;
  private readonly now: () => number;
  private readonly options: SessionOptions;
  private readonly sessions: AppSessionAuthority;
  private readonly verifier: GoogleLoginIdentityVerifier;
  constructor(options: { sql: ControlSql; purpose: Purpose; clientId: string; clientSecret: string; callbackUri: string;
    browserHmacKey: Uint8Array; preauthCsrfKey: Uint8Array; attemptSealKey: Uint8Array; sessions: SessionOptions; now?: () => number; fetcher?: typeof fetch }) {
    this.sql = authStorageDatabase(options.sql); this.purpose = options.purpose;
    if (!['login', 'owner-identity-proof'].includes(this.purpose)) throw new AppAuthError('auth_configuration_invalid');
    this.clientId = visible(options.clientId, 512); this.callbackUri = options.callbackUri;
    this.origin = canonicalAuthOrigin(options.sessions.webOrigin); this.host = new URL(this.origin).host;
    if (this.callbackUri !== `${this.origin}/api/auth/google/callback`) throw new AppAuthError('auth_configuration_invalid');
    this.browserKey = key(options.browserHmacKey); this.csrfKey = key(options.preauthCsrfKey); this.sealKey = key(options.attemptSealKey);
    const allKeys = [this.browserKey, this.csrfKey, this.sealKey, options.sessions.csrfKey, ...options.sessions.sessionKeys.values()];
    if (allKeys.some((a, i) => allKeys.slice(i + 1).some(b => equal(a, b)))) throw new AppAuthError('auth_configuration_invalid');
    this.now = options.now ?? Date.now;
    this.options = { ...options.sessions, sessionKeys: new Map([...options.sessions.sessionKeys].map(([v, k]) => [v, Buffer.from(k)])), csrfKey: Buffer.from(options.sessions.csrfKey) };
    this.sessions = new AppSessionAuthority({ ...this.options, sql: this.sql, now: this.now });
    this.verifier = new GoogleLoginIdentityVerifier({ clientId: this.clientId, redirectUri: this.callbackUri, now: this.now,
      port: new PinnedGoogleOidcVerifier({ clientId: this.clientId, clientSecret: options.clientSecret, callbackUri: this.callbackUri, fetcher: options.fetcher }) });
  }
  private digest(domain: string, value: string): Buffer { return createHmac('sha256', this.browserKey).update(`rea/login/${domain}/v1\0`).update(value).digest(); }
  private browserCsrf(value: string): string { return createHmac('sha256', this.csrfKey).update('rea/login/preauth-csrf/v1\0').update(value).digest('base64url'); }
  private browser(input: BrowserInput, start: boolean): { browser: Buffer; sessionCookie: Buffer | null } {
    if (input.host !== this.host || input.origin !== undefined && input.origin !== this.origin || start && (input.origin !== this.origin ||
        input.fetchSite !== undefined && input.fetchSite !== 'same-origin')) throw new AppAuthError('auth_login_binding_invalid');
    const browser = cookie(input.browserCookieHeader, browserName, true)!, session = cookie(input.sessionCookieHeader, sessionName, false);
    return { browser: this.digest('browser', browser), sessionCookie: session ? this.digest('session-cookie', session) : null };
  }
  private aad(a: Attempt): Buffer { return Buffer.from(JSON.stringify(immutable(a))); }
  private seal(a: Attempt, secrets: { nonce: string; verifier: string }): Buffer {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.sealKey, iv); cipher.setAAD(this.aad(a));
    const plain = Buffer.from(JSON.stringify(secrets));
    try { const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]); return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]); }
    finally { plain.fill(0); }
  }
  private unseal(a: Attempt): { nonce: string; verifier: string } {
    try {
      if (!a.sealed || a.sealed.byteLength < 30 || a.sealed.byteLength > 2048 || a.sealed[0] !== 1) throw Error();
      const decipher = createDecipheriv('aes-256-gcm', this.sealKey, a.sealed.subarray(1, 13)); decipher.setAAD(this.aad(a)); decipher.setAuthTag(a.sealed.subarray(13, 29));
      const plain = Buffer.concat([decipher.update(a.sealed.subarray(29)), decipher.final()]);
      try { const value = JSON.parse(plain.toString('utf8'));
        if (Object.keys(value).sort().join(',') !== 'nonce,verifier' || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier)) throw Error();
        return { nonce: value.nonce, verifier: value.verifier };
      } finally { plain.fill(0); }
    } catch { throw new AppAuthError('auth_login_record_invalid'); }
  }
  private row(row: SqlRow): Attempt {
    let session: SessionExpectation | null;
    try { session = JSON.parse(String(row.session_binding_json)); } catch { throw new AppAuthError('auth_login_record_invalid'); }
    if (session !== null && (!session || typeof session !== 'object' || Object.keys(session).sort().join(',') !== 'assignment,generation,recordId' ||
      !session.assignment || typeof session.assignment !== 'object')) throw new AppAuthError('auth_login_record_invalid');
    if (session) { authRef(session.recordId); authInteger(session.generation); }
    const a: Attempt = Object.freeze({ stateDigest: binary(row.state_digest)!, browserDigest: binary(row.browser_digest)!, browserGeneration: authInteger(row.browser_generation), sessionCookieDigest: binary(row.session_cookie_digest, true), session,
      purpose: row.purpose as Purpose, clientId: String(row.client_id), callback: String(row.callback_uri), createdMs: authTime(row.created_ms), expiresMs: authTime(row.expires_ms),
      sealed: binary(row.sealed, true), claimId: row.claim_id === null ? null : authRef(row.claim_id), state: String(row.state) });
    if (a.stateDigest.length !== 32 || a.browserDigest.length !== 32 || a.sessionCookieDigest !== null && a.sessionCookieDigest.length !== 32 ||
        (a.session === null) !== (a.sessionCookieDigest === null) || a.purpose !== this.purpose || a.clientId !== this.clientId || a.callback !== this.callbackUri ||
        a.expiresMs - a.createdMs !== lifetime || !['pending', 'exchanging', 'consumed', 'failed'].includes(a.state)) throw new AppAuthError('auth_login_record_invalid');
    return a;
  }
  private async assertInitiator(tx: ControlTransaction, a: Attempt, checkBrowser = true): Promise<void> {
    const now = authTime(this.now());
    if (a.createdMs > now || now >= a.expiresMs) throw new AppAuthError('auth_login_expired');
    if (checkBrowser) {
      const { rows } = await tx.execute('SELECT generation FROM auth_login_browsers WHERE browser_digest=?', [a.browserDigest]);
      if (rows.length !== 1 || authInteger(rows[0]!.generation) !== a.browserGeneration) throw new AppAuthError('auth_login_browser_changed');
    }
    if (!a.session) return;
    const { rows } = await tx.execute('SELECT * FROM app_sessions WHERE session_record_id=?', [a.session.recordId]);
    const s = rows[0];
    if (rows.length !== 1 || !s || s.state !== 'active' || s.authority_class !== 'interactive-product' || s.user_id !== a.session.assignment.userId ||
        authInteger(s.generation) !== a.session.generation || authInteger(s.user_auth_epoch) !== a.session.assignment.userAuthEpoch ||
        authTime(s.created_ms) > now || authTime(s.idle_expires_ms) <= now || authTime(s.absolute_expires_ms) <= now) throw new AppAuthError('auth_login_initiator_changed');
    const assignment = await this.options.registry.forUser(a.session.assignment.userId, tx);
    if (JSON.stringify(assignment) !== JSON.stringify(a.session.assignment)) throw new AppAuthError('auth_login_initiator_changed');
  }
  private async claimCurrent(tx: ControlTransaction, claimed: Attempt): Promise<Attempt> {
    const { rows } = await tx.execute('SELECT * FROM auth_login_attempts WHERE state_digest=?', [claimed.stateDigest]);
    if (rows.length !== 1) throw new AppAuthError('auth_login_claim_unavailable');
    const current = this.row(rows[0]!);
    if (!sameAttempt(current, claimed) || current.state !== 'exchanging' || current.claimId !== claimed.claimId || current.sealed !== null) throw new AppAuthError('auth_login_claim_unavailable');
    await this.assertInitiator(tx, current); return current;
  }
  bootstrapBrowser(): Readonly<{ setCookie: string; csrfToken: string }> {
    const value = `b1.${randomBytes(32).toString('base64url')}`;
    return Object.freeze({ setCookie: `${browserName}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`, csrfToken: this.browserCsrf(value) });
  }
  async start(input: BrowserInput & { csrfHeader: unknown }): Promise<Readonly<{ authorizationUrl: string; expiresMs: number }>> {
    const bound = this.browser(input, true), browserValue = cookie(input.browserCookieHeader, browserName, true)!;
    if (typeof input.csrfHeader !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.csrfHeader) || !equal(Buffer.from(input.csrfHeader), Buffer.from(this.browserCsrf(browserValue)))) throw new AppAuthError('auth_login_csrf_invalid');
    let session: SessionExpectation | null = null;
    if (bound.sessionCookie) {
      const info = await this.sessions.sessionInfo(await this.sessions.authenticate(input.sessionCookieHeader));
      session = Object.freeze({ recordId: info.session.sessionRecordId, generation: info.session.sessionGeneration, assignment: await this.options.registry.forUser(info.session.userId) });
    }
    const prefix = this.purpose === 'login' ? 'rea-login-v1.' : 'rea-proof-v1.', state = prefix + randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url'), now = authTime(this.now());
    const initial: Attempt = { stateDigest: this.digest('state', state), browserDigest: bound.browser, browserGeneration: 0, sessionCookieDigest: bound.sessionCookie, session,
      purpose: this.purpose, clientId: this.clientId, callback: this.callbackUri, createdMs: now, expiresMs: now + lifetime, sealed: null, claimId: null, state: 'pending' };
    const a = await this.sql.transaction(async tx => {
      await this.assertInitiator(tx, initial, false);
      const { rows } = await tx.execute("SELECT count(*) AS n FROM auth_login_attempts WHERE browser_digest=? AND state='pending' AND expires_ms>?", [initial.browserDigest, now]);
      if (authInteger(rows[0]?.n, 0) >= 4) throw new AppAuthError('auth_login_limit');
      const old = await tx.execute('SELECT generation FROM auth_login_browsers WHERE browser_digest=?', [initial.browserDigest]);
      const generation = old.rows.length ? authInteger(old.rows[0]!.generation) + 1 : 1; authInteger(generation);
      if (old.rows.length) await tx.execute('UPDATE auth_login_browsers SET generation=? WHERE browser_digest=?', [generation, initial.browserDigest]);
      else await tx.execute('INSERT INTO auth_login_browsers VALUES(?,?)', [initial.browserDigest, generation]);
      const current = Object.freeze({ ...initial, browserGeneration: generation }), sealed = this.seal(current, { nonce, verifier });
      await tx.execute(`INSERT INTO auth_login_attempts(state_digest,browser_digest,browser_generation,session_cookie_digest,session_binding_json,purpose,
        client_id,callback_uri,created_ms,expires_ms,state,claim_id,sealed,outcome_session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [current.stateDigest, current.browserDigest, current.browserGeneration, current.sessionCookieDigest,
        JSON.stringify(current.session), current.purpose, current.clientId, current.callback, current.createdMs, current.expiresMs, 'pending', null, sealed, null]);
      return current;
    });
    const authorization = new URL(GOOGLE_OIDC.authorization);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: this.clientId, redirect_uri: this.callbackUri, scope: 'openid email', state, nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' })) authorization.searchParams.set(k, v);
    return Object.freeze({ authorizationUrl: authorization.href, expiresMs: a.expiresMs });
  }
  async callback(input: BrowserInput & { state: string; code: string }): Promise<LoginBrokerResult> {
    const bound = this.browser(input, false), state = visible(input.state, 128), code = visible(input.code, 4096), prefix = this.purpose === 'login' ? 'rea-login-v1.' : 'rea-proof-v1.';
    const previousCookieHeader = typeof input.sessionCookieHeader === 'string' ? input.sessionCookieHeader : undefined;
    if (!state.startsWith(prefix) || !/^[A-Za-z0-9_-]{43}$/.test(state.slice(prefix.length))) throw new AppAuthError('auth_login_state_invalid');
    // A failed/unknown claim transaction is deliberately outside the exchange
    // catch. It can never enter exchange or terminalization by lookup/retry.
    const claimed = await this.sql.transaction(async tx => {
      const { rows } = await tx.execute('SELECT * FROM auth_login_attempts WHERE state_digest=?', [this.digest('state', state)]);
      if (rows.length !== 1) throw new AppAuthError('auth_login_state_unavailable');
      const a = this.row(rows[0]!);
      if (a.state !== 'pending' || a.claimId !== null || !a.sealed || !equal(a.browserDigest, bound.browser) ||
          (a.sessionCookieDigest === null ? bound.sessionCookie !== null : bound.sessionCookie === null || !equal(a.sessionCookieDigest, bound.sessionCookie))) throw new AppAuthError('auth_login_state_unavailable');
      await this.assertInitiator(tx, a);
      const claimId = randomUUID();
      const changed = await tx.execute("UPDATE auth_login_attempts SET state='exchanging',claim_id=?,sealed=NULL WHERE state_digest=? AND state='pending' AND claim_id IS NULL", [claimId, a.stateDigest]);
      if (changed.rowsAffected !== 1) throw new AppAuthError('auth_login_state_unavailable');
      return Object.freeze({ ...a, claimId, state: 'exchanging' });
    });
    try {
      const secrets = this.unseal(claimed);
      const identity = await this.verifier.verify({ code, state }, { state, nonce: secrets.nonce, codeVerifier: secrets.verifier, expiresAtMs: claimed.expiresMs });
      if (this.purpose === 'owner-identity-proof') {
        const c = readVerifiedIdentity(identity);
        await this.sql.transaction(async tx => { await this.claimCurrent(tx, claimed);
          authInteger(claimed.browserGeneration + 1);
          const changed = await tx.execute("UPDATE auth_login_attempts SET state='consumed' WHERE state_digest=? AND state='exchanging' AND claim_id=?", [claimed.stateDigest, claimed.claimId]);
          if (changed.rowsAffected !== 1) throw new AppAuthError('auth_login_claim_unavailable');
          await tx.execute('UPDATE auth_login_browsers SET generation=generation+1 WHERE browser_digest=? AND generation=?', [claimed.browserDigest, claimed.browserGeneration]); });
        return Object.freeze({ purpose: 'owner-identity-proof', identity: Object.freeze({ issuer: c.issuer, subject: c.subject, verifiedAtMs: c.verifiedAtMs }) });
      }
      let entered = false;
      const guarded: ControlSql = { async execute() { throw new AppAuthError('auth_login_issuer_scope_invalid'); }, transaction: async work => {
        if (entered) throw new AppAuthError('auth_login_issuer_scope_invalid'); entered = true;
        return this.sql.transaction(async tx => {
          await this.claimCurrent(tx, claimed);
          const result = await work(tx);
          const summary = (result as SessionResult).session;
          authRef(summary.sessionRecordId);
          authInteger(claimed.browserGeneration + 1);
          if (authTime(this.now()) >= claimed.expiresMs) throw new AppAuthError('auth_login_expired');
          const changed = await tx.execute("UPDATE auth_login_attempts SET state='consumed',outcome_session_id=? WHERE state_digest=? AND state='exchanging' AND claim_id=?", [summary.sessionRecordId, claimed.stateDigest, claimed.claimId]);
          if (changed.rowsAffected !== 1) throw new AppAuthError('auth_login_claim_unavailable');
          await tx.execute('UPDATE auth_login_browsers SET generation=generation+1 WHERE browser_digest=? AND generation=?', [claimed.browserDigest, claimed.browserGeneration]);
          return result;
        });
      } };
      const issuer = new AppSessionAuthority({ ...this.options, sql: guarded, now: this.now });
      const sessionResult = await issuer.createSession(identity, previousCookieHeader ? { previousCookieHeader } : {});
      return Object.freeze({ purpose: 'login', session: sessionResult });
    } catch (error) {
      // An unknown final commit may already have consumed/minted. Do not make a
      // second SQL decision or return a cookie/evidence under that ambiguity.
      if (error instanceof AppAuthError && error.code === 'auth_storage_outcome_unknown') throw new AppAuthError('auth_login_outcome_unknown');
      try { await this.sql.transaction(async tx => { await tx.execute("UPDATE auth_login_attempts SET state='failed' WHERE state_digest=? AND state='exchanging' AND claim_id=?", [claimed.stateDigest, claimed.claimId]); }); }
      catch { /* Retain the non-replayable claimed state if terminalization is unavailable. */ }
      throw new AppAuthError('auth_login_failed');
    }
  }
}
