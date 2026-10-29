# Date-search comparison — 2026-10-29

A controlled existing message exposed a concrete original/replica mismatch.
Its imported timestamp is **2026-10-29T00:50:41.000Z**. The original included it
before October 29 when the query used slashes, while the current replica used
UTC for both date spellings. A separate ISO-date query included it in the
original. No new message was sent and no conversation or draft was opened.

## Bounded runtime comparison

Pinned REA 6.8.0/skill49 operated the existing authenticated personal-account
Chrome target at `mail.superhuman.com`, Chromium 156.0.8078.48. Each search was
restricted to the exact fictional subject **REA Mapped Draft Split fixture
20261028-01**. The requested environment was America/Los_Angeles, en-US and
1440×900/DPR1. Effective timezone offset and geometry were not independently
measured. DOM retained the same build URL and version attribute; the current
script bytes were not fetched again.

| Query suffix after the exact subject | Original rendered rows | Current local API total | Original evidence |
| --- | ---: | ---: | --- |
| None | 1 | 1 | `ev_b96d5a2a7616d71b0d89222c15ccf1ae97a01c1f9a61e422af427a8032ddc544` |
| `after:2026/10/29` | 0, with “No conversations found.” | 1 | `ev_5e189b71fbe6732baf6f3d7b291d133e309f8404bc13f454aa301f8e7d71b614` |
| `before:2026/10/29` | 1 | 0 | `ev_7001c7b69734d891085060a5adad5bf99d4ff63625f8897a7cbcd85970707db6` |
| `after:2026-10-29` | 1 | Not separately queried; current UTC implementation is unchanged | `ev_b340b6a168acb0c7775cbf464d5f15385d8f5a4658a1455a22fee5431a0e2737` |

The baseline completed ten recorded steps including initial navigation; the
slash-before scenario completed nine, and each direct-route date case completed
five. Rendered-row counts come from parsed DOM class membership, with the exact
query textbox/URL retained. They are bounded UI observations after settling,
not whole-mailbox or backend-index completeness proofs. All captures have
incomplete event coverage and are not equality eligible.

The first slash-after attempt
`ev_05adcf1b0feaaa0d862600a2828116f1feeafdd9f9472e7e45ce09eaaabcc086`
showed an empty result but retained `/search/` rather than the committed query
URL. Its submission is ambiguous and is not used as decisive result evidence.
The separately declared direct-route follow-up above changed that input and
retained the exact committed query. Final restoration
`ev_ca21946038019cfa71715a9d4def6159ee9d8993594355b5737fdd8ed01d6b23`
completed twelve steps, restored Important Inbox/no composer and disconnected
from the externally owned browser. No setting, message action, editor or Send
was declared; this is not an audit of all search-history/backend side effects.

## Static explanation and implementation boundary

The retained script's SHA-256 again matched
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
Its date parser passes date strings to JavaScript's Date constructor and converts
numeric seconds separately. The selected search methods turn that parsed time
into a search boundary. Local slash-date parsing and UTC ISO-date parsing explain
the observed distinction; this is a source-supported explanation, not a measured
timezone offset or proof that every search executes those methods.

Three inert extracted declarations parsed under REA
`ev_0447623695ee713f2660d7717baa492d741f990845fc72c33e6490c20e2c0b7c`:
466 bytes, zero parse failures, 37 semantic unknowns. The initial extraction
`ev_f4b673cabf725ed382db7fddd8583ed405a05d06d8ffd48e63c0864b5e0e08c9`
had one failure because the analyst stopped a declaration at its internal
method call. That failure and its wrappers remain retained. No vendor code was
executed or incorporated into the replica.

The correction is still private work: carry the browser's validated timezone
with its existing search request and cursor context; use it for slash dates,
preserving ISO dates and numeric seconds. Existing callers without a timezone
retain their documented UTC behavior. No new parser, automatic mail refresh or
mailbox rewrite is required. Gmail API's separately documented
[PST search-date rule](https://developers.google.com/workspace/gmail/api/guides/filtering)
does not establish this client's observed parsing rule.

## Acceptance

- SD-01: the exact fixture produces the observed slash-after/before membership
  when the replica request carries the browser timezone.
- SD-02: ISO dates and numeric seconds retain their UTC instant meaning; DST
  boundaries use the supplied timezone rather than a fixed offset.
- SD-03: malformed/duplicate timezone input is refused; a cursor from another
  timezone cannot resume a result page.
- SD-04: account/view changes fence late results, and searches without a
  timezone retain legacy behavior.

Replica checks and paired recheck remain pending. This one fixture does not
establish exact boundary inclusivity, message-versus-thread date matching,
invalid-date overflow, every timezone/format, provider result completeness,
relative-date syntax or full SH-006 parity.
