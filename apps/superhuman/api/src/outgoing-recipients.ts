import { HttpError, type Person } from './types.ts';

const invalid = (): never => { throw new HttpError(400, 'Enter valid recipient email addresses; fix every invalid recipient before sending', 'invalid_recipients'); };
const controls = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const malformedUnicode = /[\uD800-\uDFFF]/u;

// Deliberately bounded outgoing subset: dot-atom local part and DNS domain.
// Import parsing stays permissive and separate. No groups/comments/routes,
// quoted local parts, domain literals, or SMTPUTF8 local parts are inferred.
export function validOutgoingRecipientEmail(raw: string): boolean {
  if (typeof raw !== 'string' || controls.test(raw) || malformedUnicode.test(raw)) return false;
  const parts = raw.split('@'); if (parts.length !== 2 || new TextEncoder().encode(raw).byteLength > 254) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-z\d!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z\d!#$%&'*+/=?^_`{|}~-]+)*$/i.test(local)) return false;
  if (!domain.includes('.') || !domain.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return false;
  return true;
}

function address(raw: string): string {
  if (!validOutgoingRecipientEmail(raw)) return invalid();
  return raw;
}

function displayName(raw: string): string {
  if (raw.length > 512) return invalid();
  if (!raw) return '';
  if (!raw.startsWith('"')) {
    // Matches the web model's simple authored-name form. Serialization always
    // quotes the result, including periods and other phrase punctuation.
    if (!/^[\p{L}\p{N} $%&'*+.\-/=?^_`{}|~]+$/u.test(raw)) return invalid();
    return raw;
  }
  let result = '';
  for (let index = 1; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') { if (index !== raw.length - 1) return invalid(); return result; }
    if (char === '\\') {
      const next = raw[++index];
      // RFC5322 quoted-pair: one visible ASCII character/space. Canonical web
      // formatting uses this for quote and backslash; a dangling pair fails.
      if (!next || next.charCodeAt(0) < 32 || next.charCodeAt(0) > 126) return invalid();
      result += next;
    } else result += char;
  }
  return invalid();
}

export function parseOutgoingRecipientHeader(header: string): Person[] {
  if (typeof header !== 'string' || header.length > 65_536 || controls.test(header) || malformedUnicode.test(header)) return invalid();
  if (!header.trim()) return [];
  const recipients: Person[] = [];
  let start = 0; let open = -1; let close = -1; let quoted = false; let escaped = false;
  const finish = (end: number) => {
    const fragment = header.slice(start, end).trim(); if (!fragment || recipients.length >= 200) return invalid();
    if (open === -1) recipients.push({ name: '', email: address(fragment) });
    else {
      if (close === -1 || header.slice(close + 1, end).trim()) return invalid();
      recipients.push({ name: displayName(header.slice(start, open).trim()), email: address(header.slice(open + 1, close).trim()) });
    }
    start = end + 1; open = -1; close = -1;
  };
  for (let index = 0; index < header.length; index++) {
    const char = header[index];
    if (escaped) { escaped = false; continue; }
    if (quoted) { if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { if (open !== -1 && close === -1) return invalid(); quoted = true; continue; }
    if (char === '\\' || char === ';' || char === ':') return invalid();
    if (char === '<') { if (open !== -1) return invalid(); open = index; }
    else if (char === '>') { if (open === -1 || close !== -1) return invalid(); close = index; }
    else if (char === ',') { if (open !== -1 && close === -1) return invalid(); finish(index); }
  }
  if (quoted || escaped || (open !== -1 && close === -1)) return invalid();
  finish(header.length); return recipients;
}

export function parseOutgoingRecipientHeaders(headers: { to: string; cc: string; bcc: string }, requireRecipient = true) {
  const to = parseOutgoingRecipientHeader(headers.to); const cc = parseOutgoingRecipientHeader(headers.cc); const bcc = parseOutgoingRecipientHeader(headers.bcc);
  const recipients = [...to, ...cc, ...bcc]; if (requireRecipient && recipients.length === 0) return invalid();
  return { to, cc, bcc, recipients };
}

export function formatOutgoingRecipientHeader(recipients: Person[]): string {
  return recipients.map(person => person.name ? `"${person.name.replace(/["\\]/g, '\\$&')}" <${person.email}>` : person.email).join(', ');
}
