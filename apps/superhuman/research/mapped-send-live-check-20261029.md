# Controlled mapped Gmail Send — 2026-10-29

One newly owned Gmail draft completed browser Undo, future-schedule cancellation,
and one final native `drafts.send`. The acknowledged sender and exact recipient
copy have matching actual Internet Message-IDs and identical decoded 65-byte
attachment content. The strict recipient plain-text assertion **failed**. This
is a bounded integration result, not a fully passing observer or full parity.

## Source and execution boundary

The exercised source is API 531/frontend 495: 152 API files with manifest
`55806fc5b4df5826f5e73f268f5b63d7a9a4a8f3b851401add66644497bdc274`,
and App SHA256
`883b0aa16d88c6bb8a315719d0029b49a0785624760570df878a7f9cc8fe27bc`.
Node 24.22.1 and pinned REA 6.8.0 were used. Root lock SHA256 is
`5edce8e380d69957b01846e57a8a51d3ae519595d366f517736aaa1ea2477c51`;
the separate private API lock remains
`930d24a6e3bdc3f1a4291720d4c19856ce33a49637c23d1d60627bad4e7c2426`.
Later Split Inbox and tracking candidates are outside this identity.

The main app was stopped before a read-only backup. An isolated database copied
only the two approved Google account associations, MAIL grants and encrypted
MAIL slots. No existing draft, mailbox history, Calendar grant or model key was
copied. The only authored message was fictional test content from the approved
work account to the approved personal account, with no Cc/Bcc. No original
Superhuman setting was changed. The received fixture is retained for a separately
approved original Split Inbox comparison.

The broker enforced one CREATE, one attachment PUT, one final mapped Send, and
no DELETE or `messages.send` fallback. Both real MAIL profiles were verified
before creation. Actual token refresh count was zero. Attachment insertion used
the terminal API; this does not verify a browser file picker.

The server delivery clock was explicitly held. Automatic autosave callbacks
were released for setup; the browser clock and transport safety timers remained
real. Schedule used the actual browser's literal 24-hour input and was cancelled.
This does not verify a naturally elapsed Undo deadline or due-time dispatch.

## Browser and durable outcomes

All 93 captured states completed across four separately owned browser launches.
Each capture lacks events, has `equality_eligible:false`, and reports
`terminated-owned-process`; these results do not establish full event coverage
or pixel equality.

| Stage | States | REA Evidence |
| --- | ---: | --- |
| Canonical draft guard | 21 | `ev_f93735767b7780972c466933682ce98adfa53acf68ec0338f22cae4543f123e4` |
| Send then mail-global Undo | 26 | `ev_a3feacf94feb3db2284ed68f567cb6ead348a7d58f5f6ab3747c25a39b5260d0` |
| Future schedule then Cancel | 28 | `ev_1a4232e620f965e7db03bff893182e9015048f82b2268f4d4f66498b2550cffc` |
| Fresh intent then Instant Send | 18 | `ev_3f58ec556d72a7297356a047f2a7608ea748ee00445ac286f5ec4c2180bedfe4` |

Generation 0 and generation 1 are authoritatively cancelled with no delivery
attempt. Their local canonical content, cloud Draft identity and attachment
bytes remain unchanged. Generation 2 owns exactly one confirmed delivery attempt
and one acceleration receipt. It consumed the same cloud mapping; there was no
draft recreation, extra update, fallback Send or cleanup DELETE. Two terminal
provider payload snapshots were pruned; the actual outgoing raw MIME was retained
privately before dispatch. These are SQL/native-transport assertions, separate
from the browser action results.

## Recipient assertion failure

The observer read only the known sender acknowledgement, derived its actual
rewritten Internet Message-ID, and queried that exact ID in the approved
recipient account. The first bounded lookup returned one match. Its raw message
was saved before decoding and before the assertion failed. No observer retry,
second Send, broader mailbox scan or automatic cleanup followed.

Independent Python MIME parsing of the seven retained raw files found:

- Outgoing and sender-Sent plain alternatives are the same 120 bytes; their HTML
  alternatives are the same 155 bytes.
- Received HTML is 157 bytes, differing only by terminal CRLF. Normalizing that
  line ending preserves the full authored HTML.
- Received plain text is 128 bytes and differs beyond line endings: emphasis
  asterisks and a wrapped line were added. CRLF-only normalization does not make
  it equal to the authored plain alternative.
- The sole recipient, sender, subject, opaque delivery marker and actual sender/
  recipient Internet Message-ID associations match. The actual ID differs from
  the requested ID, which the observer did not use for recipient lookup.
- The decoded attachment is exactly 65 bytes in outgoing, Sent and received
  copies, with SHA256
  `38cabf702f262c782d9a7223e1213c4e53a4d05423c70c2fa3ccf49fdb84515c`.

The source of the received-copy transformation was not separately instrumented.
Provider-side alternative generation is consistent with this result and earlier
[rich-mail probes](gmail-live-check.md), but its exact transformation point and
equivalence to original Superhuman output are unverified. The frozen observer
remains failed; no passing whole-run report was fabricated from this audit.

Independent failure-aware review SHA256 is
`3fbe220b837ad7b879f50a5dff6e582d5a460955028244cd9fff07ad649bb580`.
Raw messages, account identifiers, credentials, captures and databases remain
private. The stopped isolated database hash was unchanged by that review.

## Protected data and retained failures

The root read-only main snapshots before and after the stopped live check are
byte-identical: 19 pre-existing Draft JSON records, seven attachment rows and
bytes, three Calendar operations, six delivery records, protected model/action
rows and four encrypted credential slots are unchanged. Legacy drafts acquired
zero provider links, operations or discard records. The main app was then
restarted unchanged; subsequent normal imports are outside that stopped-data
comparison.

An earlier synthetic rehearsal failed because the harness compared two freshly
built raw MIME messages with different random multipart boundaries. That failure
is retained. The successor instead checked the actual outgoing raw against the
durable claim, exact decoded authored content, identity headers and attachment.
Its subsequent synthetic rehearsal with four stages and 93 states passed, including an
intentionally rewritten fake Message-ID. A separately reviewed metadata-only
revision explicitly separated already authorized delivery from still-pending
original Split mutation approval. Neither change relabels the earlier failure.

Remaining acceptance work includes received plain-alternative equivalence to
the original, natural deadline and due-time delivery, fresh-process route
recovery for this exact sent generation, competing clients, imported draft
editing, and broader original UI/keyboard/visual comparison. No complete feature
family is marked verified by this record.
