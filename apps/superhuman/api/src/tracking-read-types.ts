// Browser-safe read cache contract. Collector/provider identifiers, URLs and private provenance are absent.
export const TRACKING_READ_POLICY='local-tracking-read-import-v1' as const;
export type TrackingReadBounds={maxBindings:10000;maxPages:50;maxEvents:5000;maxRetainedBytes:8388608;maxElapsedMs:30000};
export const TRACKING_READ_BOUNDS:TrackingReadBounds={maxBindings:10000,maxPages:50,maxEvents:5000,maxRetainedBytes:8388608,maxElapsedMs:30000};
export type TrackingReadUnavailableReason='not-configured'|'preference-disabled'|'no-eligible-messages'|'configuration-changed'|'binding-limit'|'basis-unverifiable'|'not-refreshed';
export type TrackingReadError={code:'tracking_read_failed'|'tracking_read_stale'|'tracking_read_limit'|'tracking_read_corrupt'|'tracking_read_interrupted'|'tracking_read_superseded'|'tracking_read_disabled'|'tracking_read_configuration_changed';message:string;retry:'explicit-refresh'};
export type TrackingReadCoverage={
 completeSnapshot:true;fullMailbox:false;humanReadVerified:false;namedRecipientIdentity:false;
 pages:number;observedEvents:number;retainedResponseBytes:number;bounds:TrackingReadBounds;
 cumulativeThrottled:{value:number;sampledAt:string;basisDigest:string};
};
export type TrackingReadSnapshot={snapshotRef:string;revision:number;acceptedAt:string;basisDigest:string;events:number;messages:number;coverage:TrackingReadCoverage};
export type TrackingReadView={
 version:1;policyVersion:typeof TRACKING_READ_POLICY;accountId:string;revision:number;contextVersion:string;
 snapshot:TrackingReadSnapshot|null;
 cache:{availability:'none'|'retained';events:number;messages:number;freshness:'not-refreshed'|'current'|'stale-basis'|'stale-configuration'|'preference-disabled'};
 refresh:{allowed:boolean;reason:TrackingReadUnavailableReason|null;basisDigest:string|null;active:null|{requestRef:string;acceptedAt:string};lastResult:null|{requestRef:string;state:'completed'|'failed'|'interrupted';finishedAt:string;error:TrackingReadError|null}};
 effectiveReadStatuses:boolean;effectiveRecentOpens:boolean;hostingVerified:boolean;
};
export type TrackingReadMessage={
 messageRef:string;generation:number;subject:string|null;
 snapshotCoverage:null|{snapshotRef:string;revision:number;basisDigest:string;completeSnapshot:true};
 availability:'available'|'waiting-for-message'|'unavailable';targetRef:string|null;targetVersion:string|null;
 evidence:'image-fetch';viewer:null;humanReadVerified:false;namedRecipientIdentity:false;
 state:'image-fetch-observed'|'no-direct-evidence';retainedEvents:number;lastObservedAt:string|null;
};
export type TrackingReadEvent={eventRef:string;messageRef:string;generation:number;observedAt:string;device:'desktop'|'mobile'|'unknown';proxy:'google-proxy'|'possible-apple-proxy'|'unknown';viewer:null;evidence:'image-fetch'};
export type TrackingReadFeed={
 accountId:string;policyVersion:typeof TRACKING_READ_POLICY;revision:number;contextVersion:string;snapshotRef:string|null;
 availability:'unavailable'|'empty'|'cached';reason:TrackingReadUnavailableReason|null;
 events:TrackingReadEvent[];messages:TrackingReadMessage[];nextCursor:string|null;coverage:TrackingReadCoverage|null;
};
export type TrackingReadMessageStatus={accountId:string;policyVersion:typeof TRACKING_READ_POLICY;revision:number;contextVersion:string;message:TrackingReadMessage;events:TrackingReadEvent[];nextCursor:string|null;coverage:TrackingReadCoverage|null};
export type TrackingReadRefreshRequest={accountId:string;clientRequestId:string;expectedRevision:number;expectedBasisDigest:string};
export type TrackingReadRefreshReceipt={
 id:string;accountId:string;clientRequestId:string;requestProtocol:'tracking-read-refresh-v1';requestFingerprint:string;
 request:TrackingReadRefreshRequest;priorRevision:number;acceptedRevision:number;acceptedAt:string;basisDigest:string;bounds:TrackingReadBounds;
};
export type TrackingReadAccepted={revision:number;contextVersion:string;previousSnapshotRef:string|null};
export type TrackingReadRefreshResult={state:'completed'|'failed'|'interrupted';finishedAt:string;revision:number;snapshot:TrackingReadSnapshot|null;error:TrackingReadError|null};
export type TrackingReadRefreshResponse={
 receipt:TrackingReadRefreshReceipt;state:'accepted'|'completed'|'failed'|'interrupted';accepted:TrackingReadAccepted;
 result:TrackingReadRefreshResult|null;historical:boolean;
};
// Sole deliberate bridge back into the already authorized existing Mail namespace.
export type TrackingReadTarget={accountId:string;targetRef:string;targetVersion:string;revision:number;availability:'available'|'waiting-for-message'|'unavailable'|'stale';target:null|{kind:'mail';accountId:string;threadId:string;messageId:string}};
export type TrackingReadMailReference={messageRef:string};
export type TrackingReadHttpError={error:{code:string;message:string}};
