import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Thread } from '../../api.ts';
import { AutoDraftThreadModel, type InlineState } from './thread-publication.ts';
import './inline.css';

const empty: InlineState = { publication: null, draft: null, parts:null, pending: null, hidden: false, error: '' };
export function useAutoDraftThread(accountId: string | undefined, thread: Thread | null) {
  const selected = useRef<AutoDraftThreadModel | null>(null), host = useRef({ accountId, thread }); host.current = { accountId, thread };
  const model = useMemo(() => { if (!accountId || !thread || thread.accountId !== accountId) return null; let next: AutoDraftThreadModel; next = new AutoDraftThreadModel({ accountId, thread, isCurrent: () => selected.current === next && host.current.accountId === accountId && host.current.thread === thread }); return next; }, [accountId, thread]);
  selected.current = model;
  const state = useSyncExternalStore(model?.subscribe || (() => () => {}), model?.getSnapshot || (() => empty));
  useLayoutEffect(() => { if (!model) return; model.activate(); void model.load(); return () => model.suspend(); }, [model]);
  return { model, state };
}

/** The one ordinary App composer lives here after exact source/target proof. */
export default function AutoDraftInline({sourceMessageId,to,children}:{sourceMessageId:string;to:string;children:ReactNode}){
 return <section className="auto-draft-inline" aria-label="Auto Draft reply" data-source-message-id={sourceMessageId} onClick={event=>event.stopPropagation()} onFocus={event=>event.stopPropagation()}><div className="auto-draft-inline-label">Auto Draft to {to}</div>{children}</section>;
}
