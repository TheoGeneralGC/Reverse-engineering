import { ApiError } from '../api.ts';
import { trackingDigest, trackingStable } from './client.ts';
import type { TrackingDigest, TrackingRequest } from './client.ts';
import { checkedTrackingIdentity, checkedTrackingDelivery, checkedTrackingControlRequest, checkedTrackingControl, trackingControlFingerprint, assertTrackingDeliveryProgress, TrackingDeliveryValidationError } from './delivery-client.ts';
import type { TrackingDeliveryIdentity, TrackingDeliverySnapshot, TrackingDeliveryControlRequest, TrackingDeliveryControlReceipt, TrackingDeliveryControlResponse, TrackingControlAction } from './delivery-client.ts';
import type { TrackingStorage } from './preferences.ts';
type ControlProof = Pick<TrackingDeliveryControlResponse, 'state' | 'snapshot' | 'receipt'>;
type Journal = { version: 1; identity: TrackingDeliveryIdentity; action: TrackingControlAction; request: TrackingDeliveryControlRequest; fingerprint: string; reviewed: TrackingDeliverySnapshot; receipt?: TrackingDeliveryControlReceipt; proof?: ControlProof };
export type TrackingDeliveryState = { snapshot: TrackingDeliverySnapshot | null; pending: 'loading' | 'preparing' | 'submitting' | 'checking' | null; unknown: boolean; accepted: boolean; error: string; receipt: TrackingDeliveryControlReceipt | null };
export const trackingDeliveryJournalKey = (identity: TrackingDeliveryIdentity) => 'superhuman.tracking.delivery.v1.' + encodeURIComponent(JSON.stringify([identity.accountId, identity.source, identity.operationId]));
class ControlError extends Error { constructor(message: string) { super(message); this.name = 'TrackingControlError'; } }
const message = (error: unknown) => error instanceof TrackingDeliveryValidationError || error instanceof ControlError ? error.message : 'Tracking status is unavailable. Check this action’s status before continuing.';
const definite = (error: unknown) => error instanceof ApiError && (error.status === 400 && error.code === 'tracking_delivery_invalid_request' || error.status === 404 && error.code === 'tracking_delivery_not_found' || error.status === 409 && error.code === 'tracking_delivery_conflict' || error.status === 503 && error.code === 'tracking_delivery_stopping');
export function createTrackingDelivery(options: { identity: TrackingDeliveryIdentity; request: TrackingRequest; storage: TrackingStorage; digest?: TrackingDigest; uuid?: () => string; isCurrent?: () => boolean; onCurrent?: (snapshot: TrackingDeliverySnapshot) => void }) {
  const identity = checkedTrackingIdentity(structuredClone(options.identity)), storageKey = trackingDeliveryJournalKey(identity), digest = options.digest ?? trackingDigest;
  const path = '/tracking/deliveries/' + identity.source + '/' + encodeURIComponent(identity.operationId), query = new URLSearchParams({ accountId: identity.accountId });
  let state: TrackingDeliveryState = { snapshot: null, pending: null, unknown: false, accepted: false, error: '', receipt: null };
  let active = false, disposed = false, epoch = 0, journal: Journal | null = null, journalRaw: string | null = null, corrupt = false;
  const controllers = new Set<AbortController>(), listeners = new Set<() => void>(), proofs = new Map<string, ControlProof>();
  const emit = (patch: Partial<TrackingDeliveryState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const usable = () => active && !disposed && (options.isCurrent?.() ?? true), current = (token: number) => usable() && token === epoch;
  const busy = () => state.pending !== null;
  const decode = (raw: string): Journal => {
    if (new TextEncoder().encode(raw).length > 16384) throw new ControlError('The saved tracking action could not be verified.');
    const v = JSON.parse(raw) as Journal;
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![6, 8].includes(Object.keys(v).length) || Object.keys(v).some(k => !['version', 'identity', 'action', 'request', 'fingerprint', 'reviewed', 'receipt', 'proof'].includes(k)) || v.version !== 1 || trackingStable(checkedTrackingIdentity(v.identity)) !== trackingStable(identity) || !['reconcile', 'continue'].includes(v.action) || !/^[a-f0-9]{64}$/.test(v.fingerprint)) throw new ControlError('The saved tracking action could not be verified.');
    checkedTrackingControlRequest(v.request, identity);
    const reviewed = checkedTrackingDelivery(v.reviewed, identity);
    if (reviewed.revision !== v.request.expectedRevision || !(v.action === 'continue' ? reviewed.canContinue : reviewed.canReconcile)) throw new TrackingDeliveryValidationError();
    if (v.receipt && (v.receipt.requestFingerprint !== v.fingerprint || v.receipt.clientRequestId !== v.request.clientRequestId || v.receipt.accountId !== identity.accountId || v.receipt.source !== identity.source || v.receipt.operationId !== identity.operationId || v.receipt.action !== v.action || v.receipt.expectedRevision !== v.request.expectedRevision)) throw new ControlError('The saved tracking receipt could not be verified.');
    if (!!v.receipt !== !!v.proof || v.proof && (Object.keys(v.proof).sort().join(',') !== 'receipt,snapshot,state' || !['accepted', 'completed'].includes(v.proof.state) || trackingStable(v.receipt) !== trackingStable(v.proof.receipt))) throw new TrackingDeliveryValidationError();
    if (v.proof) { const s = checkedTrackingDelivery(v.proof.snapshot, identity); if (v.proof.state === 'accepted' && s.revision !== v.request.expectedRevision || v.proof.state === 'completed' && s.revision < v.request.expectedRevision || !assertTrackingDeliveryProgress(reviewed, s)) throw new TrackingDeliveryValidationError(); }
    return v;
  };
  const adopt = (raw: string | null) => {
    if (raw === null) { if (journal) emit({ unknown: true }); return; }
    journal = decode(raw); journalRaw = raw; emit({ unknown: true, accepted: !!journal.receipt, receipt: journal.receipt ?? null });
  };
  try { const raw = options.storage.getItem(storageKey); if (raw !== null) adopt(raw); } catch { corrupt = true; state = { ...state, unknown: true, error: 'The saved tracking action could not be verified. No control request will be sent.' }; }
  const sameStorage = () => {
    const saved = options.storage.getItem(storageKey);
    if (saved !== journalRaw) { adopt(saved); throw new ControlError('Another tracking action is pending. Check its status.'); }
  };
  const write = (value: Journal, expectedRaw: string | null) => {
    const saved = options.storage.getItem(storageKey);
    if (saved !== expectedRaw) { adopt(saved); throw new ControlError('Another tracking action is pending. Check its status.'); }
    const raw = JSON.stringify(value); options.storage.setItem(storageKey, raw);
    if (options.storage.getItem(storageKey) !== raw) { const actual = options.storage.getItem(storageKey); if (actual) adopt(actual); throw new ControlError('Persistent browser storage is unavailable. Check the earlier action before continuing.'); }
    journal = value; journalRaw = raw;
  };
  const clear = () => {
    sameStorage(); options.storage.removeItem(storageKey);
    if (options.storage.getItem(storageKey) !== null) { adopt(options.storage.getItem(storageKey)); throw new ControlError('The saved action could not be cleared. Check its status again.'); }
    journal = null; journalRaw = null; emit({ unknown: false, accepted: false });
  };
  const read = async (url: string, body?: unknown, method = 'GET') => { const controller = new AbortController(); controllers.add(controller); try { return await options.request(url, body, method, { signal: controller.signal }); } finally { controllers.delete(controller); } };
  const publish = (value: unknown) => {
    const snapshot = checkedTrackingDelivery(value, identity);
    if (state.snapshot && !assertTrackingDeliveryProgress(state.snapshot, snapshot)) return state.snapshot;
    emit({ snapshot }); options.onCurrent?.(snapshot); return snapshot;
  };
  const validateJournal = async (pending: Journal) => {
    if (await trackingControlFingerprint(identity, pending.action, pending.request, digest) !== pending.fingerprint) throw new TrackingDeliveryValidationError();
    if (pending.proof) await checkedTrackingControl({ ...pending.proof, historical: true }, identity, pending.action, pending.request, digest);
  };
  const accepted = async (raw: unknown, pending: Journal, token: number): Promise<TrackingDeliveryControlResponse | null> => {
    const response = await checkedTrackingControl(raw, identity, pending.action, pending.request, digest);
    if (!current(token)) return null;
    sameStorage();
    const known = proofs.get(pending.request.clientRequestId) ?? pending.proof;
    if (!assertTrackingDeliveryProgress(pending.reviewed, response.snapshot)) throw new TrackingDeliveryValidationError();
    if (known && (trackingStable(known.receipt) !== trackingStable(response.receipt) || known.state === 'completed' && (response.state !== 'completed' || trackingStable(known.snapshot) !== trackingStable(response.snapshot)) || known.state === 'accepted' && response.state === 'accepted' && trackingStable(known.snapshot) !== trackingStable(response.snapshot))) throw new TrackingDeliveryValidationError();
    if (known && !assertTrackingDeliveryProgress(known.snapshot, response.snapshot)) throw new TrackingDeliveryValidationError();
    if (state.snapshot) assertTrackingDeliveryProgress(state.snapshot, response.snapshot);
    const proof: ControlProof = { state: response.state, receipt: response.receipt, snapshot: response.snapshot };
    proofs.set(pending.request.clientRequestId, proof);
    write({ ...pending, receipt: response.receipt, proof }, journalRaw);
    emit({ accepted: true, unknown: false, receipt: response.receipt });
    // Historical/accepted snapshots never replace the independently read current status.
    const latest = checkedTrackingDelivery(await read(path + '?' + query), identity);
    if (!current(token)) return null;
    sameStorage();
    if (latest.revision < response.snapshot.revision) throw new TrackingDeliveryValidationError();
    assertTrackingDeliveryProgress(response.snapshot, latest);
    publish(latest);
    if (response.state === 'completed') clear();
    return response;
  };
  const recover = async (): Promise<TrackingDeliveryControlResponse | null> => {
    if (!usable() || busy() || corrupt) return null;
    try { const raw = options.storage.getItem(storageKey); if (raw !== journalRaw) adopt(raw); } catch { emit({ unknown: true, error: 'The saved action could not be read.' }); return null; }
    if (!journal) return null;
    const pending = structuredClone(journal), token = ++epoch; emit({ pending: 'checking', error: '' });
    try {
      await validateJournal(pending); if (!current(token)) return null; sameStorage();
      return await accepted(await read(path + '/requests/by-request/' + encodeURIComponent(pending.request.clientRequestId) + '?' + query), pending, token);
    } catch (error) { if (current(token)) emit({ unknown: true, error: error instanceof ApiError && error.status === 404 ? 'This action is not visible yet. Check its status; no new request has been sent.' : message(error) }); return null; }
    finally { if (current(token)) emit({ pending: null }); }
  };
  const load = async (): Promise<TrackingDeliverySnapshot | null> => {
    if (!usable() || busy() || corrupt) return null;
    if (journal) { await recover(); return state.snapshot; }
    const token = ++epoch; emit({ pending: 'loading', error: '' });
    try { const value = await read(path + '?' + query); if (!current(token)) return null; return publish(value); }
    catch (error) { if (current(token)) emit({ error: message(error) }); return null; }
    finally { if (current(token)) emit({ pending: null }); }
  };
  const control = async (action: TrackingControlAction): Promise<TrackingDeliveryControlResponse | null> => {
    if (!usable() || busy() || corrupt || journal || state.unknown || !state.snapshot || !(action === 'continue' ? state.snapshot.canContinue : state.snapshot.canReconcile)) return null;
    const token = ++epoch, revision = state.snapshot.revision; emit({ pending: 'preparing', error: '' }); let dispatched = false, postReturned = false;
    try {
      const request = checkedTrackingControlRequest({ accountId: identity.accountId, clientRequestId: (options.uuid ?? (() => crypto.randomUUID()))(), expectedRevision: revision }, identity);
      const fingerprint = await trackingControlFingerprint(identity, action, request, digest);
      if (!current(token)) return null;
      const pending: Journal = { version: 1, identity, action, request, fingerprint, reviewed: structuredClone(state.snapshot!) };
      write(pending, null); emit({ pending: 'submitting', unknown: true, accepted: false });
      if (!current(token)) return null; sameStorage(); dispatched = true;
      const response = await read(path + '/' + action, request, 'POST'); postReturned = true;
      return await accepted(response, pending, token);
    } catch (error) {
      if (current(token)) {
        if (dispatched && !postReturned && definite(error)) { try { clear(); } catch {} emit({ error: 'The action was not accepted. Refresh tracking status before trying again.' }); }
        else emit({ unknown: !!journal, error: message(error) });
      }
      return null;
    } finally { if (current(token)) emit({ pending: null }); }
  };
  return {
    getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }, load, recover, control,
    activate() { if (!disposed) active = true; },
    suspend() { active = false; epoch++; for (const c of controllers) c.abort(); controllers.clear(); state = { ...state, pending: null }; },
    dispose() { active = false; disposed = true; epoch++; for (const c of controllers) c.abort(); controllers.clear(); listeners.clear(); },
    get locked() { return corrupt || !!journal || state.unknown || busy(); },
  };
}
export type TrackingDeliveryModel = ReturnType<typeof createTrackingDelivery>;
