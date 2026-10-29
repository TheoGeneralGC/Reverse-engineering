import { api, ApiError } from '../api.ts';
import type { TrackingRequest } from './client.ts';
import { trackingStable } from './client.ts';
import { checkedReadFeed, checkedReadMessageStatus, checkedReadTarget, readRef } from './reads-client.ts';
import type { TrackingReadFeed, TrackingReadMessageStatus, TrackingReadMessage, TrackingReadEvent, TrackingReadTarget } from './reads-client.ts';
type Page = TrackingReadFeed | TrackingReadMessageStatus;
export type ReadPagesState = { page: Page | null; loading: boolean; loadingMore: boolean; resolvingRef: string | null; error: string; notice: string; stale: boolean };
class PageError extends Error { readonly stale: boolean; constructor(message: string, stale = false) { super(message); this.stale = stale; } }
const messages = (p: Page): TrackingReadMessage[] => 'messages' in p ? p.messages : [p.message];
export function createReadPages(options: { accountId: string; messageRef?: string; request?: TrackingRequest; limit?: number; isCurrent?: () => boolean; basis?: () => { revision: number; contextVersion: string } | null }) {
  const { accountId, messageRef } = options, limit = options.limit ?? 50;
  if (!accountId || /[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(accountId) || messageRef !== undefined && !readRef(messageRef) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new PageError('Invalid read activity scope.');
  const path = '/tracking/reads/' + (messageRef ? 'messages/' + encodeURIComponent(messageRef) : 'feed'), request = options.request ?? api;
  let state: ReadPagesState = { page: null, loading: false, loadingMore: false, resolvingRef: null, error: '', notice: '', stale: false }, active = false, disposed = false, epoch = 0, navigation = 0;
  const listeners = new Set<() => void>(), controllers = new Set<AbortController>(), events = new Map<string, TrackingReadEvent>(), knownMessages = new Map<string, TrackingReadMessage>(), usedCursors = new Set<string>();
  const emit = (patch: Partial<ReadPagesState>) => { state = { ...state, ...patch }; for (const l of listeners) l(); }, usable = () => active && !disposed && (options.isCurrent?.() ?? true), current = (token: number) => usable() && token === epoch;
  const abort = () => { epoch++; navigation++; for (const c of controllers) c.abort(); controllers.clear(); };
  const read = async (url: string) => { const c = new AbortController(); controllers.add(c); try { return await request(url, undefined, 'GET', { signal: c.signal }); } finally { controllers.delete(c); } };
  const checked = (raw: unknown) => messageRef ? checkedReadMessageStatus(raw, accountId, messageRef, limit) : checkedReadFeed(raw, accountId, limit);
  const checkBasis = (page: Page) => { const basis = options.basis?.(); if (basis && (basis.revision !== page.revision || basis.contextVersion !== page.contextVersion)) throw new PageError('Activity changed. Reload local activity to view the current cache.', true); };
  const validateImmutable = (page: Page) => {
    for (const event of page.events) { const old = events.get(event.eventRef); if (old && trackingStable(old) !== trackingStable(event)) throw new PageError('An activity event could not be verified.'); }
    for (const message of messages(page)) { const old = knownMessages.get(message.messageRef); if (old && (old.generation !== message.generation || old.retainedEvents > message.retainedEvents || old.lastObservedAt && (!message.lastObservedAt || old.lastObservedAt > message.lastObservedAt))) throw new PageError('The retained message history changed unexpectedly.'); }
  };
  const remember = (page: Page) => { for (const e of page.events) events.set(e.eventRef, e); for (const m of messages(page)) knownMessages.set(m.messageRef, m); };
  const sameView = (a: Page, b: Page) => a.revision === b.revision && a.contextVersion === b.contextVersion && (!('snapshotRef' in a) || !('snapshotRef' in b) || a.snapshotRef === b.snapshotRef);
  const merge = (prior: Page, next: Page): Page => {
    if (!sameView(prior, next) || trackingStable(prior.coverage) !== trackingStable(next.coverage)) throw new PageError('This activity page is stale. Reload local activity.', true);
    const byEvent = new Map(prior.events.map(e => [e.eventRef, e])); for (const e of next.events) byEvent.set(e.eventRef, e);
    if (byEvent.size > 5000) throw new PageError('This view reached its local activity limit. Earlier rows are retained.');
    if ('messages' in prior && 'messages' in next) { const byMessage = new Map(prior.messages.map(m => [m.messageRef, m])); for (const m of next.messages) { const old = byMessage.get(m.messageRef); if (old && trackingStable(old) !== trackingStable(m)) throw new PageError('The activity view changed between pages.', true); byMessage.set(m.messageRef, m); } return { ...next, events: [...byEvent.values()], messages: [...byMessage.values()] }; }
    if (!('messages' in prior) && !('messages' in next) && trackingStable(prior.message) === trackingStable(next.message)) return { ...next, events: [...byEvent.values()] };
    throw new PageError('The message view changed between pages.', true);
  };
  const fetchPage = async (more = false): Promise<Page | null> => {
    if (!usable() || state.loading || state.loadingMore || more && (!state.page?.nextCursor || state.stale)) return null;
    const prior = state.page, cursor = more ? prior!.nextCursor! : null; abort(); const token = epoch;
    emit({ loading: !more, loadingMore: more, resolvingRef: null, error: '', notice: '' });
    try {
      const query = new URLSearchParams({ accountId, limit: String(limit), ...(cursor ? { cursor } : {}) }), next = checked(await read(path + '?' + query));
      if (!current(token)) return null; checkBasis(next); validateImmutable(next);
      if (prior && next.revision < prior.revision) throw new PageError('An older activity view was returned.', true);
      if (cursor && (next.nextCursor === cursor || next.nextCursor && usedCursors.has(next.nextCursor))) throw new PageError('The activity cursor did not advance.', true);
      const page = more ? merge(prior!, next) : next; remember(next); if (!more) usedCursors.clear(); else usedCursors.add(cursor!);
      emit({ page, stale: false }); return page;
    } catch (error) { if (current(token)) emit({ error: error instanceof PageError ? error.message : 'Activity could not be loaded. Previously loaded rows are retained.', stale: error instanceof PageError && error.stale || error instanceof ApiError && error.status === 409 && error.code === 'tracking_read_page_stale' }); return null; }
    finally { if (current(token)) emit({ loading: false, loadingMore: false }); }
  };
  const resolve = async (ref: string): Promise<TrackingReadTarget | null> => {
    if (!usable() || state.loading || state.loadingMore || state.stale || !state.page) return null;
    const page = state.page, message = messages(page).find(m => m.messageRef === ref);
    if (!message || message.availability !== 'available' || !message.targetRef || !message.targetVersion) { emit({ notice: 'This message is not available locally yet.' }); return null; }
    const intent = ++navigation, pageEpoch = epoch, valid = () => usable() && intent === navigation && epoch === pageEpoch && state.page === page;
    emit({ resolvingRef: ref, notice: '' });
    try {
      checkBasis(page); const query = new URLSearchParams({ accountId, expectedRevision: String(page.revision), expectedTargetVersion: message.targetVersion });
      const target = checkedReadTarget(await read('/tracking/reads/targets/' + encodeURIComponent(message.targetRef) + '?' + query), accountId, message.targetRef, page.revision, message.targetVersion);
      if (!valid()) return null; checkBasis(page);
      if (target.availability !== 'available') { emit({ notice: target.availability === 'waiting-for-message' ? 'Waiting for this message to import.' : 'This activity target is no longer available.' }); return null; }
      return target;
    } catch { if (valid()) emit({ notice: 'This exact activity target could not be resolved. Your current work is unchanged.' }); return null; }
    finally { if (valid()) emit({ resolvingRef: null }); }
  };
  return { accountId, messageRef, getSnapshot: () => state, subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }, load: () => fetchPage(), more: () => fetchPage(true), resolve,
    activate() { if (!disposed) active = true; }, suspend() { active = false; abort(); state = { ...state, loading: false, loadingMore: false, resolvingRef: null }; }, dispose() { active = false; disposed = true; abort(); listeners.clear(); } };
}
export type ReadPagesModel = ReturnType<typeof createReadPages>;
