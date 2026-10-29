import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { browserMailboxContext, mailboxKey, summaryPath } from '../src/mailbox-list.ts';
import type { MailboxContext } from '../src/mailbox-list.ts';
import type { ThreadListPage } from '../src/api.ts';

const context: MailboxContext = { accountId: 'a', folder: 'all', q: ' after:2026/10/29 ', split: 'all', limit: 2 };
test('browser search context is cloned, zone-bound in keys/paths and absent from unchanged folder/custom paths', () => {
  const derived = browserMailboxContext(context)!;
  assert.notEqual(derived, context); assert.equal(derived.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone); assert.equal('timeZone' in context, false);
  const utc = browserMailboxContext({ ...context, timeZone: 'UTC' })!;
  assert.equal(utc.timeZone, 'UTC');
  const url = new URL(summaryPath(utc), 'https://local.example.test');
  assert.equal(url.searchParams.get('timeZone'), 'UTC'); assert.equal(url.searchParams.get('q'), 'after:2026/10/29');
  assert.notEqual(mailboxKey(utc), mailboxKey({ ...utc, timeZone: 'America/Los_Angeles' }));
  assert.notEqual(mailboxKey(utc), mailboxKey({ ...utc, accountId: 'b' }));
  const folder = { ...context, q: ' \t ' }, noSearch = browserMailboxContext(folder)!;
  assert.equal(noSearch.timeZone, undefined); assert.equal(new URL(summaryPath(noSearch), url).searchParams.has('timeZone'), false);
  assert.equal(mailboxKey(noSearch), JSON.stringify(['a', 'all', '', 'all', 2, undefined, undefined, undefined]));
  const custom = { ...noSearch, timeZone: 'UTC', viewRef: 'custom:owned' as const, settingsRevision: 1, policyVersion: 'local-v1' };
  assert.equal(new URL(summaryPath(custom), url).searchParams.has('timeZone'), false);
  assert.equal(browserMailboxContext(null), null);
});

test('actual useMailbox rebuilds on browser-zone change and fences a late page without mutating caller context', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1' });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true }); Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  const oldFetch = globalThis.fetch, oldDateTimeFormat = Intl.DateTimeFormat;
  let zone = 'America/Los_Angeles';
  Intl.DateTimeFormat = new Proxy(oldDateTimeFormat, { apply(target, self, args) { return Reflect.apply(target, self, args.length ? args : ['en-US', { timeZone: zone }]); } });
  const calls: { url: URL; signal?: AbortSignal | null }[] = [];
  let release!: (value: Response) => void;
  const held = new Promise<Response>(resolve => { release = resolve; });
  const page = (id: string): ThreadListPage => ({ threads: [{ id, accountId: 'a', subject: id, snippet: 'Synthetic', sender: { name: 'Synthetic', email: 'sender@example.test' }, participants: [], lastMessageAt: '2026-10-29T00:50:41Z', unread: false, starred: false, important: true, folder: 'inbox', labels: [], messageCount: 1, hasAttachments: false }], total: 1, counts: { inbox: 1, important: 1, other: 0, calendar: 0 }, hasMore: false, nextCursor: null });
  globalThis.fetch = async (input, init) => { calls.push({ url: new URL(String(input), 'http://127.0.0.1'), signal: init?.signal }); return calls.length === 1 ? held : Response.json(page('fresh-zone')); };
  const { act, createElement } = await import('react'), { createRoot } = await import('react-dom/client'), { default: useMailbox } = await import('../src/useMailbox.ts');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const input = { ...context };
  function Harness() { const mailbox = useMailbox(input); return createElement('output', null, mailbox.threads.map(row => row.id).join(',')); }
  const render = () => act(async () => { root.render(createElement(Harness)); });
  try {
    await render(); assert.equal(calls[0].url.searchParams.get('timeZone'), 'America/Los_Angeles');
    zone = 'Asia/Tokyo'; await render();
    assert.equal(calls.length, 2); assert.equal(calls[1].url.searchParams.get('timeZone'), 'Asia/Tokyo'); assert.equal(calls[0].signal?.aborted, true); assert.equal(host.textContent, 'fresh-zone');
    await act(async () => release(Response.json(page('stale-zone')))); assert.equal(host.textContent, 'fresh-zone');
    assert.deepEqual(input, context); assert.equal('timeZone' in input, false);
  } finally {
    await act(async () => root.unmount()); host.remove(); globalThis.fetch = oldFetch; Intl.DateTimeFormat = oldDateTimeFormat; dom.window.close();
    for (const [name, descriptor] of [['window', oldWindow], ['document', oldDocument], ['IS_REACT_ACT_ENVIRONMENT', oldAct]] as const) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
});
