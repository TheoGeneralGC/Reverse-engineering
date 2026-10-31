export type SelectionOrigin = 'keyboard' | 'pointer' | 'layout';
export type SelectionPresentation = Readonly<{ owner: string; revision: number; origin: SelectionOrigin }>;
export type HighlightSnapshot = Readonly<{ owner: string | null; selectedId: string | null; presentation?: SelectionPresentation; enabled: boolean }>;
export type HighlightGeometry = Readonly<{ x: number; y: number; width: number; height: number }>;

export const selectionHighlightTokens = Object.freeze({ baseHeight: 36, durationMs: 256, easing: 'cubic-bezier(0.19, 1, 0.22, 1)' });

/** Layout coordinates deliberately ignore each row's horizontal dismissal
 * transform. Retiring rows and headings still contribute their real slots. */
export function selectionGeometry(container: HTMLElement, row: HTMLElement): HighlightGeometry | null {
  if (!container.contains(row) || !container.isConnected || !row.isConnected || row.inert || row.getAttribute('aria-hidden') === 'true' ||
      row.hasAttribute('data-done-transition') && row.getAttribute('data-done-transition') === 'out' ||
      container.clientWidth <= 0 || container.clientHeight <= 0 || row.offsetWidth <= 0 || row.offsetHeight <= 0) return null;
  let node: HTMLElement | null = row, x = 0, y = 0;
  const seen = new Set<HTMLElement>();
  while (node !== container) {
    if (!node || seen.has(node) || !container.contains(node)) return null;
    seen.add(node); x += node.offsetLeft; y += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  const value = { x, y, width: row.offsetWidth, height: row.offsetHeight };
  return Object.values(value).every(Number.isFinite) ? value : null;
}

let instance = 0;
/** Presentation only. No model selection, request, focus() or native operation
 * is performed here. Every delayed frame belongs to one live list owner. */
export function createSelectionHighlight(options: {
  container: HTMLElement; root: HTMLElement; background: HTMLElement; bar: HTMLElement;
  read: () => HighlightSnapshot; currentOwner: () => string | null;
  frame: (callback: FrameRequestCallback) => number; cancelFrame: (handle: number) => void;
  reduced: () => boolean;
}) {
  const { container, root, background, bar } = options, marker = String(++instance), boundOwner = options.read().owner;
  let live = true, frame: number | null = null, measured: HighlightGeometry | null = null, owner: string | null = null;
  let revision = -1, selected: string | null = null, contextOwned = false, windowActive = true;
  const own = (snapshot: HighlightSnapshot) => {
    const current = options.read();
    return live && boundOwner !== null && snapshot.owner === boundOwner && options.currentOwner() === boundOwner && current.owner === boundOwner &&
      current.selectedId === snapshot.selectedId && current.presentation?.revision === snapshot.presentation?.revision && current.enabled === snapshot.enabled && container.isConnected;
  };
  const editable = () => {
    const active = container.ownerDocument.activeElement;
    return active instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable || active.closest('[contenteditable="true"]') !== null);
  };
  const inList = () => {
    const active = container.ownerDocument.activeElement;
    return !active || active === container.ownerDocument.body || active === container.ownerDocument.documentElement || container.contains(active);
  };
  const hide = (clear = false) => {
    if (root.hasAttribute('data-selection-owner') && root.getAttribute('data-selection-owner') !== marker) return;
    root.hidden = true;
    if (clear) {
      measured = null;
      if (container.getAttribute('data-selection-highlight-owner') === marker) {
        container.removeAttribute('data-selection-highlight'); container.removeAttribute('data-selection-highlight-owner');
      }
      if (root.getAttribute('data-selection-owner') === marker) root.removeAttribute('data-selection-owner');
    }
  };
  const update = () => {
    const snapshot = options.read();
    if (!own(snapshot) || !snapshot.selectedId) { hide(true); return; }
    const newOwner = owner !== snapshot.owner, newIntent = revision !== (snapshot.presentation?.revision ?? 0) || selected !== snapshot.selectedId;
    if (newOwner) measured = null;
    // Editor/modal removal can return activeElement to BODY without a focusin.
    // Reconcile that current list context without manufacturing a new intent.
    // A document focus event cannot override an actual window blur.
    if (!windowActive || !snapshot.enabled || editable()) contextOwned = false;
    else if (inList() || newIntent && ['keyboard', 'pointer'].includes(snapshot.presentation?.origin ?? '')) contextOwned = true;
    owner = snapshot.owner; revision = snapshot.presentation?.revision ?? 0; selected = snapshot.selectedId;
    const row = [...container.querySelectorAll<HTMLElement>('.mail-row[data-thread-id]')].find(element => element.dataset.threadId === snapshot.selectedId);
    const geometry = row ? selectionGeometry(container, row) : null;
    if (!geometry || !row || !own(snapshot)) { hide(true); return; }
    const outside = geometry.y < container.scrollTop || geometry.y + geometry.height > container.scrollTop + container.clientHeight;
    const keyboard = !newOwner && newIntent && snapshot.presentation?.origin === 'keyboard';
    const animate = keyboard && measured !== null && !outside && !options.reduced();
    // Hover never reaches this scroll path. An offscreen key target snaps,
    // matching the bounded source policy without waiting for an animation.
    if (keyboard && outside && snapshot.enabled && contextOwned && !editable()) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      if (!own(snapshot)) { hide(true); return; }
    }
    const changed = !measured || Object.keys(geometry).some(key => geometry[key as keyof HighlightGeometry] !== measured![key as keyof HighlightGeometry]);
    // A pointer transfer must cancel an in-flight keyboard transition even if
    // both intents already have the same final geometry.
    if (changed || newIntent && snapshot.presentation?.origin === 'pointer') {
      for (const element of [background, bar]) {
        element.style.transition = animate ? '' : 'none';
        element.style.left = geometry.x + 'px'; element.style.width = geometry.width + 'px';
        element.style.transform = `translateY(${geometry.y}px) scaleY(${geometry.height / selectionHighlightTokens.baseHeight})`;
      }
      root.dataset.selectionMotion = animate ? 'keyboard' : 'snap';
      if (!animate) {
        root.getClientRects();
        if (!own(snapshot)) { hide(true); return; }
        background.style.transition = ''; bar.style.transition = '';
      }
      measured = geometry;
    }
    if (!own(snapshot)) { hide(true); return; }
    root.setAttribute('data-selection-owner', marker);
    container.setAttribute('data-selection-highlight-owner', marker); container.setAttribute('data-selection-highlight', 'ready');
    root.dataset.checked = String(row.classList.contains('checked'));
    root.hidden = !snapshot.enabled || !windowActive || !contextOwned || editable() || container.ownerDocument.hidden;
  };
  const refresh = () => {
    if (!live || frame !== null) return;
    frame = options.frame(() => { frame = null; if (live) update(); });
  };
  const focus = () => { contextOwned = windowActive && inList() && !editable(); refresh(); };
  const windowFocus = () => { windowActive = true; focus(); };
  const blur = () => { windowActive = false; contextOwned = false; hide(); };
  container.ownerDocument.addEventListener('focusin', focus); container.ownerDocument.addEventListener('focusout', refresh);
  container.ownerDocument.addEventListener('visibilitychange', refresh); container.addEventListener('scroll', refresh, { passive: true });
  const window = container.ownerDocument.defaultView;
  window?.addEventListener('resize', refresh); window?.addEventListener('blur', blur); window?.addEventListener('focus', windowFocus);
  return {
    update, refresh,
    dispose() {
      if (!live) return; live = false;
      if (frame !== null) options.cancelFrame(frame); frame = null; hide(true);
      container.ownerDocument.removeEventListener('focusin', focus); container.ownerDocument.removeEventListener('focusout', refresh);
      container.ownerDocument.removeEventListener('visibilitychange', refresh); container.removeEventListener('scroll', refresh);
      window?.removeEventListener('resize', refresh); window?.removeEventListener('blur', blur); window?.removeEventListener('focus', windowFocus);
    },
  };
}
