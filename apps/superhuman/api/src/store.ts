import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Account, Thread, Draft, Label, Preferences, Attachment, DeliveryAttempt, ThreadListOptions, ContactSuggestionOptions, ContactContextOptions } from './types.ts';
import { HttpError } from './types.ts';
import { plainTextFromHtml, plainTextToHtml, sanitizeDraftHtml } from './rich-text.ts';
import { createSearchMatcher, threadHasFolder as hasFolder } from './search.ts';
import { initializeThreadSummaries, listThreadSummaries } from './thread-list.ts';
import { initializeRecipientContacts, recipientSuggestions, refreshRecipientContacts } from './contacts.ts';
import { parseOutgoingRecipientHeaders } from './outgoing-recipients.ts';
import { initializeContactContext, contactContext } from './contact-context.ts';

export type DeliveryContext = { artifactOperationId?: string; reconciliation?: boolean; recovery?: boolean };
export type DeliveryHooks = { claim: (draft: Draft, attempt: DeliveryAttempt, context: DeliveryContext) => void; complete: (draft: Draft, attempt: DeliveryAttempt, context: DeliveryContext) => void; unknown: (draft: Draft, context: DeliveryContext) => void };
export class Store {
  deliveryHooks?: DeliveryHooks;
  private deliveryWriteDepth = 0;
  private putDeliveryDraft(draft: Draft): Draft { this.deliveryWriteDepth++; try { return this.put('draft', draft.id, draft); } finally { this.deliveryWriteDepth--; } }

  artifactDeliveryId(draftId: string): string | undefined { if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_draft_sends'").get()) return undefined; const row = this.db.prepare("SELECT id FROM ai_draft_sends WHERE draft_id=? AND state<>'cancelled'").get(draftId); return row ? String(row.id) : undefined; }
  private requireDeliveryHook(draft: Draft) { const linked = this.artifactDeliveryId(draft.id); if (linked && linked !== draft.artifactSendId) throw new HttpError(409, 'The immutable artifact link changed', 'artifact_delivery_locked'); if (draft.artifactSendId && !this.deliveryHooks) throw new HttpError(409, 'This delivery requires its durable artifact owner', 'artifact_delivery_locked'); }
  private assertDraftMutable(draft: Draft) { if (draft.artifactSendId || this.artifactDeliveryId(draft.id)) throw new HttpError(409, 'A reviewed artifact delivery cannot be edited or reused', 'artifact_delivery_locked'); }

  db: DatabaseSync;
  constructor(path: string, seed = true) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS secrets(account_id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS undo(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,data TEXT NOT NULL,expires INTEGER NOT NULL,after_data TEXT);
      CREATE TABLE IF NOT EXISTS draft_attachments(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,data BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_account_lookup ON records(json_extract(data,'$.accountId')) WHERE kind='thread';
      CREATE INDEX IF NOT EXISTS thread_snooze_candidates ON records(json_extract(data,'$.snoozedUntil'))
        WHERE kind='thread' AND json_type(data,'$.snoozedUntil')='text' AND json_extract(data,'$.snoozedUntil')<>'';`);
    if (!this.db.prepare('PRAGMA table_info(undo)').all().some(row => row.name === 'after_data')) this.db.exec('ALTER TABLE undo ADD COLUMN after_data TEXT');
    if (!this.db.prepare('PRAGMA table_info(oauth_states)').all().some(row => row.name === 'context')) this.db.exec('ALTER TABLE oauth_states ADD COLUMN context TEXT');
    initializeThreadSummaries(this.db);
    initializeRecipientContacts(this.db);
    initializeContactContext(this.db);
    if (seed && this.list<Account>('account').length === 0) this.seed();
  }
  list<T>(kind: string): T[] { return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r => JSON.parse(String(r.data))); }
  get<T>(kind: string, id: string): T | undefined { const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(String(row.data)) : undefined; }
  put<T>(kind: string, id: string, data: T): T {
    if (kind === 'draft' && !this.deliveryWriteDepth) { const old = this.get<Draft>('draft', id); if (old) this.assertDraftMutable(old); }
    if (kind === 'thread') this.db.exec('SAVEPOINT recipient_record_write');
    try {
      this.db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind, id, JSON.stringify(data));
      if (kind === 'thread') { refreshRecipientContacts(this.db, { threadId: id }); this.db.exec('RELEASE recipient_record_write'); }
      return data;
    } catch (error) { if (kind === 'thread') this.db.exec('ROLLBACK TO recipient_record_write; RELEASE recipient_record_write'); throw error; }
  }
  remove(kind: string, id: string) { if (kind === 'draft') { const draft = this.get<Draft>('draft', id); if (draft) this.assertDraftMutable(draft); } this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  required<T>(kind: string, id: string): T { const row = this.get<T>(kind, id); if (!row) throw new HttpError(404, `${kind} not found`, 'not_found'); return row; }
  preferences(): Preferences { return this.get<Preferences>('preferences', 'global')!; }
  updatePreferences(value: Partial<Preferences>) { return this.put('preferences', 'global', { ...this.preferences(), ...value }); }
  threadSummaries(options: ThreadListOptions) { return listThreadSummaries(this.db, options, (accountId, query) => new Set(this.threads(accountId, 'all', query).map(thread => thread.id))); }
  recipientSuggestions(options: ContactSuggestionOptions) { return recipientSuggestions(this.db, options); }
  contactContext(options: ContactContextOptions) { return contactContext(this.db, options); }
  threads(accountId?: string, folder = 'inbox', query = '') {
    query = query.trim();
    let result = accountId
      ? this.db.prepare("SELECT data FROM records WHERE kind='thread' AND json_extract(data,'$.accountId')=? ORDER BY rowid").all(accountId).map(row => JSON.parse(String(row.data)) as Thread)
      : this.list<Thread>('thread');
    if (!query) result = result.filter(t => folder === 'all' ? t.folder !== 'trash' && t.folder !== 'spam' : folder === 'starred' ? t.starred : folder === 'snoozed' ? !!t.snoozedUntil : folder === 'important' ? hasFolder(t, 'inbox') && t.important && !t.snoozedUntil : folder === 'other' ? hasFolder(t, 'inbox') && !t.important && !t.snoozedUntil : folder.startsWith('label:') ? t.labels.includes(folder.slice(6)) : hasFolder(t, folder) && !t.snoozedUntil);
    if (query) {
      result = result.filter(createSearchMatcher(query, { labels: this.list<Label>('label'), accountEmail: id => this.get<Account>('account', id)?.email }));
    }
    return result.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
  prepareAction(id: string, action: string, value: { until?: string; labelId?: string } = {}) {
    const before = this.required<Thread>('thread', id);
    const thread: Thread = structuredClone(before);
    switch (action) {
      case 'archive': thread.folder = 'done'; delete thread.snoozedUntil; break;
      case 'unarchive': thread.folder = 'inbox'; delete thread.snoozedUntil; delete thread.snoozeRetryAt; delete thread.snoozeError; break;
      case 'trash': thread.folder = 'trash'; delete thread.snoozedUntil; break;
      case 'spam': thread.folder = 'spam'; delete thread.snoozedUntil; break;
      case 'star': thread.starred = true; break;
      case 'unstar': thread.starred = false; break;
      case 'read': thread.unread = false; break;
      case 'unread': thread.unread = true; break;
      case 'mute': thread.muted = !thread.muted; break;
      case 'snooze': if (!value.until || !Number.isFinite(Date.parse(value.until)) || Date.parse(value.until) <= Date.now()) throw new HttpError(400, 'Snooze requires a future ISO date'); thread.snoozedUntil = new Date(value.until).toISOString(); break;
      case 'label': if (!value.labelId) throw new HttpError(400, 'labelId is required'); if (this.required<Label>('label', value.labelId).accountId !== thread.accountId) throw new HttpError(400, 'Label belongs to a different account'); thread.labels = thread.labels.includes(value.labelId) ? thread.labels.filter(x => x !== value.labelId) : [...thread.labels, value.labelId]; break;
      default: throw new HttpError(400, 'Unknown thread action');
    }
    if (thread.providerLabels) {
      const labels = new Set(thread.providerLabels);
      if (action === 'archive') labels.delete('INBOX');
      if (action === 'unarchive') { labels.add('INBOX'); labels.delete('TRASH'); labels.delete('SPAM'); }
      if (action === 'trash' || action === 'spam') { labels.delete('INBOX'); labels.add(action === 'trash' ? 'TRASH' : 'SPAM'); }
      if (action === 'star' || action === 'unstar') action === 'star' ? labels.add('STARRED') : labels.delete('STARRED');
      if (action === 'read' || action === 'unread') action === 'unread' ? labels.add('UNREAD') : labels.delete('UNREAD');
      if (action === 'label' && value.labelId) { const providerId = this.required<Label>('label', value.labelId).providerId; if (providerId) thread.labels.includes(value.labelId) ? labels.add(providerId) : labels.delete(providerId); }
      thread.providerLabels = [...labels];
    }
    return { before, thread };
  }
  commitAction(before: Thread, thread: Thread) {
    const undoId = randomUUID();
    this.db.exec('BEGIN');
    try { this.put('thread', thread.id, thread); this.db.prepare('INSERT INTO undo(id,thread_id,data,expires,after_data) VALUES(?,?,?,?,?)').run(undoId, thread.id, JSON.stringify(before), Date.now() + 300_000, JSON.stringify(thread)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { thread, undoId };
  }
  pendingUndo(id: string): Thread {
    const row = this.db.prepare('SELECT data,expires,after_data FROM undo WHERE id=?').get(id);
    if (!row || Number(row.expires) < Date.now()) throw new HttpError(410, 'Undo expired', 'undo_expired');
    const before: Thread = JSON.parse(String(row.data));
    if (!row.after_data) throw new HttpError(409, 'This older undo record cannot safely be restored', 'undo_conflict');
    const after: Thread = JSON.parse(String(row.after_data)); const current = this.required<Thread>('thread', before.id);
    const next = { ...current } as Thread & Record<string, unknown>;
    // Restore only fields changed by this operation, preserving later unrelated
    // mutations and refusing to overwrite a newer mutation of the same field.
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const prior = (before as Thread & Record<string, unknown>)[key]; const changed = (after as Thread & Record<string, unknown>)[key];
      if ((key === 'labels' || key === 'providerLabels') && Array.isArray(prior) && Array.isArray(changed)) {
        const currentLabels = new Set((current as Thread & Record<string, unknown>)[key] as string[] ?? []);
        const added = changed.filter(label => !prior.includes(label)); const removed = prior.filter(label => !changed.includes(label));
        if (added.some(label => !currentLabels.has(label)) || removed.some(label => currentLabels.has(label))) throw new HttpError(409, 'These labels changed since the action', 'undo_conflict');
        added.forEach(label => currentLabels.delete(label)); removed.forEach(label => currentLabels.add(label)); next[key] = [...currentLabels]; continue;
      }
      if (JSON.stringify(prior) !== JSON.stringify(changed)) {
        if (JSON.stringify((current as Thread & Record<string, unknown>)[key]) !== JSON.stringify(changed)) throw new HttpError(409, 'This conversation changed since the action; undo was not applied', 'undo_conflict');
        if (prior === undefined) delete next[key]; else next[key] = prior;
      }
    }
    return next;
  }
  commitUndo(id: string, thread: Thread) { this.db.exec('BEGIN'); try { this.put('thread', thread.id, thread); this.db.prepare('DELETE FROM undo WHERE id=?').run(id); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; } return thread; }
  dueSnoozes(now = Date.now(), limit = 10) {
    // ORDER BY rowid can otherwise tempt SQLite to scan its broad kind index;
    // force the matching partial index so ordinary mail is never visited here.
    const candidates = this.db.prepare("SELECT data FROM records INDEXED BY thread_snooze_candidates WHERE kind='thread' AND json_type(data,'$.snoozedUntil')='text' AND json_extract(data,'$.snoozedUntil')<>'' ORDER BY rowid").all().map(row => JSON.parse(String(row.data)) as Thread);
    // Do not lexically compare timestamps in SQL: existing offset/noncanonical
    // values and retry times retain the established JavaScript Date.parse rules.
    return candidates.filter(thread => Date.parse(thread.snoozedUntil!) <= now && (!thread.snoozeRetryAt || Date.parse(thread.snoozeRetryAt) <= now)).sort((left, right) => left.snoozedUntil!.localeCompare(right.snoozedUntil!)).slice(0, limit);
  }
  wakeSnoozes(now = Date.now()) {
    // Real providers must wake through the server's account queue before local
    // state changes. This synchronous helper remains available for demo fixtures.
    for (const thread of this.dueSnoozes(now, 100)) if (this.get<Account>('account', thread.accountId)?.provider === 'demo') { const { thread: awake } = this.prepareAction(thread.id, 'unarchive'); this.put('thread', thread.id, awake); }
  }
  saveDraft(input: Partial<Draft>) {
    const old = input.id ? this.get<Draft>('draft', input.id) : undefined;
    const accountId = input.accountId ?? old?.accountId ?? this.preferences().activeAccountId;
    this.required<Account>('account', accountId);
    if (old) this.assertDraftMutable(old);
    if (old && ['sent', 'sending', 'delivery_unknown'].includes(old.status)) throw new HttpError(409, old.status === 'sent' ? 'Sent drafts cannot be changed' : 'Delivery must be reconciled before this draft can change', old.status === 'sent' ? 'already_sent' : 'delivery_requires_reconciliation');
    const content = { ...input };
    if (input.html !== undefined) { content.html = sanitizeDraftHtml(input.html); if (input.body === undefined) content.body = plainTextFromHtml(content.html); }
    else if (input.body !== undefined) content.html = undefined;
    const draft: Draft = { id: input.id ?? randomUUID(), accountId, to: '', cc: '', bcc: '', subject: '', body: '', attachments: [], status: 'draft', ...old, ...content, updatedAt: new Date().toISOString() };
    return this.put('draft', draft.id, draft);
  }
  restoreCancelledArtifactDraft(id: string, operationId: string, at: string): Draft {
    if (!this.db.isTransaction) throw new Error('Cancelled restoration requires its operation transaction');
    const row = this.db.prepare("SELECT account_id FROM ai_draft_sends WHERE id=? AND draft_id=? AND state='cancelled' AND json_extract(data,'$.deliveryAttemptId') IS NULL").get(operationId,id);
    const draftRow=row?this.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(id,String(row.account_id)):undefined;
    if(!draftRow)throw new HttpError(409,'The owned cancelled draft is unavailable','ai_draft_send_not_cancellable');
    const draft=JSON.parse(String(draftRow.data))as Draft;
    if(!row||draft.accountId!==row.account_id||draft.artifactSendId!==operationId||draft.status!=='send_queued'||draft.deliveryAttemptId)throw new HttpError(409,'This draft can no longer be restored by Undo','ai_draft_send_not_cancellable');
    const restored={...draft,status:'draft' as const,artifactSendId:undefined,updatedAt:at,error:undefined};return this.putDeliveryDraft(restored);
  }
  beginDelivery(id: string, context: DeliveryContext = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const draft = this.required<Draft>('draft', id);
      if (draft.status === 'sent') throw new HttpError(409, 'Message was already sent', 'already_sent');
      if (draft.status === 'sending' || draft.status === 'delivery_unknown') throw new HttpError(409, 'Delivery outcome must be reconciled; this message will not be resent automatically', 'delivery_requires_reconciliation');
      this.requireDeliveryHook(draft);
      parseOutgoingRecipientHeaders(draft);
      const attemptId = randomUUID(); const messageId = `<rea-${attemptId}@reconstruction.invalid>`; const marker = randomBytes(24).toString('base64url');
      const attempt: DeliveryAttempt = { id: attemptId, draftId: id, status: 'dispatching', messageId, marker, startedAt: new Date().toISOString() };
      const pending: Draft = { ...draft, status: 'sending', deliveryAttemptId: attemptId, deliveryMessageId: messageId, deliveryMarker: marker, providerMessageId: undefined, providerInternetMessageId: undefined, deliveryMarkerVerified: undefined, error: undefined, updatedAt: attempt.startedAt };
      if (draft.artifactSendId) this.deliveryHooks!.claim(pending, attempt, context);
      this.put('delivery', attemptId, attempt); this.putDeliveryDraft(pending); this.db.exec('COMMIT');
      return pending;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  completeDelivery(id: string, providerMessageId?: string, providerInternetMessageId?: string, markerVerified?: boolean, context: DeliveryContext = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const draft = this.required<Draft>('draft', id); if (!draft.deliveryAttemptId) throw new HttpError(409, 'No delivery attempt exists');
      const attempt = this.required<DeliveryAttempt>('delivery', draft.deliveryAttemptId); const completedAt = new Date().toISOString();
      this.put('delivery', attempt.id, { ...attempt, status: 'sent', providerMessageId, providerInternetMessageId, markerVerified, completedAt, error: undefined });
      const sent: Draft = { ...draft, status: 'sent', providerMessageId, providerInternetMessageId, deliveryMarkerVerified: markerVerified, scheduledAt: undefined, error: undefined, updatedAt: completedAt };
      this.requireDeliveryHook(draft); if (draft.artifactSendId) this.deliveryHooks!.complete(sent, { ...attempt, status: 'sent', providerMessageId }, context);
      this.putDeliveryDraft(sent); this.db.exec('COMMIT'); return sent;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recordDeliveryMetadata(id: string, attemptId: string, providerMessageId: string, providerInternetMessageId: string | undefined, markerVerified: boolean) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const draft = this.required<Draft>('draft', id); const attempt = this.required<DeliveryAttempt>('delivery', attemptId); if (draft.status !== 'sent' || draft.deliveryAttemptId !== attemptId || attempt.draftId !== id || attempt.status !== 'sent' || draft.providerMessageId !== providerMessageId || attempt.providerMessageId !== providerMessageId) throw new HttpError(409, 'Delivery identity changed; metadata was not applied', 'delivery_identity_conflict'); this.put('delivery', attemptId, { ...attempt, providerInternetMessageId, markerVerified }); const updated = { ...draft, providerInternetMessageId, deliveryMarkerVerified: markerVerified }; this.putDeliveryDraft(updated); this.db.exec('COMMIT'); return updated; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  unknownDelivery(id: string, reason: string, context: DeliveryContext = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Re-read under the write lock: another process may have committed an ACK
      // since its caller observed an in-flight attempt. Never downgrade sent.
      const draft = this.required<Draft>('draft', id);
      if (draft.status === 'sent') { this.db.exec('COMMIT'); return draft; }
      if (draft.deliveryAttemptId) { const attempt = this.required<DeliveryAttempt>('delivery', draft.deliveryAttemptId); this.put('delivery', attempt.id, { ...attempt, status: 'unknown', error: reason }); }
      const unknown: Draft = { ...draft, status: 'delivery_unknown', error: reason, updatedAt: new Date().toISOString() };
      if (draft.artifactSendId && !context.recovery) { this.requireDeliveryHook(draft); this.deliveryHooks!.unknown(unknown, context); }
      this.putDeliveryDraft(unknown); this.db.exec('COMMIT'); return unknown;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recoverInterruptedDeliveries() { for (const draft of this.list<Draft>('draft')) if (draft.status === 'sending') this.unknownDelivery(draft.id, 'The process stopped during delivery. Check the provider and reconcile this attempt before any further action.', { recovery: true }); }
  addAttachment(draftId: string, input: { name: string; mimeType: string; data: string }) {
    const draft = this.required<Draft>('draft', draftId);
    if (draft.status !== 'draft' && draft.status !== 'failed') throw new HttpError(409, 'Cancel scheduling before editing attachments');
    if (!input.name || input.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(input.name)) throw new HttpError(400, 'Attachment name is invalid');
    if (!/^[a-z\d][a-z\d.+-]*\/[a-z\d][a-z\d.+-]*$/i.test(input.mimeType) || input.mimeType.length > 150) throw new HttpError(400, 'Attachment MIME type is invalid');
    if (input.data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw new HttpError(413, 'Each attachment must be 10 MiB or smaller');
    if (input.data.length % 4 || /[^a-z\d+/]/i.test(input.data.replace(/={1,2}$/, ''))) throw new HttpError(400, 'Attachment data must be standard base64');
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length > 10 * 1024 * 1024) throw new HttpError(413, 'Each attachment must be 10 MiB or smaller');
    const attachments = draft.attachments ?? [];
    if (attachments.length >= 20 || attachments.reduce((n, item) => n + item.size, 0) + bytes.length > 25 * 1024 * 1024) throw new HttpError(413, 'A draft allows at most 20 attachments and 25 MiB total');
    const attachment: Attachment = { id: randomUUID(), name: input.name, mimeType: input.mimeType.toLowerCase(), size: bytes.length };
    this.db.exec('BEGIN');
    try { this.db.prepare('INSERT INTO draft_attachments VALUES(?,?,?,?,?,?)').run(attachment.id, draftId, attachment.name, attachment.mimeType, attachment.size, bytes); this.saveDraft({ id: draftId, attachments: [...attachments, attachment] }); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { draft: this.required<Draft>('draft', draftId), attachment };
  }
  attachmentBytes(draftId: string, attachmentId: string) { const row = this.db.prepare('SELECT data FROM draft_attachments WHERE id=? AND draft_id=?').get(attachmentId, draftId); if (!row) throw new HttpError(404, 'Attachment not found'); return Buffer.from(row.data as Uint8Array); }
  removeAttachment(draftId: string, attachmentId: string) { const draft = this.required<Draft>('draft', draftId); if (draft.status !== 'draft' && draft.status !== 'failed') throw new HttpError(409, 'Cancel scheduling before editing attachments'); this.attachmentBytes(draftId, attachmentId); this.db.exec('BEGIN'); try { this.db.prepare('DELETE FROM draft_attachments WHERE id=? AND draft_id=?').run(attachmentId, draftId); const next = this.saveDraft({ id: draftId, attachments: (draft.attachments ?? []).filter(item => item.id !== attachmentId) }); this.db.exec('COMMIT'); return next; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  deleteDraft(id: string) { this.assertDraftMutable(this.required<Draft>('draft', id)); this.db.exec('BEGIN'); try { this.db.prepare('DELETE FROM draft_attachments WHERE draft_id=?').run(id); this.remove('draft', id); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  replyDraft(threadId: string, mode: 'reply' | 'replyAll' | 'forward') {
    const thread = this.required<Thread>('thread', threadId); const account = this.required<Account>('account', thread.accountId); const message = thread.messages.at(-1); if (!message) throw new HttpError(400, 'Conversation has no messages');
    const own = account.email.toLowerCase(); const unique = (people: { name: string; email: string }[]) => [...new Map(people.filter(p => p.email.toLowerCase() !== own).map(p => [p.email.toLowerCase(), p.email])).values()];
    const primary = unique(message.sender.email.toLowerCase() === own ? message.to : [message.sender]);
    const to = mode === 'forward' ? [] : mode === 'reply' ? primary : unique([...(message.sender.email.toLowerCase() === own ? [] : [message.sender]), ...message.to]);
    const cc = mode === 'replyAll' ? unique(message.cc ?? []).filter(email => !to.some(p => p.toLowerCase() === email.toLowerCase())) : [];
    const forwardHeading = `\n\n---------- Forwarded message ----------\nFrom: ${message.sender.name} <${message.sender.email}>\nDate: ${message.date}\nSubject: ${thread.subject}\nTo: ${message.to.map(p => p.email).join(', ')}`;
    const forwardText = mode === 'forward' ? message.text || (message.html ? plainTextFromHtml(sanitizeDraftHtml(message.html)) : '') : '';
    const body = mode === 'forward' ? `${forwardHeading}\n\n${forwardText}` : '';
    const html = mode === 'forward' && message.html ? `${plainTextToHtml(forwardHeading)}<blockquote>${sanitizeDraftHtml(message.html)}</blockquote>` : undefined;
    return this.saveDraft({ accountId: account.id, ...(mode !== 'forward' ? { threadId } : {}), to: to.join(', '), cc: cc.join(', '), subject: `${mode === 'forward' ? /^fwd?:/i.test(thread.subject) ? '' : 'Fwd: ' : /^re:/i.test(thread.subject) ? '' : 'Re: '}${thread.subject}`, body, ...(html !== undefined ? { html } : {}) });
  }
  seed() {
    const account: Account = { id: 'demo', email: 'alex@demo.local', name: 'Alex Morgan', provider: 'demo', color: '#6e65cc' };
    this.put('account', account.id, account);
    this.put<Preferences>('preferences', 'global', { theme: 'light', activeAccountId: account.id, signature: 'Alex', defaultRemind: 'tomorrow', splitInbox: ['Important', 'Other'], 'Auto Advance': true, 'Hide Empty Split Inboxes': false, 'Backtick as Escape': false, 'Show Sender Full Names': true, snippets: [{ id: 'thanks', title: 'Thanks', body: 'Thanks for the update! I’ll take a look and get back to you shortly.' }, { id: 'intro', title: 'Introduction', body: 'Great to meet you. I’d love to learn more about what you’re working on.' }] });
    for (const [id, name, color] of [['work', 'Work', '#8c85df'], ['personal', 'Personal', '#6bba9d'], ['finance', 'Finance', '#d8aa68']]) this.put<Label>('label', id, { id, accountId: account.id, name, color });
    const examples = [
      ['Jordan Lee', 'jordan@example.test', 'A few thoughts on the launch', 'Hey Alex, I’ve been thinking about the launch timeline. Here’s a revised plan for next week. Would love your thoughts before we share with the team.', '10:42', true],
      ['Maya Chen', 'maya@example.test', 'Design review — Thursday', 'The latest designs are ready for your feedback. I’ve put together a few options for the dashboard and would love to walk you through them.', '10:18', true],
      ['Sam Rivera', 'sam@example.test', 'Re: Let’s grab coffee', 'Thursday works perfectly! There’s a great little place on Market Street. How does 10am sound?', '09:54', false],
      ['Linear', 'notifications@linear.example.test', 'Your weekly project update', 'Here’s what your team shipped this week. 12 issues completed, 3 projects moved forward, and a few new ideas to explore.', '09:21', false],
      ['Priya Patel', 'priya@example.test', 'Q4 planning notes', 'Sharing the notes from our planning session. The priorities are clear — now we just need to pick a date to kick things off.', '08:47', true],
      ['Taylor Brooks', 'taylor@example.test', 'Photos from the weekend', 'Such a great weekend! Here are the photos I promised. We should do this again soon.', '08:12', false],
      ['Notion', 'team@notion.example.test', 'A little inspiration for your workspace', 'A few thoughtful ways to organize your projects, ideas, and everything in between.', '07:55', false],
      ['Chris Park', 'chris@example.test', 'Quick question about the proposal', 'One quick question before I send the proposal over. Do you want to include the additional research phase in the initial scope?', '07:30', true],
      ['Morgan Ellis', 'morgan@example.test', 'Following up on our conversation', 'It was great chatting yesterday. I’m excited about the possibility of working together and wanted to share a few more details.', '06:40', false],
      ['Figma', 'hello@figma.example.test', 'Your team’s latest files', 'Catch up on the latest files and conversations from your team. A few updates are waiting for you.', '06:15', false],
      ['Jamie Wright', 'jamie@example.test', 'Dinner next week?', 'Are you around next week? It’s been too long since we caught up. Let me know what evening works best for you.', '05:50', false],
      ['Dev Team', 'dev@example.test', 'Build is ready for review', 'The new build is up on staging. All the changes from yesterday’s review are included, and the tests are passing.', '05:20', true],
    ] as const;
    examples.forEach(([name, email, subject, text, time, unread], i) => {
      const sender = { name, email }; const id = `demo-thread-${i + 1}`;
      const date = `2026-10-27T${time}:00.000Z`;
      this.put<Thread>('thread', id, { id, accountId: account.id, subject, snippet: text, sender, participants: [sender, { name: account.name, email: account.email }], lastMessageAt: date, unread, starred: i === 1, important: i !== 3 && i !== 6 && i !== 9, folder: 'inbox', labels: i % 3 === 0 ? ['work'] : [], messages: [{ id: `message-${i}`, sender, to: [{ name: account.name, email: account.email }], date, text: `Hi Alex,\n\n${text}\n\nBest,\n${name}`, attachments: i === 5 ? [{ id: 'demo-attachment', name: 'weekend-notes.txt', mimeType: 'text/plain', size: 88 }] : [] }] });
    });
    const archived = structuredClone(this.required<Thread>('thread', 'demo-thread-1')); archived.id = 'demo-archived'; archived.subject = 'Last week’s meeting notes'; archived.folder = 'done'; archived.unread = false; this.put('thread', archived.id, archived);
  }
  close() { this.db.close(); }
}
