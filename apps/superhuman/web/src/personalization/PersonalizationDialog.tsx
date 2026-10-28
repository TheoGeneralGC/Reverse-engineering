import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PersonalizationField } from '../../../api/src/personalization-types.ts';
import { PersonalizationModel, personalizationFormError, type PersonalizationPort } from './model.ts';
import './personalization.css';

const categories = [['greeting', 'Greeting & Signoff'], ['company', 'Job Title & Company'], ['writing', 'Writing'], ['scheduling', 'Scheduling'], ['events', 'Events'], ['facts', 'About Me'], ['knowledge', 'Knowledge Base']] as const;
type Props = { accountId: string; accountLabel?: string; backtickAsEscape?: boolean; onClose: () => void; onOpenKnowledge?: () => void | boolean | Promise<void | boolean>; port?: PersonalizationPort };
export default function PersonalizationDialog({ accountId, accountLabel, backtickAsEscape = false, onClose, onOpenKnowledge, port }: Props) {
  const model = useMemo(() => new PersonalizationModel(accountId, port), [accountId, port]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot), id = useId();
  const [category, setCategory] = useState<string>('greeting'), [discard, setDiscard] = useState<'close' | 'knowledge' | null>(null), [navigating, setNavigating] = useState(false), [navigationError, setNavigationError] = useState('');
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), confirmation = useRef<HTMLDivElement>(null), previousDiscardFocus = useRef<Element | null>(null), latest = useRef(model), mounted = useRef(true);
  const initialFocus = useRef({ model, pending: true });
  if (initialFocus.current.model !== model) initialFocus.current = { model, pending: true };
  latest.current = model;
  useEffect(() => { mounted.current = true; model.activate(); void model.load(); return () => { mounted.current = false; model.close(); }; }, [model]);
  useLayoutEffect(() => { const previous = document.activeElement; heading.current?.focus(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, [model]);
  useLayoutEffect(() => { if (state.form && initialFocus.current.pending) { initialFocus.current.pending = false; if (document.activeElement === heading.current) dialog.current?.querySelector<HTMLInputElement>('.personalization-field input')?.focus(); } }, [model, !!state.form]);
  useEffect(() => { if (discard) confirmation.current?.querySelector<HTMLButtonElement>('button')?.focus(); else if (previousDiscardFocus.current instanceof HTMLElement && previousDiscardFocus.current.isConnected) { previousDiscardFocus.current.focus(); previousDiscardFocus.current = null; } }, [discard]);
  const locked = state.pending === 'saving' || navigating;
  const navigationPending = useRef(false);
  const finish = async (target: 'close' | 'knowledge') => {
    if (navigationPending.current) return;
    if (target === 'close') { onClose(); return; }
    if (!onOpenKnowledge) return;
    navigationPending.current = true; setNavigating(true); setNavigationError(''); setDiscard(null);
    try { await onOpenKnowledge(); } catch { if (mounted.current) setNavigationError('Could not open Knowledge Base. Your settings are still here.'); } finally { navigationPending.current = false; if (mounted.current) setNavigating(false); }
  };
  const requestClose = (target: 'close' | 'knowledge' = 'close') => { if (locked || navigationPending.current) return; if (model.dirty) { previousDiscardFocus.current = document.activeElement; setDiscard(target); } else finish(target); };
  const closeRequest = useRef(requestClose); closeRequest.current = requestClose;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (backtickAsEscape && event.key === '`')) { event.preventDefault(); event.stopImmediatePropagation(); if (discard) setDiscard(null); else closeRequest.current(); }
      if (event.key === 'Tab') {
        const scope = discard ? confirmation.current : dialog.current;
        const controls = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? []);
        if (!controls.length) return;
        const first = controls[0], last = controls.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
  }, [discard, backtickAsEscape]);
  const selectCategory = (value: string) => { setCategory(value); dialog.current?.querySelector(`[data-personalization-section="${value}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); };
  const field = (key: PersonalizationField, label: string, placeholder?: string, multiline = false) => <div className="personalization-field" key={key}>
    <label htmlFor={id + key}>{label}</label>
    {multiline ? <textarea id={id + key} value={state.form?.[key] ?? ''} maxLength={5000} disabled={locked} rows={5} onChange={event => { if (!navigationPending.current) model.setField(key, event.target.value); }} /> : <input id={id + key} value={state.form?.[key] ?? ''} maxLength={5000} disabled={locked} placeholder={placeholder} onChange={event => { if (!navigationPending.current) model.setField(key, event.target.value); }} />}
  </div>;
  const formError = personalizationFormError(state.form);
  const save = async () => { const owner = model; const saved = await owner.save(); if (mounted.current && latest.current === owner && saved && !owner.dirty) onClose(); };
  return <div className="personalization-overlay" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="personalization-dialog" role="dialog" aria-modal="true" aria-labelledby={id + 'title'} aria-describedby={id + 'description'} ref={dialog} data-personalization-account={accountId}>
      <button type="button" className="personalization-close" aria-label="Close Personalization" disabled={locked} onClick={() => requestClose()}><svg width="13" height="14" viewBox="0 0 13 14" aria-hidden="true" focusable="false"><path d="M.5 1 12.5 13M12.5 1 .5 13" fill="none" stroke="currentColor" strokeWidth=".8"/></svg></button>
      <aside className="personalization-categories"><span>Category</span><nav aria-label="Personalization categories">{categories.map(([value, name]) => <button key={value} type="button" aria-label={"Select " + name} aria-pressed={category === value} onClick={() => selectCategory(value)}>{name}</button>)}</nav></aside>
      <div className="personalization-main"><header><h1 id={id + 'title'} ref={heading} tabIndex={-1}>Personalization</h1><p id={id + 'description'}>Personalize how AI writes and schedules for you.<br/>Add your preferences and facts for more useful responses.</p>{accountLabel && <small className="personalization-account-label">{accountLabel}</small>}</header>
        <div className="personalization-scroll" aria-busy={state.pending === 'loading'}>
          {!state.form && state.pending === 'loading' && <p role="status">Loading personalization…</p>}
          {state.form && <>
            <section data-personalization-section="greeting">{field('greeting', 'Greeting', 'Hi [name]')}{field('signoff', 'Signoff', 'Cheers')}</section>
            <section data-personalization-section="company">{field('jobTitle', 'Job title', 'Founder')}{field('company', 'Company', 'Superhuman, Inc.')}{field('companyDescription', 'Company description', 'The most productive email app ever made')}</section>
            <section data-personalization-section="writing">{field('writing', 'Writing', undefined, true)}</section>
            <section data-personalization-section="scheduling">{field('scheduling', 'Scheduling', undefined, true)}</section>
            <section data-personalization-section="events">{field('events', 'Events', undefined, true)}</section>
            <section data-personalization-section="facts"><h2>About Me</h2><ul className="personalization-facts">{state.form.facts.map((fact, index) => <li key={fact.id}><textarea aria-label={'Fact ' + (index + 1)} value={fact.text} maxLength={1000} disabled={locked} rows={2} onChange={event => model.setFacts(state.form!.facts.map(item => item.id === fact.id ? { ...item, text: event.target.value } : item))} /><button type="button" aria-label={'Remove fact ' + (index + 1)} disabled={!!state.pending || navigating} onClick={() => model.setFacts(state.form!.facts.filter(item => item.id !== fact.id))}>Remove</button></li>)}</ul><button type="button" className="personalization-text-button" disabled={!!state.pending || navigating || state.form.facts.length >= 100} onClick={() => model.setFacts([...state.form!.facts, { id: crypto.randomUUID(), text: '' }])}>Add a fact</button></section>
            <section data-personalization-section="knowledge"><h2>Knowledge Base</h2><p>To upload files and connect links, visit the Knowledge Base.</p><button type="button" className="personalization-text-button" disabled={!onOpenKnowledge || !!state.pending || navigating} onClick={() => requestClose('knowledge')}>Visit the Knowledge Base</button></section>
          </>}
          {state.error && <div className="personalization-error" role="alert"><p>{state.error}</p><button type="button" disabled={!!state.pending || navigating} onClick={() => void model.load()}>Reload saved settings</button></div>}
          {state.conflicts.length > 0 && <div className="personalization-conflict" role="alert"><p>These settings changed elsewhere while you were editing: {state.conflicts.map(key => key === 'facts' ? 'About Me' : key).join(', ')}.</p><button type="button" disabled={locked} onClick={() => model.resolveConflicts('mine')}>Keep my changes</button><button type="button" disabled={locked} onClick={() => model.resolveConflicts('saved')}>Use saved changes</button></div>}
          {navigationError && <p role="alert" className="personalization-error">{navigationError}</p>}
          {formError && <p className="personalization-error" role="alert">{formError}</p>}
        </div>
        <footer><span role="status">{navigating ? 'Opening Knowledge Base…' : state.pending === 'saving' ? 'Saving…' : ''}</span><button type="button" disabled={locked} onClick={() => requestClose()}>Cancel</button><button type="button" className="personalization-save" disabled={!model.dirty || !!state.pending || navigating || state.needsReload || !!formError || !!state.conflicts.length} onClick={() => void save()}>Save</button></footer>
      </div>
      {discard && <div className="personalization-discard-overlay"><div role="alertdialog" aria-modal="true" aria-labelledby={id + 'discard'} ref={confirmation}><h2 id={id + 'discard'}>Discard your changes?</h2><p>{state.needsReload ? 'A previous save could not be confirmed. Closing will not undo any save that was already accepted.' : 'Your unsaved changes will be lost.'}</p><button type="button" onClick={() => setDiscard(null)}>Keep editing</button><button type="button" onClick={() => finish(discard)}>Discard changes</button></div></div>}
    </div>
  </div>;
}
