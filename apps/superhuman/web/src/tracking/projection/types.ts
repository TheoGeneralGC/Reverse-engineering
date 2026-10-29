/** Clean-room projection contract. No collector secrets, URLs, email claims or notification capability. */
export type Scope = Readonly<{accountId:string;threadId:string;messageId:string}>;
export type DeviceHint = 'desktop'|'mobile'|'unknown';
export type ProxyHint = 'google-proxy'|'possible-apple-proxy'|'unknown';
export type Viewer = null | Readonly<{kind:'self';source:'authenticated-main-account';accountId:string}>;
export type ImageFetch = Scope & Readonly<{id:string;registrationId:string;observedAt:number;device:DeviceHint;proxy:ProxyHint;viewer:Viewer;evidence:'image-fetch'}>;
/** Main-app authorization and immutable delivery binding are prerequisites; this type is not authorization. */
export type ConfirmedBinding = Scope & Readonly<{registrationId:string;deliveryRef:string;acknowledgementRef:string;deliveryConfirmed:true}>;
export type CollectorEventV3 = Readonly<{id:string;registrationId:string;deliveryRef:string;acknowledgementRef:string;observedAt:number;device:DeviceHint;proxy:ProxyHint;viewer:null;evidence:'image-fetch'}>;
export type Coverage = Readonly<{hasMore:boolean;throttled:number;fullMailbox:false;humanReadVerified:false}>;
export type LedgerSnapshot = Readonly<{events:readonly ImageFetch[];coverage:Coverage}>;
export type MessageContext = Scope & Readonly<{tracked:boolean;deliveryConfirmed:boolean;selfAddressed:boolean;replyDerived:boolean}>;
export type FetchGroup = Readonly<{key:string;viewer:'unknown'|'self';device:DeviceHint;proxyHints:readonly ProxyHint[];readAt:number;latestObservedAt:number;representativeEventId:string;sourceEventIds:readonly string[];evidence:'image-fetch';humanReadVerified:false}>;
export type MessageProjection = Readonly<{scope:Scope;status:'not-tracked'|'delivery-unconfirmed'|'self-addressed'|'image-fetch-observed'|'reply-derived'|'self-view-only'|'no-fetch-observed';checkCandidate:'none'|'single'|'double';groups:readonly FetchGroup[];selfGroups:readonly FetchGroup[];rawFetchCount:number;displayFetchCount:number;selfFetchCount:number;countIsLowerBound:boolean;replyDerived:boolean;selfAddressed:boolean;deliveryConfirmed:boolean;humanReadVerified:false;dedupePolicy:'utc-minute-retain-milliseconds-v1';coverage:Coverage}>;
export type FeedMessage = Readonly<{context:MessageContext;subject:string}>;
export type FeedRow = Scope & Readonly<{key:string;subject:string;viewer:'unknown';proxyHints:readonly ProxyHint[];latestObservedAt:number;latestEventId:string;displayFetchCount:number;countIsLowerBound:boolean;evidence:'image-fetch';humanReadVerified:false}>;
export type FeedGroup = Readonly<{key:string;label:string;kind:'today'|'yesterday'|'last-seven-calendar-days'|'earlier-this-month'|'month'|'future';rows:readonly FeedRow[]}>;
export type FeedProjection = Readonly<{accountId:string;feedRevision:string;timeZone:string;referenceDay:string;rows:readonly FeedRow[];groups:readonly FeedGroup[];hasMoreLocalRows:boolean;coverage:Coverage;humanReadVerified:false}>;
export type NavigationContext = Readonly<{accountId:string;epoch:number;workspace:string;editorId:string|null}>;
export type FeedIntent = Scope & Readonly<{version:1;rowKey:string;latestEventId:string;feedRevision:string;context:NavigationContext}>;
