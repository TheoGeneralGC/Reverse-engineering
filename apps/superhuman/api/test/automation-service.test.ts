import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../src/server.ts';
import { automationHash } from '../src/automation-store.ts';
import { automationLabelId, emptyAutomationConfiguration, normalizeAutomationSelector, parseAutomationConfiguration } from '../src/automation-config.ts';
import { createAutomationFixtureClassifier } from '../src/automation-fixtures.ts';
import type { AutomationConfiguration, AutomationCustomLabel, AutomationBuiltinId } from '../src/automation-types.ts';
import type { Thread } from '../src/types.ts';

const builtin = { id: 'builtin-marketing', name: 'Marketing', prompt: '', groups: [] };
const custom: AutomationCustomLabel = { id: 'cedar-review', name: 'Cedar review', prompt: '', groups: [{ operator: 'or', queryOperator: 'or', items: [{ type: 'subject', value: 'Cedar' }] }] };
const configuration = (): AutomationConfiguration => ({ labels: [structuredClone(builtin), structuredClone(custom)], archive: { labelIds: ['builtin-marketing'], always: [], never: ['protected@safe.test'] } });
function threads(): Thread[] {
  return [
    ['marketing', 'news@vendor.test', 'Weekly announcement'], ['cedar', 'partner@company.test', 'Cedar update'],
    ['both', 'news@vendor.test', 'Cedar announcement'], ['protected', 'protected@safe.test', 'Protected announcement'],
  ].map(([id, email, subject]) => { const sender = { email, name: 'Synthetic sender' }; return { id, accountId: 'demo', subject, sender, participants: [sender], snippet: 'Synthetic only.', lastMessageAt: '2026-10-28T00:00:00.000Z', unread: true, starred: false, important: false, folder: 'inbox', labels: ['manual-label'], providerLabels: ['INBOX', 'UNRELATED'], messages: [{ id: 'message-' + id, sender, to: [{ email: 'self@demo.test', name: 'Synthetic self' }], date: '2026-10-28T00:00:00.000Z', text: 'Three fictional samples.', attachments: [] }] }; });
}
function fixture() {
  const data = threads(); let calls = 0;
  const implementation = createAutomationFixtureClassifier({ accountId: 'demo', fixtureId: 'controlled-automation', version: 'v1', threadHashes: Object.fromEntries(data.map(thread => [thread.id, automationHash(thread)])),
    builtinMatches: Object.fromEntries(data.map(thread => [thread.id, thread.id === 'cedar' ? [] : ['builtin-marketing']])) as Record<string, AutomationBuiltinId[]>, promptMatches: {}, historyComplete: true, emailedBefore: [] });
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false,
    automationFixture: { provenance: implementation.provenance, classify: async input => { calls++; return implementation.classify(input); } },
    aiFetch: (async () => { throw Error('No model or provider calls allowed'); }) as typeof fetch });
  for (const [id, provider] of [['demo', 'demo'], ['google', 'google']] as const) app.store.put('account', id, { id, provider, email: id + '@example.test', name: 'Synthetic', color: '#000' });
  app.store.put('label', 'manual-label', { id: 'manual-label', accountId: 'demo', name: 'Existing manual label' });
  for (const thread of data) app.store.put('thread', thread.id, thread);
  return { app, data, calls: () => calls };
}
async function invoke(app: ReturnType<typeof createApp>, method: string, url: string, value?: unknown): Promise<{ status: number; body: any }> {
  const bytes = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
  return new Promise(resolve => {
    const request = Object.assign(Readable.from(bytes.length ? [bytes] : []), { method, url, headers: { host: '127.0.0.1:3001', 'content-type': 'application/json' } });
    const response = { status: 0, setHeader() {}, writeHead(status: number) { this.status = status; }, end(payload: string | Buffer) { resolve({ status: this.status, body: JSON.parse(String(payload)) }); } };
    app.server.emit('request', request, response);
  });
}

test('native configuration normalization preserves groups/prompt and rejects malformed fragments, duplicate names and unconfigured archive targets', () => {
  const cfg = configuration(); cfg.labels[1].name = '  Cedar review  '; cfg.labels[1].prompt = 'Exact\nUnicode 样本';
  cfg.labels[1].groups[0] = { operator: 'and', queryOperator: 'and', items: [{ type: 'from', value: 'USER@BÜCHER。COM' }, { type: 'subject', value: ' Cedar ' }] };
  cfg.labels[1].groups.push({ operator: 'exclude', queryOperator: 'or', items: [{ type: 'to', value: 'OTHER@EXAMPLE.TEST' }] });
  cfg.archive.always = ['12.34', ' A@Example.COM ', 'a@example.com']; cfg.archive.labelIds = ['builtin-marketing', 'builtin-marketing'];
  const parsed = parseAutomationConfiguration(cfg);
  assert.equal(parsed.labels[1].name, 'Cedar review'); assert.equal(parsed.labels[1].prompt, cfg.labels[1].prompt);
  assert.equal(parsed.labels[1].groups[0].operator, 'and'); assert.equal(parsed.labels[1].groups[0].queryOperator, 'and');
  assert.equal(parsed.labels[1].groups[0].items[0].value, 'user@xn--bcher-kva.com'); assert.equal(parsed.labels[1].groups[0].items[1].value, 'Cedar');
  assert.deepEqual(parsed.archive.always, ['12.34', 'a@example.com']); assert.deepEqual(parsed.archive.labelIds, ['builtin-marketing']);
  for (const raw of ['Jordan', 'unfinished <good@example.test>', 'example.test/path', 'a@example.test\n']) assert.throws(() => normalizeAutomationSelector(raw), { code: 'automation_invalid_request' });
  assert.equal(normalizeAutomationSelector('01.2.3.4'), '01.2.3.4');
  const duplicate = configuration(); duplicate.labels.push({ ...structuredClone(custom), id: 'different-id', name: ' CEDAR REVIEW ' }); assert.throws(() => parseAutomationConfiguration(duplicate), { code: 'automation_invalid_request' });
  const badType: any = configuration(); badType.labels[1].groups[0].items[0].type = ['subject']; assert.throws(() => parseAutomationConfiguration(badType), { code: 'automation_invalid_request' });
  const prompt = configuration(); prompt.labels[1].prompt = 'a'.repeat(1001); assert.throws(() => parseAutomationConfiguration(prompt), { code: 'automation_invalid_request' });
  assert.throws(() => parseAutomationConfiguration({ labels: [], archive: { labelIds: ['builtin-marketing'], always: [], never: [] } }), { code: 'automation_invalid_request' });
  assert.deepEqual(emptyAutomationConfiguration(), { labels: [], archive: { labelIds: [], always: [], never: [] } });
});

test('local predicate policy preserves prompt/group operators, exclusions and unknown fixture evidence', async () => {
  const [source] = threads();
  const label: AutomationCustomLabel = { id: 'controlled-prompt', name: 'Controlled prompt', prompt: 'An explicitly annotated fictional prompt.', groups: [
    { operator: 'and', queryOperator: 'and', items: [{ type: 'from', value: 'vendor.test' }, { type: 'subject', value: 'weekly' }] },
    { operator: 'exclude', queryOperator: 'or', items: [{ type: 'to', value: 'excluded@demo.test' }] },
  ] };
  const evidence = { accountId: 'demo', fixtureId: 'predicate-fixture', version: 'v1', threadHashes: { [source.id]: automationHash(source) }, builtinMatches: { [source.id]: [] }, promptMatches: { [source.id]: { [label.id]: true } }, historyComplete: true, emailedBefore: [] };
  const classifier = createAutomationFixtureClassifier(evidence), cfg = { labels: [label], archive: { labelIds: [label.id], always: [], never: [] } };
  const [matched] = await classifier.classify({ accountId: 'demo', configuration: cfg, threads: [source] });
  assert.equal(matched.archive, true); assert.deepEqual(matched.addLabelIds, [automationLabelId('demo', label.id)]);
  const excluded = structuredClone(cfg); excluded.labels[0].groups[1].items[0].value = 'self@demo.test';
  assert.equal((await classifier.classify({ accountId: 'demo', configuration: excluded, threads: [source] }))[0].archive, false);
  const unknown = createAutomationFixtureClassifier({ ...evidence, promptMatches: {} });
  assert.equal((await unknown.classify({ accountId: 'demo', configuration: cfg, threads: [source] }))[0].classification, 'unclassified');
  const domainHistory = createAutomationFixtureClassifier({ ...evidence, emailedBefore: ['another@vendor.test'] });
  assert.equal((await domainHistory.classify({ accountId: 'demo', configuration: cfg, threads: [source] }))[0].archive, false);
  const changed = { ...source, subject: 'Later user edit' };
  assert.equal((await classifier.classify({ accountId: 'demo', configuration: cfg, threads: [changed] }))[0].classification, 'unclassified');
});

test('configuration save is local and revisioned; opening or saving never classifies or modifies a Google mailbox', async () => {
  const f = fixture();
  try {
    const before = f.app.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all();
    const initial = await invoke(f.app, 'GET', '/api/automation/settings?accountId=demo');
    assert.equal(initial.status, 200); assert.equal(initial.body.settings.revision, 0); assert.equal(initial.body.templates.length, 16);
    assert.equal(initial.body.capabilities.automaticProcessing, false); assert.equal(initial.body.capabilities.providerEffects, false);
    assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM automation_settings').get()!.n, 0);
    const saved = await invoke(f.app, 'PATCH', '/api/automation/settings?accountId=demo', { expectedRevision: 0, configuration: configuration() });
    assert.equal(saved.status, 200); assert.equal(saved.body.settings.revision, 1);
    assert.ok(saved.body.labels.find((label: any) => label.id === 'cedar-review').mailLabelAvailable);
    assert.equal((await invoke(f.app, 'PATCH', '/api/automation/settings?accountId=demo', { expectedRevision: 1, configuration: configuration() })).body.settings.revision, 1);
    assert.equal((await invoke(f.app, 'PATCH', '/api/automation/settings?accountId=demo', { expectedRevision: 0, configuration: configuration() })).status, 409);
    const google = await invoke(f.app, 'PATCH', '/api/automation/settings?accountId=google', { expectedRevision: 0, configuration: configuration() });
    assert.equal(google.status, 200); assert.equal(google.body.capabilities.preview, false); assert.equal(google.body.capabilities.apply, false);
    assert.equal(google.body.settings.processing, 'unavailable');
    assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='label' AND json_extract(data,'$.accountId')='google'").get()!.n, 0);
    assert.equal(f.calls(), 0); assert.deepEqual(f.app.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all(), before);
    assert.equal(f.app.store.list('draft').length, 0); assert.equal(f.app.store.list('delivery').length, 0);
  } finally { await f.app.close(); }
});

test('HTTP fixture preview and explicit apply produce real scoped label/archive effects with preserved unrelated state and durable key recovery', async () => {
  const f = fixture();
  try {
    await invoke(f.app, 'PATCH', '/api/automation/settings?accountId=demo', { expectedRevision: 0, configuration: configuration() });
    const originals = f.app.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all();
    const input = { accountId: 'demo', clientRequestId: 'preview-once', expectedSettingsRevision: 1, threadIds: ['marketing', 'cedar', 'both', 'protected'] };
    const accepted = await invoke(f.app, 'POST', '/api/automation/previews', input);
    assert.equal(accepted.status, 202); assert.equal(accepted.body.preview.revision, 0);
    await new Promise<void>(resolve => setImmediate(resolve));
    const result = await invoke(f.app, 'GET', '/api/automation/previews/' + accepted.body.preview.id + '?accountId=demo'), preview = result.body.preview;
    assert.equal(preview.state, 'completed', JSON.stringify(preview.error)); assert.equal(preview.revision, 2); assert.equal(preview.provenance.kind, 'synthetic-fixture');
    assert.equal(preview.effects.find((effect: any) => effect.threadId === 'marketing').archive, true);
    for (const id of ['cedar', 'both', 'protected']) assert.equal(preview.effects.find((effect: any) => effect.threadId === id).archive, false, id);
    assert.deepEqual(f.app.store.db.prepare("SELECT id,data FROM records WHERE kind='thread' ORDER BY id").all(), originals);
    assert.equal(f.calls(), 1); assert.equal((await invoke(f.app, 'POST', '/api/automation/previews', input)).status, 200); assert.equal(f.calls(), 1);
    const action = { accountId: 'demo', clientRequestId: 'apply-once', expectedPreviewHash: preview.previewHash };
    const applied = await invoke(f.app, 'POST', '/api/automation/previews/' + preview.id + '/apply', action);
    assert.equal(applied.status, 200); assert.equal(applied.body.application.providerEffects, false); assert.equal(applied.body.application.effectScope, 'synthetic-demo-local');
    assert.equal(f.app.store.required<Thread>('thread', 'marketing').folder, 'done');
    assert.deepEqual(f.app.store.required<Thread>('thread', 'marketing').providerLabels, ['UNRELATED']);
    assert.ok(f.app.store.required<Thread>('thread', 'cedar').labels.includes(automationLabelId('demo', 'cedar-review')));
    assert.equal(f.app.store.required<Thread>('thread', 'both').folder, 'inbox');
    assert.equal(f.app.store.required<Thread>('thread', 'protected').folder, 'inbox');
    const manual = { ...f.app.store.required<Thread>('thread', 'marketing'), unread: false, subject: 'User edit after apply' }; f.app.store.put('thread', 'marketing', manual);
    assert.deepEqual((await invoke(f.app, 'GET', '/api/automation/applications/by-request/apply-once?accountId=demo')).body, applied.body);
    assert.deepEqual((await invoke(f.app, 'POST', '/api/automation/previews/' + preview.id + '/apply', action)).body, applied.body);
    assert.deepEqual(f.app.store.required('thread', 'marketing'), manual);
    assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM automation_applications').get()!.n, 1);
    const refused = await invoke(f.app, 'POST', '/api/automation/previews', { ...input, accountId: 'google', clientRequestId: 'google-refused' });
    assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'automation_demo_only');
  } finally { await f.app.close(); }
});

test('manual managed-label edits fence old previews and configuration updates rather than overwrite labels or tags', async () => {
  const f = fixture();
  try {
    f.app.automation.save('demo', { expectedRevision: 0, configuration: configuration() });
    const prepared = f.app.automation.preview({ accountId: 'demo', clientRequestId: 'preview', expectedSettingsRevision: 1, threadIds: ['cedar'] });
    await new Promise<void>(resolve => setImmediate(resolve));
    const preview = f.app.automation.engine.get('demo', prepared.preview.id), labelId = automationLabelId('demo', 'cedar-review');
    f.app.store.put('label', labelId, { id: labelId, accountId: 'demo', name: 'User renamed this label', color: '#123456' });
    assert.throws(() => f.app.automation.apply(preview.id, { accountId: 'demo', clientRequestId: 'apply-stale', expectedPreviewHash: preview.previewHash! }), { code: 'automation_preview_stale' });
    const changed = configuration(); changed.archive.never.push('another@example.test');
    assert.throws(() => f.app.automation.save('demo', { expectedRevision: 1, configuration: changed }), { code: 'automation_label_conflict' });
    assert.equal(f.app.automation.settings.get('demo').revision, 1);
    assert.equal(f.app.store.required<any>('label', labelId).name, 'User renamed this label');
    assert.equal(f.app.store.required<Thread>('thread', 'cedar').folder, 'inbox');
    const empty = emptyAutomationConfiguration(); f.app.automation.save('demo', { expectedRevision: 1, configuration: empty });
    assert.equal(f.app.store.required<any>('label', labelId).name, 'User renamed this label');
  } finally { await f.app.close(); }
});
