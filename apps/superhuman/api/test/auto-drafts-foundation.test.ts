import { DatabaseSync } from 'node:sqlite';
import {syntheticFullThread} from './reminder-projection-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { AutoDraftFoundation, type FoundationBasis } from '../src/auto-drafts-foundation.ts';
import { threadInputVersion } from '../src/auto-drafts-mutation-guard.ts';
import { GoogleProvider } from '../src/google.ts';
import { DraftSendService } from '../src/draft-send.ts';
import { ProviderDraftService } from '../src/provider-drafts.ts';
import { createApp } from '../src/server.ts';
import { citationAnswer } from '../src/ai-citations.ts';
import type { ProviderDraftTransport } from '../src/provider-draft-transport.ts';
import type { Draft, Thread } from '../src/types.ts';
import type { IngressVersion } from '../src/auto-drafts-generation-contract.ts';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const h = 'a'.repeat(64), b = 'b'.repeat(64);
function fixture(path = ':memory:') {
  let now = Date.parse('2026-10-29T15:00:00.000Z'); const store = new Store(path, false);
  store.put('account', 'a', { id: 'a', provider: 'google', email: 'self@example.test', name: 'Synthetic', color: '#000' });
  store.put('account', 'b', { id: 'b', provider: 'google', email: 'other@example.test', name: 'Other', color: '#000' });
  const engine = new AutoDraftFoundation(store, () => now);
  const thread: Thread = { id: 'thread-a', accountId: 'a', providerId: 'provider-thread', subject: 'Synthetic source', snippet: 'Fictional', sender: { name: 'Sender', email: 'recipient@example.test' }, participants: [], lastMessageAt: new Date(now).toISOString(), unread: true, starred: false, important: true, folder: 'inbox', labels: [], messages: [{ id: 'message-1', sender: { name: 'Sender', email: 'recipient@example.test' }, to: [{ name: 'Self', email: 'self@example.test' }], date: new Date(now).toISOString(), text: 'One fictional question.', attachments: [] }] };
  const sourceRef = randomUUID(), threadRef = randomUUID();
  function ingress(sequence = 1, overrides: Partial<IngressVersion> = {}): IngressVersion { return { version: 1, id: randomUUID(), accountId: 'a', accountVersion: h, sequence, sourceRef, inputVersion: h, providerInternalDate: new Date(now).toISOString(), committedAt: new Date(now).toISOString(), origin: 'google-live-history-message-added', history: { entryId: String(10 + sequence), afterCursor: '10', throughCursor: '100', addedSourceRefs: [overrides.sourceRef ?? sourceRef] }, baselineVersion: h, immutableFactsHash: h, ...overrides }; }
  function basis(input: IngressVersion): FoundationBasis { return { accountId: 'a', activationId: randomUUID(), activationEpoch: 1, preferences: { settingsId: randomUUID(), revision: 1, fingerprint: h }, accountVersion: h, configurationVersion: h, sourceRef: input.sourceRef, inputVersion: input.inputVersion, threadId: thread.id, target: engine.guard.capture('a', thread.id, { threadRef, threadInputVersion: threadInputVersion(store.required('thread', thread.id)), replyMetadataVersion: h, sourceFactsVersion: h }) }; }
  function job() { const input = ingress(); engine.commitIngress(thread, input); const frozen = basis(input), generation = engine.admit(input.id, frozen); return { input, frozen, generation }; }
  function draft(extra: Partial<Draft> = {}) { return store.saveDraft({ accountId: 'a', threadId: thread.id, to: 'recipient@example.test', subject: 'Synthetic reply', body: 'Fictional reply.', ...extra }); }
  return { store, engine, thread, ingress, basis, job, draft, now: () => now, advance(ms: number) { now += ms; }, reset(value: number) { now = value; }, close() { engine.close(); store.close(); } };
}
const code = (value: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === value;

test('manual create/remove ABA and every identical authored/attachment write advance durable absence basis', () => {
  const f = fixture(); try {
    f.store.put('thread', f.thread.id, f.thread); const initial = f.engine.guard.capture('a', f.thread.id, { threadRef: randomUUID(), threadInputVersion: threadInputVersion(f.thread), replyMetadataVersion: h, sourceFactsVersion: h });
    const d = f.draft(), v = f.engine.guard.version('a', f.thread.id); f.store.saveDraft({ id: d.id, body: d.body }); assert.equal(f.engine.guard.version('a', f.thread.id), v + 1);
    const added = f.store.addAttachment(d.id, { name: 'fictional.txt', mimeType: 'text/plain', data: Buffer.from('65 byte-independent fictional fixture').toString('base64') }); f.store.removeAttachment(d.id, added.attachment.id);
    f.store.deleteDraft(d.id); assert.equal(f.engine.guard.guard('a', d.id)!.fence, 'removed'); assert(f.engine.guard.version('a', f.thread.id) > initial.threadDraftSetVersion);
    assert.throws(() => f.engine.guard.assertBasis('a', f.thread.id, initial), code('auto_draft_generation_basis_conflict'));
  } finally { f.close(); }
});

test('later write/remove hook failures roll back guard versions, bytes and deletion atomically', () => {
  const f = fixture(); try {
    f.store.put('thread', f.thread.id, f.thread); const d = f.draft(), before = f.engine.guard.guard('a', d.id), version = f.engine.guard.version('a', f.thread.id);
    const stop = f.store.registerDraftLifecycleHooks({ written() { throw Error('Controlled later hook refusal'); } });
    assert.throws(() => f.store.addAttachment(d.id, { name: 'test.txt', mimeType: 'text/plain', data: 'eA==' })); assert.deepEqual(f.engine.guard.guard('a', d.id), before); assert.equal(f.engine.guard.version('a', f.thread.id), version); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM draft_attachments').get()!.n, 0); stop();
    const removeStop = f.store.registerDraftLifecycleHooks({ beforeRemove() { throw Error('Controlled later removal refusal'); } }); assert.throws(() => f.store.deleteDraft(d.id)); assert.deepEqual(f.engine.guard.guard('a', d.id), before); assert.deepEqual(f.store.required('draft', d.id), JSON.parse(JSON.stringify(d))); removeStop();
  } finally { f.close(); }
});

test('account/thread moves fence both prior and new associations without erasing history', () => {
  const f = fixture(); try { f.store.put('thread', f.thread.id, f.thread); const d = f.draft(), a = f.engine.guard.version('a', f.thread.id); f.store.saveDraft({ id: d.id, accountId: 'b', threadId: 'other-thread' }); assert.equal(f.engine.guard.version('a', f.thread.id), a + 1); assert.equal(f.engine.guard.version('b', 'other-thread'), 1); assert.equal(f.engine.guard.guard('a', d.id), null); assert.equal(f.engine.guard.guard('b', d.id)!.version, 2); } finally { f.close(); }
});

test('actual keyed immediate and scheduled acceptance/Undo use composed delivery-written guards', async () => {
  const f = fixture(), google = new GoogleProvider(f.store, { DATABASE_PATH: ':memory:', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', TOKEN_ENCRYPTION_KEY: '1'.repeat(64), APPROVED_TEST_SENDERS: 'self@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test' });
  google.fetcher = async () => { throw Error('Provider forbidden'); };
  f.store.put('googleGrant', 'mail:a', { accountId: 'a', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] }); f.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('a', 'synthetic-never-read-token');
  const service = new DraftSendService(f.store, google, f.now, undefined, { schedule: () => ({ cancel() {} }) });
  try {
    f.store.put('thread', f.thread.id, syntheticFullThread(f.store,f.thread));
    for (const scheduled of [false, true]) {
      const d = f.draft(), snapshot = service.current('a', d.id), before = f.engine.guard.version('a', f.thread.id);
      const accepted = service.submit(d.id, { accountId: 'a', clientRequestId: randomUUID(), expectedDraftRevision: snapshot.draftRevision, expectedContentHash: snapshot.contentHash, expectedGeneration: snapshot.eligibility.generation, ...(scheduled ? { scheduledAt: new Date(f.now() + 60_000).toISOString() } : {}) });
      assert.equal(f.engine.guard.version('a', f.thread.id), before + 1); assert.equal(f.engine.guard.guard('a', d.id)!.fence, 'delivery-owned');
      const op = accepted.snapshot.operation!; service.cancel(op.id, { accountId: 'a', clientRequestId: randomUUID(), expectedRevision: op.revision }); assert.equal(f.store.required<Draft>('draft', d.id).status, 'draft'); assert.equal(f.engine.guard.guard('a', d.id)!.fence, 'delivery-owned');
    }
  } finally { await service.close(); f.close(); }
});

test('keyless schedule/cancel and sending/unknown/confirmed Sent preserve fence but Sent history alone allows later input', () => {
  const f = fixture(); try { f.store.put('thread', f.thread.id, f.thread); const d = f.draft(); f.store.saveDraft({ id: d.id, status: 'scheduled', scheduledAt: new Date(f.now() + 60_000).toISOString() }); f.store.saveDraft({ id: d.id, status: 'draft', scheduledAt: undefined }); assert.equal(f.engine.guard.guard('a', d.id)!.fence, 'delivery-owned'); f.store.beginDelivery(d.id); f.store.unknownDelivery(d.id, 'Controlled uncertainty'); assert.throws(() => f.engine.guard.assertNoCurrentDraft('a', f.thread.id)); f.store.completeDelivery(d.id, 'synthetic-ack'); assert.doesNotThrow(() => f.engine.guard.assertNoCurrentDraft('a', f.thread.id)); assert.equal(f.engine.guard.guard('a', d.id)!.fence, 'delivery-owned'); } finally { f.close(); }
});

test('accepted mapped discard fences immediately and replay does not re-observe; rollback preserves provider locks', async () => {
  const f = fixture(), calls = { native: 0 }; const denied = async (): Promise<never> => { calls.native++; throw Error('Provider forbidden'); };
  const transport: ProviderDraftTransport = { ready() {}, profile: denied, create: denied, update: denied, get: denied, list: denied, metadata: denied, delete: denied };
  const service = new ProviderDraftService(f.store, transport, { automatic: false, resume: false, clock: { now: f.now, schedule: () => ({ cancel() {} }) } });
  try {
    f.store.put('thread', f.thread.id, f.thread); const d = f.store.saveDraft({ accountId: 'a', threadId: f.thread.id, body: 'Synthetic mapped fixture' }, 'composer'), link = service.repository.link('a', d.id)!;
    // Controlled persisted mapped fixture; no remote transport creates this mapping.
    service.repository.transaction(() => { service.repository.saveLink({ ...link, providerDraftId: 'synthetic-cloud', providerMessageId: 'synthetic-message', state: 'queued' }); f.store.db.prepare("UPDATE records SET data=json_set(data,'$.providerDraftId','synthetic-cloud') WHERE kind='draft' AND id=?").run(d.id); });
    const request = { accountId: 'a', clientRequestId: randomUUID(), expectedDraftRevision: d.revision!, expectedContentHash: link.desiredHash!, expectedSyncRevision: service.status('a', d.id).revision };
    const before = f.engine.guard.version('a', f.thread.id), stop = f.store.registerDraftLifecycleHooks({ acceptedIntent() { throw Error('Controlled intent rollback'); } }); assert.throws(() => service.discard(d.id, request)); assert.equal(f.engine.guard.version('a', f.thread.id), before); assert.equal(service.repository.link('a', d.id)!.discardId, null); stop();
    const accepted = service.discard(d.id, request); assert.equal(accepted.response.resolution, 'pending'); assert.equal(f.engine.guard.guard('a', d.id)!.fence, 'discard-intent'); assert.equal(f.engine.guard.version('a', f.thread.id), before + 1); service.discard(d.id, request); assert.equal(f.engine.guard.version('a', f.thread.id), before + 1); assert.equal(calls.native, 0);
  } finally { await service.close(); f.close(); }
});

test('Thread/projections/outbox commit atomically, duplicate occurrence updates Mail without another source identity', () => {
  const f = fixture(); try { const input = f.ingress(); f.store.db.exec("CREATE TEMP TRIGGER deny_ingress BEFORE INSERT ON auto_draft_ingress BEGIN SELECT RAISE(ABORT,'controlled'); END"); assert.throws(() => f.engine.commitIngress(f.thread, input)); assert.equal(f.store.get('thread', f.thread.id), undefined); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auto_draft_ingress_proofs').get()!.n, 0); f.store.db.exec('DROP TRIGGER deny_ingress'); f.engine.commitIngress(f.thread, input); const repeated = f.engine.commitIngress({ ...f.thread, unread: false }, { ...input, id: randomUUID(), sequence: 2 }); assert.equal(repeated.id, input.id); assert.equal(f.store.required<Thread>('thread', f.thread.id).unread, false); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auto_draft_ingress').get()!.n, 1);f.store.put('thread','foreign-thread',{...f.thread,id:'foreign-thread',accountId:'b'});assert.throws(()=>f.engine.commitIngress({...f.thread,id:'foreign-thread'},f.ingress(2,{sourceRef:randomUUID()})));assert.equal(f.store.required<Thread>('thread','foreign-thread').accountId,'b'); } finally { f.close(); }
});

test('one source version admits once; initial/repair cannot admit and a new activation cannot replay old input', () => {
  const f = fixture(); try { const j = f.job(); assert.equal(f.engine.admit(j.input.id, j.frozen).id, j.generation.id); assert.throws(() => f.engine.admit(j.input.id, { ...j.frozen, activationId: randomUUID() }), code('auto_draft_generation_request_conflict')); const other = f.ingress(2, { inputVersion: b, origin: 'repair-import' }); f.engine.commitIngress(f.thread, other); assert.throws(() => f.engine.admit(other.id, f.basis(other))); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auto_draft_jobs').get()!.n, 1); } finally { f.close(); }
});

test('held absence is defeated by manual create/discard ABA and by newer different-source input', () => {
  const f = fixture(); try { const j = f.job(), claim = f.engine.claim('a', j.generation.id, 1), d = f.draft(); f.store.deleteDraft(d.id); assert.throws(() => f.engine.issue('a', j.generation.id, claim.leaseId!, '{}')); assert.equal(f.engine.job('a', j.generation.id).attempt, null); } finally { f.close(); }
  const g = fixture(); try { const j = g.job(), claim = g.engine.claim('a', j.generation.id, 1), input = g.ingress(2, { sourceRef: randomUUID(), inputVersion: b }); g.engine.commitIngress({ ...g.thread, subject: 'New fictional fact' }, input); assert.throws(() => g.engine.issue('a', j.generation.id, claim.leaseId!, '{}')); } finally { g.close(); }
});

test('two independent SQLite owners fence stale leases; unissued recovers but issued becomes permanently unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-draft-foundation-')), path = join(dir, 'synthetic.sqlite'), f = fixture(path), secondStore = new Store(path, false), second = new AutoDraftFoundation(secondStore, f.now);
  try { const j = f.job(), a = f.engine.claim('a', j.generation.id, 1); assert.throws(() => second.claim('a', j.generation.id, 1)); assert.equal(second.recover(() => false), 1); assert.throws(() => f.engine.issue('a', j.generation.id, a.leaseId!, '{}')); const current = second.job('a', j.generation.id), fresh = second.claim('a', current.id, current.revision), issued = second.issue('a', current.id, fresh.leaseId!, '{"synthetic":true}'); assert(issued.attempt); f.engine.recover(() => false); assert.equal(f.engine.job('a', current.id).state, 'model-outcome-unknown'); assert.throws(() => second.issue('a', current.id, fresh.leaseId!, '{}')); assert.throws(() => second.terminal('a', current.id, fresh.leaseId!, 'no-draft', h)); assert.deepEqual(f.engine.history('a', current.id).map(x => x.state), ['queued', 'claimed', 'queued', 'claimed', 'dispatch-issued', 'model-outcome-unknown']); } finally { second.close(); secondStore.close(); f.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('terminal proof/replay and local GET history are immutable and read-only', () => {
  const f = fixture(); try { const j = f.job(), lease = f.engine.claim('a', j.generation.id, 1); f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'); const done = f.engine.terminal('a', j.generation.id, lease.leaseId!, 'no-draft', h); assert.deepEqual(f.engine.terminal('a', j.generation.id, lease.leaseId!, 'no-draft', h), done); assert.throws(() => f.engine.terminal('a', j.generation.id, lease.leaseId!, 'no-draft', b)); const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n; f.engine.job('a', j.generation.id); f.engine.history('a', j.generation.id); assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get()!.n, changes); } finally { f.close(); }
});

test('partial acceptance/request corruption cannot substitute a new target or issued wire identity', () => {
  const f = fixture(); try { const j = f.job(); const row = f.store.db.prepare('SELECT data FROM auto_draft_job_acceptance WHERE id=?').get(j.generation.id)!, changed = JSON.parse(String(row.data)); changed.basis.target.threadDraftSetVersion++; f.store.db.prepare('UPDATE auto_draft_job_acceptance SET data=?,integrity=? WHERE id=?').run(JSON.stringify(changed), sha(changed), j.generation.id); assert.throws(() => f.engine.job('a', j.generation.id), code('auto_draft_generation_corrupt')); f.store.db.prepare('UPDATE auto_draft_job_acceptance SET data=?,integrity=? WHERE id=?').run(String(row.data), sha(JSON.parse(String(row.data))), j.generation.id); const lease = f.engine.claim('a', j.generation.id, 1); f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'); f.store.db.prepare('UPDATE auto_draft_jobs SET request_utf8=? WHERE id=?').run('{"substituted":true}', j.generation.id); assert.throws(() => f.engine.job('a', j.generation.id), code('auto_draft_generation_corrupt')); f.store.db.prepare('UPDATE auto_draft_jobs SET request_utf8=? WHERE id=?').run('{}', j.generation.id); } finally { f.close(); }
});

test('account deletion, clock rollback and close fence new issue without transport or flags', () => {
  const f = fixture(); try { const j = f.job(), lease = f.engine.claim('a', j.generation.id, 1); f.store.put('account','a',{id:'a',provider:'google',email:'changed@example.test'});assert.throws(()=>f.engine.issue('a',j.generation.id,lease.leaseId!,'{}'),code('auto_draft_generation_basis_conflict'));f.store.remove('account', 'a'); assert.throws(() => f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'), code('auto_draft_generation_not_found')); f.store.put('account', 'a', { id: 'a', provider: 'google', email: 'self@example.test' }); f.advance(-1); assert.throws(() => f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'), code('auto_draft_generation_corrupt')); f.advance(1); f.engine.close(); assert.throws(() => f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'), code('auto_draft_generation_stopping')); assert.equal(f.engine.job('a', j.generation.id).attempt, null); } finally { f.close(); }
});

test('actual artifact acceptance and Undo preserve guard through private delivery-write bypass without model/provider work', async () => {
  let calls = 0; const denied = async (): Promise<never> => { calls++; throw Error('All model/provider calls forbidden'); }, stamp = Date.parse('2026-10-29T15:00:00.000Z');
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', TOKEN_ENCRYPTION_KEY: '1'.repeat(64), APPROVED_TEST_SENDERS: 'self@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test' }, runJobs: false, providerDraftAutomatic: false, aiFetch: denied, scheduler: { now: () => stamp, schedule: () => ({ cancel() {} }) } });
  const foundation = new AutoDraftFoundation(app.store, () => stamp); app.google.fetcher = denied;
  try {
    app.store.put('account', 'a', { id: 'a', provider: 'google', email: 'self@example.test', name: 'Synthetic', color: '#000' }); app.store.put('googleGrant', 'mail:a', { accountId: 'a', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] }); app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('a', 'synthetic-never-read-token');
    const session = app.aiChat.createSession('a'), turn = app.aiChat.repository.accept(session.id, { accountId: 'a', clientRequestId: randomUUID(), expectedRevision: 0, prompt: 'Fictional fixture', context: { resources: [] } }, 'synthetic').turn;
    app.aiChat.repository.update(turn.id, t => { t.state = 'running'; }); const preview = app.aiChat.drafts.propose(turn.id, { to: [{ email: 'recipient@example.test' }], subject: 'Fictional artifact', body: 'One fictional reply.' });
    app.aiChat.repository.update(turn.id, t => { t.state = 'completed'; t.answer = citationAnswer('Ready.', [], false); t.previews = [preview]; }, [], false, t => app.aiChat.drafts.commitPreview(t, preview));
    const scope = { accountId: 'a', sessionId: session.id, turnId: turn.id }, op = app.aiSend.submit(preview.id, { ...scope, clientRequestId: randomUUID(), expectedGeneration: 0, expectedPreviewHash: preview.payloadHash }).snapshot.operation!;
    assert.equal(foundation.guard.guard('a', op.draftId)!.fence, 'delivery-owned'); const before = foundation.guard.guard('a', op.draftId)!.version;
    app.aiSend.cancel(op.id, { ...scope, clientRequestId: randomUUID(), expectedRevision: op.revision }); assert.equal(foundation.guard.guard('a', op.draftId)!.version, before + 1); assert.equal(foundation.guard.guard('a', op.draftId)!.fence, 'delivery-owned'); assert.equal(calls, 0);
  } finally { foundation.close(); await app.close(); }
});

test('durable account active-slot and queue limits; unissued terminal cleanup does not authorize replay', () => {
  const f = fixture(); try {
    const first = f.job(), lease = f.engine.claim('a', first.generation.id, 1);
    const secondInput = f.ingress(2, { sourceRef: randomUUID() }); f.engine.commitIngress(f.thread, secondInput); const second = f.engine.admit(secondInput.id, f.basis(secondInput));
    assert.throws(() => f.engine.claim('a', second.id, 1), code('auto_draft_generation_unavailable'));
    f.engine.stopUnissued('a', second.id, 1, 'superseded', 'source-not-current'); assert.throws(() => f.engine.claim('a', second.id, 2));
    f.advance(90_001); f.engine.recover(() => true); assert.equal(f.engine.job('a', first.generation.id).state, 'superseded'); assert.throws(() => f.engine.issue('a', first.generation.id, lease.leaseId!, '{}'));
    for (let index = 0; index < 32; index++) { const input = f.ingress(index + 3, { sourceRef: randomUUID() }); f.engine.commitIngress(f.thread, input); f.engine.admit(input.id, f.basis(input)); }
    const extra = f.ingress(35, { sourceRef: randomUUID() }); f.engine.commitIngress(f.thread, extra); assert.throws(() => f.engine.admit(extra.id, f.basis(extra)), code('auto_draft_generation_unavailable'));
  } finally { f.close(); }
});

test('issued deadline becomes unknown even for live owner; lost current job cannot allocate another source-version job', () => {
  const f = fixture(); try { const j = f.job(), lease = f.engine.claim('a', j.generation.id, 1); f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'); f.advance(60_000); assert.throws(() => f.engine.terminal('a', j.generation.id, lease.leaseId!, 'no-draft', h)); f.engine.recover(() => true); assert.equal(f.engine.job('a', j.generation.id).state, 'model-outcome-unknown'); const row = f.store.db.prepare('SELECT * FROM auto_draft_jobs WHERE id=?').get(j.generation.id)!; f.store.db.prepare('DELETE FROM auto_draft_jobs WHERE id=?').run(j.generation.id); assert.throws(() => f.engine.admit(j.input.id, j.frozen), code('auto_draft_generation_corrupt')); f.store.db.prepare('INSERT INTO auto_draft_jobs VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.id!, row.account_id!, row.account_version!, row.source_ref!, row.input_version!, row.revision!, row.owner_pid!, row.request_utf8!, row.proof!, row.integrity!); } finally { f.close(); }
});

test('history completeness and final pre-COMMIT clock fence refuse partial publication', () => {
  const f = fixture(); try {
    const j = f.job(), lease = f.engine.claim('a', j.generation.id, 1);
    const event = f.store.db.prepare('SELECT * FROM auto_draft_job_events WHERE job_id=? AND revision=1').get(j.generation.id)!; f.store.db.prepare('DELETE FROM auto_draft_job_events WHERE job_id=? AND revision=1').run(j.generation.id); assert.throws(() => f.engine.history('a', j.generation.id), code('auto_draft_generation_corrupt')); f.store.db.prepare('INSERT INTO auto_draft_job_events VALUES(?,?,?,?)').run(event.job_id!, event.revision!, event.data!, event.integrity!);
    assert.ok(f.store.db instanceof DatabaseSync); f.store.db.function('controlled_clock_rewind', () => { f.advance(-1); return 0; }); f.store.db.exec("CREATE TEMP TRIGGER rewind_issue BEFORE UPDATE ON auto_draft_jobs WHEN json_extract(NEW.proof,'$.generation.state')='dispatch-issued' BEGIN SELECT controlled_clock_rewind(); END");
    assert.throws(() => f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'), code('auto_draft_generation_corrupt')); assert.equal(f.engine.job('a', j.generation.id).state, 'claimed'); assert.equal(f.store.db.prepare('SELECT request_utf8 FROM auto_draft_jobs WHERE id=?').get(j.generation.id)!.request_utf8, null); f.advance(1); f.store.db.exec('DROP TRIGGER rewind_issue');
  } finally { f.close(); }
});

test('MAX safe draft-set version refuses mutation atomically instead of wrapping', () => {
  const f = fixture(); try { f.store.put('thread', f.thread.id, f.thread); const d = f.draft(), before = f.engine.guard.guard('a', d.id); f.store.db.prepare('UPDATE auto_draft_thread_versions SET version=? WHERE account_id=? AND thread_id=?').run(Number.MAX_SAFE_INTEGER, 'a', f.thread.id); assert.throws(() => f.store.saveDraft({ id: d.id, body: 'Must not be accepted' }), code('auto_draft_generation_basis_conflict')); assert.equal(f.store.required<Draft>('draft', d.id).body, d.body); assert.deepEqual(f.engine.guard.guard('a', d.id), before); assert.equal(f.engine.guard.version('a', f.thread.id), Number.MAX_SAFE_INTEGER); } finally { f.close(); }
});

test('rehashed historical state and timestamp contradictions refuse against the complete lineage', () => {
  const f = fixture(); try {
    const j = f.job(); f.advance(1000); const lease = f.engine.claim('a', j.generation.id, 1); f.advance(1000); f.engine.issue('a', j.generation.id, lease.leaseId!, '{}'); f.advance(1000); f.engine.terminal('a', j.generation.id, lease.leaseId!, 'no-draft', h);
    const row = f.store.db.prepare('SELECT data,integrity FROM auto_draft_job_events WHERE job_id=? AND revision=2').get(j.generation.id)!;
    for (const change of [(value: any) => { value.generation.state = 'queued'; }, (value: any) => { value.generation.updatedAt = new Date(f.now() - 500).toISOString(); }]) {
      const value = JSON.parse(String(row.data)); change(value); f.store.db.prepare('UPDATE auto_draft_job_events SET data=?,integrity=? WHERE job_id=? AND revision=2').run(JSON.stringify(value), sha(value), j.generation.id);
      assert.throws(() => f.engine.history('a', j.generation.id), code('auto_draft_generation_corrupt'));
      f.store.db.prepare('UPDATE auto_draft_job_events SET data=?,integrity=? WHERE job_id=? AND revision=2').run(row.data!, row.integrity!, j.generation.id);
    }
    assert.equal(f.engine.history('a', j.generation.id).length, 4);
  } finally { f.close(); }
});
