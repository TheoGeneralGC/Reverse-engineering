// Browser-safe main-app foundation. Collector URLs, keys, tokens and opaque tenant refs never appear here.
export const TRACKING_MAIN_POLICY='local-tracking-foundation-v1' as const;
export type TrackingDesiredPreferences={readStatuses:boolean;recentOpens:boolean};
export type TrackingPreferences={version:1;accountId:string;revision:number;updatedAt:string|null;persisted:boolean;desired:TrackingDesiredPreferences;provenance:{kind:'local-disabled-default'|'account-saved';originalDefaultVerified:false}};
export type TrackingCapabilities={policyVersion:typeof TRACKING_MAIN_POLICY;foundationImplemented:true;collector:{configured:boolean;verification:'not-checked';configurationFingerprint:string|null;provenance:'server-configuration'|'not-configured'};deliveryIntegrated:false;effectiveReadStatuses:false;effectiveRecentOpens:false;reason:'collector-not-configured'|'delivery-integration-unavailable';humanReadVerified:false;namedRecipientIdentity:false;teamSharing:false;provenance:'local-design';recentOpensCoupling:'requires-read-statuses'};
export type TrackingPreferencesResponse={preferences:TrackingPreferences;capabilities:TrackingCapabilities};
export type TrackingPreferencesSaveRequest={accountId:string;clientRequestId:string;expectedRevision:number;desired:TrackingDesiredPreferences};
export type TrackingPreferencesReceipt={id:string;accountId:string;clientRequestId:string;priorRevision:number;acceptedRevision:number;acceptedAt:string;requestProtocol:'tracking-prefs-v1';requestFingerprint:string;request:TrackingPreferencesSaveRequest;preferencesFingerprint:string};
export type TrackingPreferencesSaveResponse=TrackingPreferencesResponse&{receipt:TrackingPreferencesReceipt;historical:boolean};
export type TrackingHttpError={error:{code:string;message:string}};
