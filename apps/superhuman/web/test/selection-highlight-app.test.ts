import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

// Reuse only this repository's actual-App setup prefix. None of its existing
// test declarations is imported or registered by the synthetic fixture URL.
const fixtureURL = new URL('./draft-transitions.test.ts?selection-highlight-fixture', import.meta.url);
const originalFixture = readFileSync(new URL('./draft-transitions.test.ts', import.meta.url), 'utf8');
const boundary = originalFixture.indexOf('\ntest('); assert(boundary > 0);
const prefix = originalFixture.slice(0, boundary); assert(!prefix.includes('\ntest('));
const source = stripTypeScriptTypes(prefix + '\nexport {mount,act,window};', { mode: 'strip' });
const hook = registerHooks({ load(url, context, next) { return url === fixtureURL.href ? { format: 'module', shortCircuit: true, source } : next(url, context); } });
type Request = { path: string; method: string; body: any };
type Mounted = { host: HTMLElement; requests: Request[]; click(name: string): Promise<void>; key(value: string): Promise<void>; close(): Promise<void> };
const { mount, act, window } = await import(fixtureURL.href) as { mount: (body: string, fixture: any) => Promise<Mounted>; act: (work: () => void | Promise<void>) => Promise<void>; window: Window & typeof globalThis };
after(() => { hook.deregister(); window.close(); });
console.log('selection_app_fixture_prefix_sha256=' + createHash('sha256').update(prefix).digest('hex'));

// JSDOM has no layout. These explicit physical slots supply a fictional68/36
// geometry, including retained departing DOM rows, not a browser pixel claim.
const prototype = window.HTMLElement.prototype, originals = new Map<string, PropertyDescriptor | undefined>();
const set = (name: string, get: (this: HTMLElement) => unknown) => { originals.set(name, Object.getOwnPropertyDescriptor(prototype, name)); Object.defineProperty(prototype, name, { configurable: true, get }); };
const height = (row: HTMLElement) => row.querySelector('.mail-subject')?.textContent === 'Fixture A' ? 68 : 36;
set('offsetParent', function () { return this.matches('.mail-row') ? this.closest('.thread-list') : null; });
set('offsetTop', function () { const container = this.closest('.thread-list'); if (!container || !this.matches('.mail-row')) return 0; let top = 0; for (const row of container.querySelectorAll<HTMLElement>('.mail-row')) { if (row === this) return top; top += height(row); } return 0; });
set('offsetLeft', function () { return this.matches('.mail-row') ? 6 : 0; });
set('offsetWidth', function () { return this.matches('.mail-row') ? 620 : this.matches('.thread-list') ? 640 : 0; });
set('offsetHeight', function () { return this.matches('.mail-row') ? height(this) : 0; });
set('clientWidth', function () { return this.matches('.thread-list') ? 640 : 0; });
set('clientHeight', function () { return this.matches('.thread-list') ? 280 : 0; });
Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
let scrolls = 0; const oldScroll = prototype.scrollIntoView;
prototype.scrollIntoView = function () { if (this.matches('.mail-row')) scrolls++; };
after(() => { for (const [name, descriptor] of originals) if (descriptor) Object.defineProperty(prototype, name, descriptor); else Reflect.deleteProperty(prototype, name); prototype.scrollIntoView = oldScroll; });
const row = (id: string, position: number) => ({ id, accountId: 'demo', subject: 'Fixture ' + id.toUpperCase(), snippet: 'Fictional only', sender: { name: 'Sender', email: 'sender@example.test' }, participants: [], lastMessageAt: new Date(Date.UTC(2026, 9, 27, 12, 0, -position)).toISOString(), unread: false, starred: false, important: true, folder: 'inbox', labels: [], messageCount: 1, hasAttachments: id === 'a' });
const page = (rows: ReturnType<typeof row>[]) => ({ threads: rows, total: rows.length, counts: { inbox: rows.length, important: rows.length, other: 0, calendar: 0 }, hasMore: false, nextCursor: null });
const surface = (app: Mounted) => app.host.querySelector<HTMLElement>('.mail-selection-surface')!;
const selected = (app: Mounted) => app.host.querySelector('.mail-row.focused')?.getAttribute('data-thread-id');
const hover = async (element: HTMLElement) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: window.document.body })); }); };
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

test('actual App J/K and pointer use one stable overlay while a retiring Done row keeps its physical slot', async () => {
  let rows = [row('a', 0), row('b', 1)], release!: () => void;
  const held = new Promise<void>(yes => { release = yes; });
  const app = await mount('', { compose: false, readPage: () => page(rows), action: async (id: string) => { await held; rows = rows.filter(item => item.id !== id); return { undoId: 'fictional-undo' }; } });
  try {
    const background = surface(app), bar = app.host.querySelector<HTMLElement>('.mail-selection-bar')!, root = app.host.querySelector<HTMLElement>('.mail-selection-highlight')!;
    assert.equal(selected(app), 'a'); assert.equal(background.style.transform, 'translateY(0px) scaleY(1.8888888888888888)');
    assert.equal(root.getAttribute('aria-hidden'), 'true'); assert.equal(root.children.length, 2); assert.equal(root.hidden, false);
    await app.key('j'); assert.equal(selected(app), 'b'); assert.equal(surface(app), background); assert.equal(background.style.transform, 'translateY(68px) scaleY(1)'); assert.equal(bar.style.transform, background.style.transform); assert.equal(root.dataset.selectionMotion, 'keyboard');
    await app.key('k'); assert.equal(selected(app), 'a'); assert.equal(background.style.transform, 'translateY(0px) scaleY(1.8888888888888888)');
    const beforeScroll = scrolls; await hover(app.host.querySelector<HTMLElement>('[data-thread-id="b"]')!); assert.equal(selected(app), 'b'); assert.equal(root.dataset.selectionMotion, 'snap'); assert.equal(scrolls, beforeScroll);
    await hover(app.host.querySelector<HTMLElement>('[data-thread-id="a"]')!); await app.key('e');
    assert.equal(selected(app), 'b'); assert.ok(app.host.querySelector('[data-done-transition="out"]')); assert.equal(background.style.transform, 'translateY(68px) scaleY(1)', 'retained physical A still occupies68px');
    assert.equal(app.requests.filter(item => item.method === 'POST' && item.path.endsWith('/actions')).length, 1);
    assert.equal(app.requests.some(item => /^\/api\/threads\/[^/]+$/.test(item.path)), false);
    await act(async () => { release(); await held; });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    assert.equal(app.host.querySelector('[data-done-transition="out"]'), null); assert.equal(background.style.transform, 'translateY(0px) scaleY(1)');
    assert.equal(surface(app), background); assert.equal(app.requests.some(item => item.path.endsWith('/turns') || item.path.endsWith('/send-operations')), false);
  } finally { release(); await app.close(); }
});

test('actual App disposes a held highlight frame before rich draft/Ask AI and Command focus ownership', async () => {
  const app = await mount('', { compose: false, readPage: () => page([row('a', 0), row('b', 1)]) });
  const originalFrame = globalThis.requestAnimationFrame; let heldFrame: FrameRequestCallback | undefined;
  try {
    await act(async () => { window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true })); });
    await settle(); const question = app.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask AI"]')!; assert.ok(question);
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(question, 'Keep this unsent question'); question.dispatchEvent(new window.Event('input', { bubbles: true })); question.focus(); question.setSelectionRange(2, 8); });
    await settle(); assert.equal(app.host.querySelector<HTMLElement>('.mail-selection-highlight')!.hidden, true);
    globalThis.requestAnimationFrame = callback => { if (!heldFrame) { heldFrame = callback; return 987654321; } return originalFrame(callback); };
    await act(async () => { window.dispatchEvent(new window.Event('resize')); }); assert.ok(heldFrame);
    await app.click('Compose'); const body = app.host.querySelector<HTMLElement>('[aria-label="Message body"]')!, recipients = app.host.querySelector('.recipient-fields'), subject = app.host.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    await act(async () => { body.focus(); body.textContent = 'Keep this rich editor DOM'; body.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText' })); subject.focus(); });
    const expectedHTML = body.innerHTML;
    await act(async () => { subject.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })); });
    assert.ok(app.host.querySelector('input[aria-label="Superhuman Command"]'));
    await act(async () => { heldFrame!(50); });
    assert.equal(app.host.querySelector('.mail-selection-highlight'), null);
    await app.key('Escape'); await settle();
    assert.equal(window.document.activeElement, subject); assert.equal(app.host.querySelector('[aria-label="Message body"]'), body); assert.equal(body.innerHTML, expectedHTML); assert.equal(app.host.querySelector('.recipient-fields'), recipients);
    assert.equal(app.host.querySelector('textarea[aria-label="Ask AI"]'), question); assert.equal(question.value, 'Keep this unsent question'); assert.equal(question.selectionStart, 2); assert.equal(question.selectionEnd, 8);
    assert.equal(app.requests.some(item => item.path.endsWith('/turns') || item.path.endsWith('/send-operations')), false);
  } finally { globalThis.requestAnimationFrame = originalFrame; await app.close(); }
});

test('actual App Command clear then close restores the same list highlight without a navigation intent or action', async () => {
  const app = await mount('', { compose: false, readPage: () => page([row('a', 0), row('b', 1)]) });
  try {
    const background = surface(app), root = app.host.querySelector<HTMLElement>('.mail-selection-highlight')!;
    const geometry = background.style.transform, id = selected(app);
    assert.equal(root.hidden, false);
    await act(async () => { window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })); });
    const command = app.host.querySelector<HTMLInputElement>('input[aria-label="Superhuman Command"]')!; assert.ok(command);
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(command, 'Unsent command query'); command.dispatchEvent(new window.Event('input', { bubbles: true })); command.focus(); command.setSelectionRange(2, 8); });
    await settle(); assert.equal(root.hidden, true); assert.equal(window.document.activeElement, command);
    const escape = () => act(async () => { command.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await escape(); assert.equal(command.value, ''); assert.equal(app.host.querySelector('input[aria-label="Superhuman Command"]'), command); assert.equal(window.document.activeElement, command); assert.equal(root.hidden, true);
    await escape(); await settle(); assert.equal(app.host.querySelector('input[aria-label="Superhuman Command"]'), null);
    assert.equal(window.document.activeElement, window.document.body); assert.equal(selected(app), id);
    assert.equal(surface(app), background); assert.equal(background.style.transform, geometry); assert.equal(root.hidden, false);
    assert.equal(app.requests.some(item => item.method !== 'GET'), false, 'presentation return creates no domain action or hidden query');
  } finally { await app.close(); }
});
