import { useId, useRef, useState } from 'react';
import type { MessageProjection, FetchGroup, Scope } from './projection/types.ts';
import { readClock, readRelative, readISO, readCount } from './presentation.ts';
import './read-status.css';
const labels: Record<MessageProjection['status'], string> = { 'not-tracked': 'Read tracking unavailable', 'delivery-unconfirmed': 'Delivery unconfirmed', 'self-addressed': 'Self-addressed message', 'image-fetch-observed': 'Tracking image fetched', 'reply-derived': 'Reply activity observed', 'self-view-only': 'Only a known self view was observed', 'no-fetch-observed': 'No tracking image fetch observed' };
const scopeKey = (scope: Scope) => JSON.stringify([scope.accountId, scope.threadId, scope.messageId]);
const scoped = (scope: Scope, projection: MessageProjection | null): projection is MessageProjection => !!projection && scopeKey(projection.scope) === scopeKey(scope) && projection.checkCandidate !== 'none';
function hints(row: FetchGroup) { return row.proxyHints.map(p => p === 'google-proxy' ? 'Google image proxy' : p === 'possible-apple-proxy' ? 'Possible Apple privacy proxy' : 'Proxy unknown').join(', '); }
function Device({ device }: { device: FetchGroup['device'] }) {
  const label = device === 'desktop' ? 'Image fetched on desktop' : device === 'mobile' ? 'Image fetched on mobile' : 'Device unknown';
  return <svg className="tracking-device-icon" viewBox="0 0 20 18" width="20" height="18" role="img" aria-label={label}>
    {device === 'desktop' ? <><rect x="2" y="2" width="16" height="10" rx="1.5"/><path d="M10 12v3m-4 0h8"/></> : device === 'mobile' ? <><rect x="6" y="1" width="8" height="16" rx="2"/><path d="M9 14.5h2"/></> : <><circle cx="10" cy="9" r="7"/><path d="M8 6.5a2 2 0 1 1 3 1.8c-1 .6-1 1-1 1.7m0 2v.1"/></>}
  </svg>;
}
type Props = { scope: Scope; projection: MessageProjection | null; timeZone?: string; now?: number };
/** Prepared display only. The current running milestone has no production read-event DTO. */
export default function ReadStatus({ scope, projection, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now() }: Props) {
  const button = useRef<HTMLButtonElement>(null), root = useRef<HTMLSpanElement>(null), skipFocus = useRef(false), detailId = useId();
  const key = scopeKey(scope), [expanded, setExpanded] = useState({ key: '', open: false, pinned: false });
  const open = expanded.key === key && expanded.open, pinned = expanded.key === key && expanded.pinned;
  function close(restore = false) {
    setExpanded({ key, open: false, pinned: false });
    if (restore && root.current?.contains(document.activeElement)) { skipFocus.current = true; button.current?.focus(); queueMicrotask(() => { skipFocus.current = false; }); }
  }
  if (!scoped(scope, projection)) return null;
  return <span className="tracking-read-status" ref={root} data-message-id={projection.scope.messageId}
    onPointerEnter={() => { if (!pinned) setExpanded({ key, open: true, pinned: false }); }} onPointerLeave={() => { if (!pinned) close(); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }}>
    <button type="button" className="tracking-check-button" aria-label={labels[projection.status]} aria-expanded={open} aria-describedby={open ? detailId : undefined} ref={button}
      onFocus={() => { if (!skipFocus.current) setExpanded({ key, open: true, pinned: false }); }} onClick={() => setExpanded({ key, open: !pinned, pinned: !pinned })}>
      <span className={'tracking-check ' + projection.checkCandidate} aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M1.5 7.5 4 10 10.5 3.5"/>{projection.checkCandidate === 'double' && <path d="m6 9 1 1 6.5-6.5"/>}</svg></span>
    </button>
    {open && <section id={detailId} className="tracking-read-detail" role="tooltip" aria-label="Read-tracking details">
      <div className="tracking-read-header">{projection.status === 'image-fetch-observed' ? readCount(projection.displayFetchCount, projection.countIsLowerBound) : labels[projection.status]}</div>
      {projection.groups.length > 0 && <div className={'tracking-read-content ' + (projection.groups.length >= 7 ? 'tracking-read-scroll' : '')}>
        <table><caption className="tracking-visually-hidden">Grouped anonymous image-fetch activity</caption><tbody>{projection.groups.map(row => <tr key={row.key}>
          <td className="tracking-read-device"><Device device={row.device}/></td>
          <td className="tracking-read-name" title={hints(row)}>Unknown viewer<span className="tracking-visually-hidden">. {hints(row)}</span></td>
          <td className="tracking-read-datetime"><time dateTime={readISO(row.readAt)} title={timeZone}>{readClock(row.readAt, timeZone)}</time><span className="tracking-read-relative">(<time dateTime={readISO(row.readAt)}>{readRelative(row.readAt, now)}</time>)</span></td>
        </tr>)}</tbody></table>
      </div>}
      <div className="tracking-read-notes">
        {projection.selfFetchCount > 0 && <p>{projection.selfFetchCount} known self {projection.selfFetchCount === 1 ? 'fetch' : 'fetches'} excluded.</p>}
        {projection.replyDerived && <p>Reply activity is separate from image-fetch evidence.</p>}
        {projection.selfAddressed && <p>This message is addressed only to you.</p>}
        <p className="tracking-read-disclaimer">An image fetch doesn’t confirm a person read the message.</p>
      </div>
    </section>}
  </span>;
}
/** Separate prepared footer; it never labels an anonymous fetch as a named recipient. */
export function ReadStatusFooter({ scope, projection, now = Date.now() }: Props) {
  if (!scoped(scope, projection)) return null;
  const latest = projection.groups[0];
  return <div className="tracking-read-footer" aria-label="Read-tracking summary">{projection.status === 'image-fetch-observed' && latest ? <>Image fetched by an unknown viewer <time dateTime={readISO(latest.readAt)}>{readRelative(latest.readAt, now)}</time></> : labels[projection.status]}</div>;
}
