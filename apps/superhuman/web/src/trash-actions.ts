/// <reference types="node" />
import type {
  TrashEnvelope, TrashNativeStatus, TrashReason, TrashReceipt, TrashRequest,
  TrashState, TrashUndoRequest, TrashUndoStatus,
} from '../../api/src/trash-action-contract.ts';
import { createActionAdmission, type ActionAdmission, type ActionTicket } from './action-admission.ts';

export type TrashIntent = TrashRequest & { threadId: string };
export type TrashResult = TrashEnvelope;
export type TrashRecord = {
  intent: TrashIntent;
  phase: 'queued' | 'issue-possible' | TrashState;
  receipt: TrashReceipt | null;
  undo: TrashUndoStatus | null;
  undoDispatch?: { clientRequestId: string; state: 'not-issued' | 'issue-possible' | 'settled' };
  restored: boolean;
  scopeCurrent: boolean;
  localReason?: 'trash-not-confirmed' | 'trash-context-changed' | 'trash-not-saved';
};
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
type Transport = (path: string, body?: unknown, method?: string) => Promise<unknown>;
type SubmitTurn = { ticket?: ActionTicket; canIssue?: () => boolean; onAccepted?: (record: TrashRecord) => void };
const states: readonly unknown[] = ['pending', 'confirmed', 'unknown', 'refused'];
const reasons: readonly TrashReason[] = ['trash_source_changed', 'trash_account_changed', 'trash_grant_changed', 'trash_ineligible', 'trash_source_limit', 'trash_no_change', 'trash_native_scope', 'trash_native_unconfirmed', 'trash_effect_unconfirmed', 'trash_local_conflict', 'trash_stopping', 'trash_undo_expired', 'trash_undo_unavailable'];
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= 512 && !/[\s\p{Cc}]/u.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function exact(v: unknown, required: string[], optional: string[] = []): v is Record<string, unknown> {
  return object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
const reason = (v: unknown) => v === null || reasons.includes(v as TrashReason);
const terminal = (state: unknown) => state === 'confirmed' || state === 'refused';
const unavailable = () => Error('Trash status could not be verified');
function intentValid(v: unknown, accountId: string): v is TrashIntent {
  return exact(v, ['version', 'action', 'accountId', 'accountVersion', 'expectedSourceVersion', 'clientRequestId', 'threadId']) && v.version === 1 && v.action === 'trash' && v.accountId === accountId && id(v.accountId) && id(v.threadId) && hex(v.accountVersion) && hex(v.expectedSourceVersion) && uuid(v.clientRequestId);
}
function nativeStatus(raw: unknown, state: TrashState, wire = true): TrashNativeStatus {
  if (!exact(raw, ['mode', 'issuePossible', 'ackKnown', 'effectVerified']) || ![null, 'google', 'local'].includes(raw.mode as any) || ['issuePossible', 'ackKnown', 'effectVerified'].some(k => typeof raw[k] !== 'boolean')) throw unavailable();
  const n = raw as TrashNativeStatus;
  if (n.ackKnown && !n.issuePossible || n.mode !== 'google' && (n.issuePossible || n.ackKnown) || n.mode === null && n.effectVerified || n.mode === 'google' && n.effectVerified && !n.ackKnown) throw unavailable();
  if (wire && (state === 'confirmed' && !n.effectVerified || state === 'refused' && (n.issuePossible || n.ackKnown || n.effectVerified) || n.mode === 'local' && n.effectVerified !== (state === 'confirmed') || state === 'pending' && n.issuePossible)) throw unavailable();
  return { ...n };
}
function receipt(raw: unknown, intent: TrashIntent): TrashReceipt {
  if (!exact(raw, ['version', 'action', 'clientRequestId', 'accountId', 'accountVersion', 'threadId', 'state', 'undoId', 'locked', 'reason', 'native']) || raw.version !== 1 || raw.action !== 'trash' || raw.clientRequestId !== intent.clientRequestId || raw.accountId !== intent.accountId || raw.accountVersion !== intent.accountVersion || raw.threadId !== intent.threadId || !states.includes(raw.state) || raw.undoId !== null && !uuid(raw.undoId) || typeof raw.locked !== 'boolean' || !reason(raw.reason)) throw unavailable();
  const r = raw as TrashReceipt;
  if (r.state !== 'refused' && !r.undoId || r.state === 'confirmed' && r.reason !== null || r.state === 'refused' && r.reason === null) throw unavailable();
  return { ...r, native: nativeStatus(r.native, r.state) };
}
function undoStatus(raw: unknown, intent: TrashIntent, acceptedKey?: string, wire = true): TrashUndoStatus {
  if (!exact(raw, ['version', 'clientRequestId', 'state', 'reason', 'native']) || raw.version !== 1 || !uuid(raw.clientRequestId) || raw.clientRequestId === intent.clientRequestId || acceptedKey && raw.clientRequestId !== acceptedKey || !states.includes(raw.state) || !reason(raw.reason)) throw unavailable();
  const u = raw as TrashUndoStatus;
  if (wire && (u.state === 'confirmed' && u.reason !== null || u.state === 'refused' && u.reason === null)) throw unavailable();
  return { ...u, native: nativeStatus(u.native, u.state, wire) };
}
function monotonic(previous: TrashNativeStatus | undefined, current: TrashNativeStatus): void {
  if (previous && (previous.mode !== null && previous.mode !== current.mode || previous.issuePossible && !current.issuePossible || previous.ackKnown && !current.ackKnown || previous.effectVerified && !current.effectVerified)) throw unavailable();
}
/** Contextual wire decoding stays browser-only; the canonical contract import is erased. */
export function decodeTrashResult(raw: unknown, intent: TrashIntent, acceptedKey?: string): TrashResult {
  if (!exact(raw, ['version', 'scopeCurrent', 'receipt', 'undo'], ['thread']) || raw.version !== 1 || typeof raw.scopeCurrent !== 'boolean') throw unavailable();
  const r = receipt(raw.receipt, intent);
  const u = raw.undo === null ? null : undoStatus(raw.undo, intent, acceptedKey);
  if (u && (r.state !== 'confirmed' || !r.undoId || u.native.mode !== r.native.mode)) throw unavailable();
  const locked = !terminal(r.state) || r.state === 'refused' && r.undoId !== null || !!u && !terminal(u.state);
  if (r.locked !== locked) throw unavailable();
  if (Object.hasOwn(raw, 'thread')) {
    const t = raw.thread;
    if (!raw.scopeCurrent || !object(t) || t.id !== intent.threadId || t.accountId !== intent.accountId || !Array.isArray(t.messages)) throw unavailable();
  }
  return { ...raw, receipt: r, undo: u } as TrashResult;
}

/** Content-free local keys plus transient admission; ambiguous dispatch is never replayed. */
export function createTrashQueue(accountId: string, options: {
  storage: Storage; transport: Transport; admission?: ActionAdmission;
  onChange?: (record: TrashRecord, value?: TrashResult) => void;
}) {
  const admission = options.admission ?? createActionAdmission();
  const records = new Map<string, TrashRecord>();
  const queuedUndos = new Set<string>();
  const tickets = new Set<ActionTicket>();
  const key = 'rea:trash-actions:v1:' + encodeURIComponent(accountId);
  let disposed = false, blocked: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const emit = (record: TrashRecord, value?: TrashResult) => {
    if (!disposed) { try { options.onChange?.(record, value); } catch { /* A presentation observer cannot bypass admission. */ } }
  };
  const serialized = () => JSON.stringify({ version: 1, accountId, records: [...records.values()].map(r => ({
    intent: r.intent, phase: r.phase, receipt: r.receipt, undo: r.undo,
    ...(r.undoDispatch ? { undoDispatch: r.undoDispatch } : {}), restored: r.restored,
    scopeCurrent: r.scopeCurrent, ...(r.localReason ? { localReason: r.localReason } : {}),
  })) });
  const save = () => {
    const raw = serialized();
    if (records.size > 200 || raw.length > 400000) throw Error('Trash history is full');
    options.storage.setItem(key, raw);
  };
  const trySave = () => { try { save(); } catch { /* Keep known observations in this live owner. */ } };
  const removable = (r: TrashRecord) => terminal(r.phase) && !r.receipt?.locked && (!r.undoDispatch || r.undoDispatch.state === 'settled') && (!r.undo || terminal(r.undo.state));
  try {
    const raw = options.storage.getItem(key);
    if (raw !== null) {
      if (raw.length > 400000) throw unavailable();
      const history: unknown = JSON.parse(raw);
      if (!exact(history, ['version', 'accountId', 'records']) || history.version !== 1 || history.accountId !== accountId || !Array.isArray(history.records) || history.records.length > 200) throw unavailable();
      for (const rawRecord of history.records) {
        if (!exact(rawRecord, ['intent', 'phase', 'receipt', 'undo', 'restored', 'scopeCurrent'], ['undoDispatch', 'localReason']) || !intentValid(rawRecord.intent, accountId) || !['queued', 'issue-possible', ...states].includes(rawRecord.phase) || typeof rawRecord.restored !== 'boolean' || typeof rawRecord.scopeCurrent !== 'boolean' || rawRecord.localReason !== undefined && !['trash-not-confirmed', 'trash-context-changed', 'trash-not-saved'].includes(rawRecord.localReason as string)) throw unavailable();
        const i = rawRecord.intent;
        if (records.has(i.clientRequestId)) throw unavailable();
        const r = rawRecord.receipt === null ? null : receipt(rawRecord.receipt, i);
        const d = rawRecord.undoDispatch;
        if (d !== undefined && (!exact(d, ['clientRequestId', 'state']) || !uuid(d.clientRequestId) || d.clientRequestId === i.clientRequestId || !['not-issued', 'issue-possible', 'settled'].includes(d.state as string))) throw unavailable();
        const u = rawRecord.undo === null ? null : undoStatus(rawRecord.undo, i, (d as TrashRecord['undoDispatch'])?.clientRequestId, false);
        const acceptedKey = (d as TrashRecord['undoDispatch'])?.clientRequestId ?? u?.clientRequestId;
        const settled = !!d && d.state === 'settled' && !!u && terminal(u.state);
        if (d && !u || r && rawRecord.phase === 'refused' && r.state !== 'refused') throw unavailable();
        records.set(i.clientRequestId, {
          intent: { ...i }, phase: rawRecord.phase === 'refused' && !r?.locked ? 'refused' : 'unknown', receipt: r,
          undo: acceptedKey ? { version: 1, clientRequestId: acceptedKey, state: settled ? u!.state : 'unknown', reason: settled ? u!.reason : null, native: u?.native ?? { mode: null, issuePossible: false, ackKnown: false, effectVerified: false } } : null,
          ...(acceptedKey ? { undoDispatch: { clientRequestId: acceptedKey, state: settled ? 'settled' : 'issue-possible' } as const } : {}),
          restored: true, scopeCurrent: false,
        });
      }
    }
  } catch {
    records.clear();
    blocked = 'Trash history could not be loaded. Check the message status before trying again.';
  }

  const current = (guard?: () => boolean) => { try { return !disposed && (guard?.() ?? true); } catch { return false; } };
  const mode = (record: TrashRecord): TrashNativeStatus => ({ mode: record.receipt?.native.mode ?? null, issuePossible: false, ackKnown: false, effectVerified: false });
  const unissued = (record: TrashRecord, localReason: NonNullable<TrashRecord['localReason']>, inverse = false) => {
    record.localReason = localReason;
    if (inverse) record.undo = { version: 1, clientRequestId: record.undoDispatch!.clientRequestId, state: 'refused', reason: null, native: mode(record) };
    else record.phase = 'refused';
    if (inverse) record.undoDispatch!.state = 'not-issued';
    trySave(); emit(record); return record;
  };
  const markMissingUndo = (record: TrashRecord) => {
    if (record.undoDispatch?.state === 'issue-possible') record.undo = {
      version: 1, clientRequestId: record.undoDispatch.clientRequestId, state: 'unknown', reason: null,
      native: record.undo?.native ?? mode(record),
    };
  };
  const apply = (record: TrashRecord, raw: unknown) => {
    const value = decodeTrashResult(raw, record.intent, record.undoDispatch?.clientRequestId);
    monotonic(record.receipt?.native, value.receipt.native);
    if (value.undo) monotonic(record.undo?.native, value.undo.native);
    record.receipt = value.receipt; record.phase = value.receipt.state;
    record.scopeCurrent = value.scopeCurrent; record.restored = false;
    if (value.undo) {
      record.undo = value.undo;
      record.undoDispatch = { clientRequestId: value.undo.clientRequestId, state: terminal(value.undo.state) ? 'settled' : 'issue-possible' };
      delete record.localReason;
    } else {
      markMissingUndo(record);
      if (!record.undoDispatch) delete record.localReason;
    }
    trySave(); emit(record, value); return value;
  };
  const schedule = (ticket: ActionTicket, record: TrashRecord, work: () => Promise<TrashRecord>, kind: 'forward' | 'inverse' | 'read' = 'forward') => {
    tickets.add(ticket);
    let started = false;
    const next = ticket.run(async () => { started = true; return work(); }).catch(error => {
      if (!started) return kind === 'read' ? record : unissued(record, 'trash-context-changed', kind === 'inverse');
      throw error;
    }).finally(() => { tickets.delete(ticket); });
    tail = Promise.allSettled([tail, next]).then(() => undefined);
    return next;
  };
  const path = (i: TrashIntent) => '/threads/' + encodeURIComponent(i.threadId) + '/trash-action-operations/' + encodeURIComponent(i.clientRequestId);
  const fail = (ticket: ActionTicket, message: string) => { ticket.cancel(); tickets.delete(ticket); return Promise.reject<TrashRecord>(Error(message)); };
  const submit = (input: TrashIntent, turn: SubmitTurn = {}): Promise<TrashRecord> => {
    const ticket = turn.ticket ?? admission.reserve(accountId);
    tickets.add(ticket);
    if (disposed || blocked || !intentValid(input, accountId)) return fail(ticket, blocked ?? 'Trash is unavailable for this conversation');
    const existing = records.get(input.clientRequestId);
    if (existing) {
      ticket.cancel(); tickets.delete(ticket);
      return Object.keys(existing.intent).every(k => existing.intent[k as keyof TrashIntent] === input[k as keyof TrashIntent]) ? Promise.resolve(existing) : Promise.reject(Error('Trash request key belongs to another intent'));
    }
    if ([...records.values()].some(r => r.intent.accountVersion === input.accountVersion && r.intent.threadId === input.threadId && r.intent.expectedSourceVersion === input.expectedSourceVersion && !removable(r))) return fail(ticket, 'Check the pending Trash status before trying again');
    const before = [...records];
    const record: TrashRecord = { intent: { version: 1, action: 'trash', accountId, accountVersion: input.accountVersion, expectedSourceVersion: input.expectedSourceVersion, clientRequestId: input.clientRequestId, threadId: input.threadId }, phase: 'queued', receipt: null, undo: null, restored: false, scopeCurrent: true };
    records.set(input.clientRequestId, record);
    while (records.size > 200 || serialized().length > 400000) {
      const old = [...records].find(([requestId, r]) => requestId !== input.clientRequestId && removable(r));
      if (!old) break;
      records.delete(old[0]);
    }
    try { save(); } catch {
      records.clear(); for (const [requestId, old] of before) records.set(requestId, old);
      return fail(ticket, 'Trash could not be saved safely. Nothing was submitted.');
    }
    try { turn.onAccepted?.(record); } catch {
      ticket.cancel(); tickets.delete(ticket); unissued(record, 'trash-context-changed');
      return Promise.reject(Error('Trash presentation changed before submission'));
    }
    emit(record);
    return schedule(ticket, record, async () => {
      if (!current(turn.canIssue)) return unissued(record, 'trash-context-changed');
      record.phase = 'issue-possible';
      try { save(); } catch { return unissued(record, 'trash-not-saved'); }
      emit(record);
      if (!current(turn.canIssue)) return unissued(record, 'trash-context-changed');
      try {
        const { threadId, ...body } = record.intent;
        apply(record, await options.transport('/threads/' + encodeURIComponent(threadId) + '/trash-actions', body, 'POST'));
      } catch { record.phase = 'unknown'; trySave(); emit(record); }
      return record;
    });
  };
  const recover = (requestId: string): Promise<TrashRecord> => {
    const ticket = admission.reserve(accountId), record = records.get(requestId);
    tickets.add(ticket);
    if (!record || disposed || blocked) return fail(ticket, blocked ?? 'Trash request not found');
    return schedule(ticket, record, async () => {
      if (disposed) return record;
      const i = record.intent;
      try { apply(record, await options.transport(path(i) + '?' + new URLSearchParams({ accountId: i.accountId, accountVersion: i.accountVersion }), undefined, 'GET')); }
      catch { if (!terminal(record.phase)) record.phase = 'unknown'; markMissingUndo(record); trySave(); emit(record); }
      return record;
    }, 'read');
  };
  const undo = (requestId: string, undoRequestId: string, canIssue?: () => boolean, provided?: ActionTicket): Promise<TrashRecord> => {
    const ticket = provided ?? admission.reserve(accountId), record = records.get(requestId);
    tickets.add(ticket);
    if (disposed || blocked || !record || !uuid(undoRequestId) || undoRequestId === requestId) return fail(ticket, blocked ?? 'Trash Undo is unavailable');
    if (queuedUndos.has(requestId) || record.undoDispatch && record.undoDispatch.state !== 'not-issued' || record.undo && !record.undoDispatch) { ticket.cancel(); tickets.delete(ticket); return Promise.resolve(record); }
    const previousUndo = record.undo, previousDispatch = record.undoDispatch, previousReason = record.localReason;
    const acceptedKey = previousDispatch?.clientRequestId ?? undoRequestId;
    record.undo = { version: 1, clientRequestId: acceptedKey, state: 'pending', reason: null, native: mode(record) };
    record.undoDispatch = { clientRequestId: acceptedKey, state: 'not-issued' }; delete record.localReason;
    try { save(); } catch {
      record.undo = previousUndo; record.undoDispatch = previousDispatch; record.localReason = previousReason;
      return fail(ticket, 'Trash Undo could not be saved safely. Nothing was submitted.');
    }
    queuedUndos.add(requestId); emit(record);
    return schedule(ticket, record, async () => {
      if (!current(canIssue)) return unissued(record, 'trash-context-changed', true);
      if (record.phase !== 'confirmed' || !record.receipt?.undoId || record.restored || !record.scopeCurrent) return unissued(record, 'trash-not-confirmed', true);
      record.undoDispatch = { clientRequestId: acceptedKey, state: 'issue-possible' };
      try { save(); } catch { return unissued(record, 'trash-not-saved', true); }
      emit(record);
      if (!current(canIssue)) return unissued(record, 'trash-context-changed', true);
      const i = record.intent;
      const body: TrashUndoRequest = { version: 1, accountId: i.accountId, accountVersion: i.accountVersion, clientRequestId: acceptedKey };
      try {
        const raw = await options.transport(path(i) + '/undo', body, 'POST');
        const value = decodeTrashResult(raw, i, acceptedKey);
        if (!value.undo) throw unavailable();
        apply(record, value);
      } catch {
        record.undo = { version: 1, clientRequestId: acceptedKey, state: 'unknown', reason: null, native: record.undo?.native ?? mode(record) };
        trySave(); emit(record);
      }
      return record;
    }, 'inverse').finally(() => { queuedUndos.delete(requestId); });
  };
  return {
    submit, undo, recover, get: (requestId: string) => records.get(requestId), all: () => [...records.values()],
    blocked: () => blocked, wait: () => tail,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const ticket of tickets) ticket.cancel();
      if (!options.admission) admission.dispose();
    },
  };
}
export type TrashQueue = ReturnType<typeof createTrashQueue>;
