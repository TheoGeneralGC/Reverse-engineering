import '../../api/test/archive-network-deny.ts';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { GOOGLE_OIDC } from '../src/auth-google-oidc.ts';

export const origin = 'https://mail.example.test', callbackUri = `${origin}/api/auth/google/callback`, clientId = 'synthetic-client.apps.googleusercontent.com', clientSecret = 'synthetic-client-secret';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }), other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
export type Registration = { nonce: string; challenge: string; subject?: string; claims?: Record<string, unknown>; badSignature?: boolean; algorithm?: string;
  omitIdToken?: boolean; beforeToken?: () => Promise<void>; tokenResponse?: () => Response; jwksResponse?: () => Response };
export function signedToken(registration: Registration): string {
  const now = Math.floor(Date.now() / 1000), header = encoded({ alg: registration.algorithm ?? 'RS256', kid: 'synthetic-key', typ: 'JWT' });
  const payload = encoded({ iss: GOOGLE_OIDC.issuer, sub: registration.subject ?? 'Subject-A', aud: clientId, nonce: registration.nonce,
    iat: now, exp: now + 600, email: 'synthetic@example.test', ...registration.claims });
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), registration.badSignature ? other.privateKey : pair.privateKey).toString('base64url')}`;
}
export function providerFixture() {
  const registrations = new Map<string, Registration>();
  const calls: { kind: 'token' | 'jwks'; code?: string }[] = [];
  let active: Registration | undefined;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const fetcher: typeof fetch = async (target, init) => {
    const url = String(target);
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit'); assert.ok(init?.signal instanceof AbortSignal);
    if (url === GOOGLE_OIDC.token) {
      assert.equal(init?.method, 'POST'); assert.ok(init.body instanceof URLSearchParams);
      const body = init.body, code = body.get('code')!; calls.push({ kind: 'token', code });
      const r = registrations.get(code); if (!r) return json({ error: 'invalid_grant' }, 400);
      active = r;
      assert.equal(body.get('client_id'), clientId); assert.equal(body.get('client_secret'), clientSecret); assert.equal(body.get('redirect_uri'), callbackUri);
      const verifier = body.get('code_verifier');
      if (typeof verifier !== 'string' || createHash('sha256').update(verifier).digest('base64url') !== r.challenge) return json({ error: 'invalid_grant' }, 400);
      await r.beforeToken?.();
      return r.tokenResponse?.() ?? json({ access_token: 'synthetic-basic-token', token_type: 'Bearer', expires_in: 600,
        ...(!r.omitIdToken ? { id_token: signedToken(r) } : {}) });
    }
    if (url === GOOGLE_OIDC.jwks) {
      assert.equal(init?.method, 'GET'); calls.push({ kind: 'jwks' }); return active?.jwksResponse?.() ?? json({ keys: [jwk] });
    }
    throw Error('synthetic_unexpected_endpoint');
  };
  function register(registration: Registration) { const code = `synthetic-code-${registrations.size + 1}`; registrations.set(code, registration); return code; }
  function registerAuthorization(authorizationUrl: string, overrides: Partial<Registration> = {}) {
    const url = new URL(authorizationUrl);
    assert.equal(url.origin + url.pathname, GOOGLE_OIDC.authorization); assert.equal(url.searchParams.get('scope'), 'openid email');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('redirect_uri'), callbackUri);
    assert.ok(!url.searchParams.has('client_secret')); assert.ok(!url.searchParams.has('access_type'));
    const r: Registration = { nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!, ...overrides };
    return { code: register(r), state: url.searchParams.get('state')!, registration: r };
  }
  return { calls, fetcher, register, registerAuthorization };
}
