# Private storage for the all-Vercel backend

The user selected hosting the backend on Vercel. The workspace `generalgc`
already has Pro. This proposal covers the dedicated private Blob resource needed
for large attachments and Knowledge uploads; it does not activate a daemon or
approve a new plan.

**Approved and created:** the user approved this resource and its stated rates.
The store is private in `iad1`, connected only to `rea-superhuman` Production.
Its legacy read-write token environment variable was removed in favor of
short-lived workload authentication. No existing local emails were uploaded.

Proposed resource:

- Name: `rea-superhuman-mail-files`.
- Workspace: `generalgc`; project: `rea-superhuman`.
- Region: `iad1` (Virginia); access: **private**.
- Server-side access only, with exact short-lived upload/download grants for
  browser transfers. No public store or reusable browser signing key.
- Temporary transport objects, verified by byte count and SHA-256 before the
  existing mail API receives them. Object references must be opaque handles,
  never arbitrary caller-provided URLs.
- Application staging quota of 1 GiB, with explicit expiry and cleanup of owned
  completed transfers. Uncertain native operations retain their records.
- Initial cloud checks use synthetic 10 MiB attachment and 50 MiB Knowledge
  fixtures; existing local mail and tokens are not copied.

The existing API accepts files larger than Vercel Functions' 4.5 MB payload
limit. Direct private Blob transfers preserve that capability without routing
all file bytes through a Function. [Function limits](https://vercel.com/docs/functions/limitations),
[private storage](https://vercel.com/docs/vercel-blob/using-blob-sdk)

There is no fixed subscription fee for this store. Current Virginia on-demand
rates are $0.023 per GB-month stored, $0.05 per GB of Blob transfer,
$0.40 per million simple operations and $5 per million advanced operations.
Creation counts as one advanced operation. Other applicable delivery/network
charges and taxes may apply. Existing Pro credits can offset usage; their
remaining balance is unknown. [Current rates](https://vercel.com/docs/vercel-blob/usage-and-pricing)

Automatic approval review rejected the first creation attempt because a new
persistent store may incur ongoing charges without specific resource/cost
approval. No store was created by that rejected attempt. The subsequent explicit
approval allowed creation; live transfer and complete backend release checks
remain pending.
