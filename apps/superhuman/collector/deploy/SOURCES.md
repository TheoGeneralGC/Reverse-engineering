# Authoritative sources checked2026-10-29 UTC

No recommendation relies on third-party tutorials. Prices/specs are current
published observations, not an account-specific reservation or quote.

| URL | Facts used |
| --- | --- |
| https://render.com/pricing | $7 compute tier; disks$0.25/GB/month; current Hobby5GB bandwidth then$0.15/GB; actual invoice may differ |
| https://render.com/docs/compute-plans | 0.5c-512mb is0.5CPU/512MB; legacy Starter remains accepted |
| https://render.com/docs/disks | paid single-instance disk; runtime-only mount; downtime;24h snapshots/seven-day retention; custom-DB recovery warning |
| https://render.com/docs/blueprint-spec | Docker fields, manual autoDeployTrigger off, sync:false inputs, disk/health schema |
| https://render.com/docs/web-services | unique onrender name, managed HTTPS,0.0.0.0/port10000 |
| https://render.com/docs/health-checks |2xx/3xx healthy; probes use verified domain or onrender Host |
| https://render.com/docs/node-version | Node24.22.1 supported/default since2026-10-21; Docker runtime pinned independently |
| https://render.com/docs/docker | Docker build/context behavior and secret build-argument caveat |
| https://render.com/docs/environment-variables | PORT, RENDER_EXTERNAL_URL and RENDER_EXTERNAL_HOSTNAME |
| https://render.com/docs/logging | Pro+ public HTTP request logs include URL/path; plan-specific retention7/14/30days |
| https://render.com/docs/rollbacks | disk/current infrastructure persists; image digest improves repeatability |
| https://render.com/docs/ssh | operator access and Docker account/shell requirements need actual validation |
| https://hub.docker.com/v2/repositories/library/node/tags/24.22.1-bookworm-slim | public Official Image tag is active; immutable index and amd64 digests recorded |
| https://raw.githubusercontent.com/docker-library/official-images/master/library/node | official-image publisher/Node image lineage; current moving24 tag is a different patch, so no floating tag used |
| https://fly.io/pricing/ | alternative compute example/traffic costs, not selected |
| https://fly.io/docs/about/pricing/ | alternative volume and snapshot billing, not selected |

The DockerHub metadata API failed through web-tool access and default sandbox
DNS. A single successful read-only public HTTPS metadata request with network
permission supplied the tag/digest fields. No image layers, executable, account
credential or private token were fetched. The observed fields are retained in
sources/docker-node-image-observation.json. No Render console/API/account was
accessed. Occasional web fetch errors do not establish a host outage.
