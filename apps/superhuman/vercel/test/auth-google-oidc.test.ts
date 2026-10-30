import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PinnedGoogleOidcVerifier } from '../src/auth-google-oidc.ts';
import { AppAuthError } from '../src/auth-values.ts';
import { callbackUri, clientId, clientSecret, providerFixture, type Registration } from './auth-oidc-fixture.ts';

after(() => { const networkAttempts = (globalThis as unknown as Record<symbol, { attempts: number }>)[Symbol.for('rea.generated-cloud.network-denied')]!.attempts;
  assert.equal(networkAttempts, 0); console.log('auth_oidc_metadata', JSON.stringify({ networkAttempts })); });
const verifier = 'A'.repeat(43), nonce = 'synthetic-nonce', state = 'synthetic-state';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const failure = (e: unknown) => e instanceof AppAuthError && e.code === 'auth_oidc_verification_failed';
function setup(overrides: Partial<Registration> = {}) {
  const provider = providerFixture(), code = provider.register({ nonce, challenge, ...overrides });
  const adapter = new PinnedGoogleOidcVerifier({ callbackUri, clientId, clientSecret, fetcher: provider.fetcher });
  const input = { clientId, redirectUri: callbackUri, code, expectedState: state, expectedNonce: nonce, codeVerifier: verifier };
  return { provider, adapter, input };
}

test('actual pinned library validates signed RS256 ID token against fetched synthetic JWKS', async () => {
  const f = setup(), result = await f.adapter.exchangeAndVerify(f.input);
  assert.equal(result.subject, 'Subject-A'); assert.equal(result.nonce, nonce);
  assert.deepEqual(f.provider.calls.map(c => c.kind), ['token', 'jwks']);
  assert.ok(!JSON.stringify(result).includes('access_token')); assert.ok(!JSON.stringify(result).includes('synthetic-basic-token'));
});

test('actual signature/algorithm, issuer/audience/azp/nonce/expiry/nbf and mandatory ID token negatives refuse without token retry', async () => {
  const invalid: Partial<Registration>[] = [
    { badSignature: true }, { algorithm: 'HS256' }, { algorithm: 'none' },
    { claims: { iss: 'https://evil.example.test' } }, { claims: { aud: 'other-client' } },
    { claims: { aud: [clientId, 'other'], azp: 'wrong-client' } }, { claims: { nonce: 'wrong-nonce' } },
    { claims: { exp: Math.floor(Date.now() / 1000) - 1 } }, { claims: { nbf: Math.floor(Date.now() / 1000) + 60 } }, { omitIdToken: true }
  ];
  for (const vector of invalid) {
    const f = setup(vector); await assert.rejects(f.adapter.exchangeAndVerify(f.input), failure);
    assert.equal(f.provider.calls.filter(c => c.kind === 'token').length, 1);
  }
});

test('actual library state check runs before exchange; PKCE mismatch is rejected by token fixture with one exchange', async () => {
  const f = setup(), callback = new URL(callbackUri); callback.searchParams.set('code', f.input.code); callback.searchParams.set('state', 'foreign-state');
  await assert.rejects(f.adapter.verifyCallbackResponse(callback, f.input), failure); assert.equal(f.provider.calls.length, 0);
  await assert.rejects(f.adapter.exchangeAndVerify({ ...f.input, codeVerifier: 'B'.repeat(43) }), failure);
  assert.deepEqual(f.provider.calls.map(c => c.kind), ['token']);
});

test('callback/endpoint configuration, redirects, malformed JWKS and response bounds refuse before returning claims', async () => {
  assert.throws(() => new PinnedGoogleOidcVerifier({ callbackUri: 'https://evil.example.test/arbitrary', clientId, clientSecret }));
  const badResponses: Partial<Registration>[] = [
    { tokenResponse: () => new Response('', { status: 302, headers: { location: 'https://evil.example.test' } }) },
    { tokenResponse: () => new Response('x'.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } }) },
    { jwksResponse: () => new Response(JSON.stringify({ keys: [] }), { headers: { 'content-type': 'application/json' } }) }
  ];
  for (const vector of badResponses) { const f = setup(vector); await assert.rejects(f.adapter.exchangeAndVerify(f.input), failure); assert.equal(f.provider.calls.filter(c => c.kind === 'token').length, 1); }
  const f = setup();
  await assert.rejects(f.adapter.exchangeAndVerify({ ...f.input, redirectUri: 'https://evil.example.test/callback' })); assert.equal(f.provider.calls.length, 0);
  const duplicate = new URL(callbackUri); duplicate.search = `?code=${f.input.code}&code=second&state=${state}`;
  await assert.rejects(f.adapter.verifyCallbackResponse(duplicate, f.input), failure); assert.equal(f.provider.calls.length, 0);
});

test('realistic Google callback extras are bounded/normalized and never select identity or authorization', async () => {
  const f = setup(), callback = new URL(callbackUri);
  for (const [k, v] of Object.entries({ code: f.input.code, state, scope: 'openid email profile', authuser: '0', hd: 'untrusted.example.test', prompt: 'consent' })) callback.searchParams.set(k, v);
  const result = await f.adapter.verifyCallbackResponse(callback, f.input);
  assert.equal(result.subject, 'Subject-A'); assert.equal(result.issuer, 'https://accounts.google.com');
  assert.ok(!JSON.stringify(result).includes('untrusted.example.test'));
  const ignored = setup(), nonAuthorizing = new URL(callback.href); nonAuthorizing.searchParams.set('code', ignored.input.code);
  nonAuthorizing.searchParams.append('hd', 'another.example.test'); nonAuthorizing.searchParams.set('tenantId', 'tenant-B');
  assert.equal((await ignored.adapter.verifyCallbackResponse(nonAuthorizing, ignored.input)).subject, 'Subject-A');
  for (const variant of ['duplicate-state', 'error', 'issuer', 'large-extra', 'control-extra']) {
    const g = setup(), url = new URL(callback.href); url.searchParams.set('code', g.input.code);
    if (variant === 'duplicate-state') url.searchParams.append('state', state);
    if (variant === 'error') url.searchParams.set('error', 'access_denied');
    if (variant === 'issuer') url.searchParams.set('iss', 'https://evil.example.test');
    if (variant === 'large-extra') url.searchParams.set('scope', 's'.repeat(4097));
    if (variant === 'control-extra') url.searchParams.set('hd', 'example.test\nInjected');
    await assert.rejects(g.adapter.verifyCallbackResponse(url, g.input), failure); assert.equal(g.provider.calls.length, 0);
  }
});
