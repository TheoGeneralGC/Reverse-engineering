import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createVercelOutputConfig, writeVercelOutput } from './vercel-output.mjs';

const webDirectory = fileURLToPath(new URL('../../web/', import.meta.url));
// Validate before an expensive build, without logging either credential value.
createVercelOutputConfig(process.env);
const result = spawnSync('npm', ['run', 'build', '--workspace', '@re/superhuman-web'], {
  cwd: webDirectory, stdio: 'inherit', env: process.env,
});
if (result.error || result.signal || result.status !== 0) {
  throw new Error('Superhuman frontend build failed');
}
await writeVercelOutput({ webDirectory, env: process.env });
console.log('Prepared Superhuman Vercel Build Output API artifact.');
