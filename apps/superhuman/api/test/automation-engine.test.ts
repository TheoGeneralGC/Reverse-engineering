import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { AutomationSettingsRepository, automationHash } from '../src/automation-store.ts';
import { AutomationFixtureEngine, type AutomationFixtureClassifier } from '../src/automation-engine.ts';
import type { Thread } from '../src/types.ts';
type Configuration = { fixtureFlag: boolean };
const parse = (value: unknown): Configuration => {
  if (!value || typeof value !== 'object' || typeof (value as Configuration).fixtureFlag !== 'boolean') throw Error('Invalid fixture configuration');
  return { fixtureFlag: (value as Configuration).fixtureFlag };
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(classify?: AutomationFixtureClassifier<Configuration>['classify']) {
  const store = new Store(':memory:', false); let calls = 0;
  for (const [id, provider] of [['demo', 'demo'], ['other', 'demo'], ['google', 'google']] as const) store.put('account', id, { id, provider, email: id + '@example.test', name: 'Synthetic ' + id, color: '#000' });
  for (const id of ['one', 'two', 'foreign']) {
    const accountId = id === 'foreign' ? 'other' : 'demo';
    const sender = { name: 'Synthetic sender', email: 'sender@example.test' };
    const thread: Thread = { id, accountId, subject: id === 'foreign' ? 'FOREIGN_BODY_SENTINEL' : 'Cedar synthetic ' + id, snippet: 'Controlled synthetic facts.', sender, participants: [sender], lastMessageAt: '2026-10-28T00:00:00.000Z', unread: true, starred: true, important: false, folder: 'inbox', labels: ['manual-label'], providerLabels: ['INBOX', 'UNRELATED'], messages: [{ id: 'message-' + id, sender, to: [], date: '2026-10-28T00:00:00.000Z', text: id === 'foreign' ? 'FOREIGN_BODY_SENTINEL' : 'Three synthetic samples.', attachments: [] }] };
    store.put('thread', id, thread);
  }
  for (const [id, accountId] of [['manual-label', 'demo'], ['fixture-label', 'demo'], ['foreign-label', 'other']]) store.put('label', id, { id, accountId, name: id });
  const settings = new AutomationSettingsRepository(store, () => ({ fixtureFlag: true }), parse);
  const classifier: AutomationFixtureClassifier<Configuration> = { provenance: { kind: 'synthetic-fixture', classifierId: 'controlled-fixture', classifierVersion: 'v1', fixtureSetHash: automationHash('synthetic-only') }, classify: async input => { calls++; return classify ? classify(input) : input.threads.map(thread => ({ threadId: thread.id, addLabelIds: ['fixture-label'], archive: input.configuration.fixtureFlag, classification: 'classified', reasons: ['Controlled fixture classification'] })); } };
  const engine = new AutomationFixtureEngine(store, settings, classifier);
  const request = (key = 'preview', threadIds = ['one']) => ({ accountId: 'demo', clientRequestId: key, expectedSettingsRevision: settings.get('demo').revision, threadIds });
  return { store, settings, classifier, engine, calls: () => calls, request, close: () => { engine.close(); store.close(); } };
}

test('manual preview has zero effects until explicit apply and old keys never overwrite later user edits', async () => {
  const f = fixture();
  try {
    const original = f.store.required<Thread>('thread', 'one');
    assert.equal(f.calls(), 0);
    const prepared = f.engine.prepare(f.request());
    assert.equal(prepared.preview.state, 'prepared'); assert.equal(f.calls(), 0);
    const preview = await f.engine.classify('demo', prepared.preview.id);
    assert.equal(preview.state, 'completed'); assert.equal(f.calls(), 1);
    assert.deepEqual(f.store.required('thread', 'one'), original);
    assert.equal(f.engine.prepare(f.request()).accepted, false);
    await f.engine.classify('demo', preview.id); assert.equal(f.calls(), 1);
    const input = { accountId: 'demo', clientRequestId: 'apply-once', expectedPreviewHash: preview.previewHash! }, first = f.engine.apply(preview.id, input);
    const applied = f.store.required<Thread>('thread', 'one');
    assert.equal(applied.folder, 'done'); assert.deepEqual(applied.labels, ['manual-label', 'fixture-label']);
    assert.deepEqual(applied.providerLabels, ['UNRELATED']); assert.deepEqual(applied.messages, original.messages);
    assert.equal(applied.unread, true); assert.equal(applied.starred, true);
    assert.equal(first.application.providerEffects, false);
    assert.equal(f.store.threadSummaries({ accountId: 'demo' }).counts.inbox, 1);
    const manuallyEdited = { ...applied, subject: 'Later user edit', labels: ['manual-label'], unread: false };
    f.store.put('thread', 'one', manuallyEdited);
    assert.deepEqual(f.engine.apply(preview.id, input), first);
    const alias = f.engine.apply(preview.id, { ...input, clientRequestId: 'second-explicit-key' });
    assert.equal(alias.application.id, first.application.id); assert.notEqual(alias.receipt.id, first.receipt.id);
    assert.equal(alias.receipt.clientRequestId, 'second-explicit-key');
    assert.deepEqual(f.store.required('thread', 'one'), manuallyEdited);
    assert.deepEqual(f.engine.applicationByRequest('demo', 'apply-once'), first);
    assert.equal(f.store.list('draft').length, 0); assert.equal(f.store.list('delivery').length, 0);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM automation_applications').get()!.n, 1);
  } finally { f.close(); }
});

test('thread/configuration changes fence late classification and reject a whole stale multi-thread apply before any effect', async () => {
  const held = deferred<Awaited<ReturnType<AutomationFixtureClassifier<Configuration>['classify']>>>();
  const f = fixture(() => held.promise);
  try {
    const prepared = f.engine.prepare(f.request()); const running = f.engine.classify('demo', prepared.preview.id);
    const edited = { ...f.store.required<Thread>('thread', 'one'), subject: 'User typing wins' }; f.store.put('thread', 'one', edited);
    held.resolve([{ threadId: 'one', addLabelIds: ['fixture-label'], archive: true, classification: 'classified', reasons: ['fixture'] }]);
    const failed = await running; assert.equal(failed.state, 'failed'); assert.equal(failed.error!.code, 'automation_preview_stale');
    assert.deepEqual(f.store.required('thread', 'one'), edited);
  } finally { f.close(); }
  const g = fixture();
  try {
    const p = g.engine.prepare(g.request('both', ['one', 'two'])); const preview = await g.engine.classify('demo', p.preview.id);
    const one = g.store.required('thread', 'one'), two = { ...g.store.required<Thread>('thread', 'two'), unread: false }; g.store.put('thread', 'two', two);
    assert.throws(() => g.engine.apply(preview.id, { accountId: 'demo', clientRequestId: 'stale', expectedPreviewHash: preview.previewHash! }), { code: 'automation_preview_stale' });
    assert.deepEqual(g.store.required('thread', 'one'), one); assert.deepEqual(g.store.required('thread', 'two'), two);
    const p2 = g.engine.prepare(g.request('settings')); const preview2 = await g.engine.classify('demo', p2.preview.id);
    g.settings.save('demo', 0, { fixtureFlag: false });
    assert.throws(() => g.engine.apply(preview2.id, { accountId: 'demo', clientRequestId: 'stale-settings', expectedPreviewHash: preview2.previewHash! }), { code: 'automation_preview_stale' });
    assert.equal(g.store.db.prepare('SELECT count(*) AS n FROM automation_applications').get()!.n, 0);
  } finally { g.close(); }
});

test('Google accounts and foreign threads are rejected before body parsing; foreign labels cannot become effects', async () => {
  const f = fixture(), parseJson = JSON.parse; let foreign = 0;
  try {
    JSON.parse = ((text: string, ...rest: any[]) => { if (text.includes('FOREIGN_BODY_SENTINEL')) { foreign++; throw Error('Foreign body parsed'); } return (parseJson as any)(text, ...rest); }) as typeof JSON.parse;
    assert.throws(() => f.engine.prepare({ ...f.request(), accountId: 'google' }), { code: 'automation_demo_only' });
    assert.throws(() => f.engine.prepare(f.request('foreign', ['foreign'])), { status: 404 });
    assert.equal(foreign, 0); assert.equal(f.calls(), 0);
  } finally { JSON.parse = parseJson; f.close(); }
  const g = fixture(async input => input.threads.map(thread => ({ threadId: thread.id, addLabelIds: ['foreign-label'], archive: true, classification: 'classified', reasons: [] })));
  try {
    const p = g.engine.prepare(g.request()); assert.equal((await g.engine.classify('demo', p.preview.id)).state, 'failed');
    assert.equal(g.store.required<Thread>('thread', 'one').folder, 'inbox');
  } finally { g.close(); }
});

test('apply receipt failure rolls all thread/projection changes back, while request namespaces and artifact hashes fail closed', async () => {
  const f = fixture();
  try {
    const p = f.engine.prepare(f.request('preview', ['one', 'two'])), preview = await f.engine.classify('demo', p.preview.id);
    const before = f.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all();
    f.store.db.exec("CREATE TEMP TRIGGER deny_apply_receipt BEFORE INSERT ON automation_requests WHEN NEW.kind='apply' BEGIN SELECT RAISE(ABORT,'controlled apply receipt failure');END");
    assert.throws(() => f.engine.apply(preview.id, { accountId: 'demo', clientRequestId: 'apply', expectedPreviewHash: preview.previewHash! }), /controlled apply receipt failure/);
    assert.deepEqual(f.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all(), before);
    assert.equal(f.store.threadSummaries({ accountId: 'demo' }).counts.inbox, 2);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM automation_applications').get()!.n, 0);
    assert.throws(() => f.engine.applicationByRequest('demo', 'apply'), { status: 404 });
    f.store.db.exec('DROP TRIGGER deny_apply_receipt');
    assert.throws(() => f.engine.apply(preview.id, { accountId: 'demo', clientRequestId: 'preview', expectedPreviewHash: preview.previewHash! }), { code: 'automation_request_conflict' });
    const corrupted = structuredClone(preview); corrupted.effects[0].archive = false;
    f.store.db.prepare('UPDATE automation_previews SET data=? WHERE id=?').run(JSON.stringify(corrupted), preview.id);
    assert.throws(() => f.engine.apply(preview.id, { accountId: 'demo', clientRequestId: 'corrupt', expectedPreviewHash: preview.previewHash! }), { code: 'automation_artifact_corrupt' });
    assert.deepEqual(f.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all(), before);
  } finally { f.close(); }
});

test('another live owner cannot classify the first preview; shutdown/dead-owner recovery fences late results without startup work', async () => {
  const held = deferred<Awaited<ReturnType<AutomationFixtureClassifier<Configuration>['classify']>>>(), f = fixture(() => held.promise);
  let second: AutomationFixtureEngine<Configuration> | undefined, third: AutomationFixtureEngine<Configuration> | undefined;
  try {
    const p = f.engine.prepare(f.request()), running = f.engine.classify('demo', p.preview.id);
    second = new AutomationFixtureEngine(f.store, f.settings, f.classifier);
    assert.equal((await second.classify('demo', p.preview.id)).state, 'classifying'); assert.equal(f.calls(), 1);
    second.close(); second = undefined;
    third = new AutomationFixtureEngine(f.store, f.settings, f.classifier, Date.now, () => false);
    assert.equal(third.get('demo', p.preview.id).state, 'interrupted'); assert.equal(f.calls(), 1);
    held.resolve([{ threadId: 'one', addLabelIds: ['fixture-label'], archive: true, classification: 'classified', reasons: [] }]);
    assert.equal((await running).state, 'interrupted'); assert.equal(f.store.required<Thread>('thread', 'one').folder, 'inbox');
    const fresh = third.prepare(f.request('fresh')); third.close();
    assert.equal(third.get('demo', fresh.preview.id).state, 'interrupted');
    assert.throws(() => third!.prepare(f.request('after-close')), { code: 'automation_stopping' });
  } finally { if (second) second.close(); if (third) third.close(); f.close(); }
});
