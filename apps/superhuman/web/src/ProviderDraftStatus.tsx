import { providerDraftPresentation, type ProviderDraftStatusState } from './provider-draft-status.ts';
import './provider-draft-status.css';

export default function ProviderDraftStatus({ state, onRefresh, onCheck }: { state: ProviderDraftStatusState; onRefresh: () => void | Promise<void>; onCheck: () => void | Promise<void> }) {
  const view = providerDraftPresentation(state), cloudError = state.error || state.snapshot?.error?.message;
  const newerLocal = state.snapshot?.state === 'outcome_unknown' && state.snapshot.operation && state.localRevision !== null && state.localRevision > state.snapshot.operation.draftRevision && !state.localDirty && !state.localError;
  return <div className={'provider-draft-status '+view.tone} data-provider-draft-state={state.snapshot?.state ?? 'unavailable'} data-local-revision={state.localRevision ?? ''} data-provider-synced-revision={state.snapshot?.syncedRevision ?? ''} aria-busy={state.loading || state.checking}>
    <div className="provider-draft-status-line" role="status" aria-live="polite"><span>{view.localLabel}</span>{view.cloudLabel && <><span className="provider-draft-status-separator" aria-hidden="true">·</span><span>{view.cloudLabel}</span></>}
      {state.readUnavailable || state.error ? <button type="button" disabled={state.loading || state.checking} onClick={() => void onRefresh()}>Refresh Gmail status</button> : view.canCheck && <button type="button" disabled={state.loading || state.checking} onClick={() => void onCheck()}>Check Gmail status</button>}
    </div>
    {state.localError && <p className="provider-draft-status-error" role="alert">{state.localError}</p>}
    {cloudError && <p className="provider-draft-status-error" role="alert">{cloudError}</p>}
    {newerLocal && <p className="provider-draft-status-note">Newer local edits will sync after the earlier change is confirmed.</p>}
  </div>;
}
