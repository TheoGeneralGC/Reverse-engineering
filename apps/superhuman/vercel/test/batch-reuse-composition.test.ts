import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import Libsql from 'libsql';
import { adaptLibsqlDatabase, withRemoteSavepoints, type SqlOperationGuard } from '../src/sql.ts';
import { withTransactionSelectReuse } from '../src/statement-reuse.ts';
import { Store } from '../../api/src/store.ts';
import { initializeAiMailIndex, refreshAiMailIndex } from '../../api/src/ai-retrieval.ts';
import { AccountIncarnationAuthority } from '../../api/src/account-incarnation.ts';
import { GoogleIngressAdapter } from '../../api/src/google-ingress.ts';
import type { Account, Thread, Message, Person } from '../../api/src/types.ts';

const denial = (globalThis as typeof globalThis & { [key: symbol]: { attempts: number } })[Symbol.for('rea.generated-cloud.network-denied')];
after(() => { assert.equal(denial.attempts, 0); });
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const snapshot = (store: Store) => Object.fromEntries(store.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => {
  const name = String(row.name), without = /WITHOUT\s+ROWID/i.test(String(row.sql));
  const order = without ? store.db.prepare('PRAGMA table_info(' + quote(name) + ')').all().filter(c => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(c => quote(String(c.name))).join(',') : 'rowid';
  return [name, store.db.prepare('SELECT ' + (without ? '*' : 'rowid AS __rowid,*') + ' FROM ' + quote(name) + ' ORDER BY ' + order).all()];
}));
const person = (n: number): Person => ({ email: 'person' + n + '@example.test', name: 'Fictional person ' + n });
const message = (id: string, people: Person[]): Message => ({ id, date: '2026-10-28T12:00:00Z', sender: people[0]!, to: people.slice(1), cc: [people[1]!], text: 'compositionfixture body', attachments: [] });
const thread = (people: Person[]): Thread => ({ id: 'owned', accountId: 'a', subject: 'Fictional compositionfixture', snippet: 'compositionfixture', sender: people[0]!, participants: people,
  lastMessageAt: '2026-10-28T12:00:00Z', unread: true, starred: false, important: false, folder: 'inbox', labels: [], messages: [message('one', people), message('two', people)] });
function setup(guard?: SqlOperationGuard) {
  const native = new Libsql(':memory:');
  const observed: SqlOperationGuard = operation => guard?.(operation);
  const store = new Store(':memory:', false, { databaseFactory(path) {
    assert.equal(path, ':memory:'); return withRemoteSavepoints(withTransactionSelectReuse(adaptLibsqlDatabase(native, observed), observed));
  } });
  return store;
}

for (const target of ['recipient_occurrences', 'split_header_people']) test('combined cache and ' + target + ' batching retain complete source/projection/FTS rollback at root and nested boundaries', () => {
  let armed = false, runs = 0;
  const failure = new Error('Controlled later batch rejection');
  const store = setup(operation => { if (armed && operation.kind === 'run' && operation.sql.startsWith('INSERT INTO ' + target) && ++runs === 2) throw failure; });
  try {
    initializeAiMailIndex(store.db); store.put('thread', 'owned', thread([person(0), person(1)])); refreshAiMailIndex(store);
    for (const nested of [false, true]) {
      const before = snapshot(store); if (nested) store.db.exec('BEGIN IMMEDIATE');
      // The real Store read uses the same active native metadata cache before
      // its own unit/batched mutation creates conservative barriers.
      if (nested) { assert(store.get('thread', 'owned')); assert(store.get('thread', 'owned')); }
      armed = true; runs = 0;
      assert.throws(() => store.put('thread', 'owned', thread(Array.from({ length: 150 }, (_, n) => person(n)))), error => error === failure);
      armed = false; assert.equal(runs, 2); assert.equal(store.db.isTransaction, nested); assert.deepEqual(snapshot(store), before);
      if (nested) store.db.exec('ROLLBACK'); assert.deepEqual(snapshot(store), before);
    }
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { store.close(); }
});

test('combined batched publication still executes fresh readiness/incarnation/ingress reads after ordinary writes and account ABA', () => {
  const store = setup(), authority = new AccountIncarnationAuthority(store), clock = 1793390000000;
  const account = { id: 'a', provider: 'google', email: 'fictional@example.test', name: 'Fictional' } as Account;
  store.put('account', account.id, account);
  const ingress = new GoogleIngressAdapter(store, { accountVersion: a => authority.version(a.id), now: () => clock });
  try {
    store.put('sync', 'a', { phase: 'history', partial: false, historyId: '100' });
    const first = ingress.begin('a'); ingress.finish(first, true); assert.equal(ingress.readiness('a').ready, true);
    store.db.exec('BEGIN IMMEDIATE');
    const readySql = 'SELECT * FROM auto_draft_ready_accounts WHERE account_id=?', metaSql = 'SELECT * FROM google_ingress_meta WHERE account_id=?';
    const heldReady = store.db.prepare(readySql), heldMeta = store.db.prepare(metaSql);
    assert.equal(heldReady.get('a')!.present, 1); assert.equal(heldMeta.get('a')!.complete, 1);
    store.put('thread', 'owned', thread(Array.from({ length: 150 }, (_, n) => person(n))));
    const version = authority.version('a'); assert.equal(ingress.readiness('a').ready, true);
    store.db.prepare('UPDATE auto_draft_ready_accounts SET present=0 WHERE account_id=?').run('a');
    assert.equal(heldReady.get('a')!.present, 0); assert.throws(() => authority.version('a'), { code: 'reminder_not_found' });
    store.db.prepare('UPDATE auto_draft_ready_accounts SET present=1 WHERE account_id=?').run('a');
    store.db.prepare('UPDATE google_ingress_meta SET anchored=0,complete=0 WHERE account_id=?').run('a');
    assert.equal(heldMeta.get('a')!.complete, 0); assert.equal(ingress.readiness('a').ready, false);
    const active = ingress.begin('a'); store.remove('account', 'a'); store.put('account', 'a', account);
    assert.notEqual(authority.version('a'), version); assert.throws(() => ingress.assert(active), { code: 'google_ingress_stale' });
    store.db.exec('ROLLBACK'); assert.equal(authority.version('a'), version); assert.equal(ingress.readiness('a').ready, true);
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { ingress.close(); store.close(); }
});
