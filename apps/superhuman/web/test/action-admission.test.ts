import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionAdmissionCancelledError,
  createActionAdmission,
} from '../src/action-admission.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const cancelled = (reason: 'cancelled' | 'disposed') => (error: unknown) => {
  assert.ok(error instanceof ActionAdmissionCancelledError);
  assert.equal(error.name, 'ActionAdmissionCancelledError');
  assert.equal(error.reason, reason);
  return true;
};

test('an unarmed reservation keeps its place across reentrant pending publication and target resolution', async () => {
  const admission = createActionAdmission();
  const calls: string[] = [];
  const target = deferred<string>();
  const firstReply = deferred<string>();
  const first = admission.reserve('a');
  // A synchronous pending observer submits another action before first.run().
  const reentrant = admission.reserve('a').run(async () => { calls.push('second'); return 'two'; });
  const resolving = target.promise.then(value => first.run(async () => {
    calls.push(value);
    return firstReply.promise;
  }));
  await admission.reserve('b').run(async () => { calls.push('other-account'); });
  assert.deepEqual(calls, ['other-account']);
  target.resolve('first');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ['other-account', 'first']);
  firstReply.resolve('one');
  assert.deepEqual(await Promise.all([resolving, reentrant]), ['one', 'two']);
  assert.deepEqual(calls, ['other-account', 'first', 'second']);
  admission.dispose();
});

test('a synchronously reserved batch executes in reservation order even when armed in reverse order', async () => {
  const admission = createActionAdmission();
  const tickets = [admission.reserve('a'), admission.reserve('a'), admission.reserve('a')];
  const calls: number[] = [];
  const third = tickets[2].run(async () => { calls.push(3); return 3; });
  const second = tickets[1].run(async () => { calls.push(2); return 2; });
  const first = tickets[0].run(async () => { calls.push(1); return 1; });
  assert.deepEqual(calls, []);
  assert.deepEqual(await Promise.all([first, second, third]), [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3]);
  admission.dispose();
});

test('cancelling an unarmed position releases its successor while an active account never blocks another', async () => {
  const admission = createActionAdmission();
  const held = deferred<string>();
  const calls: string[] = [];
  const active = admission.reserve('a').run(async () => { calls.push('active'); return held.promise; });
  const unused = admission.reserve('a');
  const successor = admission.reserve('a').run(async () => { calls.push('successor'); return 'next'; });
  await admission.reserve('b').run(async () => { calls.push('independent'); });
  assert.deepEqual(calls, ['active', 'independent']);
  unused.cancel();
  unused.cancel();
  await assert.rejects(unused.run(async () => { calls.push('cancelled'); }), cancelled('cancelled'));
  held.resolve('done');
  assert.deepEqual(await Promise.all([active, successor]), ['done', 'next']);
  assert.deepEqual(calls, ['active', 'independent', 'successor']);
  admission.dispose();
});

test('cancelling an armed callback before its microtask prevents issue and releases the next position', async () => {
  const admission = createActionAdmission();
  let cancelledCalls = 0;
  const ticket = admission.reserve('a');
  const work = ticket.run(async () => { cancelledCalls++; });
  const rejection = assert.rejects(work, cancelled('cancelled'));
  const next = admission.reserve('a').run(async () => 'next');
  ticket.cancel();
  await rejection;
  assert.equal(await next, 'next');
  assert.equal(cancelledCalls, 0);
  admission.dispose();
});

test('dispose rejects all unstarted work, including later run/reserve, without invoking any callback', async () => {
  const admission = createActionAdmission();
  let calls = 0;
  const work = async () => { calls++; return 'unexpected'; };
  const first = admission.reserve('a');
  const unarmed = admission.reserve('a');
  const other = admission.reserve('b');
  const firstPromise = first.run(work);
  const otherPromise = other.run(work);
  const rejections = [
    assert.rejects(firstPromise, cancelled('disposed')),
    assert.rejects(otherPromise, cancelled('disposed')),
  ];
  admission.dispose();
  admission.dispose();
  assert.equal(first.run(work), firstPromise);
  rejections.push(assert.rejects(unarmed.run(work), cancelled('disposed')));
  rejections.push(assert.rejects(admission.reserve('a').run(work), cancelled('disposed')));
  await Promise.all(rejections);
  assert.equal(calls, 0);
});

test('run is once-only and disposing or cancelling issued work preserves its result without starting a successor', async () => {
  const admission = createActionAdmission();
  const held = deferred<string>();
  let calls = 0;
  const ticket = admission.reserve('a');
  const first = ticket.run(async () => { calls++; return held.promise; });
  assert.equal(ticket.run(async () => { calls += 100; return 'duplicate'; }), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  ticket.cancel();
  const next = admission.reserve('a').run(async () => { calls += 10; });
  const rejectedNext = assert.rejects(next, cancelled('disposed'));
  admission.dispose();
  held.resolve('original result');
  assert.equal(await first, 'original result');
  await rejectedNext;
  assert.equal(ticket.run(async () => 'replacement'), first);
  assert.equal(calls, 1);
});

test('a callback rejection or synchronous throw settles its own promise and allows the next action', async () => {
  for (const synchronous of [false, true]) {
    const admission = createActionAdmission();
    const failure = new Error('callback failed');
    const first = admission.reserve('a').run(() => {
      if (synchronous) throw failure;
      return Promise.reject(failure);
    });
    const rejected = assert.rejects(first, error => error === failure);
    const next = admission.reserve('a').run(async () => 'next');
    await rejected;
    assert.equal(await next, 'next');
    admission.dispose();
  }
});

test('disposing an already issued rejection preserves that rejection and never starts queued work', async () => {
  const admission = createActionAdmission();
  const held = deferred<string>();
  const failure = new Error('issued failure');
  let successorCalls = 0;
  const first = admission.reserve('a').run(async () => held.promise);
  const rejectedFirst = assert.rejects(first, error => error === failure);
  await Promise.resolve();
  const next = admission.reserve('a').run(async () => { successorCalls++; });
  const rejectedNext = assert.rejects(next, cancelled('disposed'));
  admission.dispose();
  held.reject(failure);
  await Promise.all([rejectedFirst, rejectedNext]);
  assert.equal(successorCalls, 0);
});
