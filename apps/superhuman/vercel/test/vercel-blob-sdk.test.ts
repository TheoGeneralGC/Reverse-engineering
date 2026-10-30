import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { presignUrl } from '@vercel/blob';
import type { GetBlobResult, HeadBlobResult, IssueSignedTokenOptions, IssuedSignedToken, PutBlobResult } from '@vercel/blob';
import { VercelPrivateBlobStore, type PrivateBlobSdk } from '../src/vercel-blob-sdk.ts';

const originalFetch = globalThis.fetch; let network = 0;
globalThis.fetch = async () => { network++; throw new Error('Blob SDK tests prohibit external requests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(network, 0); });
const storeId = 'store_AbCdEf1234567890', namespace = 'fictional-cedar';
const prefix = `mail-rpc/${createHash('sha256').update(namespace).digest('hex').slice(0, 32)}/`;
const pathname = `${prefix}${'A'.repeat(32)}`, origin = 'https://abcdef1234567890.private.blob.vercel-storage.com';
function metadata(path = pathname): HeadBlobResult {
  return { pathname: path, url: `${origin}/${path}`, downloadUrl: `${origin}/${path}?download=1`, contentType: 'application/octet-stream',
    size: 3, etag: 'fictional-etag', uploadedAt: new Date(), contentDisposition: '', cacheControl: 'public, max-age=60' };
}
function token(options: IssueSignedTokenOptions): IssuedSignedToken {
  const { pathname, operations, validUntil, maximumSizeInBytes, allowedContentTypes } = options;
  const scope = { storeId, pathname, operations, validUntil, ...(maximumSizeInBytes !== undefined ? { maximumSizeInBytes } : {}),
    ...(allowedContentTypes !== undefined ? { allowedContentTypes } : {}) };
  return { delegationToken: `${Buffer.from(JSON.stringify(scope)).toString('base64url')}.${'S'.repeat(43)}`,
    clientSigningToken: 'K'.repeat(43), validUntil: validUntil! };
}
function fixture() {
  const at = Date.now(), calls: { name: string; path?: string; options?: unknown; body?: unknown }[] = [];
  let auth = 0;
  const sdk: PrivateBlobSdk = {
    issueSignedToken: async options => { calls.push({ name: 'issue', options }); return token(options); },
    presignUrl: async (signed, options) => { calls.push({ name: 'presign', options }); return presignUrl(signed, options); },
    get: async (path, options) => { calls.push({ name: 'get', path, options }); return { statusCode: 200,
      headers: new Headers(), blob: metadata(path), stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }) }; },
    put: async (path, body, options) => { calls.push({ name: 'put', path, body, options }); return metadata(path); },
    head: async (path, options) => { calls.push({ name: 'head', path, options }); return metadata(path); },
    del: async (path, options) => { assert.equal(typeof path, 'string'); calls.push({ name: 'del', path: path as string, options }); }
  };
  const store = new VercelPrivateBlobStore({ storeId, namespace, sdk, now: () => at,
    getOidcToken: async () => `fictional-oidc-${++auth}` });
  return { at, calls, sdk, store, auth: () => auth };
}

test('single-path upload is signed by the real SDK with byte/MIME bounds, private access and no overwrite/suffix', async () => {
  const f = fixture(), expiresAt = f.at + 600_000;
  const grant = await f.store.uploadGrant(pathname, 3, expiresAt), url = new URL(grant.url);
  assert.equal(url.origin, 'https://vercel.com'); assert.equal(url.pathname, '/api/blob/');
  assert.equal(url.searchParams.get('pathname'), pathname);
  assert.equal(url.searchParams.get('vercel-blob-maximum-size-in-bytes'), '3');
  assert.equal(url.searchParams.get('vercel-blob-allowed-content-types'), 'application/octet-stream');
  assert.equal(url.searchParams.get('vercel-blob-allow-overwrite'), 'false');
  assert.equal(url.searchParams.get('vercel-blob-add-random-suffix'), 'false');
  assert.deepEqual(f.calls[0].options, { storeId, oidcToken: 'fictional-oidc-1', pathname, operations: ['put'], validUntil: expiresAt,
    allowedContentTypes: ['application/octet-stream'], maximumSizeInBytes: 3 });
  assert.deepEqual(f.calls[1].options, { access: 'private', operation: 'put', pathname, validUntil: expiresAt,
    allowedContentTypes: ['application/octet-stream'], maximumSizeInBytes: 3, allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60 });
});

test('downloads are get-only, pinned to this private origin, bypass cache and expire within sixty seconds', async () => {
  const f = fixture(); assert.equal(f.store.privateOrigin, origin);
  const grant = await f.store.downloadGrant(pathname, f.at + 60_000), url = new URL(grant.url);
  assert.equal(url.origin, origin); assert.equal(url.pathname, `/${pathname}`); assert.equal(url.searchParams.get('cache'), '0');
  assert.deepEqual(f.calls[0].options, { storeId, oidcToken: 'fictional-oidc-1', pathname, operations: ['get'], validUntil: f.at + 60_000 });
  await assert.rejects(f.store.downloadGrant(pathname, f.at + 60_001), { code: 'invalid_private_storage_request' });
  assert.equal(f.calls.length, 2);
});

test('foreign namespaces, arbitrary URLs, path normalization, invalid sizes and expired grants are refused before SDK/auth', async () => {
  const f = fixture();
  for (const path of ['*', `${origin}/${pathname}`, `${prefix}../${'A'.repeat(32)}`, `${prefix}${'A'.repeat(32)}/`, `${prefix}${'B'.repeat(31)}`, pathname.replace('mail-rpc/', 'other/')]) {
    await assert.rejects(f.store.read(path)); await assert.rejects(f.store.remove(path));
    await assert.rejects(f.store.uploadGrant(path, 3, f.at + 1000));
  }
  for (const bytes of [0, -1, 0.5, NaN, 128 * 1024 ** 2]) await assert.rejects(f.store.uploadGrant(pathname, bytes, f.at + 1000));
  await assert.rejects(f.store.uploadGrant(pathname, 3, f.at));
  await assert.rejects(f.store.uploadGrant(pathname, 3, f.at + 3600_001));
  assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
  assert.throws(() => new VercelPrivateBlobStore({ storeId: '', namespace }), /Invalid private store configuration/);
});

test('every SDK network operation refreshes explicit OIDC, including write metadata confirmation', async () => {
  const f = fixture();
  await f.store.uploadGrant(pathname, 3, f.at + 1000); await f.store.downloadGrant(pathname, f.at + 1000);
  const stream = await f.store.read(pathname); assert.ok(stream); assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([1, 2, 3]));
  await f.store.write(pathname, new Uint8Array([1, 2, 3])); await f.store.remove(pathname);
  const networkCalls = f.calls.filter(call => call.name !== 'presign'); assert.equal(networkCalls.length, 6); assert.equal(f.auth(), 6);
  networkCalls.forEach((call, index) => {
    const options = call.options as Record<string, unknown>;
    assert.equal(options.storeId, storeId); assert.equal(options.oidcToken, `fictional-oidc-${index + 1}`); assert.equal('token' in options, false);
  });
  assert.equal((networkCalls[2].options as Record<string, unknown>).useCache, false);
  assert.equal((networkCalls[3].options as Record<string, unknown>).access, 'private');
});

test('empty OIDC cannot fall back to environment credentials and SDK errors expose no secret text', async () => {
  const f = fixture();
  const store = new VercelPrivateBlobStore({ storeId, namespace, sdk: f.sdk, getOidcToken: async () => '' });
  await assert.rejects(store.remove(pathname), { code: 'private_storage_unavailable' }); assert.equal(f.calls.length, 0);
  f.sdk.del = async () => { throw new Error('fictional SECRET must never leave adapter'); };
  await assert.rejects(f.store.remove(pathname), error => {
    assert.equal((error as Error).message, 'The file transfer could not be completed.');
    assert.equal(JSON.stringify(error).includes('SECRET'), false); return true;
  });
});

test('broader or mismatched delegation scopes fail before a URL can escape', async () => {
  for (const mutate of [
    (scope: Record<string, unknown>) => { scope.pathname = '*'; },
    (scope: Record<string, unknown>) => { scope.operations = ['get', 'put', 'delete']; },
    (scope: Record<string, unknown>) => { scope.storeId = 'store_ZZZZZZZZZZZZZZZZ'; },
    (scope: Record<string, unknown>) => { scope.maximumSizeInBytes = 100; },
    (scope: Record<string, unknown>) => { scope.allowedContentTypes = ['*/*']; }
  ]) {
    const f = fixture();
    f.sdk.issueSignedToken = async options => {
      const signed = token(options), scope = JSON.parse(Buffer.from(signed.delegationToken.split('.')[0], 'base64url').toString());
      mutate(scope); signed.delegationToken = `${Buffer.from(JSON.stringify(scope)).toString('base64url')}.${'S'.repeat(43)}`; return signed;
    };
    await assert.rejects(f.store.uploadGrant(pathname, 3, f.at + 1000), { code: 'private_storage_unavailable' });
    assert.equal(f.calls.length, 0);
  }
});

test('signed URL validation refuses redirects, public origins, path changes, duplicate or broader options', async () => {
  for (const mutate of [
    (url: URL) => { url.hostname = 'attacker.invalid'; },
    (url: URL) => { url.pathname = '/wrong'; },
    (url: URL) => { url.searchParams.set('vercel-blob-callback-url', 'https://attacker.invalid'); },
    (url: URL) => { url.searchParams.set('vercel-blob-allow-overwrite', 'true'); },
    (url: URL) => { url.searchParams.set('__proto__', 'unexpected'); },
    (url: URL) => { url.searchParams.append('pathname', '*'); },
    (url: URL) => { url.username = 'unexpected'; }
  ]) {
    const f = fixture(); f.sdk.presignUrl = async (signed, options) => {
      const url = new URL((await presignUrl(signed, options)).presignedUrl); mutate(url); return { presignedUrl: url.toString() };
    };
    await assert.rejects(f.store.uploadGrant(pathname, 3, f.at + 1000), { code: 'private_storage_unavailable' });
  }
  const f = fixture(); f.sdk.presignUrl = async (signed, options) => {
    const url = new URL((await presignUrl(signed, options)).presignedUrl); url.hostname = 'abcdef1234567890.public.blob.vercel-storage.com'; return { presignedUrl: url.toString() };
  };
  await assert.rejects(f.store.downloadGrant(pathname, f.at + 1000), { code: 'private_storage_unavailable' });
});

test('write snapshots exact view bytes before auth waits and validates durable metadata before reporting success', async () => {
  const f = fixture(); let release!: () => void;
  const auth = new Promise<string>(resolve => { release = () => resolve('fictional-oidc'); });
  const store = new VercelPrivateBlobStore({ storeId, namespace, sdk: f.sdk, getOidcToken: () => auth });
  const source = new Uint8Array([9, 1, 2, 3, 9]), view = source.subarray(1, 4);
  const write = store.write(pathname, view); source.fill(99); release(); await write;
  assert.deepEqual(new Uint8Array(f.calls.find(call => call.name === 'put')?.body as Uint8Array), new Uint8Array([1, 2, 3]));
  const options = f.calls.find(call => call.name === 'put')?.options as Record<string, unknown>;
  assert.equal(options.allowOverwrite, false); assert.equal(options.addRandomSuffix, false); assert.equal(options.multipart, false);
  f.sdk.head = async path => ({ ...metadata(path), size: 4 });
  await assert.rejects(f.store.write(pathname, new Uint8Array([1, 2, 3])), { code: 'private_storage_unavailable' });
  assert.equal(f.calls.filter(call => call.name === 'put').length, 2);
});

test('read returns missing objects as null and cancels mismatched metadata or a truncated/oversized body', async () => {
  const f = fixture(); f.sdk.get = async () => null; assert.equal(await f.store.read(pathname), null);
  let cancelled = 0;
  f.sdk.get = async () => ({ statusCode: 200, headers: new Headers(), blob: { ...metadata(), pathname: 'wrong' },
    stream: new ReadableStream({ cancel() { cancelled++; } }) });
  await assert.rejects(f.store.read(pathname), { code: 'private_storage_unavailable' }); assert.equal(cancelled, 1);
  for (const count of [2, 4]) {
    f.sdk.get = async () => ({ statusCode: 200, headers: new Headers(), blob: metadata(),
      stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(count)); controller.close(); } }) });
    const stream = await f.store.read(pathname); assert.ok(stream);
    await assert.rejects(new Response(stream).arrayBuffer(), { code: 'private_storage_unavailable' });
  }
});

test('SDK control endpoint overrides are refused before requesting OIDC or touching storage', async () => {
  const previous = process.env.VERCEL_BLOB_API_URL;
  try {
    process.env.VERCEL_BLOB_API_URL = 'https://attacker.invalid';
    const f = fixture(); await assert.rejects(f.store.remove(pathname), { code: 'private_storage_unavailable' });
    assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
  } finally { if (previous === undefined) delete process.env.VERCEL_BLOB_API_URL; else process.env.VERCEL_BLOB_API_URL = previous; }
});
