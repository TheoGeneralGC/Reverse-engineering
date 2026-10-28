import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './types.ts';
import type { AiChatSession, AiChatTurn, AiChatSubmit, AiProgressPayload, AiChatEvent, AiSessionPage, AiSessionDetail, AiEventPage } from './ai-chat-types.ts';
import type { PersonalizationSnapshot } from './personalization-types.ts';

export const terminal = (state: AiChatTurn['state']) => !['queued', 'running', 'cancel_requested'].includes(state);
export const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
export function clip(s: string, maximum: number) { if (bytes(s) <= maximum) return s; const buffer = Buffer.from(s); let end = maximum; while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--; return buffer.subarray(0, end).toString('utf8'); }
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function invalid(message = 'Invalid chat request'): never { throw new HttpError(400, message, 'ai_chat_invalid_request'); }
export function identifier(value: unknown): string { if (typeof value !== 'string' || !value || bytes(value) > 1024 || /[\x00-\x20\x7f]/.test(value)) invalid(); return value; }
export function integer(value: unknown, fallback: number, maximum: number) { if (value === undefined || value === null) return fallback; const n = typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > maximum) invalid(); return n; }
export function strictObject(value: unknown, allowed: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) invalid(); return value as Record<string, unknown>; }
export function notFound(): never { throw new HttpError(404, 'Chat resource not found', 'ai_chat_not_found'); }

export class AiChatRepository {
  readonly db: DatabaseSync;
  readonly owner = randomUUID();
  readonly now: () => number;
  constructor(db: DatabaseSync, now = Date.now, ownerAlive: (pid: number) => boolean = pid => { try { process.kill(pid, 0); return true; } catch { return false; } }) {
    this.db = db; this.now = now;
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS ai_sessions(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ai_session_account ON ai_sessions(account_id,updated_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS ai_turns(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,session_id TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,seq INTEGER NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,session_id,client_key),UNIQUE(session_id,seq));
      CREATE INDEX IF NOT EXISTS ai_turn_session ON ai_turns(account_id,session_id,seq DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ai_active_account ON ai_turns(account_id) WHERE state IN ('queued','running','cancel_requested');
      CREATE TABLE IF NOT EXISTS ai_events(turn_id TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(turn_id,seq));
      CREATE TABLE IF NOT EXISTS ai_offered_sources(turn_id TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(turn_id,source_id));
      CREATE TABLE IF NOT EXISTS ai_dispatches(turn_id TEXT NOT NULL,round INTEGER NOT NULL,started_at TEXT NOT NULL,request_hash TEXT NOT NULL,PRIMARY KEY(turn_id,round));
      COMMIT;`);
    for (const row of db.prepare("SELECT id,owner_pid,data FROM ai_turns WHERE state IN ('queued','running','cancel_requested')").all()) {
      const turn = JSON.parse(String(row.data)) as AiChatTurn;
      if (ownerAlive(Number(row.owner_pid)) && (!turn.deadlineAt || Date.parse(turn.deadlineAt) > now())) continue;
      this.update(turn.id, current => { const dispatched = current.dispatchCount > 0; current.state = dispatched ? 'outcome_unknown' : 'interrupted'; current.error = { code: 'ai_chat_interrupted', message: dispatched ? 'The prior model request was interrupted; its outcome and cost are unknown. It will not be retried automatically.' : 'The prior turn was interrupted before dispatch.', retry: 'explicit-new-turn', providerOutcome: dispatched ? 'unknown' : 'not_dispatched' }; }, [], true);
    }
  }
  transaction<T>(fn: () => T) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  account(accountId: string) { identifier(accountId); if (!this.db.prepare("SELECT 1 FROM records WHERE kind='account' AND id=?").get(accountId)) notFound(); }
  session(accountId: string, sessionId: string): AiChatSession { this.account(accountId); identifier(sessionId); const r = this.db.prepare('SELECT data FROM ai_sessions WHERE id=? AND account_id=?').get(sessionId, accountId); if (!r) notFound(); return JSON.parse(String(r.data)); }
  createSession(accountId: string): AiChatSession { this.account(accountId); const at = new Date(this.now()).toISOString(); const session: AiChatSession = { id: randomUUID(), accountId, title: 'New conversation', createdAt: at, updatedAt: at, revision: 0, turnCount: 0, activeTurnId: null }; this.saveSession(session); return session; }
  saveSession(s: AiChatSession) { this.db.prepare('INSERT INTO ai_sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data').run(s.id, s.accountId, s.updatedAt, JSON.stringify(s)); }
  listSessions(accountId: string, limit = 20, cursor?: string | null): AiSessionPage {
    this.account(accountId); if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid(); let position: { at: string; id: string } | undefined;
    if (cursor) { try { if (cursor.length > 4096 || !/^[\w-]+$/.test(cursor)) throw 0; const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); if (v.v !== 1 || v.accountId !== accountId || Object.keys(v).sort().join() !== 'accountId,at,id,v' || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) || typeof v.id !== 'string') throw 0; position = { at: v.at, id: identifier(v.id) }; } catch { throw new HttpError(400, 'Invalid chat cursor', 'ai_chat_invalid_cursor'); } }
    const rows = position ? this.db.prepare('SELECT data FROM ai_sessions WHERE account_id=? AND (updated_at,id)<(?,?) ORDER BY updated_at DESC,id DESC LIMIT ?').all(accountId, position.at, position.id, limit + 1) : this.db.prepare('SELECT data FROM ai_sessions WHERE account_id=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(accountId, limit + 1);
    const sessions = rows.slice(0, limit).map(r => JSON.parse(String(r.data)) as AiChatSession); const last = sessions.at(-1); const hasMore = rows.length > limit;
    return { sessions, hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ v: 1, accountId, at: last.updatedAt, id: last.id })).toString('base64url') : null };
  }
  sessionDetail(accountId: string, sessionId: string, beforeSeq?: number, limit = 20): AiSessionDetail {
    const session = this.session(accountId, sessionId); if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1))) invalid();
    const rows = this.db.prepare('SELECT data FROM ai_turns WHERE account_id=? AND session_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(accountId, sessionId, beforeSeq ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const turns = rows.slice(0, limit).map(r => JSON.parse(String(r.data)) as AiChatTurn).reverse(); const hasMore = rows.length > limit;
    return { session, turns, hasMore, nextBeforeSeq: hasMore ? turns[0].seq : null };
  }
  turn(accountId: string, sessionId: string, turnId: string): AiChatTurn { this.session(accountId, sessionId); identifier(turnId); const r = this.db.prepare('SELECT data FROM ai_turns WHERE id=? AND account_id=? AND session_id=?').get(turnId, accountId, sessionId); if (!r) notFound(); return JSON.parse(String(r.data)); }
  byRequest(accountId: string, sessionId: string, key: string): AiChatTurn { this.session(accountId, sessionId); identifier(key); const r = this.db.prepare('SELECT data FROM ai_turns WHERE account_id=? AND session_id=? AND client_key=?').get(accountId, sessionId, key); if (!r) notFound(); return JSON.parse(String(r.data)); }
  rawTurn(id: string): AiChatTurn { const r = this.db.prepare('SELECT data FROM ai_turns WHERE id=?').get(id); if (!r) notFound(); return JSON.parse(String(r.data)); }
  accept(sessionId: string, input: AiChatSubmit, model: string, personalization?: PersonalizationSnapshot) {
    if (personalization && (personalization.accountId !== input.accountId || !Number.isSafeInteger(personalization.revision) || personalization.revision < 0 || !/^[a-f0-9]{64}$/.test(personalization.hash) || typeof personalization.text !== 'string' || personalization.text.length > 32000)) invalid('Invalid personalization snapshot');
    return this.transaction(() => {
      const session = this.session(input.accountId, sessionId); const fingerprint = hash(input);
      const existing = this.db.prepare('SELECT fingerprint,data FROM ai_turns WHERE account_id=? AND session_id=? AND client_key=?').get(input.accountId, sessionId, input.clientRequestId);
      if (existing) { if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'This request key belongs to a different chat request', 'ai_chat_request_conflict'); return { turn: JSON.parse(String(existing.data)) as AiChatTurn, accepted: false }; }
      if (input.expectedRevision !== session.revision) throw new HttpError(409, 'The conversation changed; reload before submitting', 'ai_chat_revision_conflict');
      if (session.activeTurnId) throw new HttpError(409, 'A response is already in progress', 'ai_chat_turn_in_progress');
      if (this.db.prepare("SELECT 1 FROM ai_turns WHERE account_id=? AND state IN ('queued','running','cancel_requested')").get(input.accountId) || Number(this.db.prepare("SELECT COUNT(*) AS n FROM ai_turns WHERE state IN ('queued','running','cancel_requested')").get()!.n) >= 2) throw new HttpError(503, 'Chat capacity is in use; no request was dispatched', 'ai_chat_capacity');
      if (input.retryOfTurnId) { const old = this.turn(input.accountId, sessionId, input.retryOfTurnId); if (!terminal(old.state) || old.state === 'completed') invalid('Only a finished unsuccessful turn can be explicitly retried'); }
      const at = new Date(this.now()).toISOString(); const turn: AiChatTurn = { id: randomUUID(), sessionId, accountId: input.accountId, seq: session.turnCount + 1, clientRequestId: input.clientRequestId, ...(input.retryOfTurnId ? { retryOfTurnId: input.retryOfTurnId } : {}), prompt: input.prompt, context: input.context, ...(personalization ? { personalization: structuredClone(personalization) } : {}), state: 'queued', phase: 'queued', revision: 0, lastEventSeq: 0, createdAt: at, deadlineAt: new Date(this.now() + 60000).toISOString(), provider: 'anthropic', model, providerRequestIds: [], dispatchCount: 0, partial: { markdown: '', thinkingSummary: null }, answer: null, sources: [], usage: { inputTokens: null, outputTokens: null }, limits: { providerRounds: 0, toolCalls: 0, summaryHits: 0, fullThreadReads: 0, knowledgeReads: 0, contextBytes: 0, outputTokens: 0, exhausted: [] }, coverage: [], error: null, cancellation: { requestedAt: null, localStoppedAt: null, providerOutcome: 'not_dispatched' } };
      this.db.prepare('INSERT INTO ai_turns VALUES(?,?,?,?,?,?,?,?,?,?)').run(turn.id, turn.accountId, turn.sessionId, turn.clientRequestId, fingerprint, turn.seq, turn.state, this.owner, process.pid, JSON.stringify(turn));
      this.saveSession({ ...session, title: session.turnCount ? session.title : clip(input.prompt.trim(), 160), activeTurnId: turn.id, turnCount: turn.seq, revision: session.revision + 1, updatedAt: at });
      return { turn, accepted: true };
    });
  }
  update(id: string, change: (turn: AiChatTurn) => void, payloads: AiProgressPayload[] = [], allowOtherOwner = false, commit?: (turn: AiChatTurn) => void): AiChatTurn {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT data,owner FROM ai_turns WHERE id=?').get(id); if (!row) notFound(); const turn = JSON.parse(String(row.data)) as AiChatTurn;
      if (terminal(turn.state) || (!allowOtherOwner && row.owner !== this.owner)) return turn;
      change(turn); turn.revision++;
      const at = new Date(this.now()).toISOString();
      const existingBytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM ai_events WHERE turn_id=?').get(id)!.n);
      const envelope = (payload: AiProgressPayload, offset: number): AiChatEvent => ({ accountId: turn.accountId, sessionId: turn.sessionId, turnId: id, seq: turn.lastEventSeq + offset + 1, revision: turn.revision, createdAt: at, payload });
      const planned = terminal(turn.state) ? [...payloads, { kind: 'terminal' as const, state: turn.state, revision: turn.revision }] : payloads;
      // Reserve one event/512 bytes for terminalization before accepting normal
      // progress. Measure complete durable envelopes, including scope metadata.
      const terminalReserve = bytes(JSON.stringify(envelope({ kind: 'terminal', state: 'outcome_unknown', revision: turn.revision + 1 }, payloads.length))) + 16;
      if (turn.lastEventSeq + planned.length > (terminal(turn.state) ? 1024 : 1023) || existingBytes + planned.reduce((sum, p, i) => sum + bytes(JSON.stringify(envelope(p, i))), 0) > 1048576 - (terminal(turn.state) ? 0 : terminalReserve)) {
        turn.state = 'failed'; turn.answer = null; if (!turn.limits.exhausted.includes('events')) turn.limits.exhausted.push('events');
        turn.previews = [];
        turn.error = { code: 'ai_chat_budget_exhausted', message: 'The local progress log limit was reached; the answer is incomplete.', retry: 'explicit-new-turn', providerOutcome: turn.dispatchCount ? 'unknown' : 'not_dispatched' }; payloads = [];
      }
      if (terminal(turn.state)) { turn.phase = 'finished'; turn.finishedAt = at; const session = this.session(turn.accountId, turn.sessionId); this.saveSession({ ...session, activeTurnId: session.activeTurnId === id ? null : session.activeTurnId, revision: session.revision + 1, updatedAt: at }); payloads = [...payloads, { kind: 'terminal', state: turn.state, revision: turn.revision }]; }
      for (let i = 0; i < payloads.length; i++) { const event = envelope(payloads[i], 0); turn.lastEventSeq++; this.db.prepare('INSERT INTO ai_events VALUES(?,?,?)').run(id, event.seq, JSON.stringify(event)); }
      commit?.(turn);
      this.db.prepare('UPDATE ai_turns SET state=?,data=? WHERE id=?').run(turn.state, JSON.stringify(turn), id); return turn;
    });
  }
  events(accountId: string, sessionId: string, id: string, afterSeq = 0, limit = 100): AiEventPage { const turn = this.turn(accountId, sessionId, id); if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > turn.lastEventSeq || !Number.isInteger(limit) || limit < 1 || limit > 200) invalid(); const rows = this.db.prepare('SELECT data FROM ai_events WHERE turn_id=? AND seq>? ORDER BY seq LIMIT ?').all(id, afterSeq, limit + 1); const events = rows.slice(0, limit).map(r => JSON.parse(String(r.data)) as AiChatEvent); return { events, nextSeq: events.at(-1)?.seq ?? afterSeq, hasMore: rows.length > limit, turnRevision: turn.revision, terminal: terminal(turn.state) }; }
  dispatch(id: string, sourceIds: string[], request: unknown) { return this.update(id, turn => { if (turn.state !== 'running') invalid(); turn.dispatchCount++; turn.limits.providerRounds++; turn.phase = 'connecting'; turn.cancellation.providerOutcome = 'unknown'; this.db.prepare('INSERT INTO ai_dispatches VALUES(?,?,?,?)').run(id, turn.dispatchCount, new Date(this.now()).toISOString(), hash(request)); for (const sourceId of sourceIds) { if (!turn.sources.some(s => s.id === sourceId)) invalid(); this.db.prepare('INSERT OR IGNORE INTO ai_offered_sources VALUES(?,?)').run(id, sourceId); } }, [{ kind: 'state', state: 'running', phase: 'connecting' }]); }
  offered(id: string) { return new Set(this.db.prepare('SELECT source_id FROM ai_offered_sources WHERE turn_id=?').all(id).map(row => String(row.source_id))); }
}
