# Local custom Split Inboxes — 2026-10-29

The applied API 561/frontend 536 version adds account-scoped custom Split Inboxes:
create, edit, enable/disable, overlapping membership, Important/Other exclusion,
empty-view handling, ordering and deletion. Configuration saves have immutable
keyed receipts and read-only lost-response recovery. This is a local metadata
implementation. Original custom CRUD, matching, keyboard and visual equivalence
remain unverified; no complete feature family is marked verified.

## Original evidence and scope

The [original runtime record](split-inbox-runtime.md) covers read-only Library,
blank custom form and Cancel observations. The [static record](split-inbox.md)
describes retained declarations and their coverage limits. No original Split
definition was created, edited, reordered or deleted for this checkpoint.

The local [API contract](../api/SPLIT-INBOX.md) documents the narrower supported
query grammar, header-role projection, coverage, label identity and cursors.
Lists and counts share the same imported-local eligibility and overlap policy.
No provider label/folder is changed by Split membership. Templates remain
informational; Auto Labels, dates and other unsupported criteria are unavailable
rather than silently treated as broad searches. Thread-level header matching and
the Calendar heuristic are local choices pending original comparison.

## Source and offline gates

The reviewed private API source has 168 files; frontend source has 133. Their
manifests are respectively
`b0916ecf2f2018fb70a58b0be29e076d16d0cc217d5602324f6a8d4b3a51a163`
and `15780917b585e2e08f3b7f44d4a1c156987bfcf2f36198319e4d04cccf877263`.
The frontend owner freeze originally named the earlier API 550 candidate; a
separate reviewed successor API 561 and unchanged-contract checks establish the
pair exercised here. That historical manifest was not rewritten.

Root applied 36 narrowly hash-checked source/doc/test paths. All 301 candidate
source hashes matched after application. App SHA256 is
`c85c347d57012832a80c39d9a059f5c9c9ee984e9cacbe8a17a726c968bcf3c2`.
The root dependency lock is unchanged. Node 24.22.1 gates passed 561 API tests,
536 frontend tests, production build, API strict types and all frontend test
strict types. The first sandboxed API run had 13 local-listener EPERM failures;
that result is retained. The unchanged full API suite subsequently passed with
loopback listeners enabled; no code change was used to erase those failures.

Independent reviews found and closed account/revision/receipt/navigation races,
corrupt historical acceptance, irrelevant pending-header coverage and normalized
reserved-label bypasses. Earlier owner and independent REDs remain private.

## Synthetic browser proof and retained failure

The fixture used two fictional demo accounts, eight synthetic threads, two
protected drafts and a global preference record: 15 protected records in total.
There were no tokens, grants or provider/model credentials. The guarded server
allowed only the prepared local actions. Its counters and stopped SQL audit
show zero delivery, model, Calendar, provider-draft or secret effects.

The first phase passed. The second committed the second Split save, deliberately
lost its response once, and recovered through its exact key without repeating
PATCH. Its later zero-count assertion failed: the test expected an empty inline
badge itself to be visible. Retained DOM showed the selected Important parent,
an empty badge, zero rows and a settled list. The initial capture remains failed
with one failed and two cancelled actions.

A separately reviewed three-action read-only tail established those final
states and the intended checkpoint. Derivative C/D scenarios changed only the
same empty-badge oracle and added one settled-list guard each; E stayed byte
identical. No Create or lost-response mutation was replayed.

| Capture | Result | Evidence |
| --- | --- | --- |
| Initial A | All 69 states completed | `ev_241fd772b9ff2bef05d2178dfbdbd64a6001d9d6f9ddbb1260b4dc518edbff09` |
| Initial B | 30 actions completed; failure retained | `ev_2ddae72575c5de59b52e6fc0d60679eb2e13ae60765799445fe5d78ab58b32a9` |
| Separate read-only B tail | All 4 states completed | `ev_ac20a75000ba7e30c97c749715d8002f495924e0f4997605b359a54808934eed` |
| Derivative C | All 64 states completed | `ev_43b5757586ad52a1e3565a254adf8a8c0a6cf8f1a11fd591a294f7f1fa9abc29` |
| Derivative D | All 54 states completed | `ev_94dc4e54498174fdd36343670ac45e4fddb945a3d155124459c53ae550e60323` |
| Unchanged E | All 40 states completed | `ev_1d21752a5428026b0b9a2dc4868eaa10a30e3f1150f0e7e6de0f2045ae7fe970` |

Successful captures lack events and report `equality_eligible:false` with owned
browser cleanup. Failed B has additional missing sections. The continuation
accounts for 256 completed actions, including B's successful prefix; it does not
turn the initial five-phase run into an all-pass result.

The stopped audit verified 16 read-only checkpoints, twelve unique accepted
settings receipts, one controlled response loss, exact protected records and
owned-draft content, and final removal of only the three newly created Split
definitions. Counts/pages and overlap-union exclusion were independently
recomputed from all eight fixture threads. Independent stopped-review SHA256 is
`c7b20237fa1849ec2865d9299940ef136a816911dbebfde893c5fb5d4a1db245`.

## Main rollout and regression

The stopped main database was backed up before source application. Before
restart, all protected snapshots were exact. After restart, 19 existing Draft
JSON records, seven attachment rows and bytes, three Calendar operations, six
delivery records, protected model/action tables, four sealed credential slots
and grants, and global preferences remained exact. Account differences were
limited to `lastSyncedAt`. No startup account configuration, settings receipt or
legacy provider-draft enrollment was created. Derived headers were populated
with zero pending projection jobs. Normal mailbox synchronization after restart
is outside a universal unchanged-thread claim.

The separate full demo run `20261029T012457Z` passed 16 cases/407 steps and all
eight persisted assertions, with 165 stable source-manifest entries, no captured
page errors and all owned browsers terminated. Reply-all still lacks events and
is not equality eligible; its exact POST/201 assertions passed. Full identities
are in [browser scenarios](scenarios/README.md). This remains synthetic replica
regression, separate from the [earlier real mapped Send](mapped-send-live-check-20261029.md).

Open acceptance includes original custom Save/edit/order/delete comparison,
template activation, full query/classifier semantics, complete remote-mailbox
coverage, hide-empty/default policy, cross-tab UI conflicts and pixel/motion/
accessibility equivalence. Real emails, captures, databases and vendor source
remain private.
