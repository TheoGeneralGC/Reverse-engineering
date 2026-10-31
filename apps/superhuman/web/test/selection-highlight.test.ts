import '../../api/test/archive-network-deny.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSelectionHighlight, selectionGeometry, type HighlightSnapshot } from '../src/selection-highlight.ts';

function fixture() {
  const dom = new JSDOM('<!doctype html><body><section><span aria-hidden="true"><div></div><div></div></span><div class="heading"></div><div class="mail-row" data-thread-id="a"></div><div class="mail-row" aria-hidden="true" data-done-transition="out"></div><div class="heading"></div><div class="mail-row checked" data-thread-id="b"></div></section><textarea></textarea></body>', { pretendToBeVisual: true });
  const { document } = dom.window, original = globalThis.HTMLElement;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const container = document.querySelector('section')!, root = container.querySelector('span')!, [background, bar] = [...root.children] as HTMLElement[];
  const a = container.querySelector<HTMLElement>('[data-thread-id="a"]')!, b = container.querySelector<HTMLElement>('[data-thread-id="b"]')!;
  for (const [key, value] of Object.entries({ clientWidth: 640, clientHeight: 300, scrollHeight: 800 })) Object.defineProperty(container, key, { configurable: true, value });
  const sizes = new Map<HTMLElement, { top: number; left: number; width: number; height: number }>([[a, { top: 24, left: 6, width: 620, height: 68 }], [b, { top: 176, left: 6, width: 620, height: 36 }]]);
  for (const [row] of sizes) for (const [key, field] of Object.entries({ offsetTop: 'top', offsetLeft: 'left', offsetWidth: 'width', offsetHeight: 'height' })) Object.defineProperty(row, key, { configurable: true, get: () => sizes.get(row)![field as 'top' | 'left' | 'width' | 'height'] });
  for (const row of [a, b]) Object.defineProperty(row, 'offsetParent', { configurable: true, get: () => container });
  let currentOwner: string | null = 'owner-a', snapshot: HighlightSnapshot = { owner: currentOwner, selectedId: 'a', presentation: { owner: currentOwner, revision: 1, origin: 'layout' }, enabled: true };
  let sequence = 0, scrolls = 0; const frames = new Map<number, FrameRequestCallback>(), allFrames: FrameRequestCallback[] = [];
  for (const row of [a, b]) row.scrollIntoView = () => { scrolls++; container.scrollTop = sizes.get(row)!.top; };
  const controller = createSelectionHighlight({ container, root, background, bar, read: () => snapshot, currentOwner: () => currentOwner,
    frame(callback) { frames.set(++sequence, callback); allFrames.push(callback); return sequence; }, cancelFrame(handle) { frames.delete(handle); }, reduced: () => reduced });
  let reduced = false;
  return { dom, container, root, background, bar, a, b, sizes, controller, frames, allFrames,
    set(next: HighlightSnapshot) { snapshot = next; }, owner(next: string | null) { currentOwner = next; }, reduced(next: boolean) { reduced = next; }, get snapshot() { return snapshot; }, get scrolls() { return scrolls; },
    move(id: string, revision: number, origin: 'keyboard' | 'pointer' | 'layout') { snapshot = { ...snapshot, selectedId: id, presentation: { owner: snapshot.owner!, revision, origin } }; controller.update(); },
    flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(10); } },
    close() { controller.dispose(); dom.window.close(); globalThis.HTMLElement = original; },
  };
}

test('shared surfaces use actual68/36px rows plus retained ghost/heading slots and exclude OUT targets', () => {
  const f = fixture(); try {
    f.a.style.transform = 'translateX(-100%)'; f.controller.update();
    assert.deepEqual(selectionGeometry(f.container, f.a), { x: 6, y: 24, width: 620, height: 68 });
    assert.equal(f.background.style.transform, 'translateY(24px) scaleY(1.8888888888888888)'); assert.equal(f.bar.style.transform, f.background.style.transform);
    f.move('b', 2, 'keyboard'); assert.equal(f.background.style.transform, 'translateY(176px) scaleY(1)'); assert.equal(f.root.dataset.selectionMotion, 'keyboard'); assert.equal(f.root.dataset.checked, 'true');
    assert.equal(f.container.getAttribute('data-selection-highlight'), 'ready'); assert.equal(f.root.children.length, 2); assert.equal(f.root.getAttribute('aria-hidden'), 'true');
    f.b.setAttribute('data-done-transition', 'out'); f.move('b', 3, 'layout'); assert.equal(f.root.hidden, true); assert.equal(f.container.hasAttribute('data-selection-highlight'), false);
  } finally { f.close(); }
});

test('rapid keyboard retargeting never waits; pointer never scrolls; offscreen keyboard and reduced policy snap', () => {
  const f = fixture(); try {
    f.controller.update(); f.move('b', 2, 'keyboard'); f.move('a', 3, 'keyboard'); f.move('b', 4, 'keyboard');
    assert.equal(f.background.style.transform, 'translateY(176px) scaleY(1)'); assert.equal(f.frames.size, 0); assert.equal(f.scrolls, 0);
    f.container.scrollTop = 500; f.move('a', 5, 'pointer'); assert.equal(f.scrolls, 0); assert.equal(f.root.dataset.selectionMotion, 'snap');
    f.move('b', 6, 'keyboard'); assert.equal(f.scrolls, 1); assert.equal(f.root.dataset.selectionMotion, 'snap');
    f.container.scrollTop = 0; f.reduced(true); f.move('a', 7, 'keyboard'); assert.equal(f.root.dataset.selectionMotion, 'snap');
  } finally { f.close(); }
});

test('an old scheduled controller cannot adopt another list owner with identical row IDs', () => {
  const f = fixture(); try {
    f.controller.update(); const before = f.background.style.transform; f.controller.refresh();
    f.owner('owner-b'); f.set({ owner: 'owner-b', selectedId: 'b', presentation: { owner: 'owner-b', revision: 2, origin: 'keyboard' }, enabled: true });
    f.flush(); assert.equal(f.background.style.transform, before, 'old owner must not paint replacement owner rows'); assert.equal(f.root.hidden, true); assert.equal(f.container.hasAttribute('data-selection-highlight'), false);
    f.controller.dispose(); for (const callback of f.allFrames) callback(20); assert.equal(f.background.style.transform, before);
  } finally { f.close(); }
});

test('pointer ownership cancels a running keyboard transition even at the identical target without scrolling', () => {
  const f = fixture(); try {
    let flushes = 0; f.root.getClientRects = () => { flushes++; return Object.assign([], { item: () => null }); };
    f.controller.update(); f.move('b', 2, 'keyboard'); const before = flushes;
    assert.equal(f.root.dataset.selectionMotion, 'keyboard'); f.move('b', 3, 'pointer');
    assert.equal(f.root.dataset.selectionMotion, 'snap'); assert.equal(flushes, before + 1); assert.equal(f.scrolls, 0);
    assert.equal(f.background.style.transform, 'translateY(176px) scaleY(1)'); assert.equal(f.bar.style.transform, f.background.style.transform);
  } finally { f.close(); }
});

test('editor focus, disabled context and invalid measurement retain focus without stale overlay work', () => {
  const f = fixture(); try {
    f.controller.update(); const textarea = f.dom.window.document.querySelector('textarea')!; textarea.focus(); f.flush();
    assert.equal(f.root.hidden, true); f.move('b', 2, 'pointer'); assert.equal(f.dom.window.document.activeElement, textarea); assert.equal(f.root.hidden, true); assert.equal(f.scrolls, 0);
    f.set({ ...f.snapshot, enabled: false }); f.controller.update(); assert.equal(f.root.hidden, true);
    f.sizes.get(f.b)!.height = 0; f.controller.refresh(); f.flush(); assert.equal(f.container.hasAttribute('data-selection-highlight'), false);
    f.controller.refresh(); const oldFrames = [...f.allFrames]; f.controller.dispose(); for (const callback of oldFrames) callback(30); assert.equal(f.frames.size, 0); assert.equal(f.root.hidden, true);
  } finally { f.close(); }
});

test('same-owner list return restores without an intent while editor, disabled context and window blur still suppress', () => {
  const f = fixture(); try {
    f.controller.update(); assert.equal(f.root.hidden, false);
    const geometry = f.background.style.transform, presentation = f.snapshot.presentation;
    const textarea = f.dom.window.document.querySelector('textarea')!; textarea.focus(); f.flush();
    f.set({ ...f.snapshot, enabled: false }); f.controller.update(); assert.equal(f.root.hidden, true);
    textarea.remove(); assert.equal(f.dom.window.document.activeElement, f.dom.window.document.body);
    f.controller.refresh(); f.flush(); assert.equal(f.root.hidden, true, 'disabled context cannot restore');
    f.set({ ...f.snapshot, enabled: true }); f.controller.update();
    assert.equal(f.root.hidden, false, 'settled BODY return restores without a focusin or new intent');
    assert.equal(f.snapshot.presentation, presentation); assert.equal(f.background.style.transform, geometry); assert.equal(f.scrolls, 0);
    f.dom.window.dispatchEvent(new f.dom.window.Event('blur')); assert.equal(f.root.hidden, true);
    f.controller.refresh(); f.flush(); assert.equal(f.root.hidden, true, 'old scheduled update cannot override window blur');
    f.dom.window.document.body.dispatchEvent(new f.dom.window.FocusEvent('focusin', { bubbles: true })); f.flush();
    assert.equal(f.root.hidden, true, 'document focusin cannot claim an inactive window');
    f.move('b', 2, 'keyboard'); assert.equal(f.root.hidden, true, 'even a key intent cannot override inactive window');
    f.dom.window.dispatchEvent(new f.dom.window.Event('focus')); f.flush(); assert.equal(f.root.hidden, false);
    const input = f.dom.window.document.createElement('input'); f.dom.window.document.body.append(input); input.focus(); f.flush();
    f.dom.window.dispatchEvent(new f.dom.window.Event('focus')); f.flush(); assert.equal(f.root.hidden, true, 'window focus cannot steal an editor context');
    assert.equal(f.dom.window.document.activeElement, input);
  } finally { f.close(); }
});
