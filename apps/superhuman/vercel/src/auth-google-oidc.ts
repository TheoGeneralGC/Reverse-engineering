import * as oidc from 'openid-client';
import type { GoogleCodeVerifierPort, GoogleVerifiedClaims } from './auth-identity.ts';
import { AppAuthError, canonicalAuthOrigin } from './auth-values.ts';

export const GOOGLE_OIDC = Object.freeze({ issuer: 'https://accounts.google.com', authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' });
type ExchangeInput = Parameters<GoogleCodeVerifierPort['exchangeAndVerify']>[0];
type CallbackChecks = Readonly<{ expectedState: string; expectedNonce: string; codeVerifier: string }>;
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x20\x7f]/.test(value)) throw new AppAuthError('auth_oidc_input_invalid');
  return value;
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AppAuthError('auth_oidc_timeout'));
  return new Promise((resolve, reject) => {
    const stop = () => reject(new AppAuthError('auth_oidc_timeout'));
    signal.addEventListener('abort', stop, { once: true });
    pending.then(value => { signal.removeEventListener('abort', stop); resolve(value); }, error => { signal.removeEventListener('abort', stop); reject(error); });
  });
}
async function boundedResponse(response: Response, limit: number, signal: AbortSignal): Promise<Response> {
  if (response.redirected || response.status < 200 || response.status >= 500 || response.status >= 300 && response.status < 400 ||
      !/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new AppAuthError('auth_oidc_response_invalid');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]{1,10}$/.test(declared) || Number(declared) > limit)) throw new AppAuthError('auth_oidc_response_invalid');
  const reader = response.body?.getReader();
  if (!reader) throw new AppAuthError('auth_oidc_response_invalid');
  let size = 0, done = false;
  const chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const item = await abortable(reader.read(), signal); signal.throwIfAborted();
      if (item.done) { done = true; break; }
      size += item.value.byteLength; if (size > limit) throw new AppAuthError('auth_oidc_response_invalid'); chunks.push(item.value);
    }
    if (!size || declared !== null && Number(declared) !== size) throw new AppAuthError('auth_oidc_response_invalid');
    return new Response(Buffer.concat(chunks), { status: response.status, headers: { 'content-type': 'application/json' } });
  } finally { signal.removeEventListener('abort', abort); if (!done) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Disabled adapter. Its only IO uses explicitly known Google endpoints. The
 * signature option is deliberate: plain direct ID-token processing alone does
 * not promise JWS verification in this library. No discovery or refresh runs. */
export class PinnedGoogleOidcVerifier implements GoogleCodeVerifierPort {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callback: string;
  private readonly fetcher: typeof fetch;
  constructor(options: { clientId: string; clientSecret: string; callbackUri: string; fetcher?: typeof fetch }) {
    this.clientId = text(options.clientId, 512); this.clientSecret = text(options.clientSecret, 2048);
    this.callback = options.callbackUri; this.fetcher = options.fetcher ?? globalThis.fetch;
    let callback: URL;
    try { callback = new URL(this.callback); } catch { throw new AppAuthError('auth_configuration_invalid'); }
    canonicalAuthOrigin(callback.origin);
    if (callback.href !== this.callback || callback.username || callback.password || callback.search || callback.hash ||
        callback.pathname !== '/api/auth/google/callback') throw new AppAuthError('auth_configuration_invalid');
  }
  async exchangeAndVerify(input: ExchangeInput): Promise<GoogleVerifiedClaims> {
    if (input.clientId !== this.clientId || input.redirectUri !== this.callback) throw new AppAuthError('auth_oidc_input_invalid');
    const url = new URL(this.callback); url.searchParams.set('code', input.code); url.searchParams.set('state', input.expectedState);
    return this.verifyCallbackResponse(url, input);
  }
  /** The future purpose dispatcher can pass the actual canonical callback URL.
   * Claims returned here are not the unforgeable app identity evidence. */
  async verifyCallbackResponse(callbackUrl: URL, checks: CallbackChecks): Promise<GoogleVerifiedClaims> {
    try {
      const url = new URL(callbackUrl.href), expectedState = text(checks.expectedState, 512), expectedNonce = text(checks.expectedNonce, 512), verifier = text(checks.codeVerifier, 128);
      if (`${url.origin}${url.pathname}` !== this.callback || url.username || url.password || url.hash ||
          url.href.length > 8192 || [...url.searchParams].length > 32 || url.searchParams.getAll('code').length !== 1 ||
          url.searchParams.getAll('state').length !== 1 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new AppAuthError('auth_oidc_input_invalid');
      for (const [name, value] of url.searchParams) if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new AppAuthError('auth_oidc_input_invalid');
      if (url.searchParams.has('error') || url.searchParams.getAll('iss').length > 1 ||
          url.searchParams.has('iss') && url.searchParams.get('iss') !== GOOGLE_OIDC.issuer) throw new AppAuthError('auth_oidc_input_invalid');
      const code = text(url.searchParams.get('code'), 4096), actualState = text(url.searchParams.get('state'), 512);
      // OAuth responses may include Google scope/authuser/hd/prompt and unknown
      // metadata. Bound then discard it; only signed claims establish identity.
      const normalized = new URL(this.callback); normalized.searchParams.set('code', code); normalized.searchParams.set('state', actualState);
      const config = new oidc.Configuration({ issuer: GOOGLE_OIDC.issuer, authorization_endpoint: GOOGLE_OIDC.authorization,
        token_endpoint: GOOGLE_OIDC.token, jwks_uri: GOOGLE_OIDC.jwks, response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'] }, this.clientId,
      { client_secret: this.clientSecret, id_token_signed_response_alg: 'RS256', [oidc.clockTolerance]: 0 }, oidc.ClientSecretPost(this.clientSecret));
      config.timeout = 10;
      oidc.enableNonRepudiationChecks(config);
      const deadline = AbortSignal.timeout(10_000);
      let tokenCalls = 0, jwksCalls = 0;
      config[oidc.customFetch] = async (target, init) => {
        const endpoint = String(target), method = init?.method ?? 'GET', headers = new Headers(init?.headers);
        if (headers.has('cookie') || headers.has('authorization') || headers.has('origin') || headers.has('referer')) throw new AppAuthError('auth_oidc_endpoint_invalid');
        if (endpoint === GOOGLE_OIDC.token && method === 'POST') {
          if (++tokenCalls !== 1 || !(init?.body instanceof URLSearchParams)) throw new AppAuthError('auth_oidc_endpoint_invalid');
          const body = init.body;
          const expected: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: this.callback,
            client_id: this.clientId, client_secret: this.clientSecret, code_verifier: verifier };
          if ([...body.keys()].length !== Object.keys(expected).length || Object.entries(expected).some(([k, v]) => body.getAll(k).length !== 1 || body.get(k) !== v)) throw new AppAuthError('auth_oidc_endpoint_invalid');
        } else if (endpoint === GOOGLE_OIDC.jwks && method === 'GET' && init?.body == null) {
          if (++jwksCalls > 2) throw new AppAuthError('auth_oidc_endpoint_invalid');
        } else throw new AppAuthError('auth_oidc_endpoint_invalid');
        const signal = init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
        signal.throwIfAborted();
        const body = endpoint === GOOGLE_OIDC.token ? new URLSearchParams(init.body as URLSearchParams) : undefined;
        const pending = this.fetcher(endpoint, { method, headers, body, signal, redirect: 'manual', credentials: 'omit' });
        void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => undefined); }, () => undefined);
        const response = await abortable(pending, signal);
        signal.throwIfAborted();
        return boundedResponse(response, endpoint === GOOGLE_OIDC.token ? 256 * 1024 : 1024 * 1024, signal);
      };
      const tokens = await oidc.authorizationCodeGrant(config, normalized, { expectedNonce, expectedState, pkceCodeVerifier: verifier, idTokenExpected: true });
      const c = tokens.claims();
      if (!c || typeof c.iss !== 'string' || typeof c.sub !== 'string' || !(typeof c.aud === 'string' || Array.isArray(c.aud)) ||
          typeof c.exp !== 'number' || typeof c.iat !== 'number' || typeof c.nonce !== 'string') throw new AppAuthError('auth_oidc_claims_invalid');
      return Object.freeze({ issuer: c.iss, subject: c.sub, audience: typeof c.aud === 'string' ? c.aud : Object.freeze([...c.aud]),
        ...(typeof c.azp === 'string' ? { authorizedParty: c.azp } : {}), expiresAtSeconds: c.exp, issuedAtSeconds: c.iat, nonce: c.nonce,
        ...(typeof c.email === 'string' ? { displayEmail: c.email } : {}) });
    } catch { throw new AppAuthError('auth_oidc_verification_failed'); }
  }
}
