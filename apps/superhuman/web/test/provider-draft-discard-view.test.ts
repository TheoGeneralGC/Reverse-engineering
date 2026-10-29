import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { ApiError } from '../src/api.ts';
import { ProviderDraftDiscardController } from '../src/provider-draft-discard.ts';
import type { ProviderDraftDiscardResponse } from '../../api/src/provider-draft-types.ts';
import type { RichComposerHandle } from '../src/RichComposer.tsx';
import type { RecipientFieldsHandle } from '../src/RecipientFields.tsx';
import { providerHash, providerOperation, providerQueued, providerTime, providerUnknown } from './provider-draft-fixtures.ts';
const compiled = new Map<string, string>();
for (const name of ['ProviderDraftDiscard.tsx', 'RichComposer.tsx', 'RecipientFields.tsx', 'Icon.tsx']) { const path = fileURLToPath(new URL('../src/' + name, import.meta.url)); compiled.set(pathToFileURL(path).href, (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code); }
const hook = registerHooks({ load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }; const source = compiled.get(url); return source === undefined ? next(url, context) : { format: 'module', shortCircuit: true, source }; } }); after(() => hook.deregister());
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173' }), window = dom.window;
for (const name of ['window', 'document', 'navigator', 'Node', 'DocumentFragment', 'CharacterData', 'Event', 'CustomEvent', 'HTMLOListElement', 'Text', 'Element', 'HTMLElement', 'Range', 'Selection', 'MutationObserver', 'NodeFilter', 'DOMParser', 'HTMLAnchorElement', 'HTMLBRElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLLIElement', 'HTMLInputElement', 'HTMLImageElement', 'KeyboardEvent', 'InputEvent', 'DOMRect', 'getComputedStyle']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name as keyof typeof window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(); window.Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const { act, createElement, createRef, Fragment } = await import('react'), { createRoot } = await import('react-dom/client'), { default: View } = await import('../src/ProviderDraftDiscard.tsx'), { default: RichComposer } = await import('../src/RichComposer.tsx'), { default: RecipientFields } = await import('../src/RecipientFields.tsx');
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(done => { resolve = done; }); return { promise, resolve }; };
const terminal = (): ProviderDraftDiscardResponse => ({ receipt: { id: 'receipt', accountId: 'a', draftId: 'd', clientRequestId: 'discard-one', operationId: 'delete-one', draftRevision: 1, contentHash: providerHash, acceptedSyncRevision: 1, acceptedAt: providerTime }, resolution: 'discarded', providerDraft: providerQueued({ revision: 4, state: 'discarded', deliveryBlocked: true, operation: providerOperation({ id: 'delete-one', kind: 'delete', state: 'confirmed', completedAt: providerTime, resolution: 'target-unavailable' }) }) });

async function fixture(request: ConstructorParameters<typeof ProviderDraftDiscardController>[0]['request']) {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const controller = new ProviderDraftDiscardController({ accountId: 'a', draftId: 'd', storage, makeKey: () => 'discard-one', request, pollMs: 0 }), host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host), rich = createRef<RichComposerHandle>(), recipients = createRef<RecipientFieldsHandle>();
  let state = controller.getSnapshot(), show = false, showEditors = true, body = { body: 'Retained rich text', html: '<div>Retained rich text</div>' }, headers = { to: 'one@example.test, two@example.test', cc: '', bcc: '' }, finishes = 0, leaked = 0;
  const render = () => root.render(createElement('div', { onKeyDown: () => { leaked++; } },
    showEditors && createElement(Fragment, { key: 'editors' }, createElement(RecipientFields, { ref: recipients, accountId: 'a', draftId: 'd', ...headers, readOnly: state.blocked, onChange: value => { headers = value; render(); }, request: async () => ({ contacts: [], source: 'local-message-participants' as const, limited: true as const }) }), createElement(RichComposer, { ref: rich, accountId: 'a', draftId: 'd', ...body, readOnly: state.blocked, onChange: value => { body = value; render(); } })),
    show && createElement(View, { state, canDiscard: true, onDiscard: () => controller.discard({ draftRevision: 1, contentHash: providerHash, providerDraft: providerQueued() }), onCheck: () => controller.recover(), onKeep: () => { show = false; render(); }, onFinish: () => { if (controller.releaseTerminal()) { finishes++; showEditors = false; show = false; render(); } } })));
  const unsubscribe = controller.subscribe(() => { state = controller.getSnapshot(); render(); }); await act(async () => render());
  const click = async (text: string) => { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text); assert.ok(button, text); await act(async () => button.click()); };
  return { host, controller, rich, recipients, values, body: () => body, headers: () => headers, finishes: () => finishes, leaked: () => leaked, open: async () => { show = true; await act(async () => render()); }, click, close: async () => { unsubscribe(); controller.dispose(); await act(async () => root.unmount()); host.remove(); } };
}
const key = async (node: Element, value: string, init: KeyboardEventInit = {}) => { const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init }); await act(async () => { node.dispatchEvent(event); node.dispatchEvent(new window.KeyboardEvent('keyup', { key: value, bubbles: true, ...init })); }); return event; };

test('actual dialog keeps rich/recipient controllers mounted and both undo histories survive a definite refusal', async () => {
  const f = await fixture(async () => { throw new ApiError('Draft changed; review it again', 409, 'provider_draft_revision_conflict'); });
  try {
    const body = f.host.querySelector<HTMLElement>('[aria-label="Message body"]')!, to = f.host.querySelector<HTMLInputElement>('input[aria-label="To"]')!;
    await act(async () => { body.focus(); const range = window.document.createRange(); range.selectNodeContents(body); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); }); await key(body, 'b', { metaKey: true }); assert.ok(body.querySelector('b,strong'));
    await act(async () => f.recipients.current!.focus('to')); await key(to, 'Backspace'); assert.equal(f.headers().to, 'one@example.test');
    await f.open(); const keep = f.host.querySelector<HTMLButtonElement>('.provider-draft-discard button')!; assert.equal(keep.textContent, 'Keep draft'); assert.equal(window.document.activeElement, keep);
    await f.click('Discard draft'); assert.equal(f.host.querySelector('[aria-label="Message body"]'), body); assert.equal(f.host.querySelector('input[aria-label="To"]'), to); assert.match(f.host.textContent ?? '', /Draft changed; review it again/);
    await f.click('Keep draft'); await key(body, 'z', { metaKey: true }); assert.equal(body.querySelector('b,strong'), null); assert.equal(f.body().body, 'Retained rich text');
    await act(async () => f.recipients.current!.focus('to')); await key(to, 'z', { metaKey: true }); assert.equal(f.headers().to, 'one@example.test, two@example.test'); assert.equal(f.finishes(), 0);
  } finally { await f.close(); }
});

test('lost ACK locks without clearing authored content, Escape cannot close it, and only checked terminal plus explicit host acknowledgement removes editor', async () => {
  const held = deferred(); let posts = 0, gets = 0;
  const f = await fixture(async (_path, _body, method) => { if (method === 'POST') { posts++; throw Error('Lost acknowledgement'); } gets++; return held.promise; });
  try {
    const body = f.host.querySelector<HTMLElement>('[aria-label="Message body"]')!; await f.open(); await f.click('Discard draft'); assert.equal(posts, 1); assert.equal(f.host.querySelector('[aria-label="Message body"]'), body); assert.equal(body.contentEditable, 'false'); assert.equal(f.body().body, 'Retained rich text'); assert.equal(f.headers().to, 'one@example.test, two@example.test');
    const dialog = f.host.querySelector<HTMLElement>('[role="alertdialog"]')!, before = f.leaked(); await key(dialog, 'Escape'); await key(dialog, 'Enter', { metaKey: true }); assert.equal(f.leaked(), before); assert.ok(f.host.querySelector('[role="alertdialog"]')); assert.equal(f.finishes(), 0);
    await f.click('Check discard status'); assert.equal(gets, 1); assert.equal(f.finishes(), 0); assert.ok(f.values.size); await act(async () => held.resolve(terminal())); assert.match(f.host.textContent ?? '', /Draft discarded/); assert.equal(f.host.querySelector('[aria-label="Message body"]'), body); assert.equal(f.finishes(), 0); assert.equal(posts, 1);
    await f.click('Close discarded draft'); assert.equal(f.host.querySelector('[aria-label="Message body"]'), null); assert.equal(f.finishes(), 1); assert.equal(f.values.size, 0);
  } finally { await f.close(); }
});

test('confirmation keyboard trap uses its own enabled controls and status changes do not steal a newer outside focus', async () => {
  const held = deferred(), f = await fixture(async () => held.promise);
  try {
    await f.open(); const buttons = f.host.querySelectorAll<HTMLButtonElement>('.provider-draft-discard button'), keep = buttons[0], discard = buttons[1];
    await key(keep, 'Tab', { shiftKey: true }); assert.equal(window.document.activeElement, discard); await key(discard, 'Tab'); assert.equal(window.document.activeElement, keep);
    await f.click('Discard draft'); const outside = window.document.createElement('button'); window.document.body.append(outside); outside.focus(); await act(async () => held.resolve(terminal())); assert.equal(window.document.activeElement, outside); outside.remove();
  } finally { await f.close(); }
});

test('an accepted discard waiting on unknown cloud work offers explicit provider verification separately from local receipt refresh', async () => {
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host);
  const c = new ProviderDraftDiscardController({ accountId: 'a', draftId: 'd', storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const response = terminal(); response.resolution = 'pending'; response.providerDraft = { ...providerUnknown(), revision: 3 };
  const state = { ...c.getSnapshot(), blocked: true, response }; let cloud = 0, local = 0;
  const render = async (cloudChecking = false) => act(async () => root.render(createElement(View, { state, canDiscard: false, cloudChecking, onKeep() {}, onDiscard() {}, onFinish() {}, onCheck: () => { local++; }, onCheckCloud: () => { cloud++; } })));
  try {
    await render(); assert.equal(cloud, 0); assert.equal(local, 0); const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]; assert.deepEqual(buttons.map(button => button.textContent), ['Check Gmail status', 'Check discard status']);
    await act(async () => buttons[0].click()); assert.equal(cloud, 1); assert.equal(local, 0); await render(true); assert.ok([...host.querySelectorAll<HTMLButtonElement>('button')].every(button => button.disabled)); assert.equal(cloud, 1); assert.equal(local, 0);
  } finally { c.dispose(); await act(async () => root.unmount()); host.remove(); }
});
