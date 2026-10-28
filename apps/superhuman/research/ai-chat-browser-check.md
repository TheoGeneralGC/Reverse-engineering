# Persistent Ask AI: bounded live browser check

Recorded 2026-10-28. Three controlled replica scenarios passed **70/70 recorded
steps** using the configured Claude adapter. This is separate from the
[three-turn API check](ai-chat-live-check.md), earlier inline-editor checks and
the older full demo regression. It does not establish full AI parity.

## Target and method

Root executed the pinned REA 6.8.0 CLI against isolated synthetic UI/API ports
5175/3003. Each case launched its own browser/profile; REA reported Chromium
`156.0.8078.48` and `terminated-owned-process` cleanup. Inputs requested 1440×900,
en-US, America/Los_Angeles, light mode and reduced motion. Action/host deadlines
bounded failure; durable exclusive attempt files prevented automatic replay.

Preflight required demo-only accounts, exact synthetic fixture content, no Google
configuration/delivery, Calendar disabled, configured Claude and zero pending or
failed index records. Formatting/Stop used fresh sessions, resources `[]` and no
selected thread; retrieval used only `['mail']`. Captured turn POSTs and saved
turns confirmed those scopes. No composer, delivery, draft-sync or Calendar-write
action was included. Source navigation could mark only the controlled demo
thread read. Every existing demo draft was unchanged before/after each case.

| Source identity | SHA-256 |
| --- | --- |
| App | `c5fe2b2fa1a6998d93345a55b20265a83c2bdff651f6f28fa88dbd932d26ae6a` |
| AI pane | `0d4698d03d44d05b15439a4f6b8786226262e69025d0ce55ec8e4f84c393afe7` |
| Calendar workspace | `897646659c14f830a83b686c4a190987f4ace6b029caf2ef819a54b028dc51bf` |

Each case retained 94 manifest entries with zero before/after changes. All 88
non-private source/fixture/scenario/lock entries also matched across cases.
Separate offline gates passed 261 API/217 web tests, build and strict types;
mocked tests add no live-provider proof.

## Results

| Case | Steps | Evidence | Bounded outcome |
| --- | --- | --- | --- |
| Fictional formatting/history | 27/27 | `ev_f61c73b59a77f57c5f83be81045ea468f2960024941e2f859ba574c61ada5caf` | H2, exactly two bold-label bullets, one table header/two body rows and one inline-code span. Both fictional facts retained; no tools/citations. New created an empty local conversation without generation; History restored the answer, and AI close/reopen retained it. |
| Controlled retrieval/source navigation | 29/29 | `ev_a41a3b765019258299934a5b254f26b549d7403d6d134fe8d39b5fceb3adccba` | Requested synthetic facts and one citation to the exact full-message read receipt. Citation click expanded/highlighted one source row. Its row opened the exact controlled conversation with AI on the left and contact context on the right. History/restore retained the answer; closing AI retained opened mail/contact. |
| Stop after genuine partial text | 14/14 | `ev_8844e64152261573594a480de57ffd40e785d1e6ebfbe7fe3496d523d4fa942d` | Running partial text preceded Stop. Saved state was `cancelled`, with explicitly partial text, no completed answer/citations, and `providerOutcome=unknown`. |

Each case made one captured exact-scope turn POST. Durable state recorded five
upstream dispatches: one formatting, three retrieval/tool rounds, one Stop. No
paid request was automatically retried. Local Stop followed cancellation request
by 2 ms; that does **not** prove provider computation or billing stopped and is
not an original-product performance comparison.

Independent review read only saved reports, DOM and manifests. It confirmed the
formatting counts, one highlighted source row/final citation, exact source
navigation, simultaneous left AI/right contact, and cancelled final state. It
made no additional browser/API/model call. Each case retained one final
screenshot; no pixel-diff score is claimed.

## Comparison and coverage limits

[Original evidence](ai-assistant.md) establishes a specific H2/bullets/table/code
answer, history restoration, citation expansion/highlighting and one email-source
navigation with AI retained. These checks exercise corresponding replica paths.
Original runtime Stop, every Markdown variant, exact geometry, responsive
behavior, clipboard/feedback, multiple/changed/absent sources, real-mail or
Calendar retrieval, and assistant write actions remain unverified here.

All three REA captures report **incomplete**, `equality_eligible=false`, missing
`events`, with no truncated sections. Captured requests and zero retained page
errors support scoped assertions; they are not a complete causal/provider-write
trace. Disabled provider gates and unchanged drafts are independent boundaries,
not conclusions drawn from generated answer text.

Private artifacts are under `.local/ai-chat-ui-plan/ai-chat-ui-20261028-01/`:
case reports/captures, DOM/AX/URL, screenshots, manifests, saved turns and
`independent-ui-review.json`. Report SHA-256 values:

- Formatting: `86095fd7a77dd6a10534e509531f5708f50dc77138b0f6f680ec323730f954f3`.
- Sources: `ae94b3705a6352fceff50fe061bda34cdf3a6555a2aa62199f38b30c0c82948a`.
- Stop: `53471c46ecd6821916a5b52a6d778fa23e1d69211f608ba1c48586afe94d9e60`.

## Subsequent full-regression failure remains separate

Full demo attempt `20261028T174514Z` was **not a passing checkpoint**: fifteen
cases passed; side AI failed `unsent-question-retained`. Of 407 recorded steps,
387 completed, one failed and nineteen were cancelled. All eight persisted
assertions passed, manifests were stable, no page errors were retained and all
owned browsers terminated.

The failed side case is
`ev_ffb660883287ee0cad0dc9034e9bf568ef6906bf61e896862b02466ab85fb2bc`:
22 completed/one failed/nineteen cancelled of 42 steps. Coverage is incomplete,
`equality_eligible=false`, missing accessibility/action/DOM/screenshot/URL.
The selected History row correctly identified the new current zero-turn session.
At the preceding supposed New-readiness step, AX still showed the prior prompt;
after filling, AX/DOM showed an empty input before History restoration. Code
review identifies a reachable race: the input remains editable during async
session creation, whose later selection resets its prompt. An enabled textarea
alone did not establish New completion. The owner added controlled regressions,
New-readiness/input guards and subsequent focus containment/lease fixes. Failed
evidence stays preserved; the earlier three paid UI passes did not cover this
timing gap.

## Later corrected full run and read-only restore

Run `20261028T175808Z` subsequently passed all **16 cases/407 steps**, eight
persisted assertions and stable 88-entry manifests, with zero page errors and
owned cleanup. Offline gates passed 261 API/221 web tests, build and strict types.
This source keeps App hash `c5fe2b2f…`, but changes AI pane to
`dfe6d9d613c5a20a04248eb18862582cd92209ad76bce8a6892ac0dc5076db90`,
controller to `cc1ae9a93ed7073886951a2deb0327a5e3ab52d3ad19372b356f58dc12811472`,
and CSS to `229febaaf22aae81d90ff450c1316529e66737d8fd31305a12eb3eae4bc701c5`.
The earlier 70 paid steps retain their original complete manifest identity;
they are not retroactively relabeled as running these later files.

The intermediate focused failure `20261028T175150Z`,
`ev_65fc2de0cf203d28b6ea9085d899e4063483afb6c801d073cd8c33376c96dac6`,
retains 24 completed/one failed/seventeen cancelled of 42 steps. Loading-history
focus could send Escape outside AI to Mail. It remains incomplete/equality-false,
missing accessibility/action/DOM/screenshot/URL, with no page errors or source
drift and terminated-owned cleanup. The next focused 42-step pass,
`ev_b9c66f9a2d386332d21013a917b23a9bd2a38862534690942f79ccdb9c7d932c`,
is incomplete only for scenario-start DOM; full-run side AI is complete.

An additional read-only visual/history restore passed **8/8**:
`ev_51dc22fe5a198194a079d8bdae69a7465f1f578c3424387884cf012d7557f724`.
It retained complete requested sections, zero POSTs in captured network metadata,
`equality_eligible=true` and owned cleanup, restoring the existing synthetic
formatting answer without a fresh model call. Its capture SHA-256 is
`d7b6a8d5bc5e7f72ae8192b52fc3a5b3301dab389384a8d819553f072a9dda31`.
These are independent checks, not a pixel-diff or full-parity result. Full IDs,
archive/report hashes and earlier outcomes are preserved in
[the scenario record](scenarios/README.md).
