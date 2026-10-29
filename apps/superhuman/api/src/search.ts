import { Temporal } from '@js-temporal/polyfill';
import { HttpError, type Label, type Person, type Thread } from './types.ts';

type Node = { kind: 'term'; field?: string; value: string } | { kind: 'not'; child: Node } | { kind: 'and' | 'or'; children: Node[] };
type Token = { value: string; kind: 'word' | 'open' | 'close'; quoted?: boolean };
export type SearchContext = { labels?: readonly Label[]; accountEmail?: (accountId: string) => string | undefined; timeZone?: string };

export function normalizeSearchTimeZone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 128 || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) throw new HttpError(400, 'A valid IANA search time zone is required', 'invalid_search_time_zone');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new HttpError(400, 'A valid IANA search time zone is required', 'invalid_search_time_zone'); }
}

// Parse only query text. Target contents and quoted strings are never executed.
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < input.length;) {
    if (/\s/.test(input[i])) { i++; continue; }
    if ('(){}'.includes(input[i])) { const value = input[i++]; tokens.push({ value, kind: '({'.includes(value) ? 'open' : 'close' }); continue; }
    let value = ''; let inQuote = false; const quoted = input[i] === '"';
    while (i < input.length) {
      const char = input[i];
      if (char === '"') { inQuote = !inQuote; i++; continue; }
      if (char === '\\' && /["\\]/.test(input[i + 1] ?? '')) { value += input[i + 1]; i += 2; continue; }
      if (!inQuote && (/\s/.test(char) || '(){}'.includes(char))) break;
      value += char; i++;
    }
    if (value || quoted) tokens.push({ kind: 'word', value, quoted });
  }
  return tokens;
}

export function parseSearchQuery(input: string): Node {
  const tokens = tokenize(input); let cursor = 0;
  const operator = (value: string) => tokens[cursor]?.kind === 'word' && !tokens[cursor].quoted && tokens[cursor].value.toUpperCase() === value;
  const hasUnit = () => cursor < tokens.length && tokens[cursor].kind !== 'close' && !operator('OR') && !operator('AND');
  const combine = (kind: 'and' | 'or', children: Node[]): Node => children.length === 1 ? children[0] : { kind, children };
  function unit(inheritedField?: string): Node {
    let negative = false;
    while (operator('NOT') || (tokens[cursor]?.kind === 'word' && !tokens[cursor].quoted && ['-', '!'].includes(tokens[cursor].value))) { negative = !negative; cursor++; }
    const token = tokens[cursor++];
    if (!token) return { kind: 'and', children: [] };
    let result: Node;
    if (token.kind === 'open') {
      result = expression(token.value === '{' ? 'or' : 'and', inheritedField);
      if (tokens[cursor]?.kind === 'close') cursor++;
    } else {
      let value = token.value;
      if (!token.quoted) while (value.length > 1 && (value[0] === '-' || value[0] === '!')) { negative = !negative; value = value.slice(1); }
      const colon = token.quoted ? -1 : value.indexOf(':');
      const field = colon > 0 ? value.slice(0, colon).toLowerCase() : inheritedField;
      if (colon > 0) value = value.slice(colon + 1);
      if (field && !value && hasUnit()) result = unit(field);
      else result = { kind: 'term', ...(field ? { field } : {}), value };
    }
    return negative ? { kind: 'not', child: result } : result;
  }
  function conjunction(mode: 'and' | 'or', inheritedField?: string): Node {
    const children: Node[] = [];
    if (hasUnit()) children.push(unit(inheritedField));
    while (operator('AND') || (mode === 'and' && hasUnit())) {
      if (operator('AND')) cursor++;
      if (!hasUnit()) break;
      children.push(unit(inheritedField));
    }
    return combine('and', children);
  }
  function expression(mode: 'and' | 'or', inheritedField?: string): Node {
    const children = [conjunction(mode, inheritedField)];
    while (operator('OR') || (mode === 'or' && hasUnit())) {
      if (operator('OR')) cursor++;
      if (!hasUnit()) break;
      children.push(conjunction(mode, inheritedField));
    }
    return combine('or', children);
  }
  return expression('and');
}

// The observed client parses slash dates in its browser zone and ISO dates in
// UTC. Missing context retains legacy UTC; after is inclusive, before exclusive.
// Invalid calendar dates still match nothing; original overflow is unverified.
function dateBoundary(value: string, timeZone?: string): number | undefined {
  if (/^\d{9,10}$/.test(value)) return Number(value) * 1000;
  const match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  if (value.includes('/') && timeZone) {
    try { return Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' }).toZonedDateTime(timeZone).epochMilliseconds; }
    catch { return undefined; }
  }
  return date.getTime();
}

export function threadHasFolder(thread: Thread, name: string): boolean {
  const folder = ({ archive: 'done', archived: 'done', reminders: 'snoozed', junk: 'spam', deleted: 'trash' } as Record<string, string>)[name] ?? name;
  if (folder === 'anywhere') return true;
  if (folder === 'all') return thread.folder !== 'trash' && thread.folder !== 'spam';
  if (folder === 'starred') return thread.starred;
  if (folder === 'snoozed') return !!thread.snoozedUntil;
  if (folder === 'muted') return !!thread.muted;
  if (folder === 'important') return thread.important;
  const providerFolder = ({ inbox: 'INBOX', sent: 'SENT', trash: 'TRASH', spam: 'SPAM', drafts: 'DRAFT' } as Record<string, string>)[folder];
  return thread.providerLabels && providerFolder ? thread.providerLabels.includes(providerFolder) : thread.folder === folder;
}

export function createSearchMatcher(query: string, context: SearchContext = {}): (thread: Thread) => boolean {
  const timeZone = normalizeSearchTimeZone(context.timeZone);
  const root = parseSearchQuery(query);
  return (thread: Thread) => {
    const own = context.accountEmail?.(thread.accountId)?.toLowerCase();
    const labelMatches = (value: string) => thread.labels.some(id => id.toLowerCase() === value || (context.labels ?? []).some(label => label.accountId === thread.accountId && label.id === id && (label.name.toLowerCase() === value || label.providerId?.toLowerCase() === value)));
    const peopleMatch = (people: Person[], value: string) => people.some(person => value === 'me' && own ? person.email.toLowerCase() === own : `${person.name} ${person.email}`.toLowerCase().includes(value));
    const haystack = `${thread.subject} ${thread.snippet} ${thread.sender.name} ${thread.sender.email} ${thread.messages.map(message => message.text).join(' ')}`.toLowerCase();
    function term(field: string | undefined, raw: string): boolean {
      const value = raw.toLowerCase();
      if (!field) return haystack.includes(value);
      if (field === 'from') return peopleMatch(thread.messages.map(message => message.sender), value);
      if (field === 'to') return peopleMatch(thread.messages.flatMap(message => message.to), value);
      if (field === 'cc') return peopleMatch(thread.messages.flatMap(message => message.cc ?? []), value);
      if (field === 'subject') return thread.subject.toLowerCase().includes(value);
      if (field === 'filename') return thread.messages.some(message => message.attachments.some(attachment => attachment.name.toLowerCase().includes(value)));
      if (field === 'label' || field === 'l') return labelMatches(value);
      if (field === 'in') return threadHasFolder(thread, value) || labelMatches(value);
      if (field === 'has' && ['attachment', 'attachments'].includes(value)) return thread.messages.some(message => message.attachments.length > 0);
      if (field === 'is') {
        const flags: Record<string, boolean> = { unread: thread.unread, read: !thread.unread, starred: thread.starred, flagged: thread.starred, important: thread.important, unimportant: !thread.important, muted: !!thread.muted, snoozed: !!thread.snoozedUntil };
        if (value in flags) return flags[value];
      }
      if (['before', 'after', 'older', 'newer'].includes(field)) {
        const boundary = dateBoundary(value, timeZone); const timestamp = Date.parse(thread.lastMessageAt);
        return boundary !== undefined && Number.isFinite(timestamp) && (field === 'before' || field === 'older' ? timestamp < boundary : timestamp >= boundary);
      }
      // Unknown operators retain the old literal-search behavior. The replica
      // does not silently interpret unavailable headers as searchable data.
      return haystack.includes(`${field}:${value}`);
    }
    function evaluate(node: Node): boolean {
      if (node.kind === 'term') return term(node.field, node.value);
      if (node.kind === 'not') return !evaluate(node.child);
      return node.kind === 'and' ? node.children.every(evaluate) : node.children.some(evaluate);
    }
    return evaluate(root);
  };
}
