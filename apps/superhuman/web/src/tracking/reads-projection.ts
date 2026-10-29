import type { TrackingReadFeed, TrackingReadMessageStatus, TrackingReadMessage, TrackingReadEvent, TrackingReadView } from './reads-client.ts';
import type { MessageProjection, Scope, FetchGroup } from './projection/types.ts';
import { utcMillisecondMinute, feedDateGroup } from './projection/projection.ts';
/** Opaque presentation slots only. Neither slot is a legacy Mail id or a navigation target. */
export const readDisplayScope = (accountId: string, messageRef: string): Scope => ({ accountId, threadId: messageRef, messageId: messageRef });
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function hasCurrentMessageCoverage(input: TrackingReadMessageStatus, view?: TrackingReadView | null): boolean {
  const proof = input.message.snapshotCoverage, snapshot = view?.snapshot;
  return !!proof && !!snapshot && !!input.coverage && view?.accountId === input.accountId && view.revision === input.revision && view.contextVersion === input.contextVersion && proof.snapshotRef === snapshot.snapshotRef && proof.revision === snapshot.revision && proof.basisDigest === snapshot.basisDigest;
}
export function publicMessageProjection(input: TrackingReadMessageStatus, view?: TrackingReadView | null): MessageProjection | null {
  const { message, events, accountId } = input, groups = new Map<string, TrackingReadEvent[]>();
  for (const event of events) {
    if (event.messageRef !== message.messageRef || event.generation !== message.generation || event.viewer !== null || event.evidence !== 'image-fetch') throw Error('Foreign public display event');
    const key = JSON.stringify([event.device, utcMillisecondMinute(Date.parse(event.observedAt))]), bucket = groups.get(key) ?? []; bucket.push(event); groups.set(key, bucket);
  }
  const rows: FetchGroup[] = [...groups].map<FetchGroup>(([key, group]) => { const sorted = [...group].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || compare(a.eventRef, b.eventRef)), first = sorted[0]!; return { key, viewer: 'unknown', device: first.device, proxyHints: [...new Set(sorted.map(e => e.proxy))].sort(compare), readAt: Date.parse(first.observedAt), latestObservedAt: Date.parse(sorted.at(-1)!.observedAt), representativeEventId: first.eventRef, sourceEventIds: sorted.map(e => e.eventRef), evidence: 'image-fetch', humanReadVerified: false }; }).sort((a, b) => b.readAt - a.readAt || compare(a.representativeEventId, b.representativeEventId));
  if (rows.length === 0 && !hasCurrentMessageCoverage(input, view)) return null;
  const partial = input.nextCursor !== null || message.retainedEvents > events.length;
  return { scope: readDisplayScope(accountId, message.messageRef), status: rows.length ? 'image-fetch-observed' : 'no-fetch-observed', checkCandidate: rows.length ? 'double' : partial ? 'none' : 'single', groups: rows, selfGroups: [], rawFetchCount: events.length, displayFetchCount: rows.length, selfFetchCount: 0, countIsLowerBound: partial, replyDerived: false, selfAddressed: false,
    // The authorized read-message route admits only immutable acknowledged+confirmed bindings.
    deliveryConfirmed: true, humanReadVerified: false, dedupePolicy: 'utc-minute-retain-milliseconds-v1', coverage: { hasMore: partial, throttled: 0, fullMailbox: false, humanReadVerified: false } };
}
export type PublicReadRow = { message: TrackingReadMessage; latestEventRef: string; latestObservedAt: number; displayFetchCount: number; partial: boolean; proxyHints: TrackingReadEvent['proxy'][] };
export type PublicReadGroup = ReturnType<typeof feedDateGroup> & { rows: PublicReadRow[] };
export function publicFeedGroups(feed: TrackingReadFeed, now: number, timeZone: string): PublicReadGroup[] {
  const rows: PublicReadRow[] = [];
  for (const message of feed.messages) {
    const events = feed.events.filter(e => e.messageRef === message.messageRef && e.generation === message.generation).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || compare(a.eventRef, b.eventRef));
    if (!events.length) continue;
    const display = publicMessageProjection({ accountId: feed.accountId, policyVersion: feed.policyVersion, revision: feed.revision, contextVersion: feed.contextVersion, message, events, nextCursor: null, coverage: feed.coverage });
    if (!display) continue;
    rows.push({ message, latestEventRef: events[0]!.eventRef, latestObservedAt: Date.parse(events[0]!.observedAt), displayFetchCount: display.displayFetchCount, partial: message.retainedEvents > events.length, proxyHints: [...new Set(events.map(e => e.proxy))].sort(compare) });
  }
  rows.sort((a, b) => b.latestObservedAt - a.latestObservedAt || compare(a.message.messageRef, b.message.messageRef));
  const groups: PublicReadGroup[] = [];
  for (const row of rows) { const group = feedDateGroup(row.latestObservedAt, now, timeZone), existing = groups.find(g => g.key === group.key); if (existing) existing.rows.push(row); else groups.push({ ...group, rows: [row] }); }
  return groups;
}
