import type { ControlTransaction } from './authority.ts';
import { readVerifiedIdentity, type VerifiedGoogleIdentity } from './auth-identity.ts';
import { AppAuthError, authInteger, authRef, authStoragePort } from './auth-values.ts';

export type TenantStorageDescriptor = Readonly<{ storageRef: string; tenantId: string; primaryRef: string;
  secretRef: string; keyRef: string; generation: number; namespace: string }>;
export type PersonalAssignment = Readonly<{ userId: string; userAuthEpoch: number; tenantId: string;
  tenantAuthzEpoch: number; membershipAuthzEpoch: number; storageRef: string; storageGeneration: number; namespace: string }>;
/** These are opaque references in trusted server configuration, never client
 * supplied URLs/credentials. Construction performs no database/provider IO. */
export class PersonalTenantRegistry {
  private readonly sql: ControlTransaction;
  private readonly catalog = new Map<string, TenantStorageDescriptor>();
  constructor(sql: ControlTransaction, storageCatalog: readonly TenantStorageDescriptor[]) {
    this.sql = authStoragePort(sql);
    for (const source of storageCatalog) {
      const row = Object.freeze({ storageRef: authRef(source.storageRef), tenantId: authRef(source.tenantId), primaryRef: authRef(source.primaryRef),
        secretRef: authRef(source.secretRef), keyRef: authRef(source.keyRef), generation: authInteger(source.generation), namespace: authRef(source.namespace) });
      if (this.catalog.has(row.storageRef) || [...this.catalog.values()].some(old => old.tenantId === row.tenantId || old.primaryRef === row.primaryRef || old.namespace === row.namespace)) throw new AppAuthError('auth_configuration_invalid');
      this.catalog.set(row.storageRef, row);
    }
  }
  async forVerifiedIdentity(identity: VerifiedGoogleIdentity, sql: ControlTransaction = this.sql): Promise<PersonalAssignment> {
    const verified = readVerifiedIdentity(identity);
    const { rows } = await authStoragePort(sql).execute('SELECT user_id FROM external_identities WHERE issuer=? AND subject=?', [verified.issuer, verified.subject]);
    if (rows.length !== 1) throw new AppAuthError('auth_identity_not_provisioned');
    return this.forUser(authRef(rows[0]!.user_id), sql);
  }
  async forUser(userId: string, sql: ControlTransaction = this.sql): Promise<PersonalAssignment> {
    authRef(userId);
    const { rows } = await authStoragePort(sql).execute(`SELECT u.user_id,u.status AS user_status,u.auth_epoch,
      t.tenant_id,t.status AS tenant_status,t.authz_epoch AS tenant_epoch,t.owner_user_id,
      m.status AS membership_status,m.authz_epoch AS membership_epoch,
      s.storage_ref,s.status AS storage_status,s.primary_ref,s.secret_ref,s.key_ref,s.generation,
      r.namespace,r.storage_generation,r.tenant_id AS runtime_tenant,r.storage_ref AS runtime_storage
      FROM app_users u JOIN personal_memberships m ON m.user_id=u.user_id
      JOIN personal_tenants t ON t.tenant_id=m.tenant_id
      JOIN tenant_storage s ON s.tenant_id=t.tenant_id
      JOIN tenant_runtimes r ON r.tenant_id=t.tenant_id
      WHERE u.user_id=?`, [userId]);
    if (rows.length !== 1) throw new AppAuthError('auth_assignment_unavailable');
    const r = rows[0]!;
    if (r.user_status !== 'active' || r.tenant_status !== 'active' || r.membership_status !== 'active' || r.storage_status !== 'active' ||
        r.owner_user_id !== userId || r.runtime_tenant !== r.tenant_id || r.runtime_storage !== r.storage_ref) throw new AppAuthError('auth_assignment_unavailable');
    const storageRef = authRef(r.storage_ref), tenantId = authRef(r.tenant_id), generation = authInteger(r.generation);
    const configured = this.catalog.get(storageRef);
    if (!configured || configured.tenantId !== tenantId || configured.generation !== generation || authInteger(r.storage_generation) !== generation ||
        configured.primaryRef !== r.primary_ref || configured.secretRef !== r.secret_ref || configured.keyRef !== r.key_ref || configured.namespace !== r.namespace) throw new AppAuthError('auth_assignment_unavailable');
    return Object.freeze({ userId, userAuthEpoch: authInteger(r.auth_epoch), tenantId, tenantAuthzEpoch: authInteger(r.tenant_epoch),
      membershipAuthzEpoch: authInteger(r.membership_epoch), storageRef, storageGeneration: generation, namespace: authRef(r.namespace) });
  }
}
