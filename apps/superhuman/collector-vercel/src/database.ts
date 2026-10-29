import { requireValue } from '../../collector/src/protocol.ts';
export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, unknown>;
export interface Statement { get(...args: SqlValue[]): Promise<Row | undefined>; all(...args: SqlValue[]): Promise<Row[]>; run(...args: SqlValue[]): Promise<{ changes: number }>; }
export interface SqlConnection { prepare(sql: string): Statement; }
export interface CollectorDatabase { primaryTransaction<T>(work: (tx: SqlConnection) => Promise<T>, canCommit?: () => boolean): Promise<T>; readableMarker(): Promise<boolean>; close(): void; }
export const MARKER = 'rea-tracking-collector-v2';
const tables = ['tracking_meta','tracking_registrations','tracking_bindings','tracking_requests','tracking_nonces','tracking_tenant_revisions','tracking_events','tracking_throttle'];
/** Must run on the actual transaction/session. Reading FK state does not try to change it inside BEGIN. */
export async function validateSchema(db: SqlConnection) {
  const objects = await db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  const names = objects.filter(r => r.type === 'table').map(r => r.name);
  requireValue(names.length === tables.length && tables.every(n => names.includes(n)) && objects.every(r => r.type === 'table' || r.type === 'index' && ['tracking_registration_account','tracking_events_rate'].includes(String(r.name))),500,'collector_database_identity_mismatch');
  requireValue((await db.prepare("SELECT value FROM tracking_meta WHERE key='schema'").get())?.value === MARKER,500,'collector_database_identity_mismatch');
  requireValue((await db.prepare('PRAGMA foreign_keys').get())?.foreign_keys === 1,500,'collector_database_identity_mismatch');
}
