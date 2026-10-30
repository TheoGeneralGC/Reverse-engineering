import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createClient } from '@libsql/client';
import Libsql from 'libsql';
import { adaptLibsqlDatabase } from '../src/sql.ts';

const directory = mkdtempSync(join(realpathSync(tmpdir()), 'rea-control-contention-'));
const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw new Error('Contention probe forbids external requests'); };
async function vector(shared: boolean) {
  const controlPath = join(directory, shared ? 'shared.sqlite' : 'control.sqlite');
  const mailPath = shared ? controlPath : join(directory, 'mail.sqlite');
  const control = createClient({ url: pathToFileURL(controlPath).href, intMode: 'bigint' });
  const native = new Libsql(mailPath), core = adaptLibsqlDatabase(native);
  let transaction: Awaited<ReturnType<typeof control.transaction>> | undefined;
  try {
    core.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=250; CREATE TABLE IF NOT EXISTS fictional_core(id INTEGER PRIMARY KEY,label TEXT)');
    await control.execute('CREATE TABLE IF NOT EXISTS fictional_control(id INTEGER PRIMARY KEY,label TEXT)');
    transaction = await control.transaction('write');
    await transaction.execute("INSERT INTO fictional_control VALUES(1,'Cedar control write held across await')");
    let commitTimerRan = false, commitCompleted = false;
    const committed = new Promise<void>((resolve, reject) => setTimeout(() => {
      commitTimerRan = true;
      transaction!.commit().then(() => { commitCompleted = true; resolve(); }, reject);
    }, 0));
    const started = performance.now(); let failed = false, code: string | undefined;
    try { core.prepare('INSERT INTO fictional_core VALUES(?,?)').run(1, 'Cedar Core sync write'); }
    catch (error) { failed = true; code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'unclassified'; }
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(commitTimerRan, false, 'The scheduled async commit cannot run while native SQL holds the JS thread');
    assert.equal(commitCompleted, false);
    if (shared) { assert.equal(failed, true); assert.match(code!, /BUSY|LOCKED/); assert.ok(elapsedMs >= 150 && elapsedMs < 2000); }
    else { assert.equal(failed, false); assert.ok(elapsedMs < 150); }
    await committed;
    assert.equal(commitTimerRan, true); assert.equal(commitCompleted, true);
    if (shared) core.prepare('INSERT INTO fictional_core VALUES(?,?)').run(1, 'Cedar write succeeds after async commit');
    assert.equal(core.prepare('SELECT count(*) AS n FROM fictional_core').get()!.n, 1);
    return { sharedFile: shared, synchronousWriteFailed: failed, sqliteCode: code ?? null, synchronousWriteElapsedMs: elapsedMs,
      commitTimerBlockedDuringSynchronousWrite: true, commitSucceededAfterEventLoopResumed: true, finalCoreRows: 1 };
  } finally { transaction?.close(); control.close(); core.close(); }
}
try {
  const shared = await vector(true), separated = await vector(false);
  assert.equal(external, 0);
  console.log(JSON.stringify({ node: process.version, driver: 'libsql@0.5.29 + @libsql/client@0.18.0', busyTimeoutMs: 250,
    shared, separated, externalRequests: external, scope: 'Explicit temporary local files; no Core construction, real mail, credentials or cloud access' }, null, 2));
} finally { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); }
