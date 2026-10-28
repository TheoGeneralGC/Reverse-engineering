# Undo Send: bounded original observations

Recorded 2026-10-28 against authenticated web build
`db8c4288f33febf25ad9`, Chromium `156.0.8078.48`. The retained main-script identity
is in [ai-assistant.md](ai-assistant.md). Private fixture addresses, draft URLs,
full captures and user inbox material remain ignored.

## Runtime observations

The earlier successful AI-card Send capture
`ev_7492ffd2c967ea0678bcb39e11ce2f6a8d0e527df08992b53cde1a7d0edf96ee`
contains more than the disabled Sent card: its global notification initially says
“Sending…” and offers Undo and Instant Send. After the declared 500 ms and
1,500 ms waits, the notification says “Message sent.” and still offers both
actions. After the subsequent 10,000 ms wait, neither action is present. Capture
and action overhead are additional; this bounds the observed affordance rather
than measuring its exact initial deadline or provider-dispatch time.

A separate manually composed, controlled message used only the approved test
pair, one unique subject and an exact synthetic body. No existing user draft was
edited. Guard-only evidence
`ev_37e2f97c4cb92533cb6c3c766acd8a17df4fc27330b1df94d800c698ba2fbe76`
completed eleven retained steps, checking the unique subject, selected-account
DOM label, sole peer, empty pending To/Cc/Bcc inputs, no existing Undo notification
and the exact editable body. The selected-account label is hidden in this layout;
its attached DOM state and unchanged account navigation support that bounded
identity check. No explicit From field was shown.

`ev_980d4d2196add1913d12995c479bbc51204121deed4319014c75db9e5bc7e297`
then completed **17/17 steps**. Its declared single Send click took 190 ms, and
the following Undo click took 189 ms after an Undo-visible check. These are
individual action durations, not delivery-latency measurements. Undo returned to
the **same owned draft URL** with the exact subject/body restored and displayed
“Sending undone.” A hint offered the Z shortcut. The restored draft remained
visible after a further two-second wait. Neither Instant Send nor Z was invoked.
This proves the bounded UI restoration. The later imported-local absence
observation below adds a bounded receipt check; it does not prove permanent
provider non-delivery or a compensating recall protocol.

The owned fixture was subsequently emptied through recipient selection and
keyboard body deletion, then closed. Cleanup
`ev_6829729b3ac325123d9369990c1942374ef2b60a24eb77c67f989b8f22c28f5d`
completed **16/16 steps** and restored Inbox with the composer hidden. Earlier
guard failures and a cleanup locator failure remain private. The cleanup failure
occurred after selecting the owned recipient: its nested input disappeared, so
the next input-dependent locator failed before deletion/body edits. The corrected
run used the stable recipient row. No further Send was attempted.

## AI-card Send, Undo and discard/reload

An isolated, newly generated synthetic preview completed **13/13 steps** in
`ev_4167966309d869e0e8f11437583fa54f9bf5476d44a6090e1772b834c2789d81`.
The guards checked the exact body, sole approved peer, empty Cc/Bcc and enabled
Send/Create Draft. This preparation did not activate Send.

`ev_2eccab2a7f07e21e78cc40d2a8035df5d7a2c4603452053d31ee65a1bee5a4eb`
completed **21/21 steps**, with one declared Send and one Undo. Send changed the
card to disabled Sent while the global notification offered Undo. Undo opened a
new owned draft target and changed the card to disabled Current Draft. Four
retained snapshots, including the settled snapshot, preserve that same target,
subject and Current Draft state. The owned body restoration guard passed. This
is original UI behavior; the early Sent label alone does not establish provider
acceptance.

Only that restored test draft was then emptied/discarded. After a full reload and
restoration of its exact AI history session,
`ev_61128f1a7cc1da06176269ab080fc45614f151f52ce1f6f4c16be20b43060d40`
completed **23/23 steps** and the same preview offered enabled **Send** and
**Create Draft** again. Neither was activated in this capture. The observed
reset supports a new explicit action after discard; it does not prove original
backend record deletion or an automatic resend/recreation protocol. Existing
user drafts were not cleanup targets.

## Read-only local receipt observations

Separate root-run observers opened the live local SQLite database with
`mode=ro`, restricted SELECTs and an authorizer denying secret-table reads and
writes. They did not construct the application/Store, call HTTP/provider APIs,
synchronize mail or access tokens. Exact account/subject candidates were bounded;
only those message records were inspected for the controlled marker and pair.
Reports contain counts and hashes, with bodies and identities kept private.

| Original controlled flow | Snapshots | Elapsed observation | Sender SENT | Recipient received | DRAFT copies observed |
|---|---:|---:|---:|---:|---:|
| Manual Send→Undo | 24 | 117.659 s | 0 at every snapshot | 0 at every snapshot | 0 |
| AI-card Send→Undo | 24 | 117.453 s | 0 at every snapshot | 0 at every snapshot | 1 |
| Manual Send without Undo, timing fixture below | 1 | 0.270 s | 1 | 1 | 0 |

The first two reports establish **bounded absence in imported-local snapshots**.
The AI DRAFT copy was counted separately and was never classified as a delivery.
Import lag, incomplete local history and later delivery remain possible; these
are not universal provider-cancellation or permanent non-delivery proofs.

The positive timing-fixture observation required exactly one matching sender
SENT copy and one non-DRAFT recipient copy, the approved sender and sole To,
empty Cc, the normalized synthetic body facts, and the same nonempty
InternetMessageID hash. It stopped at the first confirmed pair. This is local
receipt evidence for that new fixture, separate from the Undo absence checks.
There is no imported Bcc assertion, and receipt timing does not locate the
provider dispatch or cancellation deadline. Each observer used zero HTTP,
provider and model calls and zero write statements; inconclusive outcomes never
trigger a resend. Private per-attempt plans, poll files and reports are exclusive
outputs and preserve earlier attempts.

## Notification retention timing

A new approved-pair manual Send, without Undo, Instant Send or a declared hover,
completed **52/52 steps** in
`ev_85ee54155830444d65ebc2c7ec2860a976e3ed0ce640377b0a606341febe6efc`.
Passive samples 19 and 20 retain the Undo action in DOM and its notification text
in AX. Their notification ancestor has `Notification-animate-out`. Sample 21
contains neither. Effective visibility and clickability during that exit state
were not measured.

Pinned REA 6.8.0 records each step's elapsed time **after** artifact capture. A
DOM observation therefore occurs inside that elapsed interval. The last retained
step ends at 10.591 seconds summed from Send-action start and lasts 522 ms; using
its start gives a conservative lower bound of **10.069 seconds**. The first
absent step ends at 11.113 seconds. Assigning all 332 ms of unattributed session
overhead to this interval gives an upper bound of **11.445 seconds**. This is a
**DOM/AX-retention-loss bracket from Send-action start**, not an exact visible
Undo window, provider queue delay or cancellation cutoff.

The original private `window-reviewed.json` remains unmodified as derived v1.
Its 10.591-second lower-bound interpretation is superseded by the separately
saved v2 and independent source/ancestor review. The underlying 52-step capture
is unchanged. No pointer-event trace proves absence of incidental hover; only
absence of a declared hover action is established.

All these captures have incomplete event coverage and are not equality eligible.
The first preparation was also rejected for an unsupported timeout field before
browser execution; it has no Evidence ID and supplies no runtime observation.

## Static findings and remaining unknowns

Pinned REA focused inert analysis
`ev_e7cd497e1dad911ac17efa3acf3ebe03a204d86fc403462b7ed02b275983ed4b`
parsed three selected classes with zero parse failures. Within that limited
selection, the Undo handler requests cancellation using draft/thread/message
identities, queues an undo modifier, restores/focuses a draft and clears an AI
card's sent flag. Instant Send invokes a zero-delay path. A hover handler,
throttled at five seconds, requests postponement using an exported constant whose
value is 30. Its units, initial queue deadline and server enforcement are unknown.
These are shipped declarations, not observed private-server behavior.

## Controlled Instant Send observation

A subsequent approved-pair fixture completed **31/31 steps** in
`ev_f26f3709c54678ca8d97923f1720c85d55e98c3b8f9948d445e88714af56aa95`.
The original manual composer sent one new labelled synthetic message. The
notification initially displayed Sending…, Undo and Instant Send ⚡. A click on
the notification text exposed its actions; pointer hover during that action is
possible and explicitly declared. One click on Instant Send changed the
notification to **Send accelerated!**, with no remaining actions in the retained
DOM/AX. No Undo or second Send was activated.

A separate bounded read-only SQLite observer found exactly one sender SENT
copy and one non-DRAFT recipient copy on its first snapshot. It required the
approved sender, sole To, empty Cc, normalized controlled body facts and matching
nonempty InternetMessageID hashes. It made zero HTTP, provider or model calls
and zero database writes. This establishes that fixture's observed delivery;
it does not measure the acceleration interval, exact provider dispatch time,
server cancellation cutoff, imported Bcc or MIME byte equality. Capture event
coverage remains incomplete and `equality_eligible:false`.

The replica's first Send checkpoint passed 298 API and 264 web tests plus strict
types/build. Its stable 163-file private source archive has SHA-256
`8cddf86a7178d5330a3b9496ca300788449c2bdc6c4cad1c3096127d485baa7c`.
It had no Undo endpoint/window and was not rolled out to the live API. Its
provider-confirmed Sent policy is an explicit local choice, distinct from the
original's observed card/notification presentation. A later offline Undo
baseline passed 317/317 API checks with isolated databases and mocked providers,
as recorded in [AI-UNDO.md](../api/AI-UNDO.md); subsequent generation/UI work is
a separate checkpoint. Original AI-card restoration and discard/reset are now
bounded runtime observations above. Live replica comparison, effective
cancellation timing, hover extension, replica Instant Send, keyboard behavior, normal
composer Undo and restart/deadline parity still require further work. The local
10-second artifact deadline remains a provisional implementation policy.

## Replica artifact Send, Undo and fresh generation

The API325/web290 source checkpoint subsequently completed a controlled live
artifact lifecycle against the approved Gmail pair. A source-free Claude turn
produced the exact synthetic preview in two model rounds; the delivery check
reused that completed turn and made no new model request.

In `ev_3441d546494ed58ab6c75823497691c16e98ad2906281391edaad4c31b060720`,
one Send and one Undo completed. The same local draft reopened with the exact
recipient, subject and canonical body. The capture then failed its read-only
body selector: Squire wrapped the text in a child div, which the selector did
not match. This capture remains failed. Its retained editor DOM and an
independent read-only ledger check established cancelled generation0, one
cancellation receipt, zero delivery attempts and the unchanged 17 baseline
drafts. The owned browser had terminated. No Send or Undo was replayed.

A separately reviewed continuation corrected only the body guard and completed
**34/34 steps** in
`ev_dae210a185300b42b12ffcd9e4b01ee184589c4299a56d7ab8bda7b63fc560b4`.
It reopened the proven owned draft, cleared and discarded only that draft,
waited for fresh creation eligibility, and clicked Send once for generation1.
The authoritative operation reached sent. Read-only postchecks required a new
draft/operation/request key, exactly one linked sent delivery attempt, the old
cancelled operation with zero attempts, and historical Send/Undo keys that
retained their original identities. All 17 baseline draft hashes and the
model/session/turn counters remained unchanged. The 78-entry runtime/config
source inventory stayed identical throughout.

A separate SQLite observer opened the existing database with mode=ro and an
authorizer restricted to reviewed SELECTs. Its fifth snapshot found exactly
one sender SENT copy and one non-DRAFT recipient copy, matching the sole
approved To, empty Cc, normalized synthetic body facts and the same nonempty
InternetMessageID hash. It made zero HTTP/provider/model calls and zero writes.
The 3 existing Calendar operation records also remained byte-identical to the
stopped-server backup. This is bounded imported-local receipt evidence, with
no Bcc, MIME-byte, provider-dispatch-time or cancellation-cutoff assertion.

The first pre-browser attempt was blocked by missing legacy mail-grant
metadata; it created no operation. A later OAuth refresh used the already
approved Gmail permission. Both stopped attempts and their recovery records
are retained privately. The successful continuation has missing event coverage
and `equality_eligible=false`; it does not establish full original parity.
Normal-composer Undo, scheduling and Instant Send remain separate candidates
until their own combined rollout and runtime comparison.
