import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { ledgerSnapshot, projectMessage } from '../src/tracking/projection/projection.ts';
import { readClock, readRelative, readISO } from '../src/tracking/presentation.ts';
import type { ImageFetch, MessageContext } from '../src/tracking/projection/types.ts';
const source = fileURLToPath(new URL('../src/tracking/ReadStatus.tsx', import.meta.url));
const compiled = (await transformWithOxc(readFileSync(source, 'utf8'), source, { jsx: { runtime: 'automatic' } })).code;
const hook = registerHooks({ load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }; return url === pathToFileURL(source).href ? { format: 'module', shortCircuit: true, source: compiled } : next(url, context); } });
after(() => hook.deregister());
const dom = new JSDOM('<!doctype html><html><body><textarea id="mail">Authored mail retained</textarea><button id="elsewhere">Elsewhere</button></body></html>');
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'Event', 'KeyboardEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement } = await import('react'), { createRoot } = await import('react-dom/client'), { default: ReadStatus, ReadStatusFooter } = await import('../src/tracking/ReadStatus.tsx');
const at = Date.parse('2026-10-29T12:18:00.013Z'), now = at + 7 * 3600000;
const context: MessageContext = { accountId: 'fixture-account', threadId: 'local-thread', messageId: 'local-message', tracked: true, deliveryConfirmed: true, selfAddressed: false, replyDerived: false };
const event = (patch: Partial<ImageFetch> = {}): ImageFetch => ({ accountId: context.accountId, threadId: context.threadId, messageId: context.messageId, id: 'local-event', registrationId: 'private-fixture-provenance', observedAt: at, device: 'desktop', proxy: 'google-proxy', viewer: null, evidence: 'image-fetch', ...patch });
const project = (events = [event()], scope = context, hasMore = false) => projectMessage(ledgerSnapshot(events, { hasMore, throttled: 0, fullMailbox: false, humanReadVerified: false }), scope);
async function mount(scope = context, projection = project()) {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 const render = async (s = scope, p = projection) => act(async () => root.render(createElement('div', null, createElement(ReadStatus, { scope: s, projection: p, now, timeZone: 'UTC' }), createElement(ReadStatusFooter, { scope: s, projection: p, now }))));
 await render(); return { host, render, button: () => host.querySelector<HTMLButtonElement>('.tracking-check-button')!, open: async () => act(async () => host.querySelector<HTMLButtonElement>('.tracking-check-button')!.click()), close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
test('anonymous compact detail presents grouped count, own check/device SVG, local clock and relative time without provenance or remote assets', async () => {
 const f = await mount(); try {
  await f.open(); const detail = f.host.querySelector<HTMLElement>('[role=tooltip]')!; assert.ok(detail); assert.equal(f.button().getAttribute('aria-describedby'), detail.id); assert.match(detail.querySelector('.tracking-read-header')?.textContent || '', /Image fetched 1 time/); assert.equal(f.host.querySelectorAll('.tracking-check svg path').length, 2); assert.ok(detail.querySelector('svg[role=img][aria-label="Image fetched on desktop"]')); assert.match(detail.textContent || '', /Unknown viewer/); assert.match(detail.textContent || '', /12:18 PM/); assert.match(detail.textContent || '', /\(7 hrs ago\)/); assert.match(detail.textContent || '', /Google image proxy/); assert.match(detail.textContent || '', /doesn’t confirm a person read/); assert.equal(detail.querySelector('time')?.getAttribute('datetime'), '2026-10-29T12:18:00.013Z'); assert.equal(f.host.textContent?.includes('private-fixture-provenance'), false); assert.equal(f.host.querySelectorAll('img,a,iframe,object').length, 0); assert.match(f.host.querySelector('.tracking-read-footer')?.textContent || '', /unknown viewer.*7 hrs ago/);
 } finally { await f.close(); }
});
test('large anonymous history uses bounded scroll presentation and keeps mobile/unknown/proxy meanings distinct', async () => {
 const events = Array.from({ length: 8 }, (_, i) => event({ id: 'event-' + i, observedAt: at - i * 60000, device: i === 0 ? 'mobile' : i === 1 ? 'unknown' : 'desktop', proxy: i === 0 ? 'possible-apple-proxy' : 'unknown' })); const f = await mount(context, project(events, context, true)); try { await f.open(); assert.ok(f.host.querySelector('.tracking-read-content.tracking-read-scroll')); assert.equal(f.host.querySelectorAll('tbody tr').length, 8); assert.match(f.host.querySelector('.tracking-read-header')?.textContent || '', /8\+ times/); assert.ok(f.host.querySelector('svg[aria-label="Image fetched on mobile"]')); assert.ok(f.host.querySelector('svg[aria-label="Device unknown"]')); assert.match(f.host.textContent || '', /Possible Apple privacy proxy/); assert.equal(f.host.textContent?.includes('Opened by'), false); } finally { await f.close(); }
});
test('detail focus, Escape and command-enter stay local without moving or submitting the retained mail editor', async () => {
 const f = await mount(); let bubbled = 0; const listener = () => bubbled++; window.addEventListener('keydown', listener); try {
  const mail = document.querySelector<HTMLTextAreaElement>('#mail')!; await act(async () => f.button().focus()); assert.ok(f.host.querySelector('[role=tooltip]')); await act(async () => f.button().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))); await act(async () => f.button().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); assert.equal(bubbled, 0); assert.equal(f.host.querySelector('[role=tooltip]'), null); assert.equal(document.activeElement === f.button(), true); assert.equal(mail.value, 'Authored mail retained'); await act(async () => mail.focus()); assert.equal(document.activeElement === mail, true); assert.equal(f.host.querySelector('[role=tooltip]'), null);
 } finally { window.removeEventListener('keydown', listener); await f.close(); }
});
test('pinned detail remains pinned on pointer re-entry and a new message can open on its first click without prior details leaking', async () => {
 const f = await mount(); try {
  await f.open(); const container = f.host.querySelector('.tracking-read-status')!; await act(async () => { container.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })); container.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })); container.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })); }); assert.ok(f.host.querySelector('[role=tooltip]'));
  const other = { ...context, messageId: 'other-local-message' }, p = project([event({ messageId: other.messageId, observedAt: at - 3600000 })], other); await f.render(other, p); assert.equal(f.host.querySelector('[role=tooltip]'), null); assert.equal(f.button().getAttribute('aria-expanded'), 'false'); await f.open(); assert.ok(f.host.querySelector('[role=tooltip]')); assert.match(f.host.textContent || '', /8 hrs ago/); assert.equal(f.host.querySelector('time')?.getAttribute('datetime'), '2026-10-29T11:18:00.013Z');
 } finally { await f.close(); }
});
test('foreign account/message projection hides both prepared detail and footer immediately', async () => {
 const f = await mount(); try { await f.open(); await f.render({ ...context, accountId: 'other-fixture-account' }, project()); assert.equal(f.host.querySelector('.tracking-read-status'), null); assert.equal(f.host.querySelector('.tracking-read-footer'), null); assert.equal(f.host.textContent, ''); } finally { await f.close(); }
});
test('self-addressed and reply-derived statuses never become anonymous direct-fetch rows', async () => {
 for (const patch of [{ selfAddressed: true }, { replyDerived: true }]) { const scoped = { ...context, ...patch }, f = await mount(scoped, project([], scoped)); try { await f.open(); assert.equal(f.host.querySelector('tbody tr'), null); assert.equal(f.host.textContent?.includes('Unknown viewer'), false); assert.match(f.host.textContent || '', patch.selfAddressed ? /addressed only to you/ : /Reply activity is separate/); } finally { await f.close(); } }
});
test('display times distinguish DST-fold instants while preserving their original milliseconds', () => {
 const before = Date.parse('2026-11-01T08:30:00.013Z'), after = Date.parse('2026-11-01T09:30:00.013Z'); assert.equal(readClock(before, 'America/Los_Angeles'), '1:30 AM'); assert.equal(readClock(after, 'America/Los_Angeles'), '1:30 AM'); assert.equal(readRelative(before, after), '1 hr ago'); assert.equal(readRelative(after, after), 'just now'); assert.notEqual(readISO(before), readISO(after)); assert.equal(readISO(before)?.endsWith('.013Z'), true);
});
test('invalid clocks and future timestamps stay unavailable rather than inventing a clock or past read', () => {
 assert.equal(readClock(at, 'Invalid/Zone'), 'Time unavailable'); assert.equal(readClock(Number.NaN, 'UTC'), 'Time unavailable'); assert.equal(readRelative(now + 1, now), 'Time unavailable'); assert.equal(readRelative(at, Number.POSITIVE_INFINITY), 'Time unavailable'); assert.equal(readISO(Number.NaN), undefined);
});
