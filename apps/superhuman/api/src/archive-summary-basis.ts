import type { Store } from './store.ts';
import type { ThreadListPage } from './types.ts';
import type { SqlRow } from './sql-database.ts';
import { currentAccountIncarnation } from './account-incarnation.ts';
import { archiveHash, archiveHex, archiveId, type ArchiveBasis } from './archive-action-contract.ts';
import { publicWireValue } from './reminder-message-projection.ts';

const maximumRows = 100, maximumPairBytes = 128 * 1024;
const headQuery = `SELECT json_extract(r.value,'$[0]') requested_account_id,
  json_extract(r.value,'$[1]') requested_thread_id,
  CASE WHEN typeof(h.epoch) IN ('integer','real') AND h.epoch>=1 AND h.epoch<=9007199254740991
    AND h.epoch=CAST(h.epoch AS INTEGER) THEN h.epoch END epoch,
  CASE WHEN typeof(h.present) IN ('integer','real') AND h.present=1 THEN 1 END present,
  CASE WHEN typeof(h.account_id)='text' THEN h.account_id END account_id,
  CASE WHEN typeof(h.source_version)='text' THEN h.source_version END source_version
  FROM json_each(?) r LEFT JOIN archive_action_heads h ON h.thread_id=json_extract(r.value,'$[1]')`;
const batchId = (value: unknown): value is string => archiveId(value) && Buffer.from(value, 'utf8').toString('utf8') === value;
const pairKey = (accountId: string, threadId: string) => JSON.stringify([accountId, threadId]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const target = (value: Record<string, unknown>) => typeof value.id === 'string' && typeof value.accountId === 'string' && typeof value.folder === 'string' && typeof value.subject === 'string' && (Array.isArray(value.messages) || typeof value.messageCount === 'number');
function nestedTarget(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(nestedTarget);
  return object(value) && (target(value) || Object.values(value).some(nestedTarget));
}
function normalPage(value: unknown): value is ThreadListPage {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'counts,hasMore,nextCursor,threads,total' || !Array.isArray(value.threads) || value.threads.length > maximumRows) return false;
  return value.threads.every(thread => object(thread) && target(thread) && !Array.isArray(thread.messages) && batchId(thread.id) && batchId(thread.accountId) && Object.values(thread).every(child => !nestedTarget(child))) &&
    Object.entries(value).every(([key, child]) => key === 'threads' || !nestedTarget(child));
}
function basis(head: SqlRow, threadId: string, accountId: string, accountVersion: string): ArchiveBasis | null {
  // These are the scalar actionBasis checks and formula. CASE above protects
  // only transport: one unsafe native integer must not abort unrelated rows.
  if (head.account_id !== accountId || head.present !== 1 || !Number.isSafeInteger(head.epoch) || Number(head.epoch) < 1 || !archiveHex(head.source_version)) return null;
  return { version: 1, accountVersion, sourceVersion: archiveHash({ version: 1, threadId, accountId, epoch: head.epoch, nonce: head.source_version }) };
}

/** Only the summary HTTP route uses this invocation-local read snapshot.
 * Eligibility/action admission and all other recursive annotation stay scalar.
 * No data or authority survives this call; a later action revalidates itself. */
export function readArchiveSummaryPage(store: Store, read: () => ThreadListPage, eligible: (accountId: string) => boolean, legacy: (wire: unknown) => unknown): unknown {
  store.db.exec('SAVEPOINT archive_summary_read');
  try {
    const wire = publicWireValue(store, read());
    let result: unknown;
    if (!normalPage(wire)) result = legacy(wire);
    else {
      const pairs = [...new Map(wire.threads.map(thread => [pairKey(thread.accountId, thread.id), [thread.accountId, thread.id] as const])).values()];
      const encoded = JSON.stringify(pairs);
      if (Buffer.byteLength(encoded) > maximumPairBytes) result = legacy(wire);
      else {
        const versions = new Map<string, string | null>();
        for (const [accountId] of pairs) {
          if (versions.has(accountId)) continue;
          let version: string | null = null;
          if (eligible(accountId)) try { version = currentAccountIncarnation(store, accountId); } catch { /* Same unavailable-incarnation outcome as scalar basis. */ }
          versions.set(accountId, version);
        }
        const selected = pairs.filter(([accountId]) => typeof versions.get(accountId) === 'string'), heads = new Map<string, ArchiveBasis | null>();
        if (selected.length && store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='archive_action_heads'").get()) {
          // Missing schema is null; unexpected prepare/all errors fail this GET.
          // Never replay failed batch SQL through the legacy/scalar path.
          const rows = store.db.prepare(headQuery).all(JSON.stringify(selected)), expected = new Set(selected.map(([a, t]) => pairKey(a, t)));
          if (rows.length !== selected.length) throw new TypeError('Invalid summary basis result');
          for (const row of rows) {
            if (typeof row.requested_account_id !== 'string' || typeof row.requested_thread_id !== 'string') throw new TypeError('Invalid summary basis result');
            const key = pairKey(row.requested_account_id, row.requested_thread_id);
            if (!expected.delete(key)) throw new TypeError('Invalid summary basis result');
            heads.set(key, basis(row, row.requested_thread_id, row.requested_account_id, versions.get(row.requested_account_id)!));
          }
          if (expected.size) throw new TypeError('Invalid summary basis result');
        }
        result = { ...wire, threads: wire.threads.map(thread => { const found = heads.get(pairKey(thread.accountId, thread.id)); return { ...thread, archiveBasis: found ? { ...found } : null }; }) };
      }
    }
    store.db.exec('RELEASE archive_summary_read');
    return result;
  } catch (error) {
    try { store.db.exec('ROLLBACK TO archive_summary_read; RELEASE archive_summary_read'); } catch { /* A lost/poisoned frontier is not recovered or retried. */ }
    throw error;
  }
}
