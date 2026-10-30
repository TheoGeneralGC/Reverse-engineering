import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const privateHeaders = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'x-vercel-enable-rewrite-caching': '0',
  'X-Content-Type-Options': 'nosniff',
});

function canonicalHttpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('API_ORIGIN must be a canonical HTTPS origin'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password
      || url.port || url.hostname === 'localhost' || !url.hostname.includes('.')
      || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith('[')) {
    throw new Error('API_ORIGIN must be a canonical HTTPS origin');
  }
  return url.origin;
}

/** Generate server routing only; the secret value must never enter an artifact. */
export function createVercelOutputConfig(env) {
  const production = env.VERCEL_ENV === 'production';
  let apiRoute;
  if (production) {
    const origin = canonicalHttpsOrigin(env.API_ORIGIN);
    if (!/^[a-f0-9]{64}$/.test(env.ORIGIN_SECRET ?? '')) {
      throw new Error('Production requires a 32-byte hexadecimal ORIGIN_SECRET');
    }
    apiRoute = {
      src: '^/api(/.*)?$',
      dest: `${origin}/api$1`,
      headers: { ...privateHeaders },
      respectOriginCacheControl: false,
      transforms: [{
        type: 'request.headers', op: 'set', target: { key: 'x-origin-secret' },
        args: '$ORIGIN_SECRET', env: ['ORIGIN_SECRET'],
      }],
    };
  } else {
    // A preview must not acquire authority over the production mailbox backend.
    apiRoute = { src: '^/api(/.*)?$', dest: '/api-unavailable.json', status: 503,
      headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' } };
  }
  return {
    version: 3,
    routes: [apiRoute, { handle: 'filesystem' },
      { src: '^/.*$', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } }],
  };
}

async function requirePublicBuildTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error('The public build must contain only regular files and directories');
    }
    if (entry.name.startsWith('.') || /(?:\.sqlite(?:-wal|-shm)?|\.env(?:\..*)?|\.pem|\.key)$/i.test(entry.name)) {
      throw new Error('The public build contains a private or hidden file');
    }
    if (stat.isDirectory()) await requirePublicBuildTree(path);
  }
}

export async function writeVercelOutput({ webDirectory, env }) {
  const config = createVercelOutputConfig(env);
  const dist = resolve(webDirectory, 'dist');
  const output = resolve(webDirectory, '.vercel/output');
  await requirePublicBuildTree(dist);
  await readFile(join(dist, 'index.html')); // A successful SPA build is required.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(dist, join(output, 'static'), { recursive: true, dereference: false });
  await writeFile(join(output, 'static/api-unavailable.json'), JSON.stringify({
    error: 'preview_api_unavailable', message: 'Email is available on the protected production site.',
  }) + '\n');
  await writeFile(join(output, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}
