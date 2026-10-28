import { randomUUID } from 'node:crypto';
import { hash } from './ai-chat-store.ts';
import { knowledgeFilename, knowledgeField, KNOWLEDGE_MAX_FILE_BYTES, KNOWLEDGE_MAX_TEXT_BYTES } from './knowledge-input.ts';
import { normalizeKnowledgeUrl } from './knowledge-url.ts';
import { HttpError } from './types.ts';
import type { KnowledgeActionReceipt, KnowledgeActionRequest, KnowledgeSource } from './knowledge-types.ts';

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
const timestamp = (value: unknown): value is string => typeof value === 'string' && new Date(value).toISOString() === value;
function corrupt(): never { throw new HttpError(500, 'The saved Knowledge action could not be verified', 'knowledge_action_corrupt'); }

/** Exact v1 field ordering is retained from the pre-receipt request ledger. */
export function knowledgeActionFingerprint(request: KnowledgeActionRequest): string {
  if (request.kind === 'file') return hash({ kind: 'file', name: request.name, sha256: request.sha256 });
  if (request.kind === 'link') return hash({ kind: 'link', url: request.url });
  return hash({ kind: 'retry', id: request.sourceId, expectedRevision: request.expectedRevision });
}

export function acceptedKnowledgeAction(accountId: string, key: string, source: KnowledgeSource, request: KnowledgeActionRequest): KnowledgeActionReceipt {
  return { version: 1, id: randomUUID(), accountId, clientRequestId: key, sourceId: source.id,
    fingerprintProtocol: 'knowledge-request-json-sha256-v1', fingerprint: knowledgeActionFingerprint(request),
    provenance: 'accepted', acceptedAt: source.updatedAt, acceptedContentVersion: source.contentVersion, request: structuredClone(request) };
}

export function legacyKnowledgeAction(accountId: string, key: string, sourceId: string, fingerprint: string): KnowledgeActionReceipt {
  if (!id(key) || !id(sourceId) || !sha(fingerprint)) corrupt();
  return { version: 1, id: 'legacy_' + hash({ accountId, key, sourceId, fingerprint }), accountId, clientRequestId: key, sourceId,
    fingerprintProtocol: 'knowledge-request-json-sha256-v1', fingerprint, provenance: 'legacy-reference',
    acceptedAt: null, acceptedContentVersion: null, request: null };
}

/** A corrupt new receipt must never fall back to an invented legacy acceptance. */
export function readKnowledgeAction(raw: unknown, expected: { accountId: string; key: string; sourceId: string; fingerprint: string }): KnowledgeActionReceipt {
  try {
    if (!object(raw) || !fields(raw, ['version', 'id', 'accountId', 'clientRequestId', 'sourceId', 'fingerprintProtocol', 'fingerprint', 'provenance', 'acceptedAt', 'acceptedContentVersion', 'request']) || raw.version !== 1 || !id(raw.id) || raw.accountId !== expected.accountId || raw.clientRequestId !== expected.key || raw.sourceId !== expected.sourceId || raw.fingerprint !== expected.fingerprint || !id(raw.clientRequestId) || !id(raw.sourceId) || !sha(raw.fingerprint) || raw.fingerprintProtocol !== 'knowledge-request-json-sha256-v1') corrupt();
    if (raw.provenance === 'legacy-reference') {
      if (raw.acceptedAt !== null || raw.acceptedContentVersion !== null || raw.request !== null || raw.id !== legacyKnowledgeAction(expected.accountId, expected.key, expected.sourceId, expected.fingerprint).id) corrupt();
    } else if (raw.provenance === 'accepted') {
      if (!timestamp(raw.acceptedAt) || !id(raw.acceptedContentVersion) || !object(raw.request)) corrupt();
      const request = raw.request;
      if (request.kind === 'file') {
        if (!fields(request, ['kind', 'name', 'sha256', 'bytes']) || !sha(request.sha256) || !Number.isSafeInteger(request.bytes) || Number(request.bytes) < 1 || Number(request.bytes) > KNOWLEDGE_MAX_FILE_BYTES) corrupt();
        knowledgeFilename(request.name);
      } else if (request.kind === 'link') {
        if (!fields(request, ['kind', 'url']) || typeof request.url !== 'string' || normalizeKnowledgeUrl(request.url) !== request.url) corrupt();
      } else if (request.kind === 'retry') {
        if (!fields(request, ['kind', 'sourceId', 'expectedRevision']) || request.sourceId !== raw.sourceId || !Number.isSafeInteger(request.expectedRevision) || Number(request.expectedRevision) < 1) corrupt();
      } else corrupt();
      if (knowledgeActionFingerprint(request as KnowledgeActionRequest) !== raw.fingerprint) corrupt();
    } else corrupt();
    return structuredClone(raw) as KnowledgeActionReceipt;
  } catch { return corrupt(); }
}

/** Current metadata is not the historical acceptance payload. Invalid current
 * metadata resolves unavailable while its independent receipt stays verifiable.
 */
export function validCurrentKnowledgeSource(value: unknown, expected: { accountId: string; id: string; kind: unknown; status: unknown; revision: unknown; contentVersion: unknown }): value is KnowledgeSource {
  try {
    if (!object(value) || value.accountId !== expected.accountId || value.id !== expected.id || !id(value.id) || value.kind !== expected.kind || !['file', 'link'].includes(String(value.kind)) || value.status !== expected.status || !['pending', 'processing', 'ready', 'error'].includes(String(value.status)) || value.visibility !== 'private' || value.revision !== expected.revision || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || value.contentVersion !== expected.contentVersion || !id(value.contentVersion) || !sha(value.contentHash) || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !(value.indexedAt === null || timestamp(value.indexedAt)) || typeof value.truncated !== 'boolean' || !Number.isSafeInteger(value.chunkCount) || Number(value.chunkCount) < 0 || !Number.isSafeInteger(value.extractedBytes) || Number(value.extractedBytes) < 0 || Number(value.extractedBytes) > KNOWLEDGE_MAX_TEXT_BYTES) return false;
    knowledgeField(value.name, 2048, false); knowledgeField(value.description, 20000);
    if (value.error !== null && (!object(value.error) || typeof value.error.message !== 'string' || value.error.message.length > 4096 || typeof value.error.code !== 'string' || typeof value.error.retry !== 'string' || !['explicit', 'none'].includes(value.error.retry))) return false;
    if (value.kind === 'file') {
      if (!object(value.file) || !sha(value.file.sha256) || value.file.sha256 !== value.contentHash || !Number.isSafeInteger(value.file.bytes) || Number(value.file.bytes) < 1 || Number(value.file.bytes) > KNOWLEDGE_MAX_FILE_BYTES) return false;
      const file = knowledgeFilename(value.file.name);
      if (value.file.extension !== file.extension || value.file.mediaType !== file.mediaType) return false;
    } else if (!object(value.link) || typeof value.link.url !== 'string' || typeof value.link.requestedUrl !== 'string' || value.link.scope !== 'single-page' || !(value.link.fetchedAt === null || timestamp(value.link.fetchedAt)) || normalizeKnowledgeUrl(value.link.url) !== value.link.url || normalizeKnowledgeUrl(value.link.requestedUrl) !== value.link.requestedUrl) return false;
    return true;
  } catch { return false; }
}
