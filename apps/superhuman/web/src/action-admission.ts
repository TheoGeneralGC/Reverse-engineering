export type ActionTicket = {
  /** The first call arms the reserved position; later calls return that same promise. */
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Releases an unstarted position. Running work keeps its original result. */
  cancel(): void;
};

export type ActionAdmission = {
  /** Reserve before publishing pending state or awaiting target resolution. */
  reserve(accountId: string): ActionTicket;
  dispose(): void;
};

export class ActionAdmissionCancelledError extends Error {
  readonly reason: 'cancelled' | 'disposed';

  constructor(reason: 'cancelled' | 'disposed') {
    super(reason === 'disposed' ? 'Action admission was disposed' : 'Action ticket was cancelled');
    this.name = 'ActionAdmissionCancelledError';
    this.reason = reason;
  }
}

type Entry = {
  state: 'reserved' | 'armed' | 'running' | 'settled' | 'cancelled';
  work?: () => Promise<unknown>;
  promise?: Promise<unknown>;
  resolve?: (value: unknown) => void;
  reject?: (reason: unknown) => void;
  cancellation?: ActionAdmissionCancelledError;
};

type Queue = { accountId: string; entries: Entry[]; scheduled: boolean };

/** Transient admission only: no persistence, transport, or shared singleton. */
export function createActionAdmission(): ActionAdmission {
  const queues = new Map<string, Queue>();
  let disposed = false;

  function remove(queue: Queue, entry: Entry): void {
    const index = queue.entries.indexOf(entry);
    if (index !== -1) queue.entries.splice(index, 1);
    if (queue.entries.length === 0 && queues.get(queue.accountId) === queue) {
      queues.delete(queue.accountId);
    }
  }

  function settle(queue: Queue, entry: Entry, success: boolean, result: unknown): void {
    entry.state = 'settled';
    remove(queue, entry);
    if (success) entry.resolve!(result);
    else entry.reject!(result);
    entry.resolve = undefined;
    entry.reject = undefined;
    schedule(queue);
  }

  function schedule(queue: Queue): void {
    if (disposed || queue.scheduled || queue.entries[0]?.state !== 'armed') return;
    queue.scheduled = true;
    queueMicrotask(() => {
      queue.scheduled = false;
      const entry = queue.entries[0];
      if (disposed || entry?.state !== 'armed') return;
      entry.state = 'running';
      const work = entry.work!;
      entry.work = undefined;
      try {
        Promise.resolve(work()).then(
          value => settle(queue, entry, true, value),
          error => settle(queue, entry, false, error),
        );
      } catch (error) {
        settle(queue, entry, false, error);
      }
    });
  }

  function cancel(queue: Queue, entry: Entry, reason: 'cancelled' | 'disposed'): void {
    if (entry.state !== 'reserved' && entry.state !== 'armed') return;
    entry.state = 'cancelled';
    entry.cancellation = new ActionAdmissionCancelledError(reason);
    entry.work = undefined;
    entry.reject?.(entry.cancellation);
    entry.resolve = undefined;
    entry.reject = undefined;
    remove(queue, entry);
    schedule(queue);
  }

  return {
    reserve(accountId) {
      let queue = queues.get(accountId);
      if (!queue) {
        queue = { accountId, entries: [], scheduled: false };
        if (!disposed) queues.set(accountId, queue);
      }
      const owner = queue;
      const entry: Entry = disposed
        ? { state: 'cancelled', cancellation: new ActionAdmissionCancelledError('disposed') }
        : { state: 'reserved' };
      if (!disposed) owner.entries.push(entry);

      return {
        run<T>(work: () => Promise<T>): Promise<T> {
          if (!entry.promise) {
            if (entry.state === 'cancelled') {
              entry.promise = Promise.reject(entry.cancellation);
            } else {
              entry.state = 'armed';
              entry.work = work;
              entry.promise = new Promise<unknown>((resolve, reject) => {
                entry.resolve = resolve;
                entry.reject = reject;
              });
              schedule(owner);
            }
          }
          return entry.promise as Promise<T>;
        },
        cancel() { cancel(owner, entry, 'cancelled'); },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const queue of queues.values()) {
        for (const entry of [...queue.entries]) cancel(queue, entry, 'disposed');
      }
      queues.clear();
    },
  };
}
