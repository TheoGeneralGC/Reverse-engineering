# Local mailbox read performance

This is synthetic implementation evidence from 2026-10-27, not a measurement of
the original Superhuman application or a claim of performance parity. No live
mail store, provider requests, credentials, or browser UI were used.

## First indexed read change

`Store.threads` now selects an account's records in SQLite before parsing thread
JSON. A partial expression index covers the account lookup. Folder membership,
search matching, response fields, and final date sorting still use the existing
logic, including conversations belonging to both Inbox and Sent.

Snooze checks now read only nonempty text `snoozedUntil` candidates through a
second partial index. They retain JavaScript `Date.parse` and retry-backoff
semantics, including existing offset and noncanonical timestamp strings. The
query forces this index because the planner otherwise preferred the broad
`kind` index to satisfy insertion order. It still parses every snoozed candidate;
it does not impose a lexical date comparison that could skip a due snooze.

Both indexes are created when opening an existing database without rewriting
mail records. The indexes increase storage and write work; this bounded read
benchmark did not measure migration time on a large live mailbox or sustained
sync write throughput.

## Synthetic before and after

The temporary database contained 10,000 threads across two accounts, three
messages per thread, and 2,048 plain-text plus 2,066 HTML bytes per message. The
selected account contained 5,000 threads: 3,000 in Inbox and 4,000 in All Mail.
The Store/object fixture also contained 50 drafts and 10 labels. Measurements
used Node 24.22.1 on macOS arm64, warm reads, five samples, and explicit garbage
collection between samples. Desktop background work was not isolated.

| Operation | Before median | After median |
| --- | ---: | ---: |
| Selected account Inbox, 3,000 full threads | 295.24 ms | 52.30 ms |
| Selected account All Mail, 4,000 full threads | 275.64 ms | 54.40 ms |
| Selected account body search, 52 matches | 295.17 ms | 88.63 ms |
| Bootstrap object construction | 266.94 ms | 52.37 ms |
| Snooze due check, no snoozes | 272.40 ms | 0.018 ms |
| Local snooze wake check, no snoozes | 249.88 ms | 0.014 ms |
| Bootstrap JSON serialization only | 18.25 ms | 18.66 ms |

Selected-account Inbox reads allocated approximately 136.20 MiB of heap after
the change versus 272.28 MiB before. Heap deltas are allocation observations,
not peak memory or retained memory. Unscoped `Store.list('thread')` still parses
all 10,000 records and remains expensive: 291.08 ms before and 326.14 ms after,
within these runs' broad variability.

A separate three-sample HTTP probe used an ephemeral loopback server with jobs
disabled and the same synthetic thread shape. Median time to first byte fell
from 860.67 ms to 82.84 ms; receiving the complete body fell from 879.89 ms to
98.95 ms. Client and server shared one process; client JSON parsing and browser
rendering were excluded. The before HTTP fixture omitted drafts and labels,
while the after fixture included them, adding about 61 KB.

The full bootstrap object payload remains exactly 40,649,289 bytes in the
matched Store/object fixture. This change reduces redundant reads and parsing;
it does not solve response size, full-body search allocation, rendering many
rows, or growth within a single large account. Thin paginated list responses
and lazy full-thread loading require a separate API/client change.

## Verification and limits

Four focused tests prove that scoped list/search calls never JSON-parse
unrelated-account records, ordinary mail is excluded before snooze parsing,
offset/noncanonical dates and retry rules remain valid, and reopening an older
fixture creates both indexes while preserving mixed Inbox/Sent membership.
Query-plan assertions confirm use of both indexes. The API suite passed 74 of
74 tests, and strict TypeScript checking passed after the change.

Raw benchmark scripts and result JSON remain in ignored `.local/` storage.
Only synthetic counts, timings, and design conclusions are recorded here.

## Additive thin pages

The new `GET /api/thread-summaries` endpoint returns a bounded page of explicit
metadata, total matches, and account Inbox counts. A persisted summary table is
updated by SQLite triggers in the same transaction as each thread insert,
update, or delete. A one-time atomic migration projects existing records without
rewriting messages. Common lists and counts never read full thread JSON.
Account/date and account/Inbox/snooze/date indexes support list reads; subsequent
pages use a native `(last_message_at,id)` keyset range. Search keeps the existing
account-scoped full-record matcher as a compatibility fallback.

The final-source benchmark used the same 10,000-thread fixture and measurement
conditions above. Its selected Inbox contained 3,000 full conversations. Five
Store samples produced these medians:

| Operation | Median | Heap allocation delta |
| --- | ---: | ---: |
| Legacy selected Inbox, 3,000 full threads | 62.14 ms | 136.19 MiB |
| First 50 summaries, total, and Inbox counts | 2.79 ms | 0.275 MiB |
| Next 50 summaries, total, and Inbox counts | 2.63 ms | 0.285 MiB |
| Important split, first 50 plus counts | 3.58 ms | 0.273 MiB |
| Body search fallback, 52 matches and first 50 summaries | 97.30 ms | 180.33 MiB |

The summary page was **27,828 bytes**, compared with **40,587,028 bytes** for
the legacy full-thread Inbox response. Summary-page serialization alone took
0.04 ms. The counts still scan the account's metadata rows; they are not
precomputed counters. Body search still parses full records and does not gain
the ordinary list's memory reduction.

Three loopback HTTP samples, excluding client JSON parsing/rendering, produced:

| Route | Median complete response | Payload |
| --- | ---: | ---: |
| Default legacy bootstrap | 104.19 ms | 40,649,695 bytes |
| Bootstrap with `includeThreads=false` | 0.93 ms | 62,681 bytes |
| First summary page | 3.53 ms | 27,828 bytes |

The metadata bootstrap retains 50 synthetic drafts and their bodies. It removes
only thread content. Existing clients and harnesses retain the legacy defaults;
clients must adopt the new page endpoint and fetch thread detail when opening a
conversation to receive this benefit. These are local API measurements, not
end-to-end browser measurements or an original-product comparison.

Rebuilding summaries for all 10,000 existing fixture threads took 413.79 ms in
this run. It produced 10,000 summaries and left original records intact. This
does not predict migration time for every mailbox size or body distribution.

Ten focused tests cover explicit metadata exclusion, absence of full-message
parsing on normal lists, account isolation, legacy folder/search behavior,
Calendar overlap, counts, keyset ties and new arrivals, cursor context validation,
Unicode ordering, trigger/undo/rollback consistency, migration failure atomicity,
and compatibility of both HTTP paths. The final API suite passed 85 of 85 tests
and strict TypeScript checking passed. Independent read-only review additionally
compared 1,120 synthetic threads across 20 folder choices. No live store,
credentials, provider calls, or UI were used for this work.
