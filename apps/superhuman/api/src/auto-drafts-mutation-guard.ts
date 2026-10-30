import {messageSourceValue} from './reminder-message-projection.ts';
import type {DraftWriteContext} from './generated-draft-policy.ts';
import { Store } from './store.ts';
import { createHash } from 'node:crypto';
import { HttpError, type Account, type Draft, type Thread } from './types.ts';
import type { NoTargetBasis } from './auto-drafts-generation-contract.ts';

export type DraftGuard = { draftId: string; accountId: string; threadId: string | null; version: number; fence: null | 'removed' | 'discard-intent' | 'delivery-owned'; at: string };
const conflict = (): never => { throw new HttpError(409, 'The automatic draft publication basis changed', 'auto_draft_generation_basis_conflict'); };
const corrupt = (): never => { throw new HttpError(500, 'Automatic draft guard data is unavailable', 'auto_draft_generation_corrupt'); };
export const guardId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1024 && !/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v);
export const guardHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function guardNext(v: number) { if (!Number.isSafeInteger(v) || v < 0) return corrupt(); if (v === Number.MAX_SAFE_INTEGER) return conflict(); return v + 1; }
export function threadInputVersion(thread: Thread) { return createHash('sha256').update(JSON.stringify({ id: thread.id, accountId: thread.accountId, providerId: thread.providerId ?? null, subject: thread.subject, messages: thread.messages.map(messageSourceValue) })).digest('hex'); }

/** Internal observer only. No scan/enrollment, timers, transport or generation. */
export class AutoDraftMutationGuard {
  private unregister: () => void;
  readonly store: Store;
  readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store; this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS auto_draft_thread_versions(account_id TEXT NOT NULL,thread_id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(account_id,thread_id));
      CREATE TABLE IF NOT EXISTS auto_draft_mutation_guards(draft_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,data TEXT NOT NULL);`);
    this.unregister = store.registerDraftLifecycleHooks({ written: (before, next,context) => {if(before&&store.preservesGeneratedMetadata(before,next,context))return;this.record(before, next, 'write')}, beforeRemove: draft => this.record(draft, draft, 'removed'), acceptedIntent: draft => this.record(draft, draft, 'discard-intent') });
  }
  private account(accountId: string) { if (!guardId(accountId)) conflict(); const account = this.store.get<Account>('account', accountId); if (!account || account.id !== accountId) throw new HttpError(404, 'Account unavailable', 'auto_draft_generation_not_found'); }
  version(accountId: string, threadId: string): number {
    if (!guardId(accountId) || !guardId(threadId)) conflict();
    const row = this.store.db.prepare('SELECT version FROM auto_draft_thread_versions WHERE account_id=? AND thread_id=?').get(accountId, threadId);
    const version = row ? Number(row.version) : 0; if (!Number.isSafeInteger(version) || version < 0) corrupt(); return version;
  }
  guard(accountId: string, draftId: string): DraftGuard | null {
    const row = this.store.db.prepare('SELECT data FROM auto_draft_mutation_guards WHERE draft_id=? AND account_id=?').get(draftId, accountId); if (!row) return null;
    let value: DraftGuard; try { value = JSON.parse(String(row.data)); } catch { return corrupt(); }
    if (!value || value.draftId !== draftId || value.accountId !== accountId || !guardId(value.draftId) || !guardId(value.accountId) || value.threadId !== null && !guardId(value.threadId) || !Number.isSafeInteger(value.version) || value.version < 1 || ![null, 'removed', 'discard-intent', 'delivery-owned'].includes(value.fence) || !Number.isFinite(Date.parse(value.at))) corrupt();
    return value;
  }
  private record(before: Draft | undefined, next: Draft, kind: 'write' | 'removed' | 'discard-intent') {
    if (!this.store.db.isTransaction) throw new Error('Draft guard must share the mutation savepoint');
    if (!guardId(next.id) || !guardId(next.accountId) || next.threadId !== undefined && !guardId(next.threadId)) corrupt();
    const oldRow = this.store.db.prepare('SELECT account_id FROM auto_draft_mutation_guards WHERE draft_id=?').get(next.id);
    const old = oldRow ? this.guard(String(oldRow.account_id), next.id) : null;
    const time = this.now(); if (!Number.isSafeInteger(time) || time < 0 || old && time < Date.parse(old.at)) corrupt();
    const touched = new Map<string, [string, string]>();
    for (const value of [before, next]) if (value?.threadId) touched.set(JSON.stringify([value.accountId, value.threadId]), [value.accountId, value.threadId]);
    for (const [accountId, threadId] of touched.values()) this.store.db.prepare('INSERT INTO auto_draft_thread_versions VALUES(?,?,?) ON CONFLICT(account_id,thread_id) DO UPDATE SET version=excluded.version').run(accountId, threadId, guardNext(this.version(accountId, threadId)));
    const deliveryOwned = !!next.artifactSendId || !!next.composerSendId || !!next.deliveryAttemptId || !['draft', 'failed'].includes(next.status);
    const value: DraftGuard = { draftId: next.id, accountId: next.accountId, threadId: next.threadId ?? null, version: guardNext(old?.version ?? 0), fence: old?.fence ?? (kind === 'removed' ? 'removed' : kind === 'discard-intent' ? 'discard-intent' : deliveryOwned ? 'delivery-owned' : null), at: new Date(time).toISOString() };
    this.store.db.prepare('INSERT INTO auto_draft_mutation_guards VALUES(?,?,?) ON CONFLICT(draft_id) DO UPDATE SET account_id=excluded.account_id,data=excluded.data').run(value.draftId, value.accountId, JSON.stringify(value));
  }
  assertNoCurrentDraft(accountId: string, threadId: string) {
    this.account(accountId); const thread = this.store.get<Thread>('thread', threadId); if (!thread || thread.accountId !== accountId || thread.id !== threadId) conflict();
    // Confirmed Sent rows are retained history, not an editable Draft. Every
    // other status remains a blocker; absence never erases independent guards.
    const rows = this.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND json_extract(data,'$.accountId')=? AND json_extract(data,'$.threadId')=?").all(accountId, threadId);
    for (const row of rows) { const draft = JSON.parse(String(row.data)) as Draft; if (draft.status !== 'sent') conflict(); const attempt = draft.deliveryAttemptId ? this.store.get<{ id: string; draftId: string; status: string }>('delivery', draft.deliveryAttemptId) : undefined; if (!attempt || attempt.id !== draft.deliveryAttemptId || attempt.draftId !== draft.id || attempt.status !== 'sent') conflict(); }
    if (this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_draft_links'").get()) {
      const linked = this.store.db.prepare("SELECT l.data FROM provider_draft_links l LEFT JOIN auto_draft_mutation_guards g ON g.draft_id=l.draft_id AND g.account_id=l.account_id WHERE l.account_id=? AND (g.draft_id IS NULL OR json_extract(g.data,'$.threadId')=?)").all(accountId, threadId);
      for (const row of linked) { const link = JSON.parse(String(row.data)) as { state?: string; discardId?: string }; if (!['discarded', 'consumed'].includes(link.state ?? '')) conflict(); }
    }
  }
  capture(accountId: string, threadId: string, versions: Omit<NoTargetBasis, 'kind' | 'threadDraftSetVersion'>): NoTargetBasis {
    this.assertNoCurrentDraft(accountId, threadId); if (![versions.threadInputVersion, versions.replyMetadataVersion, versions.sourceFactsVersion].every(guardHash)) conflict();
    if (versions.threadInputVersion !== threadInputVersion(this.store.required<Thread>('thread', threadId))) conflict();
    return { kind: 'create', ...versions, threadDraftSetVersion: this.version(accountId, threadId) };
  }
  assertBasis(accountId: string, threadId: string, basis: NoTargetBasis) { this.assertNoCurrentDraft(accountId, threadId); if (this.version(accountId, threadId) !== basis.threadDraftSetVersion || basis.threadInputVersion !== threadInputVersion(this.store.required<Thread>('thread', threadId))) conflict(); }
  close() { this.unregister(); }
}
