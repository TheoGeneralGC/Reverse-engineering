import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { AutomationSettingsRepository } from '../src/automation-store.ts';

// Synthetic schema exercises storage mechanics without inventing original form
// fields/defaults. The observed concrete schema is integrated separately.
const parse = (value: unknown): { fixtureFlag: boolean } => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'fixtureFlag' || typeof (value as { fixtureFlag?: unknown }).fixtureFlag !== 'boolean') throw new Error('Invalid fixture schema');
  return { fixtureFlag: (value as { fixtureFlag: boolean }).fixtureFlag };
};
function fixture() {
  const store = new Store(':memory:', false);
  for (const [id, provider] of [['demo', 'demo'], ['google', 'google']] as const) store.put('account', id, { id, provider, email: id + '@example.test', name: 'Synthetic', color: '#000' });
  return { store, repo: new AutomationSettingsRepository(store, () => ({ fixtureFlag: false }), parse) };
}
test('configuration reads are account-scoped and do not activate jobs, create records or change mailbox data', () => {
  const { store, repo } = fixture();
  try {
    const before = store.db.prepare('SELECT * FROM records ORDER BY kind,id').all();
    assert.equal(repo.get('demo').revision, 0); assert.equal(repo.get('demo').processing, 'manual-demo-only');
    assert.equal(repo.get('google').processing, 'unavailable'); assert.equal(repo.get('google').providerEffects, false);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM automation_settings').get()!.n, 0);
    assert.deepEqual(store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(), before);
    assert.equal(store.list('draft').length, 0); assert.equal(store.list('delivery').length, 0);
  } finally { store.close(); }
});
test('revision/no-op saves preserve isolation and stale or invalid writes do not replace a newer configuration', () => {
  const { store, repo } = fixture();
  try {
    const changed = repo.save('demo', 0, { fixtureFlag: true }); assert.equal(changed.revision, 1);
    assert.equal(repo.save('demo', 1, { fixtureFlag: true }).revision, 1);
    assert.throws(() => repo.save('demo', 0, { fixtureFlag: false }), { code: 'automation_revision_conflict' });
    assert.throws(() => repo.save('demo', 1, { fixtureFlag: 'invalid' }));
    assert.equal(repo.get('demo').configuration.fixtureFlag, true);
    assert.equal(repo.get('google').configuration.fixtureFlag, false);
    assert.equal(repo.get('google').revision, 0);
    assert.throws(() => repo.save('missing', 0, { fixtureFlag: true }), { status: 404 });
  } finally { store.close(); }
});
test('a foreign corrupt configuration is never parsed while a failed commit leaves prior revision and data intact', () => {
  const { store, repo } = fixture();
  try {
    const one = repo.save('demo', 0, { fixtureFlag: true });
    store.db.prepare('INSERT INTO automation_settings VALUES(?,?,?)').run('google', 1, 'FOREIGN_NOT_JSON');
    assert.deepEqual(repo.get('demo'), one);
    assert.throws(() => repo.get('google'), { code: 'automation_settings_corrupt' });
    store.db.exec("CREATE TEMP TRIGGER deny_automation BEFORE UPDATE ON automation_settings BEGIN SELECT RAISE(ABORT,'controlled configuration failure');END");
    assert.throws(() => repo.save('demo', 1, { fixtureFlag: false }), /controlled configuration failure/);
    assert.deepEqual(repo.get('demo'), one);
  } finally { store.close(); }
});
