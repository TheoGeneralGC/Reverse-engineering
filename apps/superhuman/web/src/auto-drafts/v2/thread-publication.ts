import {AUTO_DRAFT_REPLY_OUTPUT_BYTES,autoDraftQuotedBodyParts} from '../../../../api/src/auto-drafts-reply-policy.ts';
import { api, type Draft, type Thread } from '../../api.ts';
import { stable, type Sha256 } from '../../../../api/src/auto-drafts-contract.ts';
import { parseThreadPublication, parseTargetResolution, type ThreadPublication } from '../../../../api/src/auto-drafts-generation-contract.ts';
import { browserDigest, type Request } from './model.ts';
import type { Navigate } from './activity.ts';

export type InlineState = { publication: ThreadPublication | null; draft: Draft | null; parts:Readonly<{reply:string;quote:string}>|null; pending: 'loading' | 'opening' | null; hidden: boolean; error: string };
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const sourceContent = (m: Thread['messages'][number]) => { const { providerLabels: _labels, trackingRead: _read, ...content } = m; return content; };

/** One selected conversation only. This model never scans generation history,
 * writes Mail, creates a draft, or treats cached association as placement proof. */
export class AutoDraftThreadModel {
  private state: InlineState = { publication: null, draft: null, parts:null, pending: null, hidden: false, error: '' };
  private listeners = new Set<() => void>(); private active = false; private epoch = 0; private read = 0; private abort?: AbortController;
  private request: Request; private digest: Sha256; private isCurrent: () => boolean;
  readonly accountId: string; readonly thread: Thread;
  constructor(options: { accountId: string; thread: Thread; request?: Request; digest?: Sha256; isCurrent?: () => boolean }) {
    this.accountId = options.accountId; this.thread = structuredClone(options.thread); this.request = options.request || api; this.digest = options.digest || browserDigest; this.isCurrent = options.isCurrent || (() => true);
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  activate() { this.active = true; this.epoch++; }
  suspend() { this.active = false; this.epoch++; this.read++; this.abort?.abort(); this.state = { ...this.state, pending: null }; }
  dispose() { this.suspend(); this.listeners.clear(); }
  private current(epoch = this.epoch, read = this.read) { return this.active && this.isCurrent() && epoch === this.epoch && read === this.read; }
  private emit(patch: Partial<InlineState>) { if (this.current()) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  hide() { if (!this.state.pending) this.emit({ hidden: true }); }
  private get(path: string) { return this.request(path, undefined, 'GET', { signal: this.abort?.signal }); }
  private async binding() { return parseThreadPublication(await this.get('/auto-drafts/v2/thread-publication?accountId=' + encodeURIComponent(this.accountId) + '&threadId=' + encodeURIComponent(this.thread.id)), { accountId: this.accountId, threadId: this.thread.id }); }
  private async target(p: ThreadPublication) { return parseTargetResolution(await this.get('/auto-drafts/v2/targets/' + encodeURIComponent(p.targetRef) + '?accountId=' + encodeURIComponent(this.accountId) + '&expectedTargetVersion=' + p.targetVersion), { accountId: this.accountId, targetRef: p.targetRef, expectedTargetVersion: p.targetVersion }); }
  private async unchanged(p: ThreadPublication, draftId: string, current: () => boolean) {
    if (!current()) return false;
    const b = await this.binding(); if (!current() || b.availability !== 'available' || !same(b.publication, p)) return false;
    const t = await this.target(p); return current() && t.availability === 'available' && t.target.kind === 'draft' && t.target.draftId === draftId;
  }
  async load(): Promise<boolean> {
    if (!this.current() || this.state.pending || this.thread.accountId !== this.accountId) return false;
    const epoch = this.epoch, read = ++this.read; this.abort?.abort(); this.abort = new AbortController();
    this.emit({ pending: 'loading', publication: null, draft: null, parts:null, hidden: false, error: '' });
    try {
      const first = await this.binding(); if (!this.current(epoch, read)) return false;
      if (first.availability !== 'available') { this.emit({ pending: null }); return true; }
      const p = first.publication, raw = await this.get('/threads/' + encodeURIComponent(this.thread.id)) as { thread?: Thread };
      if (!this.current(epoch, read)) return false;
      const mail = raw.thread, displayed = this.thread.messages.filter(m => m.id === p.sourceMessageId), messages = mail?.messages?.filter(m => m.id === p.sourceMessageId);
      if (!mail || mail.id !== this.thread.id || mail.accountId !== this.accountId || displayed.length !== 1 || messages?.length !== 1 || !same(sourceContent(messages[0]), sourceContent(displayed[0]))) throw Error('Source changed');
      const second = await this.binding(); if (!this.current(epoch, read)) return false;
      if (second.availability !== 'available' || !same(second.publication, p)) throw Error('Binding changed');
      const target = await this.target(p); if (!this.current(epoch, read)) return false;
      if (target.availability !== 'available' || target.target.kind !== 'draft') throw Error('Target unavailable');
      const result = await this.get('/drafts/' + encodeURIComponent(target.target.draftId)) as { draft?: Draft; deliveryPending?: boolean };
      if (!this.current(epoch, read)) return false;
      const d = result.draft;
      if (!d || d.id !== target.target.draftId || d.accountId !== this.accountId || d.threadId !== this.thread.id || result.deliveryPending || !['draft', 'failed'].includes(d.status) || [d.to, d.cc, d.bcc, d.subject, d.body, d.html].some(v => typeof v !== 'string') || !Array.isArray(d.attachments) || d.attachments.length !== 0 || [d.body, d.html!].some(text => new TextEncoder().encode(text).length > AUTO_DRAFT_REPLY_OUTPUT_BYTES)) throw Error('Draft unavailable');
      const contentHash = await this.digest(stable({ to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body, html: d.html, attachments: d.attachments }));
      if (!this.current(epoch, read)) return false;
      if (contentHash !== p.contentHash || !await this.unchanged(p, d.id, () => this.current(epoch, read)) || !this.current(epoch, read)) throw Error('Draft changed');
      const parts=p.quotedBody?autoDraftQuotedBodyParts(d.body,p.quotedBody.quoteStartUtf8):null;
      this.emit({ pending: null, publication: p, draft: structuredClone(d),parts }); return true;
    } catch { if (this.current(epoch, read)) this.emit({ pending: null, publication: null, draft: null, parts:null, error: '' }); return false; }
  }
  async open(navigate?: Navigate): Promise<boolean> {
    const { publication: p, draft } = this.state;
    if (!this.current() || this.state.pending || this.state.hidden || !p || !draft || !navigate) return false;
    const epoch = this.epoch, read = ++this.read; this.abort?.abort(); this.abort = new AbortController(); const current = () => this.current(epoch, read);
    this.emit({ pending: 'opening', error: '' });
    try {
      if (!await this.unchanged(p, draft.id, current) || !current()) throw Error('Target changed');
      const revalidate = async () => await this.unchanged(p, draft.id, current) && current();
      const opened = await navigate({ accountId: this.accountId, kind: 'draft', draftId: draft.id }, current, revalidate);
      if (!current()) return false;
      this.emit({ pending: null, error: opened ? '' : 'The exact auto draft could not be opened. Your current work is retained.' }); return opened;
    } catch { if (current()) this.emit({ pending: null, publication: null, draft: null, parts:null, error: '' }); return false; }
  }
}
