import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AutoDraftsModel, type Request, type Storage } from './model.ts';
import type { Sha256 } from '../../../../api/src/auto-drafts-contract.ts';
export type Port = { request?: Request; storage?: Storage; digest?: Sha256; makeKey?: () => string; online?: () => boolean };
const local: Storage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) };
export default function useAutoDrafts(accountId: string, port: Port = {}) {
  const selected = useRef<AutoDraftsModel | null>(null), account = useRef(accountId); account.current = accountId;
  const model = useMemo(() => {
    let next: AutoDraftsModel;
    next = new AutoDraftsModel({ accountId, storage: port.storage || local, request: port.request, digest: port.digest, makeKey: port.makeKey, online: port.online, isCurrent: () => account.current === accountId && selected.current === next });
    return next;
  }, [accountId, port.storage, port.request, port.digest, port.makeKey, port.online]);
  selected.current = model;
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useLayoutEffect(() => { model.activate(); void model.load(); return () => model.suspend(); }, [model]);
  return { model, state };
}
