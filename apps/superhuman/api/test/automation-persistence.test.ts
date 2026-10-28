import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import { automationDemoFixture } from './automation-fixture-data.ts';
import type { Thread } from '../src/types.ts';

const offlineFetch = (async () => { throw new Error('No provider/model calls permitted'); }) as typeof fetch;

test('explicit fixed fixture seed, settings and historical apply recover from a temp database without startup processing or reapply', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'automation-persistence-')), databasePath = join(directory, 'synthetic.sqlite');
  const fixture = automationDemoFixture(); let calls = 0;
  const options = { databasePath, env: { DATABASE_PATH: databasePath }, seed: false, runJobs: false, aiFetch: offlineFetch, automationFixture: { provenance: fixture.classifier.provenance, classify: async (input: Parameters<typeof fixture.classifier.classify>[0]) => { calls++; return fixture.classifier.classify(input); } } };
  let app = createApp(options);
  try {
    fixture.seed(app.store);
    assert.throws(() => fixture.seed(app.store), /empty synthetic Store/);
    assert.equal(app.store.preferences().activeAccountId, fixture.account.id);
    const saved = app.automation.save(fixture.account.id, { expectedRevision: 0, configuration: fixture.configuration });
    const { preview } = app.automation.preview({ accountId: fixture.account.id, clientRequestId: 'persist-preview', expectedSettingsRevision: saved.settings.revision, threadIds: fixture.threads.map(thread => thread.id) });
    await new Promise<void>(resolve => setImmediate(resolve));
    const completed = app.automation.engine.get(fixture.account.id, preview.id);
    assert.equal(completed.state, 'completed'); assert.equal(calls, 1);
    const request = { accountId: fixture.account.id, clientRequestId: 'persist-apply', expectedPreviewHash: completed.previewHash! };
    const result = app.automation.apply(preview.id, request);
    const manual = { ...app.store.required<Thread>('thread', 'automation-marketing'), unread: false, subject: 'Later synthetic manual edit' };
    app.store.put('thread', manual.id, manual);
    await app.close(); app = createApp(options);
    assert.equal(calls, 1); assert.equal(app.automation.response(fixture.account.id).settings.revision, 1);
    assert.deepEqual(app.automation.engine.byRequest(fixture.account.id, 'persist-preview'), completed);
    assert.deepEqual(app.automation.engine.applicationByRequest(fixture.account.id, 'persist-apply'), result);
    assert.deepEqual(app.automation.apply(preview.id, request), result);
    assert.deepEqual(app.store.required('thread', manual.id), manual);
    assert.equal(calls, 1); assert.equal(app.store.list('draft').length, 0); assert.equal(app.store.list('delivery').length, 0);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('closing a deferred manual fixture interrupts its durable preview and late completion never uses the closed Store', async () => {
  const fixture = automationDemoFixture(); let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, aiFetch: offlineFetch,
    automationFixture: { provenance: fixture.classifier.provenance, classify: async input => { await deferred; return fixture.classifier.classify(input); } } });
  fixture.seed(app.store); app.automation.save(fixture.account.id, { expectedRevision: 0, configuration: fixture.configuration });
  const result = app.automation.engine.prepare({ accountId: fixture.account.id, clientRequestId: 'close-preview', expectedSettingsRevision: 1, threadIds: ['automation-marketing'] });
  const running = app.automation.engine.classify(fixture.account.id, result.preview.id);
  assert.equal(app.automation.engine.get(fixture.account.id, result.preview.id).state, 'classifying');
  app.automation.close();
  assert.equal(app.automation.engine.get(fixture.account.id, result.preview.id).state, 'interrupted');
  assert.equal(app.store.required<Thread>('thread', 'automation-marketing').folder, 'inbox');
  await app.close(); release();
  assert.equal((await running).state, 'interrupted');
});
