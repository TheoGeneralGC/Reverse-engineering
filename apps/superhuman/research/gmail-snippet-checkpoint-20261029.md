# Fresh Gmail snippet checkpoint — 2026-10-29

The applied fix decodes character references **once at fresh Gmail snippet
import**, stores ordinary text, and retains safe React string rendering. It does
not decode stored snippets, MIME text/plain or HTML bodies, subjects or headers.
The exact-source hoisted gate passed **687 API tests**, followed by five focused
public tests and strict checks. Frontend 652, collector 53 and the separate Vercel 23
package counts are unchanged; no broad browser regression was repeated.

## Representation boundary and limits

Root observed entity spellings in ordinary local Inbox previews. Source traced
raw `lastRaw.snippet` directly into Thread.snippet, the list metadata projection,
and a React text child. The change applies `gmailSnippetToText` only at that
fresh provider assignment. The decoder is explicitly pinned `entities` 8.1.0,
with BSD-2-Clause licensing and registry/tarball integrity verified. React still
renders the result as text; tag-looking characters do not become HTML markup.

Google's primary [Message](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
and [Thread](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads)
resources describe snippets as text excerpts but do **not** guarantee an entity
escaping format. The correction is a source-based inference explaining the local
symptom, not proof of original Superhuman snippet behavior. Google's separate
[MIME body representation](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments#MessagePartBody)
uses base64url data; that layer remains unchanged.

One pass turns `Cedar&#39;s &lt;plan&gt;` into `Cedar's <plan>`. A literal example
encoded as `&amp;lt;tag&amp;gt;` becomes `&lt;tag&gt;` and stops. A second decode
would change its meaning. Unknown named and the tested malformed/unterminated
spellings remain literal under the strict codec. The representation boundary,
rather than a repeated string cleanup, supplies the once-only guarantee.

Existing cached snippets are not blindly converted. A provider thread ID does
not identify the string's representation. Future ordinary sync can replace a
snippet from fresh data; an explicit paced/resumable authoritative refresh for
unchanged cached rows remains **pending**. Such a repair must bind the selected
account/provider thread/latest message and recheck the current local record before
committing, skipping late/deleted/changed rows. No repair or data migration ran.
This checkpoint does not claim every old preview is already repaired.

## Source, dependency and test identities

The preserved first preparation freeze is
`6a4970ba36198b312c4abfd12905e5d4bcb22b30342d52b4033b88acfb80caae`.
It was based on a private API693 candidate; that service version was not copied
into Main. Its test had unrelated Auto Drafts calls unavailable on public 682.
The public-compatible HOLD2 removed those calls while preserving the codec and
body/header/attachment/account/call assertions. The first compatibility failure
remains retained. HOLD2 freeze is
`509b46d1257fd8d1792274e2062689eaba0a1d44ac441659a3cac3c607bea59c`.

Five paths were applied: the Google assignment/import, new codec, new test, API
package pin and one Root lock dependency line. The existing package entry was
already integrity-bound at 8.1.0; no broad lock normalization or scripts change
occurred. Root lock SHA256 is
`a1065a1517a6fe90e5d103ad7aec8bca7be138cc2063a67bce955de4fcc72bbf`.
All 53 installed package files matched the verified private version. The private
standalone lock was not substituted for the workspace lock.

The final five synthetic tests pass with explicit memory App/database environment,
jobs and provider autosave off, exact stubbed Google reads and denied real model/
provider transport. They cover strict references and literal examples, actual
sync latest-message selection, repeated fresh import, unchanged MIME text/HTML,
headers and attachment bytes, normal list projection, other-account isolation,
no draft/delivery effects, and untouched stored local examples. The same final
five against the old raw assignment yield **four PASS/one RED**. These are five
new cases, not a new original comparison.

The initial standalone full gate remains **681 PASS/six Knowledge worker FAIL**:
the actual child permission check denied reading the private api/node_modules
directory while parser grants named individual package roots. It is retained as
a layout limit, not relabeled a passing gate or a snippet failure. An exact-source
separate hoisted integration copy then passed **687/687**, with no runner source
change or permission widening. It bound 394 source entries, including 204 API
entries; the code/tests are the same. Root also passed the public focused five and
strict gate. Full 687 log SHA256 is
`7d4048829adbaa736e9650d57db6d43384cb107f64a4fd74181490fde69d9ae0`.

## Rollout and retained data

Root made a read-only backup and verified all 88 tables, rows and schema exact
while stopped after applying the source. After restart, schema still matched;
strict whole-database logical equality was **false**, with named normal-sync
changes classified: six account/sync/syncHealth timestamp records, five
calendar_sync rows' JSON updatedAt/lastCompletedAt/nextSyncAt, and two derived
Split counters. No broad exclusion was used.

All 19 Draft records, seven attachment rows/bytes, four sealed credential
ciphertexts and all other record kinds remained exact; six delivery records
were protected. Root verified HTTP 200 for API/web and a full rendered Inbox.
This is a point-in-time integrity/serving check, not an encoded-preview browser
comparison or another 407-step regression. Root final rollout record SHA256 is
`8c030db51c4e9058fb0368117d4724f3338f31f97b358a6257967c7449598c59`.

| Case | Supported scope | Remaining limit |
| --- | --- | --- |
| SN-01 raw snippet | Five synthetic cases and actual stubbed sync establish one-pass fresh import and retained literal examples | Gmail escaping is not a documented guarantee; original comparison absent |
| SN-02 content isolation | Body/HTML/header/attachment/account assertions, safe text sink and protected rollout data | No broad browser or original rendering parity claim |
| SN-03 old cache | Stored strings remain untouched; no bulk decoder/migration | Authoritative bounded refresh pending; not all old previews claimed fixed |

The Split 101 and previous 652-suite/407-step identities remain separate, including
all original limitations and retained failures. The earlier received plain-text
assertion [remains failed without resend](mapped-send-live-check-20261029.md).
Vercel remains source-only with account access 403 and no deployed service;
its separate package count is not added to collector 53. No private Auto Drafts
service/generation candidate, identity helper, provider send or original action
was included in this rollout. The full feature family remains in progress.
