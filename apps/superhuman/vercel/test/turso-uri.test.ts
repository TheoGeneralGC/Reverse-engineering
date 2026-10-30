import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createLibsqlPrimaryFactory } from '../src/sql.ts';
import { createLibsqlControl } from '../src/control-libsql.ts';
import { loadFunctionConfiguration } from '../src/function-runtime.ts';

const originalFetch = globalThis.fetch; let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('Turso URI controls prohibit network'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(calls, 0); });
const token = 'fictional-not-a-token';
const environment = { VERCEL_ENV: 'production', MAIL_RUNTIME_NAMESPACE: 'fictional-uri', WEB_ORIGIN: 'https://mail.example.test',
  CONTROL_TURSO_AUTH_TOKEN: token, MAIL_PRIVATE_BLOB_STORE_ID: 'store_AbCdEfGhIjKlMnOp' };
const actualHost = 'rea-sh-control-prod-vercel-icfg-mep3wusxnomi9cohbuletwmw.aws-us-east-1.turso.io';

test('all three explicit primary validators accept plain and regional vendor DNS names without connecting', async () => {
  for (const host of ['fictional.turso.io', 'fictional.aws-us-east-1.turso.io', actualHost, 'a.b.turso.io']) {
    for (const scheme of ['libsql', 'https']) {
      const url = `${scheme}://${host}`;
      assert.equal(typeof createLibsqlPrimaryFactory({ url, authToken: token }), 'function');
      const control = createLibsqlControl({ url, authToken: token }); await control.close();
      assert.equal(loadFunctionConfiguration({ ...environment, CONTROL_TURSO_DATABASE_URL: url }).controlUrl, url);
    }
  }
  assert.equal(calls, 0);
});

test('all three validators refuse DNS boundary tricks, malformed labels and noncanonical URL features before network', () => {
  const invalid = ['http://fictional.aws-us-east-1.turso.io', 'file::memory:', 'https://turso.io',
    'https://fictional.aws-us-east-1.turso.io.attacker.invalid', 'https://fictional.region.extra.turso.io',
    'https://fictional..turso.io', 'https://-fictional.turso.io', 'https://fictional-.turso.io',
    'https://fictional.-region.turso.io', 'https://fictional.region-.turso.io', 'https://fictional._region.turso.io',
    `https://${'a'.repeat(64)}.turso.io`, `https://fictional.${'a'.repeat(64)}.turso.io`,
    'https://FICTIONAL.aws-us-east-1.turso.io', 'https://fictional.aws-us-east-1.turso.io.',
    'https://user:password@fictional.aws-us-east-1.turso.io', 'https://fictional.aws-us-east-1.turso.io:443',
    'https://fictional.aws-us-east-1.turso.io/path', 'https://fictional.aws-us-east-1.turso.io?token=wrong',
    'https://fictional.aws-us-east-1.turso.io#fragment'];
  for (const url of invalid) {
    assert.throws(() => createLibsqlPrimaryFactory({ url, authToken: token }), TypeError, url);
    assert.throws(() => createLibsqlControl({ url, authToken: token }), TypeError, url);
    assert.throws(() => loadFunctionConfiguration({ ...environment, CONTROL_TURSO_DATABASE_URL: url }), TypeError, url);
  }
});
