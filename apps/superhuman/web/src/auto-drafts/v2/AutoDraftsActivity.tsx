import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AutoDraftsActivityModel, type Navigate } from './activity.ts';
import type { Port } from './useAutoDrafts.ts';
export default function AutoDraftsActivity({ accountId, port, onNavigate }: { accountId: string; port?: Port; onNavigate?: Navigate }) {
  const selected = useRef<AutoDraftsActivityModel | null>(null), owner = useRef(accountId); owner.current = accountId;
  const model = useMemo(() => { let next: AutoDraftsActivityModel; next = new AutoDraftsActivityModel({ accountId, request: port?.request, isCurrent: () => owner.current === accountId && selected.current === next }); return next; }, [accountId, port?.request]); selected.current = model;
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useLayoutEffect(() => { model.activate(); void model.load(); return () => model.suspend(); }, [model]);
  return <section className="auto-drafts-activity" aria-label="Response drafting activity" aria-busy={!!state.pending}>
    <header><h2>Drafting activity</h2><button type="button" disabled={!!state.pending} onClick={() => void model.load()}>Refresh activity</button></header>
    <p>Recent local drafting activity. Earlier mailbox history is not included.</p>
    {state.pending && <p role="status">{state.pending === 'opening' ? 'Checking the exact activity target…' : 'Loading drafting activity…'}</p>}
    {state.error && <p role="alert">{state.error}</p>}{state.notice && <p role="status">{state.notice}</p>}
    {state.page && !state.records.length && <p>No response drafting activity has been recorded.</p>}
    <ol>{state.records.map(g => <li key={g.id} data-generation-state={g.state}><strong>{g.state === 'published' ? 'Local draft created' : g.state.replaceAll('-', ' ')}</strong> <time dateTime={g.updatedAt}>{new Date(g.updatedAt).toLocaleString()}</time>{g.reason && <p>{g.reason.replaceAll('-', ' ')}</p>}{g.state === 'model-outcome-unknown' && <p>The model outcome is unknown. This job will not be retried.</p>}<div><button type="button" disabled={!!state.pending || !onNavigate} onClick={() => void model.open(g.id, 'source', onNavigate)}>View source</button>{g.publication && <button type="button" disabled={!!state.pending || !onNavigate} onClick={() => void model.open(g.id, 'draft', onNavigate)}>View local draft</button>}</div></li>)}</ol>
    {state.page?.hasMore && <button type="button" disabled={!!state.pending || state.records.length >= 200} onClick={() => void model.load(true)}>Load more activity</button>}
  </section>;
}
