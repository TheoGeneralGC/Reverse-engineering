import { randomBytes } from 'node:crypto';
import type { Account, Attachment, Draft, Message } from './types.ts';
import { HttpError } from './types.ts';
import { sanitizeDraftHtml } from './rich-text.ts';
import { parseOutgoingRecipientHeaders, formatOutgoingRecipientHeader } from './outgoing-recipients.ts';

export function buildMime(draft: Draft, account: Account, previous: Message | undefined, attachments: { metadata: Attachment; bytes: Buffer }[] = []) {
  if ([account.email, draft.to, draft.cc, draft.bcc, draft.subject].some(value => /[\r\n]/.test(value))) throw new HttpError(400, 'Email headers cannot contain line breaks');
  const recipients = parseOutgoingRecipientHeaders(draft, false);
  const folded = (bytes: Buffer) => bytes.toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const subject = `=?UTF-8?B?${Buffer.from(draft.subject).toString('base64')}?=`;
  const replyHeaders = previous?.internetMessageId ? [`In-Reply-To: ${previous.internetMessageId.replace(/[\r\n]/g, ' ')}`, `References: ${[previous.references, previous.internetMessageId].filter(Boolean).join(' ').replace(/[\r\n]/g, ' ')}`] : [];
  if (draft.deliveryMessageId && !/^<rea-[a-f\d-]+@reconstruction\.invalid>$/.test(draft.deliveryMessageId)) throw new HttpError(400, 'Invalid delivery Message-ID');
  if (draft.deliveryMarker !== undefined && !/^[A-Za-z0-9_-]{32}$/.test(draft.deliveryMarker)) throw new HttpError(400, 'Invalid delivery marker');
  const headers = [`From: ${account.email}`, `To: ${formatOutgoingRecipientHeader(recipients.to)}`, ...(recipients.cc.length ? [`Cc: ${formatOutgoingRecipientHeader(recipients.cc)}`] : []), ...(recipients.bcc.length ? [`Bcc: ${formatOutgoingRecipientHeader(recipients.bcc)}`] : []), `Subject: ${subject}`, ...(draft.deliveryMessageId ? [`Message-ID: ${draft.deliveryMessageId}`] : []), ...(draft.deliveryMarker ? [`X-Reconstruction-Delivery-ID: ${draft.deliveryMarker}`] : []), ...replyHeaders, 'MIME-Version: 1.0'];
  const text = `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${folded(Buffer.from(draft.body))}`;
  const html = draft.html === undefined ? '' : sanitizeDraftHtml(draft.html);
  const alternativeBoundary = `rea-alt--${randomBytes(18).toString('hex')}`;
  const content = html.trim() ? `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n--${alternativeBoundary}\r\n${text}\r\n--${alternativeBoundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${folded(Buffer.from(html))}\r\n--${alternativeBoundary}--\r\n` : text;
  if (!attachments.length) return `${headers.join('\r\n')}\r\n${content}`;
  const boundary = `rea--${randomBytes(18).toString('hex')}`;
  const segments = attachments.map(({ metadata, bytes }) => {
    if (!/^[a-z\d][a-z\d.+-]*\/[a-z\d][a-z\d.+-]*$/i.test(metadata.mimeType)) throw new HttpError(400, 'Invalid attachment MIME type');
    const filename = encodeURIComponent(metadata.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return `Content-Type: ${metadata.mimeType}\r\nContent-Disposition: attachment; filename*=UTF-8''${filename}\r\nContent-Transfer-Encoding: base64\r\n\r\n${folded(bytes)}`;
  });
  return `${headers.join('\r\n')}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\n${[content, ...segments].join(`\r\n--${boundary}\r\n`)}\r\n--${boundary}--\r\n`;
}
