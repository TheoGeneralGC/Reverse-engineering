import type { ControlSql, ControlTransaction } from './authority.ts';
import { DurableCommandLog, CommandLogError, type CommandRequest } from './command-log.ts';
import { PrivateBodyTransport, BlobTransportError, type PrivateBlobPort } from './blob-transport.ts';
import type { BridgeCommandLog, TransportBodyAdapter } from './http-bridge.ts';
import type { PersonalAssignment, PersonalTenantRegistry } from './auth-registry.ts';
import { AppAuthError } from './auth-values.ts';
import { CommandAuthorizationRecords } from './auth-command-record.ts';
import { GatewayRequestAuthority, assertCoreBody, assertCorePath, assignmentFrom, readOnlyAuthSql, type RequestGrant } from './auth-gateway-authority.ts';

export type TenantBinding = Readonly<PersonalAssignment>;
export type AuthenticatedTransportOptions = { sql: ControlSql; binding: TenantBinding; registry: PersonalTenantRegistry; webOrigin: string;
  commandMacKey: Uint8Array; commandMacVersion: number; blob?: { port: PrivateBlobPort; privateOrigin: string }; maxInlineBytes?: number; now?: () => number };
export function authStatus(error: AppAuthError): number {
  if (error.code.startsWith('auth_storage_') || error.code.includes('corrupt') || error.code.includes('legacy_command') || error.code === 'auth_record_invalid' || error.code === 'auth_assignment_invalid') return 503;
  if (error.code.includes('csrf') || error.code.includes('origin') || error.code.includes('selector') || error.code.includes('denied') || error.code.includes('forbidden') || error.code.includes('legacy_receipt') || error.code.includes('assignment') || error.code === 'auth_mailbox_consent_unavailable') return 403;
  if (error.code.includes('session') || error.code.includes('cookie')) return 401;
  return 400;
}
export async function translateAuth<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof AppAuthError) throw new CommandLogError(error.code, authStatus(error));
    if (error instanceof BlobTransportError) throw new CommandLogError(error.code, error.status);
    throw error;
  }
}
/** Cached only by protected assignment. Contains no request/session closure. */
export class AuthenticatedTenantTransport {
  private readonly options: AuthenticatedTransportOptions;
  readonly records: CommandAuthorizationRecords;
  constructor(options: AuthenticatedTransportOptions) {
    this.options = { ...options, binding: assignmentFrom(options.binding), commandMacKey: Buffer.from(options.commandMacKey) };
    this.records = new CommandAuthorizationRecords({ registry: options.registry, namespace: options.binding.namespace,
      macKey: options.commandMacKey, keyVersion: options.commandMacVersion, now: options.now });
  }
  private scope(authority: GatewayRequestAuthority, grant: RequestGrant): ReturnType<GatewayRequestAuthority['metadata']> {
    const a = authority.metadata(grant), b = this.options.binding;
    if (Object.entries(b).some(([name, value]) => a[name as keyof typeof a] !== value)) throw new AppAuthError('auth_command_denied'); return a;
  }
  private log(sql: ControlSql, bodies?: PrivateBodyTransport): DurableCommandLog {
    return new DurableCommandLog(sql, { namespace: this.options.binding.namespace, webOrigin: this.options.webOrigin, now: this.options.now,
      maxInlineBytes: this.options.maxInlineBytes, authorizeBody: async (tx, request, scope) => {
        if (!bodies || request.body.kind !== 'blob') throw new AppAuthError('auth_transport_unavailable'); await bodies.authorizeRequestBody(tx, request.body, scope);
      } });
  }
  forRequest(authority: GatewayRequestAuthority, accepted: RequestGrant): { commandLog: BridgeCommandLog; bodyAdapter?: TransportBodyAdapter; blobDownloadOrigin?: string } {
    this.scope(authority, accepted);
    const { sql, binding, blob, now } = this.options, namespace = binding.namespace;
    const check = async (tx: ControlTransaction) => this.scope(authority, await authority.authorize(tx));
    // execute guards are short auth+read transactions. A later SDK URL grant is
    // outside the DB transaction; no provider await holds a Control write lock.
    const guardedBodies: ControlSql = { execute: (statement, args) => sql.transaction(async tx => { await check(tx); return tx.execute(statement, args); }),
      transaction: work => sql.transaction(async tx => { await check(tx); return work(tx); }) };
    const bodies = blob ? new PrivateBodyTransport({ sql: guardedBodies, namespace, blob: blob.port, now }) : undefined;
    const rawNormalizer = this.log(sql, bodies);
    const owner = async (tx: ControlTransaction, id: string, current: ReturnType<typeof this.scope>) => {
      const row = (await tx.execute('SELECT fingerprint FROM runtime_commands WHERE namespace=? AND id=?', [namespace, id])).rows[0];
      if (!row) return null;
      const saved = await this.records.read(tx, { id, fingerprint: String(row.fingerprint) });
      if (!saved) return null; // Explicit legacy policy: never auto-adopt.
      this.records.assertReader(saved, current); return saved;
    };
    const commandLog: BridgeCommandLog = {
      namespace, webOrigin: this.options.webOrigin, maxInlineBytes: rawNormalizer.maxInlineBytes, maxBlobBytes: rawNormalizer.maxBlobBytes,
      enqueue: input => translateAuth(async () => {
        assertCorePath(input.request.path);
        const request: CommandRequest = { ...input.request, headers: Object.fromEntries(Object.entries(input.request.headers).filter(([k]) => k === 'origin' || k === 'content-type')) };
        if (request.body.kind === 'inline') assertCoreBody(request.headers, Buffer.from(request.body.base64, 'base64'));
        let entered = false;
        const admission: ControlSql = { async execute() { throw new AppAuthError('auth_admission_scope_invalid'); }, transaction: work => {
          if (entered) throw new AppAuthError('auth_admission_scope_invalid'); entered = true;
          return sql.transaction(async tx => {
            const current = await check(tx), old = (await tx.execute('SELECT fingerprint FROM runtime_commands WHERE namespace=? AND id=?', [namespace, input.id])).rows[0];
            if (old && !await owner(tx, input.id, current)) throw new AppAuthError('auth_legacy_receipt_unbound');
            const value = await work(tx);
            if (!old) {
              const row = (await tx.execute('SELECT fingerprint FROM runtime_commands WHERE namespace=? AND id=?', [namespace, input.id])).rows[0];
              if (!row) throw new AppAuthError('auth_command_corrupt');
              await this.records.bind(tx, { id: input.id, fingerprint: String(row.fingerprint), authorization: current });
            }
            return value;
          });
        } };
        return this.log(admission, bodies).enqueue({ ...input, request });
      }),
      readResult: (requestedNamespace, id) => translateAuth(() => sql.transaction(async tx => {
        const current = await check(tx);
        if (requestedNamespace !== namespace) throw new AppAuthError('auth_command_denied');
        if (!await owner(tx, id, current)) return null;
        return this.log(readOnlyAuthSql(tx)).readResult(namespace, id);
      })),
    };
    const bodyAdapter: TransportBodyAdapter | undefined = bodies ? {
      validateRequestBody: (body, scope) => translateAuth(async () => { if (scope.namespace !== namespace) throw new AppAuthError('auth_command_denied'); assertCorePath(scope.path); await bodies.validateRequestBody(body, scope); }),
      createRequestUpload: (scope, bytes, sha256) => translateAuth(async () => { if (scope.namespace !== namespace) throw new AppAuthError('auth_command_denied'); assertCorePath(scope.path); return bodies.createRequestUpload(scope, bytes, sha256); }),
      responseDownload: (body, scope) => translateAuth(async () => {
        await sql.transaction(async tx => { const current = await check(tx); if (scope.namespace !== namespace || !await owner(tx, scope.commandId, current)) throw new AppAuthError('auth_command_denied'); });
        return bodies.responseDownload(body, scope);
      }),
    } : undefined;
    return { commandLog, ...(bodyAdapter ? { bodyAdapter, blobDownloadOrigin: blob!.privateOrigin } : {}) };
  }
}
