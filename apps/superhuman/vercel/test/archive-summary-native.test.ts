import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import Libsql from 'libsql';
import { createApp } from '../../api/src/server.ts';
import type { Thread } from '../../api/src/types.ts';
import { publicWireValue } from '../../api/src/reminder-message-projection.ts';
import { adaptLibsqlDatabase } from '../src/sql.ts';
const denial = (globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
after(() => assert.equal(denial.attempts, 0));
const row = (id: string): Thread => ({ id, accountId: 'a', providerId: id, subject: 'Fictional ' + id, snippet: 'Metadata', sender: { email: 'own@example.test', name: 'Own' }, participants: [], lastMessageAt: '2026-10-27T00:00:00.000Z', unread: true, starred: false, important: true, folder: 'inbox', labels: [], messages: [] });
function fixture(guard?: (kind: string, sql: string) => void) {
  let closed = 0;
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, providerDraftAutomatic: false, databaseFactory(path) {
    assert.equal(path, ':memory:'); const port = adaptLibsqlDatabase(new Libsql(path), operation => guard?.(operation.kind, operation.sql)), close = port.close.bind(port); port.close = () => { if (!closed) { close(); closed++; } }; return port;
  } });
  app.store.put('account', 'a', { id: 'a', provider: 'google', email: 'own@example.test', name: 'Own', color: '#888' });
  app.store.put('googleGrant', 'mail:a', { accountId: 'a', service: 'mail', outcome: 'granted', scopeSource: 'response', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
  app.store.put('preferences', 'global', { activeAccountId: 'a', splitInbox: ['Important', 'Other'], snippets: [] });
  app.store.put('thread', 'bad', row('bad')); app.store.put('thread', 'good', row('good'));
  const page = app.store.threadSummaries({ accountId: 'a' });
  return { app, page, legacy: () => app.archiveActions!.annotate(publicWireValue(app.store, page)), batch: () => app.archiveActions!.summaryPage(() => page), async close() { await app.close(); assert.equal(closed, 1); } };
}
test('pinned native libsql scalar and bounded projection agree for unsafe64-bit, affinity, real and blob head values without losing good rows', async () => {
  const f = fixture(); try {
    const db = f.app.store.db, original = db.prepare('SELECT epoch,present,source_version,account_id FROM archive_action_heads WHERE thread_id=?').get('bad')!;
    const cases: Record<string, any>[] = [{ epoch: 1n }, { epoch: 9007199254740991n }, { epoch: 9007199254740992n }, { epoch: 9223372036854775807n }, { epoch: -9223372036854775808n }, { epoch: 1.5 }, { epoch: '2' }, { epoch: 'invalid' }, { epoch: new Uint8Array([1]) }, { present: 9007199254740992n }, { present: 'invalid' }, { present: new Uint8Array([1]) }, { account_id: new Uint8Array([1]) }, { source_version: new Uint8Array([1]) }];
    for (const patch of cases) {
      for (const [field, value] of Object.entries(patch)) db.prepare('UPDATE archive_action_heads SET ' + field + '=? WHERE thread_id=?').run(value, 'bad');
      const expected: any = f.legacy(), actual: any = f.batch(); assert.deepEqual(actual, expected); assert(actual.threads.find((x: any) => x.id === 'good').archiveBasis); assert.equal(db.isTransaction, false);
      db.prepare('UPDATE archive_action_heads SET epoch=?,present=?,source_version=?,account_id=? WHERE thread_id=?').run(original.epoch, original.present, original.source_version, original.account_id, 'bad');
    }
  } finally { await f.close(); }
});
test('actual native prepared batch facade rechecks owner before execution and never restores a revoked connection to return bases', async () => {
  let armed = false, allowed = true, attempts = 0; const f = fixture((kind, sql) => { if (armed && kind === 'all' && sql.includes('LEFT JOIN archive_action_heads')) { attempts++; allowed = false; } if (!allowed) throw Error('synthetic_native_owner_revoked'); });
  try { assert(f.batch()); armed = true; assert.throws(() => f.batch(), /synthetic_native_owner_revoked/); assert.equal(attempts, 1); assert.equal(allowed, false); }
  finally { await f.close().catch(() => {}); f.app.store.close(); }
});
