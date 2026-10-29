import { api } from '../../api.ts';
import { POLICY, parseGenerationPage, parseGenerationById, parseSourceResolution, parseTargetResolution, type Generation, type GenerationPage } from '../../../../api/src/auto-drafts-generation-contract.ts';
import type { Request } from './model.ts';
export type MailTarget = { accountId: string } & ({ kind: 'thread'; threadId: string } | { kind: 'draft'; draftId: string });
export type Navigate = (target: MailTarget, isCurrent: () => boolean, revalidate: () => Promise<boolean>) => Promise<boolean>;
type State = { records: Generation[]; page: GenerationPage | null; pending: 'loading' | 'more' | 'opening' | null; error: string; notice: string };
export class AutoDraftsActivityModel {
  private state: State = { records: [], page: null, pending: null, error: '', notice: '' };
  private active = false; private epoch = 0; private read = 0; private abort?: AbortController;
  private listeners = new Set<() => void>(); private known = new Map<string, Generation>();
  readonly accountId: string; private request: Request; private isCurrent: () => boolean;
  constructor(options: { accountId: string; request?: Request; isCurrent?: () => boolean }) { this.accountId = options.accountId; this.request = options.request || api; this.isCurrent = options.isCurrent || (() => true); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  activate() { this.active = true; this.epoch++; }
  suspend() { this.active = false; this.epoch++; this.read++; this.abort?.abort(); this.state = { ...this.state, pending: null }; }
  dispose() { this.suspend(); this.listeners.clear(); }
  private current(epoch = this.epoch, read = this.read) { return this.active && this.isCurrent() && epoch === this.epoch && read === this.read; }
  private emit(patch: Partial<State>) { if (this.current()) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  async load(more = false): Promise<boolean> {
    if (!this.current() || this.state.pending || more && (!this.state.page?.hasMore || this.state.records.length >= 200)) return false;
    const prior = this.state.page, records = this.state.records, epoch = this.epoch, read = ++this.read;
    this.abort?.abort(); this.abort = new AbortController(); this.emit({ pending: more ? 'more' : 'loading', error: '', notice: '' });
    try {
      const cursor = more ? prior!.nextCursor : null;
      const raw = await this.request('/auto-drafts/v2/generations?accountId=' + encodeURIComponent(this.accountId) + '&limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), undefined, 'GET', { signal: this.abort.signal });
      const page = parseGenerationPage(raw, { accountId: this.accountId, limit: 20, ...(more ? { throughOrdinal: prior!.throughOrdinal, beforeOrdinal: records.at(-1)!.ordinal, requestCursor: cursor, seenIds: records.map(g => g.id) } : {}) });
      const checked = page.records.map(g => parseGenerationById(g, { accountId: this.accountId, generationId: g.id }, this.known.get(g.id)));
      if (this.known.size + checked.filter(g => !this.known.has(g.id)).length > 1000) throw Error('History budget');
      if (!this.current(epoch, read)) return false;
      for (const g of checked) this.known.set(g.id, g);
      this.emit({ records: more ? [...records, ...checked] : checked, page, pending: null, notice: more && records.length + checked.length >= 200 ? 'This view is limited to 200 recent records.' : '' }); return true;
    } catch { if (this.current(epoch, read)) this.emit({ pending: null, error: 'Drafting activity could not be verified. Your current work is retained.' }); return false; }
  }
  async open(id: string, kind: 'source' | 'draft', navigate?: Navigate): Promise<boolean> {
    if (!this.current() || this.state.pending || !navigate || !this.state.records.some(g => g.id === id)) return false;
    const epoch = this.epoch, read = ++this.read; this.abort?.abort(); this.abort = new AbortController();
    const current = () => this.current(epoch, read); this.emit({ pending: 'opening', error: '', notice: '' });
    try {
      const g = parseGenerationById(await this.request('/auto-drafts/v2/generations/' + encodeURIComponent(id) + '?accountId=' + encodeURIComponent(this.accountId), undefined, 'GET', { signal: this.abort.signal }), { accountId: this.accountId, generationId: id }, this.known.get(id));
      if (!current()) return false;
      const context = kind === 'source' ? { accountId: this.accountId, sourceRef: g.sourceRef, expectedInputVersion: g.inputVersion } : g.publication && { accountId: this.accountId, targetRef: g.publication.targetRef, expectedTargetVersion: g.publication.targetVersion };
      if (!context) throw Error('No publication');
      const route = kind === 'source' ? '/auto-drafts/v2/sources/' + encodeURIComponent(g.sourceRef) + '/target?accountId=' + encodeURIComponent(this.accountId) + '&expectedInputVersion=' + g.inputVersion : '/auto-drafts/v2/targets/' + encodeURIComponent(g.publication!.targetRef) + '?accountId=' + encodeURIComponent(this.accountId) + '&expectedTargetVersion=' + g.publication!.targetVersion;
      const resolve = async () => { const raw = await this.request(route, undefined, 'GET', { signal: this.abort?.signal }); return kind === 'source' ? parseSourceResolution(raw, context as { accountId: string; sourceRef: string; expectedInputVersion: string }) : parseTargetResolution(raw, context as { accountId: string; targetRef: string; expectedTargetVersion: string }); };
      const first = await resolve(); if (!current()) return false;
      if (first.availability !== 'available') { this.emit({ pending: null, notice: 'This exact ' + kind + ' is ' + first.availability + '. Your current work is retained.' }); return false; }
      this.known.set(g.id, g);
      const target: MailTarget = { ...first.target, accountId: this.accountId };
      const revalidate = async () => { const next = await resolve(); return current() && next.availability === 'available' && JSON.stringify(next.target) === JSON.stringify(first.target); };
      const opened = await navigate(target, current, revalidate); if (!current()) return false;
      this.emit({ pending: null, notice: opened ? '' : 'The exact target could not be opened. Your current work is retained.' }); return opened;
    } catch { if (current()) this.emit({ pending: null, error: 'The exact activity target could not be verified. Your current work is retained.' }); return false; }
  }
}
export { POLICY };
