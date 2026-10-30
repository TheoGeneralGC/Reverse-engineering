import type { ActorLease } from './authority.ts';
import type { CommandRequest, CommandResponse, WireBody } from './command-log.ts';
import type { CoreStartupStage } from './startup-diagnostic.ts';
import { safeWorkerErrorCode } from './startup-diagnostic.ts';

export const CORE_THREAD_VERSION = 1;
export const CORE_THREAD_BYTES = 64 * 1024 ** 2;
export type BlobBody = Extract<WireBody, { kind: 'blob' }>;
export type BodyScope = { namespace: string; commandId: string; method: string; path: string };
export type ThreadConfiguration = { namespace: string; env: NodeJS.ProcessEnv; databaseUrl: string; authToken: string; journalMode: 'verify-managed-wal'; lease: ActorLease };
export type ThreadBootstrap = { version: 1; configuration: ThreadConfiguration; fence: SharedArrayBuffer };
export type SqlFingerprint = { kind: 'exec' | 'prepare' | 'get' | 'all' | 'run'; sha256: string };
export type ThreadOperation = 'dispatch' | 'begin-quiesce' | 'quiesce' | 'close';
export class CoreThreadError extends Error {
  readonly code: string;
  constructor(code = 'core_thread_failure') { super('The mail core is unavailable.'); this.code = safeWorkerErrorCode({ code }) ?? 'core_thread_failure'; }
}
export function projectedError(error: unknown): string { return safeWorkerErrorCode(error) ?? 'core_thread_failure'; }
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function exact(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export const serial = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
export const name = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function blobBody(value: unknown): value is BlobBody {
  return record(value) && exact(value, ['kind', 'ref', 'sha256', 'bytes']) && value.kind === 'blob' && typeof value.ref === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(value.ref) &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && serial(value.bytes) && value.bytes <= CORE_THREAD_BYTES;
}
export function wireBody(value: unknown): value is WireBody {
  return blobBody(value) || record(value) && exact(value, ['kind', 'base64']) && value.kind === 'inline' && typeof value.base64 === 'string' &&
    value.base64.length <= 4_000_000 && Buffer.from(value.base64, 'base64').toString('base64') === value.base64;
}
const method = (value: unknown): value is string => typeof value === 'string' && ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].includes(value);
const path = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 8192 || !/^\/api(?:[/?]|$)/.test(value) || /[\x00-\x20\x7f\\#]/.test(value)) return false;
  try { const parsed = new URL(value, 'https://core.invalid'); return parsed.origin === 'https://core.invalid' && parsed.pathname + parsed.search === value; } catch { return false; }
};
export function bodyScope(value: unknown, namespace: string): value is BodyScope {
  return record(value) && exact(value, ['namespace', 'commandId', 'method', 'path']) && value.namespace === namespace && name(value.commandId) && method(value.method) && path(value.path);
}
function headers(value: unknown, response: boolean): boolean {
  if (!record(value) || Object.keys(value).length > 128) return false;
  return Object.entries(value).every(([key, raw]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) &&
    (typeof raw === 'string' ? [raw] : response && Array.isArray(raw) && raw.length <= 32 ? raw : [null]).every(part => typeof part === 'string' && part.length <= 8192 && !/[\r\n\0]/.test(part)));
}
export function commandRequest(value: unknown): value is CommandRequest {
  return record(value) && exact(value, ['method', 'path', 'headers', 'body']) && method(value.method) && path(value.path) && headers(value.headers, false) && wireBody(value.body);
}
export function commandResponse(value: unknown): value is CommandResponse {
  return record(value) && exact(value, ['status', 'headers', 'body']) && Number.isSafeInteger(value.status) && Number(value.status) >= 200 && Number(value.status) <= 599 && headers(value.headers, true) && wireBody(value.body);
}
export const byteArray = (value: unknown): value is Uint8Array => value instanceof Uint8Array && value.byteLength <= CORE_THREAD_BYTES;
export const errorCode = (value: unknown): value is string => typeof value === 'string' && safeWorkerErrorCode({ code: value }) === value;
export const startupStage = (value: unknown): value is CoreStartupStage => typeof value === 'string' && ['tracking-config', 'auto-draft-config', 'app-construction', 'loopback-listen'].includes(value);
export function fingerprint(value: unknown): value is SqlFingerprint {
  return record(value) && exact(value, ['kind', 'sha256']) && typeof value.kind === 'string' && ['exec', 'prepare', 'get', 'all', 'run'].includes(value.kind) && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
}
export function bootstrap(value: unknown): value is ThreadBootstrap {
  if (!record(value) || !exact(value, ['version', 'configuration', 'fence']) || value.version !== CORE_THREAD_VERSION || !(value.fence instanceof SharedArrayBuffer) || value.fence.byteLength !== 4) return false;
  const c = value.configuration;
  return record(c) && exact(c, ['namespace', 'env', 'databaseUrl', 'authToken', 'journalMode', 'lease']) && name(c.namespace) && record(c.env) &&
    Object.entries(c.env).every(([key, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && (v === undefined || typeof v === 'string')) && typeof c.databaseUrl === 'string' &&
    c.env.DATABASE_PATH === c.databaseUrl && typeof c.authToken === 'string' && c.journalMode === 'verify-managed-wal' && record(c.lease) &&
    exact(c.lease, ['namespace', 'actorId', 'epoch']) && c.lease.namespace === c.namespace && name(c.lease.actorId) && serial(c.lease.epoch);
}
