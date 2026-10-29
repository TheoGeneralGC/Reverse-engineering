# Original reminder submission and natural return — 2026-10-29

One reminder was submitted on an owned fictional thread in the original client.
The UI showed a scheduled-reminder toast; the thread later returned to Inbox with
one additional message carrying original-specific reminder headers. This is one
bounded original observation. It does not verify the replica's reminder family,
conditional cancellation, Follow-up generation or full parity.

## Target and read-only controls

The retained target was Chrome **156.0.8078.48** at the original mail application,
build **db8c4288f33febf25ad9**, main-script SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
The fresh passive rebind was
`ev_a66bf820e89834711fdd97474cf2d2e17de98ed8a4ea5808d616823af608f24c`.
It retains policy-filtered/attach-limited and worker-coverage limits; the later
reminder actions did not recapture every script.

Two earlier row-only scenarios completed **21** and **26** actions:
`ev_92b1343e6a5408ad7993a07d540e93e99d95105e97c4bc94e1f0d8c789791d4c`
and `ev_38c7f0740f4a2beaa6b13e8dee00ba669200f75e057592d7bf2e7114be51f94c`.
They opened Remind me, then its condition menu, without opening a conversation or
composer or selecting a time/condition. Both restored Important Inbox.

The popover displayed **if no reply**, with **regardless** as the other option.
That is the inspected account/context's selection, not a universal default.
The input placeholder was “Try: 8 am, 3 days, aug 7”. Presets were tomorrow,
next week, this weekend, someday and never; the last two had shrug annotations.
There was no Save/Submit control in this popover. A highlighted suggestion did
not establish a committed reminder, and Remove-control absence is context-bound.

Requested viewport was 1440×900/DPR1, en-US, America/Los_Angeles. Actual captured
PNGs were **1512×862**. No measured full-popover geometry or pixel match follows.
These captures have missing events and `equality_eligible:false`; completed
actions do not prove absence of background requests or internal writes.

## Static declarations, separately scoped

Pinned REA 6.8.0/skill49 analyzed 18 selected inert fragments, 6,721 bytes, with
zero parse failures:
`ev_c42f91ffc44f74bf741bb6b1e5fc5280cd21969cbd9dc6e83ed5964ad31a2e9b`.
Its graph is complete only within that selection; 452 semantic unknowns and
external dependencies remain. Vendor fragments stay private and were not run.

The retained client maps Someday to `4000000000000` milliseconds and Never to
`5000000000000`: analyst conversions are **2096-10-02T07:06:40.000Z** and
**2128-06-11T08:53:20.000Z**. Hidden “forever” maps to Someday. Both are nonnull
create-reminder intents, distinct from the null/remove path. These declarations
do not prove server storage, eventual return or Archive-equivalent behavior.

The static action path creates a reminder with a source-message snapshot,
client-generated identity and time, marks the thread done, and derives its
keep-on-reply flag from the selected condition. It declares a reminder-create
POST. This supports an immediate suggestion action rather than a staged Save
form; it is not an observed HTTP acknowledgement or a complete server contract.

## Typed preview, one submission and return

The owned fixture was an earlier controlled thread, separate from the later
generated-cloud question. No message Send or draft edit was declared in this
reminder probe.

| Phase | Evidence and result |
| --- | --- |
| Typed preview, no submission | `ev_469c7d128e77a0911e27f84b5eaa75ac1a664c54d8eb4f1de591a51e6f8d0c7a` showed the typed date parsed as October 29 at 2:05 pm. Its first Escape cleared the nonempty input; the subsequent closed-field guard failed, leaving four actions cancelled. The failure remains failed. |
| Separate cleanup | `ev_1edac7a0bf33e1d5b0b70a6e93cbd653b05e9766041b825f2ba9c99c2edda334` completed five actions and restored Inbox. No reminder was submitted in either preview or cleanup. |
| One committed UI intent | `ev_2c5ec707e2f64151bcf1a95fe73cd9253945531f0000e03782448930b82659e9` completed all 23 actions, selecting the exact parsed suggestion once. The toast read “Reminder set: 2:05 PM if no reply.” with Undo. Undo was not invoked. |
| Natural return observation | `ev_2e0f394c93e7f454073d0bc295f573c5dcd9c5578ddf6473984336a1115af92b` completed 13 read-only actions after the due time and restored Important Inbox, without an editor. No resubmission, cancellation or cleanup write followed. |

The scheduled instant was **2026-10-29T21:05:00.000Z** (2:05 pm in Los Angeles).
The return capture completed at **21:05:23.607 UTC**. Separately imported provider
state showed INBOX present before submission, absent afterward, then present
with IMPORTANT after the due time. Message count changed from one to two.
These label/cache observations and UI actions are separate evidence; they do not
constitute a bound original create-request/UUID ACK or causal network trace.

The successful submission, cleanup and return captures still lack events and
are not equality eligible. The preview additionally has missing sections around
its failed/cancelled steps. No zero-network, exact save latency, restart recovery,
exactly-once wake or mailbox-wide preservation claim is made.

## Exact new-message read and trigger anchor

A separately reviewed reader made **one exact raw-message GET** at
**21:10:59.952 UTC**, with zero profile reads, refreshes or provider writes. It
constructed no Main App/Store, rendered no HTML and fetched no images/URLs. The
13,214-byte raw resource has SHA-256
`92a2f29fec34696637b5fedc28aca3869a73dc02851b319255d4b5b9a9e5ecdd`;
reader source SHA-256 is
`70056abd5284d8716bf6822412ddf06864a6742900d0c4bfac525fea2e15303d`.

The exact new message belonged to the owned thread and identified its sender
with the `superhuman.com` domain and the sole approved recipient. Its parsed
Date and provider internal date both matched **21:05:00 UTC**. It contained one
UUID-like `x-superhuman-triggered-reminder-id`, one
`x-superhuman-triggered-reminder-source` with literal **USER**, and
`x-superhuman-triggered-reminder-last-message-id` exactly equal to the previously
known **provider message ID**, not its RFC Internet Message-ID. Values and account
identities remain private. This positively binds the observed reminder marker
to that source; the earlier return report's “marker not yet bound” was its
pre-raw-read state, not the final result.

The new message is reminder/system evidence, not an observed human reply.
There was one Received header but no retained DKIM/Authentication-Results/ARC,
Delivered-To or SPF chain establishing delivery mechanism. **SMTP versus provider
insertion remains unknown**; neither transport nor vendor infrastructure should
be invented from the visible message. No model calls or Follow-up output were
measured.

## Bounded acceptance and remaining work

| Case | Evidence boundary |
| --- | --- |
| RR-01: row popover and condition choices | Original controls and this context's selected condition observed. Other contexts, focus and geometry remain open. |
| RR-02: typed preview and cleanup | Parsed absolute suggestion observed; first-Escape cleanup failure and separate restoration retained. General date grammar and keyboard submission are unverified. |
| RR-03: one reminder and natural return | One UI intent/toast, subsequent label transition and added message observed. No direct create ACK, reply-before-due, resnooze, cancel, Undo, restart or duplicate-return comparison. |
| RR-04: returned-message source | Exact raw marker binds the old provider message, USER source, UUID-like identity and due date. SMTP/insertion and original classifier rules remain unknown. |
| RR-05: replica comparison | Pending. Preserve a positive returned occurrence separately from human replies and reply anchors; do not infer it from label absence, list opening or a missing snooze date. This is an implementation requirement, not recovered server behavior. |

No global draft/body audit accompanied this reminder run. Someday/Never were not
submitted; conditional-reply cancellation, original cadence, Follow-up generation
and paired replica behavior remain open. **SH-008 stays in progress; no feature
family is marked verified.**
