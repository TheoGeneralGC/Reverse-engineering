// Trusted synthetic child entry. Install denial before application imports.
import { parentPort, workerData } from 'node:worker_threads';
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls';
import type { ActorCore } from '../src/actor.ts';
import type { CommandRequest, CommandResponse } from '../src/command-log.ts';
const deny = () => { throw Error('synthetic_child_external_transport_denied'); };
globalThis.fetch = async () => deny();
for (const module of [http, https]) { module.request = deny as typeof module.request; module.get = deny as typeof module.get; }
net.connect = deny as typeof net.connect; net.createConnection = deny as typeof net.createConnection; tls.connect = deny as typeof tls.connect;
net.Socket.prototype.connect = deny as typeof net.Socket.prototype.connect; syncBuiltinESMExports();
const { serveCoreThread } = await import('../src/core-thread-entry.ts');
if (!parentPort) throw Error('Synthetic child requires a port');
const configuration = workerData.configuration, environment = configuration.env;
if (configuration.databaseUrl !== environment.DATABASE_PATH || !environment.TEST_DIRECTORY || configuration.databaseUrl !== environment.TEST_DIRECTORY + '/effects.sqlite') throw Error('Explicit isolated fixture path required');
const port = parentPort;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
await serveCoreThread(port, workerData, async ({ context, bodies, stage, sql }): Promise<ActorCore> => {
  context.assertLocal();
  const db = new DatabaseSync(configuration.databaseUrl);
  const runSql = (text: string, ...args: string[]) => { context.assertLocal(); sql('run', text); db.prepare(text).run(...args); };
  db.exec('CREATE TABLE effects(kind TEXT NOT NULL)');
  stage('app-construction'); sql('exec', 'CREATE TABLE effects(kind TEXT NOT NULL)');
  const effect = (kind: string) => runSql('INSERT INTO effects(kind) VALUES(?)', kind);
  const mode = environment.TEST_MODE ?? 'normal';
  let stopped = false;
  const work = new Set<Promise<unknown>>();
  const response = (value: string): CommandResponse => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: { kind: 'inline', base64: Buffer.from(value).toString('base64') } });
  const held = async () => { for (let turn = 0; turn < 1000; turn++) { if (existsSync(environment.TEST_DIRECTORY + '/release')) return; await sleep(5); } throw Error('Synthetic release deadline'); };
  return {
    dispatch(input: CommandRequest, command) {
      if (stopped) return Promise.resolve({ ...response('draining'), status: 503 });
      const task = (async (): Promise<CommandResponse> => {
        if (mode === 'exit-zero') { process.exit(0); }
        if (mode === 'crash') { process.nextTick(() => { throw Error('Fictional secret must never escape worker logs'); }); return new Promise(() => {}); }
        if (mode === 'bad-response') { port.postMessage({ kind: 'response', id: 999, ok: true, response: response('wrong-key') }); return new Promise(() => {}); }
        if (mode === 'duplicate-native') { port.postMessage({ kind: 'native-begin', id: 1 }); port.postMessage({ kind: 'native-begin', id: 1 }); return new Promise(() => {}); }
        if (mode === 'bad-body') { port.postMessage({ kind: 'body-read', id: 1, nativeId: 999, scope: { namespace: configuration.namespace, commandId: command.id, method: input.method, path: input.path }, body: { kind: 'blob', ref: 'fictional-ref-aaaaaaaaaaaa', bytes: 1, sha256: 'a'.repeat(64) } }); return new Promise(() => {}); }
        if (input.path === '/api/fixture/body-without-native') {
          try { await bodies.readRequestBody({ kind: 'blob', ref: 'fictional-ref-aaaaaaaaaaaa', bytes: 1, sha256: 'a'.repeat(64) }, { namespace: configuration.namespace, commandId: command.id, method: input.method, path: input.path }); return response('unexpected'); }
          catch { return response('refused-without-live-native'); }
        }
        if (input.path === '/api/fixture/body') {
          if (input.body.kind !== 'blob') throw Error('Synthetic Blob required');
          const scope = { namespace: configuration.namespace, commandId: command.id, method: input.method, path: input.path };
          const bytes = await context.runNative(() => bodies.readRequestBody(input.body as Extract<CommandRequest['body'], { kind: 'blob' }>, scope));
          const result = await context.runNative(() => bodies.writeResponseBody(scope, bytes));
          return { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: result };
        }
        const pending = context.runNative(async () => {
          context.assertLocal(); effect('native-start');
          if (mode === 'native-crash') process.exit(1);
          await held(); context.assertLocal(); effect('native-finish'); return 'native-complete';
        });
        if (mode === 'blocked-after-begin') {
          writeFileSync(environment.TEST_DIRECTORY + '/child-blocked', 'synthetic');
          const until = Date.now() + 5000;
          // Only this disposable child is blocked, to queue a granted permit
          // before revocation; the parent authority loop remains responsive.
          while (!existsSync(environment.TEST_DIRECTORY + '/unblock') && Date.now() < until) { /* bounded synthetic scheduling gate */ }
        }
        return response(await pending);
      })();
      work.add(task); void task.finally(() => work.delete(task)).catch(() => {}); return task;
    },
    beginQuiesce() { stopped = true; },
    async quiesce() { stopped = true; while (work.size) await Promise.allSettled([...work]); },
    async close() {
      stopped = true; while (work.size) await Promise.allSettled([...work]);
      context.assertLocal(); effect('closed'); db.close();
      writeFileSync(environment.TEST_DIRECTORY + '/close-returned', 'synthetic');
      if (environment.TEST_EXIT_DELAY === 'true') {
        const until = Date.now() + 5000;
        const timer = setInterval(() => { if (existsSync(environment.TEST_DIRECTORY + '/exit-release') || Date.now() > until) { clearInterval(timer); writeFileSync(environment.TEST_DIRECTORY + '/exit-timer-fired', 'synthetic'); } }, 5);
      }
    },
  };
});
