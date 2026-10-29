import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { api } from '../api.ts';
import { createTrackingDelivery } from './delivery.ts';
import type { TrackingDeliveryIdentity, TrackingDeliverySnapshot } from './delivery-client.ts';
import type { TrackingRequest } from './client.ts';
import type { TrackingStorage } from './preferences.ts';
const browserStorage: TrackingStorage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) };
const empty = Object.freeze({}), none = () => empty, noop = () => () => {};
export default function useTrackingDelivery(identity: TrackingDeliveryIdentity | undefined, accountId: string, ownerRevision: number | undefined, options: { request?: TrackingRequest; storage?: TrackingStorage; onCurrent?: (snapshot: TrackingDeliverySnapshot) => void } = {}) {
  const signature = identity?.accountId === accountId ? JSON.stringify([identity.accountId, identity.source, identity.operationId]) : '';
  const current = useRef(signature), selected = useRef<ReturnType<typeof createTrackingDelivery> | null>(null), latest = useRef(options); current.current = signature; latest.current = options;
  const model = useMemo(() => {
    if (!signature || !identity) return null;
    const created = createTrackingDelivery({ identity, request: options.request ?? api, storage: options.storage ?? browserStorage, isCurrent: () => current.current === signature && selected.current === created, onCurrent: snapshot => latest.current.onCurrent?.(snapshot) });
    return created;
  }, [signature, options.request, options.storage]);
  selected.current = model;
  useSyncExternalStore(model?.subscribe ?? noop, model?.getSnapshot ?? none, none);
  const refresh = useRef(true);
  useLayoutEffect(() => { refresh.current = true; }, [model, ownerRevision]);
  useLayoutEffect(() => { if (!model) return; model.activate(); return () => model.suspend(); }, [model]);
  const state = model?.getSnapshot() ?? null;
  useLayoutEffect(() => { if (model && refresh.current && !state?.pending) { refresh.current = false; void model.load(); } }, [model, state?.pending, ownerRevision]);
  return { model, state };
}
