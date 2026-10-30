# Inactive authentication foundations

The current hosted beta remains protected by Vercel Authentication and runs one
trusted owner's mail store. It is not ready to admit unrelated Gmail users.
These modules prepare application identity and tenant authorization; the default
Function and worker entrypoints do not import or activate them. No live schema,
identity mapping, session key, login route or mailbox grant is installed by this
change. The modules' constructors do not create tables or provision users.

## Implemented design

- Google login verifies ID-token signatures and issuer/audience/authorized-party,
  nonce, expiry and issued-at policy through pinned `openid-client` 6.8.8. Login
  attempts bind PKCE, browser generation and purpose, are consumed once before
  exchange, and do not retry an ambiguous provider exchange.
- An operator-provisioned registry maps the canonical Google issuer and opaque
  subject to one personal user/tenant and an explicit storage catalog entry.
  Email addresses are display metadata. No first-login ownership claim, email
  join, automatic provisioning or default tenant exists.
- Server sessions use keyed authentication, revocation and authorization epochs,
  bounded idle/absolute lifetime and captured CSRF. Core reads as well as writes
  require authenticated authority. Host, Origin and fetch metadata checks remain
  independent controls.
- The optional gateway captures each request's authority and atomically binds an
  authenticated command sidecar with its durable enqueue in one primary
  transaction. Receipts, body manifests, signed file grants and worker dispatch
  remain scoped to the server-derived assignment. A queued command revoked before
  dispatch becomes a known non-dispatch result. Corruption fails closed.
- Work already admitted to a native provider boundary may finish. Session
  revocation is not claimed to cancel an issued provider operation. Legacy
  commands without authenticated sidecars are neither adopted nor replayed.

The SQL files under `test/` are fixture schemas, not production migrations. Test
keys, identities, mail and signed responses are synthetic. Native SQLite tests
select explicit isolated database paths and close the databases they open.

## Validation and remaining activation work

The accepted source passed 53 focused identity, OIDC, login-broker, gateway and
command-sidecar checks plus strict types and independent review. These test
direct Core composition with owned numeric-loopback HTTP and fake provider/Blob
ports; they establish neither real Google login nor cloud SQL behavior. A
separate private WorkerThread composition has additional bounded evidence, but
its fixture and later browser integration are not part of this commit.

Before activation, the application still needs session UI and unsent-buffer
recovery, owner-scoped browser state, explicit legacy-owner enrollment and
cutover, session-bound mailbox linking, user Send/Calendar authorization distinct
from agent test permissions, tenant scheduling/capacity and lifecycle controls,
real Safari acceptance, and Google public-onboarding requirements. Keep Vercel
Authentication on. Do not enable these modules by removing deployment protection
or by merely adding OAuth test users. No full Superhuman parity is asserted.
