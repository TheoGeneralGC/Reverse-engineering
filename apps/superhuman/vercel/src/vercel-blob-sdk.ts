import { createHash } from 'node:crypto';
import * as blobSdk from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { BlobTransportError } from './blob-transport.ts';
import type { BlobReadBinding, PrivateBlobPort } from './blob-transport.ts';

export type PrivateBlobSdk = Pick<typeof blobSdk, 'issueSignedToken' | 'presignUrl' | 'get' | 'put' | 'head' | 'del'>;
const contentType = 'application/octet-stream';
const apiOrigin = 'https://vercel.com', apiPath = '/api/blob/';
const unavailable = () => new BlobTransportError('private_storage_unavailable', 503);
function invalid(): never { throw new BlobTransportError('invalid_private_storage_request', 400); }
function endpoint(): void {
  // The SDK supports control-API environment overrides. Refuse those before
  // passing OIDC to it; explicit store/auth must never reach another endpoint.
  for (const key of ['VERCEL_BLOB_API_URL', 'NEXT_PUBLIC_VERCEL_BLOB_API_URL']) {
    const value = process.env[key];
    if (value && value !== `${apiOrigin}/api/blob`) throw unavailable();
  }
}
type Metadata = { pathname: string; url: string; downloadUrl: string; contentType: string };
function strongEtag(value: unknown): string | undefined {
  if (typeof value !== 'string' || /^W\//i.test(value)) return undefined;
  // GET preserves HTTP ETag quotes; head() preserves the control API's value.
  // Remove one valid strong quoted wrapper only. Never trim, case-fold or
  // discard a weak prefix, and never equate empty/malformed version markers.
  if (/^"[\x21\x23-\x7e]{1,256}"$/.test(value)) return value.slice(1,-1);
  return /^[A-Za-z0-9][A-Za-z0-9._:+/=-]{0,255}$/.test(value) ? value : undefined;
}
export function sameStrongBlobEtag(left: unknown, right: unknown): boolean {
  const version = strongEtag(left);
  return version !== undefined && version === strongEtag(right);
}

/** A private, namespace-scoped SDK port. It never accepts URLs, bearer tokens,
 * wildcard paths or cached OIDC. Grants contain one operation on one object. */
export class VercelPrivateBlobStore implements PrivateBlobPort {
  readonly privateOrigin: string;
  private readonly storeId: string;
  private readonly prefix: string;
  private readonly sdk: PrivateBlobSdk;
  private readonly getOidcToken: () => Promise<string>;
  private readonly now: () => number;
  private readonly maxBodyBytes: number;
  constructor(options: { storeId: string; namespace: string; maxBodyBytes?: number; now?: () => number;
    sdk?: PrivateBlobSdk; getOidcToken?: () => Promise<string> }) {
    if (!options || typeof options.storeId !== 'string' || typeof options.namespace !== 'string' ||
        !/^store_[A-Za-z0-9]{16}$/.test(options.storeId) || !/^[A-Za-z0-9_-]{1,128}$/.test(options.namespace)) throw new TypeError('Invalid private store configuration');
    this.storeId = options.storeId;
    this.privateOrigin = `https://${this.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com`;
    this.prefix = `mail-rpc/${createHash('sha256').update(options.namespace).digest('hex').slice(0, 32)}/`;
    this.sdk = options.sdk ?? blobSdk;
    this.getOidcToken = options.getOidcToken ?? (() => getVercelOidcToken({ expirationBufferMs: 60_000 }));
    this.now = options.now ?? Date.now;
    this.maxBodyBytes = options.maxBodyBytes ?? 64 * 1024 ** 2;
    if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes < 1 || this.maxBodyBytes > 128 * 1024 ** 2 ||
        typeof this.now !== 'function' || typeof this.getOidcToken !== 'function') throw new TypeError('Invalid private store configuration');
  }
  private path(pathname: string): void {
    if (typeof pathname !== 'string' || !pathname.startsWith(this.prefix) ||
        !/^[A-Za-z0-9_-]{32}$/.test(pathname.slice(this.prefix.length))) invalid();
  }
  private size(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.maxBodyBytes) invalid();
  }
  private readBinding(value: BlobReadBinding | undefined): BlobReadBinding | undefined {
    if (value === undefined) return undefined;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
          Object.keys(value).some(key => key !== 'bytes' && key !== 'sha256')) invalid();
      const bytes = value.bytes, sha256 = value.sha256;this.size(bytes);
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) invalid();
      return Object.freeze({bytes,sha256});
    } catch { invalid(); }
  }
  private expiry(expiresAt: number, maximumLifetime: number): void {
    const now = this.now();
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > maximumLifetime) invalid();
  }
  private async auth(): Promise<{ storeId: string; oidcToken: string }> {
    endpoint();
    let oidcToken: string;
    try { oidcToken = await this.getOidcToken(); } catch { throw unavailable(); }
    // Empty/invalid explicit OIDC must not trigger the SDK's RW-token/env fallback.
    if (typeof oidcToken !== 'string' || !oidcToken || /[\x00-\x20\x7f]/.test(oidcToken)) throw unavailable();
    endpoint();
    return { storeId: this.storeId, oidcToken };
  }
  private url(value: string, pathname: string, download = false): void {
    let url: URL;
    try { url = new URL(value); } catch { throw unavailable(); }
    if (url.origin !== this.privateOrigin || url.username || url.password || url.port || url.hash ||
        url.pathname !== `/${pathname}` || url.search !== (download ? '?download=1' : '')) throw unavailable();
  }
  private metadata(value: Metadata, pathname: string): void {
    if (value.pathname !== pathname || value.contentType !== contentType) throw unavailable();
    this.url(value.url, pathname); this.url(value.downloadUrl, pathname, true);
  }
  private delegation(token: blobSdk.IssuedSignedToken, pathname: string, operation: 'get' | 'put', expiresAt: number, bytes?: number): void {
    try {
      if (typeof token.delegationToken !== 'string' || typeof token.clientSigningToken !== 'string' ||
          !/^[A-Za-z0-9_-]{16,}$/.test(token.clientSigningToken) || token.validUntil !== expiresAt) throw unavailable();
      const parts = token.delegationToken.split('.');
      if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw unavailable();
      const scope = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
      const storeId = typeof scope.storeId === 'string' ? scope.storeId.replace(/^store_/, '').toLowerCase() : '';
      if (storeId !== this.storeId.slice(6).toLowerCase() || scope.pathname !== pathname ||
          !Array.isArray(scope.operations) || scope.operations.length !== 1 || scope.operations[0] !== operation ||
          scope.validUntil !== expiresAt) throw unavailable();
      if (operation === 'put' && (scope.maximumSizeInBytes !== bytes || !Array.isArray(scope.allowedContentTypes) ||
          scope.allowedContentTypes.length !== 1 || scope.allowedContentTypes[0] !== contentType)) throw unavailable();
    } catch { throw unavailable(); }
  }
  private grantUrl(value: string, token: blobSdk.IssuedSignedToken, pathname: string, operation: 'get' | 'put', expiresAt: number, bytes?: number): void {
    let url: URL;
    try { url = new URL(value); } catch { throw unavailable(); }
    if (url.username || url.password || url.port || url.hash || (operation === 'get'
      ? url.origin !== this.privateOrigin || url.pathname !== `/${pathname}`
      : url.origin !== apiOrigin || url.pathname !== apiPath)) throw unavailable();
    const expected: Record<string, string> = {
      'vercel-blob-delegation': token.delegationToken,
      ...(operation === 'get' ? { cache: '0' } : { pathname,
        'vercel-blob-maximum-size-in-bytes': String(bytes), 'vercel-blob-allowed-content-types': contentType,
        'vercel-blob-add-random-suffix': 'false', 'vercel-blob-allow-overwrite': 'false', 'vercel-blob-cache-control-max-age': '60' })
    };
    for (const [key, expectedValue] of Object.entries(expected)) if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== expectedValue) throw unavailable();
    if (!/^[A-Za-z0-9_-]{16,}$/.test(url.searchParams.get('vercel-blob-signature') ?? '') || url.searchParams.getAll('vercel-blob-signature').length !== 1) throw unavailable();
    for (const [key, item] of url.searchParams) {
      if (key === 'vercel-blob-valid-until') {
        if (item !== String(expiresAt) || url.searchParams.getAll(key).length !== 1) throw unavailable();
      } else if (key !== 'vercel-blob-signature' && !Object.hasOwn(expected, key)) throw unavailable();
    }
  }
  async uploadGrant(pathname: string, bytes: number, expiresAt: number): Promise<{ url: string }> {
    this.path(pathname); this.size(bytes); this.expiry(expiresAt, 3600_000);
    const auth = await this.auth();
    try {
      const token = await this.sdk.issueSignedToken({ ...auth, pathname, operations: ['put'], validUntil: expiresAt,
        allowedContentTypes: [contentType], maximumSizeInBytes: bytes });
      this.delegation(token, pathname, 'put', expiresAt, bytes);
      const grant = await this.sdk.presignUrl(token, { access: 'private', operation: 'put', pathname, validUntil: expiresAt,
        allowedContentTypes: [contentType], maximumSizeInBytes: bytes, allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60 });
      this.grantUrl(grant.presignedUrl, token, pathname, 'put', expiresAt, bytes);
      this.expiry(expiresAt, 3600_000);
      return { url: grant.presignedUrl };
    } catch { throw unavailable(); }
  }
  async downloadGrant(pathname: string, expiresAt: number): Promise<{ url: string }> {
    this.path(pathname); this.expiry(expiresAt, 60_000);
    const auth = await this.auth();
    try {
      const token = await this.sdk.issueSignedToken({ ...auth, pathname, operations: ['get'], validUntil: expiresAt });
      this.delegation(token, pathname, 'get', expiresAt);
      const grant = await this.sdk.presignUrl(token, { access: 'private', operation: 'get', pathname, validUntil: expiresAt, useCache: false });
      this.grantUrl(grant.presignedUrl, token, pathname, 'get', expiresAt);
      this.expiry(expiresAt, 60_000);
      return { url: grant.presignedUrl };
    } catch { throw unavailable(); }
  }
  async read(pathname: string, expected?: BlobReadBinding): Promise<ReadableStream<Uint8Array> | null> {
    this.path(pathname);const binding=this.readBinding(expected);const auth = await this.auth();
    let value: blobSdk.GetBlobResult | null;
    try { value = await this.sdk.get(pathname, { ...auth, access: 'private', useCache: false }); }
    catch { throw unavailable(); }
    if (!value) return null;
    let expectedBytes: number;
    try {
      if (value.statusCode !== 200 || !value.stream) throw unavailable();
      this.metadata(value.blob, pathname);
      expectedBytes = value.blob.size;
      const declared=value.headers.get('content-length');
      if(binding && declared!==null && (typeof declared!=='string' || !/^[1-9]\d{0,8}$/.test(declared) || Number(declared)!==expectedBytes))throw unavailable();
      if (expectedBytes === 0 && declared === null) {
        // The pinned SDK reports zero when a successful GET omits length.
        // A durable caller digest binds content independently of HTTP validators.
        // Unbound callers still require the same strong GET/HEAD version.
        const getEtag = value.blob.etag;
        if (!binding && !sameStrongBlobEtag(getEtag,value.headers.get('etag'))) throw unavailable();
        const head = await this.sdk.head(pathname,await this.auth());
        this.metadata(head,pathname);const headSize = head.size;this.size(headSize);
        if (!binding && !sameStrongBlobEtag(getEtag,head.etag)) throw unavailable();
        expectedBytes = headSize;
      }
      this.size(expectedBytes);
      if(binding && expectedBytes!==binding.bytes)throw unavailable();
    } catch { if (value.stream) await value.stream.cancel().catch(() => {}); throw unavailable(); }
    const reader = value.stream.getReader(), hash=binding?createHash('sha256'):undefined;
    let bytes = 0,digestMismatch=false;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            reader.releaseLock();
            if (bytes !== expectedBytes) throw unavailable();
            if(binding && hash!.digest('hex')!==binding.sha256){digestMismatch=true;throw unavailable();}
            controller.close(); return;
          }
          if (!(chunk.value instanceof Uint8Array) || (bytes += chunk.value.byteLength) > expectedBytes) throw unavailable();
          hash?.update(chunk.value);controller.enqueue(chunk.value);
        } catch {
          await reader.cancel().catch(() => {});
          try { reader.releaseLock(); } catch { /* Already released after EOF. */ }
          controller.error(digestMismatch?new BlobTransportError('transport_body_mismatch',409):unavailable());
        }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } }
    });
  }
  async write(pathname: string, bytes: Uint8Array): Promise<void> {
    this.path(pathname); if (!(bytes instanceof Uint8Array)) invalid(); this.size(bytes.byteLength);
    const snapshot = Buffer.from(bytes), auth = await this.auth();
    try {
      const value = await this.sdk.put(pathname, snapshot, { ...auth, access: 'private', contentType,
        allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60, multipart: false });
      this.metadata(value, pathname);
      // put() has no byte length in its result. Check the persisted object's
      // exact size/identity before the durable command can advertise it ready.
      const head = await this.sdk.head(pathname, await this.auth());
      this.metadata(head, pathname);
      if (head.size !== snapshot.byteLength || !value.etag || head.etag !== value.etag) throw unavailable();
    } catch { throw unavailable(); }
  }
  async remove(pathname: string): Promise<void> {
    this.path(pathname); const auth = await this.auth();
    try { await this.sdk.del(pathname, auth); } catch { throw unavailable(); }
  }
}
