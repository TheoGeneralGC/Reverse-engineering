import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { AutomationService } from '../src/automation.ts';
import { automationHash } from '../src/automation-store.ts';
import { automationLabelId, parseAutomationConfiguration } from '../src/automation-config.ts';
import { createAutomationFixtureClassifier } from '../src/automation-fixtures.ts';
import { automationDemoFixture } from './automation-fixture-data.ts';
import type { AutomationConfiguration, AutomationPreview } from '../src/automation-types.ts';
import type { Thread } from '../src/types.ts';

function fixture() {
  const store = new Store(':memory:', false), data = automationDemoFixture();
  data.seed(store); let calls = 0;
  const service = new AutomationService(store, { fixture: { provenance: data.classifier.provenance, classify: async input => { calls++; return data.classifier.classify(input); } } });
  service.save(data.account.id, { expectedRevision: 0, configuration: data.configuration });
  return { store, service, data, calls: () => calls, close: () => { service.close(); store.close(); } };
}
function rows(f: ReturnType<typeof fixture>) { return f.store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all().map(row => ({ ...row })); }
async function completed(f: ReturnType<typeof fixture>, key = 'preview-owned', ids = ['automation-marketing']) {
  const prepared = f.service.engine.prepare({ accountId: f.data.account.id, clientRequestId: key, expectedSettingsRevision: 1, threadIds: ids });
  const preview = await f.service.engine.classify(f.data.account.id, prepared.preview.id);
  assert.equal(preview.state, 'completed'); return preview;
}
function apply(f: ReturnType<typeof fixture>, preview: AutomationPreview, key = 'apply-owned') {
  return f.service.apply(preview.id, { accountId: f.data.account.id, clientRequestId: key, expectedPreviewHash: preview.previewHash! });
}

test('persisted application effect scope and provider flags fail closed on both recovery and new-key replay', async () => {
  const f = fixture();
  try {
    const preview = await completed(f), accepted = apply(f, preview), original = JSON.stringify(accepted.application), after = rows(f);
    for (const mutation of [{ providerEffects: true }, { effectScope: 'provider' }, { accountId: 'foreign' }, { appliedAt: 'not-a-time' }]) {
      f.store.db.prepare('UPDATE automation_applications SET data=? WHERE id=?').run(JSON.stringify({ ...accepted.application, ...mutation }), accepted.application.id);
      assert.throws(() => f.service.engine.applicationByRequest(f.data.account.id, 'apply-owned'), { code: 'automation_artifact_corrupt' });
      assert.throws(() => apply(f, preview, 'new-key'), { code: 'automation_artifact_corrupt' });
      assert.deepEqual(rows(f), after); assert.equal(f.calls(), 1);
      f.store.db.prepare('UPDATE automation_applications SET data=? WHERE id=?').run(original, accepted.application.id);
    }
  } finally { f.close(); }
});

test('a truncated persisted application cannot acknowledge an empty effect set for a nonempty preview', async () => {
  const f = fixture();
  try {
    const preview = await completed(f), accepted = apply(f, preview), after = rows(f);
    f.store.db.prepare('UPDATE automation_applications SET data=? WHERE id=?').run(JSON.stringify({ ...accepted.application, threads: [] }), accepted.application.id);
    assert.throws(() => f.service.engine.applicationByRequest(f.data.account.id, 'apply-owned'), { code: 'automation_artifact_corrupt' });
    assert.throws(() => apply(f, preview, 'new-key'), { code: 'automation_artifact_corrupt' });
    assert.deepEqual(rows(f), after); assert.equal(f.calls(), 1);
  } finally { f.close(); }
});

test('historical application rows remain bound to their exact preview thread set and proposed effect subsets', async () => {
  const f = fixture();
  try {
    const preview = await completed(f, 'effect-preview', ['automation-cedar']), accepted = apply(f, preview);
    const original = JSON.stringify(accepted.application), thread = accepted.application.threads[0], after = rows(f);
    assert.equal(preview.effects[0].archive, false);
    for (const mutation of [
      { threads: [{ ...thread, threadId: 'different-owned-thread' }] },
      { threads: [{ ...thread, beforeHash: '0'.repeat(64) }] },
      { threads: [{ ...thread, addedLabelIds: ['automation-manual'] }] },
      { threads: [{ ...thread, archived: true }] },
      { settingsRevision: accepted.application.settingsRevision + 1 },
    ]) {
      f.store.db.prepare('UPDATE automation_applications SET data=? WHERE id=?').run(JSON.stringify({ ...accepted.application, ...mutation }), accepted.application.id);
      assert.throws(() => f.service.engine.applicationByRequest(f.data.account.id, 'apply-owned'), { code: 'automation_artifact_corrupt' });
      assert.throws(() => apply(f, preview, 'new-effect-key'), { code: 'automation_artifact_corrupt' });
      assert.deepEqual(rows(f), after);
      assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM automation_requests WHERE client_key='new-effect-key'").get()!.n, 0);
      f.store.db.prepare('UPDATE automation_applications SET data=? WHERE id=?').run(original, accepted.application.id);
    }
  } finally { f.close(); }
});

test('a later projection failure rolls back the entire selected batch, receipt and application', async () => {
  const f = fixture();
  try {
    const preview = await completed(f, 'batch', ['automation-both', 'automation-cedar', 'automation-marketing']), before = rows(f);
    const summaries = f.store.db.prepare('SELECT * FROM thread_summaries ORDER BY id').all().map(row => ({ ...row }));
    f.store.db.exec("CREATE TRIGGER independent_late_failure BEFORE UPDATE ON records WHEN NEW.kind='thread' AND NEW.id='automation-cedar' BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END");
    assert.throws(() => apply(f, preview), /synthetic projection failure/);
    assert.deepEqual(rows(f), before);
    assert.deepEqual(f.store.db.prepare('SELECT * FROM thread_summaries ORDER BY id').all().map(row => ({ ...row })), summaries);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM automation_applications').get()!.n, 0);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM automation_requests WHERE kind='apply'").get()!.n, 0);
  } finally { f.close(); }
});

test('one stale proposed label fences all thread effects before the first batch write', async () => {
  const f = fixture();
  try {
    const preview = await completed(f, 'batch-label', ['automation-marketing', 'automation-cedar']);
    const id = automationLabelId(f.data.account.id, f.data.configuration.labels[1].id);
    f.store.put('label', id, { ...f.store.required<any>('label', id), name: 'Later manual name' });
    const before = rows(f);
    assert.throws(() => apply(f, preview), { code: 'automation_preview_stale' });
    assert.deepEqual(rows(f), before);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM automation_applications').get()!.n, 0);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM automation_requests WHERE kind='apply'").get()!.n, 0);
  } finally { f.close(); }
});

test('foreign thread bodies are excluded before parsing and consume no preview key', () => {
  const f = fixture();
  try {
    f.store.put('account', 'foreign', { ...f.data.account, id: 'foreign' });
    const foreign: Thread = { ...structuredClone(f.data.threads[0]), id: 'foreign-thread', accountId: 'foreign' };
    f.store.put('thread', foreign.id, foreign);
    const foreignBody = String(f.store.db.prepare("SELECT data FROM records WHERE kind='thread' AND id=?").get(foreign.id)!.data);
    const originalParse = JSON.parse;
    JSON.parse = ((text: string, ...rest: any[]) => { if (text === foreignBody) throw Error('Foreign body was parsed'); return originalParse(text, ...rest); }) as typeof JSON.parse;
    try { assert.throws(() => f.service.engine.prepare({ accountId: f.data.account.id, clientRequestId: 'foreign-read', expectedSettingsRevision: 1, threadIds: [foreign.id] }), { code: 'automation_not_found' }); }
    finally { JSON.parse = originalParse; }
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM automation_requests WHERE client_key='foreign-read'").get()!.n, 0);
    assert.equal(f.calls(), 0);
  } finally { f.close(); }
});

test('preview/apply keys conflict across intents; a fresh replay key never overwrites later manual state', async () => {
  const f = fixture();
  try {
    const preview = await completed(f, 'one-key');
    assert.throws(() => apply(f, preview, 'one-key'), { code: 'automation_request_conflict' });
    const accepted = apply(f, preview, 'accepted');
    const current = f.store.required<Thread>('thread', 'automation-marketing');
    const manual = { ...current, folder: 'inbox' as const, labels: ['automation-manual'], subject: 'Later manual edit' };
    f.store.put('thread', current.id, manual);
    const replay = apply(f, preview, 'fresh-recovery-key');
    assert.deepEqual(replay.application, accepted.application); assert.notEqual(replay.receipt.id, accepted.receipt.id);
    assert.deepEqual(f.store.required('thread', manual.id), manual);
    assert.throws(() => f.service.engine.prepare({ accountId: f.data.account.id, clientRequestId: 'accepted', expectedSettingsRevision: 1, threadIds: [manual.id] }), { code: 'automation_request_conflict' });
    assert.equal(f.calls(), 1);
  } finally { f.close(); }
});

test('a persisted preview key mapping cannot retarget another owned preview with a different original key', async () => {
  const f = fixture();
  try {
    const original = await completed(f, 'original-preview-key'), different = await completed(f, 'different-preview-key');
    assert.notEqual(original.id, different.id); const before = rows(f);
    f.store.db.prepare("UPDATE automation_requests SET entity_id=? WHERE account_id=? AND client_key=?").run(different.id, f.data.account.id, 'original-preview-key');
    assert.throws(() => f.service.engine.byRequest(f.data.account.id, 'original-preview-key'), { code: 'automation_artifact_corrupt' });
    assert.throws(() => f.service.engine.prepare({ accountId: f.data.account.id, clientRequestId: 'original-preview-key', expectedSettingsRevision: 1, threadIds: ['automation-marketing'] }), { code: 'automation_artifact_corrupt' });
    assert.deepEqual(rows(f), before); assert.equal(f.calls(), 2);
  } finally { f.close(); }
});

test('nested item connectors remain distinct from prompt/group connectors under the documented local policy', async () => {
  const data = automationDemoFixture(), thread = data.threads[2], id = 'nested-owned';
  const classifier = createAutomationFixtureClassifier({ accountId: data.account.id, fixtureId: 'independent-nested', version: 'v1', threadHashes: { [thread.id]: automationHash(thread) }, builtinMatches: { [thread.id]: [] }, promptMatches: { [thread.id]: { [id]: true } }, historyComplete: true, emailedBefore: [] });
  const raw: AutomationConfiguration = { labels: [{ id, name: 'Nested', prompt: 'Exact\nfixture prompt', groups: [
    { operator: 'and', queryOperator: 'or', items: [{ type: 'subject', value: ' Cedar ' }, { type: 'from', value: 'other.example.test' }] },
    { operator: 'exclude', queryOperator: 'and', items: [{ type: 'subject', value: 'announcement' }, { type: 'from', value: 'other.example.test' }] },
  ] }], archive: { labelIds: [id], always: [], never: [] } };
  const configuration = parseAutomationConfiguration(raw);
  assert.equal(configuration.labels[0].prompt, raw.labels[0].prompt);
  assert.deepEqual(configuration.labels[0].groups.map(g => [g.operator, g.queryOperator]), [['and', 'or'], ['exclude', 'and']]);
  const input = { accountId: data.account.id, threads: [thread], configuration };
  assert.equal((await classifier.classify(input))[0].archive, true);
  const stricter = structuredClone(configuration); stricter.labels[0].groups[0].queryOperator = 'and';
  assert.equal((await classifier.classify({ ...input, configuration: stricter }))[0].archive, false);
  const excluding = structuredClone(configuration); excluding.labels[0].groups[1].queryOperator = 'or';
  assert.equal((await classifier.classify({ ...input, configuration: excluding }))[0].archive, false);
});
