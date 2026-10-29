import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createReadPages } from './reads-pages.ts';
import type { TrackingRequest } from './client.ts';
const empty = Object.freeze({}), none = () => empty, noop = () => () => {};
export default function useReadPages(accountId: string | undefined, enabled: boolean, messageRef?: string, basis?: { revision: number; contextVersion: string } | null, request?: TrackingRequest) {
  const signature = enabled && accountId ? JSON.stringify([accountId, messageRef ?? 'feed']) : '', latest = useRef(signature), basisRef = useRef(basis), selected = useRef<ReturnType<typeof createReadPages> | null>(null); latest.current = signature; basisRef.current = basis;
  const model = useMemo(() => { if (!signature || !accountId) return null; const made = createReadPages({ accountId, messageRef, request, basis: () => basisRef.current ?? null, isCurrent: () => latest.current === signature && selected.current === made }); return made; }, [signature, request]);
  selected.current = model; useSyncExternalStore(model?.subscribe ?? noop, model?.getSnapshot ?? none, none);
  const refresh = useRef(true); useLayoutEffect(() => { refresh.current = true; }, [model, basis?.revision, basis?.contextVersion]);
  useLayoutEffect(() => { if (!model) return; model.activate(); return () => model.suspend(); }, [model]);
  const state = model?.getSnapshot() ?? null;
  useLayoutEffect(() => { if (model && refresh.current && !state?.loading && !state?.loadingMore) { refresh.current = false; void model.load(); } }, [model, basis?.revision, basis?.contextVersion, state?.loading, state?.loadingMore]);
  return { model, state };
}
