# Protected hosted feedback release preparation

The user requested a usable Vercel release and authorized ongoing production
pushes and GitHub updates. The release package builds on applied commit
`5aacd6a33856e7872edb63d88f493271101a4eff` (1035 API/766 frontend tests at its
existing validation boundary). It does not apply the separate Command/Trash
candidates or establish complete Superhuman parity.

## Prepared architecture and account state

The browser is assigned to Vercel project `rea-superhuman`, ID
`prj_5VT0qF2SrSQWPuTN9Pk84POwAI8n`, in workspace `generalgc`, ID
`team_jLr36BtWNJTPsp5X8UMwQLWN`. All Deployments Vercel Authentication is enabled
and read back. The team inventory contains one confirmed owner. The domain
`rea-superhuman-generalgc.vercel.app` is assigned and verified. A later domain
inventory also lists the default `rea-superhuman.vercel.app` on this project;
the initial duplicate-registration response did not establish another owner's
use. The longer reserved name remains the configured canonical frontend origin.

The proposed API is one Node 24 process on Render with a persistent SQLite disk.
This preserves the current synchronous transactions, durable provider-operation
receipts and process ownership. The [proposal](../hosted/PROPOSAL.md) and
[Blueprint](../hosted/render.yaml) specify the additional $7.25/month baseline
and require purchase approval. No paid resource has been provisioned. The
existing Vercel tracking collector remains unchanged.

The new hosted entry point validates explicit configuration, authenticates the
Vercel origin secret before dispatch, checks Host/Origin, removes forwarding
hints, secures cookies and disables caching. It reuses both existing runtime
configuration loaders and leaves local API source unchanged. The database starts
fresh; local mail and tokens are not copied. Production routing receives a
server-only environment secret. Preview builds cannot reach the production API.
These are deployment design choices, not observed original-product behavior.

## Local validation

Root ran all 16 combined gateway/routing controls successfully. The final added
response-header assertions also passed a separate focused check. Tests use
explicit temporary `databasePath` values with matching `env.DATABASE_PATH`, and
the external-fetch denial counter remains zero. Coverage includes rejected
credentials/Host/Origin, forwarded-header stripping, generic errors, Secure OAuth
state cookies, first-byte streaming, shutdown ordering, a synthetic 10 MiB
attachment across restart and a durable uncertain delivery that remains locked.
This is local transport/recovery proof, not Google or hosted proxy proof.

Independent review found no actionable issue after the canonical-secret and
shutdown corrections. Runtime TypeScript checks and official Vercel/Render schema
validation pass. A clean Git archive installed 274 pinned packages and completed
frontend types/build without private assets or the unrelated untracked project.
The Docker COPY-equivalent isolated layout installs only 39 production packages
and imports the complete hosted runtime successfully with the pinned Node build.
The first sandboxed install failed with registry DNS denial; the network-enabled
isolated install passed. The build retains font-resolution and large-chunk
warnings. Private reference fonts are absent from a clean deployment.

The official `node:24.22.1-bookworm-slim` tag was verified through Docker manifest
inspection, including its Linux amd64 manifest. No Docker daemon is running, so
image construction and container execution remain unverified.

## Vercel frontend preflight

The Git-connected first production attempt, `dpl_6tcBHwYKaUXRnALnPRNicrvUBjQV`,
clones exact commit `647ad275a8e547d307ddd30d726315ca9a6c6b39` and refuses to build
without `API_ORIGIN`. The retained build error is the intentional configuration
guard, not a successful mail release. The request to create a preview with the
literal target `preview` was rejected before creation; the documented API uses
an omitted target for previews.

The corrected preview, `dpl_7sJHzSnJRzCaA3bYCZofWsQeqPUw`, is READY on that exact
commit using Vercel's Node 24.22.2. Anonymous page and API requests both return
302 redirects. The already signed-in Chrome session opens the actual built app
and displays the configured preview API error. This verifies protected static
serving and the preview API boundary, not a working inbox or real backend.
The subsequent copy correction states simply that email is unavailable in a
preview. The production domain still has no usable mail release.

The connector's authenticated-fetch check was rejected by automatic approval
review because it may create a 23-hour share link. No link was created by this
workflow; normal signed-in browser inspection provided the safe alternative.

The stopped local app was restored using the existing source/configuration. A
native read-only selected-state audit preserves all 20 drafts and seven
attachments. Four sealed rows remain, with changed ciphertext hashes after
restart; the selected protected-state equality assertion therefore failed and
remains false. No all-table equality or cause of ciphertext changes is claimed.
All six selected unsettled-operation counts remain zero. This local restoration
does not transfer data to either hosting provider.

## Release acceptance still required

- Approve and provision the separate API service/disk, then verify its exact
  image build, single process, mounted database and initial synthetic state.
- Verify unauthenticated Vercel HTML and API requests are blocked; direct API
  requests without the origin secret must disclose no mailbox data.
- Verify protected same-origin reads/changes, uncached responses, a 10 MiB
  round trip, streaming and committed data across replacement/restart.
- Register the exact hosted callback on the existing Google client and verify
  OAuth cookie/redirect behavior through Vercel. The user completes provider
  sign-in to create fresh hosted credentials.
- Release the tested production build and inspect runtime failures. Preserve
  existing delivery-test recipient restrictions and all uncertain receipts.

The user still needs a live, verified application URL. All 22 feature families
remain open and unverified; hosting preparation does not change their status.
