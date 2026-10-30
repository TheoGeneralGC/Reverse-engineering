import { ActorAuthority, ActorAuthorityError, type ActorLease } from './authority.ts';
import { DurableCommandLog, type ClaimedCommand, type CommandRequest, type CommandResponse } from './command-log.ts';

export type ActorContext = Readonly<{
  lease: ActorLease;
  /** Synchronous local gate only. Cross-database exclusion relies on acquiring
   * authority before Core construction and refusing dirty/expired takeover.
   * This callback is not an atomic distributed SQL fence. */
  assertLocal: () => void;
  /** Register actual provider/model transport before checking primary authority. */
  runNative: <T>(operation: () => Promise<T>) => Promise<T>;
}>;
export interface ActorCore {
  /** Begin safe shutdown before waiting for long HTTP callbacks. */
  beginQuiesce?(): void | Promise<void>;
  dispatch(request: CommandRequest, command: { id: string; sequence: number }): Promise<CommandResponse>;
  /** Stop periodic/new background admission and drain or durably hand off accepted
   * work. This must not merely cancel Ask AI or discard a cloud-save debounce. */
  quiesce(): Promise<void>;
  close(): Promise<void>;
}
export class DurableCoreActor {
  readonly authority: ActorAuthority; readonly log: DurableCommandLog; readonly context: ActorContext;
  private core: ActorCore;
  private phase: 'active' | 'draining' | 'closed' | 'uncertain' = 'active';
  private readonly requests = new Map<string, Promise<void>>();
  private native = new Set<Promise<unknown>>();
  private readonly capacity: number;
  private pumping: Promise<number> | undefined;
  private closing: Promise<void> | undefined;
  private constructor(authority: ActorAuthority, log: DurableCommandLog, lease: ActorLease, core: ActorCore, context: ActorContext, capacity: number) {
    this.authority = authority; this.log = log; this.context = context; this.core = core; this.capacity = capacity;
  }
  static async start(options: { authority: ActorAuthority; log: DurableCommandLog; actorId: string; deploymentId: string;
    createCore: (context: ActorContext) => Promise<ActorCore> | ActorCore; maxConcurrentRequests?: number; initializeControl?: boolean }): Promise<DurableCoreActor> {
    if (options.authority.namespace !== options.log.namespace) throw new TypeError('Worker namespace mismatch');
    const capacity = options.maxConcurrentRequests ?? 32;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw new TypeError('Invalid worker capacity');
    if (options.initializeControl !== false) { await options.authority.initialize(); await options.log.initialize(); }
    const acquired = await options.authority.acquire(options.actorId, options.deploymentId);
    if (!acquired.acquired) throw new ActorAuthorityError('actor_already_owned');
    let actor: DurableCoreActor | undefined;
    // Construction is guarded too: Core may schedule background work before the
    // factory returns, so transport promises belong to this pre-created context.
    const native = new Set<Promise<unknown>>(); let construction: 'constructing' | 'ready' | 'failed' = 'constructing';
    const context: ActorContext = Object.freeze({ lease: acquired.lease,
      assertLocal() { if (construction === 'failed' || actor && !['active', 'draining'].includes(actor.phase)) throw new ActorAuthorityError(); },
      runNative<T>(operation: () => Promise<T>): Promise<T> {
        context.assertLocal();
        const work = Promise.resolve().then(async () => {
          await options.authority.assertCurrent(acquired.lease, { allowDraining: true }); context.assertLocal();
          return operation();
        }).finally(() => { native.delete(work); });
        native.add(work); return work;
      },
    });
    try {
      // The acquire above MUST precede construction: constructors migrate/recover.
      const core = await options.createCore(context);
      if (!core || typeof core.dispatch !== 'function' || typeof core.quiesce !== 'function' || typeof core.close !== 'function') throw new TypeError('Invalid worker Core');
      actor = new DurableCoreActor(options.authority, options.log, acquired.lease, core, context, capacity);
      actor.native = native; construction = 'ready'; return actor;
    } catch (error) {
      construction = 'failed'; await options.authority.markUncertain(acquired.lease).catch(() => {}); throw error;
    }
  }
  get activeRequests(): number { return this.requests.size; }
  get activeNative(): number { return this.native.size; }
  get state(): string { return this.phase; }
  /** Claims are ordered by durable acceptance sequence. Dispatch is concurrent:
   * an awaiting model or held provider request must not block Undo/Stop/status. */
  pumpOnce(): Promise<number> {
    if (this.pumping) return this.pumping;
    if (this.phase !== 'active') return Promise.resolve(0);
    const work = (async () => {
      let count = 0;
      while (this.phase === 'active' && this.requests.size < this.capacity) {
        const command = await this.log.claimNext(this.context.lease);
        if (!command) break;
        this.dispatch(command); count++;
      }
      return count;
    })().finally(() => { if (this.pumping === work) this.pumping = undefined; });
    this.pumping = work; return work;
  }
  private dispatch(command: ClaimedCommand): void {
    const work = Promise.resolve().then(async () => {
      this.context.assertLocal();
      try { const response = await this.core.dispatch(command.request, { id: command.id, sequence: command.sequence });
        await this.log.complete(this.context.lease, command.id, response); }
      catch { await this.log.markUncertain(this.context.lease, command.id); }
    }).catch(() => {
      // Persistence/authority failure must leave the existing claimed command
      // untouched. Never convert it to queued or manufacture another request.
      this.phase = 'uncertain';
    }).finally(() => { this.requests.delete(command.id); });
    this.requests.set(command.id, work);
  }
  async heartbeat(): Promise<void> {
    if (!['active', 'draining'].includes(this.phase)) throw new ActorAuthorityError();
    try { await this.authority.heartbeat(this.context.lease); }
    catch (error) { this.phase = 'uncertain'; throw error; }
  }
  async waitForRequests(): Promise<void> {
    while (this.pumping || this.requests.size) {
      if (this.pumping) await this.pumping;
      await Promise.allSettled([...this.requests.values()]);
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.phase !== 'active') throw new ActorAuthorityError('actor_not_quiescent');
      this.phase = 'draining';
      try {
        // A claim transaction already in progress must finish before changing the
        // durable phase, otherwise it might reject rather than own its last row.
        if (this.pumping) await this.pumping;
        await this.authority.beginDrain(this.context.lease);
        const beginning = Promise.resolve(this.core.beginQuiesce?.());
        // Preserve a rejected begin hook without an unhandled rejection while
        // already admitted HTTP work is still settling.
        void beginning.catch(() => {});
        await this.waitForRequests();
        await beginning;
        await this.core.quiesce();
        while (this.native.size) await Promise.allSettled([...this.native]);
        await this.core.close();
        while (this.native.size) await Promise.allSettled([...this.native]);
        // A closed Core cannot originate future native work through this context.
        this.phase = 'closed';
        await this.authority.quiesce(this.context.lease);
      } catch (error) {
        this.phase = 'uncertain'; await this.authority.markUncertain(this.context.lease).catch(() => {}); throw error;
      }
    })();
    return this.closing;
  }
}
