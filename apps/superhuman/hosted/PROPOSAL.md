# Protected Vercel feedback release

**Historical option, not approved.** The user selected hosting the backend on
Vercel too. Do not provision this Render service. An all-Vercel backend adaptation
is underway; this record retains the reviewed disk-backed alternative.

Prepared for the user's production-release request on October 29, 2026. This
releases the current reconstruction for feedback; full Superhuman parity remains
unfinished. No paid backend has been provisioned by this proposal.

The browser will run in the existing Vercel workspace `generalgc`, project
`rea-superhuman` (`prj_5VT0qF2SrSQWPuTN9Pk84POwAI8n`). Vercel Authentication must
protect **All Deployments**, including the production domain. Default Standard
Protection leaves production domains public. No public share link or bypass is
part of this release. [Vercel protection](https://vercel.com/docs/deployment-protection)

Reserved production URL: <https://rea-superhuman-generalgc.vercel.app>. The hosted
Google redirect URI is this origin followed by `/api/auth/google/callback`.

The API needs an attached persistent disk and a single long-running Node process.
It currently uses synchronous SQLite transactions, native-operation receipts and
in-process job ownership. The proposed backend is Render in Oregon, separate
from the already-deployed tracking collector. Vercel's current Daemons do not
provide persistent filesystem storage. [Vercel Daemons](https://vercel.com/docs/daemons)

| Resource | Proposed monthly baseline |
| --- | ---: |
| One Render web service, `0.5c-512mb`, 0.5 CPU / 512 MB | $7.00 |
| One 1 GB persistent disk | $0.25 |
| **Backend baseline** | **$7.25** |

Bandwidth/build overages, taxes, any workspace charges and model/provider usage
are additional. No workspace upgrade, custom domain or DNS purchase is proposed.
The final Render console quote and billing eligibility must be checked before
purchase; a material difference requires a revised approval. The 512 MB capacity
and 1 GB disk are initial choices, subject to synthetic startup/sync measurements.
[Render pricing](https://render.com/pricing),
[compute plan IDs](https://render.com/docs/compute-plans),
[published Starter price](https://render.com/articles/render-vs-railway),
[published disk price](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses)

The adjacent `render.yaml` describes one `rea-superhuman-api` service, manual
deployments from `codex/superhuman-parity`, a disk at `/var/data` and the database
at `/var/data/superhuman/mail.sqlite`. Applying it creates paid resources and an
initial deployment. Persistent disks prevent horizontal scaling and require
brief deployment downtime. [Blueprint reference](https://render.com/docs/blueprint-spec),
[disk behavior](https://render.com/docs/disks)

The hosted database starts fresh. Existing local email, draft rows and OAuth
tokens will not be copied. The user connects Gmail through the protected site;
the Google Web client receives that site's exact HTTPS callback URI. New hosted
encryption and origin keys are independent of local keys. The approved sender
and recipient restrictions remain in force. Responses, effective read tracking
and Calendar writes do not become enabled merely by deployment.

Only the server receives Google/Claude credentials and token-encryption keys.
Vercel receives the dedicated `ORIGIN_SECRET` as a sensitive, Production-only
variable; no `VITE_` variable contains a secret. An external `/api` rewrite sets
the origin header, replacing any visitor-supplied value. The backend authenticates
it before passing requests to the mail API. Direct unauthorized backend requests
receive no mailbox content. The public `/healthz` reveals no account state.
[Origin restriction](https://vercel.com/docs/routing/rewrites#restricting-your-origin-to-vercel-traffic)

The build produces static files plus Build Output API routes. Production requires
an exact HTTPS `API_ORIGIN` and the origin secret; previews contain no external
API route and return a clear 503 response for email calls. API caching is disabled
in routing and the backend. [Build Output API](https://vercel.com/docs/build-output-api),
[route configuration](https://vercel.com/docs/build-output-api/configuration)

Before connecting Gmail, verify protected HTML/API access, direct-backend denial,
same-origin reads and changes, a synthetic 10 MiB transfer, streaming, OAuth cookie
round-trip and committed state across restart. A real hosted mailbox connection
requires the user's provider sign-in. Keep backups of the encryption key paired
with application-consistent SQLite backups; never restore disk snapshots over
an active custom database. This proposal makes no claim of absent provider logs.

Approval needed: the additional Render host and **$7.25/month baseline plus
usage/tax**. The repository's `AGENTS.md` says, “Ask before account-wide mutations
or purchases.” Production release itself is already authorized.
