import type { Draft, DeliveryAttempt } from './types.ts';
import type { DeliveryContext } from './store.ts';
export type KeyedDeliveryIdentity = { source:'composer'|'artifact';accountId:string;operationId:string;generation:number;draftId:string;draftRevision:number;authoredHash:string };
// Synchronous observers only. They compose with owner/provider hooks and run in the caller's SQL transaction.
export type KeyedDeliveryObserver = {
  trackingRequired?:true;
  accepted?:(identity:KeyedDeliveryIdentity,draft:Draft)=>void;
  cancelled?:(identity:KeyedDeliveryIdentity,draft:Draft)=>void;
  claim?:(draft:Draft,attempt:DeliveryAttempt,context:DeliveryContext)=>void;
  complete?:(draft:Draft,attempt:DeliveryAttempt,context:DeliveryContext)=>void;
  held?:(draft:Draft,context:DeliveryContext)=>void;
  untrackedNative?:(draft:Draft)=>void;
  unknown?:(draft:Draft,context:DeliveryContext)=>void;
  neverIssued?:(draft:Draft,context:DeliveryContext)=>boolean;
};
