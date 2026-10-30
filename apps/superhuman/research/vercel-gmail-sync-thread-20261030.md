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
