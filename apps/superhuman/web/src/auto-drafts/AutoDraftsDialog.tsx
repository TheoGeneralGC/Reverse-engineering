import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { DirectPreferences } from '../../../api/src/auto-drafts-contract.ts';
import useAutoDrafts, { type Port } from './useAutoDrafts.ts';
import './auto-drafts.css';
type Origin = { element: HTMLElement; isCurrent: () => boolean };
type Props = { accountId: string; onClose: () => void; onPersonalization?: () => void; backtickAsEscape?: boolean; origin?: Origin; port?: Port };
const fields: [keyof DirectPreferences, string, string][] = [
  ['followUpsEnabled', 'Follow-ups', 'Preference for a draft when a returning reminder needs a follow-up.'],
  ['responsesEnabled', 'Responses', 'Preference for a draft when a message needs a response.'],
  ['onlyEmailedBefore', "Only draft a reply to people I've emailed before", 'This preference can be changed while Responses is on.'],
];
export default function AutoDraftsDialog({ accountId, onClose, onPersonalization, backtickAsEscape = false, origin, port }: Props) {
  const { model, state } = useAutoDrafts(accountId, port), id = useId();
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), confirmation = useRef<HTMLDivElement>(null);
  const focus = useRef<{ model: typeof model; pending: boolean }>({ model, pending: true });
  const [discard, setDiscard] = useState<'close' | 'personalization' | null>(null), beforeConfirm = useRef<Element | null>(null);
  if (focus.current.model !== model) focus.current = { model, pending: true };
  useLayoutEffect(() => {
    const previous = origin?.element || document.activeElement, owner = dialog.current;
    heading.current?.focus();
    return () => {
      const active = document.activeElement;
      if ((!origin || origin.isCurrent()) && previous instanceof HTMLElement && previous.isConnected && (active === document.body || !!owner?.contains(active))) previous.focus();
    };
  }, [model]);
  useLayoutEffect(() => { if (state.base && focus.current.pending) { focus.current.pending = false; if (document.activeElement === heading.current) dialog.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus(); } }, [model, !!state.base]);
  useEffect(() => { if (discard) confirmation.current?.querySelector<HTMLButtonElement>('button')?.focus(); else if (beforeConfirm.current instanceof HTMLElement && beforeConfirm.current.isConnected) { beforeConfirm.current.focus(); beforeConfirm.current = null; } }, [discard]);
  const working = state.pending === 'preparing' || state.pending === 'saving' || state.pending === 'checking';
  const finish = (target: 'close' | 'personalization') => { if (target === 'personalization') onPersonalization?.(); else onClose(); };
  const requestClose = (target: 'close' | 'personalization' = 'close') => {
    if (model.schedulingDirty) { beforeConfirm.current = document.activeElement; setDiscard(target); } else finish(target);
  };
  const close = useRef(requestClose); close.current = requestClose;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || backtickAsEscape && event.key === '`') { event.preventDefault(); event.stopImmediatePropagation(); if (discard) setDiscard(null); else close.current(); return; }
      if ((event.metaKey || event.ctrlKey) && ['Enter', 'k', 'j'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.key === 'Tab') {
        const scope = discard ? confirmation.current : dialog.current;
        const controls = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') || []), first = controls[0], last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
  }, [backtickAsEscape, discard]);
  return <div className="auto-drafts-overlay" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="auto-drafts-dialog" role="dialog" aria-modal="true" aria-labelledby={id + '-title'} ref={dialog} data-auto-drafts-account={accountId}>
      <div className="auto-drafts-surface" inert={!!discard}>
        <header><h1 id={id + '-title'} tabIndex={-1} ref={heading}>Auto Drafts</h1><button type="button" aria-label="Close Auto Drafts" onClick={() => requestClose()}>×</button></header>
        <p className="auto-drafts-availability" role="status">These preferences are saved for this account. Automatic drafting is not implemented in this version.</p>
        {!state.base && state.pending === 'loading' && <p role="status">Loading Auto Drafts…</p>}
        {state.base && <div className="auto-drafts-controls">
          {fields.map(([field, label, description]) => <label className={'auto-drafts-row ' + (field === 'onlyEmailedBefore' ? 'auto-drafts-subordinate' : '')} key={field}>
            <span><strong>{label}</strong><small>{description}</small></span>
            <input aria-label={label} data-auto-drafts-field={field} type="checkbox" checked={state.intent?.field === field ? state.intent.value : state.base!.preferences.value[field]} disabled={model.locked || field === 'onlyEmailedBefore' && !state.base!.preferences.value.responsesEnabled} onChange={event => void model.setPreference(field, event.target.checked)} />
          </label>)}
          <section className="auto-drafts-teammate" aria-labelledby={id + '-team'}>
            <label className="auto-drafts-row"><span id={id + '-team'}><strong>Add teammate on Cc to handle scheduling</strong></span><input type="checkbox" aria-label="Add teammate on Cc to handle scheduling" checked={state.base.scheduling.value.enabled} disabled /></label>
            <p>A Team directory is not available. Teammate selection, scheduling Save and preview are unavailable.</p>
          </section>
        </div>}
        {state.pending && state.pending !== 'loading' && <p role="status">{state.pending === 'checking' ? 'Checking the saved action…' : state.pending === 'preparing' ? 'Preparing this preference…' : 'Saving this preference…'}</p>}
        {state.notice && <p className="auto-drafts-notice" role="status">{state.notice}</p>}
        {state.unknown && <p className="auto-drafts-error" role="status">The previous change has not been confirmed. Check that same saved action before making another change. Closing will not undo an accepted save.</p>}
        {state.error && <p className="auto-drafts-error" role="alert">{state.error}</p>}
        <div className="auto-drafts-recovery">
          {state.unknown && <button disabled={!!state.pending} onClick={() => void model.recover()}>Check saved action</button>}
          {state.phase === 'prepared' && <><button disabled={!!state.pending} onClick={() => void model.resumePrepared()}>Apply saved change</button><button disabled={!!state.pending} onClick={() => model.discardPrepared()}>Discard unsent change</button></>}
          {!state.unknown && !state.phase && (state.error || state.conflict) && <button disabled={!!state.pending} onClick={() => void model.load()}>Reload saved settings</button>}
        </div>
        <footer><button type="button" className="auto-drafts-link" disabled={working || !onPersonalization} onClick={() => requestClose('personalization')}>Personalization</button><button type="button" onClick={() => requestClose()}>Done</button></footer>
      </div>
      {discard && <div className="auto-drafts-confirm-overlay"><div className="auto-drafts-confirm" role="alertdialog" aria-modal="true" aria-labelledby={id + '-discard'} ref={confirmation}><h2 id={id + '-discard'}>Discard your scheduling changes?</h2><p>Only the local staged scheduling text will be discarded. Accepted direct preference changes are separate.</p><button onClick={() => setDiscard(null)}>Keep editing</button><button onClick={() => { model.discardScheduling(); finish(discard); }}>Discard changes</button></div></div>}
    </div>
  </div>;
}
