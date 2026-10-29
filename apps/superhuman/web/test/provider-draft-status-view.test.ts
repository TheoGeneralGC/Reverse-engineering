import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { ProviderDraftStatusState } from '../src/provider-draft-status.ts';
import { providerSynced, providerUnknown, providerUnmanaged } from './provider-draft-fixtures.ts';
const path = fileURLToPath(new URL('../src/ProviderDraftStatus.tsx', import.meta.url)), compiled = (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code;
const hook = registerHooks({ load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }; if (url === pathToFileURL(path).href) return { format: 'module', shortCircuit: true, source: compiled }; return next(url, context); } }); after(() => hook.deregister());
const dom = new JSDOM('<!doctype html><html><body><textarea id="mail">Keep authored Mail</textarea></body></html>', { url: 'http://127.0.0.1:5173' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createElement, act } = await import('react'), { createRoot } = await import('react-dom/client'), { default: View } = await import('../src/ProviderDraftStatus.tsx');
const initial = (): ProviderDraftStatusState => ({ snapshot: providerSynced(), verification: null, localRevision: 1, localDirty: false, editVersion: 0, localError: '', loading: false, checking: false, readUnavailable: false, error: '' });
async function mount(state = initial()) { const host = dom.window.document.createElement('div'); dom.window.document.body.append(host); const root = createRoot(host); let refresh = 0, check = 0; const render = async (value: ProviderDraftStatusState) => act(async () => root.render(createElement(View, { state: value, onRefresh: () => { refresh++; }, onCheck: () => { check++; } }))); await render(state); return { host, render, counts: () => ({ refresh, check }), close: async () => { await act(async () => root.unmount()); host.remove(); } }; }

test('actual status view separates local durability from current-revision cloud success without initiating work', async () => {
  const f = await mount(); try { assert.match(f.host.textContent ?? '', /Saved locally.*Synced to Gmail/); assert.deepEqual(f.counts(), { refresh: 0, check: 0 }); await f.render({ ...initial(), localDirty: true, editVersion: 1 }); assert.doesNotMatch(f.host.textContent ?? '', /Synced to Gmail/); assert.match(f.host.textContent ?? '', /Saving locally.*Gmail sync pending/); assert.equal(dom.window.document.querySelector('#mail')?.textContent, 'Keep authored Mail'); assert.deepEqual(f.counts(), { refresh: 0, check: 0 }); } finally { await f.close(); }
});

test('unknown cloud state offers an explicit Check action and never retries on render', async () => {
  const state = { ...initial(), snapshot: providerUnknown() }, f = await mount(state); try { assert.match(f.host.textContent ?? '', /Saved locally.*Gmail sync unconfirmed/); const button = f.host.querySelector<HTMLButtonElement>('button')!; assert.equal(button.textContent, 'Check Gmail status'); assert.deepEqual(f.counts(), { refresh: 0, check: 0 }); await act(async () => button.click()); assert.deepEqual(f.counts(), { refresh: 0, check: 1 }); await f.render({ ...state, checking: true }); assert.equal(f.host.querySelector('button'), null); assert.match(f.host.textContent ?? '', /Checking Gmail status/); assert.deepEqual(f.counts(), { refresh: 0, check: 1 }); } finally { await f.close(); }
});

test('unmanaged drafts show local save only and read failure exposes local Refresh with safely rendered errors', async () => {
  const f = await mount({ ...initial(), snapshot: providerUnmanaged() }); try { assert.equal(f.host.textContent, 'Saved locally'); assert.equal(f.host.querySelector('button'), null); await f.render({ ...initial(), readUnavailable: true, localDirty: true, localError: 'Keep <img src=x> literal', error: 'Synthetic status read failure' }); assert.doesNotMatch(f.host.textContent ?? '', /Synced to Gmail/); assert.match(f.host.textContent ?? '', /Could not save locally.*Gmail status unavailable/); assert.equal(f.host.querySelector('img'), null); const button = f.host.querySelector<HTMLButtonElement>('button')!; assert.equal(button.textContent, 'Refresh Gmail status'); await act(async () => button.click()); assert.deepEqual(f.counts(), { refresh: 1, check: 0 }); } finally { await f.close(); }
});

test('newer acknowledged local edits explain why earlier unknown cloud work must be checked first', async () => {
  const f = await mount({ ...initial(), snapshot: { ...providerUnknown(), revision: 3, desiredRevision: 2, desiredHash: 'b'.repeat(64) }, localRevision: 2 }); try {
    assert.match(f.host.textContent ?? '', /Newer local edits will sync after the earlier change is confirmed/); assert.deepEqual(f.counts(), { refresh: 0, check: 0 });
    await f.render({ ...initial(), snapshot: providerUnknown(), localRevision: 2, localDirty: true }); assert.doesNotMatch(f.host.textContent ?? '', /Newer local edits will sync/); assert.match(f.host.textContent ?? '', /Saving locally/); assert.deepEqual(f.counts(), { refresh: 0, check: 0 });
  } finally { await f.close(); }
});

test('a stale reconciliation error offers local Refresh before another provider Check', async () => {
  const f = await mount({ ...initial(), snapshot: providerUnknown(), error: 'The Gmail sync revision changed. Refresh status.' }); try {
    const button = f.host.querySelector<HTMLButtonElement>('button')!; assert.equal(button.textContent, 'Refresh Gmail status'); assert.deepEqual(f.counts(), { refresh: 0, check: 0 }); await act(async () => button.click()); assert.deepEqual(f.counts(), { refresh: 1, check: 0 });
    await f.render({ ...initial(), snapshot: providerUnknown() }); assert.equal(f.host.querySelector('button')?.textContent, 'Check Gmail status'); assert.deepEqual(f.counts(), { refresh: 1, check: 0 });
  } finally { await f.close(); }
});
