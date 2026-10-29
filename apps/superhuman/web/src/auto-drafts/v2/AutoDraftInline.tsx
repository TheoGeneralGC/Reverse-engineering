import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Thread } from '../../api.ts';
import { AutoDraftThreadModel, type InlineState } from './thread-publication.ts';
import type { Navigate } from './activity.ts';
import './inline.css';

const empty: InlineState = { publication: null, draft: null, pending: null, hidden: false, error: '' };
export function useAutoDraftThread(accountId: string | undefined, thread: Thread | null) {
  const selected = useRef<AutoDraftThreadModel | null>(null), host = useRef({ accountId, thread }); host.current = { accountId, thread };
  const model = useMemo(() => { if (!accountId || !thread || thread.accountId !== accountId) return null; let next: AutoDraftThreadModel; next = new AutoDraftThreadModel({ accountId, thread, isCurrent: () => selected.current === next && host.current.accountId === accountId && host.current.thread === thread }); return next; }, [accountId, thread]);
  selected.current = model;
  const state = useSyncExternalStore(model?.subscribe || (() => () => {}), model?.getSnapshot || (() => empty));
  useLayoutEffect(() => { if (!model) return; model.activate(); void model.load(); return () => model.suspend(); }, [model]);
  return { model, state };
}

/** Read-only placement under the verified source. Explicit Open is local editor
 * navigation, not acceptance or Send. Hide changes this mounted view only. */
export default function AutoDraftInline({ state, model, onNavigate }: { state: InlineState; model: AutoDraftThreadModel | null; onNavigate: Navigate }) {
  if (!model || !state.draft || !state.publication || state.hidden) return null;
  return <section className="auto-draft-inline" aria-label="Auto Draft reply" data-source-message-id={state.publication.sourceMessageId}>
    <div className="auto-draft-inline-label">Auto Draft to {state.draft.to}</div>
    <div className="auto-draft-inline-body">{state.draft.body}</div>
    <div className="auto-draft-inline-actions"><button disabled={!!state.pending} onClick={() => void model.open(onNavigate)}>Open draft</button><button disabled={!!state.pending} onClick={() => model.hide()}>Hide auto draft</button></div>
    {state.error && <p role="status">{state.error}</p>}
  </section>;
}
