import { useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import Icon from './Icon.tsx';
import './shortcuts-overlay.css';

type Props = { open: boolean; suppressed: boolean; dialogRef: Ref<HTMLElement>; onClose: () => void };
type Presentation = { present: boolean; phase: 'enter' | 'open' | 'exit' };
const shortcuts = [['Compose','C'],['Open conversation','Enter'],['Reply','R'],['Forward','F'],['Mark Done','E'],['Remind Me','H'],['Star','S'],['Read / unread','U'],['Select conversation','X'],['Undo','Z'],['Search','/'],['Command','⌘ K'],['Ask AI','?'],['Shortcuts','⌘ K → Shortcuts'],['Next / previous','J / K'],['Go to Inbox','G I'],['Go to Sent','G T'],['Back','Esc'],['Send','⌘ Enter']];

/** Only the original ShortcutsHelp consumer is bound to this legacy lifecycle.
 * Its 200ms CSS fade and 250ms visual lifetime are separate declared clocks.
 * App still owns logical close and focus; retiring help cannot own either. */
export default function ShortcutsOverlay({ open, suppressed, dialogRef, onClose }: Props) {
  const active = open && !suppressed;
  const [presentation, setPresentation] = useState<Presentation>({ present: false, phase: 'enter' });
  const backdropRef = useRef<HTMLDivElement>(null);
  const present = useRef(false), generation = useRef(0);
  // Another modal changes interaction ownership without restarting this exit.
  useLayoutEffect(() => {
    const owner = ++generation.current;
    let frame: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      const reopening = present.current;
      present.current = true;
      setPresentation({ present: true, phase: reopening ? 'open' : 'enter' });
      // Resolve the inserted zero-opacity style before the frame can open it.
      // A single rAF alone can coalesce cold insertion and the open style.
      if (!reopening && backdropRef.current) {
        void backdropRef.current.ownerDocument.defaultView?.getComputedStyle(backdropRef.current).opacity;
      }
      frame = requestAnimationFrame(() => {
        if (generation.current === owner) setPresentation({ present: true, phase: 'open' });
      });
    } else if (present.current) {
      setPresentation({ present: true, phase: 'exit' });
      timer = setTimeout(() => {
        if (generation.current !== owner) return;
        present.current = false;
        setPresentation({ present: false, phase: 'exit' });
      }, 250);
    }
    return () => {
      generation.current++;
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active]);
  if (!active && !presentation.present) return null;
  return <div ref={backdropRef} className="modal-backdrop shortcuts-overlay" data-shortcuts-phase={presentation.phase} aria-hidden={!active || undefined} inert={!active} onMouseDown={event => { if (active && event.target === event.currentTarget) onClose(); }}>
    <section ref={active ? dialogRef : undefined} className="modal" role={active ? 'dialog' : undefined} aria-modal={active || undefined} aria-label="shortcuts">
      <div className="modal-heading"><h2>Keyboard Shortcuts</h2><button type="button" className="icon-button" aria-label="Close dialog" title="Close dialog" onClick={() => { if (active) onClose(); }}><Icon name="x"/></button></div>
      <div className="shortcut-grid">{shortcuts.map(([name, key]) => <div key={name}>{name}<kbd>{key}</kbd></div>)}</div>
    </section>
  </div>;
}
