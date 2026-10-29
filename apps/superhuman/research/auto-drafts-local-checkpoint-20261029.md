# Local Auto Drafts response checkpoint — 2026-10-29

**Source applied; restart checked with qualified postrestart differences.**
Reviewed source passed **855 API tests** and **680 frontend tests**, strict checks
and build. One synthetic case completed **57 actions** with its stopped audit.
Root applied 63 paths matching all 438 reviewed files, passed the exact stopped
jobs-off migration/data comparison, restarted Main and passed HTTP and read-only
settings checks. Native postrestart comparisons preserve protected state and
classify sync/readiness/credential changes; strict postrestart equality is false.

## Applied source and stopped migration boundary

Root applied 63 source paths and verified all 438 files against the final source
identity below. A fresh stopped backup and its logical comparison passed before
application. The isolated jobs-off migration made no fetch, model, profile or
timer calls. Its read-only comparison preserved all **11,927 existing record
rows**, all **88 old tables and schema**, all **seven attachments**, and all
**four sealed credential slots and credential invariants**, exactly and with
**no normalization**. The expected 48 tables, three indexes and six triggers
were added; the only nonempty new table contained one foundation clock row.
No pending or uncertain work was introduced at that stopped boundary.

Main then restarted. Both connected Google account status reads returned HTTP
200 with Responses off, zero attempts, no activation, available readiness and
generated cloud saving disabled; frontend/module reads also returned 200. These
are status/serving checks, not real generation or provider delivery.

The separate read-only Main settings smoke completed **10 actions**:
`ev_aae3c6115b50f46190c8090e3fb379f1f16cd09a5a054d7365bb8e66841c78c2`.
It observed Responses off, Follow-ups disabled and diagnostics hidden, then closed
settings without an editor, toggle or Send action. Its capture is complete and
`equality_eligible:true`; the requested GET network/page-error evidence stays
private. That capture metadata does not establish original-product parity or
prove every possible background effect absent.

## Qualified postrestart comparison

QA's **17:48 UTC** native read-only transactions found 136 tables and **11,928
record rows**, versus 11,927 stopped. One existing Thread changed and one Thread
was added; no records were removed. All **20 prior draft JSON/SQL rows**, seven
attachments, global preferences, label records, message-attachment records,
delivery/provider ledgers, Undo, Calendar event/operation state and Knowledge/AI
turn-and-dispatch state stayed exact. AI mail documents/search indexes did change;
they are not silently included in the unchanged model/action claim.

Strict old-table equality was **false** for 18 tables. Changes included account
sync timestamps, history cursors, sync-health times, grant/OAuth-attempt timestamps,
the two Thread changes, Calendar operational sync rows, and derived mail-search,
recipient, Split, thread-summary and tracking-mail index/counter rows. Exact
changed fields and table comparisons remain in the private audit; no broad table
exclusion or stored-value normalization was used. These observations are
consistent with synchronization paths, not a causal provider/network trace.

Both accounts still had Responses off, zero issued attempts/queued jobs and no
activation. There were no persisted v2 settings, jobs, frozen inputs, publications
or activations. Readiness/history/projection rows and one provenance/bridge
pending record were present. That is not a claim that every table named pending
was empty, nor evidence that the response engine dispatched a model.

Credential boundaries are separate. Root's earlier **17:41 UTC** stopped-to-live
credential comparison found all four ciphertexts, access credentials and expiries
changed, while normalized refresh-credential identity, scope-set and other-field
comparisons stayed exact. This qualifies that earlier snapshot only; it does not
make QA's later raw rows equal. It is consistent with existing refresh behavior,
without a captured refresh transaction proving causality.

QA initially found one raw `grantedScopes` array difference at 17:48. A separate
native read-only comparison at **17:57:11.125 UTC** established that all four
grants' sorted unique exact-string membership sets matched the backup: three raw
arrays were exact and one differed only in order, with no duplicate or membership
change. Sorting was comparison-only; persisted arrays were untouched. That later
scope-only check did not decrypt credentials and does not extend the 17:41
credential result to a new boundary. Raw grant-row/ciphertext differences and
strict postrestart inequality remain true. Each comparison used its own snapshot;
Main remained live outside those transactions.

## Source and verification scope

The final reviewed source manifest is
`b249e36df7bbd647641ff0239e951274eb132cb3c424db4ea17c7de7b1b9c812`:
242 API paths, 191 frontend paths and five unchanged collector references.
The API matches the source that passed 855 tests; the final UI matches its
680-test owner freeze. Fresh combined frontend types/build also passed. A prior
sandboxed API attempt had inherited local-listener permission failures; the
unchanged loopback-enabled run passed. This did not require weakening application
permissions or making real provider/model calls. Existing collector suites are
unchanged; their counts are not added to the API or UI totals.

Pinned REA 6.8.0 / Node 24.22.1 captured the synthetic browser case:
`ev_3112b071d903b5fdeda1cdd1c11fdb6133233c0e6312a497187d7654c8b73380`.
It used actual application factory/routes and the normal Inbox UI, with one fresh
isolated in-memory database, one fictional account/source and intercepted Google
and model transports. It used no real mail, model, provider mutation or original
browser profile. Constructor-approved fixture inputs supplied a fixed model
response; they did not override readiness, status, publication or capability.
This checks integration, not model judgement or quality.

The 57-action case proved:

- Default Responses off, then one direct Responses-on settings request. One
  accepted acknowledgement was deliberately returned as unavailable; one
  same-key GET recovered it without another settings write.
- The existing rich editor and recipient editor survived settings/recovery.
  Both bounded Undo paths restored and persisted their original fictional bytes.
- One fresh positive history occurrence produced one fake model call and one
  local reply. Normal Inbox opening placed it beneath its exact source; explicit
  Open draft resolved only that target rather than searching global job history.
- The reconstructed dated attribution and quoted source survived as canonical
  plain text and safe blockquote HTML in the explicit fixture timezone. The
  captured inline body matched all **195 UTF-8 bytes** exactly; the audit did not
  normalize whitespace to obtain equality.
- Opening and closing the untouched generated editor caused **zero generated
  PATCHes**. The exact source-to-draft publication binding remained available.
  Two owned-editor autosaves were recorded; no automatic Send followed.
- Protected fictional draft, preferences and sealed-slot bytes remained exact.
  The audit checked the owned preclose memory backup read-only. It does not claim
  all-table equality after application shutdown. Both owned services stopped,
  their exact PIDs/ports were checked absent, and owned Chrome terminated.

Captured event coverage is incomplete and `equality_eligible:false`. The complete
actions and retained events do not prove complete Chrome-process network denial.
This is a focused synthetic case, not a repeat of the historical 16-case/407-step
full regression and not an original-product parity result.

## Current reconstructed behavior and policy

Responses preferences are account-scoped direct updates with exact-key uncertain
acknowledgement recovery. There is no additional user Activate or budget screen.
Fresh local settings default off; the inspected original account's enabled values
are not treated as defaults. Missing model/identity/baseline readiness is reported
truthfully. Opening settings or a conversation does not start generation.

The engine admits only positive new incoming history occurrences after its fresh
accepted preference/readiness barrier. Replayed history, initial import, rescan,
read/open, snooze and label-only changes do not create response work. History IDs
remain decimal strings. Source publication, attachment metadata and the durable
ingress record commit together. One dispatch lease and frozen bounded model input
separate admission, a possible model issue and a validated result. An uncertain
issued model outcome is retained without automatic retry. A no-draft decision is
valid. These are reconstruction design choices and tested boundaries, not claims
about the original's hidden implementation.

This slice creates local replies only. It does not enroll generated drafts for
automatic cloud saving or send them. Human edits, including edit/revert, preserve
their authorship claim; an explicit same-byte API PATCH still counts as a claim.
The UI skips only a clean, current, acknowledged identical local save, even if
cloud status is still loading. Delivery/schedule/discard protection is retained.
A later distinct incoming source can create a new target only under the current
source and existing-draft policy; this is not an in-place changing-facts updater.

Quotation is reconstructed from the immutable source with existing safe text/
HTML handling and an explicit timezone. Whitespace-only plain source can fall
back to sanitized HTML. No captured vendor markup is copied. Subject-aware model
context is a separate unfinished contract; a displayed reply subject does not
prove that the model received an authoritative per-message Subject.

Follow-up/reminder drafting remains unavailable, as do teammate scheduling and
its preview; no fake Team directory is supplied. Typing Autocomplete is a separate
feature and is not implemented by this response slice. Paid/Business/admin gates,
model quality, aliases beyond bounded identity evidence, competing clients,
response updates, public cloud behavior and full SH-012 parity remain open.

## Original evidence is separate

The [original settings inspection](auto-drafts-autocomplete.md) observed the
current account's direct controls and recovered their static handlers. It did not
activate them or prove generation quality. The
[original pre-open response observation](original-auto-draft-response-observation-20261029.md)
then found one new same-thread unsent Gmail reply before opening its conversation,
with the 34 prior draft metadata tuples preserved across six reads. That is
positive original cloud output evidence; it does not identify model calls,
causality, generation count or precise latency. Its late observations, initial
reader failure and qualified later protected-audit refusal remain recorded.

A later controlled original opening was captured separately in
`ev_988581538f66e45b3074b57eb1184cd82441427d61c73cd89c23028fa335af9d`,
followed by Inbox restoration
`ev_b852aa8e3d7f50a44011a295838cbc87f8965ef1777e2a8f68990cf83100967e`.
The generated reply/quote was present in that bounded conversation view. A
read-only post-open comparison retained the same draft identity but a different
provider message identity: HTML changed from 814 to 818 bytes while visible text
matched only after whitespace normalization. No typing, Send or Delete was
declared. These facts must not be relabelled exact HTML equality, a no-effect
opening guarantee, or full inline interaction/geometry parity. Event coverage
remains incomplete. The replica's explicit Open draft interaction is local design;
original acceptance, cloud editing and Send behavior need separate comparison.

## Retained failures and corrections

| Record | Outcome and scope |
| --- | --- |
| Synthetic run02, `ev_5e97b1a7d9e723e39bf33fd4239196d03149987cedc475723aab46023dc96477` | Navigation toggled an already-open folder list closed after publication; the later selector timed out. It remains failed, without a complete audit. |
| Synthetic run03, `ev_9872c2e8e32582979e86aa77c74ed6f0d54bb732a536ae6e7db67dafd6c2d5df` | Passed 57 actions on the earlier unquoted source. Its proof is historical, not the final quoted-source result. |
| Intermediate quote/editor source | Initial repeated input could flatten a blockquote; backend and DOM line-break serialization also differed. Narrow editor/input and canonical snapshot fixes preserve an untouched reply's body and HTML while real edits still persist. Earlier owner gates remain tied to their own source. |
| Intermediate untouched-save source | An actual API probe showed that even a same-byte PATCH changes authorship and invalidates publication. The API policy stayed; the final UI avoids the unnecessary PATCH. A held provider-read case and edit/revert control cover this boundary. |
| Synthetic run05, `ev_3de115aeec6e1172831ef49f3f7637378353c527409064af16b08ad220472377` | 48 actions completed, one multiline escaped-text locator failed and eight were cancelled. Retained DOM exactly matched canonical body, but draft opening/close checks were cancelled and no complete audit passed. |
| Synthetic run06 | Changed the locator to single-line predicates and kept exact captured-DOM byte equality in the offline audit. All 57 actions and the stopped audit passed on the final source. |

The earlier [mapped Send plain-alternative mismatch](mapped-send-live-check-20261029.md)
remains failed; this local synthetic response case does not change it.

## Bounded acceptance ledger

| Case | Candidate result / remaining comparison |
| --- | --- |
| ADL-01: direct preference and uncertain ACK | Synthetic UI on/save and one same-key GET recovery passed; original mutation protocol not matched. |
| ADL-02: fresh eligible incoming source only | Durable provenance/barrier/replay and frozen input controls passed; one synthetic incoming browser case passed. Original causal trigger remains unknown. |
| ADL-03: exact source-local preview/navigation | Synthetic source-specific binding, preview and guarded draft opening passed; original full interaction parity is open. |
| ADL-04: safe dated quote and untouched close | Exact synthetic plain/HTML, captured 195-byte text, zero generated PATCH and surviving binding passed. Original cloud/HTML and geometry are not byte-matched. |
| ADL-05: authored editor and account guards | Existing scoped controller tests plus real edit/edit-revert and rich/recipient Undo controls passed. The browser case covers one account/source, not every race. |
| ADL-06: protected rollout | Source438/apply63, exact stopped migration, HTTP/Main-settings smoke and native read-only postrestart qualification passed within their stated scopes. Strict postrestart equality is false; sync, credential and raw scope-order differences remain explicit. |

All 22 feature-family statuses remain unchanged. Full one-to-one parity is false.
