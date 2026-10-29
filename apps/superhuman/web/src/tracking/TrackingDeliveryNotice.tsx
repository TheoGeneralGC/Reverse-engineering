import type { TrackingDeliveryModel, TrackingDeliveryState } from './delivery.ts';
export default function TrackingDeliveryNotice({ model, state }: { model: TrackingDeliveryModel | null; state: TrackingDeliveryState | null }) {
  if (!model || !state) return null;
  const s = state.snapshot, busy = !!state.pending;
  if (s && !s.decision.tracked && !state.unknown && !state.error) return null;
  const label = state.unknown ? 'Tracking action is unconfirmed.' : state.accepted ? 'Tracking action accepted. Check its status for completion.' : !s ? 'Checking tracking status…' : s.phase === 'held_before_gmail' ? 'Send paused before Gmail. This message has not been issued.' : s.mailOutcome === 'unknown' ? 'Gmail delivery is unconfirmed.' : s.phase === 'sent_confirmation_pending' ? 'Gmail accepted the message. Tracking confirmation is pending.' : s.phase === 'confirmed' ? 'Gmail delivery and tracking registration confirmed.' : s.phase === 'cancelled' ? 'Sending undone.' : 'Preparing tracked delivery.';
  return <div className="tracking-delivery-notice" data-tracking-phase={s?.phase ?? 'unavailable'} data-mail-outcome={s?.mailOutcome ?? 'unavailable'}>
    <small>{label}</small>
    {s?.heldReason === 'configuration-changed' && <small>Tracking configuration changed. Continue is unavailable.</small>}
    {s?.heldReason === 'preference-disabled' && <small>Read Statuses are disabled for this account.</small>}
    {state.unknown || state.accepted ? <button type="button" disabled={busy} onClick={() => void model.recover()}>Check tracking action status</button> : <>
      {s?.canReconcile && <button type="button" disabled={busy || model.locked} onClick={() => void model.control('reconcile')}>Check tracking status</button>}
      {s?.canContinue && <button type="button" disabled={busy || model.locked} onClick={() => void model.control('continue')}>Continue send</button>}
      {state.error && <button type="button" disabled={busy} onClick={() => void model.load()}>Refresh tracking status</button>}
    </>}
    {state.error && <small role="alert">{state.error}</small>}
  </div>;
}
