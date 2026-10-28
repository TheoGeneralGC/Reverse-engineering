import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutomationActions } from '../src/automation-actions.ts';
import { ApiError } from '../src/api.ts';
import type { AutomationApplyResponse, AutomationPreview, AutomationSettingsResponse } from '../../api/src/automation-types.ts';
const hash = 'a'.repeat(64), at = '2026-10-28T00:00:00.000Z';
const settings: AutomationSettingsResponse = { settings: { accountId: 'a', revision: 1, configuration: { labels: [], archive: { labelIds: [], always: [], never: [] } }, configurationHash: hash, updatedAt: at, processing: 'manual-demo-only', providerEffects: false }, labels: [], availableLabels: [], labelOptionsLimited: false, templates: [], capabilities: { configuration: true, preview: true, apply: true, classifier: 'controlled-fixture', automaticProcessing: false, providerEffects: false }, limitations: [] };
function preview(clientRequestId: string, state: AutomationPreview['state'] = 'completed'): AutomationPreview {
  return { id: 'preview-owned', accountId: 'a', clientRequestId, revision: state === 'completed' ? 2 : 0, settingsRevision: 1, settingsHash: hash, threadIdentities: [{ threadId: 'thread-owned', stateHash: hash }], provenance: { kind: 'synthetic-fixture', classifierId: 'fixture', classifierVersion: '1', fixtureSetHash: hash }, state, effects: state === 'completed' ? [{ threadId: 'thread-owned', beforeHash: hash, addLabelIds: [], labelIdentities: [], archive: true, classification: 'classified', reasons: ['Controlled fixture annotation'] }] : [], previewHash: state === 'completed' ? hash : null, createdAt: at, completedAt: state === 'completed' ? at : null, error: null };
}
function applied(clientRequestId: string): AutomationApplyResponse {
  return { receipt: { id: 'receipt-owned', accountId: 'a', clientRequestId, applicationId: 'application-owned', previewId: 'preview-owned', previewHash: hash, acceptedAt: at }, application: { id: 'application-owned', accountId: 'a', previewId: 'preview-owned', previewHash: hash, settingsRevision: 1, appliedAt: at, threads: [{ threadId: 'thread-owned', beforeHash: hash, afterHash: 'b'.repeat(64), addedLabelIds: [], archived: true }], effectScope: 'synthetic-demo-local', providerEffects: false } };
}
const storage = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };

test('demo preview and apply require separate explicit actions and record the key before each POST', async () => {
  const store = storage(), calls: { path: string; method: string; body: any }[] = []; let sequence = 0;
  const actions = new AutomationActions('a', { storage: store, uuid: () => 'key-'+(++sequence), request: async (path, body: any, method = 'GET') => { calls.push({ path, body, method }); assert.equal(JSON.parse([...store.values.values()][0]).key, body.clientRequestId); return path.endsWith('/apply') ? applied(body.clientRequestId) : { preview: preview(body.clientRequestId) }; } });
  actions.activate(); assert.equal(await actions.recover(), false); assert.equal(calls.length, 0);
  assert.equal(await actions.preview({ ...settings, capabilities: { ...settings.capabilities, preview: false } }, ['thread-owned']), false); assert.equal(calls.length, 0);
  assert.equal(await actions.preview(settings, ['thread-owned']), true); assert.equal(calls.length, 1); assert.equal(actions.getSnapshot().application, null); assert.equal(store.values.size, 0);
  assert.equal(await actions.apply(settings), true); assert.equal(calls.length, 2); assert.equal(actions.getSnapshot().application?.application.effectScope, 'synthetic-demo-local'); assert.equal(store.values.size, 0); assert.equal(await actions.apply(settings), false); assert.equal(calls.length, 2);
});

test('accepted processing preview resumes with GET only and has no implicit apply', async () => {
  const store = storage(), calls: { path: string; method: string }[] = []; let clientKey = '';
  const actions = new AutomationActions('a', { storage: store, uuid: () => 'preview-key', request: async (path, body: any, method = 'GET') => { calls.push({ path, method }); if (method === 'POST') clientKey = body.clientRequestId; return { preview: preview(clientKey, method === 'POST' ? 'prepared' : 'completed') }; } });
  assert.equal(await actions.preview(settings, ['thread-owned']), true); assert.equal(store.values.size, 1); assert.equal(actions.getSnapshot().preview?.state, 'prepared');
  assert.equal(await actions.recover(), true); assert.equal(actions.getSnapshot().preview?.state, 'completed'); assert.equal(store.values.size, 0); assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']); assert.ok(calls[1].path.includes('/by-request/preview-key')); assert.equal(actions.getSnapshot().application, null);
});

test('lost Apply ACK and recovery404 stay locked; remount recovers the same accepted key without applying again', async () => {
  const store = storage(); let sequence = 0, writes = 0, applyKey = '';
  const first = new AutomationActions('a', { storage: store, uuid: () => 'key-'+(++sequence), request: async (path, body: any, method = 'GET') => { if (method === 'GET') throw new ApiError('Not yet found', 404, 'automation_not_found'); if (path.endsWith('/apply')) { writes++; applyKey = body.clientRequestId; throw Error('Lost acknowledgement'); } return { preview: preview(body.clientRequestId) }; } });
  await first.preview(settings, ['thread-owned']); assert.equal(await first.apply(settings), false); const bytes = [...store.values]; assert.equal(first.getSnapshot().unknown, true); assert.equal(await first.recover(), false); assert.deepEqual([...store.values], bytes); assert.equal(await first.apply(settings), false); first.close();
  const reads: string[] = [], second = new AutomationActions('a', { storage: store, request: async (path, _body, method = 'GET') => { assert.equal(method, 'GET'); reads.push(path); return applied(applyKey); } });
  assert.equal(await second.recover(), true); assert.ok(reads[0].includes(encodeURIComponent(applyKey))); assert.equal(writes, 1); assert.equal(store.values.size, 0); assert.equal(second.getSnapshot().application?.receipt.clientRequestId, applyKey);
});

test('an account-mismatched preview cannot publish or clear its pending key', async () => {
  const store = storage(), actions = new AutomationActions('a', { storage: store, uuid: () => 'key', request: async (_path, body: any) => ({ preview: { ...preview(body.clientRequestId), accountId: 'foreign' } }) });
  assert.equal(await actions.preview(settings, ['thread-owned']), false); assert.equal(actions.getSnapshot().preview, null); assert.equal(actions.getSnapshot().unknown, true); assert.equal(store.values.size, 1);
});

test('the accepted preview ID is durable and a remounted same-key read cannot substitute another artifact', async () => {
  const store = storage(), first = new AutomationActions('a', { storage: store, uuid: () => 'stable-key', request: async (_path, body: any) => ({ preview: preview(body.clientRequestId, 'prepared') }) });
  await first.preview(settings, ['thread-owned']); const bytes = [...store.values]; assert.equal(JSON.parse(bytes[0][1]).previewId, 'preview-owned'); first.close();
  let substitute = true; const second = new AutomationActions('a', { storage: store, request: async (_path, _body, method = 'GET') => { assert.equal(method, 'GET'); return { preview: { ...preview('stable-key'), id: substitute ? 'different-preview' : 'preview-owned' } }; } });
  assert.equal(await second.recover(), false); assert.equal(second.getSnapshot().preview, null); assert.equal(second.getSnapshot().unknown, true); assert.deepEqual([...store.values], bytes);
  substitute = false; assert.equal(await second.recover(), true); assert.equal(second.getSnapshot().preview?.id, 'preview-owned'); assert.equal(store.values.size, 0);
});
