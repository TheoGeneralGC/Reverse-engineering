import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../api/src/store.ts';
import { createApp } from '../../api/src/server.ts';
import { KnowledgeService } from '../../api/src/knowledge.ts';
import { GoogleIngressAdapter } from '../../api/src/google-ingress.ts';
import { TrackingReadRepository } from '../../api/src/tracking-read-store.ts';
import { AiChatService } from '../../api/src/ai-chat.ts';

const originalFetch = globalThis.fetch; let attempts = 0;
globalThis.fetch = async () => { attempts++; throw new Error('Owner tests forbid native fetch'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(attempts, 0); });
const hosted = (registered: boolean, _fallback: () => boolean) => registered;

test('hosted composer ownership uses the registered nonce despite a foreign PID and refuses a foreign nonce despite a live PID', async () => {
  for (const remote of [false, true]) {
    const env = { DATABASE_PATH: ':memory:', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', TOKEN_ENCRYPTION_KEY: '1'.repeat(64),
      APPROVED_TEST_SENDERS: 'sender@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test' };
    const app = createApp({ databasePath: ':memory:', env, runJobs: false, providerDraftAutomatic: false, ...(remote ? { ownerLiveness: hosted } : {}) });
    try {
      app.store.put('account', 'fixture', { id: 'fixture', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
      app.store.put('googleGrant', 'mail:fixture', { accountId: 'fixture', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
      app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('fixture', 'synthetic-never-read-token');
      const draft = app.store.saveDraft({ accountId: 'fixture', to: 'recipient@example.test', subject: 'Synthetic owner', body: 'Fictional fixture' });
      const current = app.draftSend.current('fixture', draft.id);
      const operation = app.draftSend.submit(draft.id, { accountId: 'fixture', clientRequestId: 'owner-test', expectedDraftRevision: current.draftRevision,
        expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation }).snapshot.operation!;
      app.store.db.prepare('UPDATE draft_send_operations SET owner_pid=? WHERE id=?').run(process.ppid, operation.id);
      assert.equal(app.draftSend.ownsLiveDelivery(draft.id), true);
      app.store.db.prepare('UPDATE draft_send_operations SET owner=? WHERE id=?').run('foreign-runtime-owner', operation.id);
      assert.equal(app.draftSend.ownsLiveDelivery(draft.id), !remote);
      assert.equal(app.store.list('delivery').length, 0);
    } finally { await app.close(); }
  }
});

test('hosted Knowledge recovery overrides a misleading live PID but local injected liveness remains unchanged', async () => {
  for (const remote of [false, true]) {
    const store = new Store(':memory:', true, remote ? { ownerLiveness: hosted } : {});
    const initial = new KnowledgeService(store, { autoProcess: false, resume: false }); let next: KnowledgeService | undefined;
    try {
      const source = initial.upload('demo', 'synthetic-file', 'Fixture.txt', Buffer.from('Fictional Cedar facts.')).source;
      await initial.close();
      initial.repository.transaction(() => { initial.repository.save({ ...source, status: 'processing', revision: source.revision + 1 });
        store.db.prepare("UPDATE knowledge_jobs SET state='processing',owner=?,owner_pid=? WHERE source_id=?").run('foreign-runtime-owner', process.ppid, source.id); });
      next = new KnowledgeService(store, { autoProcess: false, resume: false, ownerAlive: () => true });
      const job = store.db.prepare('SELECT state,owner,owner_pid FROM knowledge_jobs WHERE source_id=?').get(source.id)!;
      assert.equal(job.state, remote ? 'queued' : 'processing');
      assert.equal(next.repository.get('demo', source.id).status, remote ? 'pending' : 'processing');
      assert.equal(job.owner, remote ? null : 'foreign-runtime-owner');
    } finally { await next?.close(); await initial.close(); store.close(); }
  }
});

test('hosted Gmail ingress keeps its own live lease but ignores an unrelated former actor PID', () => {
  for (const remote of [false, true]) {
    const store = new Store(':memory:', false, remote ? { ownerLiveness: hosted } : {});
    store.put('account', 'fixture', { id: 'fixture', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
    const adapter = new GoogleIngressAdapter(store, { accountVersion: () => 'a'.repeat(64), now: () => 100_000, ownerAlive: () => true });
    try {
      const first = adapter.begin('fixture'); assert.throws(() => adapter.begin('fixture'), { code: 'google_ingress_busy' });
      store.db.prepare('UPDATE google_ingress_meta SET owner=?,pid=? WHERE account_id=?').run('foreign-runtime-owner', process.ppid, 'fixture');
      if (remote) { const next = adapter.begin('fixture'); assert.equal(next.epoch, first.epoch + 1); assert.throws(() => adapter.assert(first)); adapter.assert(next); }
      else assert.throws(() => adapter.begin('fixture'), { code: 'google_ingress_busy' });
    } finally { adapter.close(); store.close(); }
  }
});

test('hosted tracking read ownership follows local service registration and is released on close', () => {
  const store = new Store(':memory:', true, { ownerLiveness: hosted }); const repository = new TrackingReadRepository(store);
  try {
    assert.equal(repository.live({ owner: repository.owner, owner_pid: process.ppid }), true);
    assert.equal(repository.live({ owner: 'foreign-runtime-owner', owner_pid: process.pid }), false);
    repository.close(); assert.equal(repository.live({ owner: repository.owner, owner_pid: process.pid }), false);
  } finally { repository.close(); store.close(); }
});

test('hosted Ask AI startup recovery ignores unrelated prior PID without redispatch while local liveness stays conservative', async () => {
  for (const remote of [false, true]) {
    const store = new Store(':memory:', true, remote ? { ownerLiveness: hosted } : {});
    const env = { DATABASE_PATH: ':memory:', ANTHROPIC_API_KEY: 'synthetic-key', ANTHROPIC_MODEL: 'synthetic-model' };
    const first = new AiChatService(store, env, globalThis.fetch, { autoRun: false }); let next: AiChatService | undefined;
    try {
      const session = first.createSession('demo');
      const accepted = first.submit(session.id, { accountId: 'demo', clientRequestId: 'stored-turn', expectedRevision: session.revision, prompt: 'Fictional Cedar question.', context: { resources: [] } });
      const row = store.db.prepare('SELECT data FROM ai_turns WHERE id=?').get(accepted.turn.id)!;
      await first.close();
      store.db.prepare("UPDATE ai_turns SET state='queued',owner_pid=?,data=? WHERE id=?").run(process.ppid, row.data, accepted.turn.id);
      next = new AiChatService(store, env, globalThis.fetch, { autoRun: false, ownerAlive: () => store.ownerLiveness(false, () => true) });
      const turn = next.turn('demo', session.id, accepted.turn.id).turn;
      assert.equal(turn.state, remote ? 'interrupted' : 'queued'); assert.equal(turn.dispatchCount, 0);
    } finally { await next?.close(); await first.close(); store.close(); }
  }
});
