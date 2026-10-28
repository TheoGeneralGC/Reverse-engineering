import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { createRecipientModel, parseRecipient } from '../src/recipient-model.ts';
import type { RecipientFieldsHandle, RecipientSuggestions } from '../src/RecipientFields.tsx';
import type { RecipientHeaders } from '../src/recipient-model.ts';

const compiled = new Map<string, string>();
for (const name of ['RecipientFields.tsx', 'Icon.tsx']) { const path = fileURLToPath(new URL('../src/' + name, import.meta.url)); compiled.set(pathToFileURL(path).href, (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code); }
const hook = registerHooks({ load(url, context, next) { const source = compiled.get(url); return source === undefined ? next(url, context) : { format: 'module', shortCircuit: true, source }; } });
after(() => hook.deregister());
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173' }), window = dom.window;
for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'MouseEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name as keyof typeof window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement, createRef } = await import('react'), { createRoot } = await import('react-dom/client'), { default: RecipientFields } = await import('../src/RecipientFields.tsx');

const empty = { to: '', cc: '', bcc: '' };
test('scalar draft reopening retains an invalid chip and its following valid recipient as separate tokens', () => {
  for (const invalid of ['unfinished-name', 'unfinished-name,', 'Name <unfinished', '"Unclosed <first@example.test>', 'Bad <prefix <first@example.test>']) {
    const model = createRecipientModel(empty);
    for (const raw of [invalid, 'valid@example.test']) { model.input('to', raw); model.commit('to'); }
    const reopened = createRecipientModel(model.getValue());
    assert.deepEqual(reopened.getState().fields.to.tokens.map(token => ({ raw: token.raw, valid: token.valid })), [{ raw: invalid, valid: false }, { raw: 'valid@example.test', valid: true }]);
    assert.deepEqual(reopened.getValue(), model.getValue());
  }
});

test('quote-aware syntax preserves an authored angle bracket inside a valid display name', () => {
  const raw = '"A < B" <first@example.test>'; assert.equal(parseRecipient(raw).valid, true);
  const initial = { to: `${raw}, untouched@example.test`, cc: '', bcc: '' };
  const reopened = createRecipientModel(initial); assert.equal(reopened.getState().fields.to.tokens.length, 2); assert.deepEqual(reopened.getValue(), initial);
});

test('correcting a reopened invalid recipient cannot silently erase the neighboring valid recipient', () => {
  const model = createRecipientModel(empty); model.input('to', 'unfinished-name'); model.commit('to'); model.input('to', 'untouched@example.test'); model.commit('to');
  const reopened = createRecipientModel(model.getValue()); reopened.select('to', 0); reopened.edit('to'); reopened.input('to', 'corrected@example.test'); reopened.commit('to');
  assert.equal(reopened.getValue().to, 'corrected@example.test, untouched@example.test');
});

test('moving duplicate stored tokens deduplicates destination selection as well as recipient values', () => {
  const model = createRecipientModel({ to: 'same@example.test, same@example.test', cc: '', bcc: '' }); model.selectAll('to'); model.move('to', 1);
  const moved = model.getState().fields.cc;
  assert.equal(moved.tokens.length, 1); assert.deepEqual(moved.selected, [0]); assert.equal(moved.edge, 0); assert.equal(model.selectedText('cc'), 'same@example.test');
  model.remove('cc'); assert.deepEqual(model.getValue(), empty); model.undo(); assert.equal(model.getValue().cc, 'same@example.test'); model.undo(); assert.equal(model.getValue().to, 'same@example.test, same@example.test');
});

test('duplicate move into an existing destination never selects or deletes an unrelated recipient', () => {
  const initial = { to: 'same@example.test, same@example.test', cc: 'same@example.test, untouched@example.test', bcc: '' };
  const model = createRecipientModel(initial); model.selectAll('to'); model.move('to', 1);
  const moved = model.getState().fields.cc;
  assert.deepEqual(moved.selected, [1]); assert.equal(moved.edge, 1); assert.equal(model.selectedText('cc'), 'same@example.test');
  model.remove('cc'); assert.equal(model.getValue().cc, 'untouched@example.test'); model.undo(); model.undo(); assert.deepEqual(model.getValue(), initial);
});

test('a synchronous delivery lock rejects mutations and late suggestions before any readOnly prop update', async () => {
  const host = window.document.createElement('div'), outside = window.document.createElement('button'); window.document.body.append(host, outside); const root = createRoot(host), ref = createRef<RecipientFieldsHandle>();
  let locked = false, resolve!: (value: RecipientSuggestions) => void; const pending = new Promise<RecipientSuggestions>(done => { resolve = done; }); const writes: RecipientHeaders[] = [];
  let requested = false;
  try {
    await act(async () => root.render(createElement(RecipientFields, { ...empty, to: 'original@example.test', draftId: 'controlled-draft', accountId: 'controlled-account', readOnly: false, isLocked: () => locked, ref, onChange: value => writes.push(value), request: async () => { requested = true; return pending; } })));
    await act(async () => ref.current!.focus('to')); const input = host.querySelector<HTMLInputElement>('input[aria-label="To"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'unfinished'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await act(async () => { await new Promise(done => setTimeout(done, 140)); }); assert.equal(requested, true);
    const before = ref.current!.getValue(), publicationCount = writes.length; locked = true; assert.equal(input.readOnly, false, 'no parent render is needed to enforce the lock');
    const key = (value: string) => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'replacement'); input.dispatchEvent(new window.Event('input', { bubbles: true })); key('Enter'); key('Backspace');
      host.querySelector<HTMLButtonElement>('[aria-label="Remove recipient original@example.test"]')!.click();
      const paste = new window.Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'unapproved@example.test' } }); input.dispatchEvent(paste); outside.focus();
      resolve({ contacts: [{ name: 'Late private result', email: 'late@example.test' }], source: 'local-message-participants', limited: true });
    });
    assert.deepEqual(ref.current!.getValue(), before); assert.equal(writes.length, publicationCount); assert.doesNotMatch(host.textContent || '', /Late private result/); assert.equal(host.querySelector('[role="listbox"]'), null);
  } finally { await act(async () => root.unmount()); host.remove(); outside.remove(); }
});
