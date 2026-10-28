import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutomationModel, type AutomationConfiguration, type AutomationSettingsResponse } from '../src/automation-model.ts';
import { ApiError } from '../src/api.ts';
const empty = (): AutomationConfiguration => ({ labels: [], archive: { labelIds: [], always: [], never: [] } });
export function settings(configuration = empty(), revision = 0, accountId = 'a'): AutomationSettingsResponse {
  return { settings: { accountId, revision, configuration, configurationHash: 'a'.repeat(64), updatedAt: null, processing: 'manual-demo-only', providerEffects: false }, labels: [{ id: 'builtin-marketing', name: 'Marketing', kind: 'builtin', mailLabelId: 'mail-marketing', mailLabelAvailable: true }], availableLabels: [], labelOptionsLimited: false, templates: [], capabilities: { configuration: true, preview: false, apply: false, providerEffects: false, automaticProcessing: false, classifier: 'unavailable' }, limitations: [] };
}
const rule = (id: string, name: string) => ({ id, name, prompt: '', groups: [{ operator: 'or' as const, queryOperator: 'or' as const, items: [{ type: 'subject' as const, value: 'owned' }] }] });

test('opening reads only; staged archive and rules save exact selected account with a revision', async () => {
  const calls: { method: string; body: any; path: string }[] = [];
  const model = new AutomationModel('a', async (path, body: any, method = 'GET') => { calls.push({ path, body, method }); return method === 'GET' ? settings() : settings(body.configuration, 1); });
  await model.load(); assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
  model.putRule(rule('r', 'Owned')); model.setArchive('labelIds', ['builtin-marketing']);
  assert.equal(calls.length, 1); assert.equal(model.dirty, true); assert.equal(await model.save(), true);
  assert.equal(calls[1].path, '/automation/settings?accountId=a'); assert.equal(calls[1].method, 'PATCH'); assert.equal(calls[1].body.expectedRevision, 0); assert.equal(model.dirty, false);
});

test('conflict reload preserves changed rule and merges unrelated changes until explicit resolution', async () => {
  const original = { ...empty(), labels: [rule('one', 'One'), rule('two', 'Two')] };
  let remote = settings(original, 1), posts = 0;
  const model = new AutomationModel('a', async (_path, _body, method = 'GET') => { if (method === 'GET') return remote; posts++; throw new ApiError('Changed elsewhere', 409, 'automation_revision_conflict'); });
  await model.load(); model.putRule(rule('one', 'Local One')); await model.save(); assert.equal(model.getSnapshot().needsReload, true);
  remote = settings({ ...original, labels: [rule('one', 'Remote One'), rule('two', 'Remote Two')] }, 2);
  await model.load(); assert.deepEqual(model.getSnapshot().form?.labels.map(value => value.name), ['Local One', 'Remote Two']); assert.deepEqual(model.getSnapshot().conflicts, ['labels.one']);
  assert.equal(await model.save(), false); assert.equal(posts, 1);
  model.resolveConflicts('saved'); assert.deepEqual(model.getSnapshot().form?.labels.map(value => value.name).sort(), ['Remote One', 'Remote Two']);
});

test('lost Save ACK locks edits and reload confirms accepted canonical input without resending', async () => {
  let remote = settings(), writes = 0;
  const model = new AutomationModel('a', async (_path, body: any, method = 'GET') => { if (method === 'GET') return remote; writes++; remote = settings(body.configuration, 1); throw Error('Lost acknowledgement'); });
  await model.load(); model.setArchive('always', ['PERSON@BÜCHER.example']);
  assert.equal(await model.save(), false); assert.equal(model.locked, true); model.setArchive('always', []);
  assert.deepEqual(model.getSnapshot().form?.archive.always, ['PERSON@BÜCHER.example']);
  await model.load(); assert.equal(model.dirty, false); assert.equal(model.locked, false); assert.equal(writes, 1); assert.deepEqual(model.getSnapshot().form?.archive.always, ['person@xn--bcher-kva.example']);
});

test('foreign or mismatched Save response remains unconfirmed and a late closed request cannot publish', async () => {
  let release!: (value: AutomationSettingsResponse) => void;
  const model = new AutomationModel('a', async (_path, body: any, method = 'GET') => method === 'GET' ? settings() : new Promise(resolve => { release = resolve; }));
  await model.load(); model.setArchive('never', ['owned.example']); const sending = model.save();
  release(settings(empty(), 1)); await sending; assert.equal(model.getSnapshot().needsReload, true); assert.deepEqual(model.getSnapshot().form?.archive.never, ['owned.example']);
  let readRelease!: (value: AutomationSettingsResponse) => void; const late = new AutomationModel('a', () => new Promise(resolve => { readRelease = resolve; }));
  const reading = late.load(); late.close(); readRelease(settings(empty(), 1, 'b')); await reading; assert.equal(late.getSnapshot().base, null);
  late.activate(); const readingAgain = late.load(); readRelease(settings()); await readingAgain; assert.equal(late.getSnapshot().base?.settings.accountId, 'a');
});
