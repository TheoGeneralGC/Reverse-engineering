#!/usr/bin/env node
/** Isolated read-only marker probe. Does not send or change a live draft/attempt. */
import { readFileSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { richFixture, validateRichFixturePlan, validateSendBoundary } from './live-gmail.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
class ProbeError extends Error {}
function requireValue(condition, message) { if (!condition) throw new ProbeError(message); }
export function parseReadOnlyFlags(args) {
  const flags = { verify: false, runId: '' }; let planOnly = false;
  for (let index = 0; index < args.length; index++) { if (args[index] === '--verify') flags.verify = true; else if (args[index] === '--plan-only') planOnly = true; else if (args[index] === '--run-id') flags.runId = args[++index] ?? ''; else throw new Error('Unsupported read-only probe option'); }
  requireValue(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(flags.runId), 'A named existing controlled run is required'); requireValue(!(planOnly && flags.verify), 'Choose plan-only or read-only verification'); return flags;
}
export function validateControlledSnapshot(state, draft, attempt, account, participants, runId) {
  const expected = richFixture(runId); validateRichFixturePlan(state?.fixture, runId);
  requireValue(state.runId === runId && state.messages?.length === 1 && JSON.stringify(state.participants) === JSON.stringify(participants), 'Controlled run identity or approved pair does not match');
  const entry = state.messages[0];
  requireValue(entry.status === 'sent' && typeof entry.providerMessageId === 'string' && entry.sendStartedAt && entry.sentAt, 'Only an already confirmed synthetic send can be probed');
  requireValue(entry.sender === participants[0] && entry.recipient === participants[1] && entry.subject === expected.subject && entry.fixtureHash === expected.fixtureHash, 'The run is not the approved synthetic rich fixture');
  requireValue(draft?.id === entry.draftId && draft.accountId === entry.accountId && draft.status === 'sent' && draft.providerMessageId === entry.providerMessageId, 'The exact live draft does not match the confirmed run');
  requireValue(draft.to?.toLowerCase() === entry.recipient && !draft.cc && !draft.bcc && !draft.providerDraftId && !draft.threadId && draft.subject === expected.subject && draft.body === expected.body && draft.html === expected.html, 'The confirmed draft content/route changed; it will not be probed');
  requireValue(draft.attachments?.length === 1 && draft.attachments[0].name === expected.attachment.name && draft.attachments[0].mimeType === expected.attachment.mimeType && draft.attachments[0].size === expected.attachment.bytes.length, 'The controlled attachment identity does not match');
  requireValue(account?.id === entry.accountId && account.provider === 'google' && account.email?.toLowerCase() === entry.sender, 'The live account is outside the approved controlled sender');
  requireValue(typeof draft.deliveryMarker === 'string' && /^[A-Za-z0-9_-]{32}$/.test(draft.deliveryMarker), 'This confirmed attempt has no opaque marker; legacy runs cannot validate marker retention');
  requireValue(attempt?.id === draft.deliveryAttemptId && attempt.draftId === draft.id && attempt.status === 'sent' && attempt.providerMessageId === entry.providerMessageId && attempt.marker === draft.deliveryMarker && attempt.messageId === draft.deliveryMessageId && Number.isFinite(Date.parse(attempt.startedAt)), 'The exact confirmed delivery attempt identity does not match');
}
export function createReadOnlyGmailFetcher(accessToken, after, implementation = fetch) {
  const counters = { getAttempts: 0, blockedAttempts: 0, profile: 0, lists: 0, metadata: 0 }; const candidates = new Set(); const pages = new Set();
  const deny = () => { counters.blockedAttempts++; throw new ProbeError('Read-only probe refused a request outside exact Gmail metadata scope'); };
  const fetcher = async (input, options = {}) => {
    let url; try { url = new URL(String(input)); } catch { return deny(); }
    if ((options.method ?? 'GET').toUpperCase() !== 'GET' || options.body !== undefined || url.origin !== 'https://gmail.googleapis.com' || url.username || url.password || new Headers(options.headers).get('authorization') !== `Bearer ${accessToken}` || counters.getAttempts >= 60) return deny();
    const prefix = '/gmail/v1/users/me/'; if (!url.pathname.startsWith(prefix)) return deny(); const path = url.pathname.slice(prefix.length); let family;
    if (path === 'profile' && !url.search) family = 'profile';
    else if (path === 'messages') {
      const allowed = ['q', 'labelIds', 'includeSpamTrash', 'maxResults', 'pageToken'];
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key)) || ['q', 'labelIds', 'includeSpamTrash', 'maxResults'].some(key => url.searchParams.getAll(key).length !== 1) || url.searchParams.getAll('pageToken').length > 1 || url.searchParams.get('q') !== `after:${after}` || url.searchParams.get('labelIds') !== 'SENT' || url.searchParams.get('includeSpamTrash') !== 'true' || url.searchParams.get('maxResults') !== '25') return deny();
      pages.add(url.searchParams.get('pageToken') ?? ''); if (pages.size > 2) return deny(); family = 'lists';
    } else if (/^messages\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.slice('messages/'.length)); const names = url.searchParams.getAll('metadataHeaders').sort();
      if (!candidates.has(id) || url.searchParams.getAll('format').length !== 1 || url.searchParams.get('format') !== 'metadata' || [...url.searchParams.keys()].some(key => !['format', 'metadataHeaders'].includes(key)) || JSON.stringify(names) !== JSON.stringify(['From', 'Message-ID', 'X-Reconstruction-Delivery-ID'])) return deny(); family = 'metadata';
    } else return deny();
    counters.getAttempts++; counters[family]++;
    const response = await implementation(url.toString(), { ...options, method: 'GET', redirect: 'error' });
    if (family === 'lists' && response.ok) { const data = await response.clone().json(); if (data.messages !== undefined && (!Array.isArray(data.messages) || data.messages.length > 25)) return deny(); for (const item of data.messages ?? []) { if (typeof item.id !== 'string' || !item.id) return deny(); candidates.add(item.id); } if (candidates.size > 50) return deny(); }
    return response;
  };
  return { fetcher, counters };
}
function readRecord(db, kind, id) { const row = db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id); if (!row) throw new Error('Required controlled record is unavailable'); return JSON.parse(String(row.data)); }
function atomicReport(directory, report) { mkdirSync(directory, { recursive: true, mode: 0o700 }); const name = `report-${new Date().toISOString().replace(/[^0-9TZ]/g, '')}-${randomUUID().slice(0, 8)}.json`; const path = resolve(directory, name); const temporary = `${path}.tmp`; const file = openSync(temporary, 'wx', 0o600); try { writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); fsyncSync(file); } finally { closeSync(file); } renameSync(temporary, path); const folder = openSync(directory, 'r'); try { fsyncSync(folder); } finally { closeSync(folder); } return path; }
async function main() {
  const flags = parseReadOnlyFlags(process.argv.slice(2)); const runDirectory = resolve(root, '.local/live-tests', flags.runId); const statePath = resolve(runDirectory, 'state.json'); const stateBytes = readFileSync(statePath); const state = JSON.parse(stateBytes);
  const approval = JSON.parse(readFileSync(resolve(root, '.local/live-tests/approved-participants.json'), 'utf8')); const participants = [...new Set((approval.participants ?? []).map(value => String(value).toLowerCase()))].sort(); requireValue(approval.authorizedBy === 'user' && participants.length === 2, 'An explicit two-participant approval is required');
  const settings = parseEnv(readFileSync(resolve(root, 'apps/superhuman/api/.env'), 'utf8')); requireValue(!settings.DATABASE_PATH || isAbsolute(settings.DATABASE_PATH), 'Read-only probe requires an absolute configured database path');
  validateSendBoundary({ google: { configured: true, deliveryEnabled: true, approvedTestSenders: (settings.APPROVED_TEST_SENDERS ?? '').split(',').map(value => value.trim()).filter(Boolean), approvedTestRecipients: (settings.APPROVED_TEST_RECIPIENTS ?? '').split(',').map(value => value.trim()).filter(Boolean) } }, participants);
  requireValue(state.messages?.length === 1 && typeof state.messages[0].draftId === 'string', 'An existing confirmed synthetic draft is required');
  const db = new DatabaseSync(settings.DATABASE_PATH || resolve(root, '.local/superhuman/mail.sqlite'), { readOnly: true }); let draft, attempt, account, encrypted;
  try { draft = readRecord(db, 'draft', state.messages[0].draftId); attempt = readRecord(db, 'delivery', draft.deliveryAttemptId); account = readRecord(db, 'account', draft.accountId); validateControlledSnapshot(state, draft, attempt, account, participants, flags.runId); encrypted = db.prepare('SELECT value FROM secrets WHERE account_id=?').get(account.id)?.value; requireValue(typeof encrypted === 'string', 'The exact mail token is unavailable'); } finally { db.close(); }
  const memory = new Store(':memory:', false); let report;
  try {
    memory.put('account', account.id, account); const simulatedDraft = { ...draft, status: 'delivery_unknown', providerMessageId: undefined, providerInternetMessageId: undefined, deliveryMarkerVerified: undefined }; const simulatedAttempt = { ...attempt, status: 'unknown', providerMessageId: undefined, providerInternetMessageId: undefined, markerVerified: undefined };
    memory.put('draft', draft.id, simulatedDraft); memory.put('delivery', attempt.id, simulatedAttempt); memory.db.prepare('INSERT INTO secrets VALUES(?,?)').run(account.id, encrypted);
    const configuration = { GOOGLE_CLIENT_ID: 'readonly-no-oauth', GOOGLE_CLIENT_SECRET: 'readonly-no-oauth', TOKEN_ENCRYPTION_KEY: settings.TOKEN_ENCRYPTION_KEY };
    const decoder = new GoogleProvider(memory, configuration); const cached = decoder.unseal(encrypted); requireValue(typeof cached.access_token === 'string' && !!cached.access_token && !/\s/.test(cached.access_token) && cached.expires_at > Date.now() + 120_000, 'Cached mail access token is near expiry or invalid; no OAuth refresh is allowed');
    const guard = createReadOnlyGmailFetcher(cached.access_token, Math.max(0, Math.floor(Date.parse(attempt.startedAt) / 1000) - 120)); const provider = new GoogleProvider(memory, configuration, guard.fetcher);
    const result = flags.verify ? await provider.reconcileDelivery(simulatedDraft) : undefined;
    const originalRunStateUnchanged = sha(readFileSync(statePath)) === sha(stateBytes); const memoryStatus = memory.required('draft', draft.id).status;
    report = { runId: flags.runId, mode: flags.verify ? 'read-only-marker-reconcile' : 'plan-only-marker-reconcile', recordedAt: new Date().toISOString(), liveStatus: draft.status, liveDatabaseReadOnly: true, liveRecordWrites: 0, sendRequests: 0, oauthRefreshAllowed: false, memoryStatus, markerSha256: sha(draft.deliveryMarker), originalRunStateUnchanged, sourceSha256: { ...Object.fromEntries(['google.ts', 'store.ts', 'mime.ts'].map(name => [name, sha(readFileSync(resolve(root, 'apps/superhuman/api/src', name)))])), helper: sha(readFileSync(fileURLToPath(import.meta.url))) }, http: guard.counters, markerProbePassed: result ? result.found && result.matches === 1 && result.scanComplete && result.providerMessageId === draft.providerMessageId && guard.counters.blockedAttempts === 0 && originalRunStateUnchanged && memoryStatus === 'delivery_unknown' : null, ...(result ? { result: { resolved: result.found, matches: result.matches, scanComplete: result.scanComplete, scannedCandidates: result.scannedCandidates, reason: result.reason, matchedAcknowledgedProviderId: result.providerMessageId === draft.providerMessageId, providerFinalRfcMatchesKnown: draft.providerInternetMessageId ? result.providerInternetMessageId === draft.providerInternetMessageId : null } } : {}) };
  } finally { memory.close(); }
  const reportPath = atomicReport(resolve(runDirectory, 'marker-readonly'), report); console.log(JSON.stringify({ runId: flags.runId, mode: report.mode, reportPath, liveDatabaseReadOnly: true, liveRecordWrites: 0, getAttempts: report.http.getAttempts, blockedAttempts: report.http.blockedAttempts, markerProbePassed: report.markerProbePassed, resolved: report.result?.resolved ?? null, matches: report.result?.matches ?? null, matchedAcknowledgedProviderId: report.result?.matchedAcknowledgedProviderId ?? null, originalRunStateUnchanged: report.originalRunStateUnchanged }, null, 2)); if (flags.verify && !report.markerProbePassed) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof ProbeError ? error.message : 'Read-only marker probe refused or failed validation. No sends, token refresh or live record writes are permitted.'); process.exitCode = 1; });
