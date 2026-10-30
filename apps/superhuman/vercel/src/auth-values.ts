import type { ControlSql, ControlTransaction } from './authority.ts';

/** Disabled primitives: importing this module installs no handler or storage. */
export class AppAuthError extends Error {
  readonly code: string;
  constructor(code: string) { super('Application authorization is unavailable.'); this.name = 'AppAuthError'; this.code = code; }
}
export function authRef(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)) throw new AppAuthError('auth_assignment_invalid');
  return value;
}
export function authInteger(value: unknown, minimum = 1): number {
  if (typeof value === 'bigint' && value >= BigInt(minimum) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new AppAuthError('auth_record_invalid');
  return value;
}
export function authTime(value: unknown): number { return authInteger(value, 0); }
export function canonicalAuthOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppAuthError('auth_configuration_invalid'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.port) throw new AppAuthError('auth_configuration_invalid');
  return value;
}
/** Never inspect or retain a driver's private error fields, SQL, bindings or
 * endpoint. A failed transaction boundary may have committed: do not retry. */
export function authStoragePort(source: ControlTransaction): ControlTransaction {
  return Object.freeze({ async execute(sql, args) {
    try { return await source.execute(sql, args); }
    catch (error) { if (error instanceof AppAuthError) throw error; throw new AppAuthError('auth_storage_unavailable'); }
  } } satisfies ControlTransaction);
}
export function authStorageDatabase(source: ControlSql): ControlSql {
  const port = authStoragePort(source);
  return Object.freeze({ execute: port.execute, async transaction(work) {
    try { return await source.transaction(tx => work(authStoragePort(tx))); }
    catch (error) { if (error instanceof AppAuthError) throw error; throw new AppAuthError('auth_storage_outcome_unknown'); }
  } } satisfies ControlSql);
}
