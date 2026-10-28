import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactEmailKey, createContactContext } from '../src/contact-context.ts';
import type { ContactContext, ContactIdentity, ContactRequest, ContactSummary } from '../src/contact-context.ts';

const context = (patch: Partial<ContactContext> = {}): ContactContext => ({ accountId: 'account-one', draftId: null, threadId: 'open-thread', mode: 'mail', ...patch });
const person = (email = 'one@example.test'): ContactIdentity => ({ name: 'Synthetic contact', email });
const summary = (email: string, accountId: string, ids = ['recent']): ContactSummary => ({ contact: person(email), source: 'local-message-participants', limited: true, matched: true, threads: ids.map(id => ({ id, accountId, subject: `Synthetic ${id}`, lastMessageAt: '2026-10-28T01:00:00Z' })) });
const settle = async () => { for (let count = 0; count < 4; count++) await Promise.resolve(); };
function fixture(isCurrent?: (value: ContactContext) => boolean) {
  const calls: { context: Parameters<ContactRequest>[0]; signal: AbortSignal; resolve: (result: ContactSummary) => void; reject: (error: Error) => void }[] = [];
  const model = createContactContext({ isCurrent, request: (value, signal) => new Promise((resolve, reject) => calls.push({ context: value, signal, resolve, reject })) });
  return { model, calls };
}

test('same contact address in a different account cannot retain or publish prior-account summaries', async () => {
  const { model, calls } = fixture(); try {
    model.setContext(context()); model.select(person(), 'selection');
    model.setContext(context({ accountId: 'account-two' }), { preserveContact: true });
    assert.equal(calls[0].signal.aborted, true); assert.equal(model.getSnapshot().contact, null); assert.deepEqual(model.getSnapshot().threads, []);
    model.select(person(), 'selection'); calls[1].resolve(summary('one@example.test', 'account-two', ['current-account'])); await settle(); calls[0].resolve(summary('one@example.test', 'account-one', ['private-old-account'])); await settle();
    assert.deepEqual(model.getSnapshot().threads.map(thread => thread.id), ['current-account']); assert.equal(model.getSnapshot().context?.accountId, 'account-two'); assert.equal(model.getSnapshot().error, '');
  } finally { model.dispose(); }
});

test('late selected-contact success or failure cannot overwrite a newer contact in the same view', async () => {
  for (const fail of [false, true]) {
    const { model, calls } = fixture(); try {
      model.setContext(context()); model.select(person(), 'selection'); model.select(person('two@example.test'), 'suggestion');
      calls[1].resolve(summary('two@example.test', 'account-one', ['current-contact'])); await settle();
      if (fail) calls[0].reject(new Error('Private obsolete provider diagnostic')); else calls[0].resolve(summary('one@example.test', 'account-one', ['old-contact'])); await settle();
      assert.equal(model.getSnapshot().contact?.email, 'two@example.test'); assert.deepEqual(model.getSnapshot().threads.map(thread => thread.id), ['current-contact']); assert.equal(model.getSnapshot().error, ''); assert.equal(calls[0].signal.aborted, true);
    } finally { model.dispose(); }
  }
});

test('preserved recent-mail navigation rereads its exclusion context and cannot preserve into another draft', async () => {
  const { model, calls } = fixture(); try {
    model.setContext(context()); model.select(person(), 'selection');
    model.setContext(context({ threadId: 'new-open-thread' }), { preserveContact: true });
    assert.equal(model.getSnapshot().contact?.email, 'one@example.test'); assert.equal(calls[0].signal.aborted, true); assert.equal(calls[1].context.excludeThreadId, 'new-open-thread');
    calls[0].resolve(summary('one@example.test', 'account-one', ['obsolete-exclusion'])); await settle(); assert.deepEqual(model.getSnapshot().threads, []);
    calls[1].resolve(summary('one@example.test', 'account-one', ['new-open-thread', 'a', 'a', 'b', 'c', 'd', 'e'])); await settle(); assert.deepEqual(model.getSnapshot().threads.map(thread => thread.id), ['a', 'b', 'c', 'd']);
    model.setContext(context({ draftId: 'different-draft', threadId: null }), { preserveContact: true }); assert.equal(model.getSnapshot().contact, null); assert.deepEqual(model.getSnapshot().threads, []); assert.equal(calls.length, 2);
  } finally { model.dispose(); }
});

test('AI/settings/calendar/modal precedence aborts reads and retains selection without late reopening', async () => {
  for (const mode of ['ai', 'settings', 'calendar', 'recent:accounts']) {
    const { model, calls } = fixture(); try {
      model.setContext(context()); model.select(person(), 'selection'); model.setContext(context({ mode }));
      assert.equal(calls[0].signal.aborted, true); assert.equal(model.getSnapshot().contact?.email, 'one@example.test'); assert.equal(model.getSnapshot().loading, false);
      calls[0].resolve(summary('one@example.test', 'account-one', ['hidden-old-result'])); await settle(); assert.equal(model.getSnapshot().context?.mode, mode); assert.deepEqual(model.getSnapshot().threads, []); assert.equal(calls.length, 1);
      model.setContext(context()); assert.equal(calls.length, 2); calls[1].resolve(summary('one@example.test', 'account-one', ['refreshed'])); await settle(); assert.deepEqual(model.getSnapshot().threads.map(thread => thread.id), ['refreshed']);
    } finally { model.dispose(); }
  }
});

test('render-time identity rejection precedes effect updates and does not publish an obsolete result', async () => {
  let current = context(); const { model, calls } = fixture(captured => JSON.stringify(captured) === JSON.stringify(current)); let publications = 0; const unsubscribe = model.subscribe(() => publications++);
  try {
    model.setContext(current); model.select(person(), 'message'); const before = publications; current = context({ draftId: 'next-draft', threadId: null });
    calls[0].resolve(summary('one@example.test', 'account-one', ['stale-before-layout-effect'])); await settle(); assert.equal(publications, before); assert.deepEqual(model.getSnapshot().threads, []);
    model.setContext(current); assert.equal(model.getSnapshot().contact, null); assert.equal(model.getSnapshot().loading, false);
  } finally { unsubscribe(); model.dispose(); }
});

test('name-only input retains prior context; incomplete raw address becomes a nonquerying fallback; clear defeats pending reads', async () => {
  const { model, calls } = fixture(); try {
    model.setContext(context()); model.select(person(), 'selection');
    model.select({ name: 'Literal invalid name', email: '' }, 'commit'); assert.equal(model.getSnapshot().contact?.email, 'one@example.test'); assert.equal(calls.length, 1);
    model.select({ name: 'Incomplete', email: 'incomplete@' }, 'commit'); assert.equal(model.getSnapshot().contact?.email, 'incomplete@'); assert.equal(model.getSnapshot().error, ''); assert.deepEqual(model.getSnapshot().threads, []); assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, true);
    model.clear(); calls[0].resolve(summary('one@example.test', 'account-one', ['late-after-clear'])); await settle(); assert.equal(model.getSnapshot().contact, null); assert.deepEqual(model.getSnapshot().threads, []); assert.equal(model.getSnapshot().loading, false);
  } finally { model.dispose(); }
});

test('permanent disposal prevents retry reads as well as late publication or context resurrection', async () => {
  const { model, calls } = fixture(); let publications = 0; model.subscribe(() => publications++); model.setContext(context()); model.select(person(), 'selection'); const before = publications;
  model.dispose(); assert.equal(calls[0].signal.aborted, true); model.retry(); model.setContext(context({ accountId: 'account-two' })); model.select(person('two@example.test'), 'selection'); calls[0].resolve(summary('one@example.test', 'account-one', ['late-after-dispose'])); await settle();
  assert.equal(calls.length, 1); assert.equal(publications, before); assert.deepEqual(model.getSnapshot().threads, []);
});

test('URL syntax in a malformed domain cannot alias a different valid contact response', async () => {
  for (const malformed of ['person@example.test/path', 'person@example.test:443', 'person@example.test?query', 'person@example.test#fragment']) {
    const { model, calls } = fixture(); try {
      assert.notEqual(contactEmailKey(malformed), contactEmailKey('person@example.test'));
      model.setContext(context()); model.select(person(malformed), 'commit');
      if (calls.length) { calls[0].resolve(summary('person@example.test', 'account-one', ['wrong-contact'])); await settle(); }
      assert.equal(model.getSnapshot().contact?.email, malformed); assert.deepEqual(model.getSnapshot().threads, []);
    } finally { model.dispose(); }
  }
  assert.equal(contactEmailKey('person@bücher.example'), contactEmailKey('person@xn--bcher-kva.example'));
});

test('suspended views ignore queued selection/retry callbacks and resume only the retained contact', async () => {
  const { model, calls } = fixture(); try {
    model.setContext(context()); model.select(person(), 'selection'); model.suspend();
    model.select(person('late-unmounted-selection@example.test'), 'selection'); model.retry();
    assert.equal(model.isActive(), false); assert.equal(calls.length, 1); assert.equal(model.getSnapshot().contact?.email, 'one@example.test');
    calls[0].resolve(summary('one@example.test', 'account-one', ['aborted-view'])); await settle(); assert.deepEqual(model.getSnapshot().threads, []);
    model.resume(); assert.equal(model.isActive(), true); assert.equal(calls.length, 2); assert.equal(calls[1].context.email, 'one@example.test');
    calls[1].resolve(summary('one@example.test', 'account-one', ['resumed-view'])); await settle(); assert.deepEqual(model.getSnapshot().threads.map(thread => thread.id), ['resumed-view']);
  } finally { model.dispose(); }
});
