/** Server-only generated publication policy. No browser DTO or transport. */
import {createHash} from 'node:crypto';
import {stable} from './auto-drafts-contract.ts';
import type {Draft} from './types.ts';
export const GENERATED_AUTHORED_POLICY='generated-authoring-v1' as const;
export type GeneratedPublicationScope={accountId:string;threadId:string;generationId:string;accountVersion:string;leaseId:string;attemptRef:string};
export const generatedHash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
export function generatedAuthoredHash(draft:Draft){const {providerDraftId:_id,providerDraftSyncedAt:_at,...authored}=draft;return generatedHash(authored)}
export function generatedScopeValid(v:GeneratedPublicationScope):boolean{return !!v&&Object.keys(v).sort().join(',')==='accountId,accountVersion,attemptRef,generationId,leaseId,threadId'&&Object.entries(v).every(([k,x])=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=1024&&!/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(x)&&(k!=='accountVersion'||/^[a-f0-9]{64}$/.test(x)))}
export type ProviderDraftMetadataRequest={accountId:string;draftId:string;operationId:string;expectedLinkRevision:number;expectedCurrentRecordFingerprint:string;patch:{providerDraftId:string;providerDraftSyncedAt:string}};
export type ProviderAckWriteContext={lane:'provider-ack-v1';accountId:string;draftId:string;operationId:string;linkRevision:number;currentRecordFingerprint:string};
export type DraftWriteContext={lane:'authored'}|ProviderAckWriteContext;
export type ProviderMetadataVerifier=(request:ProviderDraftMetadataRequest,before:Readonly<Draft>)=>void;
export type ProviderMetadataWriter={write:(request:ProviderDraftMetadataRequest)=>{applied:true;draft:Draft}|{applied:false;reason:'not-editable'|'local-cas-miss'};close:()=>void};
export type GeneratedMetadataPolicyVerifier=(context:ProviderAckWriteContext,before:Readonly<Draft>,next:Readonly<Draft>)=>boolean;
