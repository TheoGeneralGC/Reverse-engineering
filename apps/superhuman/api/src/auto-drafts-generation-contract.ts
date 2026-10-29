import {AUTO_DRAFT_REPLY_OUTPUT_BYTES} from './auto-drafts-reply-policy.ts';
// SHARED SCHEMA PROPOSAL: validators implemented; no engine/routes or transport.
// No Store, scheduler, provider, model, HTTP transport, environment or side effects.
import {parseSnapshot,stable,parseRequest as parseV1Request,parseSaveResponse as parseV1Response,ContractError,type PreferencesSnapshot,type SchedulingSnapshot,type PreferenceSave,type SaveResponse} from './auto-drafts-contract.ts';
export type {PreferenceSave, SaveResponse};
export const POLICY='auto-drafts-responses-create-local-v2' as const;
export const CONTROL_PROTOCOL='auto-drafts-engine-control-v2' as const;
// Additive route metadata only; receipt/request parsers remain imported v1 bytes.
export const ROUTES={preferenceRecovery:{method:'GET',path:'/api/auto-drafts/v2/requests/by-request/:key',query:['accountId','section'],response:'SaveResponse'},threadPublication:{method:'GET',path:'/api/auto-drafts/v2/thread-publication',query:['accountId','threadId'],response:'ThreadPublicationResponse'}} as const;
export const LIMITS={contextMessages:10,serializedRequestBytes:65536,outputBytes:32768,outputTokens:4096,modelRounds:1,fixtureAttemptsPerActivation:20,queuedPerAccount:32,activePerAccount:1,activeGlobal:2,modelTimeoutMs:60000,claimLeaseMs:90000} as const;
export type Ref=string; // Canonical UUIDv4. Existing account/settings IDs retain v1 grammar.
export type Hash=string; // Lowercase SHA256 hex64. All numbers are safe nonnegative integers.
export type Iso=string; // Canonical UTC ISO (Date.toISOString identity).
export type PreferencesBasis={settingsId:string;revision:number;fingerprint:Hash};
export type IngressBarrier={sequence:number;internalDateAfter:Iso;baselineVersion:Hash};
type ActivationCommon={id:Ref;epoch:number;createdAt:Iso;preferences:PreferencesBasis;accountVersion:Hash;attemptLimit:number;budgetSource:'configuration'|'fixture'};
export type Activation=ActivationCommon & (
 {status:'pending';configurationVersion:Hash|null;readyAt:null;barrier:null;endedAt:null;reason:null}|
 {status:'active';configurationVersion:Hash;readyAt:Iso;barrier:IngressBarrier;endedAt:null;reason:null}|
 {status:'stopped'|'invalidated'|'exhausted';configurationVersion:Hash|null;readyAt:Iso|null;barrier:IngressBarrier|null;endedAt:Iso;reason:'explicit-stop'|'preferences-changed'|'account-changed'|'configuration-changed'|'budget-exhausted'}
);
export type EngineSnapshot={version:2;policy:typeof POLICY;accountId:string;revision:number;persisted:boolean;updatedAt:Iso|null;activation:Activation|null};
export type Readiness={accountVersion:Hash;configurationVersion:Hash|null;ingressReady:boolean;source:'google-live-history-v1'|null;responseGeneration:'available'|'model-unavailable'|'ingress-not-ready'|'source-unavailable'|'identity-incomplete'|'build-disabled'};
export type Usage={activationId:Ref|null;version:number;attemptsIssued:number;queued:number};
export type EngineStatus={engine:EngineSnapshot;preferences:PreferencesSnapshot;scheduling:SchedulingSnapshot;readiness:Readiness;usage:Usage;effective:{responses:boolean;reason:'active'|'not-activated'|'stopped'|'preferences-changed'|'responses-off'|'account-changed'|'configuration-changed'|'budget-exhausted'|'unavailable'};capabilities:{policy:typeof POLICY;followUps:false;followUpReason:'reminder-trigger-not-implemented';teammateScheduling:false;teammateReason:'team-directory-unavailable';createOnly:true;automaticCloudSave:boolean;automaticSend:false;automaticSchedule:false;originalGenerationVerified:false}};
// DIAGNOSTIC/OPERATOR ONLY; no product Activate step or browser route.
export type DiagnosticEngineControlRequest={accountId:string;clientRequestId:string;expectedEngineRevision:number} & ({action:'activate';expectedPreferences:PreferencesBasis;expectedAccountVersion:Hash;expectedConfigurationVersion:Hash|null;attemptLimit:number}|{action:'deactivate';expectedActivationId:Ref|null});
export type DiagnosticEngineControlReceipt={id:Ref;accountId:string;clientRequestId:string;protocol:typeof CONTROL_PROTOCOL;request:DiagnosticEngineControlRequest;requestFingerprint:Hash;priorRevision:number;acceptedRevision:number;changed:boolean;acceptedAt:Iso;snapshotFingerprint:Hash};
export type DiagnosticEngineControlResponse={receipt:DiagnosticEngineControlReceipt;acceptedEngine:EngineSnapshot;historical:boolean};
export type Reason='initial-or-repair-import'|'before-activation'|'duplicate-version'|'preferences-disabled'|'activation-invalid'|'account-changed'|'configuration-changed'|'source-not-current'|'source-ineligible'|'reply-metadata-incomplete'|'prior-outbound-unproved'|'existing-thread-draft'|'thread-delivery-or-cloud-uncertain'|'context-budget'|'activation-budget'|'queue-budget'|'worker-closed'|'lease-invalid'|'publication-conflict'|'invalid-output'|'model-timeout'|'transport-or-process-unknown';
export type GenerationState='queued'|'claimed'|'dispatch-issued'|'published'|'no-draft'|'insufficient-context'|'suppressed'|'superseded'|'failed-not-dispatched'|'output-rejected'|'model-outcome-unknown';
export const TRANSITIONS:Readonly<Record<GenerationState,readonly GenerationState[]>>={
 queued:['claimed','suppressed','superseded','failed-not-dispatched'],
 claimed:['queued','dispatch-issued','suppressed','superseded','failed-not-dispatched'],
 'dispatch-issued':['published','no-draft','insufficient-context','superseded','output-rejected','model-outcome-unknown'],
 published:[], 'no-draft':[], 'insufficient-context':[], suppressed:[], superseded:[], 'failed-not-dispatched':[], 'output-rejected':[], 'model-outcome-unknown':[],
};
export type Generation={version:2;id:Ref;accountId:string;activationId:Ref;activationEpoch:number;sourceRef:Ref;inputVersion:Hash;ordinal:number;revision:number;state:GenerationState;createdAt:Iso;updatedAt:Iso;attempt:{ref:Ref;issuedAt:Iso}|null;result:{kind:'draft'|'no-draft'|'insufficient-context';fingerprint:Hash}|null;publication:{targetRef:Ref;targetVersion:Hash;publishedAt:Iso;contentHash:Hash}|null;reason:Reason|null};
export type GenerationPage={accountId:string;policy:typeof POLICY;throughOrdinal:number;coverage:{scope:'local-ingress-since-activation';fullMailbox:false};records:Generation[];nextCursor:string|null;hasMore:boolean};
// Only this resolver may enter the existing authorized Mail ID namespace. Status/history
// contain opaque refs and hashes, no provider IDs/URLs, model input, addresses or credentials.
export type SourceResolution={accountId:string;sourceRef:Ref;expectedInputVersion:Hash}&({availability:'available';currentInputVersion:Hash;target:{kind:'thread';threadId:string}}|{availability:'changed';currentInputVersion:Hash;target:null}|{availability:'deleted'|'unavailable';currentInputVersion:null;target:null});
export type TargetResolution={accountId:string;targetRef:Ref;expectedTargetVersion:Hash}&({availability:'available';currentTargetVersion:Hash;target:{kind:'draft';draftId:string}}|{availability:'changed';currentTargetVersion:Hash;target:null}|{availability:'deleted'|'unavailable';currentTargetVersion:null;target:null});
// Additional explicit Mail namespace surface: exact thread/source placement.
// No draft ID or model context is included; target resolution stays separate.
export type ThreadPublication={bindingVersion:Hash;generationId:Ref;sourceRef:Ref;inputVersion:Hash;sourceMessageId:string;targetRef:Ref;targetVersion:Hash;publishedAt:Iso;contentHash:Hash;quotedBody?:{quoteStartUtf8:number}};
export type ThreadPublicationResponse={accountId:string;threadId:string}&({availability:'available';publication:ThreadPublication}|{availability:'unavailable';publication:null});
export type ErrorCode='auto_draft_generation_invalid_request'|'auto_draft_generation_not_found'|'auto_draft_generation_revision_conflict'|'auto_draft_generation_request_conflict'|'auto_draft_generation_basis_conflict'|'auto_draft_generation_unavailable'|'auto_draft_generation_ingress_not_ready'|'auto_draft_generation_responses_disabled'|'auto_draft_generation_target_changed'|'auto_draft_generation_corrupt'|'auto_draft_generation_stopping';
export type ErrorResponse={error:{code:ErrorCode;message:string}};

// Worker-only protocol. Never serialize any of these into the browser response.
export type IngressVersion={version:1;id:Ref;accountId:string;accountVersion:Hash;sequence:number;sourceRef:Ref;inputVersion:Hash;providerInternalDate:Iso;committedAt:Iso;origin:'google-live-history-message-added'|'initial-import'|'catchup-import'|'repair-import';history:{entryId:string;afterCursor:string;throughCursor:string;addedSourceRefs:Ref[]}|null;baselineVersion:Hash;immutableFactsHash:Hash};
export type NoTargetBasis={kind:'create';threadRef:Ref;threadInputVersion:Hash;threadDraftSetVersion:number;replyMetadataVersion:Hash;sourceFactsVersion:Hash};
export type FrozenInput={version:1;generationId:Ref;accountId:string;activationId:Ref;activationEpoch:number;preferences:PreferencesBasis;accountVersion:Hash;configurationVersion:Hash;sourceRef:Ref;inputVersion:Hash;target:NoTargetBasis;context:{messages:{ref:Ref;role:'incoming'|'outgoing';participantLabel:string;date:Iso;text:string}[];omittedMessageCount:number;personalization:{enabled:boolean;revision:number;fingerprint:Hash;text:string}};replyPlanFingerprint:Hash;requestFingerprint:Hash;requestBytes:number};
export type FrozenDispatch={generationId:Ref;leaseId:Ref;ownerEpoch:Ref;attemptRef:Ref;configurationVersion:Hash;requestFingerprint:Hash;requestUtf8:string;leaseUntil:Iso};
export type ModelDecision={kind:'draft';plainText:string;sourceRefs:Ref[]}|{kind:'no-draft';reason:'reply-not-needed'|'already-addressed';sourceRefs:Ref[]}|{kind:'insufficient-context';reason:'truncated-or-missing-facts';sourceRefs:Ref[]};

// Phase2 update proposal ONLY; not a v2 route, capability or executable worker.
// Every accepted authoring write increments authoredVersion even if bytes return
// to an earlier value. Human claims/tombstones never reset on Undo/reopen.
export type DraftAuthoringState={draftRef:Ref;accountId:string;authoredVersion:number;humanClaimed:boolean;tombstone:{version:number;reason:'discarded'|'sent'|'scheduled'|'delivery-unknown'|'cloud-uncertain';at:Iso}|null;lastEngineBinding:{generationId:Ref;acceptedAuthoredVersion:number;contentHash:Hash}|null};
export type UpdatePublicationBasis={kind:'update';draftRef:Ref;expectedAuthoredVersion:number;expectedEngineGenerationId:Ref;expectedContentHash:Hash;expectedTombstoneVersion:number;threadInputVersion:Hash;preferences:PreferencesBasis;activationId:Ref;activationEpoch:number;accountVersion:Hash;configurationVersion:Hash};
export type AuthoringClaimRequest={accountId:string;clientRequestId:string;draftRef:Ref;expectedAuthoredVersion:number;expectedEngineGenerationId:Ref};

// Shared runtime-schema functions only. They validate/copy data; no trigger,
// lease, scheduler, dispatch, publication or persistence is implemented here.
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const reasons:Reason[]=['initial-or-repair-import','before-activation','duplicate-version','preferences-disabled','activation-invalid','account-changed','configuration-changed','source-not-current','source-ineligible','reply-metadata-incomplete','prior-outbound-unproved','existing-thread-draft','thread-delivery-or-cloud-uncertain','context-budget','activation-budget','queue-budget','worker-closed','lease-invalid','publication-conflict','invalid-output','model-timeout','transport-or-process-unknown'];
const safe=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const ref=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function assertGeneration(v:unknown):asserts v is Generation {
 if(!exact(v,['version','id','accountId','activationId','activationEpoch','sourceRef','inputVersion','ordinal','revision','state','createdAt','updatedAt','attempt','result','publication','reason'])||v.version!==2||!ref(v.id)||typeof v.accountId!=='string'||!v.accountId||new TextEncoder().encode(v.accountId).length>1024||/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v.accountId)||!ref(v.activationId)||!ref(v.sourceRef)||!hash(v.inputVersion)||!safe(v.activationEpoch)||!Number(v.activationEpoch)||!safe(v.ordinal)||!Number(v.ordinal)||!safe(v.revision)||!Number(v.revision)||!iso(v.createdAt)||!iso(v.updatedAt)||Date.parse(String(v.updatedAt))<Date.parse(String(v.createdAt))||typeof v.state!=='string'||!Object.hasOwn(TRANSITIONS,v.state))throw Error('invalid generation');
 const attempted=v.attempt!==null;if(attempted&&(!exact(v.attempt,['ref','issuedAt'])||!ref(v.attempt.ref)||!iso(v.attempt.issuedAt)||Date.parse(String(v.attempt.issuedAt))<Date.parse(String(v.createdAt))||Date.parse(String(v.attempt.issuedAt))>Date.parse(String(v.updatedAt))))throw Error('invalid attempt');
 if(['queued','claimed','suppressed','failed-not-dispatched'].includes(v.state)&&attempted||['dispatch-issued','published','no-draft','insufficient-context','output-rejected','model-outcome-unknown'].includes(v.state)&&!attempted)throw Error('invalid dispatch proof');
 if(v.result!==null&&(!exact(v.result,['kind','fingerprint'])||!['draft','no-draft','insufficient-context'].includes(String(v.result.kind))||!hash(v.result.fingerprint)))throw Error('invalid result');
 if(v.state==='published'){if(!exact(v.publication,['targetRef','targetVersion','publishedAt','contentHash'])||!ref(v.publication.targetRef)||!hash(v.publication.targetVersion)||!hash(v.publication.contentHash)||!iso(v.publication.publishedAt)||Date.parse(String(v.publication.publishedAt))<Date.parse(String((v.attempt as Record<string,unknown>)?.issuedAt))||Date.parse(String(v.publication.publishedAt))>Date.parse(String(v.updatedAt))||!object(v.result)||v.result.kind!=='draft')throw Error('invalid publication')}else if(v.publication!==null)throw Error('unexpected publication');
 if(v.state==='no-draft'&&(!object(v.result)||v.result.kind!=='no-draft')||v.state==='insufficient-context'&&(!object(v.result)||v.result.kind!=='insufficient-context'))throw Error('invalid decision');
 if(['queued','claimed','dispatch-issued','model-outcome-unknown','output-rejected'].includes(v.state)&&v.result!==null||v.result!==null&&!attempted)throw Error('unexpected result');
 if(v.reason!==null&&(typeof v.reason!=='string'||!reasons.includes(v.reason as Reason)))throw Error('invalid reason');
 if(['suppressed','superseded','failed-not-dispatched','output-rejected','model-outcome-unknown'].includes(v.state)?v.reason===null:v.reason!==null)throw Error('inconsistent reason');
 if(v.state==='output-rejected'&&v.reason!=='invalid-output'||v.state==='model-outcome-unknown'&&!['model-timeout','transport-or-process-unknown'].includes(String(v.reason)))throw Error('inconsistent failure');
 if(v.reason==='invalid-output'&&v.state!=='output-rejected'||['model-timeout','transport-or-process-unknown'].includes(String(v.reason))&&v.state!=='model-outcome-unknown')throw Error('mismatched failure state');
}

// Gmail history counters are decimal STRING identifiers; Number conversion is forbidden.
export function decimalCounter(v:unknown):string{if(typeof v!=='string'||!/^(?:0|[1-9][0-9]{0,127})$/.test(v))throw Error('invalid decimal counter');return v;}
export function compareCounters(a:string,b:string):-1|0|1{decimalCounter(a);decimalCounter(b);return a.length===b.length?(a===b?0:a<b?-1:1):a.length<b.length?-1:1;}
export function assertSourceResolution(v:unknown,expected:{accountId:string;sourceRef:Ref;expectedInputVersion:Hash}):asserts v is SourceResolution {
 if(!exact(v,['accountId','sourceRef','expectedInputVersion','currentInputVersion','availability','target'])||v.accountId!==expected.accountId||v.sourceRef!==expected.sourceRef||v.expectedInputVersion!==expected.expectedInputVersion||!ref(v.sourceRef)||!hash(v.expectedInputVersion))throw Error('invalid source context');
 if(v.availability==='available'){if(v.currentInputVersion!==expected.expectedInputVersion||!exact(v.target,['kind','threadId'])||v.target.kind!=='thread'||typeof v.target.threadId!=='string'||!v.target.threadId||new TextEncoder().encode(v.target.threadId).length>1024||/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v.target.threadId))throw Error('invalid source target')}
 else if(v.availability==='changed'){if(!hash(v.currentInputVersion)||v.currentInputVersion===expected.expectedInputVersion||v.target!==null)throw Error('invalid source change')}
 else if(!['deleted','unavailable'].includes(String(v.availability))||v.currentInputVersion!==null||v.target!==null)throw Error('invalid unavailable source');
}

// Canonical full runtime boundary. No IO/crypto implementation: caller injects SHA256.
export type Digest=(utf8:string)=>Promise<string>;
export class GenerationSchemaError extends Error{constructor(){super('Auto Draft generation payload could not be verified')}}
const fail=():never=>{throw new GenerationSchemaError()};
const own=(v:unknown,keys:string[])=>exact(v,keys)?v:fail();
const enumValue=<const T extends readonly string[]>(v:unknown,values:T):T[number]=>typeof v==='string'&&values.includes(v)?v:fail();
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number=>safe(v)&&Number(v)>=min&&Number(v)<=max?Number(v):fail();
const identity=(v:unknown):string=>typeof v==='string'&&v.length>0&&new TextEncoder().encode(v).length<=1024&&!/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v)?v:fail();
const reference=(v:unknown):Ref=>ref(v)?String(v):fail();
const fingerprint=(v:unknown):Hash=>hash(v)?String(v):fail();
const timestamp=(v:unknown):Iso=>iso(v)?String(v):fail();
const boolean=(v:unknown):boolean=>typeof v==='boolean'?v:fail();
const nullableHash=(v:unknown)=>v===null?null:fingerprint(v);
const nullableIso=(v:unknown)=>v===null?null:timestamp(v);
const boundedText=(v:unknown,maxBytes:number,allowEmpty=true):string=>typeof v==='string'&&(allowEmpty||v.length>0)&&new TextEncoder().encode(v).length<=maxBytes&&!/[\p{Surrogate}\u0000]/u.test(v)?v:fail();
const copy=<T>(v:T):T=>{try{return structuredClone(v)}catch{return fail()}};
const equivalent=(a:unknown,b:unknown)=>stable(a)===stable(b);
const byteLength=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
const laterOrEqual=(a:Iso,b:Iso)=>Date.parse(a)>=Date.parse(b);
const requestKey=(v:unknown):string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)?v:fail();
const cursor=(v:unknown):string=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,4096}$/.test(v)||v.length%4===1)return fail();const last='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(v.at(-1)!);if(v.length%4===2&&(last&15)!==0||v.length%4===3&&(last&3)!==0)return fail();return v};
function referenceList(v:unknown,min:number,max:number):Ref[]{if(!Array.isArray(v)||v.length<min||v.length>max)return fail();const a=v.map(reference);if(new Set(a).size!==a.length)return fail();return a;}
function preferencesBasis(v:unknown):PreferencesBasis{const o=own(v,['settingsId','revision','fingerprint']);return{settingsId:identity(o.settingsId),revision:integer(o.revision,1),fingerprint:fingerprint(o.fingerprint)}}
function barrier(v:unknown):IngressBarrier{const o=own(v,['sequence','internalDateAfter','baselineVersion']);return{sequence:integer(o.sequence),internalDateAfter:timestamp(o.internalDateAfter),baselineVersion:fingerprint(o.baselineVersion)}}
export function parseActivation(v:unknown):Activation{
 const o=own(v,['id','epoch','status','createdAt','readyAt','endedAt','reason','preferences','accountVersion','configurationVersion','barrier','attemptLimit','budgetSource']);
 const common={id:reference(o.id),epoch:integer(o.epoch,1),createdAt:timestamp(o.createdAt),preferences:preferencesBasis(o.preferences),accountVersion:fingerprint(o.accountVersion),attemptLimit:integer(o.attemptLimit,1),budgetSource:enumValue(o.budgetSource,['configuration','fixture'])};
 const status=enumValue(o.status,['pending','active','stopped','invalidated','exhausted']),configurationVersion=nullableHash(o.configurationVersion),readyAt=nullableIso(o.readyAt),endedAt=nullableIso(o.endedAt),bound=o.barrier===null?null:barrier(o.barrier);
 if(status==='pending'){if(readyAt!==null||bound!==null||endedAt!==null||o.reason!==null)return fail();return{...common,status,configurationVersion,readyAt:null,barrier:null,endedAt:null,reason:null}}
 if(readyAt===null?bound!==null:bound===null||configurationVersion===null||bound.internalDateAfter!==readyAt||!laterOrEqual(readyAt,common.createdAt))return fail();
 if(status==='active'){if(configurationVersion===null||readyAt===null||bound===null||endedAt!==null||o.reason!==null)return fail();return{...common,status,configurationVersion,readyAt,barrier:bound,endedAt:null,reason:null}}
 const reason=enumValue(o.reason,['explicit-stop','preferences-changed','account-changed','configuration-changed','budget-exhausted']);
 if(endedAt===null||!laterOrEqual(endedAt,readyAt??common.createdAt)||status==='stopped'&&reason!=='explicit-stop'||status==='exhausted'&&reason!=='budget-exhausted'||status==='invalidated'&&!['preferences-changed','account-changed','configuration-changed'].includes(reason))return fail();
 return{...common,status,configurationVersion,readyAt,barrier:bound,endedAt,reason};
}
export function parseEngineSnapshot(v:unknown,accountId:string):EngineSnapshot{
 const o=own(v,['version','policy','accountId','revision','persisted','updatedAt','activation']);if(o.version!==2||o.policy!==POLICY||identity(o.accountId)!==identity(accountId))return fail();
 const revision=integer(o.revision),persisted=boolean(o.persisted),updatedAt=nullableIso(o.updatedAt),activation=o.activation===null?null:parseActivation(o.activation);
 if(!persisted?(revision!==0||updatedAt!==null||activation!==null):(revision<1||updatedAt===null||activation===null||!laterOrEqual(updatedAt,activation.endedAt??activation.readyAt??activation.createdAt)))return fail();
 return{version:2,policy:POLICY,accountId,revision,persisted,updatedAt,activation};
}
function parseReadiness(v:unknown):Readiness{
 const o=own(v,['accountVersion','configurationVersion','ingressReady','source','responseGeneration']),accountVersion=fingerprint(o.accountVersion),configurationVersion=nullableHash(o.configurationVersion),ingressReady=boolean(o.ingressReady),source=o.source===null?null:enumValue(o.source,['google-live-history-v1']),responseGeneration=enumValue(o.responseGeneration,['available','model-unavailable','ingress-not-ready','source-unavailable','identity-incomplete','build-disabled']);
 if(responseGeneration==='available'&&(configurationVersion===null||!ingressReady||source===null)||responseGeneration==='ingress-not-ready'&&(configurationVersion===null||ingressReady||source===null)||responseGeneration==='source-unavailable'&&(source!==null||ingressReady)||ingressReady&&source===null)return fail();
 return{accountVersion,configurationVersion,ingressReady,source,responseGeneration};
}
function statusCore(v:unknown,accountId:string):EngineStatus{
 const o=own(v,['engine','preferences','scheduling','readiness','usage','effective','capabilities']),engine=parseEngineSnapshot(o.engine,accountId),preferences=parseSnapshot(o.preferences),scheduling=parseSnapshot(o.scheduling);
 if(preferences.section!=='preferences'||scheduling.section!=='teammate-scheduling'||preferences.accountId!==accountId||scheduling.accountId!==accountId)return fail();
 const readiness=parseReadiness(o.readiness),u=own(o.usage,['activationId','version','attemptsIssued','queued']),usage:Usage={activationId:u.activationId===null?null:reference(u.activationId),version:integer(u.version),attemptsIssued:integer(u.attemptsIssued),queued:integer(u.queued,0,LIMITS.queuedPerAccount)};
 const a=engine.activation;
 if(a?(usage.activationId!==a.id||usage.attemptsIssued>a.attemptLimit||a.status==='exhausted'&&usage.attemptsIssued!==a.attemptLimit):(usage.activationId!==null||usage.version!==0||usage.attemptsIssued!==0||usage.queued!==0))return fail();
 if(usage.version===0&&(usage.attemptsIssued!==0||usage.queued!==0))return fail();
 const e=own(o.effective,['responses','reason']),effective={responses:boolean(e.responses),reason:enumValue(e.reason,['active','not-activated','stopped','preferences-changed','responses-off','account-changed','configuration-changed','budget-exhausted','unavailable'])};
 const c=own(o.capabilities,['policy','followUps','followUpReason','teammateScheduling','teammateReason','createOnly','automaticCloudSave','automaticSend','automaticSchedule','originalGenerationVerified']),automaticCloudSave=boolean(c.automaticCloudSave);
 if(c.policy!==POLICY||c.followUps!==false||c.followUpReason!=='reminder-trigger-not-implemented'||c.teammateScheduling!==false||c.teammateReason!=='team-directory-unavailable'||c.createOnly!==true||c.automaticSend!==false||c.automaticSchedule!==false||c.originalGenerationVerified!==false)return fail();
 return{engine,preferences,scheduling,readiness,usage,effective,capabilities:{policy:POLICY,followUps:false,followUpReason:'reminder-trigger-not-implemented',teammateScheduling:false,teammateReason:'team-directory-unavailable',createOnly:true,automaticCloudSave,automaticSend:false,automaticSchedule:false,originalGenerationVerified:false}};
}
function expectedEffective(s:EngineStatus,currentPreferencesHash:Hash):EngineStatus['effective']{
 const a=s.engine.activation;let reason:EngineStatus['effective']['reason'];
 if(a===null)reason='not-activated';
 else if(!s.preferences.value.responsesEnabled)reason='responses-off';
 else if(a.preferences.settingsId!==s.preferences.settingsId||a.preferences.revision!==s.preferences.revision||a.preferences.fingerprint!==currentPreferencesHash)reason='preferences-changed';
 else if(a.accountVersion!==s.readiness.accountVersion||a.status==='invalidated'&&a.reason==='account-changed')reason='account-changed';
 else if(a.status==='exhausted'||s.usage.attemptsIssued>=a.attemptLimit)reason='budget-exhausted';
 else if(a.status==='invalidated')reason=a.reason==='preferences-changed'?'preferences-changed':'configuration-changed';
 else if(a.status==='stopped')reason='stopped';
 else if(a.configurationVersion!==null&&a.configurationVersion!==s.readiness.configurationVersion)reason='configuration-changed';
 else if(s.readiness.responseGeneration!=='available'||a.status==='pending')reason='unavailable';
 else reason='active';
 return{responses:reason==='active',reason};
}
async function checkedStatus(s:EngineStatus,digest:Digest):Promise<EngineStatus>{
 const h=fingerprint(await digest(stable(s.preferences))),a=s.engine.activation;
 if(a&&a.preferences.settingsId===s.preferences.settingsId&&a.preferences.revision===s.preferences.revision&&a.preferences.fingerprint!==h)return fail();
 if(!equivalent(s.effective,expectedEffective(s,h)))return fail();return s;
}
export function assertEngineProgress(previous:EngineSnapshot,next:EngineSnapshot):void{
 if(previous.accountId!==next.accountId||next.revision<previous.revision)return fail();if(next.revision===previous.revision){if(!equivalent(previous,next))return fail();return}
 if(!next.persisted||previous.updatedAt&&next.updatedAt&&!laterOrEqual(next.updatedAt,previous.updatedAt))return fail();
 const a=previous.activation,b=next.activation;if(a&&!b)return fail();if(!a||!b)return;
 if(a.id!==b.id){if(b.epoch<=a.epoch||!laterOrEqual(b.createdAt,a.createdAt))return fail();return}
 for(const key of ['epoch','createdAt','preferences','accountVersion','attemptLimit','budgetSource']as const)if(!equivalent(a[key],b[key]))return fail();
 if(a.configurationVersion!==null&&a.configurationVersion!==b.configurationVersion||a.barrier!==null&&!equivalent(a.barrier,b.barrier)||a.readyAt!==null&&a.readyAt!==b.readyAt)return fail();
 if(['stopped','invalidated','exhausted'].includes(a.status)){if(!equivalent(a,b))return fail()}
 else if(a.status==='active'&&b.status==='pending')return fail();
}
export async function parseEngineStatus(v:unknown,accountId:string,digest:Digest,previous?:EngineStatus):Promise<EngineStatus>{
 // Capture/validate every raw/context object before the first asynchronous digest.
 const account=identity(accountId),next=statusCore(v,account),prior=previous===undefined?undefined:statusCore(previous,account);
 await checkedStatus(next,digest);if(prior){await checkedStatus(prior,digest);assertEngineProgress(prior.engine,next.engine);
  if(prior.engine.activation?.id===next.engine.activation?.id&&prior.engine.activation?.status==='active'&&!prior.effective.responses&&next.effective.responses){
   // A normal read lease temporarily blocks ingress; it does not invalidate a
   // known eligibility barrier. Every other observed availability gap retains
   // the existing fresh-activation requirement.
   const transient=prior.effective.reason==='unavailable'&&prior.readiness.responseGeneration==='ingress-not-ready'&&!prior.readiness.ingressReady&&next.readiness.responseGeneration==='available'&&next.readiness.ingressReady&&next.engine.revision>prior.engine.revision&&equivalent(prior.engine.activation,next.engine.activation)&&equivalent(prior.preferences,next.preferences)&&prior.readiness.accountVersion===next.readiness.accountVersion&&prior.readiness.configurationVersion===next.readiness.configurationVersion&&prior.readiness.source===next.readiness.source;
   if(!transient)return fail();
  }
  for(const key of ['preferences','scheduling']as const){const a=prior[key],b=next[key];if(b.revision<a.revision||b.revision===a.revision&&!equivalent(a,b)||a.persisted&&b.settingsId!==a.settingsId)return fail()}
  if(prior.usage.activationId===next.usage.activationId&&(next.usage.attemptsIssued<prior.usage.attemptsIssued||next.usage.version<prior.usage.version||next.usage.version===prior.usage.version&&!equivalent(next.usage,prior.usage)))return fail();
 }
 return next;
}
export function parseGeneration(v:unknown,accountId:string,previous?:Generation):Generation{
 const next=copy(v);assertGeneration(next);if(next.accountId!==identity(accountId))return fail();if(previous)assertGenerationProgress(parseGeneration(previous,accountId),next);return next;
}
export function assertGenerationProgress(previous:Generation,next:Generation):void{
 for(const key of ['id','accountId','activationId','activationEpoch','sourceRef','inputVersion','ordinal','createdAt']as const)if(previous[key]!==next[key])return fail();
 if(next.revision<previous.revision||!laterOrEqual(next.updatedAt,previous.updatedAt))return fail();if(next.revision===previous.revision){if(!equivalent(previous,next))return fail();return}
 if(TRANSITIONS[previous.state].length===0)return fail();
 const seen=new Set<GenerationState>(),queue=[previous.state];while(queue.length){const s=queue.shift()!;if(seen.has(s))continue;seen.add(s);queue.push(...TRANSITIONS[s])}if(!seen.has(next.state))return fail();
 for(const key of ['attempt','result','publication']as const)if(previous[key]!==null&&!equivalent(previous[key],next[key]))return fail();
}
export type PageContext={accountId:string;limit:number;throughOrdinal?:number;beforeOrdinal?:number;requestCursor?:string|null;seenIds?:readonly Ref[]};
export function parseGenerationPage(v:unknown,context:PageContext):GenerationPage{
 const expected=copy(context);if(!object(expected)||!Object.hasOwn(expected,'accountId')||!Object.hasOwn(expected,'limit')||Object.keys(expected).some(k=>!['accountId','limit','throughOrdinal','beforeOrdinal','requestCursor','seenIds'].includes(k)))return fail();if(expected.seenIds!==undefined)referenceList([...expected.seenIds],0,10000);const continuing=expected.requestCursor!==undefined&&expected.requestCursor!==null;if(continuing&&(expected.throughOrdinal===undefined||expected.beforeOrdinal===undefined||!expected.seenIds?.length)||!continuing&&expected.beforeOrdinal!==undefined)return fail();const accountId=identity(expected.accountId),limit=integer(expected.limit,1,50),o=own(v,['accountId','policy','throughOrdinal','coverage','records','nextCursor','hasMore']);if(o.accountId!==accountId||o.policy!==POLICY)return fail();
 const throughOrdinal=integer(o.throughOrdinal),c=own(o.coverage,['scope','fullMailbox']);if(c.scope!=='local-ingress-since-activation'||c.fullMailbox!==false)return fail();if(expected.throughOrdinal!==undefined&&throughOrdinal!==integer(expected.throughOrdinal))return fail();
 if(!Array.isArray(o.records)||o.records.length>limit)return fail();const records=o.records.map(r=>parseGeneration(r,accountId)),ids=new Set<string>(expected.seenIds??[]);let prior=expected.beforeOrdinal===undefined?Infinity:integer(expected.beforeOrdinal,1);
 for(const r of records){if(r.ordinal>throughOrdinal||r.ordinal>=prior||ids.has(r.id))return fail();ids.add(r.id);prior=r.ordinal}
 const hasMore=boolean(o.hasMore),nextCursor=o.nextCursor===null?null:cursor(o.nextCursor);if(hasMore?(nextCursor===null||records.length!==limit):(nextCursor!==null))return fail();
 if(throughOrdinal===0?(records.length!==0||hasMore):records.length===0)return fail();if(expected.requestCursor!==undefined&&expected.requestCursor!==null&&nextCursor===cursor(expected.requestCursor))return fail();
 return{accountId,policy:POLICY,throughOrdinal,coverage:{scope:'local-ingress-since-activation',fullMailbox:false},records,nextCursor,hasMore};
}
export function parseSourceResolution(v:unknown,context:{accountId:string;sourceRef:Ref;expectedInputVersion:Hash}):SourceResolution{const expected=copy(context);identity(expected.accountId);reference(expected.sourceRef);fingerprint(expected.expectedInputVersion);const next=copy(v);assertSourceResolution(next,expected);return next;}
export function parseTargetResolution(v:unknown,context:{accountId:string;targetRef:Ref;expectedTargetVersion:Hash}):TargetResolution{
 const expected=copy(context),o=own(v,['accountId','targetRef','expectedTargetVersion','currentTargetVersion','availability','target']);if(identity(o.accountId)!==identity(expected.accountId)||reference(o.targetRef)!==reference(expected.targetRef)||fingerprint(o.expectedTargetVersion)!==fingerprint(expected.expectedTargetVersion))return fail();
 const base={accountId:expected.accountId,targetRef:expected.targetRef,expectedTargetVersion:expected.expectedTargetVersion};
 if(o.availability==='available'){if(fingerprint(o.currentTargetVersion)!==expected.expectedTargetVersion)return fail();const t=own(o.target,['kind','draftId']);if(t.kind!=='draft')return fail();return{...base,availability:'available',currentTargetVersion:expected.expectedTargetVersion,target:{kind:'draft',draftId:identity(t.draftId)}}}
 if(o.availability==='changed'){const currentTargetVersion=fingerprint(o.currentTargetVersion);if(currentTargetVersion===expected.expectedTargetVersion||o.target!==null)return fail();return{...base,availability:'changed',currentTargetVersion,target:null}}
 const availability=enumValue(o.availability,['deleted','unavailable']);if(o.currentTargetVersion!==null||o.target!==null)return fail();return{...base,availability,currentTargetVersion:null,target:null};
}
export function parseThreadPublication(v:unknown,context:{accountId:string;threadId:string}):ThreadPublicationResponse{
 // Capture response and expected Mail scope before any caller-owned async work.
 const expected=copy(context),o=own(copy(v),['accountId','threadId','availability','publication']),accountId=identity(expected.accountId),threadId=identity(expected.threadId);
 if(identity(o.accountId)!==accountId||identity(o.threadId)!==threadId)return fail();
 if(o.availability==='unavailable'){if(o.publication!==null)return fail();return{accountId,threadId,availability:'unavailable',publication:null}}
 if(o.availability!=='available')return fail();
 const keys=['bindingVersion','generationId','sourceRef','inputVersion','sourceMessageId','targetRef','targetVersion','publishedAt','contentHash'];
 const p=own(o.publication,object(o.publication)&&Object.hasOwn(o.publication,'quotedBody')?[...keys,'quotedBody']:keys);let quotedBody:{quoteStartUtf8:number}|undefined;
 if(Object.hasOwn(p,'quotedBody')){const q=own(p.quotedBody,['quoteStartUtf8']);if(!safe(q.quoteStartUtf8)||Number(q.quoteStartUtf8)<3||Number(q.quoteStartUtf8)>AUTO_DRAFT_REPLY_OUTPUT_BYTES)return fail();quotedBody={quoteStartUtf8:Number(q.quoteStartUtf8)}}
 return{accountId,threadId,availability:'available',publication:{bindingVersion:fingerprint(p.bindingVersion),generationId:reference(p.generationId),sourceRef:reference(p.sourceRef),inputVersion:fingerprint(p.inputVersion),sourceMessageId:identity(p.sourceMessageId),targetRef:reference(p.targetRef),targetVersion:fingerprint(p.targetVersion),publishedAt:timestamp(p.publishedAt),contentHash:fingerprint(p.contentHash),...(quotedBody?{quotedBody}:{})}};
}
const errorCodes:readonly ErrorCode[]=['auto_draft_generation_invalid_request','auto_draft_generation_not_found','auto_draft_generation_revision_conflict','auto_draft_generation_request_conflict','auto_draft_generation_basis_conflict','auto_draft_generation_unavailable','auto_draft_generation_ingress_not_ready','auto_draft_generation_responses_disabled','auto_draft_generation_target_changed','auto_draft_generation_corrupt','auto_draft_generation_stopping'];
export function parseGenerationError(v:unknown):ErrorResponse{const o=own(v,['error']),e=own(o.error,['code','message']);const message=boundedText(e.message,4000,false);if(message.length>1000)return fail();return{error:{code:enumValue(e.code,errorCodes),message}}}
export function definiteDiagnosticRefusal(v:unknown,status:number,context:{phase:'mutation-response'|'read-response';acceptedProof:boolean}):boolean{
 const error=parseGenerationError(v),c=own(context,['phase','acceptedProof']);enumValue(c.phase,['mutation-response','read-response']);boolean(c.acceptedProof);integer(status,100,599);if(context.phase!=='mutation-response'||context.acceptedProof)return false;
 return status===400&&error.error.code==='auto_draft_generation_invalid_request'||status===404&&error.error.code==='auto_draft_generation_not_found'||status===409&&['auto_draft_generation_revision_conflict','auto_draft_generation_request_conflict','auto_draft_generation_basis_conflict','auto_draft_generation_ingress_not_ready','auto_draft_generation_responses_disabled','auto_draft_generation_target_changed'].includes(error.error.code);
}
export function parseModelDecision(v:unknown,context:{allowedSourceRefs:readonly Ref[]}):ModelDecision{
 const allowed=referenceList([...context.allowedSourceRefs],1,LIMITS.contextMessages),raw=copy(v);if(!object(raw))return fail();const kind=enumValue(raw.kind,['draft','no-draft','insufficient-context']),o=own(raw,kind==='draft'?['kind','plainText','sourceRefs']:['kind','reason','sourceRefs']),sourceRefs=referenceList(o.sourceRefs,1,LIMITS.contextMessages);if(sourceRefs.some(r=>!allowed.includes(r)))return fail();
 let result:ModelDecision;if(kind==='draft'){const plainText=boundedText(o.plainText,LIMITS.outputBytes,false);if(!plainText.trim())return fail();result={kind,plainText,sourceRefs}}else if(kind==='no-draft')result={kind,reason:enumValue(o.reason,['reply-not-needed','already-addressed']),sourceRefs};else result={kind,reason:enumValue(o.reason,['truncated-or-missing-facts']),sourceRefs};
 if(byteLength(result)>LIMITS.outputBytes)return fail();return result;
}
export function parseDiagnosticRequest(v:unknown):DiagnosticEngineControlRequest{
 if(!object(v))return fail();const action=enumValue(v.action,['activate','deactivate']),o=own(v,action==='activate'?['accountId','clientRequestId','expectedEngineRevision','action','expectedPreferences','expectedAccountVersion','expectedConfigurationVersion','attemptLimit']:['accountId','clientRequestId','expectedEngineRevision','action','expectedActivationId']),base={accountId:identity(o.accountId),clientRequestId:requestKey(o.clientRequestId),expectedEngineRevision:integer(o.expectedEngineRevision)};
 return action==='activate'?{...base,action,expectedPreferences:preferencesBasis(o.expectedPreferences),expectedAccountVersion:fingerprint(o.expectedAccountVersion),expectedConfigurationVersion:nullableHash(o.expectedConfigurationVersion),attemptLimit:integer(o.attemptLimit,1)}:{...base,action,expectedActivationId:o.expectedActivationId===null?null:reference(o.expectedActivationId)};
}
export function diagnosticIntentText(v:DiagnosticEngineControlRequest):string{const{clientRequestId,...request}=parseDiagnosticRequest(v);return stable({protocol:CONTROL_PROTOCOL,request})}
export async function parseDiagnosticResponse(v:unknown,expected:DiagnosticEngineControlRequest,reviewed:EngineStatus,digest:Digest,known?:DiagnosticEngineControlResponse):Promise<DiagnosticEngineControlResponse>{
 // Snapshot all three parties before any injected hash can yield/mutate caller data.
 const want=parseDiagnosticRequest(expected),priorRaw=copy(reviewed),knownRaw=known===undefined?undefined:copy(known),raw=copy(v),o=own(raw,['receipt','acceptedEngine','historical']),r=own(o.receipt,['id','accountId','clientRequestId','protocol','request','requestFingerprint','priorRevision','acceptedRevision','changed','acceptedAt','snapshotFingerprint']),request=parseDiagnosticRequest(r.request),acceptedEngine=parseEngineSnapshot(o.acceptedEngine,want.accountId),historical=boolean(o.historical);
 const receipt:DiagnosticEngineControlReceipt={id:reference(r.id),accountId:identity(r.accountId),clientRequestId:requestKey(r.clientRequestId),protocol:r.protocol===CONTROL_PROTOCOL?CONTROL_PROTOCOL:fail(),request,requestFingerprint:fingerprint(r.requestFingerprint),priorRevision:integer(r.priorRevision),acceptedRevision:integer(r.acceptedRevision),changed:boolean(r.changed),acceptedAt:timestamp(r.acceptedAt),snapshotFingerprint:fingerprint(r.snapshotFingerprint)};
 const prior=await parseEngineStatus(priorRaw,want.accountId,digest);
 if(!equivalent(request,want)||receipt.accountId!==want.accountId||receipt.clientRequestId!==want.clientRequestId||receipt.priorRevision!==want.expectedEngineRevision||prior.engine.revision!==want.expectedEngineRevision||receipt.acceptedRevision!==receipt.priorRevision+(receipt.changed?1:0)||acceptedEngine.revision!==receipt.acceptedRevision||prior.engine.updatedAt&&!laterOrEqual(receipt.acceptedAt,prior.engine.updatedAt)||receipt.changed&&acceptedEngine.updatedAt!==receipt.acceptedAt)return fail();
 if(want.action==='activate'){
  const p=prior.preferences,a=acceptedEngine.activation,old=prior.engine.activation;
  if(!p.persisted||!p.value.responsesEnabled||want.expectedPreferences.settingsId!==p.settingsId||want.expectedPreferences.revision!==p.revision||want.expectedPreferences.fingerprint!==fingerprint(await digest(stable(p)))||want.expectedAccountVersion!==prior.readiness.accountVersion||want.expectedConfigurationVersion!==prior.readiness.configurationVersion||!receipt.changed||a===null||a.id===old?.id||a.epoch!==(old?.epoch??0)+1||!equivalent(a.preferences,want.expectedPreferences)||a.accountVersion!==want.expectedAccountVersion||a.configurationVersion!==want.expectedConfigurationVersion||a.attemptLimit!==want.attemptLimit||a.createdAt!==receipt.acceptedAt||!['pending','active'].includes(a.status)||a.status==='active'&&(a.readyAt!==receipt.acceptedAt||a.barrier.internalDateAfter!==receipt.acceptedAt))return fail();
 }else{
  const old=prior.engine.activation,changes=!!old&&['pending','active'].includes(old.status);if(want.expectedActivationId!==(old?.id??null)||receipt.changed!==changes)return fail();
  if(changes){if(!equivalent(acceptedEngine.activation,{...old,status:'stopped',endedAt:receipt.acceptedAt,reason:'explicit-stop'}))return fail()}else if(!equivalent(acceptedEngine,prior.engine))return fail();
 }
 if(!receipt.changed&&!equivalent(acceptedEngine,prior.engine)||fingerprint(await digest(diagnosticIntentText(want)))!==receipt.requestFingerprint||fingerprint(await digest(stable(acceptedEngine)))!==receipt.snapshotFingerprint)return fail();
 if(knownRaw){const accepted=await parseDiagnosticResponse(knownRaw,want,priorRaw,digest);if(!equivalent(accepted.receipt,receipt)||!equivalent(accepted.acceptedEngine,acceptedEngine))return fail()}
 return{receipt,acceptedEngine,historical};
}
export function parseIngressVersion(v:unknown,context:{accountId:string;accountVersion:Hash}):IngressVersion{
 const expected=copy(context),o=own(v,['version','id','accountId','accountVersion','sequence','sourceRef','inputVersion','providerInternalDate','committedAt','origin','history','baselineVersion','immutableFactsHash']);if(o.version!==1||identity(o.accountId)!==identity(expected.accountId)||fingerprint(o.accountVersion)!==fingerprint(expected.accountVersion))return fail();
 const sourceRef=reference(o.sourceRef),origin=enumValue(o.origin,['google-live-history-message-added','initial-import','catchup-import','repair-import']);let history:IngressVersion['history']=null;
 if(o.history!==null){const h=own(o.history,['entryId','afterCursor','throughCursor','addedSourceRefs']);history={entryId:decimalCounter(h.entryId),afterCursor:decimalCounter(h.afterCursor),throughCursor:decimalCounter(h.throughCursor),addedSourceRefs:referenceList(h.addedSourceRefs,1,1000)};if(compareCounters(history.entryId,history.afterCursor)<=0||compareCounters(history.entryId,history.throughCursor)>0)return fail()}
 if(origin==='google-live-history-message-added'&&(history===null||!history.addedSourceRefs.includes(sourceRef)))return fail();
 return{version:1,id:reference(o.id),accountId:expected.accountId,accountVersion:expected.accountVersion,sequence:integer(o.sequence,1),sourceRef,inputVersion:fingerprint(o.inputVersion),providerInternalDate:timestamp(o.providerInternalDate),committedAt:timestamp(o.committedAt),origin,history,baselineVersion:fingerprint(o.baselineVersion),immutableFactsHash:fingerprint(o.immutableFactsHash)};
}
export function parseNoTargetBasis(v:unknown):NoTargetBasis{const o=own(v,['kind','threadRef','threadInputVersion','threadDraftSetVersion','replyMetadataVersion','sourceFactsVersion']);if(o.kind!=='create')return fail();return{kind:'create',threadRef:reference(o.threadRef),threadInputVersion:fingerprint(o.threadInputVersion),threadDraftSetVersion:integer(o.threadDraftSetVersion),replyMetadataVersion:fingerprint(o.replyMetadataVersion),sourceFactsVersion:fingerprint(o.sourceFactsVersion)}}
type PersonalizationBinding=FrozenInput['context']['personalization'];
function personalizationBinding(v:unknown):PersonalizationBinding{const o=own(v,['enabled','revision','fingerprint','text']);const enabled=boolean(o.enabled),text=boundedText(o.text,24576);if(!enabled&&text!=='')return fail();return{enabled,revision:integer(o.revision),fingerprint:fingerprint(o.fingerprint),text}}
export type FrozenInputContext={generation:Generation;activation:Activation;preferences:PreferencesSnapshot;target:NoTargetBasis;personalization:PersonalizationBinding;contextFingerprint:Hash;replyPlanFingerprint:Hash;requestFingerprint:Hash;requestBytes:number};
export function frozenContextText(v:Pick<FrozenInput,'accountId'|'sourceRef'|'inputVersion'|'context'>):string{return stable({protocol:'auto-draft-model-context-v2',accountId:identity(v.accountId),sourceRef:reference(v.sourceRef),inputVersion:fingerprint(v.inputVersion),context:copy(v.context)})}
export async function parseFrozenInput(v:unknown,expected:FrozenInputContext,digest:Digest):Promise<FrozenInput>{
 const want=copy(expected),contextCommitment=fingerprint(want.contextFingerprint),replyCommitment=fingerprint(want.replyPlanFingerprint),requestCommitment=fingerprint(want.requestFingerprint),requestBytes=integer(want.requestBytes,1,LIMITS.serializedRequestBytes),job=parseGeneration(want.generation,want.generation.accountId),activation=parseActivation(want.activation),prefs=parseSnapshot(want.preferences),target=parseNoTargetBasis(want.target),personalization=personalizationBinding(want.personalization),o=own(copy(v),['version','generationId','accountId','activationId','activationEpoch','preferences','accountVersion','configurationVersion','sourceRef','inputVersion','target','context','replyPlanFingerprint','requestFingerprint','requestBytes']);
 if(job.state!=='claimed'||activation.status!=='active'||prefs.section!=='preferences'||!prefs.persisted||!prefs.value.responsesEnabled)return fail();
 const c=own(o.context,['messages','omittedMessageCount','personalization']);if(!Array.isArray(c.messages)||c.messages.length<1||c.messages.length>LIMITS.contextMessages)return fail();
 const messages=c.messages.map(v=>{const m=own(v,['ref','role','participantLabel','date','text']);return{ref:reference(m.ref),role:enumValue(m.role,['incoming','outgoing']),participantLabel:boundedText(m.participantLabel,1024),date:timestamp(m.date),text:boundedText(m.text,LIMITS.serializedRequestBytes)}});
 const result:FrozenInput={version:o.version===1?1:fail(),generationId:reference(o.generationId),accountId:identity(o.accountId),activationId:reference(o.activationId),activationEpoch:integer(o.activationEpoch,1),preferences:preferencesBasis(o.preferences),accountVersion:fingerprint(o.accountVersion),configurationVersion:fingerprint(o.configurationVersion),sourceRef:reference(o.sourceRef),inputVersion:fingerprint(o.inputVersion),target:parseNoTargetBasis(o.target),context:{messages,omittedMessageCount:integer(c.omittedMessageCount),personalization:personalizationBinding(c.personalization)},replyPlanFingerprint:fingerprint(o.replyPlanFingerprint),requestFingerprint:fingerprint(o.requestFingerprint),requestBytes:integer(o.requestBytes,1,LIMITS.serializedRequestBytes)};
 if(result.generationId!==job.id||result.accountId!==job.accountId||prefs.accountId!==job.accountId||result.activationId!==job.activationId||result.activationEpoch!==job.activationEpoch||result.sourceRef!==job.sourceRef||result.inputVersion!==job.inputVersion||activation.id!==job.activationId||activation.epoch!==job.activationEpoch||result.accountVersion!==activation.accountVersion||result.configurationVersion!==activation.configurationVersion||!equivalent(result.preferences,activation.preferences)||!equivalent(result.target,target)||!equivalent(result.context.personalization,personalization)||new Set(messages.map(m=>m.ref)).size!==messages.length||!messages.some(m=>m.ref===result.sourceRef&&m.role==='incoming')||byteLength(result.context)>LIMITS.serializedRequestBytes||result.preferences.settingsId!==prefs.settingsId||result.preferences.revision!==prefs.revision)return fail();
 // Personalization fingerprint binds the existing service's full snapshot hash;
 // it is not recomputed from potentially truncated supplied text. Exact reviewed
 // binding above is mandatory; the outgoing request has its own byte/hash proof.
 if(result.replyPlanFingerprint!==replyCommitment||result.requestFingerprint!==requestCommitment||result.requestBytes!==requestBytes||contextCommitment!==fingerprint(await digest(frozenContextText(result)))||result.preferences.fingerprint!==fingerprint(await digest(stable(prefs))))return fail();return result;
}
export type DispatchContext={input:FrozenInput;leaseId:Ref;ownerEpoch:Ref;attemptRef:Ref;leaseUntil:Iso};
export async function parseFrozenDispatch(v:unknown,expected:DispatchContext,digest:Digest):Promise<FrozenDispatch>{
 const want=copy(expected),o=own(copy(v),['generationId','leaseId','ownerEpoch','attemptRef','configurationVersion','requestFingerprint','requestUtf8','leaseUntil']),result:FrozenDispatch={generationId:reference(o.generationId),leaseId:reference(o.leaseId),ownerEpoch:reference(o.ownerEpoch),attemptRef:reference(o.attemptRef),configurationVersion:fingerprint(o.configurationVersion),requestFingerprint:fingerprint(o.requestFingerprint),requestUtf8:boundedText(o.requestUtf8,LIMITS.serializedRequestBytes,false),leaseUntil:timestamp(o.leaseUntil)};
 if(result.generationId!==reference(want.input.generationId)||result.leaseId!==reference(want.leaseId)||result.ownerEpoch!==reference(want.ownerEpoch)||result.attemptRef!==reference(want.attemptRef)||result.configurationVersion!==fingerprint(want.input.configurationVersion)||result.requestFingerprint!==fingerprint(want.input.requestFingerprint)||result.leaseUntil!==timestamp(want.leaseUntil)||new TextEncoder().encode(result.requestUtf8).length!==integer(want.input.requestBytes,1,LIMITS.serializedRequestBytes))return fail();
 try{const body=JSON.parse(result.requestUtf8);if(!object(body)||typeof body.model!=='string'||!body.model||new TextEncoder().encode(body.model).length>256||/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(body.model)||['tools','tool_choice','functions','function_call'].some(k=>Object.hasOwn(body,k))||body.stream!==undefined&&body.stream!==false||body.store!==undefined&&body.store!==false)return fail();const anthropic=Object.hasOwn(body,'max_tokens'),openai=Object.hasOwn(body,'max_output_tokens');if(anthropic===openai)return fail();integer(body[anthropic?'max_tokens':'max_output_tokens'],1,LIMITS.outputTokens);if(openai&&body.store!==false)return fail()}catch{return fail()}
 if(result.requestFingerprint!==fingerprint(await digest(result.requestUtf8)))return fail();return result;
}

export function parseGenerationById(v:unknown,context:{accountId:string;generationId:Ref},previous?:Generation):Generation{const expected=own(copy(context),['accountId','generationId']),next=parseGeneration(v,identity(expected.accountId),previous);if(next.id!==reference(expected.generationId))return fail();return next;}
export function parsePreferenceSaveRequest(v:unknown):PreferenceSave{const r=parseV1Request(v);if(r.section!=='preferences')throw new ContractError();return r;}
export async function parsePreferenceSaveResponse(v:unknown,expected:PreferenceSave,reviewed:PreferencesSnapshot,digest:Digest):Promise<SaveResponse>{return parseV1Response(v,parsePreferenceSaveRequest(expected),reviewed,digest);}
