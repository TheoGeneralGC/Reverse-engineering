import { timingSafeEqual } from 'node:crypto';
import { AppAuthError, authTime } from './auth-values.ts';

export type GoogleVerifiedClaims = Readonly<{
  issuer: string; subject: string; audience: string | readonly string[]; authorizedParty?: string;
  expiresAtSeconds: number; issuedAtSeconds: number; nonce: string; displayEmail?: string;
}>;
/** Trusted server integration port. A future pinned OIDC library must verify the
 * signature/algorithm/JWKS and code flow before returning these claims. This
 * module implements claim policy, NOT a cryptographic OIDC verifier. */
export interface GoogleCodeVerifierPort {
  exchangeAndVerify(input: Readonly<{ code: string; redirectUri: string; clientId: string;
    expectedNonce: string; expectedState: string; codeVerifier: string }>): Promise<GoogleVerifiedClaims>;
}
export type GoogleLoginAttempt = Readonly<{ state: string; nonce: string; codeVerifier: string; expiresAtMs: number }>;
declare const verifiedIdentity: unique symbol;
export type VerifiedGoogleIdentity = Readonly<{ [verifiedIdentity]: true }>;
export type IdentityClaims = Readonly<{ issuer: 'https://accounts.google.com'; subject: string; displayEmail?: string; verifiedAtMs: number }>;
const evidence = new WeakMap<object, IdentityClaims>();
function bounded(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\x00-\x20\x7f]/.test(value)) throw new AppAuthError('auth_identity_invalid');
  return value;
}
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
export function readVerifiedIdentity(value: VerifiedGoogleIdentity): IdentityClaims {
  const claims = value && typeof value === 'object' ? evidence.get(value) : undefined;
  if (!claims) throw new AppAuthError('auth_identity_unverified');
  return claims;
}
export class GoogleLoginIdentityVerifier {
  private readonly port: GoogleCodeVerifierPort;
  private readonly clientId: string;
  private readonly redirectUri: string;
  private readonly now: () => number;
  constructor(options: { port: GoogleCodeVerifierPort; clientId: string; redirectUri: string; now?: () => number }) {
    this.port = options.port; this.clientId = bounded(options.clientId, 512); this.redirectUri = options.redirectUri; this.now = options.now ?? Date.now;
    let uri: URL;
    try { uri = new URL(this.redirectUri); } catch { throw new AppAuthError('auth_configuration_invalid'); }
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.search || uri.hash || uri.href !== this.redirectUri ||
        !this.port || typeof this.port.exchangeAndVerify !== 'function') throw new AppAuthError('auth_configuration_invalid');
  }
  async verify(input: { code: string; state: string }, attempt: GoogleLoginAttempt): Promise<VerifiedGoogleIdentity> {
    const now = authTime(this.now()), code = bounded(input.code, 4096), state = bounded(input.state, 512);
    const expectedState = bounded(attempt.state, 512), nonce = bounded(attempt.nonce, 512), codeVerifier = bounded(attempt.codeVerifier, 128), expiresAtMs = authTime(attempt.expiresAtMs);
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) || expiresAtMs <= now || !equal(state, expectedState)) throw new AppAuthError('auth_login_attempt_invalid');
    // Copy trusted expected values before awaiting the external verifier.
    let claims: GoogleVerifiedClaims;
    try { claims = await this.port.exchangeAndVerify(Object.freeze({ code, redirectUri: this.redirectUri, clientId: this.clientId,
      expectedNonce: nonce, expectedState, codeVerifier })); }
    catch { throw new AppAuthError('auth_identity_verification_failed'); }
    const checkedAt = authTime(this.now());
    if (checkedAt >= expiresAtMs || !claims || typeof claims !== 'object') throw new AppAuthError('auth_identity_invalid');
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.issuer)) throw new AppAuthError('auth_identity_invalid');
    const subject = bounded(claims.subject, 255), audiences = typeof claims.audience === 'string' ? [claims.audience] : claims.audience;
    if (!Array.isArray(audiences) || !audiences.length || audiences.some(a => typeof a !== 'string' || !a) ||
        new Set(audiences).size !== audiences.length || !audiences.includes(this.clientId) ||
        (audiences.length > 1 && claims.authorizedParty !== this.clientId) ||
        (claims.authorizedParty !== undefined && claims.authorizedParty !== this.clientId) ||
        typeof claims.nonce !== 'string' || !equal(claims.nonce, nonce)) throw new AppAuthError('auth_identity_invalid');
    const expiry = authTime(claims.expiresAtSeconds), issued = authTime(claims.issuedAtSeconds), seconds = Math.floor(checkedAt / 1000);
    if (expiry <= seconds || issued > seconds + 60 || issued >= expiry) throw new AppAuthError('auth_identity_invalid');
    const displayEmail = claims.displayEmail === undefined ? undefined : bounded(claims.displayEmail, 320);
    const result = Object.freeze(Object.create(null)) as VerifiedGoogleIdentity;
    evidence.set(result, Object.freeze({ issuer: 'https://accounts.google.com', subject, ...(displayEmail ? { displayEmail } : {}), verifiedAtMs: checkedAt }));
    return result;
  }
}
