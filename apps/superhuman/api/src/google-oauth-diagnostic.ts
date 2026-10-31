import { HttpError } from './types.ts';

export const GOOGLE_OAUTH_CALLBACK_PHASES = [
  'state-validation', 'state-read', 'state-consume', 'context-read', 'token-exchange',
  'calendar-account-read', 'calendar-userinfo-fetch', 'calendar-userinfo-json', 'calendar-identity-check',
  'calendar-existing-token-read', 'calendar-begin', 'calendar-grant-write', 'calendar-token-save', 'calendar-commit', 'calendar-rollback',
  'mail-profile-fetch', 'mail-profile-json', 'mail-existing-token-read', 'mail-begin', 'mail-grant-write', 'mail-token-save',
  'mail-account-write', 'mail-preferences-write', 'mail-commit', 'mail-rollback',
] as const;
export type GoogleOAuthCallbackPhase = typeof GOOGLE_OAUTH_CALLBACK_PHASES[number];
const phases = new Set<string>(GOOGLE_OAUTH_CALLBACK_PHASES);
const codes = new Set([
  'ERR_SQLITE_ERROR', 'SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_CHECK', 'SQLITE_READONLY', 'SQLITE_IOERR',
  'SQLITE_FULL', 'SQLITE_CANTOPEN', 'SQLITE_MISUSE', 'SQLITE_ABORT', 'SQLITE_SCHEMA', 'SQLITE_RANGE', 'SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_INTERRUPT',
  'STREAM_EXPIRED', 'TRANSACTION_CLOSED', 'HRANA_PROTO_ERROR', 'HRANA_CLOSED_ERROR', 'SERVER_ERROR', 'PROTOCOL_VERSION_ERROR',
]);
export type GoogleOAuthCallbackDiagnostic = { event: 'google_oauth_callback_failed'; phase: GoogleOAuthCallbackPhase; errorClass: 'HttpError' | 'SyntaxError' | 'TypeError' | 'RangeError' | 'DOMException' | 'Error' | 'Unknown'; code?: string };
const classes = new Set(['HttpError', 'SyntaxError', 'TypeError', 'RangeError', 'DOMException', 'Error', 'Unknown']);
export function googleOAuthCallbackDiagnostic(value: unknown): value is GoogleOAuthCallbackDiagnostic {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>, keys = Object.keys(row);
    return keys.length >= 3 && keys.length <= 4 && ['event', 'phase', 'errorClass'].every(key => Object.hasOwn(row, key)) &&
      keys.every(key => ['event', 'phase', 'errorClass', 'code'].includes(key)) && row.event === 'google_oauth_callback_failed' &&
      typeof row.phase === 'string' && phases.has(row.phase) && typeof row.errorClass === 'string' && classes.has(row.errorClass) &&
      (!Object.hasOwn(row, 'code') || typeof row.code === 'string' && codes.has(row.code));
  } catch { return false; }
}
export function writeGoogleOAuthCallbackDiagnostic(entry: GoogleOAuthCallbackDiagnostic): void {
  try { if (googleOAuthCallbackDiagnostic(entry)) console.error(JSON.stringify({ event: entry.event, phase: entry.phase, errorClass: entry.errorClass, ...(entry.code === undefined ? {} : { code: entry.code }) })); } catch {}
}
function ownCode(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
/** Fixed projection only. Never inspect messages, stacks, causes, URLs or data.
 * A diagnostic observer failure must not change callback or rollback behavior. */
export function reportGoogleOAuthCallbackFailure(phase: GoogleOAuthCallbackPhase, error: unknown, report?: (entry: GoogleOAuthCallbackDiagnostic) => void): void {
  if (typeof report !== 'function' || !phases.has(phase)) return;
  let errorClass: GoogleOAuthCallbackDiagnostic['errorClass'] = 'Unknown', code: string | undefined;
  try {
    errorClass = error instanceof HttpError ? 'HttpError' : error instanceof SyntaxError ? 'SyntaxError' : error instanceof TypeError ? 'TypeError'
      : error instanceof RangeError ? 'RangeError' : error instanceof DOMException ? 'DOMException' : error instanceof Error ? 'Error' : 'Unknown';
    const value = ownCode(error); if (typeof value === 'string' && codes.has(value)) code = value;
  } catch { /* A hostile exception cannot make diagnostics inspect other fields. */ }
  try { report(Object.freeze({ event: 'google_oauth_callback_failed', phase, errorClass, ...(code === undefined ? {} : { code }) })); } catch {}
}
