import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import type { Account } from '../src/types.ts';
import { HttpError } from '../src/types.ts';

const env = { GOOGLE_CLIENT_ID: 'offline-test-client', GOOGLE_CLIENT_SECRET: 'offline-test-secret', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64), GOOGLE_REDIRECT_URI: 'http://127.0.0.1:3001/api/auth/google/callback' };
const scope = 'https://www.googleapis.com/auth/gmail.modify';
const successfulToken = { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_in: 3600, token_type: 'Bearer', scope };
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

test('offline OAuth exchange sends matching PKCE verifier and publishes account/tokens/preferences once', async () => {
  const store = new Store(':memory:'); let calls = 0; let verifier = '';
  const fetcher = (async (input, init) => {
    calls++; if (String(input).includes('oauth2.googleapis.com/token')) { const values = init?.body as URLSearchParams; assert.equal(values.get('grant_type'), 'authorization_code'); assert.equal(values.get('redirect_uri'), env.GOOGLE_REDIRECT_URI); assert.equal(values.get('code'), 'fake-code'); verifier = values.get('code_verifier') ?? ''; return reply(successfulToken); }
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer fake-access-token'); return reply({ emailAddress: 'mailbox@example.test' });
  }) as typeof fetch;
  const provider = new GoogleProvider(store, env, fetcher); const auth = provider.startAuth(); const url = new URL(auth.url); assert.equal(url.searchParams.get('scope'), scope);
  const accountId = await provider.finishAuth(auth.state, auth.state, 'fake-code');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url')); assert.equal(accountId, 'google:mailbox@example.test'); assert.equal(store.preferences().activeAccountId, accountId);
  assert.equal(store.required<Account>('account', accountId).email, 'mailbox@example.test'); const secret = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId); assert.ok(secret); assert.ok(!String(secret.value).includes(successfulToken.refresh_token)); assert.equal(provider.unseal(String(secret.value)).refresh_token, successfulToken.refresh_token);
  await assert.rejects(() => provider.finishAuth(auth.state, auth.state, 'fake-code'), error => error instanceof HttpError && error.code === 'invalid_oauth_state'); assert.equal(calls, 2); store.close();
});

test('insufficient granted Gmail scope fails before profile fetch or account publication', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const provider = new GoogleProvider(store, env, (async () => { calls++; return reply({ ...successfulToken, scope: 'https://www.googleapis.com/auth/gmail.readonly' }); }) as typeof fetch);
  const auth = provider.startAuth(); await assert.rejects(() => provider.finishAuth(auth.state, auth.state, 'fake-code'), error => error instanceof HttpError && error.code === 'insufficient_google_scope');
  assert.equal(calls, 1); assert.equal(store.list('account').length, 1); assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM secrets').get()?.count, 0); store.close();
});

test('malformed token response and absent offline refresh access are explicit failures', async () => {
  for (const data of [{ ...successfulToken, access_token: undefined }, { ...successfulToken, expires_in: -1 }, { ...successfulToken, token_type: 'unknown' }]) {
    const store = new Store(':memory:'); const provider = new GoogleProvider(store, env, (async () => reply(data)) as typeof fetch); const auth = provider.startAuth();
    await assert.rejects(() => provider.finishAuth(auth.state, auth.state, 'fake-code'), error => error instanceof HttpError && error.code === 'invalid_google_token_response'); assert.equal(store.list('account').length, 1); store.close();
  }
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, env, (async input => String(input).includes('oauth2.googleapis.com/token') ? reply({ ...successfulToken, refresh_token: undefined }) : reply({ emailAddress: 'new@example.test' })) as typeof fetch); const auth = provider.startAuth();
  await assert.rejects(() => provider.finishAuth(auth.state, auth.state, 'fake-code'), error => error instanceof HttpError && error.code === 'offline_access_not_granted'); assert.equal(store.list('account').length, 1); store.close();
});

test('reconnection without a new refresh token retains the prior token and account metadata', async () => {
  const store = new Store(':memory:'); const id = 'google:existing@example.test';
  const provider = new GoogleProvider(store, env, (async input => String(input).includes('oauth2.googleapis.com/token') ? reply({ ...successfulToken, refresh_token: undefined, scope: undefined }) : reply({ emailAddress: 'existing@example.test' })) as typeof fetch);
  store.put<Account>('account', id, { id, email: 'existing@example.test', name: 'Existing name', provider: 'google', color: '#123' }); provider.saveTokens(id, { access_token: 'old-access', refresh_token: 'existing-offline-token', expires_at: Date.now() + 1000 });
  const auth = provider.startAuth(); await provider.finishAuth(auth.state, auth.state, 'fake-code'); const secret = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(id)!;
  assert.equal(provider.unseal(String(secret.value)).refresh_token, 'existing-offline-token'); assert.equal(store.required<Account>('account', id).name, 'Existing name'); store.close();
});

test('failed account publication rolls back the token and selected account together', async () => {
  const store = new Store(':memory:'); const provider = new GoogleProvider(store, env, (async input => String(input).includes('oauth2.googleapis.com/token') ? reply(successfulToken) : reply({ emailAddress: 'new@example.test' })) as typeof fetch);
  const originalPut = store.put.bind(store); store.put = (kind, id, value) => { if (kind === 'account') throw new Error('Simulated account commit failure'); return originalPut(kind, id, value); };
  const auth = provider.startAuth(); await assert.rejects(() => provider.finishAuth(auth.state, auth.state, 'fake-code'), /commit failure/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM secrets').get()?.count, 0); assert.equal(store.preferences().activeAccountId, 'demo'); assert.equal(store.get('account', 'google:new@example.test'), undefined); store.close();
});

test('concurrent refresh is deduplicated and a rotated refresh token is durably retained', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const provider = new GoogleProvider(store, env, (async (_input, init) => { calls++; assert.equal((init?.body as URLSearchParams).get('refresh_token'), 'old-refresh'); return reply({ ...successfulToken, access_token: 'new-access', refresh_token: 'rotated-refresh' }); }) as typeof fetch);
  store.put<Account>('account','google:test',{id:'google:test',provider:'google',email:'test@example.test',name:'Synthetic refresh account',color:'#000'});
  provider.saveTokens('google:test', { access_token: 'expired-access', refresh_token: 'old-refresh', expires_at: Date.now() - 1000 });
  const [first, second] = await Promise.all([provider.tokens('google:test'), provider.tokens('google:test')]); assert.equal(calls, 1); assert.equal(first.access_token, 'new-access'); assert.deepEqual(first, second); const secret = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get('google:test')!; assert.equal(provider.unseal(String(secret.value)).refresh_token, 'rotated-refresh'); store.close();
});
