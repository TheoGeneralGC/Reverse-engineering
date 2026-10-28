// Browser-safe explicit queued-delivery controls. No model mutation tool.
import type { AiDraftSendSnapshot } from './ai-draft-send-types.ts';
import type { DraftSendSnapshot } from './draft-send-types.ts';
export type DeliveryControlScope =
  | { source:'artifact';accountId:string;operationId:string;sessionId:string;turnId:string }
  | { source:'composer';accountId:string;operationId:string };
export type DeliveryAccelerationRequest=DeliveryControlScope&{clientRequestId:string;expectedRevision:number};
export type DeliveryAccelerationReceipt={
 id:string;source:'artifact'|'composer';accountId:string;operationId:string;clientRequestId:string;
 createdAt:string;priorRevision:number;originalDeadlineAt:string;effectiveDeadlineAt:string;
};
export type DeliveryAccelerationResponse=
 | {source:'artifact';snapshot:AiDraftSendSnapshot;acceleration:DeliveryAccelerationReceipt}
 | {source:'composer';snapshot:DraftSendSnapshot;acceleration:DeliveryAccelerationReceipt};
