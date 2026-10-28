# Account personalization

This is a bounded reconstruction record, not a full-parity claim. The original
web observation used Chromium 156.0.8078.48 with build-associated stylesheet
`style.page.db8c4288f33febf25ad9.css`; the installed native app is 1041.0.75.
Vendor code, styles, fonts and captures remain private.

## Observed original and static findings

Original runtime capture
`ev_b4c6b8a230460f27f7c7c5757b0e9c900d979faed176561b925f3e1555425699`
shows the Personalization dialog and its fields. Its retained PNG is 1440×900,
but the app surface ends at x1279, followed by a white strip. The dialog rectangle
is 758×568 at `[261,198,1019,766)`. A 1280×964 host explains its center; that host
size is an inference, not a measured original viewport.

Inert stylesheet analysis reused REA parent
`ev_41c7bdaa0bbae734db2553d6ad1b9e69231b4eb83d30e63f46c12c23279efd84`
(directory digest
`03e8b34190ed5a04adab55486ef340f2fb30811450f860a14f8a2ffc8441b7a3`).
It supports the 180px sidebar, 20px gap, 490px content area, 32px input height,
76px input-top stride, fixed footer and separately scrolling fields. These
declarations guided independent CSS; static findings do not establish saving,
learning, model behavior or server limits. No original preference was saved.

## Local implementation choices

The private candidate provides account-scoped staged preferences, facts, explicit
Save, optimistic revision checks and guarded close/navigation. It pins a bounded
preference snapshot when an AI turn is accepted, so later edits cannot silently
change that turn or an idempotent replay. Saved text is untrusted preference
data, with no additional tool, source-access or delivery permission.

Field/fact/context limits, retained deletion markers, conflict handling and
compact-screen layout are local policies. Automatic learned voice is absent;
the UI describes manual preferences truthfully. Knowledge navigation requires
the combined host integration. The private candidate remains separate from the
published runtime until its combined rollout is recorded.

## Bounded candidate checks

The separate candidate passed 349 API/304 web tests, build and strict types with
synthetic databases and mocked providers. Independent cases covered malformed
records, account isolation, atomic conflicts, escaped Unicode byte bounds,
stale/lost acknowledgments and real React lifecycle/focus behavior.

`ev_148e1ae0deaa8df234e9f22e81d6714ac067ad7d54d729daa0e6fd7ba165aa95`
completed 32 browser steps for synthetic Save/reopen and dirty-close handling.
A separate Claude-only synthetic check made one real model dispatch and answered
from the saved fictional profile without mail/Calendar retrieval or a draft/send.
`ev_6ae09c8626f09897e3647ed80053a3633ac03c16afd79cef236ae821b5eaf695`
restored that history in 7 steps, without a new question. Its source identity was
recovered from exact before-correction bytes; the delayed post-hash and two later
presentation changes remain recorded privately.

Final geometry/focus capture
`ev_bb9360a40b0e5145b466d0bbcf7a81dfbdad51456c054b2c9c22254c979f52af`
completed 7 steps with 76 stable runtime files and owned-browser termination.
It matches the bounded foreground dialog geometry, field rows, Close placement
and Greeting focus appearance. Incomplete event coverage remains; no whole-image
pixel equality, original Save behavior or full personalization parity is claimed.

## Acceptance and remaining coverage

- Save in one account, reload and recover exact fields/facts; another account
  receives its own settings.
- Dirty Escape, close and Knowledge navigation require an explicit choice;
  pending saves/navigation preserve the existing mail editor and staged text.
- A queued AI turn keeps its accepted preference revision/hash after later
  saves; disabled preferences and other accounts' text are excluded.
- Unknown Save outcomes reconcile by read before another write; conflicting
  fields require an explicit resolution.
- Compare original save/reload, learned voice, fact management, accessibility,
  responsive behavior and complete model quality before claiming parity.
