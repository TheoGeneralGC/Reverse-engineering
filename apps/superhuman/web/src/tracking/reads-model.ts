import { api, ApiError } from '../api.ts';
import { trackingDigest, trackingStable } from './client.ts';
import type { TrackingRequest, TrackingDigest } from './client.ts';
import type { TrackingStorage } from './preferences.ts';
import { checkedReadView, checkedReadRequest, checkedReadRefresh, readRequestFingerprint, ReadValidationError } from './reads-client.ts';
import type { TrackingReadView, TrackingReadRefreshRequest, TrackingReadRefreshResponse, TrackingReadSnapshot } from './reads-client.ts';
type Journal = { version: 1; phase: 'prepared' | 'issued' | 'accepted'; request: TrackingReadRefreshRequest; fingerprint: string; reviewed: TrackingReadView; proof?: TrackingReadRefreshResponse };
export type ReadActivityState = { view: TrackingReadView | null; pending: 'loading' | 'preparing' | 'refreshing' | 'checking' | null; journalPhase: Journal['phase'] | null; unknown: boolean; accepted: boolean; error: string; notice: string; lastResponse: TrackingReadRefreshResponse | null };
export const readRefreshJournalKey = (accountId: string) => 'superhuman.tracking.read-refresh.v1.' + encodeURIComponent(accountId);
class ReadModelError extends Error { constructor(message: string) { super(message); this.name = 'ReadModelError'; } }
const message = (error: unknown) => error instanceof ReadValidationError || error instanceof ReadModelError ? error.message : 'Read activity is unavailable. Your earlier activity and refresh key were preserved.';
const refused = (error: unknown) => error instanceof ApiError && (error.status === 400 && error.code === 'tracking_read_invalid_request' || error.status === 404 && error.code === 'tracking_read_not_found' || error.status === 409 && ['tracking_read_revision_conflict', 'tracking_read_basis_conflict', 'tracking_read_request_conflict'].includes(error.code ?? '') || error.status === 422 && error.code === 'tracking_read_unavailable' || error.status === 503 && error.code === 'tracking_read_stopping');
export function createReadActivity(options: { accountId: string; storage: TrackingStorage; request?: TrackingRequest; digest?: TrackingDigest; uuid?: () => string; online?: () => boolean; isCurrent?: () => boolean; pollMs?: number; maxPolls?: number }) {
  const { accountId } = options; if (!accountId || new TextEncoder().encode(accountId).length > 1024 || /[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(accountId)) throw new ReadModelError('Invalid read activity account.');
  const path = '/tracking/reads', query = new URLSearchParams({ accountId }), key = readRefreshJournalKey(accountId), digest = options.digest ?? trackingDigest, request = options.request ?? api;
  let state: ReadActivityState = { view: null, pending: null, journalPhase: null, unknown: false, accepted: false, error: '', notice: '', lastResponse: null };
  let active = false, disposed = false, epoch = 0, journal: Journal | null = null, journalRaw: string | null = null, corrupt = false, polls = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const controllers = new Set<AbortController>(), listeners = new Set<() => void>(), proofs = new Map<string, TrackingReadRefreshResponse>(), snapshots = new Map<string, TrackingReadSnapshot>();
  const emit = (patch: Partial<ReadActivityState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const usable = () => active && !disposed && (options.isCurrent?.() ?? true), current = (token: number) => usable() && token === epoch, busy = () => state.pending !== null;
  const journalUnknown = () => !!journal && journal.phase !== 'prepared';
  const stop = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const read = async (url: string, body?: unknown, method = 'GET') => { const c = new AbortController(); controllers.add(c); try { return await request(url, body, method, { signal: c.signal }); } finally { controllers.delete(c); } };
  const decode = (raw: string): Journal => {
    if (new TextEncoder().encode(raw).length > 65536) throw new ReadValidationError(); const v = JSON.parse(raw) as Journal;
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![5, 6].includes(Object.keys(v).length) || Object.keys(v).some(k => !['version', 'phase', 'request', 'fingerprint', 'reviewed', 'proof'].includes(k)) || v.version !== 1 || !['prepared', 'issued', 'accepted'].includes(v.phase) || !/^[a-f0-9]{64}$/.test(v.fingerprint) || (v.phase === 'accepted') !== !!v.proof) throw new ReadValidationError();
    const intent = checkedReadRequest(v.request, accountId), basis = checkedReadView(v.reviewed, accountId);
    if (intent.expectedRevision !== basis.revision || intent.expectedBasisDigest !== basis.refresh.basisDigest || !basis.refresh.allowed || basis.refresh.active !== null) throw new ReadValidationError();
    return v;
  };
  const adopt = (raw: string | null) => {
    if (raw === null) { if (journal) emit({ unknown: true }); return; }
    journal = decode(raw); journalRaw = raw; emit({ journalPhase: journal.phase, unknown: journal.phase !== 'prepared', accepted: false });
  };
  try { const raw = options.storage.getItem(key); if (raw !== null) adopt(raw); } catch { corrupt = true; state = { ...state, unknown: true, error: 'An earlier refresh key could not be verified. No new refresh will be sent.' }; }
  const sameStorage = () => { const raw = options.storage.getItem(key); if (raw !== journalRaw) { adopt(raw); throw new ReadModelError('Another refresh is pending. Check its status before continuing.'); } };
  const store = (next: Journal, expectedRaw: string | null) => {
    const before = options.storage.getItem(key); if (before !== expectedRaw) { adopt(before); throw new ReadModelError('Another refresh is pending. Check its status.'); }
    const raw = JSON.stringify(next); options.storage.setItem(key, raw);
    if (options.storage.getItem(key) !== raw) { const actual = options.storage.getItem(key); if (actual !== null) adopt(actual); throw new ReadModelError('Persistent browser storage is unavailable. No new refresh was confirmed.'); }
    journal = next; journalRaw = raw; emit({ journalPhase: next.phase });
  };
  const clear = () => {
    sameStorage(); options.storage.removeItem(key);
    if (options.storage.getItem(key) !== null) { adopt(options.storage.getItem(key)); throw new ReadModelError('The accepted key could not be cleared. Check its status again.'); }
    journal = null; journalRaw = null; emit({ journalPhase: null, unknown: false, accepted: false });
  };
  const rememberSnapshot = (s: TrackingReadSnapshot | null) => { if (!s) return; const old = snapshots.get(s.snapshotRef); if (old && trackingStable(old) !== trackingStable(s)) throw new ReadValidationError(); };
  const publish = (raw: unknown): TrackingReadView => {
    const next = checkedReadView(raw, accountId), old = state.view; rememberSnapshot(next.snapshot);
    if (old && (next.revision === old.revision && trackingStable(next.snapshot) !== trackingStable(old.snapshot) || next.revision < old.revision || next.cache.events < old.cache.events || next.cache.messages < old.cache.messages)) throw new ReadValidationError();
    if (next.snapshot) snapshots.set(next.snapshot.snapshotRef, next.snapshot); emit({ view: next }); return next;
  };
  const validateJournal = async (pending: Journal) => { if (await readRequestFingerprint(pending.request, digest) !== pending.fingerprint) throw new ReadValidationError(); if (pending.proof) await checkedReadRefresh(pending.proof, pending.request, digest); };
  const normalized = (response: TrackingReadRefreshResponse): TrackingReadRefreshResponse => ({ ...structuredClone(response), historical: false });
  const checkProof = (pending: Journal, response: TrackingReadRefreshResponse) => {
    if (response.accepted.previousSnapshotRef !== (pending.reviewed.snapshot?.snapshotRef ?? null)) throw new ReadValidationError();
    const old = proofs.get(pending.request.clientRequestId) ?? pending.proof;
    if (old && (trackingStable(old.receipt) !== trackingStable(response.receipt) || trackingStable(old.accepted) !== trackingStable(response.accepted) || old.state !== 'accepted' && trackingStable(normalized(old)) !== trackingStable(normalized(response)))) throw new ReadValidationError();
    rememberSnapshot(response.result?.snapshot ?? null);
  };
  const process = async (raw: unknown, pending: Journal, token: number): Promise<TrackingReadRefreshResponse | null> => {
    const response = await checkedReadRefresh(raw, pending.request, digest); if (!current(token)) return null; sameStorage(); checkProof(pending, response);
    const proof = normalized(response); proofs.set(pending.request.clientRequestId, proof); if (response.result?.snapshot) snapshots.set(response.result.snapshot.snapshotRef, response.result.snapshot);
    store({ ...pending, phase: 'accepted', proof }, journalRaw); emit({ accepted: true, unknown: false, lastResponse: response });
    // Never publish the historical refresh response as the current cache.
    const latest = checkedReadView(await read(path + '?' + query), accountId); if (!current(token)) return null; sameStorage();
    const required = response.result?.revision ?? response.accepted.revision;
    if (latest.revision < required) throw new ReadValidationError();
    if (response.result?.snapshot && latest.revision === required && trackingStable(latest.snapshot) !== trackingStable(response.result.snapshot)) throw new ReadValidationError();
    publish(latest);
    if (response.state !== 'accepted') { clear(); emit({ notice: response.state === 'completed' ? 'Activity refreshed. Image fetches do not confirm human reads.' : 'Refresh did not complete. Previously accepted activity is retained.' }); }
    return response;
  };
  const schedule = () => { stop(); if (!usable() || busy() || state.unknown || !journal?.proof || journal.proof.state !== 'accepted' || (options.pollMs ?? 1500) <= 0 || polls >= (options.maxPolls ?? 20)) return; timer = setTimeout(() => { timer = undefined; polls++; void recover(); }, options.pollMs ?? 1500); };
  const recover = async (): Promise<TrackingReadRefreshResponse | null> => {
    if (!usable() || busy() || corrupt) return null; stop();
    try { const raw = options.storage.getItem(key); if (raw !== journalRaw) adopt(raw); } catch { emit({ unknown: true, error: 'The saved refresh could not be read.' }); return null; }
    if (!journal || journal.phase === 'prepared') return null;
    const pending = structuredClone(journal), token = ++epoch; emit({ pending: 'checking', error: '' });
    try { await validateJournal(pending); if (!current(token)) return null; sameStorage(); return await process(await read(path + '/refresh/requests/by-request/' + encodeURIComponent(pending.request.clientRequestId) + '?' + query), pending, token); }
    catch (error) { if (current(token)) emit({ unknown: true, error: error instanceof ApiError && error.status === 404 ? 'The earlier refresh is not visible yet. Check its status; it has not been retried.' : message(error) }); return null; }
    finally { if (current(token)) { emit({ pending: null }); schedule(); } }
  };
  const load = async (): Promise<TrackingReadView | null> => {
    if (!usable() || busy() || corrupt) return null; if (journal && journal.phase !== 'prepared') { await recover(); return state.view; }
    stop(); const token = ++epoch; emit({ pending: 'loading', error: '' });
    try { if (journal) await validateJournal(journal); if (!current(token)) return null; const value = await read(path + '?' + query); if (!current(token)) return null; return publish(value); }
    catch (error) { if (current(token)) emit({ error: message(error) }); return null; }
    finally { if (current(token)) emit({ pending: null }); }
  };
  const issue = async (pending: Journal, token: number): Promise<TrackingReadRefreshResponse | null> => {
    let postStarted = false, postReturned = false;
    try {
      store({ ...pending, phase: 'issued' }, journalRaw); if (!current(token)) return null; sameStorage(); emit({ pending: 'refreshing', unknown: true, accepted: false }); postStarted = true;
      const raw = await read(path + '/refresh', pending.request, 'POST'); postReturned = true; return await process(raw, { ...pending, phase: 'issued' }, token);
    } catch (error) {
      if (current(token)) {
        if (postStarted && !postReturned && refused(error)) { try { clear(); } catch {} emit({ error: 'Refresh was not accepted. Reload local activity before trying again.' }); }
        else if (!postStarted) { try { if (journal?.request.clientRequestId === pending.request.clientRequestId) clear(); } catch {} emit({ unknown: !!journal && journal.phase !== 'prepared', error: message(error) }); }
        else emit({ unknown: true, error: message(error) });
      }
      return null;
    }
  };
  const refresh = async (): Promise<TrackingReadRefreshResponse | null> => {
    if (!usable() || busy() || corrupt || journal || state.unknown || !state.view?.refresh.allowed || state.view.refresh.active !== null || !state.view.refresh.basisDigest) return null;
    const reviewed = structuredClone(state.view), token = ++epoch; stop(); polls = 0; emit({ pending: 'preparing', error: '', notice: '' });
    try {
      const intent = checkedReadRequest({ accountId, clientRequestId: (options.uuid ?? (() => crypto.randomUUID()))(), expectedRevision: reviewed.revision, expectedBasisDigest: reviewed.refresh.basisDigest }, accountId), fingerprint = await readRequestFingerprint(intent, digest);
      if (!current(token)) return null; const pending: Journal = { version: 1, phase: 'prepared', request: intent, fingerprint, reviewed }; store(pending, null);
      if (options.online?.() === false) { emit({ notice: 'Refresh is saved in this browser and has not been sent.' }); return null; }
      return await issue(pending, token);
    } catch (error) { if (current(token)) emit({ unknown: journalUnknown(), error: message(error) }); return null; }
    finally { if (current(token)) { emit({ pending: null }); schedule(); } }
  };
  const resumePrepared = async (): Promise<TrackingReadRefreshResponse | null> => {
    if (!usable() || busy() || corrupt || journal?.phase !== 'prepared' || options.online?.() === false) return null;
    const pending = structuredClone(journal), token = ++epoch; stop(); polls = 0; emit({ pending: 'preparing', error: '' });
    try {
      await validateJournal(pending); if (!current(token)) return null; sameStorage();
      const view = checkedReadView(await read(path + '?' + query), accountId); if (!current(token)) return null; sameStorage(); publish(view);
      if (!view.refresh.allowed || view.refresh.active !== null || view.revision !== pending.request.expectedRevision || view.refresh.basisDigest !== pending.request.expectedBasisDigest) throw new ReadModelError('The refresh basis changed. Your unsent action is retained; discard it before making a new choice.');
      return await issue(pending, token);
    } catch (error) { if (current(token)) emit({ error: message(error) }); return null; }
    finally { if (current(token)) { emit({ pending: null }); schedule(); } }
  };
  const discardPrepared = () => { if (!usable() || busy() || corrupt || journal?.phase !== 'prepared') return false; try { clear(); emit({ error: '', notice: 'Unsent refresh discarded. No import was requested.' }); return true; } catch (error) { emit({ error: message(error) }); return false; } };
  return {
    accountId, getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }, load, refresh, recover, resumePrepared, discardPrepared,
    activate() { if (!disposed) active = true; },
    suspend() { active = false; epoch++; stop(); for (const c of controllers) c.abort(); controllers.clear(); state = { ...state, pending: null }; },
    dispose() { active = false; disposed = true; epoch++; stop(); for (const c of controllers) c.abort(); controllers.clear(); listeners.clear(); },
    get locked() { return corrupt || !!journal || state.unknown || busy(); },
  };
}
export type ReadActivityModel = ReturnType<typeof createReadActivity>;
