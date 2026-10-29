// Browser-safe delivery-tracking status. No collector refs, tokens, URLs, wire bytes or keys.
export const TRACKING_DELIVERY_POLICY = 'local-tracking-delivery-v1' as const;
export type TrackingDeliverySource = 'composer' | 'artifact';
export type TrackingDeliveryIdentity = { accountId: string; source: TrackingDeliverySource; operationId: string };
export type TrackingDeliveryPhase = 'untracked' | 'queued' | 'preparing' | 'held_before_gmail' | 'claimed' | 'arming' | 'ready' | 'issue_possible' | 'sent_confirmation_pending' | 'confirmed' | 'cancelled';
export type TrackingDeliverySnapshot = TrackingDeliveryIdentity & {
  version: 1; policyVersion: typeof TRACKING_DELIVERY_POLICY; generation: number; draftId: string; revision: number;
  decision: { tracked: boolean; preferenceRevision: number; reason: 'enabled' | 'local-disabled-default' | 'account-disabled' };
  phase: TrackingDeliveryPhase;
  mailOutcome: 'not-issued' | 'issue-possible' | 'unknown' | 'sent';
  registration: 'inactive' | 'create-unknown' | 'prepared' | 'arm-unknown' | 'armed' | 'confirmation-unknown' | 'confirmed';
  heldReason: null | 'configuration-changed' | 'preference-disabled' | 'collector-unresolved' | 'interrupted' | 'preflight-refused' | 'stopping';
  canReconcile: boolean; canContinue: boolean;
  reads: { availability: 'unavailable'; reason: 'event-import-not-integrated'; events: []; humanReadVerified: false; namedRecipientIdentity: false };
};
export type TrackingDeliveryControlRequest = { accountId: string; clientRequestId: string; expectedRevision: number };
export type TrackingDeliveryControlReceipt = TrackingDeliveryIdentity & {
  id: string; clientRequestId: string; action: 'reconcile' | 'continue'; expectedRevision: number;
  requestProtocol: 'tracking-control-v1'; requestFingerprint: string; acceptedAt: string;
};
// Historical recovery returns its own snapshot; fetch current status separately.
export type TrackingDeliveryControlResponse = { state:'accepted'|'completed'; receipt: TrackingDeliveryControlReceipt; snapshot: TrackingDeliverySnapshot; historical: boolean };
export type TrackingFeedUnavailable = {
  accountId: string; policyVersion: typeof TRACKING_DELIVERY_POLICY; availability: 'unavailable'; reason: 'event-import-not-integrated';
  events: []; nextCursor: null; coverage: { imported: false; fullMailbox: false; humanReadVerified: false; namedRecipientIdentity: false };
};

export type TrackingDeliveryCapabilities={accountId:string;policyVersion:typeof TRACKING_DELIVERY_POLICY;nativeKind:'mapped-draft';sources:{composer:{tracking:'mapped-rich-only'};artifact:{tracking:'unsupported';reason:'mapped-draft-required';action:'create-draft-then-cloud-saved-composer-send'};keyless:{tracking:'unsupported';reason:'keyed-intent-required'}};effectiveReadStatuses:false;effectiveRecentOpens:false;hostingVerified:false;provenance:'local-design'};
