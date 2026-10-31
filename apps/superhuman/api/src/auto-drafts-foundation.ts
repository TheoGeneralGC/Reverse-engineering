import {projectStoredMessages} from './reminder-message-projection.ts';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { HttpError, type Account, type Thread } from './types.ts';
import { AutoDraftMutationGuard, guardHash, guardId, guardNext } from './auto-drafts-mutation-guard.ts';
import { LIMITS, TRANSITIONS, assertGeneration, parseIngressVersion, compareCounters, type FrozenInput, type Generation, type GenerationState, type IngressVersion } from './auto-drafts-generation-contract.ts';

export type FoundationBasis = Pick<FrozenInput, 'accountId' | 'activationId' | 'activationEpoch' | 'preferences' | 'accountVersion' | 'configurationVersion' | 'sourceRef' | 'inputVersion' | 'target'> & { threadId: string };
type Proof = { generation: Generation; acceptanceHash: string; owner: string | null; leaseId: string | null; leaseUntil: number | null; requestHash: string | null };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function fail(code = 'auto_draft_generation_basis_conflict', status = 409): never { throw new HttpError(status, status === 500 ? 'Automatic draft ledger is unavailable' : 'Automatic draft ledger basis changed', code); }
const final = (state: GenerationState) => !['queued', 'claimed', 'dispatch-issued'].includes(state);

/** Internal durable primitives, deliberately without scheduler, transport,
 * preference activation, HTTP projections, generated Draft publication or flags.
 */
export class AutoDraftFoundation {
  private readonly generationObservers=new Set<(generation:Generation)=>void>();
  registerGenerationObserver(observer:(generation:Generation)=>void){this.generationObservers.add(observer);return()=>this.generationObservers.delete(observer)}
  readonly owner = randomUUID();
  readonly guard: AutoDraftMutationGuard;
  private closing = false;
  private sequence = 0;
  readonly store: Store;
  readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store; this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS auto_draft_foundation_clock(id INTEGER PRIMARY KEY CHECK(id=1),stamp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auto_draft_ingress(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,account_version TEXT NOT NULL,source_ref TEXT NOT NULL,input_version TEXT NOT NULL,sequence INTEGER NOT NULL,thread_id TEXT NOT NULL,data TEXT NOT NULL,fingerprint TEXT NOT NULL,UNIQUE(account_id,account_version,source_ref,input_version),UNIQUE(account_id,sequence));
      CREATE TABLE IF NOT EXISTS auto_draft_ingress_proofs(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auto_draft_job_acceptance(id TEXT PRIMARY KEY,data TEXT NOT NULL,integrity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auto_draft_job_keys(account_id TEXT NOT NULL,account_version TEXT NOT NULL,source_ref TEXT NOT NULL,input_version TEXT NOT NULL,job_id TEXT NOT NULL,PRIMARY KEY(account_id,account_version,source_ref,input_version));
      CREATE TABLE IF NOT EXISTS auto_draft_job_ordinals(account_id TEXT PRIMARY KEY,last_ordinal INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auto_draft_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,account_version TEXT NOT NULL,source_ref TEXT NOT NULL,input_version TEXT NOT NULL,revision INTEGER NOT NULL,owner_pid INTEGER,request_utf8 TEXT,proof TEXT NOT NULL,integrity TEXT NOT NULL,UNIQUE(account_id,account_version,source_ref,input_version));
      CREATE INDEX IF NOT EXISTS auto_draft_active_jobs ON auto_draft_jobs(account_id) WHERE json_extract(proof,'$.generation.state') IN('claimed','dispatch-issued');
      CREATE INDEX IF NOT EXISTS auto_draft_queued_jobs ON auto_draft_jobs(account_id) WHERE json_extract(proof,'$.generation.state')='queued';
      CREATE TABLE IF NOT EXISTS auto_draft_job_events(job_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,integrity TEXT NOT NULL,PRIMARY KEY(job_id,revision));`);
    this.guard = new AutoDraftMutationGuard(store, now);
  }
  private transaction<T>(work: (stamp: number) => T): T {
    const nested = this.store.db.isTransaction, point = `auto_draft_unit_${++this.sequence}`;
    this.store.db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
    try {
      const stamp = this.now(), row = this.store.db.prepare('SELECT stamp FROM auto_draft_foundation_clock WHERE id=1').get();
      if (!integer(stamp) || stamp > 8_640_000_000_000_000 || row && (!integer(row.stamp) || stamp < Number(row.stamp))) fail('auto_draft_generation_corrupt', 500);
      const value = work(stamp);
      const committedAt=this.now();if(!integer(committedAt)||committedAt<stamp||committedAt>8_640_000_000_000_000)fail('auto_draft_generation_corrupt',500);
      this.store.db.prepare('INSERT INTO auto_draft_foundation_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET stamp=excluded.stamp').run(committedAt);
      this.store.db.exec(nested ? `RELEASE ${point}` : 'COMMIT'); return value;
    } catch (error) { this.store.db.exec(nested ? `ROLLBACK TO ${point}; RELEASE ${point}` : 'ROLLBACK'); throw error; }
  }
  private account(accountId: string) { const account = this.store.get<Account>('account', accountId); if (!account || account.id !== accountId) fail('auto_draft_generation_not_found', 404);return account; }
  private accountIdentity(accountId:string){const account=this.account(accountId);return hash({id:account.id,provider:account.provider,email:account.email.toLowerCase()})}
  private open() { if (this.closing) fail('auto_draft_generation_stopping', 503); }
  private checkedIngress(raw: IngressVersion): IngressVersion {
    try { return parseIngressVersion(raw,{accountId:raw.accountId,accountVersion:raw.accountVersion}); } catch { return fail('auto_draft_generation_invalid_request',400); }
  }
  /** Caller supplies already-validated provider occurrence metadata. This unit
   * commits Mail/projections plus outbox; it does not infer live eligibility. */
  acceptCommittedIngress(thread:Thread,occurrence:IngressVersion) {
    if(!this.store.db.isTransaction)throw Error('Ingress observation requires the producer transaction');
    if(JSON.stringify(this.store.get<Thread>('thread',thread.id))!==JSON.stringify(thread))fail();
    return this.commitIngress(thread,occurrence,false);
  }
  commitIngress(thread: Thread, occurrence: IngressVersion, publishThread=true) {
    this.open(); const input = this.checkedIngress(occurrence); if (thread.accountId !== input.accountId || !guardId(thread.id)) fail();
    return this.transaction(() => {
      this.account(input.accountId);
      const existing=this.store.get<Thread>('thread',thread.id);if(existing&&(existing.accountId!==input.accountId||existing.id!==thread.id))fail();
      const prior = this.store.db.prepare('SELECT data,fingerprint FROM auto_draft_ingress WHERE account_id=? AND account_version=? AND source_ref=? AND input_version=?').get(input.accountId, input.accountVersion, input.sourceRef, input.inputVersion);
      if (prior) { const old = this.ingress(input.accountId, String((JSON.parse(String(prior.data)) as IngressVersion).id)); if (old.threadId !== thread.id || old.input.immutableFactsHash !== input.immutableFactsHash) fail(); if(publishThread)this.store.put('thread', thread.id, thread); return old.input; }
      const latest = this.store.db.prepare('SELECT MAX(sequence) AS n FROM auto_draft_ingress WHERE account_id=?').get(input.accountId); if (Number(latest?.n ?? 0) >= input.sequence) fail();
      if(publishThread)this.store.put('thread', thread.id, thread);
      const commitment=hash({input,threadId:thread.id});
      this.store.db.prepare('INSERT INTO auto_draft_ingress VALUES(?,?,?,?,?,?,?,?,?)').run(input.id, input.accountId, input.accountVersion, input.sourceRef, input.inputVersion, input.sequence, thread.id, JSON.stringify(input), commitment); this.store.db.prepare('INSERT INTO auto_draft_ingress_proofs VALUES(?,?)').run(input.id,commitment); return input;
    });
  }
  private ingress(accountId: string, id: string) {
    const row = this.store.db.prepare('SELECT * FROM auto_draft_ingress WHERE id=? AND account_id=?').get(id, accountId); if (!row) fail('auto_draft_generation_not_found', 404);
    try { const input = this.checkedIngress(JSON.parse(String(row.data))), threadId=String(row.thread_id), proof = this.store.db.prepare('SELECT fingerprint FROM auto_draft_ingress_proofs WHERE id=?').get(id); if (!guardId(threadId)||hash({input,threadId}) !== row.fingerprint || proof?.fingerprint !== row.fingerprint || input.id !== id || input.accountId !== accountId || input.accountVersion !== row.account_version || input.sourceRef !== row.source_ref || input.inputVersion !== row.input_version || input.sequence !== row.sequence) throw Error(); return { input, threadId }; } catch { return fail('auto_draft_generation_corrupt', 500); }
  }
  admit(ingressId: string, basis: FoundationBasis): Generation {
    this.open();
    return this.transaction(stamp => {
      this.account(basis.accountId); const { input, threadId } = this.ingress(basis.accountId, ingressId);this.store.ordinaryActions.assertGeneration(basis.accountId,threadId);
      const prior = this.store.db.prepare('SELECT job_id FROM auto_draft_job_keys WHERE account_id=? AND account_version=? AND source_ref=? AND input_version=?').get(basis.accountId, basis.accountVersion, basis.sourceRef, basis.inputVersion);
      if (prior) { if (!this.store.db.prepare('SELECT 1 FROM auto_draft_jobs WHERE id=? AND account_id=?').get(prior.job_id,basis.accountId)) fail('auto_draft_generation_corrupt',500); const old = this.read(basis.accountId, String(prior.job_id)); if (hash(old.basis) !== hash(basis) || old.ingressId !== ingressId) fail('auto_draft_generation_request_conflict'); return old.proof.generation; }
      if (!uuid(basis.activationId) || !integer(basis.activationEpoch) || basis.activationEpoch < 1 || !guardHash(basis.configurationVersion) || !guardHash(basis.accountVersion) || !guardId(basis.preferences.settingsId) || !integer(basis.preferences.revision) || !guardHash(basis.preferences.fingerprint) || !uuid(basis.target.threadRef) || !integer(basis.target.threadDraftSetVersion) || ![basis.target.threadInputVersion, basis.target.replyMetadataVersion, basis.target.sourceFactsVersion].every(guardHash) || input.origin !== 'google-live-history-message-added' || input.accountVersion !== basis.accountVersion || input.sourceRef !== basis.sourceRef || input.inputVersion !== basis.inputVersion || threadId !== basis.threadId) fail();
      this.guard.assertBasis(basis.accountId, threadId, basis.target);
      if (Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM auto_draft_jobs WHERE account_id=? AND json_extract(proof,'$.generation.state')='queued'").get(basis.accountId)!.n) >= LIMITS.queuedPerAccount) fail('auto_draft_generation_unavailable',503);
      const previous = this.store.db.prepare('SELECT last_ordinal FROM auto_draft_job_ordinals WHERE account_id=?').get(basis.accountId), ordinal = guardNext(Number(previous?.last_ordinal ?? 0));
      const generation: Generation = { version: 2, id: randomUUID(), accountId: basis.accountId, activationId: basis.activationId, activationEpoch: basis.activationEpoch, sourceRef: basis.sourceRef, inputVersion: basis.inputVersion, ordinal, revision: 1, state: 'queued', createdAt: new Date(stamp).toISOString(), updatedAt: new Date(stamp).toISOString(), attempt: null, result: null, publication: null, reason: null };
      const acceptance = { basis: structuredClone(basis), ingressId, identity: this.identity(generation), accountIdentity:this.accountIdentity(basis.accountId) };
      this.store.db.prepare('INSERT INTO auto_draft_job_acceptance VALUES(?,?,?)').run(generation.id, JSON.stringify(acceptance), hash(acceptance));
      this.store.db.prepare('INSERT INTO auto_draft_job_keys VALUES(?,?,?,?,?)').run(basis.accountId,basis.accountVersion,basis.sourceRef,basis.inputVersion,generation.id); this.store.db.prepare('INSERT INTO auto_draft_job_ordinals VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_ordinal=excluded.last_ordinal').run(basis.accountId,ordinal);
      const proof: Proof = { generation, acceptanceHash: hash(acceptance), owner: null, leaseId: null, leaseUntil: null, requestHash: null };
      this.store.db.prepare('INSERT INTO auto_draft_jobs VALUES(?,?,?,?,?,?,NULL,NULL,?,?)').run(generation.id, basis.accountId, basis.accountVersion, basis.sourceRef, basis.inputVersion, generation.revision, JSON.stringify(proof), hash(proof)); this.event(proof); return generation;
    });
  }
  basis(accountId:string,id:string):FoundationBasis {this.account(accountId);return structuredClone(this.read(accountId,id).basis);}
  private identity(g: Generation) { const { revision: _r, state: _s, updatedAt: _u, attempt: _a, result: _b, publication: _p, reason: _e, ...identity } = g; return identity; }
  private read(accountId: string, id: string) {
    const row = this.store.db.prepare('SELECT * FROM auto_draft_jobs WHERE id=? AND account_id=?').get(id, accountId); if (!row) fail('auto_draft_generation_not_found', 404);
    try {
      const accepted = this.store.db.prepare('SELECT data,integrity FROM auto_draft_job_acceptance WHERE id=?').get(id)!;
      const acceptance = JSON.parse(String(accepted.data)) as { basis: FoundationBasis; ingressId: string; identity: unknown; accountIdentity:string }, proof = JSON.parse(String(row.proof)) as Proof;
      assertGeneration(proof.generation); const event = this.store.db.prepare('SELECT data,integrity FROM auto_draft_job_events WHERE job_id=? AND revision=?').get(id, row.revision)!;
      const mapping=this.store.db.prepare('SELECT job_id FROM auto_draft_job_keys WHERE account_id=? AND account_version=? AND source_ref=? AND input_version=?').get(accountId,acceptance.basis.accountVersion,acceptance.basis.sourceRef,acceptance.basis.inputVersion);if(mapping?.job_id!==id)throw Error();
      if (hash(acceptance) !== accepted.integrity || proof.acceptanceHash !== accepted.integrity || hash(this.identity(proof.generation)) !== hash(acceptance.identity) || acceptance.basis.accountId !== accountId || acceptance.basis.accountVersion !== row.account_version || acceptance.basis.sourceRef !== row.source_ref || acceptance.basis.inputVersion !== row.input_version || acceptance.basis.activationId !== proof.generation.activationId || acceptance.basis.activationEpoch !== proof.generation.activationEpoch || proof.generation.id !== id || proof.generation.accountId !== accountId || proof.generation.revision !== row.revision || hash(proof) !== row.integrity || event.data !== row.proof || event.integrity !== row.integrity || proof.requestHash !== (row.request_utf8 === null ? null : createHash('sha256').update(String(row.request_utf8)).digest('hex'))) throw Error();
      if (proof.generation.state === 'claimed' && (!uuid(proof.owner) || !uuid(proof.leaseId) || !integer(proof.leaseUntil)) || proof.generation.state === 'queued' && (proof.owner !== null || proof.leaseId !== null || proof.leaseUntil !== null)) throw Error();
      return { ...acceptance, proof, ownerPid: row.owner_pid === null ? null : Number(row.owner_pid), request: row.request_utf8 === null ? null : String(row.request_utf8) };
    } catch { return fail('auto_draft_generation_corrupt', 500); }
  }
  job(accountId: string, id: string): Generation { this.account(accountId); return this.read(accountId, id).proof.generation; }
  history(accountId: string, id: string): Generation[] {
    this.account(accountId); const current = this.read(accountId,id).proof;
    const rows = this.store.db.prepare('SELECT data,integrity FROM auto_draft_job_events WHERE job_id=? ORDER BY revision').all(id);
    if (rows.length !== current.generation.revision) fail('auto_draft_generation_corrupt',500);
    let previous: Proof | undefined;
    return rows.map((row,index) => {
      try {
        const value = JSON.parse(String(row.data)) as Proof, next = value.generation;
        assertGeneration(next);
        if (hash(value) !== row.integrity || next.revision !== index+1 || value.acceptanceHash !== current.acceptanceHash || hash(this.identity(next)) !== hash(this.identity(current.generation))) throw Error();
        if (index === 0 && (next.state !== 'queued' || next.updatedAt !== next.createdAt)) throw Error();
        if (previous) {
          const prior = previous.generation;
          if (!TRANSITIONS[prior.state].includes(next.state) || Date.parse(next.updatedAt) < Date.parse(prior.updatedAt)) throw Error();
          for (const key of ['attempt','result','publication'] as const) if (prior[key] !== null && hash(prior[key]) !== hash(next[key])) throw Error();
        }
        // Current proof is independently bound to its exact terminal/current
        // event. Historical known evidence must belong to that same lineage.
        for (const key of ['attempt','result','publication'] as const) if (next[key] !== null && hash(next[key]) !== hash(current.generation[key])) throw Error();
        previous = value; return next;
      } catch { return fail('auto_draft_generation_corrupt',500); }
    });
  }
  private event(proof: Proof) { this.store.db.prepare('INSERT INTO auto_draft_job_events VALUES(?,?,?,?)').run(proof.generation.id, proof.generation.revision, JSON.stringify(proof), hash(proof)); for(const observer of this.generationObservers)observer(structuredClone(proof.generation)); }
  private save(proof: Proof, request: string | null, ownerPid: number | null) { assertGeneration(proof.generation); this.store.db.prepare('UPDATE auto_draft_jobs SET revision=?,owner_pid=?,request_utf8=?,proof=?,integrity=? WHERE id=?').run(proof.generation.revision, ownerPid, request, JSON.stringify(proof), hash(proof), proof.generation.id); this.event(proof); }
  private advance(proof: Proof, state: GenerationState, stamp: number): Proof { return { ...proof, generation: { ...proof.generation, state, revision: guardNext(proof.generation.revision), updatedAt: new Date(stamp).toISOString() } }; }
  private currentSource(basis: FoundationBasis) {this.store.ordinaryActions.assertGeneration(basis.accountId,basis.threadId);
    let row = this.store.db.prepare('SELECT input_version,source_ref FROM auto_draft_ingress WHERE account_id=? AND account_version=? AND thread_id=? ORDER BY sequence DESC LIMIT 1').get(basis.accountId, basis.accountVersion, basis.threadId);
    const thread=this.store.required<Thread>('thread',basis.threadId),projection=projectStoredMessages(this.store,thread);if(projection.presentation.coverage==='full'&&projection.assessment==='clear'&&projection.lastReal&&this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='google_ingress_sources'").get())row=this.store.db.prepare('SELECT i.input_version,i.source_ref FROM auto_draft_ingress i JOIN google_ingress_sources s ON s.source_ref=i.source_ref AND s.account_id=i.account_id AND s.account_version=i.account_version WHERE i.account_id=? AND i.account_version=? AND i.thread_id=? AND s.provider_message_id=? ORDER BY i.sequence DESC LIMIT 1').get(basis.accountId,basis.accountVersion,basis.threadId,projection.lastReal.id);
    if (row?.input_version !== basis.inputVersion || row?.source_ref !== basis.sourceRef) fail(); this.guard.assertBasis(basis.accountId, basis.threadId, basis.target);
  }
  claim(accountId: string, id: string, expectedRevision: number) {
    this.open(); return this.transaction(stamp => { this.account(accountId); const current = this.read(accountId, id); if (current.accountIdentity!==this.accountIdentity(accountId)||current.proof.generation.state !== 'queued' || current.proof.generation.revision !== expectedRevision) fail(); this.currentSource(current.basis);
      if (this.store.db.prepare("SELECT 1 FROM auto_draft_jobs WHERE account_id=? AND json_extract(proof,'$.generation.state') IN('claimed','dispatch-issued')").get(accountId) || Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM auto_draft_jobs WHERE json_extract(proof,'$.generation.state') IN('claimed','dispatch-issued')").get()!.n) >= LIMITS.activeGlobal) fail('auto_draft_generation_unavailable',503);
      const proof = this.advance(current.proof, 'claimed', stamp); proof.owner = this.owner; proof.leaseId = randomUUID(); proof.leaseUntil = stamp + LIMITS.claimLeaseMs; this.save(proof, current.request, process.pid); return structuredClone(proof); });
  }
  issue(accountId: string, id: string, leaseId: string, requestUtf8: string, attemptRef=randomUUID()): Generation {
    this.open(); if (!uuid(attemptRef) || typeof requestUtf8 !== 'string' || !requestUtf8 || /\p{Surrogate}/u.test(requestUtf8) || Buffer.byteLength(requestUtf8) > LIMITS.serializedRequestBytes) fail('auto_draft_generation_invalid_request', 400);
    return this.transaction(stamp => { this.account(accountId); const current = this.read(accountId, id), old = current.proof; if (current.accountIdentity!==this.accountIdentity(accountId)||old.generation.state !== 'claimed' || old.owner !== this.owner || old.leaseId !== leaseId || old.leaseUntil! <= stamp) fail(); this.currentSource(current.basis);
      const proof = this.advance(old, 'dispatch-issued', stamp); proof.generation.attempt = { ref: attemptRef, issuedAt: new Date(stamp).toISOString() }; proof.requestHash = createHash('sha256').update(requestUtf8).digest('hex'); this.save(proof, requestUtf8, process.pid); return proof.generation; });
  }
  stopUnissued(accountId:string,id:string,expectedRevision:number,state:'suppressed'|'superseded'|'failed-not-dispatched',reason:'publication-conflict'|'source-not-current'|'worker-closed'):Generation{
    this.open();return this.transaction(stamp=>{const current=this.read(accountId,id),old=current.proof;if(!['queued','claimed'].includes(old.generation.state)||old.generation.revision!==expectedRevision||old.generation.attempt||old.generation.state==='claimed'&&(old.owner!==this.owner||old.leaseUntil!<=stamp))fail();const proof=this.advance(old,state,stamp);proof.generation.reason=reason;this.save(proof,current.request,current.ownerPid);return proof.generation;});
  }
  terminal(accountId: string, id: string, leaseId: string, state: 'no-draft' | 'insufficient-context' | 'superseded' | 'output-rejected' | 'model-outcome-unknown', resultHash?: string): Generation {
    return this.transaction(stamp => { const current = this.read(accountId, id), old = current.proof;
      if (final(old.generation.state)) { if (old.generation.state === state && (!resultHash || old.generation.result?.fingerprint === resultHash)) return old.generation; return fail(); }
      if (old.owner !== this.owner || old.leaseId !== leaseId || old.generation.state !== 'dispatch-issued' || old.leaseUntil! <= stamp || stamp >= Date.parse(old.generation.attempt!.issuedAt)+LIMITS.modelTimeoutMs || this.closing) fail();
      if (['no-draft', 'insufficient-context'].includes(state)) { if (!guardHash(resultHash)) fail('auto_draft_generation_invalid_request', 400);if(current.accountIdentity!==this.accountIdentity(accountId))fail(); this.currentSource(current.basis); }
      const proof = this.advance(old, state, stamp); proof.generation.reason = state === 'superseded' ? 'publication-conflict' : state === 'output-rejected' ? 'invalid-output' : state === 'model-outcome-unknown' ? 'transport-or-process-unknown' : null;
      if (state === 'no-draft' || state === 'insufficient-context') proof.generation.result = { kind: state, fingerprint: resultHash! }; this.save(proof, current.request, current.ownerPid); return proof.generation; });
  }
  /** The callback creates only local Draft/provenance. No await or transport is
   * permitted inside this unit; a later hook failure rolls back the whole tuple. */
  publish(accountId:string,id:string,leaseId:string,create:(stamp:number)=>{publication:NonNullable<Generation['publication']>;resultHash:string}):Generation {
    this.open();return this.transaction(stamp=>{const current=this.read(accountId,id),old=current.proof;
      if(old.generation.state!=='dispatch-issued'||old.owner!==this.owner||old.leaseId!==leaseId||old.leaseUntil!<=stamp||stamp>=Date.parse(old.generation.attempt!.issuedAt)+LIMITS.modelTimeoutMs||current.accountIdentity!==this.accountIdentity(accountId))fail();
      this.currentSource(current.basis);const created=create(stamp);if(!guardHash(created.resultHash))fail();
      const proof=this.advance(old,'published',stamp);proof.generation.result={kind:'draft',fingerprint:created.resultHash};proof.generation.publication=created.publication;this.save(proof,current.request,current.ownerPid);return proof.generation;
    });
  }
  assertIssued(accountId:string,id:string,leaseId:string,attemptRef:string){this.open();const current=this.read(accountId,id).proof;if(current.owner!==this.owner||current.leaseId!==leaseId||current.generation.state!=='dispatch-issued'||current.generation.attempt?.ref!==attemptRef)fail();}
  unknown(accountId:string,id:string,leaseId:string,reason:'model-timeout'|'transport-or-process-unknown'):Generation {
    return this.transaction(stamp=>{const current=this.read(accountId,id),old=current.proof;if(final(old.generation.state))return old.generation;
      if(old.owner!==this.owner||old.leaseId!==leaseId||old.generation.state!=='dispatch-issued')fail();
      const proof=this.advance(old,'model-outcome-unknown',stamp);proof.generation.reason=reason;this.save(proof,current.request,current.ownerPid);return proof.generation;});
  }
  recover(ownerAlive: (owner: string, pid: number | null) => boolean) {
    this.open(); return this.transaction(stamp => { let recovered = 0;
      for (const row of this.store.db.prepare("SELECT id,account_id FROM auto_draft_jobs WHERE json_extract(proof,'$.generation.state') IN('claimed','dispatch-issued') LIMIT 100").all()) { const current = this.read(String(row.account_id), String(row.id)), old = current.proof; if (ownerAlive(old.owner!, current.ownerPid) && old.leaseUntil! > stamp && (!old.generation.attempt || stamp < Date.parse(old.generation.attempt.issuedAt)+LIMITS.modelTimeoutMs)) continue;
        const proof = this.advance(old, old.generation.attempt ? 'model-outcome-unknown' : 'queued', stamp); if (proof.generation.attempt) proof.generation.reason = 'transport-or-process-unknown'; else { proof.owner = null; proof.leaseId = null; proof.leaseUntil = null; try { if(current.accountIdentity!==this.accountIdentity(current.basis.accountId))fail(); this.currentSource(current.basis); } catch(error) { if(!(error instanceof HttpError)||![404,409].includes(error.status))throw error;proof.generation.state='superseded';proof.generation.reason='publication-conflict'; } } this.save(proof, current.request, null); recovered++; } return recovered; });
  }
  close() { if (this.closing) return; try { this.recover(owner => owner !== this.owner); } finally { this.closing = true; this.guard.close(); } }
}
