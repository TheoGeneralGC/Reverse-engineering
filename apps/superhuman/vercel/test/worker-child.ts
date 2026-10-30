import { attachWorkerShutdown, MailWorkerRuntime } from '../src/worker.ts';
import { command, decode, openWorkerFixture, until, workerNamespace } from './worker-fixture.ts';

const directory = process.env.REA_WORKER_CHILD_TEMP;
if (!directory || !process.send) throw Error('Owned subprocess fixture requires its explicit temporary directory and IPC');
const f = await openWorkerFixture({ directory, overrides: { providerDraftAutomatic: false } });
const runtime = await MailWorkerRuntime.start({ authority: f.authority, log: f.log, actorId: 'signal-child', deploymentId: 'signal-deployment', createCore: f.createCore,
  healthPort: 0, healthHost: '127.0.0.1' as const, pollMs: 2, acquireMs: 5 });
let calls = 0;
attachWorkerShutdown(async () => { await runtime.stop(); await f.close(); process.send?.({ state: 'stopped', calls }); process.disconnect?.(); });
await until(() => runtime.state === 'active');
const app = f.cores[0].app;
app.store.put('account', 'synthetic', { id: 'synthetic', provider: 'google', email: 'sender@example.test', name: 'Synthetic', color: '#000000' });
app.store.put('googleGrant', 'mail:synthetic', { accountId: 'synthetic', service: 'mail', grantedScopes: ['https://www.googleapis.com/auth/gmail.modify'] });
app.store.db.prepare('INSERT INTO secrets VALUES(?,?)').run('synthetic', 'synthetic-not-read');
app.google.send = async () => { calls++; throw Error('Owned child must not deliver'); }; app.google.acknowledgedDeliveryMetadata = async () => undefined;
const draft = app.store.saveDraft({ accountId: 'synthetic', to: 'recipient@example.test', subject: 'Synthetic signal shutdown', body: 'Fictional only.' });
const current = app.draftSend.current('synthetic', draft.id);
await f.log.enqueue({ id: 'signal-send', namespace: workerNamespace, request: command(`/api/drafts/${draft.id}/send-operations`, 'POST', {
  accountId: 'synthetic', clientRequestId: 'signal-send-key', expectedDraftRevision: current.draftRevision, expectedContentHash: current.contentHash, expectedGeneration: current.eligibility.generation,
}) });
await until(async () => (await f.log.readResult(workerNamespace, 'signal-send'))?.state === 'completed');
const result = (await f.log.readResult(workerNamespace, 'signal-send'))!.response!;
if (result.status !== 202) throw Error('Owned signal fixture did not accept its synthetic Send');
process.send({ state: 'ready', operationId: decode(result).operation.id });
