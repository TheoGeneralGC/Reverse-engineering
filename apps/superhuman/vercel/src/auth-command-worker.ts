import { createHash } from 'node:crypto';
import type { ActorCore, ActorContext } from './actor.ts';
import type { ActorLease, ControlSql, ControlTransaction } from './authority.ts';
import { DurableCommandLog, type ClaimedCommand, type CommandRequest, type CommandResponse } from './command-log.ts';
import { CommandAuthorizationRecords } from './auth-command-record.ts';
import type { AuthenticatedTransportOptions } from './auth-command-gateway.ts';
import { assertCoreBody, assertCorePath, assignmentFrom } from './auth-gateway-authority.ts';
import { AppAuthError } from './auth-values.ts';
import type { PrivateBodyTransport, BlobBody, BodyScope } from './blob-transport.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = (): CommandResponse => ({ status: 403, headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { kind: 'inline', base64: Buffer.from(JSON.stringify({ error: { code: 'auth_command_not_dispatched', message: 'This request was not dispatched.' } })).toString('base64') } });
const knownDenial = (error: unknown) => error instanceof AppAuthError && (error.code === 'auth_command_denied' || error.code === 'auth_selector_forbidden' || error.code === 'auth_core_route_forbidden');

/** Explicitly assembled worker only. It never installs schemas or adopts a
 * command without a sidecar. Completion still uses the original actor fence. */
export class AuthenticatedWorkerCommandLog extends DurableCommandLog {
  readonly records: CommandAuthorizationRecords;
  private readonly configuration: AuthenticatedTransportOptions;
  constructor(options: AuthenticatedTransportOptions) {
    super(options.sql, { namespace: options.binding.namespace, webOrigin: options.webOrigin, maxInlineBytes: options.maxInlineBytes, now: options.now });
    this.configuration = { ...options, binding: assignmentFrom(options.binding) };
    this.records = new CommandAuthorizationRecords({ registry: options.registry, namespace: options.binding.namespace, macKey: options.commandMacKey,
      keyVersion: options.commandMacVersion, now: options.now });
  }
  override async initialize(): Promise<void> { throw new AppAuthError('auth_runtime_schema_not_prepared'); }
  async authorizeClaim(tx: ControlTransaction, command: { id: string; sequence?: number }, requireSession: boolean, lease: ActorLease): Promise<CommandRequest> {
    const row = (await tx.execute('SELECT * FROM runtime_commands WHERE namespace=? AND id=?', [this.namespace, command.id])).rows[0];
    if (lease.namespace !== this.namespace || !row || row.state !== 'claimed' || row.claimed_actor !== lease.actorId || Number(row.claimed_epoch) !== lease.epoch ||
        command.sequence !== undefined && Number(row.seq) !== command.sequence) throw new AppAuthError('auth_command_corrupt');
    const request = this.normalizeRequest(JSON.parse(String(row.request_json)));
    if (hash(request) !== row.fingerprint) throw new AppAuthError('auth_command_corrupt');
    const saved = await this.records.read(tx, { id: command.id, fingerprint: String(row.fingerprint) });
    if (!saved) throw new AppAuthError('auth_legacy_command_unbound');
    const a = this.records.metadata(saved).authorization;
    if (Object.entries(this.configuration.binding).some(([k, v]) => a[k as keyof typeof a] !== v)) throw new AppAuthError('auth_command_denied');
    await this.records.assertWorkerCurrent(tx, saved, { requireSession });
    assertCorePath(request.path); if (request.body.kind === 'inline') assertCoreBody(request.headers, Buffer.from(request.body.base64, 'base64'));
    return request;
  }
  override async claimNext(lease: ActorLease): Promise<ClaimedCommand | null> {
    let entered = false;
    const guarded: ControlSql = { async execute() { throw new AppAuthError('auth_claim_scope_invalid'); }, transaction: work => {
      if (entered) throw new AppAuthError('auth_claim_scope_invalid'); entered = true;
      return this.sql.transaction(async tx => {
        const value = await work(tx), command = value as ClaimedCommand | null;
        if (!command) return value;
        try { await this.authorizeClaim(tx, command, true, lease); }
        catch (error) {
          if (!knownDenial(error)) throw error;
          const response = this.normalizeResponse(denied());
          const changed = await tx.execute("UPDATE runtime_commands SET state='completed',response_json=?,response_hash=?,updated_at=? WHERE namespace=? AND id=? AND state='claimed' AND claimed_epoch=? AND claimed_actor=?",
            [JSON.stringify(response), hash(response), this.configuration.now?.() ?? Date.now(), this.namespace, command.id, lease.epoch, lease.actorId]);
          if (changed.rowsAffected !== 1) throw new AppAuthError('auth_command_corrupt');
          return null as typeof value;
        }
        return value;
      });
    } };
    return new DurableCommandLog(guarded, { namespace: this.namespace, webOrigin: this.webOrigin, maxInlineBytes: this.maxInlineBytes, now: this.configuration.now }).claimNext(lease);
  }
}

export function withAuthenticatedDispatch(core: ActorCore, log: AuthenticatedWorkerCommandLog, lease: ActorLease,
  options: { preflightBody?: (body: BlobBody, scope: BodyScope) => Promise<Buffer> } = {}): ActorCore {
  let largeTail: Promise<void> = Promise.resolve();
  const perform = async (request: CommandRequest, command: { id: string; sequence: number }): Promise<CommandResponse> => {
      try { const saved = await log.sql.transaction(tx => log.authorizeClaim(tx, command, true, lease));
        if (hash(log.normalizeRequest(request)) !== hash(saved)) throw new AppAuthError('auth_command_corrupt');
        if (request.body.kind === 'blob') {
          if (!options.preflightBody) throw new AppAuthError('auth_command_denied');
          const bytes = await options.preflightBody(request.body, { namespace: log.namespace, commandId: command.id, method: request.method, path: request.path });
          assertCoreBody(request.headers, bytes);
        }
      }
      catch (error) { if (knownDenial(error)) return log.normalizeResponse(denied()); throw error; }
      return core.dispatch(request, command);
  };
  return { failure: core.failure, revokeAuthority: () => core.revokeAuthority?.(), beginQuiesce: () => core.beginQuiesce?.(), quiesce: () => core.quiesce(), close: () => core.close(),
    async dispatch(request, command) {
      if (request.body.kind !== 'blob') return perform(request, command);
      const previous = largeTail; let release!: () => void; largeTail = new Promise(resolve => { release = resolve; });
      await previous; try { return await perform(request, command); } finally { release(); }
    } };
}

/** Native authorization linearizes at this current assignment check. Already
 * admitted/granted operations can drain; this is not per-session cancellation. */
export function withTenantNativeAuthority(context: ActorContext, options: AuthenticatedTransportOptions): ActorContext {
  return Object.freeze({ lease: context.lease, assertLocal: () => context.assertLocal(), runNative<T>(operation: () => Promise<T>): Promise<T> {
    return context.runNative(async () => {
      await options.sql.transaction(async tx => {
        const current = await options.registry.forUser(options.binding.userId, tx);
        if (JSON.stringify(current) !== JSON.stringify(assignmentFrom(options.binding))) throw new AppAuthError('auth_command_denied');
      });
      context.assertLocal(); return operation();
    });
  } });
}
export function guardTenantCoreConstruction(options: AuthenticatedTransportOptions, create: (context: ActorContext) => Promise<ActorCore> | ActorCore) {
  return async (context: ActorContext): Promise<ActorCore> => {
    await options.sql.transaction(async tx => {
      const current = await options.registry.forUser(options.binding.userId, tx);
      if (JSON.stringify(current) !== JSON.stringify(assignmentFrom(options.binding))) throw new AppAuthError('auth_command_denied');
    });
    context.assertLocal(); return create(withTenantNativeAuthority(context, options));
  };
}

export function withAuthenticatedBodies(bodies: Pick<PrivateBodyTransport, 'readRequestBody' | 'writeResponseBody'>, log: AuthenticatedWorkerCommandLog, lease: ActorLease) {
  const check = async (scope: BodyScope) => {
    if (scope.namespace !== log.namespace) throw new AppAuthError('auth_command_denied');
    const request = await log.sql.transaction(tx => log.authorizeClaim(tx, { id: scope.commandId }, false, lease));
    if (request.method !== scope.method || request.path !== scope.path) throw new AppAuthError('auth_command_corrupt'); return request;
  };
  return { async readRequestBody(body: BlobBody, scope: BodyScope) { const request = await check(scope);
      if (request.body.kind !== 'blob' || hash(request.body) !== hash(body)) throw new AppAuthError('auth_command_corrupt');
      const bytes = await bodies.readRequestBody(body, scope);
      assertCoreBody(request.headers, bytes); return bytes; },
    async writeResponseBody(scope: BodyScope, bytes: Buffer) { await check(scope); return bodies.writeResponseBody(scope, bytes); } };
}
