# Original response draft observed before opening — 2026-10-29

One explicitly approved fictional work-to-personal message was sent exactly once.
Before opening that conversation in the original UI, six read-only observations
found one new unsent Gmail draft in its exact received thread. Its reply was
“Confirmed, thanks. Both work for me.” followed by the quoted fictional source.
This is a bounded original observation, not a paired implementation result or
proof of a particular model, generation count, trigger or latency guarantee.

## Target and preconditions

Pinned REA 6.8.0/skill49 inspected the existing personal-account Chrome target at
`https://mail.superhuman.com/`, Chromium **156.0.8078.48**, build
**db8c4288f33febf25ad9**. The retained main-script digest was
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`;
fresh passive evidence is
`ev_22c7019048d5e28705af5de7d0e5d3b48d8e4048aa362715994069ec361de08c`.
The prepared UI viewport was 1440×900/DPR1; effective original geometry was not
independently measured. Account addresses, provider identities and captures stay
private.

The read-only settings capture
`ev_ca4fe804bf8e554d8a2694c9b450fbd2d0845405e1032b562108bdeccfbe25e4`
showed Responses and Follow-ups on, emailed-before restriction off and teammate
scheduling off. These are existing account values, not defaults. That scenario's
final footer guard failed after the unchanged form closed; the separate cleanup
passed. No toggle or Save was declared. Conditional original unmount writes remain
unknown, as described in [the earlier settings inspection](auto-drafts-autocomplete.md).

Immediately before the fixture, exact-subject search found zero conversations:
`ev_e018512608a81031b24c61cffc41abc60cd3563d80170de01a4a7dfe879ccf19`
completed nine actions. Separate restoration completed twelve actions in
`ev_8cfe76ff49c5337ace3127fd8962d648a03cbf91c6c7b2914e3377215e0d27f1`.
Both retain missing event coverage and `equality_eligible:false`.

## One Send and exact receipt

The owned subject was **REA AutoDraft response fixture 20261029-01**. The plain
fictional question supplied Thursday, 3 pm and Room Maple for a Cedar review and
asked for confirmation; it requested no real meeting or outside action. Root
reviewed the approved account pair, empty Cc/Bcc/attachments and absent initial
HTML. One durable unkeyed create intent preceded creation; positive cloud-save
readiness and a separately approved canonical snapshot preceded one keyed normal
Send. No resend, schedule experiment or original-message open was performed in
this pre-open phase.

The Send journal was written at **12:19:26.335 UTC**; its sole matching operation
and delivery attempt were positively Sent at **12:19:37.419 UTC**. A separate
recipient read used the actual confirmed Internet Message ID, an exact
`rfc822msgid` query limited to two results, then one full message read. It matched
one received message/thread, the approved sole From/To, exact subject and the
entire fictional plain body after whitespace normalization. First positive
receipt was recorded at **12:21:35.094 UTC**. This check does not assert byte-equal
transport formatting.

The first reader stopped before its message query because its private identifier
grammar rejected a legal `=` character. A profile GET may already have occurred.
The failed log remains failed; the separate reader V2 only allowed that character
and reverse-normalizes byte-exact to V1. It did not resend mail or use a broad
subject search. The new plain-only receipt does not change the earlier
[rich mapped Send's strict recipient plain-text failure](mapped-send-live-check-20261029.md).

## Pre-open observations and timing

A navigation-only passive window was armed at **12:19:10.934 UTC**, before the
Send journal, and ended at **12:22:10.940 UTC**:
`ev_6a0a7a9d3a950a1b1a55d98669363b81aec5c81564d3bb4b503a419cf3f7967d`.
Its timeline was empty and attach-limited. It does not audit requests, payloads,
model calls or all later snapshots. The six subsequent passive inspections kept
the same target/build and exposed the fictional subject in the Inbox accessibility
text; no original UI action or conversation open was declared through this phase.
They are policy-filtered/attach-limited, with unavailable worker coverage.

Times below are measured after the first positive recipient receipt. Labels are
planned slots, not claims that collection happened at those exact offsets.

| Planned label | Draft-read start, seconds | Completed observation, seconds | New same-thread drafts |
| --- | ---: | ---: | ---: |
| 0 | 37.043 | 38.947 | 1 |
| 5 | 39.333 | 40.919 | 1 |
| 15 | 41.281 | 42.843 | 1 |
| 30 | 43.184 | 44.724 | 1 |
| 60 | 60.399 | 62.135 | 1 |
| 120 | 120.416 | 122.113 | 1 |

The first four slots ran late. These observations cannot establish a five-second
response SLA, a generation start time, or behavior at the unobserved early slots.
The passive window had already ended before the first completed draft snapshot.

The six passive evidence IDs, in table order, are:

- `ev_48da7d285b6edde406f30d56758f971b6cd4ad4b22af93432a6ba1cf53b4d279`
- `ev_015d3536e918630f53101f3d17051b2d8ec0e22adcfa831cfd4b1c3936636e90`
- `ev_7dc4c1a75c7a2fd1e255c87a710381e8d39992ef1f6cce42d7aa61ea470a5f21`
- `ev_6abcbe13cc3ba21410d0552c00a08102ad2a50c64c0f062b038cbd2cfc46bc99`
- `ev_811e73ba11e13eda643b3e766f91db312ed72a8dcf06ae55a54fe3d3fc542af4`
- `ev_7cfccb4c7fcea6d1736e495a6fbc3b888729d31a7f7cc474aea285c386628dac`

## Draft result and preservation boundary

Every snapshot listed 35 personal-account drafts: all **34 prior** draft
ID/message-ID/thread-ID tuples were unchanged, plus exactly one new draft whose
thread equalled the verified received thread. Only that new draft body was read;
old user-draft bodies were not fetched. Its In-Reply-To exactly matched the
received Internet Message ID. Gmail marked it DRAFT, with original-specific draft
and thread header names present. Neither the reader nor an original UI action
submitted it.

The same candidate identity and decoded HTML hash persisted across all six reads.
It had **814 decoded HTML bytes**, no plain alternative, the short confirmation
quoted above, and the quoted fictional Cedar question. The private HTML is not
published. The quote and cloud draft are observed output; an applied replica
implementation must establish its own safe quotation, HTML-only handling and
provider persistence before claiming a match.

The immediate post-Sent read-only Main audit preserved all 19 prior local draft
hashes, seven attachment rows, four sealed credential hashes and the audited
Calendar/model/action/automation tables, with one new owned Sent draft and one
new Send operation. A later post-window poll stopped at `protected_record_changed`:
prior drafts and preferences still matched, but four grant rows and sealed
credential hashes differed. That failure is retained. Root's targeted read-only
review subsequently decrypted all four current slots and compared them with an
older **11:25:09 UTC** snapshot: refresh-credential, scope-set and other-field
fingerprints matched that historical snapshot. Its ciphertexts did **not** match
the immediate preflight baseline, which retained only ciphertext hashes. This
comparison cannot prove exact credential identity or equality against that
immediate baseline.

All four grant timestamps changed at **12:24:28–35 UTC**, alongside new access
credentials, expiries and ciphertexts. These changes are consistent with the
existing background refresh source path; no causal network evidence proves that
explanation. The audit itself made no provider call, refresh or repair. A separate
legacy full-snapshot helper refused the new nonlegacy Send tracking marker during
read-only validation and produced no output file; that audit-assumption failure
is also retained, with no Main mutation. No all-record or unchanged-credentials
claim is made for the full observation interval.

Private authoritative records are hash-bound: driver manifest
`ea4a1ee5fa73b0066b8eeebb44e2342784f55d18f5b766b9e0a4c42bdaf72cb7`,
reader V2 source
`1591deef02d1ad8094828980b2aefb83905cecab38b79a5644af15d043cfd4df`,
exact-receipt evidence
`983aff14d8ab7afdb9206ea51b691af93ca7f2aa6dd8d918e45c2af20687f888`
and completed pre-open record
`a15ed1afe218b4a33547e5803c0ca014bbf61db46867bd97d0ca4348bbae1da2`.
These are local audit hashes, not invented REA evidence IDs. No real address,
provider ID, raw HTML, capture or vendor code is committed.

## Bounded acceptance and remaining comparison

| Case | Result and limit |
| --- | --- |
| ADR-01: known account/form, exact new subject absent, one approved fixture | Observed with the settings/cleanup caveat and one known Sent attempt; no new-account-default claim. |
| ADR-02: exact recipient receipt before any original conversation open | Observed; six new same-thread unsent-draft reads and exact In-Reply-To. Model identity/count and causal trigger remain unknown. |
| ADR-03: preserve existing drafts and timing evidence | All 34 original metadata tuples preserved; no old-body equality claim. Late slots and later Main protected-audit refusal remain explicit. |
| ADR-04: paired response engine, quote and cloud behavior | Pending. Applied source remains **687 API/652 frontend/53 collector**; private settings/UI/worker candidates are not applied. No automatic-response engine parity is verified. |

This one fixture does not establish follow-up/reminder generation, emailed-before
restriction enforcement, teammate scheduling, changing-facts updates, voice or
semantic quality across messages, paid gates, universal availability or full AI
family parity. Later owned-message opening, editing, sending or cleanup requires
its own clearly separated evidence; none is inferred from these pre-open reads.
