/** Shared whole quoted-output boundary. Browser safe; no Mail or IO dependency. */
export const AUTO_DRAFT_REPLY_OUTPUT_BYTES = 500000;
/** Trusted server configuration only. Store the effective IANA zone per input,
 * never rely on host-local formatting after an asynchronous model response. */
export function autoDraftReplyTimeZone(value: unknown = 'UTC'): string {
  if (typeof value !== 'string' || value.length > 100 || !/^[-A-Za-z_+]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)) throw new TypeError('Invalid automatic reply timezone');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new TypeError('Invalid automatic reply timezone'); }
}

/** Split only a formatter-proved UTF8 boundary after the canonical body hash
 * and current publication tuple have been verified by the caller. */
export function autoDraftQuotedBodyParts(body: string, quoteStartUtf8: number): Readonly<{reply:string;quote:string}> {
  if(typeof body!=='string'||/\p{Surrogate}/u.test(body)||!Number.isSafeInteger(quoteStartUtf8)||quoteStartUtf8<3)throw new TypeError('Invalid quoted body boundary');
  const bytes=new TextEncoder().encode(body);
  if(bytes.length>AUTO_DRAFT_REPLY_OUTPUT_BYTES||quoteStartUtf8>=bytes.length||bytes[quoteStartUtf8-2]!==10||bytes[quoteStartUtf8-1]!==10)throw new TypeError('Invalid quoted body boundary');
  const decoder=new TextDecoder('utf-8',{fatal:true}),reply=decoder.decode(bytes.slice(0,quoteStartUtf8-2)),quote=decoder.decode(bytes.slice(quoteStartUtf8));
  if(!reply.trim()||!quote)throw new TypeError('Invalid quoted body boundary');
  return Object.freeze({reply,quote});
}
