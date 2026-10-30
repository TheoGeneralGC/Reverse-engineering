import '../../api/test/archive-network-deny.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { projectCoreEnvironment } from '../src/worker.ts';
import { loadAutoDraftRuntimeConfiguration } from '../../api/src/auto-drafts-runtime-configuration.ts';
const denial = (globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
assert(denial, 'Denial must precede the production graph');
after(() => assert.equal(denial.attempts, 0));

test('production Core environment preserves usable Core policy/model identity while excluding parent-only credentials', () => {
  const core = {
    DATABASE_PATH: 'libsql://fictional-mail.turso.io', WEB_ORIGIN: 'https://fixture.example.test',
    GOOGLE_CLIENT_ID: 'fictional-client', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: 'https://fixture.example.test/api/auth/google/callback',
    TOKEN_ENCRYPTION_KEY: '27'.repeat(32), GOOGLE_CALENDAR_ENABLED: 'true', APPROVED_TEST_SENDERS: 'own@example.test', APPROVED_TEST_RECIPIENTS: 'other@example.test',
    APPROVED_CALENDAR_TEST_ACCOUNTS: 'own@example.test', APPROVED_CALENDAR_TEST_ATTENDEES: 'other@example.test', APPROVED_CALENDAR_TEST_IDS: 'fictional-calendar',
    AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'fictional-core-model-key', ANTHROPIC_MODEL: 'claude-opus-5-5', ANTHROPIC_WORKSPACE_ID: '',
    AUTO_DRAFTS_PERSISTENCE: 'managed', MAIL_REPLY_TIME_ZONE: 'America/Los_Angeles', MAIL_RUNTIME_NAMESPACE: 'synthetic-thread',
    GMAIL_READ_QUOTA_UNITS_PER_MINUTE: '4200', GMAIL_SYNC_PAGES_PER_RUN: '1', CALENDAR_READS_PER_MINUTE: '30',
    TRACKING_PUBLIC_ORIGIN: 'https://tracking.example.test', TRACKING_MAIN_SIGNER_FILE: '/synthetic/signer.json',
    TRACKING_OPERATOR_VERIFICATION_FILE: '/synthetic/proof.json', TRACKING_COLLECTOR_SOURCE_IDENTITY: 'fictional-source', TRACKING_COLLECTOR_TIMEOUT_MS: '2000',
    TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
  };
  const parent = Object.fromEntries(['CONTROL_TURSO_DATABASE_URL', 'CONTROL_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_OIDC_TOKEN', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID', 'MAIL_API_HMAC_KEY', 'AWS_SECRET_ACCESS_KEY', 'UNRELATED_SERVICE_SECRET', 'PATH', 'TEST_DIRECTORY'].map((key, i) => [key, 'fictional-parent-only-' + i]));
  const input = Object.freeze({ ...core, ...parent }), before = JSON.stringify(input), projected = projectCoreEnvironment(input);
  assert.deepEqual(projected, core); assert.notEqual(projected, input); assert.equal(JSON.stringify(input), before);
  for (const key of Object.keys(parent)) assert(!Object.hasOwn(projected, key), key);
  assert(Object.hasOwn(projected, 'GOOGLE_CLIENT_SECRET')); assert.equal(projected.GOOGLE_CLIENT_SECRET, '');
  assert(Object.hasOwn(projected, 'ANTHROPIC_WORKSPACE_ID')); assert.equal(projected.ANTHROPIC_WORKSPACE_ID, '');
  const configured = loadAutoDraftRuntimeConfiguration(projected, { modelFetch: async () => { assert.fail('Projection must not issue a model request'); } });
  try { assert.equal(configured.generation?.generatedPersistence, 'managed'); assert.equal(configured.generation?.replyTimeZone, 'America/Los_Angeles'); assert.deepEqual(configured.generation?.modelProfile('fictional'), { provider: 'anthropic', model: 'claude-opus-5-5', credentialAvailable: true }); }
  finally { configured.clear(); }
});
