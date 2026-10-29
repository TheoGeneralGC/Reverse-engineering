# Main read-tracking contract

Local design contract, not a recovered original server API. Account defaults are explicitly disabled and are not claimed to be original factory defaults. Desired preferences are independent of configured collector capability. No constructor, startup, GET preferences or key recovery calls the collector. No legacy draft/message enrollment is included. This successor also has the internal mapped delivery integration described in [TRACKING-DELIVERY.md](./TRACKING-DELIVERY.md); current effective read/feed capability is derived as described below; Main remains
configured/operator-verified with desired flags off/effectivefalse at the [combined checkpoint](../research/final-combined-checkpoint-20261029.md).

## Browser contract

Browser-safe types are in `src/tracking-types.ts`.

- `GET /api/tracking/preferences?accountId=...` returns `TrackingPreferencesResponse` without persistence/network side effects. An absent account-specific row is revision0, persistedfalse, desired `{readStatuses:false,recentOpens:false}`, provenance local-disabled-default.
- `PATCH /api/tracking/preferences` takes `{accountId,clientRequestId,expectedRevision,desired:{readStatuses,recentOpens}}`. One transaction writes an account-only CAS value and immutable request receipt. Query parameters are refused.
- `GET /api/tracking/preferences/requests/by-request/:key?accountId=...` recovers the exact historical accepted snapshot/receipt; no POST replay. A404 after uncertain transport remains unresolved. Fetch current preferences separately before using a historical capability snapshot.

Recent Opens desired true requires Read Statuses desired true; inconsistent input is rejected, not silently enabled. This coupling is an explicit local policy supported by static declarations, not a runtime default/entitlement claim. Saving true is allowed while no collector is configured; capability still reports effectivefalse. Current capability requires a configured collector, matching private operator
verification, constructed delivery/read services and account desires. Recent
Opens also requires its own desired flag. Missing/unverified configuration or OFF
preferences stays ineffective. A saved switch never fabricates a cache snapshot,
message event, named viewer or human-read proof. Historical receipts preserve
the accepted capability snapshot; a fresh current GET is separate.

Fingerprint protocol: SHA256 of UTF8 recursively key-sorted JSON `{protocol:"tracking-prefs-v1",request:exactValidatedRequestExceptClientRequestId}`; arrays preserve order. The receipt echoes the exact typed request. Same account/key with a different request conflicts; same intent recovers before current CAS checks. Every accepted save advances revision by1, including explicit no-op intent.

No key, collector origin, token URL, tenant/account opaque ref, mail body or credential is returned to the browser. Configuration fingerprints are opaque binding digests and prove configuration identity only, not collector availability.

Errors use `{error:{code,message}}`:400 tracking_invalid_request,404 tracking_not_found,409 tracking_revision_conflict/tracking_request_conflict,500 tracking_artifact_corrupt. Definite PATCH validation/conflict failures are before acceptance; recovery404/500 after an ambiguous PATCH must keep its journal.

## Server-only client boundary

A separate explicit transport client imports the sibling collector's own `protocol.ts` for native canonical target/HMAC signatures. It requires server-supplied HTTPS origin, opaque tenant, key ID, generated/private key bytes and injected transport. It never reads environment or credential files. Construction and capability reads do not probe it. No automatic mutation retry exists: uncertain POSTs require explicit exact-key GET recovery with their frozen intent. A new signature nonce for a read does not create a new registration intent.

Registration/current/receipt responses must bind exact opaque identity, state, revision, timestamps and native raw-body fingerprint. Event pages must bind selected account and caller-owned confirmed registration mappings, tenant/account cursor context, fixed snapshot/revision and bounded event identities. Anonymous image fetch remains viewer null, humanReadVerifiedfalse. Collector events cannot establish Sent, identify a named recipient, or authorize resend.

The separately reviewed internal delivery successor adds generation binding, immutable wire MIME and explicit held/native/confirmation controls; see [TRACKING-DELIVERY.md](./TRACKING-DELIVERY.md). The separate [explicit local read import](READ-IMPORT.md) provides cache/feed
views and keyed refresh recovery. Browser data exposes no collector registration
or pixel-fetch authority. No implicit startup job sends or enrolls mail.

## Explicit construction and client methods

`createApp({trackingCollector:{origin,keyId,tenant,key,transport,now?,nonce?,timeoutMs?}})` is a server-only programmatic injection. It validates configuration before opening Store and owns client shutdown. The CLI loader accepts the existing private signer configuration and optional
`TRACKING_COLLECTOR_SOURCE_IDENTITY` / `TRACKING_OPERATOR_VERIFICATION_FILE`. The
operator file requires the source identity and the same bounded canonical0600
file checks as the signer. A matching record binds configuration/origin/source
and point-in-time evidence without probing the host. Omission keeps configured
false; configured without matching verification stays unverified. A configured origin is a canonical HTTPS DNS origin without userinfo/query/path/fragment or IP/local host spelling. This is syntax/configuration validation, not DNS ownership, reachability, TLS provisioning or hosting proof. A stable deployment and separately reviewed key provisioning remain required.

`TrackingCollectorClient` supports explicit create/recoverCreate, transition/recoverTransition, current and events. Mutation input is the collector's native exact field object. Transition takes the previously verified registration basis. Recovery always uses GET `/v1/requests/:operationId` with the same frozen intent, not another POST. Current reads require expected registration/account/delivery/token identity; known basis cannot regress. Event reads accept only opaque accountRef plus up to10k known confirmed registration bindings, limit1–100 and an optional native cursor. No mailbox/body/contact object is accepted.

The client imports `../../collector/src/protocol.ts` directly. Requests use native exact JSON body ordering and raw-body fingerprint, canonical sorted query, the shared signature function and a fresh24-byte nonce. The key is copied into a private class field and cleared on close. Keys, origins and transport configuration cannot escape through instance JSON serialization or browser preferences. Close aborts in-flight calls; no late validated result or automatic retry is adopted.

Response bounds are128KiB, default5s (explicit1ms–30s test/server control),16 concurrent calls, and native protocol field/identity/state/revision/time bounds. HTTPS redirects are refused. Response errors are mapped to fixed local codes; provider text/URL/key values are never attached as causes or messages. A transport or invalid POST response is unresolved. A current/recovery404 after an ambiguous mutation remains unresolved. Recognized native4xx means the current supplied request was rejected, not that an earlier unknown attempt never existed. No error authorizes automatic replay.

Optional cursor, limit and known registration basis are omitted with `undefined`; explicit null is invalid before transport. Clock/nonce callback failures are fixed invalid-input errors without their original error text. Response receipt/current/event timestamps are bounded by the validated timestamp used to sign that request plus native clock skew; the response decoder never rereads the injected clock. This conservative request-time bound is a local validation policy, separate from collector clock or delivery timing proof.

Cursor payload syntax/context is checked against tenant/account and fixed through/revision; the collector remains responsible for verifying its private cursor MAC. The main client does not possess that cursor key. Every returned event is matched to a supplied exact confirmed registration/delivery/ACK binding, with anonymous viewer/evidence/device/proxy/clock bounds. Unknown mappings fail the page rather than silently disappearing. Snapshot event bounds and cumulative throttling are distinct; fullMailbox/humanReadVerified remainfalse. Main local import/store/feed routes are documented separately in [READ-IMPORT.md](READ-IMPORT.md).

New source uses only Node builtins and the frozen sibling protocol. API561's two cross-layer tests require four unchanged browser-safe source companions (api/provider client/status/discard) under the private `web/src`; these are hash-bound test support only, not frontend integration. No App, env, database, dependency installation or original source was copied into that companion.


New tracked acceptance requires matched operator verification before collector or
provider issue; it never silently falls back to untracked delivery. Existing
known-key recovery remains bound to its original immutable packet/configuration.
The optional record is not active uptime, a remote-source attestation or a human
read. Hosted synthetic validation is separate in the
[deployment checkpoint](../research/vercel-deployment-checkpoint-20261029.md).

One separately approved [controlled mapped tracked delivery](../research/tracked-delivery-checkpoint-20261029.md)
now has native Send/collector-confirmation plus one explicit anonymous fetch and
cached read proof, with strict recipient body differences retained. Main now has matched operator configuration but desired flags remain off and
effectivefalse. This does not promote effective-ON Main behavior, a person-read
or original-parity claim.
