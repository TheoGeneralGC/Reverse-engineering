import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Store } from '../src/store.ts';
import { KnowledgeService } from '../src/knowledge.ts';
import { KnowledgeRepository } from '../src/knowledge-store.ts';
import { knowledgeActionFingerprint } from '../src/knowledge-actions.ts';
import { HttpError } from '../src/types.ts';
import { createApp } from '../src/server.ts';
import type { KnowledgeExtraction } from '../src/knowledge-types.ts';

function fixture(path = ':memory:', fail = false) {
  const store = new Store(path, false); let extractions = 0, fetches = 0;
  for (const id of ['a', 'b']) if (!store.get('account', id)) store.put('account', id, { id, provider: 'demo', email: id + '@example.test', name: 'Synthetic ' + id, color: '#000' });
  const service = new KnowledgeService(store, { autoProcess: false, resume: false,
    extract: async bytes => { extractions++; if (fail) throw new HttpError(422, 'Synthetic malformed document', 'knowledge_invalid_pdf'); return { text: bytes.toString(), parser: 'synthetic', truncated: false, warnings: [] } satisfies KnowledgeExtraction; },
    fetchLink: async () => { fetches++; throw Error('No source network access allowed'); },
  });
  return { store, service, repo: service.repository, calls: () => ({ extractions, fetches }), close: async () => { await service.close(); store.close(); } };
}
const changes = (store: Store) => store.db.prepare('SELECT total_changes() AS n').get()!.n;
const count = (store: Store, table: string) => store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n;

test('lost upload acknowledgement recovers a deleted target without a new source, job, retry or retargeted key', async () => {
  const f = fixture();
  try {
    const bytes = Buffer.from('Fictional Cedar has three samples.'), source = f.service.upload('a', 'owned-key', 'Cedar.txt', bytes).source;
    const accepted = f.repo.actionByRequest('a', 'owned-key');
    assert.equal(accepted.receipt.provenance, 'accepted');
    assert.deepEqual(accepted.receipt.request, { kind: 'file', name: 'Cedar.txt', sha256: source.file!.sha256, bytes: bytes.length });
    assert.equal(accepted.receipt.fingerprint, knowledgeActionFingerprint(accepted.receipt.request!));
    assert.equal(accepted.receipt.acceptedContentVersion, source.contentVersion);
    f.repo.remove('a', source.id, source.revision);
    const before = changes(f.store), gone = f.repo.actionByRequest('a', 'owned-key');
    assert.deepEqual(gone.receipt, accepted.receipt);
    assert.deepEqual(gone.resolution, { availability: 'deleted', sourceId: null, currentContentVersion: null });
    assert.equal(gone.source, null);
    assert.equal(changes(f.store), before, 'A recovery GET is read-only');
    assert.throws(() => f.service.upload('a', 'owned-key', 'Cedar.txt', bytes), { code: 'knowledge_action_unavailable' });
    assert.throws(() => f.service.upload('a', 'owned-key', 'Changed.txt', bytes), { code: 'knowledge_request_conflict' });
    assert.deepEqual(f.calls(), { extractions: 0, fetches: 0 });
    assert.equal(count(f.store, 'knowledge_sources'), 1);
    assert.equal(count(f.store, 'knowledge_jobs'), 1);
    const replacement = f.service.upload('a', 'new-explicit-key', 'Cedar.txt', bytes).source;
    assert.notEqual(replacement.id, source.id);
    assert.equal(f.repo.actionByRequest('a', 'owned-key').receipt.sourceId, source.id);
    assert.equal(f.repo.actionByRequest('a', 'owned-key').source, null);
    assert.equal(f.repo.actionByRequest('a', 'new-explicit-key').source!.id, replacement.id);
  } finally { await f.close(); }
});

test('retry and link receipts preserve accepted request/version through later edits, retries and deletion', async () => {
  const f = fixture(':memory:', true);
  try {
    const source = f.service.upload('a', 'upload', 'Cedar.pdf', Buffer.from('%PDF-synthetic')).source;
    await f.service.runJobs();
    const failed = f.repo.get('a', source.id), retried = f.service.retry('a', source.id, 'retry-one', failed.revision).source;
    const first = f.repo.actionByRequest('a', 'retry-one');
    assert.deepEqual(first.receipt.request, { kind: 'retry', sourceId: source.id, expectedRevision: failed.revision });
    assert.equal(first.receipt.acceptedContentVersion, retried.contentVersion);
    await f.service.runJobs();
    const failedAgain = f.repo.get('a', source.id), second = f.service.retry('a', source.id, 'retry-two', failedAgain.revision).source;
    const edited = f.repo.edit('a', source.id, second.revision, { name: 'Human title', description: 'Human description' });
    const current = f.repo.actionByRequest('a', 'retry-one');
    assert.deepEqual(current.receipt, first.receipt);
    assert.equal(current.source!.name, 'Human title');
    assert.equal(current.resolution.currentContentVersion, second.contentVersion);
    assert.notEqual(current.resolution.currentContentVersion, first.receipt.acceptedContentVersion);
    f.repo.remove('a', source.id, edited.revision);
    assert.throws(() => f.service.retry('a', source.id, 'retry-one', failed.revision), { code: 'knowledge_action_unavailable' });
    assert.deepEqual(f.repo.actionByRequest('a', 'retry-one').receipt, first.receipt);
    const link = f.service.addLink('a', 'link-key', 'https://example.com/cedar#fragment').source;
    const linkAction = f.repo.actionByRequest('a', 'link-key');
    assert.deepEqual(linkAction.receipt.request, { kind: 'link', url: 'https://example.com/cedar' });
    f.repo.remove('a', link.id, link.revision);
    assert.equal(f.repo.actionByRequest('a', 'link-key').resolution.availability, 'deleted');
    assert.deepEqual(f.calls(), { extractions: 2, fetches: 0 });
  } finally { await f.close(); }
});

test('account/key filters precede foreign JSON parsing and moved source metadata is unavailable', async () => {
  const f = fixture(), original = JSON.parse;
  let foreignParses = 0;
  try {
    const own = f.service.upload('a', 'same-key', 'PRIVATE_A_SENTINEL.txt', Buffer.from('Cedar private a')).source;
    JSON.parse = ((text: string, ...rest: any[]) => { if (text.includes('PRIVATE_A_SENTINEL')) { foreignParses++; throw Error('Foreign metadata parsed'); } return (original as any)(text, ...rest); }) as typeof JSON.parse;
    assert.throws(() => f.repo.actionByRequest('b', 'same-key'), { status: 404 });
    assert.equal(foreignParses, 0);
    JSON.parse = original;
    const peer = f.service.upload('b', 'same-key', 'Peer.txt', Buffer.from('Peer')).source;
    assert.notEqual(f.repo.actionByRequest('b', 'same-key').receipt.sourceId, own.id);
    assert.equal(f.repo.actionByRequest('b', 'same-key').receipt.sourceId, peer.id);
    f.store.db.prepare('UPDATE knowledge_sources SET account_id=?,data=? WHERE id=?').run('b', 'FOREIGN_MOVED_METADATA', own.id);
    const action = f.repo.actionByRequest('a', 'same-key');
    assert.equal(action.resolution.availability, 'unavailable');
    assert.equal(action.source, null);
    assert.equal(action.receipt.sourceId, own.id);
  } finally { JSON.parse = original; await f.close(); }
});

test('new receipt corruption or disappearance fails closed while corrupt current metadata cannot invalidate historical identity', async () => {
  for (const mode of ['bad-json', 'missing-receipt', 'missing-binding', 'changed-binding', 'changed-ledger', 'missing-ledger', 'corrupt-fingerprint'] as const) {
    const f = fixture();
    try {
      f.service.upload('a', 'one', 'One.txt', Buffer.from('Cedar'));
      if (mode === 'bad-json') f.store.db.prepare('UPDATE knowledge_action_receipts SET data=?').run('{bad');
      if (mode === 'missing-receipt') f.store.db.exec('DELETE FROM knowledge_action_receipts');
      if (mode === 'missing-binding') f.store.db.exec('DELETE FROM knowledge_action_keys');
      if (mode === 'changed-binding') f.store.db.prepare('UPDATE knowledge_action_keys SET receipt_id=?').run('different-receipt');
      if (mode === 'changed-ledger') f.store.db.prepare('UPDATE knowledge_requests SET source_id=?').run('different-source');
      if (mode === 'missing-ledger') f.store.db.exec('DELETE FROM knowledge_requests');
      if (mode === 'corrupt-fingerprint') f.store.db.prepare('UPDATE knowledge_requests SET fingerprint=?').run('not-a-fingerprint');
      const before = changes(f.store);
      assert.throws(() => f.repo.actionByRequest('a', 'one'), { code: 'knowledge_action_corrupt' }, mode);
      assert.throws(() => f.service.upload('a', 'one', 'One.txt', Buffer.from('Cedar')), { code: 'knowledge_action_corrupt' }, mode);
      assert.equal(changes(f.store), before);
    } finally { await f.close(); }
  }
  const f = fixture();
  try {
    const source = f.service.upload('a', 'one', 'One.txt', Buffer.from('Cedar')).source, receipt = f.repo.actionByRequest('a', 'one').receipt;
    f.store.db.prepare('UPDATE knowledge_sources SET data=? WHERE id=?').run('{bad current metadata', source.id);
    const result = f.repo.actionByRequest('a', 'one');
    assert.deepEqual(result.receipt, receipt);
    assert.equal(result.source, null); assert.equal(result.resolution.availability, 'unavailable');
  } finally { await f.close(); }
});

test('receipt or binding commit failure rolls back source/blob/job/key and retry state atomically', async () => {
  for (const table of ['knowledge_action_receipts', 'knowledge_action_keys']) {
    const f = fixture(':memory:', true);
    try {
      f.store.db.exec(`CREATE TEMP TRIGGER deny_action BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'controlled receipt failure');END`);
      assert.throws(() => f.service.upload('a', 'blocked', 'One.txt', Buffer.from('Cedar')), /controlled receipt failure/);
      for (const name of ['knowledge_sources', 'knowledge_blobs', 'knowledge_jobs', 'knowledge_requests', 'knowledge_action_receipts', 'knowledge_action_keys']) assert.equal(count(f.store, name), 0, name);
      f.store.db.exec('DROP TRIGGER deny_action');
      const source = f.service.upload('a', 'upload', 'Cedar.pdf', Buffer.from('%PDF-synthetic')).source;
      await f.service.runJobs();
      const before = f.repo.get('a', source.id), requests = count(f.store, 'knowledge_requests'), jobs = count(f.store, 'knowledge_jobs');
      f.store.db.exec(`CREATE TEMP TRIGGER deny_action BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'controlled receipt failure');END`);
      assert.throws(() => f.service.retry('a', source.id, 'blocked-retry', before.revision), /controlled receipt failure/);
      assert.deepEqual(f.repo.get('a', source.id), before);
      assert.equal(count(f.store, 'knowledge_requests'), requests); assert.equal(count(f.store, 'knowledge_jobs'), jobs);
      assert.throws(() => f.repo.actionByRequest('a', 'blocked-retry'), { status: 404 });
    } finally { await f.close(); }
  }
});

test('legacy schema adds no fabricated action history and recovery remains read-only even after metadata disappears', async () => {
  const f = fixture();
  try {
    const source = f.service.upload('a', 'legacy', 'Legacy.txt', Buffer.from('Legacy Cedar')).source;
    const oldRequest = f.store.db.prepare('SELECT * FROM knowledge_requests').all(), oldSource = f.store.db.prepare('SELECT * FROM knowledge_sources').all();
    f.store.db.exec('DROP TABLE knowledge_action_keys;DROP TABLE knowledge_action_receipts');
    const migrated = new KnowledgeRepository(f.store);
    assert.deepEqual(f.store.db.prepare('SELECT * FROM knowledge_requests').all(), oldRequest);
    assert.deepEqual(f.store.db.prepare('SELECT * FROM knowledge_sources').all(), oldSource);
    assert.equal(count(f.store, 'knowledge_action_receipts'), 0); assert.equal(count(f.store, 'knowledge_action_keys'), 0);
    const before = changes(f.store), active = migrated.actionByRequest('a', 'legacy');
    assert.equal(active.receipt.provenance, 'legacy-reference');
    assert.equal(active.receipt.request, null); assert.equal(active.receipt.acceptedAt, null); assert.equal(active.receipt.acceptedContentVersion, null);
    assert.equal(active.receipt.fingerprint, knowledgeActionFingerprint({ kind: 'file', name: 'Legacy.txt', bytes: 12, sha256: source.file!.sha256 }));
    assert.equal(changes(f.store), before);
    migrated.remove('a', source.id, source.revision);
    assert.deepEqual(migrated.actionByRequest('a', 'legacy').receipt, active.receipt);
    assert.equal(migrated.actionByRequest('a', 'legacy').resolution.availability, 'deleted');
    f.store.db.prepare('DELETE FROM knowledge_sources WHERE id=?').run(source.id);
    assert.equal(migrated.actionByRequest('a', 'legacy').resolution.availability, 'unavailable');
    assert.deepEqual(migrated.actionByRequest('a', 'legacy').receipt, active.receipt);
    f.store.db.prepare('UPDATE knowledge_requests SET fingerprint=?').run('not-a-fingerprint');
    assert.throws(() => migrated.actionByRequest('a', 'legacy'), { code: 'knowledge_action_corrupt' });
  } finally { await f.close(); }
});

test('schema failure rolls back safely and two temp SQLite owners/restart retain the same deleted-key receipt', async () => {
  const f = fixture();
  try {
    f.store.db.exec('DROP TABLE knowledge_action_keys;DROP TABLE knowledge_action_receipts;PRAGMA query_only=ON');
    assert.throws(() => new KnowledgeRepository(f.store));
    assert.equal(f.store.db.isTransaction, false);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'knowledge_action_%'").get()!.n, 0);
  } finally { f.store.db.exec('PRAGMA query_only=OFF'); await f.close(); }
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-recovery-')), path = join(dir, 'synthetic.sqlite');
  let first = fixture(path), second: ReturnType<typeof fixture> | undefined;
  try {
    const source = first.service.upload('a', 'durable-key', 'Durable.txt', Buffer.from('Durable Cedar')).source;
    second = fixture(path);
    assert.equal(second.service.upload('a', 'durable-key', 'Durable.txt', Buffer.from('Durable Cedar')).source.id, source.id);
    const receipt = first.repo.actionByRequest('a', 'durable-key').receipt;
    second.repo.remove('a', source.id, source.revision);
    assert.equal(first.repo.actionByRequest('a', 'durable-key').resolution.availability, 'deleted');
    assert.equal(count(first.store, 'knowledge_sources'), 1);
    await first.close(); await second.close(); second = undefined;
    first = fixture(path);
    assert.deepEqual(first.repo.actionByRequest('a', 'durable-key').receipt, receipt);
    assert.equal(first.repo.actionByRequest('a', 'durable-key').resolution.availability, 'deleted');
    assert.deepEqual(first.calls(), { extractions: 0, fetches: 0 });
  } finally { await first.close(); if (second) await second.close(); rmSync(dir, { recursive: true, force: true }); }
});

async function invoke(app: ReturnType<typeof createApp>, method: string, url: string, value?: unknown, raw = false): Promise<{ status: number; body: any }> {
  const bytes = raw ? Buffer.from(value as Uint8Array) : value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
  return new Promise(resolve => {
    const request = Object.assign(Readable.from(bytes.length ? [bytes] : []), { method, url, headers: { host: '127.0.0.1:3001', 'content-type': raw ? 'application/octet-stream' : 'application/json' } });
    const response = { status: 0, setHeader() {}, writeHead(status: number) { this.status = status; }, end(payload: string | Buffer) { resolve({ status: this.status, body: JSON.parse(String(payload)) }); } };
    app.server.emit('request', request, response);
  });
}
test('HTTP upload/link/retry acknowledgements and recovery carry matching receipts; deleted old POST keys never reingest', async () => {
  const app = createApp({ databasePath: ':memory:', env: { DATABASE_PATH: ':memory:' }, seed: false, runJobs: false });
  try {
    app.store.put('account', 'a', { id: 'a', provider: 'demo', email: 'a@example.test', name: 'Synthetic', color: '#000' });
    // Keep test processing under explicit control and never access a URL.
    app.knowledge.requestProcessing = () => {};
    const uploaded = await invoke(app, 'POST', '/api/knowledge/sources/files?accountId=a&clientRequestId=upload&name=Cedar.txt', Buffer.from('Cedar'), true);
    assert.equal(uploaded.status, 201); assert.equal(uploaded.body.receipt.clientRequestId, 'upload');
    const file = uploaded.body.source;
    assert.equal((await invoke(app, 'DELETE', '/api/knowledge/sources/' + file.id, { accountId: 'a', expectedRevision: file.revision })).status, 200);
    const gone = await invoke(app, 'GET', '/api/knowledge/source-actions/by-request/upload?accountId=a');
    assert.equal(gone.status, 200); assert.deepEqual(gone.body.receipt, uploaded.body.receipt); assert.equal(gone.body.resolution.availability, 'deleted');
    const replay = await invoke(app, 'POST', '/api/knowledge/sources/files?accountId=a&clientRequestId=upload&name=Cedar.txt', Buffer.from('Cedar'), true);
    assert.equal(replay.status, 409); assert.equal(replay.body.error.code, 'knowledge_action_unavailable');
    const link = await invoke(app, 'POST', '/api/knowledge/sources/links', { accountId: 'a', clientRequestId: 'link', url: 'https://example.com/page#fragment' });
    assert.equal(link.status, 201); assert.deepEqual(link.body.receipt.request, { kind: 'link', url: 'https://example.com/page' });
    app.knowledge.repository.transaction(() => app.knowledge.repository.save({ ...link.body.source, status: 'error', revision: 2, error: { code: 'knowledge_ingestion_failed', message: 'Synthetic failure', retry: 'explicit' } }));
    const retry = await invoke(app, 'POST', '/api/knowledge/sources/' + link.body.source.id + '/retry', { accountId: 'a', expectedRevision: 2, clientRequestId: 'retry' });
    assert.equal(retry.status, 202); assert.equal(retry.body.receipt.request.kind, 'retry');
    assert.deepEqual((await invoke(app, 'GET', '/api/knowledge/source-actions/by-request/retry?accountId=a')).body.receipt, retry.body.receipt);
    assert.equal(app.store.list('draft').length, 0); assert.equal(app.store.list('delivery').length, 0);
    assert.equal(count(app.store, 'ai_turns'), 0); assert.equal(count(app.store, 'calendar_operations'), 0);
  } finally { await app.close(); }
});
