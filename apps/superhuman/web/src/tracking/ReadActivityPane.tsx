import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReadActivityModel, ReadActivityState } from './reads-model.ts';
import type { ReadPagesModel, ReadPagesState } from './reads-pages.ts';
import type { TrackingReadTarget } from './reads-client.ts';
import { publicFeedGroups } from './reads-projection.ts';
import { readRelative } from './presentation.ts';
import './reads.css';
export type ReadMailTarget = { target: NonNullable<TrackingReadTarget['target']>; messageRef: string };
type Props = { accountId: string; disabled: boolean; activity: { model: ReadActivityModel | null; state: ReadActivityState | null }; pages: { model: ReadPagesModel | null; state: ReadPagesState | null }; navigationKey: string; currentEditor: object | null; onOpen: (target: ReadMailTarget, isCurrent: () => boolean) => Promise<boolean> | boolean; onSettings: () => void; onEscape: () => void; now?: number; timeZone?: string };
const unavailable: Record<string, string> = { 'not-configured': 'Read activity is unavailable for this account.', 'preference-disabled': 'Read Statuses are off. Previously cached activity is retained.', 'no-eligible-messages': 'No messages are eligible for an activity refresh.', 'configuration-changed': 'Tracking configuration changed. Cached activity remains available.', 'binding-limit': 'This account exceeds the current refresh limit.', 'basis-unverifiable': 'The activity source could not be verified.', 'not-refreshed': 'No activity has been imported yet.' };
export default function ReadActivityPane({ accountId, disabled, activity, pages, navigationKey, currentEditor, onOpen, onSettings, onEscape, now = Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
  const active = useRef(false), intent = useRef(0), latest = useRef({ accountId, navigationKey, currentEditor, onOpen }), [notice, setNotice] = useState(''), [online, setOnline] = useState(() => navigator.onLine !== false); latest.current = { accountId, navigationKey, currentEditor, onOpen };
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; intent.current++; }; }, []);
  useEffect(() => { const update = () => setOnline(navigator.onLine !== false); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  const state = activity.state, view = state?.view?.accountId === accountId ? state.view : null, feed = pages.state?.page && 'messages' in pages.state.page && pages.state.page.accountId === accountId ? pages.state.page : null;
  const groups = useMemo(() => feed ? publicFeedGroups(feed, now, timeZone) : [], [feed, now, timeZone]);
  const localBusy = !!state?.pending || !!pages.state?.loading, prepared = state?.journalPhase === 'prepared', unknown = !!state?.unknown, accepted = !!state?.accepted;
  const open = async (messageRef: string) => {
    if (!pages.model || !feed) return; const captured = latest.current, page = pages.model.getSnapshot().page, token = ++intent.current; setNotice('');
    const base = () => active.current && token === intent.current && captured.accountId === latest.current.accountId && pages.model?.getSnapshot().page === page;
    const current = () => base() && captured.navigationKey === latest.current.navigationKey && captured.currentEditor === latest.current.currentEditor;
    const resolved = await pages.model.resolve(messageRef); if (!current() || !resolved?.target) return;
    try { const opened = await latest.current.onOpen({ target: resolved.target, messageRef }, base); if (!opened && current()) setNotice('The exact message could not be opened while your current work is changing.'); }
    catch { if (current()) setNotice('The message could not be opened. Your current work is retained.'); }
  };
  return <section className="tracking-feed tracking-read-feed" aria-label="Recent Opens" data-read-revision={view?.revision ?? ''} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return; if (e.key === 'Escape') { e.preventDefault(); onEscape(); } if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.preventDefault(); e.stopPropagation(); }}>
    <header><h2>Recent Opens</h2><button type="button" aria-label="Reload local read activity" disabled={localBusy} onClick={() => { void activity.model?.load(); void pages.model?.load(); }}>↻</button></header>
    <div className="tracking-feed-content" aria-busy={localBusy}>
      {disabled && <p>Recent Opens is off for this account. Previously cached activity is retained.</p>}
      <div className="tracking-read-actions">
        {prepared ? <><p>Refresh is saved in this browser and hasn’t been sent.</p><button type="button" disabled={localBusy || !online} onClick={() => void activity.model?.resumePrepared()}>Apply saved refresh</button><button type="button" disabled={localBusy} onClick={() => activity.model?.discardPrepared()}>Discard unsent refresh</button></> : unknown || accepted ? <><p>{unknown ? 'The refresh hasn’t been confirmed.' : 'Refresh accepted. Checking its result does not repeat the request.'}</p><button type="button" disabled={localBusy} onClick={() => void activity.model?.recover()}>Check refresh status</button></> : <button type="button" disabled={!view?.refresh.allowed || !!view.refresh.active || !!activity.model?.locked || !online} onClick={() => void activity.model?.refresh()}>Refresh activity</button>}
        <button type="button" onClick={onSettings}>Read-tracking settings</button>
      </div>
      {!view && !state?.error && <p role="status">Loading read activity…</p>}
      {view?.refresh.reason && <p role="status">{unavailable[view.refresh.reason]}</p>}
      {view?.refresh.active && !accepted && !unknown && <p role="status">An account refresh is in progress. Reload local activity to check its result.</p>}
      {view && !view.snapshot && view.cache.events === 0 && !view.refresh.reason && <p>No activity has been imported yet.</p>}
      {view?.snapshot && <p className="tracking-read-cache-note">Cached activity as of <time dateTime={view.snapshot.acceptedAt}>{new Date(view.snapshot.acceptedAt).toLocaleString('en-US', { timeZone })}</time>.{view.cache.freshness !== 'current' ? ' The source has changed since this snapshot.' : ''}</p>}
      {state?.notice && <p role="status">{state.notice}</p>}
      {state?.lastResponse?.state === 'failed' || state?.lastResponse?.state === 'interrupted' ? <p role="status">The last refresh did not complete. Cached history is unchanged.</p> : null}
      {state?.error && <p role="alert">{state.error}</p>}
      {pages.state?.error && <p role="alert">{pages.state.error}</p>}
      {(state?.error || pages.state?.error) && <button type="button" disabled={localBusy} onClick={() => { void activity.model?.load(); void pages.model?.load(); }}>Reload local activity</button>}
      {groups.map(group => <section className="tracking-feed-group" key={group.key}>{group.kind !== 'today' && <h3>{group.label}</h3>}{group.rows.map(row => <button type="button" className="tracking-feed-row" data-read-message-ref={row.message.messageRef} key={row.message.messageRef} disabled={row.message.availability !== 'available' || pages.state?.loading || pages.state?.loadingMore || pages.state?.stale || pages.state?.resolvingRef === row.message.messageRef} onClick={() => void open(row.message.messageRef)}>
        <span className="tracking-feed-person">Unknown viewer <time dateTime={new Date(row.latestObservedAt).toISOString()}>{readRelative(row.latestObservedAt, now)}</time></span><span className="tracking-feed-subject">{row.message.subject ?? '(Message awaiting import)'}</span>
        {row.message.snapshotCoverage?.snapshotRef !== feed?.snapshotRef && <small>Retained activity from an earlier snapshot</small>}{row.message.availability !== 'available' ? <small>Waiting for this exact message to import</small> : row.proxyHints.some(h => h !== 'unknown') ? <small>Image proxy activity</small> : null}
      </button>)}</section>)}
      {feed?.availability === 'empty' && <p>No image-fetch activity is present in this cached view.</p>}
      {feed?.nextCursor && <button type="button" disabled={pages.state?.loading || pages.state?.loadingMore || pages.state?.stale} onClick={() => void pages.model?.more()}>{pages.state?.loadingMore ? 'Loading…' : 'Load more activity'}</button>}
      {feed?.coverage && feed.coverage.cumulativeThrottled.value > 0 && <p className="tracking-read-cache-note">Account throttling counter: {feed.coverage.cumulativeThrottled.value}. This is not a per-message missing-read count.</p>}
      {notice || pages.state?.notice ? <p role="status">{notice || pages.state?.notice}</p> : null}
      <p className="tracking-feed-disclaimer">Image fetches don’t identify a reader or confirm a human read. Tracking availability is not fully verified.</p>
    </div>
  </section>;
}
