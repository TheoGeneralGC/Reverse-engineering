import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createVercelOutputConfig, writeVercelOutput } from '../ops/vercel-output.mjs';

const secret = 'a7'.repeat(32);
const production = { VERCEL_ENV: 'production', API_ORIGIN: 'https://synthetic-api.example.org', ORIGIN_SECRET: secret };
const match = (route, pathname) => new RegExp(route.src).test(pathname);

test('only the API path family receives backend authority, before filesystem and SPA routing', () => {
  const config = createVercelOutputConfig(production);
  const [api, filesystem, spa] = config.routes;
  for (const path of ['/api', '/api/', '/api/threads', '/api/auth/google/callback', '/api/accounts/a/attachments/b']) {
    assert.equal(match(api, path), true, path);
    assert.equal(path.replace(new RegExp(api.src), api.dest), `${production.API_ORIGIN}${path}`);
  }
  for (const path of ['/', '/apiculture', '/apis', '/x/api', '/API/threads', '//api/threads']) assert.equal(match(api, path), false, path);
  assert.deepEqual(filesystem, { handle: 'filesystem' });
  assert.equal(spa.dest, '/index.html');
  assert.equal(api.continue, undefined);
  assert.equal(api.methods, undefined, 'OAuth GET, JSON mutations and OPTIONS use the same protected route');
});

test('origin secret is an environment-backed replacement, with explicit private uncached responses', () => {
  const config = createVercelOutputConfig(production);
  const api = config.routes[0];
  assert.deepEqual(api.transforms, [{ type: 'request.headers', op: 'set', target: { key: 'x-origin-secret' },
    args: '$ORIGIN_SECRET', env: ['ORIGIN_SECRET'] }]);
  assert.equal(JSON.stringify(config).includes(secret), false);
  assert.equal(api.respectOriginCacheControl, false);
  assert.equal(api.headers['x-vercel-enable-rewrite-caching'], '0');
  for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) assert.match(api.headers[name], /no-store/);
  assert.equal(config.crons, undefined);
  assert.equal(config.daemons, undefined);
});

test('every nonproduction environment fails closed without a backend route, even with production variables present', () => {
  for (const target of [undefined, '', 'preview', 'development', 'custom']) {
    const config = createVercelOutputConfig({ ...production, VERCEL_ENV: target });
    assert.equal(config.routes[0].status, 503);
    assert.equal(config.routes[0].dest, '/api-unavailable.json');
    assert.equal(config.routes.some(route => route.transforms), false);
    assert.equal(JSON.stringify(config).includes(production.API_ORIGIN), false);
    assert.equal(JSON.stringify(config).includes(secret), false);
  }
});

test('production requires exact HTTPS origin and a generated secret, and errors contain no supplied credential', () => {
  for (const origin of [undefined, '', 'http://api.example.org', 'https://api.example.org/', 'https://api.example.org/x',
    'https://api.example.org?x=1', 'https://api.example.org#x', 'https://user:pass@api.example.org',
    'https://api.example.org:443', 'https://api.example.org:444', 'https://localhost', 'https://127.0.0.1', 'https://[::1]']) {
    assert.throws(() => createVercelOutputConfig({ ...production, API_ORIGIN: origin }), /API_ORIGIN must be a canonical HTTPS origin/);
  }
  for (const value of [undefined, '', 'short', 'b'.repeat(63), 'G'.repeat(64), 'a'.repeat(65)]) {
    let caught;
    try { createVercelOutputConfig({ ...production, ORIGIN_SECRET: value }); } catch (error) { caught = error; }
    assert.ok(caught);
    if (value) assert.equal(caught.message.includes(value), false);
  }
});

test('output contains only static build bytes, server routing and a truthful preview error; repeated builds replace old artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rea-vercel-output-'));
  try {
    await mkdir(join(root, 'dist/assets'), { recursive: true });
    await writeFile(join(root, 'dist/index.html'), '<main>Synthetic release</main>');
    const asset = Buffer.from([0, 1, 2, 254, 255]);
    await writeFile(join(root, 'dist/assets/example.bin'), asset);
    await writeFile(join(root, '.env'), `ORIGIN_SECRET=${secret}`);
    await writeVercelOutput({ webDirectory: root, env: production });
    const output = join(root, '.vercel/output');
    assert.deepEqual(await readFile(join(output, 'static/assets/example.bin')), asset);
    assert.equal((await readFile(join(output, 'config.json'), 'utf8')).includes(secret), false);
    assert.deepEqual((await readdir(output)).sort(), ['config.json', 'static']);
    assert.deepEqual((await readdir(join(output, 'static'))).sort(), ['api-unavailable.json', 'assets', 'index.html']);
    const error = JSON.parse(await readFile(join(output, 'static/api-unavailable.json'), 'utf8'));
    assert.equal(error.error, 'preview_api_unavailable');
    await writeFile(join(output, 'stale-secret-file'), secret);
    await writeVercelOutput({ webDirectory: root, env: { VERCEL_ENV: 'preview' } });
    assert.deepEqual((await readdir(output)).sort(), ['config.json', 'static']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public output refuses hidden credentials, SQLite files and symlinks instead of following them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rea-vercel-refuse-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist/index.html'), '<main>Synthetic release</main>');
    for (const name of ['.env', '.private', 'mail.sqlite', 'mail.sqlite-wal', 'private.pem', 'encryption.key']) {
      await writeFile(join(root, 'dist', name), 'synthetic-private');
      await assert.rejects(writeVercelOutput({ webDirectory: root, env: production }), /private or hidden file/);
      await rm(join(root, 'dist', name));
    }
    await symlink(join(root, 'dist/index.html'), join(root, 'dist/alias.html'));
    await assert.rejects(writeVercelOutput({ webDirectory: root, env: production }), /regular files and directories/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
