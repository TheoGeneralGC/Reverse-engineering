import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Libsql from 'libsql';
import PostalMime from 'postal-mime';
import { adaptLibsqlDatabase } from '../src/sql.ts';
import { NativeControl } from './control-sql-fixture.ts';
import { ActorAuthority } from '../src/authority.ts';
import { DurableCommandLog, type CommandRequest, type CommandResponse } from '../src/command-log.ts';
import { DurableCoreActor, type ActorContext } from '../src/actor.ts';
import { PrivateBodyTransport, type PrivateBlobPort } from '../src/blob-transport.ts';
import { LoopbackCoreAdapter, type LoopbackCoreOptions } from '../src/core-adapter.ts';
import type { ProviderDraftTransport, GmailDraftResource } from '../../api/src/provider-draft-transport.ts';

export class MemoryBlob implements PrivateBlobPort {
  readonly objects = new Map<string, Buffer>();
  async uploadGrant(path: string) { return { url: `https://private.example.test/${path}` }; }
  async downloadGrant(path: string) { return { url: `https://private.example.test/${path}` }; }
  async read(path: string) { const bytes = this.objects.get(path); return bytes ? new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) : null; }
  async write(path: string, bytes: Uint8Array) { this.objects.set(path, Buffer.from(bytes)); }
  async remove(path: string) { this.objects.delete(path); }
}
export function deferred<T = void>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export const inline = (value: string) => ({ kind: 'inline' as const, base64: Buffer.from(value).toString('base64') });
export const workerNamespace = 'worker-fixture', webOrigin = 'https://mail.example.test';
export function command(path: string, method = 'GET', value?: unknown): CommandRequest { return { method, path,
  headers: { origin: webOrigin, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
  body: inline(value === undefined ? '' : JSON.stringify(value)) }; }
export async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let count = 0; count < 1500; count++) { if (await check()) return; await new Promise<void>(resolve => setTimeout(resolve, 2)); }
  throw new Error('The bounded worker fixture did not settle');
}
export function decode(response: CommandResponse): any { if (response.body.kind !== 'inline') throw new Error('Expected inline JSON fixture'); return JSON.parse(Buffer.from(response.body.base64, 'base64').toString()); }
export async function openWorkerFixture(options: { directory?: string; transport?: typeof fetch; overrides?: LoopbackCoreOptions['overrides'] } = {}) {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), 'rea-worker-')), controlPath = join(directory, 'control.sqlite'), corePath = join(directory, 'mail.sqlite');
  const sql = new NativeControl(controlPath, { DATABASE_PATH: controlPath }); const blob = new MemoryBlob();
  const bodies = new PrivateBodyTransport({ sql, blob, namespace: workerNamespace }); await bodies.initialize();
  const authority = new ActorAuthority(sql, { namespace: workerNamespace });
  const log = new DurableCommandLog(sql, { namespace: workerNamespace, webOrigin,
    authorizeBody: async (transaction, request, scope) => { if (request.body.kind !== 'blob') throw Error('Expected Blob'); await bodies.authorizeRequestBody(transaction, request.body, scope); } });
  const cores: LoopbackCoreAdapter[] = []; const actors: DurableCoreActor[] = [];
  const env = { DATABASE_PATH: corePath, WEB_ORIGIN: webOrigin, GOOGLE_REDIRECT_URI: `${webOrigin}/api/auth/google/callback`,
    GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-client-secret', TOKEN_ENCRYPTION_KEY: '1'.repeat(64),
    ANTHROPIC_API_KEY: 'synthetic-model-key', ANTHROPIC_MODEL: 'synthetic-model',
    APPROVED_TEST_SENDERS: 'sender@example.test', APPROVED_TEST_RECIPIENTS: 'recipient@example.test' };
  const createCore = async (context: ActorContext) => {
    const core = await LoopbackCoreAdapter.create({ context, namespace: workerNamespace, env, databasePath: corePath,
      databaseFactory: path => { if (path !== corePath) throw Error('Fixture DB identity mismatch'); return adaptLibsqlDatabase(new Libsql(path), () => context.assertLocal()); },
      bodies, transport: options.transport ?? (async () => { throw Error('No external provider traffic permitted'); }),
      overrides: { runJobs: false, ...options.overrides } }); cores.push(core); return core;
  };
  const startActor = async (id: string) => { const actor = await DurableCoreActor.start({ authority, log, actorId: id, deploymentId: `deployment-${id}`, createCore }); actors.push(actor); return actor; };
  return { directory, corePath, sql, blob, bodies, authority, log, cores, env, createCore, startActor,
    async issue(actor: DurableCoreActor, id: string, input: CommandRequest) { await log.enqueue({ id, namespace: workerNamespace, request: input }); await actor.pumpOnce();
      await until(async () => (await log.readResult(workerNamespace, id))?.state === 'completed'); return (await log.readResult(workerNamespace, id))!.response!; },
    async close() { for (const actor of actors) if (actor.state === 'active') await actor.close(); await sql.close(); blob.objects.clear(); if (!options.directory) rmSync(directory, { recursive: true, force: true }); } };
}
export function fakeCloudTransport() {
  const resources = new Map<string, GmailDraftResource>(); let creates = 0;
  const transport: ProviderDraftTransport = { ready() {}, async profile() { return 'sender@example.test'; },
    async create(_account, message) { const value = { id: `draft-${++creates}`, message: { id: `message-${creates}`, threadId: 'thread-fixture', labelIds: ['DRAFT'], raw: message.raw } }; resources.set(value.id, value); return value; },
    async update(_account, id, message) { const old = resources.get(id)!; const next = { ...old, message: { ...old.message, raw: message.raw } }; resources.set(id, next); return next; },
    async get(_account, id) { return resources.get(id); }, async list() { return { drafts: [...resources.values()] }; },
    async metadata(_account, id) { const resource = [...resources.values()].find(item => item.message.id === id); if (!resource) throw Error('Missing synthetic cloud message');
      const parsed = await PostalMime.parse(Buffer.from(resource.message.raw!, 'base64url'));
      return { id, labelIds: ['DRAFT'], payload: { headers: parsed.headers.map(header => ({ name: header.originalKey, value: header.value })) } }; },
    async delete(_account, id) { resources.delete(id); } };
  return { transport, creates: () => creates, resources };
}
