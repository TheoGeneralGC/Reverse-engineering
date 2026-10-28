#!/usr/bin/env node
/** Controlled local API integration checks. No delivery occurs without --send. */
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, existsSync, fsyncSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const stateRoot = resolve(root, '.local/live-tests');
const approvalPath = resolve(stateRoot, 'approved-participants.json');
const apiOrigin = 'http://127.0.0.1:3001';
function integer(value, min, max, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${name} must be ${min}–${max}`);
  return result;
}
export function parseHarnessFlags(args) {
  const flags = { send: false, verify: false, rich: false, planOnly: false, runId: '', syncPasses: 2, polls: 3, intervalMs: 2000 };
  for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === '--send') flags.send = true;
  else if (flag === '--verify') flags.verify = true;
  else if (flag === '--rich') flags.rich = true;
  else if (flag === '--plan-only') flags.planOnly = true;
  else if (flag === '--run-id') flags.runId = args[++index] ?? '';
  else if (flag === '--sync-passes') flags.syncPasses = integer(args[++index], 1, 5, flag);
  else if (flag === '--polls') flags.polls = integer(args[++index], 1, 5, flag);
  else if (flag === '--interval-ms') flags.intervalMs = integer(args[++index], 0, 10_000, flag);
  else throw new Error(`Unknown option: ${flag}`);
  }
  if (flags.runId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(flags.runId)) throw new Error('Invalid run ID');
  if (flags.verify && !flags.runId) throw new Error('--verify requires --run-id for the existing test run');
  if (flags.rich && flags.send && !flags.runId) throw new Error('Rich delivery requires --run-id for an existing reviewed plan');
  if (flags.planOnly && (flags.send || flags.verify)) throw new Error('--plan-only cannot be combined with --send or --verify');
  return flags;
}
const flags = parseHarnessFlags(process.argv.slice(2));
const runId = flags.runId || `${new Date().toISOString().replace(/[^0-9TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
const runDirectory = resolve(stateRoot, runId);
const statePath = resolve(runDirectory, 'state.json');
const lockPath = resolve(runDirectory, 'run.lock');
if (flags.verify && !existsSync(statePath)) throw new Error('--verify requires an existing saved run; check --run-id');
if (flags.rich && flags.send && !existsSync(statePath)) throw new Error('Create and review this rich run in --plan-only mode before --send');

function email(value) {
  if (typeof value !== 'string' || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value)) throw new Error('Approval manifest contains an invalid email');
  return value.toLowerCase();
}
function readApproval() {
  if (!existsSync(approvalPath)) throw new Error(`Missing local approval manifest: ${approvalPath}`);
  const input = JSON.parse(readFileSync(approvalPath, 'utf8'));
  const participants = [...new Set((input.participants ?? []).map(email))].sort();
  if (input.authorizedBy !== 'user' || participants.length !== 2) throw new Error('Expected two explicitly user-authorized participants');
  return { participants, authorizedAt: input.authorizedAt || null };
}
async function request(path, body) {
  validateHarnessRequest(flags, path, body === undefined ? 'GET' : 'POST');
  const response = await fetch(`${apiOrigin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180_000), redirect: 'error' });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || `Local API request failed (${response.status})`);
    error.code = result.error?.code || 'api_error'; error.status = response.status;
    throw error;
  }
  return result;
}
export function validateHarnessRequest(mode, path, method) {
  if (method === 'GET') return;
  if (!mode.send && !mode.verify) throw new Error('Plan-only mode never issues mutation/sync requests');
  if (method === 'POST' && /^\/accounts\/[^/]+\/sync$/.test(path) && (mode.send || mode.verify)) return;
  if (mode.send && method === 'POST' && (/^\/drafts$/.test(path) || /^\/drafts\/[^/]+\/(?:send|attachments)$/.test(path))) return;
  throw new Error('Harness request is outside its explicit delivery/verification mode');
}
async function download(path, expectedName) {
  validateHarnessRequest(flags, path, 'GET');
  const response = await fetch(`${apiOrigin}/api${path}`, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!response.ok) { const error = new Error(`Attachment download failed (${response.status})`); error.code = 'attachment_download_failed'; error.status = response.status; throw error; }
  if (response.headers.get('cache-control') !== 'no-store' || response.headers.get('x-content-type-options') !== 'nosniff' || !response.headers.get('content-disposition')?.startsWith('attachment;')) throw new Error('Attachment response lacks expected safe download headers');
  if (expectedName && !response.headers.get('content-disposition')?.includes(`filename*=UTF-8''${encodeURIComponent(expectedName)}`)) throw new Error('Attachment download filename does not match the fixture');
  return Buffer.from(await response.arrayBuffer());
}
function save(state) {
  state.updatedAt = new Date().toISOString();
  const temporary = resolve(runDirectory, `state-${randomUUID()}.tmp`);
  const file = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(file, JSON.stringify(state, null, 2) + '\n'); fsyncSync(file); } finally { closeSync(file); }
  renameSync(temporary, statePath);
  // Publish the attempt marker durably before a future external send. A crash
  // must not erase the fact that dispatch was started and permit a duplicate.
  for (const directory of [runDirectory, stateRoot]) { const descriptor = openSync(directory, 'r'); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
}
export function validateSendBoundary(status, participants, sender) {
  const allowed = [...new Set((status.google?.approvedTestRecipients ?? []).map(email))].sort();
  const allowedSenders = [...new Set((status.google?.approvedTestSenders ?? []).map(email))].sort();
  if (!status.google?.configured) throw new Error('Gmail OAuth credentials are not configured');
  if (!status.google.deliveryEnabled) throw new Error('The API delivery allowlist is disabled');
  if (JSON.stringify(allowed) !== JSON.stringify(participants)) throw new Error('API allowlist must contain exactly the two approved participants and no other recipient');
  if (JSON.stringify(allowedSenders) !== JSON.stringify(participants)) throw new Error('API sender allowlist must contain exactly the two approved participants and no other sender');
  if (sender !== undefined && !allowedSenders.includes(email(sender))) throw new Error('The authenticated sender is not approved for test delivery');
}
function fixtureBody(id) {
  return `This is a controlled email delivery test for the Superhuman reconstruction.\n\nRun: ${id}\nNo reply or action is required. Only the two account-owner-approved addresses are involved.`;
}
export function validateDraft(draft, entry, id) {
  if (!draft || draft.id !== entry.draftId || draft.accountId !== entry.accountId || draft.to?.toLowerCase() !== entry.recipient || draft.cc || draft.bcc || draft.subject !== entry.subject || draft.body !== fixtureBody(id) || draft.status !== 'draft' || draft.attachments?.length) throw new Error('Saved test draft was changed or is no longer safe to send; it will not be submitted');
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
export function richFixture(id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error('Invalid rich fixture run ID');
  const subject = `REA rich MIME test ${id}`;
  const body = `Controlled synthetic rich email test.\nRun: ${id}\nUTF-8: café — 東京 😀\nPlain marker: REA-PLAIN-${id}\nOne tiny test attachment is included. No reply or action is required.\n`;
  const html = `<div><p>Controlled synthetic <strong>rich email</strong> test.</p><p>Run: <code>${id}</code></p><p>UTF-8: café — 東京 😀</p><ul><li>HTML marker: REA-HTML-${id}</li><li>One tiny test attachment is included.</li></ul><p><em>No reply or action is required.</em></p></div>`;
  const attachment = { name: `rea-rich-${id}-café.txt`, mimeType: 'text/plain', bytes: Buffer.from(`Controlled synthetic attachment\nRun: ${id}\nUTF-8: café — 東京 😀\n`, 'utf8') };
  const hashes = { plain: sha256(body), html: sha256(html), attachment: sha256(attachment.bytes) };
  return { kind: 'rich-mime-v1', subject, body, html, attachment, hashes, fixtureHash: sha256(JSON.stringify([subject, attachment.name, attachment.mimeType, hashes])) };
}
export function validateRichFixturePlan(saved, id) {
  const expected = richFixture(id); const stored = saved?.attachment?.bytes;
  const bytes = Buffer.isBuffer(stored) ? stored : stored?.type === 'Buffer' && Array.isArray(stored.data) && stored.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255) ? Buffer.from(stored.data) : undefined;
  if (saved?.kind !== expected.kind || saved.fixtureHash !== expected.fixtureHash || saved.subject !== expected.subject || saved.body !== expected.body || saved.html !== expected.html || saved.attachment?.name !== expected.attachment.name || saved.attachment?.mimeType !== expected.attachment.mimeType || !bytes?.equals(expected.attachment.bytes) || Object.keys(expected.hashes).some(key => saved.hashes?.[key] !== expected.hashes[key])) throw new Error('The saved rich fixture plan changed; it is preserved and no draft/send is allowed');
}
export function validateRichDraft(draft, entry, id) {
  validateRichDraftBase(draft, entry, id); const fixture = richFixture(id); const attachment = draft.attachments?.[0];
  if (draft.attachments?.length !== 1 || !entry.attachmentId || attachment.id !== entry.attachmentId || attachment.name !== fixture.attachment.name || attachment.mimeType !== fixture.attachment.mimeType || attachment.size !== fixture.attachment.bytes.length) throw new Error('Saved rich attachment changed or is unsafe; it will not be submitted');
}
export function validateRichDraftBase(draft, entry, id) {
  const fixture = richFixture(id);
  if (!draft || draft.id !== entry.draftId || draft.accountId !== entry.accountId || draft.to?.toLowerCase() !== entry.recipient || draft.cc || draft.bcc || draft.subject !== fixture.subject || entry.subject !== fixture.subject || entry.fixtureHash !== fixture.fixtureHash || draft.body !== fixture.body || draft.html !== fixture.html || draft.status !== 'draft' || draft.providerDraftId || draft.threadId) throw new Error('Saved rich test draft changed or is unsafe; it is preserved');
}
export function richMessageChecks(message, entry, id, attachmentBytes) {
  const fixture = richFixture(id); const attachment = message.attachments?.[0];
  const checks = { senderExact: message.sender?.email?.toLowerCase() === entry.sender, recipientExact: message.to?.length === 1 && message.to[0].email?.toLowerCase() === entry.recipient && !(message.cc?.length), messageIdExact: typeof entry.deliveryMessageId === 'string' && message.internetMessageId === entry.deliveryMessageId, plainExact: message.text === fixture.body, htmlExact: message.html === fixture.html, attachmentMetadataExact: message.attachments?.length === 1 && attachment?.name === fixture.attachment.name && attachment.mimeType === fixture.attachment.mimeType && attachment.size === fixture.attachment.bytes.length, attachmentBytesExact: Buffer.isBuffer(attachmentBytes) && attachmentBytes.equals(fixture.attachment.bytes) };
  return { passed: Object.values(checks).every(Boolean), checks, expectedHashes: fixture.hashes, actualHashes: { plain: typeof message.text === 'string' ? sha256(message.text) : null, html: typeof message.html === 'string' ? sha256(message.html) : null, attachment: Buffer.isBuffer(attachmentBytes) ? sha256(attachmentBytes) : null }, attachmentBytes: attachmentBytes?.length ?? null };
}
async function prepareRichAttachment(entry, state) {
  const fixture = richFixture(state.runId); const saved = await request(`/drafts/${encodeURIComponent(entry.draftId)}`); let draft = saved.draft;
  if (saved.deliveryPending) throw new Error('Rich draft already has a pending delivery'); validateRichDraftBase(draft, entry, state.runId);
  if (!draft.attachments?.length) {
    if (entry.attachmentUploadStartedAt) throw new Error('A prior attachment upload is unconfirmed; inspect the same draft before continuing');
    entry.attachmentUploadStartedAt = new Date().toISOString(); save(state);
    const result = await request(`/drafts/${encodeURIComponent(entry.draftId)}/attachments`, { name: fixture.attachment.name, mimeType: fixture.attachment.mimeType, data: fixture.attachment.bytes.toString('base64') }); draft = result.draft;
  }
  if (draft.attachments?.length !== 1) throw new Error('Rich test draft contains unexpected attachments; it is preserved');
  const attachment = draft.attachments[0];
  if (attachment.name !== fixture.attachment.name || attachment.mimeType !== fixture.attachment.mimeType || attachment.size !== fixture.attachment.bytes.length) throw new Error('Rich attachment metadata changed; the draft is preserved');
  const bytes = await download(`/drafts/${encodeURIComponent(entry.draftId)}/attachments/${encodeURIComponent(attachment.id)}`, fixture.attachment.name); if (!bytes.equals(fixture.attachment.bytes)) throw new Error('Saved rich attachment bytes changed; the draft is preserved');
  entry.attachmentId = attachment.id; entry.status = 'draft-created'; save(state); validateRichDraft(draft, entry, state.runId);
}
function receipt(thread, message) {
  return { threadId: thread.id, messageId: message.id, providerThreadId: thread.providerId || null, date: message.date };
}
async function verifyEntry(entry, accounts, state) {
  const recipient = accounts.find(account => account.provider === 'google' && account.email.toLowerCase() === entry.recipient);
  if (!recipient) { entry.verification = { status: 'recipient-unconnected', checkedAt: new Date().toISOString() }; return; }
  if (flags.rich && !entry.deliveryMessageId) {
    try { const { draft } = await request(`/drafts/${encodeURIComponent(entry.draftId)}`); entry.deliveryMessageId = draft.deliveryMessageId || null; entry.backendDraftStatus = draft.status; }
    catch (error) { entry.verification = { status: 'delivery-identity-unavailable', code: error.code || 'network_error', checkedAt: new Date().toISOString() }; return; }
    if (!entry.deliveryMessageId) { entry.verification = { status: 'delivery-identity-unavailable', checkedAt: new Date().toISOString() }; return; }
  }
  let lastSync;
  for (let poll = 0; poll < flags.polls; poll++) {
    for (let pass = 0; pass < flags.syncPasses; pass++) {
      try { lastSync = await request(`/accounts/${encodeURIComponent(recipient.id)}/sync`, {}); }
      catch (error) { entry.verification = { status: 'sync-error', code: error.code || 'network_error', checkedAt: new Date().toISOString() }; return; }
      if (!lastSync.partial) break;
    }
    const found = await request(`/threads?accountId=${encodeURIComponent(recipient.id)}&folder=all&q=${encodeURIComponent(`subject:"${entry.subject}"`)}`);
    if (flags.rich) {
      const candidates = (found.threads ?? []).filter(thread => thread.subject === entry.subject).flatMap(thread => (thread.messages ?? []).filter(message => message.sender?.email?.toLowerCase() === entry.sender && message.to?.some(person => person.email.toLowerCase() === entry.recipient)).map(message => ({ thread, message })));
      if (candidates.length > 1) { entry.verification = { status: 'duplicate-receipts', count: candidates.length, checkedAt: new Date().toISOString() }; return; }
      if (candidates.length === 1) {
        const { thread, message } = candidates[0]; const attachment = message.attachments?.[0]; let bytes;
        if (message.attachments?.length === 1 && typeof attachment?.id === 'string') {
          try { bytes = await download(`/accounts/${encodeURIComponent(recipient.id)}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`, richFixture(state.runId).attachment.name); }
          catch (error) { entry.verification = { status: 'attachment-download-error', code: error.code || 'download_error', checkedAt: new Date().toISOString(), receipt: receipt(thread, message) }; return; }
        }
        const assertions = richMessageChecks(message, entry, state.runId, bytes);
        entry.verification = { status: assertions.passed ? 'received' : 'content-mismatch', checkedAt: new Date().toISOString(), receipt: receipt(thread, message), assertions, coverage: 'exact decoded Gmail body/html and attachment bytes; raw wire MIME hierarchy not fetched' }; return;
      }
    }
    for (const thread of found.threads ?? []) {
      if (flags.rich) break;
      const message = (thread.messages ?? []).find(item => item.sender?.email?.toLowerCase() === entry.sender && item.to?.some(person => person.email.toLowerCase() === entry.recipient) && item.text?.includes(state.runId));
      if (thread.subject === entry.subject && message) { entry.verification = { status: 'received', checkedAt: new Date().toISOString(), receipt: receipt(thread, message) }; return; }
    }
    entry.verification = { status: lastSync?.partial ? 'waiting-for-mailbox-sync' : 'waiting-for-delivery', checkedAt: new Date().toISOString(), syncPartial: !!lastSync?.partial, phase: lastSync?.phase || null };
    save(state);
    if (poll + 1 < flags.polls && flags.intervalMs) await new Promise(resolveDelay => setTimeout(resolveDelay, flags.intervalMs));
  }
}

async function main() {
  const approval = readApproval();
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  const lock = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let state;
  try {
    const status = await request('/provider/status');
    const { accounts } = await request('/accounts');
    const connected = accounts.filter(account => account.provider === 'google' && approval.participants.includes(account.email.toLowerCase()));
    state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { version: flags.rich ? 2 : 1, runId, createdAt: new Date().toISOString(), participants: approval.participants, messages: [], ...(flags.rich ? { fixture: richFixture(runId) } : {}) };
    if (state.runId !== runId || JSON.stringify(state.participants) !== JSON.stringify(approval.participants)) throw new Error('Existing run identity/participants do not match the approval manifest');
    if (!!state.fixture !== flags.rich) throw new Error('Existing run fixture/mode does not match; its state is preserved');
    if (flags.rich) validateRichFixturePlan(state.fixture, runId);
    let approvedPairBoundaryReady = false; let boundaryError;
    try { validateSendBoundary(status, approval.participants); approvedPairBoundaryReady = true; } catch (error) { boundaryError = error.message; }
    state.preflight = { checkedAt: new Date().toISOString(), googleConfigured: !!status.google?.configured, deliveryEnabled: !!status.google?.deliveryEnabled, approvedPairBoundaryReady, boundaryError, connectedApprovedAccounts: connected.map(account => ({ id: account.id, email: account.email })), missingConfiguration: status.google?.missing || [] };
    const selected = flags.rich ? connected.filter(account => account.email.toLowerCase() === approval.participants[0]) : connected;
    if (flags.rich && selected.length !== 1) throw new Error('The first approved participant must be connected to plan this single rich test');
    for (const account of selected) {
      const sender = account.email.toLowerCase();
      if (state.messages.some(entry => entry.sender === sender)) continue;
      const recipient = approval.participants.find(address => address !== sender);
      state.messages.push({ sender, recipient, accountId: account.id, subject: flags.rich ? richFixture(runId).subject : `REA integration test ${runId} ${state.messages.length + 1}`, status: 'planned', ...(flags.rich ? { fixtureHash: richFixture(runId).fixtureHash } : {}) });
    }
    if (flags.rich && state.messages.length !== 1) throw new Error('A rich run must contain exactly one planned message');
    if (flags.rich) { const entry = state.messages[0]; const fixture = richFixture(runId); if (entry.sender !== approval.participants[0] || entry.recipient !== approval.participants[1] || entry.accountId !== selected[0].id || entry.subject !== fixture.subject || entry.fixtureHash !== fixture.fixtureHash) throw new Error('Rich run route or fixture identity changed; its state is preserved'); }
    save(state);
    if (flags.send) {
      validateSendBoundary(status, approval.participants);
      if (!connected.length) throw new Error('No approved Gmail sender is connected; finish OAuth first');
      for (const entry of state.messages) {
        if (!connected.some(account => account.id === entry.accountId && account.email.toLowerCase() === entry.sender)) continue;
        // Durable marker forbids duplicate send after a crash or uncertain result.
        if (entry.sendStartedAt || entry.status === 'sent') continue;
        if (!approval.participants.includes(entry.recipient) || entry.recipient === entry.sender) throw new Error('Test route is outside the approved pair');
        if (!entry.draftId) {
          const fixture = flags.rich ? richFixture(runId) : undefined;
          const response = await request('/drafts', { accountId: entry.accountId, to: entry.recipient, cc: '', bcc: '', subject: entry.subject, body: fixture?.body ?? fixtureBody(runId), ...(fixture ? { html: fixture.html } : {}) });
          if (!response.draft?.id || response.draft.accountId !== entry.accountId || response.draft.to.toLowerCase() !== entry.recipient || response.draft.cc || response.draft.bcc) throw new Error('Created draft does not match the approved delivery route');
          entry.draftId = response.draft.id; entry.status = 'draft-created'; save(state);
        }
        if (flags.rich) await prepareRichAttachment(entry, state);
        // Recheck provider configuration immediately before each send.
        validateSendBoundary(await request('/provider/status'), approval.participants, entry.sender);
        if (flags.rich) { const saved = await request(`/drafts/${encodeURIComponent(entry.draftId)}`); if (saved.deliveryPending) throw new Error('Rich draft already has a pending delivery'); validateRichDraft(saved.draft, entry, runId); }
        else { const saved = await request(`/drafts?accountId=${encodeURIComponent(entry.accountId)}`); validateDraft(saved.drafts?.find(draft => draft.id === entry.draftId), entry, runId); }
        entry.sendStartedAt = new Date().toISOString(); entry.status = 'send-started'; save(state);
        try {
          const result = await request(`/drafts/${encodeURIComponent(entry.draftId)}/send`, {});
          if (!result.sent) throw new Error('API did not confirm a successful send');
          entry.status = 'sent'; entry.sentAt = new Date().toISOString(); entry.providerMessageId = result.result?.id || null;
        } catch (error) {
          entry.status = 'send-unconfirmed'; entry.error = { code: error.code || 'network_error', status: error.status || null };
          // Never retry automatically, including on a later --send invocation.
        }
        if (flags.rich) { try { const { draft } = await request(`/drafts/${encodeURIComponent(entry.draftId)}`); entry.deliveryMessageId = draft.deliveryMessageId || null; entry.backendDraftStatus = draft.status; } catch { entry.deliveryIdentityReadFailed = true; } }
        save(state);
      }
    }
    if (flags.send || flags.verify) {
      for (const entry of state.messages) {
        if (!entry.sendStartedAt) continue;
        await verifyEntry(entry, accounts, state); save(state);
      }
    }
    state.result = { mode: flags.send ? 'send-and-verify' : flags.verify ? 'verify-only' : 'plan-only', fixture: flags.rich ? 'rich-mime-v1' : 'plain-v1', messagesPlanned: state.messages.length, sendsConfirmed: state.messages.filter(entry => entry.status === 'sent').length, receiptsConfirmed: state.messages.filter(entry => entry.verification?.status === 'received').length, needsReconciliation: state.messages.filter(entry => entry.sendStartedAt && entry.status !== 'sent').length, participantsUnconnected: approval.participants.filter(address => !connected.some(account => account.email.toLowerCase() === address)) };
    save(state);
    console.log(JSON.stringify({ runId, statePath, ...state.result, participantsUnconnected: state.result.participantsUnconnected.length }, null, 2));
  } finally {
    closeSync(lock); unlinkSync(lockPath);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.code ? `${error.code}: ${error.message}` : error.message); process.exitCode = 1; });
