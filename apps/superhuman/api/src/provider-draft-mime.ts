import { createHash } from 'node:crypto';
import PostalMime, { type Address, type Email } from 'postal-mime';
import type { Store } from './store.ts';
import type { Account, Draft, Message } from './types.ts';
import { HttpError } from './types.ts';
import { buildMime } from './mime.ts';

export const PROVIDER_DRAFT_MAX_RAW_BYTES = 38 * 1024 * 1024;
export const providerDraftHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type ProviderDraftMarker = { owner: string; operationId: string; revision: number; contentHash: string };
export type ProviderDraftMimeSnapshot = { raw: Buffer; rawHash: string; decodedHash: string; contentHash: string; marker: ProviderDraftMarker; threadId?: string };
const markerNames = ['x-reconstruction-draft-owner', 'x-reconstruction-draft-operation', 'x-reconstruction-draft-revision', 'x-reconstruction-draft-content-sha256'] as const;
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validMarker = (marker: ProviderDraftMarker) => /^[A-Za-z0-9_-]{32}$/.test(marker.owner) && /^[A-Za-z0-9_-]{1,128}$/.test(marker.operationId) && Number.isSafeInteger(marker.revision) && marker.revision >= 1 && sha(marker.contentHash);
export function assertProviderDraftUnicode(draft: Draft) { if ([draft.to,draft.cc,draft.bcc,draft.subject,draft.body,draft.html??'',...(draft.attachments??[]).map(value=>value.name)].some(value=>/\p{Surrogate}/u.test(value))) throw new HttpError(400,'Cloud MIME requires valid Unicode; local authored content is retained','provider_draft_invalid_unicode'); }
function invalid(): never { throw new HttpError(502, 'The provider draft MIME could not be verified', 'provider_draft_invalid_mime'); }
function bounded(raw: Uint8Array) { if (!raw.length || raw.length > PROVIDER_DRAFT_MAX_RAW_BYTES) throw new HttpError(413, 'The cloud draft snapshot exceeds its MIME budget. Local content is retained.', 'provider_draft_snapshot_limit'); }
function mailbox(address: Address | undefined) {
  if (!address || 'group' in address || !address.address) return invalid();
  return { name: address.name ?? '', email: address.address.toLowerCase() };
}
function recipients(addresses: Address[] | undefined) { return (addresses ?? []).map(address => mailbox(address)); }
function attachmentBytes(value: ArrayBuffer | Uint8Array | string): Uint8Array { if (typeof value === 'string') return invalid(); return value instanceof Uint8Array ? value : new Uint8Array(value); }
function normalizedBody(value: string | undefined) { return value === undefined ? null : value.replace(/\r\n/g, '\n'); }
export async function decodeProviderDraftMime(raw: Uint8Array): Promise<{ decodedHash: string; marker: ProviderDraftMarker | null; sender: string }> {
  bounded(raw);
  let email: Email;
  try { email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer', forceRfc822Attachments: true, maxNestingDepth: 12, maxPartCount: 64, maxHeadersSize: 65536, maxRfc822NestingDepth: 0, maxForwardedAddresses: 100 }); }
  catch { return invalid(); }
  for (const name of ['from', 'to', 'cc', 'bcc', 'subject', 'in-reply-to', 'references', ...markerNames]) if (email.headers.filter(header => header.key === name).length > 1) invalid();
  const header = (name: string) => email.headers.find(header => header.key === name)?.value;
  const owner = header(markerNames[0]), operationId = header(markerNames[1]), revisionRaw = header(markerNames[2]), contentHash = header(markerNames[3]);
  const marker: ProviderDraftMarker | null = owner && operationId && revisionRaw && /^(?:[1-9]\d*)$/.test(revisionRaw) && contentHash ? { owner, operationId, revision: Number(revisionRaw), contentHash } : null;
  if (marker && !validMarker(marker) || !marker && markerNames.some(name => header(name) !== undefined)) invalid();
  const from = mailbox(email.from), attachments = email.attachments.map(attachment => {
    const bytes = attachmentBytes(attachment.content);
    return { name: attachment.filename ?? null, mimeType: attachment.mimeType.toLowerCase(), disposition: attachment.disposition, contentId: attachment.contentId ?? null, size: bytes.byteLength, sha256: hashBytes(bytes) };
  });
  if (attachments.length > 20 || attachments.reduce((total, value) => total + value.size, 0) > 25 * 1024 * 1024) invalid();
  const headerWhitespace = (value: string | undefined) => value?.replace(/[\t\r\n ]+/g, ' ').trim() ?? null;
  // Decode transfer encodings/encoded words and normalize only CRLF transport
  // line endings. Preserve content whitespace, HTML and attachment bytes. The
  // parser runs on BOTH saved and provider MIME; no body trim or HTML rewrite.
  const decodedHash = providerDraftHash({ from, to: recipients(email.to), cc: recipients(email.cc), bcc: recipients(email.bcc), subject: email.subject ?? '', inReplyTo: headerWhitespace(email.inReplyTo), references: headerWhitespace(email.references), text: normalizedBody(email.text), html: normalizedBody(email.html), attachments });
  return { decodedHash, marker, sender: from.email };
}
export function providerDraftInputIdentity(store: Store, draft: Draft, account: Account, previous?: Pick<Message, 'internetMessageId' | 'references'>, providerThreadId?: string) {
  if (draft.accountId !== account.id || account.provider !== 'google') throw new HttpError(409, 'The cloud draft account changed', 'provider_draft_scope_changed');
  const attachments = (draft.attachments ?? []).map(metadata => {
    const row = store.db.prepare('SELECT name,mime_type,size,data FROM draft_attachments WHERE draft_id=? AND id=?').get(draft.id, metadata.id);
    if (!row || row.name !== metadata.name || row.mime_type !== metadata.mimeType || Number(row.size) !== metadata.size) throw new HttpError(409, 'Attachment metadata changed', 'provider_draft_attachment_unavailable');
    const bytes = Buffer.from(row.data as Uint8Array);
    if (bytes.byteLength !== metadata.size) throw new HttpError(409, 'Attachment content changed', 'provider_draft_attachment_unavailable');
    return { metadata: structuredClone(metadata), bytes, sha256: hashBytes(bytes) };
  });
  const contentHash = providerDraftHash({ accountId: account.id, sender: account.email.toLowerCase(), to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body, html: draft.html ?? null, threadId: draft.threadId ?? null, previous: previous && (previous.internetMessageId || previous.references) ? { internetMessageId: previous.internetMessageId ?? null, references: previous.references ?? null } : null, providerThreadId: providerThreadId ?? null, attachments: attachments.map(value => ({ id: value.metadata.id, name: value.metadata.name, mimeType: value.metadata.mimeType, size: value.metadata.size, sha256: value.sha256 })) });
  return { contentHash, attachments };
}
export async function createProviderDraftMime(store: Store, draft: Draft, account: Account, markerIdentity: Omit<ProviderDraftMarker, 'contentHash'>, previous?: Pick<Message, 'internetMessageId' | 'references'>, providerThreadId?: string): Promise<ProviderDraftMimeSnapshot> {
  assertProviderDraftUnicode(draft);
  if (markerIdentity.revision !== draft.revision) throw new HttpError(409, 'The cloud draft revision changed', 'provider_draft_revision_conflict');
  const { contentHash, attachments } = providerDraftInputIdentity(store, draft, account, previous, providerThreadId);
  const marker = { ...markerIdentity, contentHash }; if (!validMarker(marker)) invalid();
  const authored: Draft = { ...draft, deliveryMessageId: undefined, deliveryMarker: undefined };
  const mime = buildMime(authored, account, previous, attachments.map(({ metadata, bytes }) => ({ metadata, bytes })));
  const headers = [`X-Reconstruction-Draft-Owner: ${marker.owner}`, `X-Reconstruction-Draft-Operation: ${marker.operationId}`, `X-Reconstruction-Draft-Revision: ${marker.revision}`, `X-Reconstruction-Draft-Content-SHA256: ${contentHash}`];
  const raw = Buffer.from(headers.join('\r\n') + '\r\n' + mime); bounded(raw);
  const decoded = await decodeProviderDraftMime(raw);
  if (!decoded.marker || providerDraftHash(decoded.marker) !== providerDraftHash(marker) || decoded.sender !== account.email.toLowerCase()) invalid();
  return { raw, rawHash: hashBytes(raw), decodedHash: decoded.decodedHash, contentHash, marker, ...(providerThreadId ? { threadId: providerThreadId } : {}) };
}
export async function equivalentProviderDraftMime(snapshot: Pick<ProviderDraftMimeSnapshot, 'decodedHash' | 'marker'>, raw: Uint8Array, senderEmail: string): Promise<boolean> {
  try { const decoded = await decodeProviderDraftMime(raw); return !!decoded.marker && providerDraftHash(decoded.marker) === providerDraftHash(snapshot.marker) && decoded.sender === senderEmail.toLowerCase() && decoded.decodedHash === snapshot.decodedHash; }
  catch { return false; }
}
