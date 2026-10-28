# Private candidate: legacy mail-grant metadata adoption

This candidate is based on the unchanged 83-file root API325 snapshot recorded in
`../baseline.json`. It has not been applied to the root application or a live DB.

`createApp` explicitly calls `GoogleProvider.migrateLegacyMailGrants()` once after
constructing the provider and before creating jobs/services. Provider construction,
GET routes, grant reads, status and Send policy do not trigger adoption. If the
batch cannot commit, startup closes its Store and fails; policy is not relaxed.

The provider must have its normal Google configuration and a valid encryption key.
The migration selects only an existing account's exact mail-secret slot and an
absent `mail:<accountId>` grant record. An account must be a stored Google account
whose row ID and JSON ID agree with `google:<lowercased email>`. Demo/orphan,
noncanonical/mismatched or malformed accounts are skipped. Calendar-prefixed
secrets and Calendar grant records are neither adopted nor modified.

The existing authenticated-encryption envelope must be canonical and bounded.
Decrypted caches must use the known `access_token`, `refresh_token`, `expires_at`,
`grantedScopes` shape: bounded nonempty printable credentials, a safe positive
expiration integer, and an explicit bounded array of valid OAuth scope tokens.
Unknown/alias cache schema is conservatively skipped. A scope array must include
an exact recognized Gmail modify scope or full-mail scope; readonly, omitted,
malformed or ambiguous scope data never becomes a grant. Repeated identical scope
tokens are deduplicated as a set. No tokens are refreshed, rewritten or resealed.

An adopted row records `service:'mail'`, `scopeSource:'token-cache'` and the observed
cached scopes. `requestedScopes:[]` means the original requested scopes are unknown.
`updatedAt` is local metadata-adoption time. `outcome:'granted'` describes the cached
scope set, not fresh consent. No OAuth-attempt record is created. Every existing
mail grant row wins by SQL presence, even when null, malformed, narrower or partial.

The batch owns one `BEGIN IMMEDIATE` transaction. An unexpected write failure rolls
back every adopted row. Repeated startup is idempotent; existing records are not
rewritten. The method rejects an outer transaction rather than committing a caller's
work. Existing sender/recipient approvals and Send policies are unchanged.

This trusts the last-observed encrypted cache's local association with its account
slot. The historical encryption format does not itself establish current remote
identity or permission. An expired access credential with a valid refresh credential
can retain last-observed scope metadata; adoption does not validate either credential
or perform a refresh. Revocation, narrower actual provider access and identity remain
provider-enforced concerns. The migration is not a new consent or verification claim.

Tests use only synthetic encrypted caches in explicit memory/temp Stores or Apps
with matching isolated `databasePath` and `env.DATABASE_PATH`. Fetch stubs reject any
provider call. Existing token/account/grant/OAuth bytes, batch rollback, service/account
isolation, malformed caches and restart behavior are checked. No real cache, key,
account address, environment file, browser or provider was inspected by this work.
