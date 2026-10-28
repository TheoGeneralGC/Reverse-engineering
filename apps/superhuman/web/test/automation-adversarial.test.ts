import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationActions } from '../src/automation-actions.ts';
import { AutomationModel } from '../src/automation-model.ts';
import { configurationValue, editRule, ruleValue, toggleRuleOperator } from '../src/automation-rule.ts';
import { parseAutomationConfiguration } from '../../api/src/automation-config.ts';
import type { AutomationApplyResponse, AutomationConfiguration, AutomationPreview, AutomationSettingsResponse } from '../../api/src/automation-types.ts';

const hash = 'a'.repeat(64), at = '2026-10-28T00:00:00.000Z', storageKey = 'superhuman.automation.action.v1.a';
const empty = (): AutomationConfiguration => ({ labels: [], archive: { labelIds: [], always: [], never: [] } });
function settings(configuration = empty(), revision = 1): AutomationSettingsResponse {
  return { settings: { accountId: 'a', revision, configuration, configurationHash: hash, updatedAt: at, processing: 'manual-demo-only', providerEffects: false }, labels: [], availableLabels: [], labelOptionsLimited: false, templates: [], capabilities: { configuration: true, preview: true, apply: true, classifier: 'controlled-fixture', automaticProcessing: false, providerEffects: false }, limitations: [] };
}
function preview(key: string, state: AutomationPreview['state'] = 'completed'): AutomationPreview {
  return { id: 'preview-owned', accountId: 'a', clientRequestId: key, revision: state === 'completed' ? 2 : 0, settingsRevision: 1, settingsHash: hash, threadIdentities: [{ threadId: 'owned', stateHash: hash }], provenance: { kind: 'synthetic-fixture', classifierId: 'fixture', classifierVersion: 'v1', fixtureSetHash: hash }, state, effects: state === 'completed' ? [{ threadId: 'owned', beforeHash: hash, addLabelIds: [], labelIdentities: [], archive: true, classification: 'classified', reasons: ['Synthetic annotation'] }] : [], previewHash: state === 'completed' ? hash : null, createdAt: at, completedAt: state === 'completed' ? at : null, error: null };
}
function application(key: string): AutomationApplyResponse {
  return { receipt: { id: 'receipt-owned', accountId: 'a', clientRequestId: key, applicationId: 'applied-owned', previewId: 'preview-owned', previewHash: hash, acceptedAt: at }, application: { id: 'applied-owned', accountId: 'a', previewId: 'preview-owned', previewHash: hash, settingsRevision: 1, appliedAt: at, threads: [{ threadId: 'owned', beforeHash: hash, afterHash: 'b'.repeat(64), addedLabelIds: [], archived: true }], effectScope: 'synthetic-demo-local', providerEffects: false } };
}
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('a polled preview cannot retarget a confirmed prepared identity even with the same account/key/configuration', async () => {
  const store = storage(), actions = new AutomationActions('a', { storage: store, uuid: () => 'preview-key', request: async (_path, _body, method = 'GET') => ({ preview: method === 'POST' ? preview('preview-key', 'prepared') : { ...preview('preview-key'), id: 'different-preview' } }) });
  assert.equal(await actions.preview(settings(), ['owned']), true);
  const bytes = store.values.get(storageKey);
  assert.equal(await actions.recover(), false);
  assert.equal(actions.getSnapshot().preview?.id, 'preview-owned');
  assert.equal(actions.getSnapshot().unknown, true); assert.equal(store.values.get(storageKey), bytes);
});

test('a fresh explicit preview key can legitimately produce a new preview ID after the prior action completes', async () => {
  const store = storage(); let sequence = 0, posts = 0;
  const actions = new AutomationActions('a', { storage: store, uuid: () => 'key-' + (++sequence), request: async (_path, body: any, method = 'GET') => { assert.equal(method, 'POST'); posts++; return { preview: { ...preview(body.clientRequestId), id: 'id-' + body.clientRequestId } }; } });
  assert.equal(await actions.preview(settings(), ['owned']), true);
  assert.equal(actions.getSnapshot().preview?.id, 'id-key-1');
  assert.equal(await actions.preview(settings(), ['owned']), true);
  assert.equal(actions.getSnapshot().preview?.id, 'id-key-2'); assert.equal(posts, 2); assert.equal(store.values.size, 0);
});

test('untrusted application effect scope and incomplete effects never publish or clear the accepted-action key', async () => {
  for (const mutation of [{ providerEffects: true }, { effectScope: 'provider' }, { threads: [] }]) {
    const store = storage(); let writes = 0;
    const actions = new AutomationActions('a', { storage: store, uuid: () => 'key-' + (writes + 1), request: async (path, body: any, method = 'GET') => { if (method === 'POST') writes++; return path.endsWith('/apply') ? { ...application(body.clientRequestId), application: { ...application(body.clientRequestId).application, ...mutation } } : { preview: preview(body.clientRequestId) }; } });
    assert.equal(await actions.preview(settings(), ['owned']), true);
    assert.equal(await actions.apply(settings()), false);
    assert.equal(actions.getSnapshot().application, null); assert.equal(actions.getSnapshot().unknown, true);
    assert.equal(store.values.size, 1); assert.equal(await actions.apply(settings()), false); assert.equal(writes, 2);
  }
});

test('held old-key recovery cannot clear or apply over a newer shared journal; the newer intent recovers by GET only', async () => {
  const store = storage(), held = deferred<any>(), calls: { path: string; method: string }[] = [];
  const actions = new AutomationActions('a', { storage: store, uuid: () => 'old-key', request: async (path, _body, method = 'GET') => { calls.push({ path, method }); if (method === 'POST') throw Error('Lost ACK'); return path.includes('/new-key?') ? { preview: preview('new-key') } : held.promise; } });
  await actions.preview(settings(), ['owned']);
  const reading = actions.recover();
  const replacement = JSON.stringify({ version: 1, kind: 'preview', accountId: 'a', key: 'new-key', revision: 1, settingsHash: hash, threadIds: ['owned'] });
  store.values.set(storageKey, replacement); held.resolve({ preview: preview('old-key') });
  assert.equal(await reading, false); assert.equal(actions.getSnapshot().preview, null); assert.equal(store.values.get(storageKey), replacement);
  assert.equal(await actions.recover(), true); assert.equal(actions.getSnapshot().preview?.clientRequestId, 'new-key');
  assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'GET']); assert.equal(store.values.size, 0);
});

test('silent storage removal keeps receipt recovery locked and prevents another POST', async () => {
  const store = storage(); let writes = 0;
  store.removeItem = () => {};
  const actions = new AutomationActions('a', { storage: store, uuid: () => 'owned-key', request: async (_path, _body, method = 'GET') => { if (method === 'POST') writes++; return { preview: preview('owned-key') }; } });
  assert.equal(await actions.preview(settings(), ['owned']), false); assert.equal(actions.getSnapshot().preview, null);
  const bytes = store.values.get(storageKey); assert.equal(actions.getSnapshot().unknown, true);
  assert.equal(await actions.recover(), false); assert.equal(store.values.get(storageKey), bytes);
  assert.equal(await actions.preview(settings(), ['owned']), false); assert.equal(writes, 1);
});

test('closing during recovery cannot publish late account data or clear the receipt; a same-account remount uses GET only', async () => {
  const store = storage(), held = deferred<any>(); let posts = 0;
  const old = new AutomationActions('a', { storage: store, uuid: () => 'owned-key', request: async (_path, _body, method = 'GET') => { if (method === 'POST') { posts++; throw Error('Lost ACK'); } return held.promise; } });
  await old.preview(settings(), ['owned']); const recovering = old.recover(), bytes = store.values.get(storageKey);
  old.close();
  let foreignReads = 0;
  const foreign = new AutomationActions('b', { storage: store, request: async () => { foreignReads++; throw Error('No account B request expected'); } });
  assert.equal(await foreign.recover(), false); assert.equal(foreignReads, 0);
  held.resolve({ preview: preview('owned-key') }); assert.equal(await recovering, false);
  assert.equal(old.getSnapshot().preview, null); assert.equal(store.values.get(storageKey), bytes);
  const paths: string[] = [], remount = new AutomationActions('a', { storage: store, request: async (path, _body, method = 'GET') => { assert.equal(method, 'GET'); paths.push(path); return { preview: preview('owned-key') }; } });
  assert.equal(await remount.recover(), true); assert.equal(paths.length, 1); assert.ok(paths[0].includes('/owned-key?accountId=a'));
  assert.equal(posts, 1); assert.equal(store.values.size, 0);
});

test('deferred older settings cannot replace a newer loaded revision or discard staged nested rule edits', async () => {
  const first = deferred<AutomationSettingsResponse>(); let reads = 0;
  const model = new AutomationModel('a', async () => ++reads === 1 ? first.promise : settings(empty(), 3));
  const old = model.load(); assert.equal(await model.load(), true);
  const rule = { id: 'nested', name: 'Nested', prompt: 'Exact\nfixture prompt', groups: [{ operator: 'and' as const, queryOperator: 'or' as const, items: [{ type: 'subject' as const, value: 'Cedar' }] }] };
  model.putRule(rule); first.resolve(settings(empty(), 2)); assert.equal(await old, false);
  assert.equal(model.getSnapshot().base?.settings.revision, 3); assert.deepEqual(model.getSnapshot().form?.labels, [rule]); assert.equal(model.dirty, true);
});

test('conflicting nested connectors remain staged until explicit resolution, with unrelated remote fields preserved', async () => {
  const original: AutomationConfiguration = { labels: [{ id: 'nested', name: 'Nested', prompt: 'Original prompt', groups: [{ operator: 'and', queryOperator: 'or', items: [{ type: 'subject', value: 'Cedar' }] }] }], archive: { labelIds: [], always: [], never: [] } };
  let remote = settings(original), patches = 0;
  const model = new AutomationModel('a', async (_path, _body, method = 'GET') => { if (method !== 'GET') patches++; return structuredClone(remote); });
  await model.load();
  const local = structuredClone(original.labels[0]); local.groups[0].queryOperator = 'and'; model.putRule(local);
  const updated = structuredClone(original); updated.labels[0].prompt = 'Remote prompt'; updated.archive.never = ['safe.example.test']; remote = settings(updated, 2);
  assert.equal(await model.load(), true); assert.deepEqual(model.getSnapshot().conflicts, ['labels.nested']);
  assert.deepEqual(model.getSnapshot().form?.labels[0], local); assert.deepEqual(model.getSnapshot().form?.archive.never, ['safe.example.test']);
  assert.equal(await model.save(), false); assert.equal(patches, 0);
  model.resolveConflicts('saved'); assert.deepEqual(model.getSnapshot().form, updated); assert.equal(model.dirty, false);
});

test('nested rule edit roundtrip preserves prompt bytes, independent connectors, exclusions and API selector normalization', () => {
  const configuration: AutomationConfiguration = { labels: [{ id: 'nested', name: '  Nested  ', prompt: 'Exact\nUnicode 样本', groups: [
    { operator: 'and', queryOperator: 'or', items: [{ type: 'from', value: 'USER@BÜCHER。EXAMPLE' }, { type: 'subject', value: ' Cedar ' }] },
    { operator: 'exclude', queryOperator: 'and', items: [{ type: 'to', value: 'peer@01.2.3.4' }, { type: 'label', value: 'opaque-label' }] },
  ] }], archive: { labelIds: [], always: ['12.34', 'USER@BÜCHER。EXAMPLE'], never: [] } };
  const original = structuredClone(configuration), edited = editRule(configuration.labels[0]);
  const toggled = toggleRuleOperator(edited, 1);
  assert.equal(toggled.groups[1].operator, 'exclude'); assert.equal(toggled.groups[1].queryOperator, 'or');
  const value = configurationValue({ ...configuration, labels: [ruleValue(edited)] });
  assert.deepEqual(value, parseAutomationConfiguration(configuration)); assert.deepEqual(configuration, original);
  assert.equal(value.labels[0].prompt, original.labels[0].prompt);
  assert.deepEqual(value.labels[0].groups.map(g => [g.operator, g.queryOperator]), [['and', 'or'], ['exclude', 'and']]);
});
