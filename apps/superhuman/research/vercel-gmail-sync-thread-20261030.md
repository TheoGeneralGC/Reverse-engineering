# Hosted initial Gmail sync: Core thread correction

This checkpoint concerns the protected Vercel beta, not full Superhuman parity.
All22 feature families remain open/unverified. The separate local application
is available for private feedback while hosted recovery is completed. Safari
has not yet received a successful end-to-end browser acceptance check.

## Observed failure and bounded reproduction

The first hosted Google authorization completed and saved one encrypted grant.
Initial sync imported13 labels, then stopped before caching any Google thread.
The worker logged a pump failure and could not publish its uncertain-owner
transition. The service was scaled to zero; its credentials, retained unsent
demo reply, read progress and accepted requests were preserved.

A separate synthetic reproduction used the pinned native libSQL and HTTP SDK
against two owned local SQL servers. A19.558-second synchronous Core SQL burst
blocked the parent event loop. The open asynchronous Control transaction expired;
commit became uncertain and poisoned that client, which then refused the owner
transition. This reproduces the observed failure shape, but does not establish
the production burst duration or prove that every production failure has this
cause. Production imported13 labels, not the reproduction's1000-label fixture.

## Implemented correction

One owned Node Worker executes the synchronous mail Core. The parent retains
asynchronous Control transactions, heartbeats, authority checks and private Blob
transport. A shared revocable fence guards child SQL; provider/model operations
obtain the existing parent authority registration before issue and remain tracked
until completion. Failure preserves uncertainty. A clean handoff requires Core
drain/close acknowledgement and the observed normal child exit. Expiry, timeout
or forced termination never authorizes takeover. The child receives only explicit
mail capabilities; unrelated platform, Control and Blob credentials stay with
their adapters. This is runtime isolation within one trusted application, not
multi-user authentication or an OS security boundary.

## Validation and limits

The final frozen source passes153 hosting controls across21 files and strict
types, with zero external attempts and109 owned loopback connections. Seven
actual-Worker IPC/drain/crash/binary-body controls and three independent actor
frontier controls exercise the new seam. Linux native addon open/close/reload
works across sequential Workers.

The actual production proxy, real Core, remote SQL adapters and actor authority
complete a synthetic1000-label/five-thread sync:57 heartbeats, zero heartbeat
errors,47 status commands and12 tracked provider reads. Core close and observed
exit precede quiescence. Earlier fixture failures are retained: an overly strict
optional-read count, two unresolved generic sync-poll errors, and a first leaf
run blocked by sandbox loopback permissions plus an obsolete corruption-test
cleanup expectation. The final test now requires revocation and refused handoff
after corrupt pump input. No production source change was inferred from the two
unresolved fixture errors.

Actual hosted recovery, a successful real Gmail sync and Safari acceptance remain
separate release steps. Any exceptional owner repair must be incident-specific,
supported by complete provider-stop and primary-state proofs, and change only
the exact stopped owner's state. It must preserve mail, credentials, drafts,
read leases, commands and transport manifests, and must never replay a mail write.

## Public Gmail access

The user now requires unrelated Gmail users to sign in. The current protected
beta shares one trusted user's Store and is not suitable for public exposure.
Authenticated user ownership and isolation of mail, drafts, files, AI context and
worker dispatch require implementation and cross-user negative checks. Google
public OAuth requirements are a separate release dependency. These do not block
the owner's private beta, and Vercel Authentication remains enabled.

Private raw records and exact source/support hashes remain in ignored evidence
directories. No emails, tokens, credentials or browser captures enter this record.

## Actual corrected sync and loopback follow-up

The reviewed incident-specific state-only recovery completed once. Independent
primary reads confirmed the exact old owner changed only to quiesced; the
captured Mail and transport metadata remained equal and all eight queued reads
were preserved. The Git-triggered corrected deployment acquired its successor
normally. Heartbeats advanced over51 seconds, retained reads completed, real
Google threads grew from4 to10 and the canonical browser rendered the real inbox.
Initial import remains partial; its201 estimate is not a complete mailbox count.

Browser acceptance then found intermittent uncertain GET sync-status receipts
while the owner and actual import continued. Those receipts remain uncertain.
They were not reset, requeued or replayed. Independent default Node24 HTTP and
actual LoopbackCoreAdapter probes reproduced a second defect: after a6.2-second
synchronous event-loop pause, a reused idle socket fails ECONNRESET before the
second request reaches the server. This corroborates the formerly unexplained
private sync-poll errors, although the original cloud socket code was not captured.

The adapter now selects a fresh connection for each owned loopback dispatch
with agent:false. There is no request retry. The same actual-Core probe returns
two200 responses on distinct connections. A separate actual Core/Actor control
commits one draft then loses its response: its receipt stays uncertain, the same
key never dispatches again and a later read sees exactly one draft. The final
720-member source passes155 hosting controls across23 files plus strict types;
denial markers report zero external attempts and124 owned loopback connections.
The first strict setup error concerned only the test's undeclared Agent property
observation and was corrected before the single full gate.

The socket correction's production handoff and Safari acceptance are separate
checks after this source boundary. The local application remains running for
private feedback; unrelated-user access and full parity remain unverified.
