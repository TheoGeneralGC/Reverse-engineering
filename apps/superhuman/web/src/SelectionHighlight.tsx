import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createSelectionHighlight, type HighlightSnapshot } from './selection-highlight.ts';
import './selection-highlight.css';

export default function SelectionHighlight(props: HighlightSnapshot & { container: RefObject<HTMLElement | null>; currentOwner: () => string | null }) {
  const current = useRef(props); current.current = props;
  const root = useRef<HTMLSpanElement>(null), background = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createSelectionHighlight> | null>(null);
  const resize = useRef<ResizeObserver | null>(null), observedRow = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const container = current.current.container.current;
    if (!container || !root.current || !background.current || !bar.current) return;
    const next = createSelectionHighlight({ container, root: root.current, background: background.current, bar: bar.current,
      read: () => current.current, currentOwner: () => current.current.currentOwner(),
      frame: callback => requestAnimationFrame(callback), cancelFrame: handle => cancelAnimationFrame(handle),
      reduced: () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    }); controller.current = next; next.update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(next.refresh) : null;
    resize.current = observer; observer?.observe(container);
    return () => { observer?.disconnect(); if (resize.current === observer) { resize.current = null; observedRow.current = null; } next.dispose(); if (controller.current === next) controller.current = null; };
  }, [props.owner]);
  useLayoutEffect(() => {
    controller.current?.update();
    const row = [...(props.container.current?.querySelectorAll<HTMLElement>('.mail-row[data-thread-id]') ?? [])].find(element => element.dataset.threadId === props.selectedId) ?? null;
    if (row !== observedRow.current) { if (observedRow.current) resize.current?.unobserve(observedRow.current); observedRow.current = row; if (row) resize.current?.observe(row); }
  });
  return <span ref={root} className="mail-selection-highlight" aria-hidden="true" hidden>
    <div ref={background} className="mail-selection-surface" />
    <div ref={bar} className="mail-selection-bar" />
  </span>;
}
