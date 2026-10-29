import type { Draft } from './types.ts';
import type { AiDraftSendState } from './ai-draft-send-types.ts';
export type DraftSendOperation={
  id:string;
  accountId:string;
  draftId:string;
  generation:number;
  mode:'immediate'|'scheduled';
  scheduledAt:string|null;
  clientRequestId:string;
  draftRevision:number;
  contentHash:string;
  state:AiDraftSendState;
  revision:number;
  createdAt:string;
  startedAt:string|null;
  confirmedAt:string|null;
  originalCancellableUntil?:string; accelerationId?:string; acceleratedAt?:string; cancellableUntil:string;
  cancelledAt:string|null;
  cancelledFromRevision?:number;
  deliveryAttemptId:string|null;
  providerMessageId:string|null;
  error:null|{
    code:string;
    message:string;
    retry:'none';
    providerOutcome:'not_dispatched'|'unknown'|'confirmed'
  }
};
export type DraftSendRequest={
  accountId:string;
  clientRequestId:string;
  expectedDraftRevision:number;
  expectedContentHash:string;
  expectedGeneration:number;
  scheduledAt?:string
};
export type DraftSendSnapshot={
  tracking?:import('./tracking-delivery-types.ts').TrackingDeliveryIdentity;
  operation:DraftSendOperation|null;
  latestGeneration:number|null;
  draftRevision:number;
  contentHash:string;
  serverNow:string;
  canCancel:boolean;
  eligibility:{
    eligible:boolean;
    generation:number|null;
    reason:string
  };
  resolution:{
    availability:'available'|'locked'|'unavailable';
    draftId:string|null
  };
  draft?:Draft
};
export type DraftSendCancelRequest={
  accountId:string;
  clientRequestId:string;
  expectedRevision:number
};
export type DraftSendCancellation={
  id:string;
  operationId:string;
  accountId:string;
  draftId:string;
  clientRequestId:string;
  createdAt:string
};
export type DraftSendCancelResponse=DraftSendSnapshot&{
  cancellation:DraftSendCancellation
};
