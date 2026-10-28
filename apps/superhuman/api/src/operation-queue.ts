/** Serialize provider-facing work for an account so a late snapshot cannot
 * overwrite a subsequent mutation or sync. Accounts remain independent. */
export class OperationQueue {
  tails = new Map<string, Promise<void>>();
  run<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(accountId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => {}, () => {});
    this.tails.set(accountId, tail);
    void tail.then(() => { if (this.tails.get(accountId) === tail) this.tails.delete(accountId); });
    return result;
  }
}
