import { setTimeout as sleep } from 'node:timers/promises';

const origin = new URL(process.argv[2]);
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Expected a loopback HTTP origin with an explicit port');
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${origin.origin}/api/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    if (response.ok && (await response.json()).ok === true) process.exit(0);
  } catch { /* The API can still be opening or migrating its private database. */ }
  await sleep(100);
}
throw new Error('The local API did not become ready within 30 seconds');
