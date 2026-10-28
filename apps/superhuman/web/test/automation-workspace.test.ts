import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import type { AutomationSettingsResponse } from '../../api/src/automation-types.ts';
import { ApiError } from '../src/api.ts';
const path = fileURLToPath(new URL('../src/AutomationWorkspace.tsx', import.meta.url)), compiled = (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code;
const hook = registerHooks({ load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }; if (url === pathToFileURL(path).href) return { format: 'module', shortCircuit: true, source: compiled }; return next(url, context); } });
after(() => hook.deregister());
const dom = new JSDOM('<!doctype html><html><body><textarea id="mail">Owned Mail input</textarea></body></html>', { url: 'http://127.0.0.1:5173' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'Event', 'KeyboardEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { act, createElement, StrictMode } = await import('react'), { createRoot } = await import('react-dom/client'), { default: Workspace } = await import('../src/AutomationWorkspace.tsx');
const initial = (): AutomationSettingsResponse => ({ settings: { accountId: 'a', revision: 0, configuration: { labels: [], archive: { labelIds: [], always: [], never: [] } }, configurationHash: 'a'.repeat(64), updatedAt: null, processing: 'manual-demo-only', providerEffects: false }, labels: [{ id: 'builtin-marketing', name: 'Marketing', kind: 'builtin', mailLabelId: 'mail-marketing', mailLabelAvailable: false }], availableLabels: [{ id: 'owned-label', name: 'Owned label' }], labelOptionsLimited: false, templates: [{ id: 'marketing', name: 'Marketing', category: 'General', state: 'available', criteriaPreset: 'unmeasured' }], capabilities: { configuration: true, preview: false, apply: false, providerEffects: false, automaticProcessing: false, classifier: 'unavailable' }, limitations: [] });
async function mount(options: { lostSave?: boolean; rule?: boolean; strict?: boolean; realAccount?: boolean; pendingAction?: boolean; view?: 'archive' | 'labels' } = {}) {
  let remote = initial(); if (options.rule) remote.settings.configuration.labels.push({ id: 'owned', name: 'Owned rule', prompt: '', groups: [{ operator: 'or', queryOperator: 'or', items: [{ type: 'subject', value: 'owned' }] }] });
  if (options.realAccount) remote.settings.processing = 'unavailable';
  const host = dom.window.document.createElement('div'); dom.window.document.body.append(host); const root = createRoot(host), calls: { path: string; method: string; body: any }[] = [], values = new Map<string, string>(); let closed = 0;
  if (options.pendingAction) values.set('superhuman.automation.action.v1.a', JSON.stringify({ version: 1, kind: 'preview', accountId: 'a', key: 'owned-preview-key', revision: 0, settingsHash: 'a'.repeat(64), threadIds: ['owned-thread'] }));
  const request = async (path: string, body?: any, method = 'GET') => { calls.push({ path, body, method }); if (path.startsWith('/contacts/suggestions?')) return { contacts: [], source: 'local-message-participants', limited: true }; if (path === '/automation/previews/by-request/owned-preview-key?accountId=a') throw new ApiError('Earlier action not yet confirmed', 404, 'automation_not_found'); assert.equal(path, '/automation/settings?accountId=a'); if (method === 'PATCH') { remote = { ...remote, settings: { ...remote.settings, configuration: body.configuration, revision: remote.settings.revision + 1 } }; if (options.lostSave) throw Error('Synthetic lost Save acknowledgement'); } return structuredClone(remote); };
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  await act(async () => root.render(options.strict ? createElement(StrictMode, null, createElement(Workspace, { accountId: 'a', initialView: options.view ?? 'labels', request, storage, onClose: () => { closed++; } })) : createElement(Workspace, { accountId: 'a', initialView: options.view ?? 'labels', request, storage, onClose: () => { closed++; } })));
  const button = (name: string, scope: Element = host) => { const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === name || button.textContent?.trim() === name); assert.ok(found, 'Missing ' + name); return found; };
  const click = async (name: string, scope: Element = host) => act(async () => button(name, scope).click());
  const input = async (label: string, value: string) => act(async () => { const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="'+label+'"]')!; assert.ok(element, 'Missing input '+label); Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  return { host, calls, button, click, input, closed: () => closed, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('actual custom editor preserves prompt and nested operators, with no write before explicit Create', async () => {
  const f = await mount({ strict: true }); try {
    assert.ok(f.calls.every(call => call.method === 'GET')); await f.click('New Auto Label'); await f.click('Build Your Own');
    assert.ok(dom.window.document.activeElement === f.host.querySelector('#autolabel-name'));
    await f.input('Auto Label name', 'Owned staged rule'); await f.click('From'); await f.input('Include from condition 1', 'owner@example.test'); await f.click('Subject'); await f.input('Subject condition 2', '  Owned topic  '); await f.click('Or'); await f.click('AI Prompt');
    assert.equal(f.host.querySelector<HTMLTextAreaElement>('#autolabel-prompt')?.maxLength, 1000); await f.input('AI Prompt', 'Preserve exact prompt'); await f.click('Add exclusions');
    const exclude = f.host.querySelector('[aria-label="Exclude conditions"]')!; assert.ok(exclude); assert.equal([...exclude.querySelectorAll('button')].some(button => button.textContent === 'AI Prompt'), false); await f.click('To', exclude); await f.input('Exclude to condition 1', 'excluded.example');
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0); await f.click('Create Auto Label');
    const writes = f.calls.filter(call => call.method === 'PATCH'); assert.equal(writes.length, 1); const rule = writes[0].body.configuration.labels[0]; assert.equal(rule.prompt, 'Preserve exact prompt'); assert.deepEqual(rule.groups.map((group: any) => [group.operator, group.queryOperator]), [['and', 'and'], ['exclude', 'or']]); assert.equal(rule.groups[0].items[1].value, 'Owned topic'); assert.equal(f.host.querySelector('.automation-dialog')?.getAttribute('data-automation-view'), 'labels'); assert.equal(f.calls.some(call => call.path.includes('/previews')), false); assert.equal(dom.window.document.querySelector('#mail')?.textContent, 'Owned Mail input');
  } finally { await f.close(); }
});

test('dirty Back asks before discarding and confirmation owns keyboard focus', async () => {
  const f = await mount(); try {
    await f.click('New Auto Label'); await f.click('Build Your Own'); await f.input('Auto Label name', 'Keep local text'); f.host.querySelector<HTMLInputElement>('#autolabel-name')!.focus(); await f.click('Back');
    const confirm = f.host.querySelector('[role="alertdialog"]')!; assert.ok(confirm); const keep = f.button('Keep editing', confirm), discard = f.button('Discard changes', confirm); assert.ok(dom.window.document.activeElement === keep); discard.focus(); await act(async () => discard.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); assert.ok(dom.window.document.activeElement === keep); await f.click('Keep editing', confirm); assert.equal(f.host.querySelector<HTMLInputElement>('#autolabel-name')?.value, 'Keep local text');
    await f.click('Back'); await f.click('Discard changes', f.host.querySelector('[role="alertdialog"]')!); assert.equal(f.host.querySelector('.automation-dialog')?.getAttribute('data-automation-view'), 'library'); assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  } finally { await f.close(); }
});

test('unknown Save retains the editor read-only and GET recovery confirms it without a second PATCH', async () => {
  const f = await mount({ lostSave: true }); try {
    await f.click('New Auto Label'); await f.click('Build Your Own'); await f.input('Auto Label name', 'Unconfirmed local rule'); await f.click('Subject'); await f.input('Subject condition 1', 'owned'); await f.click('Create Auto Label');
    assert.equal(f.host.querySelector<HTMLInputElement>('#autolabel-name')?.disabled, true); assert.equal(f.button('Back').disabled, true); await act(async () => dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); assert.equal(f.closed(), 0); assert.equal(f.host.querySelector<HTMLInputElement>('#autolabel-name')?.value, 'Unconfirmed local rule'); await f.click('Reload saved settings'); assert.equal(f.host.querySelector('.automation-dialog')?.getAttribute('data-automation-view'), 'labels'); assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
  } finally { await f.close(); }
});

test('deleting a custom rule requires explicit confirmation and changes configuration only', async () => {
  const f = await mount({ rule: true }); try {
    await act(async () => f.host.querySelector<HTMLButtonElement>('button.automation-label-row')!.click()); await f.click('Delete'); assert.equal(f.calls.some(call => call.method !== 'GET'), false); await f.click('Delete Auto Label', f.host.querySelector('[role="alertdialog"]')!); const writes = f.calls.filter(call => call.method === 'PATCH'); assert.equal(writes.length, 1); assert.deepEqual(writes[0].body.configuration.labels, []); assert.equal(f.calls.some(call => call.path.startsWith('/drafts') || call.path.startsWith('/threads')), false); assert.equal(f.host.querySelector('.automation-dialog')?.getAttribute('data-automation-view'), 'labels');
  } finally { await f.close(); }
});

test('normal real-account settings do not expose unavailable fixture controls', async () => {
  for (const view of ['archive', 'labels'] as const) { const f = await mount({ realAccount: true, view }); try {
    assert.equal(f.host.querySelector('.automation-demo-controls'), null); assert.doesNotMatch(f.host.textContent ?? '', /Demo preview|synthetic fixture|Apply to demo mail/); assert.equal(f.calls.some(call => call.path.includes('/previews') || call.method !== 'GET'), false);
  } finally { await f.close(); } }
});

test('an earlier pending action retains visible GET-only recovery when preview capability is unavailable', async () => {
  const f = await mount({ realAccount: true, pendingAction: true }); try {
    assert.ok(f.button('Earlier automation action')); assert.ok(f.button('Check demo action status')); assert.equal([...f.host.querySelectorAll('button')].some(button => button.textContent === 'Preview selected demo mail' || button.textContent === 'Apply to demo mail'), false);
    const before = f.calls.filter(call => call.path.includes('/previews/by-request/')).length; await f.click('Check demo action status'); assert.equal(f.calls.filter(call => call.path.includes('/previews/by-request/')).length, before + 1); assert.equal(f.calls.some(call => call.method !== 'GET'), false); assert.match(f.host.textContent ?? '', /Earlier action not yet confirmed/);
  } finally { await f.close(); }
});
