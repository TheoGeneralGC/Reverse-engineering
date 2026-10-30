# Command keyboard correction for the hosted beta

This narrow change makes Command arrows wrap through current results, clears a
nonempty query on the first Escape, and closes on the next Escape. Keyboard
selection requests nearest scrolling; pointer selection leaves scrolling alone.
Repeated Enter is consumed before invocation. Closing returns focus only to its
still-connected invoker in the same context, yielding to another modal or a newer
deliberately focused field. Ask AI retains its unsent question without taking
focus from that valid return.

Only App, its additive transition tests and a selection helper/test change.
Hosted attachment/download transport, command catalogue, API and worker source
are unchanged. The private beta remains one trusted owner's application under
Vercel Authentication. Sending remains limited to the approved test pair;
unrelated-user Gmail onboarding and full product parity remain unfinished.

## Evidence and validation

The retained Original observation
`ev_88a34380bd79253e1edfbed3724df6a3a97171f7b24b61bca40b87f0e2bd40e6`
completed13 actions on build `db8c4288f33febf25ad9`: Up wrapped to the last result,
Down returned to the first, and query Escape preceded palette close. This is
historical runtime evidence, separate from static declarations of scrolling and
repeat behavior.

A current-build attempt used pinned REA6.8.0 on Chrome156.0.8078.76 and build
`49584c503344063bea77`. Capture
`ev_92ac36abc3a71bdae325b423be533bad58dbc9f0f84b37e61fadcb2471aa03b6`
stopped at its visible-account precondition before every key/fill action. The
settled collapsed-sidebar layout is not new Command behavior evidence. Its
missing sections/equality-ineligible result remain retained privately.

The exact hosted candidate passed201 checks across the two affected test files,
strict source types and build, with two denial markers and zero external or
loopback attempts. An independent actual-App purpose passed query-first Escape,
subsequent close and Subject/recipient/body focus preservation with no additional
mutation. All prior hosted API, worker and download paths remain byte-identical.
The first transplant omitted the valid Command-return/Ask AI visibility predicate;
its one failed check among201 is retained. Adding those two accepted seams made
the unchanged regression pass. No expectation was relaxed.

## Concrete acceptance boundaries

| Case | Present evidence | Remaining comparison |
| --- | --- | --- |
| CK-01 arrows wrap over current results | Historical Original and actual-App controls | Current-build runtime repeat |
| CK-02 query Escape, then close | Historical Original and independent App control | Current-build runtime repeat |
| CK-03 empty results stay harmless | Pure/helper and App controls | Original empty-result case |
| CK-04 keyboard scroll, pointer does not | Static basis and bounded App scroll-port control | Real geometry and pointer comparison |
| CK-05 held Enter cannot invoke twice | Static basis and App default-prevention control | Physical held-key comparison |
| CK-06 valid focus return preserves unsent work | Actual App/Squire/recipient/Ask AI controls | Original editor-origin focus comparison |

These checks establish the scoped implementation boundary. Exact moving pixels,
opening motion, catalogue completeness, Safari IME/held keys, other dismissal
contexts and the full visual/motion feature family remain unverified. Release
ownership and deployed-browser checks are separate from this source record.
