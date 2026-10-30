import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ControlTransaction } from './authority.ts';
import type { CommandAuthorization } from './auth-sessions.ts';
import type { PersonalTenantRegistry } from './auth-registry.ts';
import { AppAuthError, authInteger, authRef, authTime } from './auth-values.ts';

declare const recordBrand: unique symbol;
export type StoredCommandAuthorization = Readonly<{ [recordBrand]: true }>;
type RecordData = Readonly<{ id: string; fingerprint: string; authorization: CommandAuthorization }>;
const fields = ['userId', 'userAuthEpoch', 'tenantId', 'tenantAuthzEpoch', 'membershipAuthzEpoch', 'storageRef', 'storageGeneration', 'namespace',
  'sessionRecordId', 'sessionGeneration', 'purpose', 'policyVersion'];
function commandId(value: string): string { if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new AppAuthError('auth_command_corrupt'); return value; }
function fingerprint(value: string): string { if (!/^[a-f0-9]{64}$/.test(value)) throw new AppAuthError('auth_command_corrupt'); return value; }
function canonical(value: unknown): CommandAuthorization {
  try {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new AppAuthError('auth_command_corrupt');
  const a = value as CommandAuthorization;
  if (a.purpose !== 'interactive-product' || a.policyVersion !== 1) throw new AppAuthError('auth_command_corrupt');
  return Object.freeze({ userId: authRef(a.userId), userAuthEpoch: authInteger(a.userAuthEpoch), tenantId: authRef(a.tenantId),
    tenantAuthzEpoch: authInteger(a.tenantAuthzEpoch), membershipAuthzEpoch: authInteger(a.membershipAuthzEpoch), storageRef: authRef(a.storageRef),
    storageGeneration: authInteger(a.storageGeneration), namespace: authRef(a.namespace), sessionRecordId: authRef(a.sessionRecordId),
    sessionGeneration: authInteger(a.sessionGeneration), purpose: 'interactive-product', policyVersion: 1 });
  } catch { throw new AppAuthError('auth_command_corrupt'); }
}
/** Private storage primitive, not an HTTP admission API. bind's metadata must be
 * minted by actual server session/CSRF verification inside its caller's tx. */
export class CommandAuthorizationRecords {
  readonly namespace: string;
  private readonly registry: PersonalTenantRegistry;
  private readonly key: Buffer;
  private readonly keyVersion: number;
  private readonly now: () => number;
  private readonly records = new WeakMap<object, RecordData>();
  constructor(options: { registry: PersonalTenantRegistry; namespace: string; macKey: Uint8Array; keyVersion: number; now?: () => number }) {
    this.registry = options.registry; this.namespace = authRef(options.namespace); this.keyVersion = authInteger(options.keyVersion); this.now = options.now ?? Date.now;
    if (!(options.macKey instanceof Uint8Array) || options.macKey.byteLength !== 32) throw new AppAuthError('auth_configuration_invalid'); this.key = Buffer.from(options.macKey);
  }
  private mac(data: RecordData): Buffer {
    return createHmac('sha256', this.key).update('rea/command-authorization/v1\0').update(JSON.stringify([this.keyVersion, this.namespace, data.id, data.fingerprint, data.authorization])).digest();
  }
  private branded(data: RecordData): StoredCommandAuthorization {
    const record = Object.freeze(Object.create(null)) as StoredCommandAuthorization; this.records.set(record, data); return record;
  }
  metadata(record: StoredCommandAuthorization): Readonly<RecordData> {
    const data = record && typeof record === 'object' ? this.records.get(record) : undefined;
    if (!data) throw new AppAuthError('auth_command_corrupt'); return data;
  }
  async bind(tx: ControlTransaction, input: { id: string; fingerprint: string; authorization: CommandAuthorization }): Promise<void> {
    const data: RecordData = Object.freeze({ id: commandId(input.id), fingerprint: fingerprint(input.fingerprint), authorization: canonical(input.authorization) });
    if (data.authorization.namespace !== this.namespace) throw new AppAuthError('auth_command_denied');
    const old = await this.read(tx, { id: data.id, fingerprint: data.fingerprint });
    if (old) { if (JSON.stringify(this.metadata(old)) !== JSON.stringify(data)) throw new AppAuthError('auth_command_denied'); return; }
    await tx.execute('INSERT INTO app_command_authorizations(namespace,id,request_fingerprint,authorization_json,key_version,mac) VALUES(?,?,?,?,?,?)',
      [this.namespace, data.id, data.fingerprint, JSON.stringify(data.authorization), this.keyVersion, this.mac(data)]);
  }
  async read(tx: ControlTransaction, input: { id: string; fingerprint: string }): Promise<StoredCommandAuthorization | null> {
    const id = commandId(input.id), expected = fingerprint(input.fingerprint);
    const { rows } = await tx.execute('SELECT * FROM app_command_authorizations WHERE namespace=? AND id=?', [this.namespace, id]);
    if (!rows.length) return null;
    const row = rows[0]!; let parsed: unknown;
    try { parsed = JSON.parse(String(row.authorization_json)); } catch { throw new AppAuthError('auth_command_corrupt'); }
    const data: RecordData = Object.freeze({ id, fingerprint: expected, authorization: canonical(parsed) });
    let version: number; try { version = authInteger(row.key_version); } catch { throw new AppAuthError('auth_command_corrupt'); }
    if (rows.length !== 1 || row.id !== id || row.namespace !== this.namespace || row.request_fingerprint !== expected || version !== this.keyVersion ||
        data.authorization.namespace !== this.namespace || JSON.stringify(data.authorization) !== row.authorization_json ||
        !(row.mac instanceof Uint8Array) || row.mac.byteLength !== 32 || !timingSafeEqual(row.mac, this.mac(data))) throw new AppAuthError('auth_command_corrupt');
    return this.branded(data);
  }
  assertReader(record: StoredCommandAuthorization, current: CommandAuthorization): void {
    const saved = this.metadata(record).authorization;
    if (current.userId !== saved.userId || current.tenantId !== saved.tenantId || current.namespace !== saved.namespace || current.storageRef !== saved.storageRef ||
        current.storageGeneration !== saved.storageGeneration) throw new AppAuthError('auth_command_denied');
  }
  async assertWorkerCurrent(tx: ControlTransaction, record: StoredCommandAuthorization, options: { requireSession?: boolean } = {}): Promise<void> {
    const saved = this.metadata(record).authorization;
    let assignment;
    try { assignment = await this.registry.forUser(saved.userId, tx); }
    catch (error) {
      if (error instanceof AppAuthError && error.code.startsWith('auth_storage_')) throw error;
      if (error instanceof AppAuthError && error.code === 'auth_assignment_unavailable') throw new AppAuthError('auth_command_denied');
      throw new AppAuthError('auth_command_corrupt');
    }
    if (Object.entries(assignment).some(([name, value]) => saved[name as keyof CommandAuthorization] !== value)) throw new AppAuthError('auth_command_denied');
    if (options.requireSession === false) return;
    const { rows } = await tx.execute('SELECT * FROM app_sessions WHERE session_record_id=?', [saved.sessionRecordId]), row = rows[0], now = authTime(this.now());
    if (rows.length !== 1 || !row || row.state !== 'active' || row.authority_class !== 'interactive-product' || row.user_id !== saved.userId ||
        authInteger(row.generation) !== saved.sessionGeneration || authInteger(row.user_auth_epoch) !== saved.userAuthEpoch ||
        authTime(row.created_ms) > now || authTime(row.last_interactive_ms) < authTime(row.created_ms) || authTime(row.last_interactive_ms) > now ||
        authTime(row.idle_expires_ms) <= now || authTime(row.absolute_expires_ms) <= now || authTime(row.idle_expires_ms) > authTime(row.absolute_expires_ms) ||
        authTime(row.absolute_expires_ms) - authTime(row.created_ms) > 7 * 24 * 3_600_000 ||
        authTime(row.idle_expires_ms) - authTime(row.last_interactive_ms) > 8 * 3_600_000) throw new AppAuthError('auth_command_denied');
  }
}
