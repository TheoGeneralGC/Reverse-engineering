# Hosted Superhuman feedback release

The user has selected hosting both frontend and backend on Vercel. The Render
Blueprint below is an unapproved historical alternative; do not apply it.
The all-Vercel backend adaptation is in progress and is not yet released.

The browser runs on Vercel behind Vercel Authentication for **All Deployments**.
One disk-backed Node process runs the existing mail API. This release uses a
fresh database; connect Gmail from the protected site after deployment.

Review [the deployment proposal](PROPOSAL.md) before provisioning the paid API
service described by [render.yaml](render.yaml). The separate tracking collector
is unchanged. This deployment does not establish complete Superhuman parity.

## Local verification

Use Node 24.22.1 or a compatible supported runtime, then run from the repository:

```sh
npm ci --ignore-scripts
npm test --prefix apps/superhuman/hosted
```

The hosting tests use temporary databases and synthetic data. They cover denied
requests, streaming, secure cookies, a 10 MiB attachment across restart and an
uncertain delivery that remains locked without replay. They make no provider
requests. Actual Vercel routing, Google sign-in and mounted-disk checks must also
pass before connecting real mail.

## Deployment configuration

Set the Vercel project root to `apps/superhuman/web`, framework to Other, Node to
24.x, install command to `npm ci --ignore-scripts`, build command to
`node ../hosted/ops/vercel-build.mjs`, and leave the output-directory override
unset. Production requires `API_ORIGIN` and sensitive `ORIGIN_SECRET` variables.
The generator writes Build Output API configuration without including the secret
value. Preview builds cannot reach the production API.

The API uses `apps/superhuman/hosted/Dockerfile` with the repository root as its
build context. Its Docker-specific ignore file admits only the required source
and package metadata. Keep exactly one instance with its persistent disk mounted
at `/var/data`. Set the server-only variables in `render.yaml`; keep credentials
out of source and logs. `ORIGIN_SECRET` is a new random 32-byte lowercase hex
value shared only with the protected Vercel project. `TOKEN_ENCRYPTION_KEY` is a
separate new 32-byte hex key. Back up that key with application-consistent
database backups.

`WEB_ORIGIN` is `https://rea-superhuman-generalgc.vercel.app`.
`HOSTED_API_ORIGIN` must be the exact HTTPS API origin assigned by the host.
`GOOGLE_REDIRECT_URI` must equal
`https://rea-superhuman-generalgc.vercel.app/api/auth/google/callback`; register
it on the existing Google OAuth Web client. The API rejects nonmatching browser
origins, direct requests without the origin secret and incorrect Host values.
Only `/healthz` has a public, account-independent response.

The hosted entry point uses the same runtime configuration loaders as local
development. Initial Responses and tracking preferences remain off; credentials
alone do not activate them. Existing approved test-recipient restrictions remain
in force. Calendar is initially disabled in the deployment template.

On shutdown the gateway rejects new work, drains client connections for up to
20 seconds, then waits for actual in-flight route work before closing the API
and SQLite. A hosting-platform hard stop can interrupt a provider request;
durable uncertain-operation receipts remain locked for reconciliation instead
of being automatically replayed. Deployments with the attached disk have brief
downtime to preserve single-process ownership.
