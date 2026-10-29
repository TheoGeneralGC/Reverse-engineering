// Server-only verified delivery basis. Never serialize this object to a browser.
import type{CollectorRegistration}from'./tracking-collector.ts';
export type TrackingReadBinding={bindingId:string;source:'composer'|'artifact';operationId:string;generation:number;providerMessageId:string;registration:CollectorRegistration;acceptanceDigest:string;confirmationDigest:string};
export type TrackingVerifiedReadBasis={accountId:string;configurationFingerprint:string;accountRef:string|null;revision:number;bindings:TrackingReadBinding[];digest:string};
