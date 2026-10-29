import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PROTOCOL = 'rea-tracking-v1';
export const MAX_BODY = 4096;
export const MAX_TARGET = 2048;
export const CLOCK_SKEW_MS = 300_000;
export const HEX = /^[a-f0-9]{64}$/;
export const IDENTIFIER = /^[a-f0-9]{32}$/;
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export class CollectorError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export function requireValue(test: unknown, status = 400, code = 'invalid_request'): asserts test {
  if (!test) throw new CollectorError(status, code);
}
export function exactObject(value: unknown, fields: string[]): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.keys(value as object).sort().join(',') === fields.sort().join(','));
  return value as Record<string, unknown>;
}
export function canonicalTarget(target: string): string {
  requireValue(target.length <= MAX_TARGET && target.startsWith('/') && !target.startsWith('//') && !/[\r\n#\\]/.test(target));
  const url = new URL(target, 'https://tracking.invalid');
  requireValue(url.pathname === '/v1/registrations' || /^\/v1\/(?:registrations|requests)\/[a-f0-9]{32}$/.test(url.pathname) || url.pathname === '/v1/events');
  requireValue(url.pathname + url.search === target, 400, 'noncanonical_target');
  const query = [...url.searchParams.entries()];
  requireValue(query.every(([key]) => url.searchParams.getAll(key).length === 1));
  query.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const normalized = new URLSearchParams(query).toString();
  requireValue(target === url.pathname + (normalized ? '?' + normalized : ''), 400, 'noncanonical_target');
  return target;
}
export function signature(key: Buffer, method: string, target: string, body: Buffer, keyId: string, timestamp: string, nonce: string): string {
  requireValue(key.length >= 32 && key.length <= 64, 500, 'invalid_key_configuration');
  return createHmac('sha256', key).update([PROTOCOL, keyId, method, canonicalTarget(target), timestamp, nonce, sha256(body)].join('\n')).digest('hex');
}
export function signedHeaders(key: Buffer, keyId: string, method: string, target: string, body: Buffer, now = Date.now(), nonce = randomBytes(24).toString('base64url')) {
  const timestamp = String(now);
  return {
    'content-type': 'application/json',
    'x-rea-key-id': keyId, 'x-rea-time': timestamp, 'x-rea-nonce': nonce,
    'x-rea-signature': signature(key, method, target, body, keyId, timestamp, nonce),
  };
}
export function equalHex(expected: string, received: string): boolean {
  return HEX.test(expected) && HEX.test(received) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
