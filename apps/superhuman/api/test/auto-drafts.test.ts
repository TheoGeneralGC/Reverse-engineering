import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { AutoDraftsService } from '../src/auto-drafts.ts';
import { parseSettings, parseSaveResponse, parseErrorResponse, stable, type PreferenceSave, type SaveRequest, type SettingsSnapshot } from '../src/auto-drafts-contract.ts';

const now = Date.parse('2026-10-29T02:00:00Z');
const digest = async (s: string) => createHash('sha256').update(s).digest('hex');
const intent = (key: string, revision = 0, field: PreferenceSave['change']['field'] = 'responsesEnabled', value = true, accountId = 'a'): PreferenceSave => ({ accountId, clientRequestId: key, expectedRevision: revision, section: 'preferences', change: { field, value } });
function fixture() {
  let modelCalls = 0, providerCalls = 0;
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false, providerDraftAutomatic: false,
    scheduler: { now: () => now, schedule: () => { throw Error('No settings timer allowed'); } },
    aiFetch: (async () => { modelCalls++; throw Error('No model transport allowed'); }) as typeof fetch });
  app.google.fetcher = (async () => { providerCalls++; throw Error('No provider transport allowed'); }) as typeof fetch;
  for (const id of ['a', 'b']) app.store.put('account', id, { id, provider: 'demo', email: `${id}@example.test`, name: id, color: '#000' });
  return { app, calls: () => ({ modelCalls, providerCalls }) };
}
async function invoke(app: ReturnType<typeof createApp>, method: string, url: string, value?: unknown, raw?: string): Promise<{ status: number; body: any }> {
  const bytes = raw === undefined ? value === undefined ? [] : [Buffer.from(JSON.stringify(value))] : [Buffer.from(raw)];
  return new Promise(resolve => {
    const request = Object.assign(Readable.from(bytes), { method, url, headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' } });
    const response = { status: 0, setHeader() {}, writeHead(status: number) { this.status = status; }, end(payload: string) { resolve({ status: this.status, body: JSON.parse(payload) }); } };
    app.server.emit('request', request, response);
  });
}
const settings = async (app: ReturnType<typeof createApp>, accountId = 'a') => { const r = await invoke(app, 'GET', '/api/auto-drafts/settings?accountId=' + accountId); assert.equal(r.status, 200); return parseSettings(r.body, accountId); };
const rows = (app: ReturnType<typeof createApp>, table: string) => app.store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
async function save(app: ReturnType<typeof createApp>, request: PreferenceSave, prior: SettingsSnapshot) { const r = await invoke(app, 'PATCH', '/api/auto-drafts/preferences', request); assert.equal(r.status, 200, JSON.stringify(r.body)); return parseSaveResponse(r.body, request, prior, digest); }

test('actual absent-settings HTTP response is local-default OFF and GET/close create no settings or jobs', async () => {
  const f = fixture(); try {
    const before = f.app.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all();
    const counts = f.app.store.db.prepare('SELECT total_changes() n').get()!.n;
    const response = await settings(f.app); assert.equal(response.preferences.persisted, false); assert.deepEqual(response.preferences.value, { followUpsEnabled: false, responsesEnabled: false, onlyEmailedBefore: false });
    assert.equal(response.capabilities.generationAvailable, false); assert.equal(response.capabilities.automaticProcessing, false); assert.equal(response.capabilities.schedulingAvailable, false); assert.deepEqual(response.capabilities.teammates, []);
    await settings(f.app, 'b'); assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n, counts);
    for (const table of ['auto_drafts_settings', 'auto_drafts_setting_commits', 'auto_drafts_requests', 'auto_drafts_request_proofs']) assert.deepEqual(rows(f.app, table), []);
    assert.deepEqual(f.app.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(), before); assert.deepEqual(f.calls(), { modelCalls: 0, providerCalls: 0 });
  } finally { await f.app.close(); }
});

test('serialized one-field saves preserve other settings/account/bytes; OFF retains dormant emailed-before setting', async () => {
  const f = fixture(); try {
    const protectedBefore = f.app.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all();
    let prior = (await settings(f.app)).preferences;
    const first = await save(f.app, intent('responses'), prior); prior = first.acceptedSnapshot as typeof prior; const stableId = prior.settingsId;
    assert.equal(first.historical, false); assert.equal(first.receipt.changed, true); assert.equal(prior.revision, 1); assert.ok(stableId);
    prior = (await save(f.app, intent('restrict', 1, 'onlyEmailedBefore'), prior)).acceptedSnapshot as typeof prior;
    prior = (await save(f.app, intent('off', 2, 'responsesEnabled', false), prior)).acceptedSnapshot as typeof prior;
    assert.equal(prior.value.onlyEmailedBefore, true); assert.equal(prior.settingsId, stableId); assert.equal(prior.value.followUpsEnabled, false);
    for (const value of [false, true]) { const r = await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', intent('off-subordinate-' + value, 3, 'onlyEmailedBefore', value)); assert.equal(r.status, 409); assert.equal(parseErrorResponse(r.body).error.code, 'auto_drafts_requires_responses'); }
    assert.equal((await settings(f.app, 'b')).preferences.revision, 0); assert.equal((await settings(f.app)).scheduling.revision, 0);
    assert.deepEqual(f.app.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(), protectedBefore); assert.deepEqual(f.calls(), { modelCalls: 0, providerCalls: 0 });
  } finally { await f.app.close(); }
});

test('no-op allocates only an immutable receipt, not a default row or settings identity', async () => {
  const f = fixture(); try {
    const prior = (await settings(f.app)).preferences, request = intent('noop', 0, 'followUpsEnabled', false), saved = await save(f.app, request, prior);
    assert.equal(saved.receipt.changed, false); assert.deepEqual(saved.acceptedSnapshot, prior); assert.deepEqual(rows(f.app, 'auto_drafts_settings'), []); assert.deepEqual(rows(f.app, 'auto_drafts_setting_commits'), []);
    assert.equal(rows(f.app, 'auto_drafts_requests').length, 1); assert.equal(rows(f.app, 'auto_drafts_request_proofs').length, 1);
    const replay = await invoke(f.app, 'GET', '/api/auto-drafts/requests/by-request/noop?accountId=a&section=preferences'); assert.equal(replay.status, 200); const historical = await parseSaveResponse(replay.body, request, prior, digest); assert.equal(historical.historical, true); assert.equal(historical.receipt.id, saved.receipt.id);
  } finally { await f.app.close(); }
});

test('lost ACK recovers only its historical exact key after a newer save; fresh GET stays current', async () => {
  const f = fixture(); try {
    const prior = (await settings(f.app)).preferences, request = intent('lost'), accepted = await save(f.app, request, prior);
    const next = await save(f.app, intent('newer', 1, 'followUpsEnabled'), accepted.acceptedSnapshot);
    const before = f.app.store.db.prepare('SELECT total_changes() n').get()!.n;
    const replay = await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', request), recovered = await invoke(f.app, 'GET', '/api/auto-drafts/requests/by-request/lost?accountId=a&section=preferences');
    for (const r of [replay, recovered]) { assert.equal(r.status, 200); const s = await parseSaveResponse(r.body, request, prior, digest); assert.equal(s.historical, true); assert.deepEqual(s.receipt, accepted.receipt); assert.deepEqual(s.acceptedSnapshot, accepted.acceptedSnapshot); }
    assert.equal((await settings(f.app)).preferences.revision, next.acceptedSnapshot.revision); assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n, before);
    assert.equal((await invoke(f.app, 'GET', '/api/auto-drafts/requests/by-request/unknown?accountId=a&section=preferences')).status, 404); assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n, before);
  } finally { await f.app.close(); }
});

test('account/key intent is exact across fields, values, CAS and the separate unavailable scheduling domain', async () => {
  const f = fixture(); try {
    const prior = (await settings(f.app)).preferences; await save(f.app, intent('key'), prior);
    const schedule: SaveRequest = { accountId: 'a', clientRequestId: 'schedule', expectedRevision: 0, section: 'teammate-scheduling', desired: { enabled: false, teammateId: null, prompt: '' } };
    for (const changed of [intent('key', 0, 'followUpsEnabled'), intent('key', 0, 'responsesEnabled', false), intent('key', 1), { ...schedule, clientRequestId: 'key' }]) { const r = await invoke(f.app, changed.section === 'preferences' ? 'PATCH' : 'PUT', '/api/auto-drafts/' + (changed.section === 'preferences' ? 'preferences' : 'teammate-scheduling'), changed); assert.equal(r.status, 409); assert.equal(parseErrorResponse(r.body).error.code, 'auto_drafts_request_key_conflict'); }
    const before = f.app.store.db.prepare('SELECT total_changes() n').get()!.n;
    const unavailable = await invoke(f.app, 'PUT', '/api/auto-drafts/teammate-scheduling', schedule); assert.equal(unavailable.status, 409); assert.equal(parseErrorResponse(unavailable.body).error.code, 'auto_drafts_teammate_scheduling_unavailable');
    assert.equal((await invoke(f.app, 'GET', '/api/auto-drafts/requests/by-request/key?accountId=a&section=teammate-scheduling')).status, 404); assert.equal((await invoke(f.app, 'GET', '/api/auto-drafts/requests/by-request/key?accountId=b&section=preferences')).status, 404); assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n, before);
    // The same opaque key in a different account is independent, never a foreign receipt.
    const other = await save(f.app, intent('key', 0, 'followUpsEnabled', true, 'b'), (await settings(f.app, 'b')).preferences); assert.equal(other.receipt.accountId, 'b');
  } finally { await f.app.close(); }
});

test('strict HTTP grammar, invalid Unicode and unsafe revisions refuse without allocating any receipt', async () => {
  const f = fixture(); try {
    const malformed = [ { ...intent('x'), extra: true }, { ...intent('x'), expectedRevision: -1 }, { ...intent('x'), expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...intent('x'), accountId: '\ud800' }, { ...intent('x'), change: { field: 'followUpsEnabled', value: 'true' } } ];
    for (const r of malformed) { const result = await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', r); assert.equal(result.status, 400); parseErrorResponse(result.body); }
    for (const url of ['/api/auto-drafts/settings', '/api/auto-drafts/settings?accountId=a&accountId=b', '/api/auto-drafts/settings?accountId=a&extra=x', '/api/auto-drafts/requests/by-request/x?accountId=a', '/api/auto-drafts/requests/by-request/%ZZ?accountId=a&section=preferences']) assert.equal((await invoke(f.app, 'GET', url)).status, 400);
    for (const url of ['/api/auto-drafts/preferences?accountId=a', '/api/auto-drafts/preferences?extra=x']) assert.equal((await invoke(f.app, 'PATCH', url, intent('x'))).status, 400);
    assert.equal((await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', undefined, '{')).status, 400);
    assert.equal((await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', intent('x', Number.MAX_SAFE_INTEGER))).status, 409);
    assert.equal((await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', intent('x', 0, 'followUpsEnabled', true, 'missing'))).status, 404);
    assert.deepEqual(rows(f.app, 'auto_drafts_requests'), []); assert.deepEqual(rows(f.app, 'auto_drafts_settings'), []);
  } finally { await f.app.close(); }
});

test('receipt proof insertion failure atomically rolls back all settings/commit/request rows', async () => {
  const f = fixture(); try {
    f.app.store.db.exec("CREATE TRIGGER controlled_ad_failure BEFORE INSERT ON auto_drafts_request_proofs BEGIN SELECT RAISE(ABORT,'controlled fixture'); END");
    const failed = await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', intent('rollback')); assert.equal(failed.status, 500); assert.equal(parseErrorResponse(failed.body).error.code, 'auto_drafts_artifact_corrupt');
    for (const table of ['auto_drafts_settings', 'auto_drafts_setting_commits', 'auto_drafts_requests', 'auto_drafts_request_proofs']) assert.deepEqual(rows(f.app, table), []);
    assert.equal(f.app.store.db.isTransaction, false); assert.equal((await settings(f.app)).preferences.revision, 0);
    f.app.store.db.exec('DROP TRIGGER controlled_ad_failure'); const prior = (await settings(f.app)).preferences; assert.equal((await save(f.app, intent('rollback'), prior)).acceptedSnapshot.revision, 1);
  } finally { await f.app.close(); }
});

test('independent SQLite owners converge same-key acceptance and reject competing stale CAS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ad-owned-')), path = join(dir, 'fixture.sqlite');
  const one = new Store(path, false); one.put('account', 'a', { id: 'a', provider: 'demo', email: 'a@example.test', name: 'a', color: '#000' });
  const two = new Store(path, false), a = new AutoDraftsService(one, { now: () => now }), b = new AutoDraftsService(two, { now: () => now });
  try {
    const [left, right] = await Promise.all([a.savePreferences(intent('same')), b.savePreferences(intent('same'))]); assert.deepEqual(left.receipt, right.receipt); assert.equal(a.get('a').preferences.revision, 1);
    const results = await Promise.allSettled([a.savePreferences(intent('left', 1, 'followUpsEnabled')), b.savePreferences(intent('right', 1, 'onlyEmailedBefore'))]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(a.get('a').preferences.revision, 2);
    assert.equal(one.db.prepare('SELECT count(*) n FROM auto_drafts_requests').get()!.n, 2);
  } finally { two.close(); one.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('rewritten current/head and rewritten historical JSON+self-hash cannot override independent accepted proof', async () => {
  const f = fixture(); try {
    const prior = (await settings(f.app)).preferences, accepted = await save(f.app, intent('original'), prior);
    const row = rows(f.app, 'auto_drafts_requests')[0], changed = JSON.parse(String(row.data)); changed.acceptedSnapshot.value.followUpsEnabled = true; changed.receipt.snapshotFingerprint = await digest(stable(changed.acceptedSnapshot)); const data = JSON.stringify(changed);
    const integrity = await digest(stable({ protocol: 'auto-drafts-request-row-v1', id: row.id, accountId: row.account_id, section: row.section, key: row.client_key, fingerprint: row.fingerprint, data }));
    f.app.store.db.prepare('UPDATE auto_drafts_requests SET data=?,integrity=? WHERE id=?').run(data, integrity, accepted.receipt.id);
    assert.equal((await invoke(f.app, 'GET', '/api/auto-drafts/requests/by-request/original?accountId=a&section=preferences')).status, 500); assert.equal((await invoke(f.app, 'PATCH', '/api/auto-drafts/preferences', intent('original'))).status, 500); assert.equal((await invoke(f.app, 'GET', '/api/auto-drafts/settings?accountId=a')).status, 500);
    assert.equal((await settings(f.app, 'b')).preferences.revision, 0);
  } finally { await f.app.close(); }
});

test('corrupt accepted fingerprint stays unknown before both early and concurrent key conflict decisions', async () => {
  for (const concurrent of [false, true]) {
    const f = fixture(); try {
      const prior = (await settings(f.app)).preferences;
      await save(f.app, intent('donor'), prior);
      let outcome: Promise<unknown>;
      if (concurrent) {
        // Starts from a valid current snapshot and no matching key; inject the
        // corrupted row while the shared parser is awaiting its digest.
        outcome = f.app.autoDrafts.savePreferences(intent('arriving', 1, 'followUpsEnabled'));
        f.app.store.db.prepare('UPDATE auto_drafts_requests SET client_key=?,fingerprint=? WHERE client_key=?').run('arriving', 'f'.repeat(64), 'donor');
      } else {
        f.app.store.db.prepare('UPDATE auto_drafts_requests SET fingerprint=? WHERE client_key=?').run('f'.repeat(64), 'donor');
        outcome = f.app.autoDrafts.savePreferences(intent('donor'));
      }
      const before = f.app.store.db.prepare('SELECT total_changes() n').get()!.n;
      await assert.rejects(outcome, (e: any) => e.status === 500 && e.code === 'auto_drafts_artifact_corrupt');
      assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n, before);
      assert.deepEqual([rows(f.app,'auto_drafts_settings').length,rows(f.app,'auto_drafts_setting_commits').length,rows(f.app,'auto_drafts_requests').length,rows(f.app,'auto_drafts_request_proofs').length], [1,1,1,1]);
      assert.deepEqual(f.calls(), {modelCalls:0,providerCalls:0});
    } finally { await f.app.close(); }
  }
});

test('stored account identity mismatch refuses settings reads and both write domains without acceptance', async () => {
  const f = fixture(); try {
    f.app.store.db.prepare("UPDATE records SET data=? WHERE kind='account' AND id='a'").run(JSON.stringify({id:'b',provider:'demo',email:'b@example.test',name:'foreign',color:'#000'}));
    const baseline = f.app.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all();
    const before = f.app.store.db.prepare('SELECT total_changes() n').get()!.n;
    const scheduled: SaveRequest = {accountId:'a',clientRequestId:'foreign-schedule',expectedRevision:0,section:'teammate-scheduling',desired:{enabled:false,teammateId:null,prompt:''}};
    for(const [method,path,input] of [['GET','/api/auto-drafts/settings?accountId=a',undefined],['PATCH','/api/auto-drafts/preferences',intent('foreign')],['PUT','/api/auto-drafts/teammate-scheduling',scheduled]] as const){
      const r=await invoke(f.app,method,path,input);assert.equal(r.status,404);assert.equal(parseErrorResponse(r.body).error.code,'auto_drafts_account_unavailable');
    }
    assert.equal(f.app.store.db.prepare('SELECT total_changes() n').get()!.n,before);
    for(const table of ['auto_drafts_settings','auto_drafts_setting_commits','auto_drafts_requests','auto_drafts_request_proofs'])assert.deepEqual(rows(f.app,table),[]);
    assert.deepEqual(f.app.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),baseline);
    assert.equal((await settings(f.app,'b')).preferences.persisted,false);
    f.app.store.put('account','a',{id:'a',provider:'demo',email:'a@example.test',name:'a',color:'#000'});
    const good=await save(f.app,intent('restored'),(await settings(f.app)).preferences);assert.equal(good.receipt.accountId,'a');assert.equal(good.acceptedSnapshot.revision,1);
    assert.deepEqual(f.calls(),{modelCalls:0,providerCalls:0});
  } finally { await f.app.close(); }
});
