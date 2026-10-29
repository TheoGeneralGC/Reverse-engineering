import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readRef } from './reads-client.ts';
import type { TrackingReadView } from './reads-client.ts';
import { hasCurrentMessageCoverage, publicMessageProjection, readDisplayScope } from './reads-projection.ts';
import useReadPages from './useReadPages.ts';
import ReadStatus, { ReadStatusFooter } from './ReadStatus.tsx';
import type { TrackingRequest } from './client.ts';
type Slot = { observe: (element: HTMLElement | null) => void; check: ReactNode; footer: ReactNode };
export default function MessageReadEvidence({ accountId, messageRef, request, children, onElement, view }: { accountId: string; messageRef?: string; view?: TrackingReadView | null; request?: TrackingRequest; children: (slot: Slot) => ReactNode; onElement?: (element: HTMLElement | null) => void }) {
  const [element, setElement] = useState<HTMLElement | null>(null), [visible, setVisible] = useState(false), valid = readRef(messageRef);
  const observe = useCallback((node: HTMLElement | null) => { setElement(node); onElement?.(node); }, [onElement]);
  useLayoutEffect(() => {
    if (!element || !valid) { setVisible(false); return; }
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    let active = true; const observer = new IntersectionObserver(entries => { if (active && entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: '80px' }); observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, [element, messageRef, accountId, valid]);
  const reads = useReadPages(accountId, visible && valid, valid ? messageRef : undefined, null, request), status = reads.state?.page && !('messages' in reads.state.page) ? reads.state.page : null;
  const projection = useMemo(() => status ? publicMessageProjection(status, view) : null, [status, view]), scope = valid ? readDisplayScope(accountId, messageRef) : null;
  const check = scope && projection ? <ReadStatus scope={scope} projection={projection}/> : reads.state?.error ? <button type="button" className="tracking-message-read-error" onClick={() => void reads.model?.load()}>Read activity unavailable</button> : null;
  const footer = scope && projection ? <>{status && hasCurrentMessageCoverage(status, view) && view?.snapshot && <small className="tracking-read-cache-note">Cached snapshot as of <time dateTime={view.snapshot.acceptedAt}>{new Date(view.snapshot.acceptedAt).toLocaleString()}</time>.{view.cache.freshness !== 'current' ? ' The tracking source or preferences have changed since this snapshot.' : ''}</small>}{status && !hasCurrentMessageCoverage(status, view) && <small className="tracking-read-cache-note">Retained image-fetch history; current snapshot membership is unverified.</small>}<ReadStatusFooter scope={scope} projection={projection}/>{status?.nextCursor && <button type="button" className="tracking-message-read-more" disabled={reads.state?.loadingMore} onClick={() => void reads.model?.more()}>Load more image-fetch activity</button>}</> : null;
  return children({ observe, check, footer });
}
