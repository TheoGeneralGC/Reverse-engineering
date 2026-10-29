import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createReadActivity } from './reads-model.ts';
import type { TrackingRequest, TrackingDigest } from './client.ts';
import type { TrackingStorage } from './preferences.ts';
const storage: TrackingStorage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) };
const empty = Object.freeze({}), none = () => empty, noop = () => () => {}, online = () => navigator.onLine !== false;
export default function useReadActivity(accountId: string | undefined, enabled: boolean, options: { request?: TrackingRequest; storage?: TrackingStorage; pollMs?: number; digest?: TrackingDigest } = {}) {
  const signature = enabled && accountId ? accountId : '', latest = useRef(signature), selected = useRef<ReturnType<typeof createReadActivity> | null>(null); latest.current = signature;
  const model = useMemo(() => { if (!signature) return null; const made = createReadActivity({ accountId: signature, storage: options.storage ?? storage, request: options.request, digest: options.digest, online, pollMs: options.pollMs, isCurrent: () => latest.current === signature && selected.current === made }); return made; }, [signature, options.request, options.storage, options.pollMs, options.digest]);
  selected.current = model; useSyncExternalStore(model?.subscribe ?? noop, model?.getSnapshot ?? none, none);
  useLayoutEffect(() => { if (!model) return; model.activate(); void model.load(); return () => model.suspend(); }, [model]);
  return { model, state: model?.getSnapshot() ?? null };
}
