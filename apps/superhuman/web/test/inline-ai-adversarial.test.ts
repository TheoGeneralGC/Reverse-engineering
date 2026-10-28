import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { ComposerRewriteRequest } from '../src/composer-ai.ts';
import type { RichComposerHandle } from '../src/RichComposer.tsx';

const compiled = new Map<string, string>();
for (const name of ['RichComposer.tsx', 'Icon.tsx']) { const url = new URL('../src/' + name, import.meta.url), path = fileURLToPath(url); compiled.set(url.href, (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code); }
const hook = registerHooks({ load(url, context, next) { const source = compiled.get(url); return source === undefined ? next(url, context) : { format: 'module', shortCircuit: true, source }; } });
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://synthetic.example.test' }), window = dom.window;
for (const key of ['window', 'document', 'navigator', 'Node', 'DocumentFragment', 'CharacterData', 'Event', 'CustomEvent', 'HTMLOListElement', 'Text', 'Element', 'HTMLElement', 'Range', 'Selection', 'MutationObserver', 'NodeFilter', 'DOMParser', 'HTMLAnchorElement', 'HTMLBRElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLLIElement', 'HTMLInputElement', 'HTMLImageElement', 'KeyboardEvent', 'InputEvent', 'DOMRect', 'getComputedStyle']) Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof typeof window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(); window.Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const { createComposerEditor } = await import('../src/composer-editor.ts');
const { requestComposerRewrite } = await import('../src/composer-ai.ts');
const { act, createElement, createRef } = await import('react'), { createRoot } = await import('react-dom/client'), { default: RichComposer } = await import('../src/RichComposer.tsx'); hook.deregister();
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function editorFixture() {
  const root = window.document.createElement('div'); window.document.body.append(root);
  const published: { body: string; html: string }[] = [];
  const controller = createComposerEditor(root, { body: 'Prefix\nTarget\nSuffix', html: '<div><b>Prefix</b></div><div>Target</div><div><i>Suffix</i></div>' }, value => published.push(value));
  const range = window.document.createRange(); range.selectNodeContents(root.children[1]); controller.editor.setSelection(range);
  const assertNoBookmarks = () => { assert.equal(root.querySelector('input'), null); assert.doesNotMatch(controller.getValue().html, /<input\b/i); for (const value of published) assert.doesNotMatch(value.html, /<input\b/i); };
  return { root, controller, published, assertNoBookmarks, close: () => { controller.destroy(); root.remove(); } };
}

for (const replacement of ['First\n', 'First\n\n', 'First\n\nSecond\n']) test(`retry replaces the entire prior AI result including trailing structure: ${JSON.stringify(replacement)}`, () => {
  const f = editorFixture(); try {
    const target = f.controller.applyRewrite(replacement, f.controller.captureRewriteTarget()); const firstBody = f.controller.getValue().body; f.assertNoBookmarks();
    f.controller.applyRewrite('Final replacement', target);
    assert.equal(f.controller.getValue().body, 'Prefix\nFinal replacement\nSuffix'); assert.match(f.controller.getValue().html, /<b>Prefix<\/b>/); assert.match(f.controller.getValue().html, /<i>Suffix<\/i>/);
    f.assertNoBookmarks(); f.controller.run('undo'); assert.equal(f.controller.getValue().body, firstBody); f.assertNoBookmarks(); f.controller.run('redo'); assert.equal(f.controller.getValue().body, 'Prefix\nFinal replacement\nSuffix'); f.assertNoBookmarks();
  } finally { f.close(); }
});

test('AI output containing markup and surrogate pairs remains literal text with stable retry boundaries', () => {
  const f = editorFixture(); try {
    const text = '😀 <img src="https://untrusted.example.test" onerror="bad()"> & text';
    const target = f.controller.applyRewrite(text, f.controller.captureRewriteTarget()); assert.equal(f.controller.getValue().body, `Prefix\n${text}\nSuffix`); assert.equal(f.root.querySelector('img'), null);
    f.controller.applyRewrite('Safe replacement', target); assert.equal(f.controller.getValue().body, 'Prefix\nSafe replacement\nSuffix');
  } finally { f.close(); }
});

async function mounted(generateAI: (request: ComposerRewriteRequest, signal: AbortSignal) => Promise<string>, keyed = false) {
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host), ref = createRef<RichComposerHandle>();
  let draftId = 'synthetic-old-draft', value = { body: 'Before target after', html: '<div><b>Before </b>target<i> after</i></div>' }, changes = 0, disposed = false;
  const render = () => root.render(createElement(RichComposer, { key: keyed ? draftId : undefined, ref, draftId, ...value, generateAI, onChange: next => { changes++; value = next; render(); } })); await act(async () => render());
  const body = () => host.querySelector<HTMLElement>('[aria-label="Message body"]')!;
  const open = async () => { await act(async () => { body().focus(); const range = window.document.createRange(); range.selectNodeContents(body().querySelector('div')!.childNodes[1]); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); ref.current!.openAI(); }); };
  const click = async (name: string) => { const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === name || item.getAttribute('aria-label') === name); assert.ok(button, name); await act(async () => button.click()); };
  return { host, ref, open, click, getValue: () => value, changeCount: () => changes, setDraft: async (id: string, body: string) => { draftId = id; value = { body, html: `<div>${body}</div>` }; await act(async () => render()); }, close: async () => { if (!disposed) { disposed = true; await act(async () => root.unmount()); host.remove(); } } };
}

test('unmount aborts an in-flight rewrite and ignores provider completion without emitting draft changes', async () => {
  const pending = deferred<string>(); let signal: AbortSignal | undefined;
  const f = await mounted(async (_request, abort) => { signal = abort; return pending.promise; });
  try {
    await f.open(); await f.click('Shorten'); const changes = f.changeCount(); await f.close(); assert.equal(signal!.aborted, true);
    await act(async () => pending.resolve('Late discarded result')); assert.equal(f.changeCount(), changes); assert.equal(f.getValue().body, 'Before target after');
  } finally { await f.close(); }
});

test('an in-place draft identity change resets the old AI session and discards its late result', async () => {
  const pending = deferred<string>(); let signal: AbortSignal | undefined;
  const f = await mounted(async (_request, abort) => { signal = abort; return pending.promise; }); try {
    await f.open(); await f.click('Shorten'); await f.setDraft('synthetic-new-draft', 'New account draft'); assert.equal(signal!.aborted, true);
    assert.equal(f.host.querySelector('[aria-label="Edit with AI"]'), null);
    await act(async () => pending.resolve('Old account result')); assert.equal(f.getValue().body, 'New account draft');
    await act(async () => f.ref.current!.openAI()); assert.equal(f.host.querySelector('[aria-label="Edit with AI"]')!.getAttribute('aria-busy'), 'false');
  } finally { await f.close(); }
});

test('an account-style keyed remount cannot receive a prior draft rewrite', async () => {
  const pending = deferred<string>(); let signal: AbortSignal | undefined;
  const f = await mounted(async (_request, abort) => { signal = abort; return pending.promise; }, true); try {
    await f.open(); await f.click('Improve writing'); await f.setDraft('synthetic-other-account', 'Other account content'); assert.equal(signal!.aborted, true);
    await act(async () => pending.resolve('Wrong account replacement')); assert.equal(f.getValue().body, 'Other account content'); assert.equal(f.host.querySelector('[aria-label="Edit with AI"]'), null);
  } finally { await f.close(); }
});

test('closing and reopening AI cannot let the first request complete the newer session', async () => {
  const first = deferred<string>(), second = deferred<string>(); let calls = 0;
  const f = await mounted(async () => (++calls === 1 ? first.promise : second.promise)); try {
    await f.open(); await f.click('Shorten'); await f.click('Close AI editor'); await f.open(); await f.click('Shorten');
    await act(async () => first.resolve('Stale first request')); assert.equal(f.getValue().body, 'Before target after'); assert.equal(f.host.querySelector('[aria-label="Edit with AI"]')!.getAttribute('aria-busy'), 'true');
    await act(async () => second.resolve('Current result')); assert.equal(f.getValue().body, 'Before Current result after');
  } finally { await f.close(); }
});

test('the rewrite adapter sends the selected text only, carries cancellation, and rejects absent output', async () => {
  const original = globalThis.fetch, abort = new AbortController(); let calls = 0; let empty = false;
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(String(url), '/api/ai'); assert.equal(init!.method, 'POST'); assert.equal(init!.signal, abort.signal);
    const body = JSON.parse(String(init!.body)), prompt = JSON.parse(body.prompt); assert.equal(body.mode, 'write'); assert.equal(prompt.selection, 'Synthetic selected passage'); assert.equal(prompt.instruction, 'Shorten'); assert.equal('threadId' in body, false);
    return new Response(JSON.stringify({ text: empty ? '' : 'Synthetic rewritten passage' }), { status: 200 });
  };
  try {
    assert.equal(await requestComposerRewrite({ instruction: 'Shorten', text: 'Synthetic selected passage' }, abort.signal), 'Synthetic rewritten passage');
    empty = true; await assert.rejects(() => requestComposerRewrite({ instruction: 'Shorten', text: 'Synthetic selected passage' }, abort.signal), /no replacement text/);
    await assert.rejects(() => requestComposerRewrite({ instruction: 'Shorten', text: 'x'.repeat(10_001) }, abort.signal), /shorter passage/); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
