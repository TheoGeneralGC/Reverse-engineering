import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from '../../api/src/server.ts';
import { loadAutoDraftRuntimeConfiguration } from '../../api/src/auto-drafts-runtime-configuration.ts';
import { loadTrackingRuntimeConfiguration } from '../../api/src/tracking-runtime-config.ts';
import { loadHostedConfiguration } from './config.ts';
import { createHostedGateway } from './gateway.ts';

/** A separate single-owner hosted entry point; the loopback launcher stays unchanged. */
export function createHostedApplication(env: NodeJS.ProcessEnv, options: { seed?: boolean; runJobs?: boolean } = {}) {
  const configuration = loadHostedConfiguration(env);
  const collector = loadTrackingRuntimeConfiguration(env);
  let automatic: ReturnType<typeof loadAutoDraftRuntimeConfiguration> | undefined;
  let app: ReturnType<typeof createApp>;
  try {
    automatic = loadAutoDraftRuntimeConfiguration(env);
    app = createApp({ databasePath: configuration.databasePath, env, seed: options.seed,
      runJobs: options.runJobs, trackingCollector: collector, autoDraftGeneration: automatic.generation });
  } finally { collector?.key.fill(0); automatic?.clear(); }
  const gateway = createHostedGateway(configuration, app.server);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    gateway.beginShutdown();
    closing = (async () => {
      await gateway.close();
      await app.close();
    })();
    return closing;
  };
  return { server: gateway.server, configuration, app, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const hosted = createHostedApplication(process.env);
    hosted.server.listen(hosted.configuration.port, '0.0.0.0', () => console.log('Superhuman hosted API is listening.'));
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
      void hosted.close().then(() => process.exit(0), () => { console.error('Hosted API shutdown failed.'); process.exit(1); });
    });
  } catch { console.error('Hosted API startup failed. Check server-side configuration.'); process.exitCode = 1; }
}
