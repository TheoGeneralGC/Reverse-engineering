import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const environment = { ...process.env };
// The static client receives only an explicit store origin, never its access
// credentials. Preview has no production storage or mail capability.
if (environment.VERCEL_ENV === 'production') {
  const store = environment.MAIL_PRIVATE_BLOB_STORE_ID;
  if (!store || !/^store_[A-Za-z0-9]{16}$/.test(store)) throw new Error('Private mail storage is not configured.');
  environment.VITE_REA_HOSTED_TRANSPORT = '1';
  environment.VITE_REA_BLOB_DOWNLOAD_ORIGIN = `https://${store.slice(6).toLowerCase()}.private.blob.vercel-storage.com`;
} else {
  environment.VITE_REA_HOSTED_TRANSPORT = '0';
  delete environment.VITE_REA_BLOB_DOWNLOAD_ORIGIN;
}
function run(args, cwd) {
  const result = spawnSync('npm', args, { cwd, env: environment, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('The hosted mail build failed.');
}
run(['ci', '--omit=dev', '--ignore-scripts', '--workspaces=false'], resolve(root, 'apps/superhuman/vercel'));
run(['run', 'build:superhuman'], root);
