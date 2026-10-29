import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ProviderDraftDiscardController, providerDiscardStorageKey } from './provider-draft-discard.ts';
import { ProviderDraftStatusController } from './provider-draft-status.ts';

const prefix = 'reconstruction.provider-discard.v1:';
function pendingIds(accountId: string): string[] {
  const ids: string[] = [];
  try {
    for (let index = 0; index < Math.min(window.localStorage.length, 5000) && ids.length < 50; index++) {
      const key = window.localStorage.key(index); if (!key?.startsWith(prefix)) continue;
      try { const scope = JSON.parse(key.slice(prefix.length)); if (Array.isArray(scope) && scope.length === 2 && scope[0] === accountId && typeof scope[1] === 'string' && scope[1] && scope[1].length <= 2048 && !/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Surrogate}]/u.test(scope[1]) && key === providerDiscardStorageKey({ accountId, draftId: scope[1] })) ids.push(scope[1]); } catch { /* Foreign storage keys do not become draft targets. */ }
    }
  } catch { /* The active editor displays its own storage failure. */ }
  return ids;
}
export default function ProviderDiscardRecovery({ accountId, currentDraftId, onResolved }: { accountId: string; currentDraftId: string | null; onResolved: (draftId: string) => void }) {
  const [revision, setRevision] = useState(0), ids = useMemo(() => pendingIds(accountId).filter(id => id !== currentDraftId), [accountId, currentDraftId, revision]);
  useLayoutEffect(() => { const update = () => setRevision(value => value + 1); window.addEventListener('storage', update); return () => window.removeEventListener('storage', update); }, [accountId]);
  return <>{ids.map(draftId => <Recovery key={JSON.stringify([accountId, draftId])} accountId={accountId} draftId={draftId} onResolved={() => { onResolved(draftId); setRevision(value => value + 1); }}/>)}</>;
}
function Recovery({ accountId, draftId, onResolved }: { accountId: string; draftId: string; onResolved: () => void }) {
  const current = useRef(true), models = useMemo(() => ({ discard: new ProviderDraftDiscardController({ accountId, draftId, storage: window.localStorage, isCurrent: () => current.current }), status: new ProviderDraftStatusController({ accountId, draftId, isCurrent: () => current.current }) }), [accountId, draftId]);
  const state = useSyncExternalStore(models.discard.subscribe, models.discard.getSnapshot), cloud = useSyncExternalStore(models.status.subscribe, models.status.getSnapshot);
  useLayoutEffect(() => { current.current = true; models.discard.activate(); models.status.activate(); void models.discard.recover(); return () => { current.current = false; models.discard.suspend(); models.status.suspend(); }; }, [models]);
  const snapshot = state.response?.providerDraft, needsCloudCheck = snapshot && !state.settled && (snapshot.error?.retry === 'explicit-check' || ['outcome_unknown', 'remote_conflict'].includes(snapshot.state));
  return <aside className="provider-discard-recovery" role="status" data-provider-discard-recovery={draftId}>
    <span>{state.settled ? 'An earlier draft discard is complete.' : 'An earlier draft discard needs confirmation.'}</span>
    {state.error && <span>{state.error}</span>}
    {state.settled ? <button type="button" onClick={() => { if (models.discard.releaseTerminal()) onResolved(); }}>Dismiss</button> : <>
      {needsCloudCheck && <button type="button" disabled={cloud.checking || state.checking} onClick={async () => { models.status.acceptAcknowledgedStatus(snapshot); if (await models.status.reconcile()) await models.discard.recover(); }}>Check Gmail status</button>}
      <button type="button" disabled={state.checking || cloud.checking || !state.request} onClick={() => void models.discard.recover()}>Check discard status</button>
    </>}
  </aside>;
}
