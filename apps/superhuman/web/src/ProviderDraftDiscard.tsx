import { useLayoutEffect, useRef } from 'react';
import type { ProviderDiscardState } from './provider-draft-discard.ts';
import './provider-draft-discard.css';

export default function ProviderDraftDiscard({ state, canDiscard, onDiscard, onKeep, onCheck, onFinish, onCheckCloud, cloudChecking = false }: {
  state: ProviderDiscardState; canDiscard: boolean;
  onDiscard: () => void | Promise<unknown>; onKeep: () => void;
  onCheck: () => void | Promise<unknown>; onFinish: () => void;
  onCheckCloud?: () => void | Promise<unknown>; cloudChecking?: boolean;
}) {
  const waiting = state.submitting || state.checking || cloudChecking;
  const pending = state.blocked && !state.settled;
  const cloud = state.response?.providerDraft;
  const canCheckCloud = pending && cloud && (cloud.error?.retry === 'explicit-check' || ['outcome_unknown', 'remote_conflict'].includes(cloud.state));
  const title = state.settled ? 'Draft discarded' : state.submitting ? 'Discarding draft…' : pending ? 'Discard pending' : 'Discard this draft?';
  const root = useRef<HTMLElement>(null), mounted = useRef(false);
  useLayoutEffect(() => {
    const node = root.current; if (!node) return;
    if (!mounted.current || node.contains(node.ownerDocument.activeElement)) (node.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? node).focus();
    mounted.current = true;
  }, [waiting, state.settled, pending]);
  return <section ref={root} tabIndex={-1} className="provider-draft-discard" role="alertdialog" aria-modal="true" aria-label={title} aria-busy={waiting} data-provider-discard-state={state.settled ? state.response?.resolution : state.unknown ? 'unknown' : state.submitting ? 'submitting' : pending ? 'pending' : 'review'} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (!state.blocked && !waiting) onKeep(); }
    if (event.key === 'Tab') {
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []), first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); root.current?.focus(); }
      else if (event.shiftKey && (event.target === first || event.target === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (event.target === last || event.target === root.current)) { event.preventDefault(); first.focus(); }
    }
  }}>
    <h2>{title}</h2>
    {state.settled ? <p>{state.response?.resolution === 'unavailable' ? 'The Gmail draft is no longer available. This discard is complete.' : 'This draft has been discarded.'}</p>
      : pending ? <p>{state.unknown ? 'Discard is unconfirmed. Keep this draft open and check its status before doing anything else.' : 'Your draft stays here until its discard is confirmed.'}</p>
      : <p>Discard this draft from here and Gmail?</p>}
    {state.error && <p className="provider-draft-discard-error" role="alert">{state.error}</p>}
    <div className="provider-draft-discard-actions">
      {state.settled ? <button type="button" disabled={waiting || state.released} onClick={onFinish}>Close discarded draft</button>
        : pending ? <>{canCheckCloud && onCheckCloud && <button type="button" disabled={waiting} onClick={() => void onCheckCloud()}>Check Gmail status</button>}<button type="button" disabled={waiting} onClick={() => void onCheck()}>{state.checking ? 'Checking discard…' : 'Check discard status'}</button></>
        : <><button type="button" onClick={onKeep}>Keep draft</button><button type="button" disabled={!canDiscard || waiting} onClick={() => void onDiscard()}>Discard draft</button></>}
    </div>
  </section>;
}
