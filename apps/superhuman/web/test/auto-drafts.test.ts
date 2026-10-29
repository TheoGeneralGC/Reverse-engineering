import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoDraftsModel, journalKey, type Request } from '../src/auto-drafts/model.ts';
import { ApiError } from '../src/api.ts';
import type { PreferenceSave, SaveResponse } from '../../api/src/auto-drafts-contract.ts';
import { settings, accepted, digest, deferred, storage } from './auto-drafts-fixtures.ts';
const turn = () => new Promise<void>(done => setImmediate(done));

test('one direct field writes immediately and its ACK preserves a separate newer staged scheduling draft', async () => {
  const local = storage(), hold = deferred<SaveResponse>(); let base = settings(), posts = 0; const calls: any[] = [];
  const request: Request = async (path, body, method) => { calls.push({ path, body, method }); if (method === 'PATCH') { posts++; const result = await hold.promise; base = settings(base.accountId, result.acceptedSnapshot as any); return result; } return base; };
  const model = new AutoDraftsModel({ accountId: base.accountId, storage: local, request, digest, makeKey: () => 'direct-once' }); model.activate(); await model.load();
  const pending = model.setPreference('responsesEnabled', true); await turn(); assert.equal(posts, 1);
  const sent = calls.find(x => x.method === 'PATCH').body as PreferenceSave; assert.deepEqual(sent.change, { field: 'responsesEnabled', value: true }); assert.equal(Object.hasOwn(sent, 'desired'), false);
  model.stageScheduling({ enabled: false, teammateId: null, prompt: 'Keep this local staged text' });
  hold.resolve(await accepted(sent, base.preferences)); assert.equal(await pending, true);
  assert.equal(model.getSnapshot().base!.preferences.value.responsesEnabled, true); assert.equal(model.getSnapshot().base!.capabilities.generationAvailable, false);
  assert.equal(model.getSnapshot().stagedScheduling!.prompt, 'Keep this local staged text'); assert.equal(model.schedulingDirty, true);
  assert.equal(model.saveScheduling(), false); assert.equal(calls.some(x => x.method === 'PUT'), false); assert.equal(local.values.size, 0); model.dispose();
});
test('lost ACK and404 remount remain GET-only and locked until the same receipt becomes available', async () => {
  const local = storage(); let base = settings(), receipt: SaveResponse | null = null, unavailable = true, posts = 0, keys = 0; const paths: string[] = [];
  const request: Request = async (path, body, method) => { paths.push(path); if (method === 'PATCH') { posts++; receipt = await accepted(body as PreferenceSave, base.preferences); base = settings(base.accountId, receipt.acceptedSnapshot as any); throw new ApiError('Lost ACK', 503); } if (path.includes('/by-request/')) { if (unavailable) throw new ApiError('Unknown', 404, 'auto_drafts_request_not_found'); return { ...receipt!, historical: true }; } return base; };
  const make = () => new AutoDraftsModel({ accountId: base.accountId, storage: local, request, digest, makeKey: () => 'key-' + (++keys) });
  const first = make(); first.activate(); await first.load(); assert.equal(await first.setPreference('followUpsEnabled', true), false); first.dispose();
  const second = make(); second.activate(); assert.equal(await second.load(), false); assert.equal(second.getSnapshot().unknown, true); assert.equal(await second.setPreference('responsesEnabled', true), false); assert.equal(posts, 1); assert.equal(keys, 1);
  unavailable = false; assert.equal(await second.recover(), true); assert.equal(second.getSnapshot().base!.preferences.value.followUpsEnabled, true); assert.equal(local.values.size, 0); assert.equal(paths.filter(x => x.includes('/by-request/')).length, 2); second.dispose();
});
test('positive acceptance followed by named currentGET404 retains its accepted proof through remount', async () => {
  const local = storage(); let base = settings(), receipt: SaveResponse | null = null, fail = false, posts = 0;
  const request: Request = async (path, body, method) => { if (method === 'PATCH') { posts++; receipt = await accepted(body as PreferenceSave, base.preferences); base = settings(base.accountId, receipt.acceptedSnapshot as any); fail = true; return receipt; } if (path.includes('/by-request/')) return { ...receipt!, historical: true }; if (fail) throw new ApiError('Missing current', 404, 'auto_drafts_account_unavailable'); return base; };
  const first = new AutoDraftsModel({ accountId: base.accountId, storage: local, request, digest, makeKey: () => 'accepted-key' }); first.activate(); await first.load(); assert.equal(await first.setPreference('responsesEnabled', true), false);
  assert.equal(JSON.parse(local.getItem(journalKey(base.accountId))!).phase, 'accepted'); first.dispose(); fail = false;
  const second = new AutoDraftsModel({ accountId: base.accountId, storage: local, request, digest }); second.activate(); assert.equal(await second.load(), true); assert.equal(posts, 1); assert.equal(local.values.size, 0); second.dispose();
});
test('silent journal storage failure blocks dispatch, Responses-off blocks dependent edits and noTeam blocks saves', async () => {
  let posts = 0; const model = new AutoDraftsModel({ accountId: 'fixture-a', storage: { getItem: () => null, setItem() {}, removeItem() {} }, request: async (_p, _b, method) => { if (method !== 'GET') posts++; return settings(); }, digest });
  model.activate(); await model.load(); assert.equal(await model.setPreference('onlyEmailedBefore', true), false); assert.equal(posts, 0); assert.equal(await model.setPreference('responsesEnabled', true), false); assert.equal(posts, 0); assert.equal(model.saveScheduling(), false); model.dispose();
});
test('other-tab replacement during held ACK is preserved and never cleared or followed by another PATCH', async () => {
  const local = storage(), hold = deferred<SaveResponse>(); let base = settings(), posts = 0, sent: PreferenceSave | null = null;
  const request: Request = async (_p, body, method) => { if (method === 'PATCH') { posts++; sent = body as PreferenceSave; return hold.promise; } return base; };
  const model = new AutoDraftsModel({ accountId: base.accountId, storage: local, request, digest, makeKey: () => 'old-key' }); model.activate(); await model.load(); const pending = model.setPreference('responsesEnabled', true); await turn();
  const raw = JSON.parse(local.getItem(journalKey(base.accountId))!); raw.request.clientRequestId = 'new-key'; const replacement = JSON.stringify(raw); local.setItem(journalKey(base.accountId), replacement);
  hold.resolve(await accepted(sent!, base.preferences)); assert.equal(await pending, false); assert.equal(local.getItem(journalKey(base.accountId)), replacement); assert.equal(posts, 1); assert.equal(model.getSnapshot().unknown, true); model.dispose();
});
test('offline prepared action never auto-posts on load; explicit resume retains its key and reviewed CAS', async () => {
  const local = storage(); let online = false, base = settings(), posts = 0; const request: Request = async (_p, body, method) => { if (method === 'PATCH') { posts++; const result = await accepted(body as PreferenceSave, base.preferences); base = settings(base.accountId, result.acceptedSnapshot as any); return result; } return base; };
  const model = new AutoDraftsModel({ accountId: base.accountId, storage: local, request, digest, online: () => online, makeKey: () => 'offline-key' }); model.activate(); await model.load(); assert.equal(await model.setPreference('followUpsEnabled', true), false); assert.equal(model.getSnapshot().phase, 'prepared'); online = true; await model.load(); assert.equal(posts, 0); assert.equal(await model.resumePrepared(), true); assert.equal(posts, 1); assert.equal(model.getSnapshot().lastReceipt!.clientRequestId, 'offline-key'); model.dispose();
});
test('account activation epochs reject late A data after an A→B→A suspension', async () => {
  const local = storage(), held = deferred<unknown>(); let calls = 0;
  const model = new AutoDraftsModel({ accountId: 'fixture-a', storage: local, digest, request: async () => ++calls === 1 ? held.promise : settings() });
  model.activate(); const old = model.load(); model.suspend(); model.activate(); assert.equal(await model.load(), true); held.resolve({ ...settings(), accountId: 'foreign' }); assert.equal(await old, false); assert.equal(model.getSnapshot().base!.accountId, 'fixture-a'); assert.equal(model.getSnapshot().error, ''); model.dispose();
});
