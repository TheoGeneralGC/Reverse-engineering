# Applied Shortcuts overlay lifecycle

Shortcuts now uses the recovered200ms opacity fade with a separate250ms visual
lifetime. Closing releases keyboard/focus ownership immediately while the
inactive visual retires. Opening Command during retirement preserves that visual
without restarting its deadline; reopening help retains one current owner.
The change is applied on **1035 API/766 frontend** source. All22 inventory
families remain open and unverified; exact moving pixels and complete help parity
are not established.

## Original observations and static basis

The selected original build is db8c4288f33febf25ad9. A fresh passive capture
`ev_8eaae86dcf337f564ab19f736a0475ff281a3cf26fee9b5db74325f6b2166de6`
matches the retained main-script SHA
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
The stylesheet has the same versioned URL/byte count; its historical digest is
separate static evidence. The proven legacy ShortcutsHelp consumer declares
200ms CSS opacity transitions and250ms component lifetimes. These are separate
clocks, not measured frame durations or a universal modal rule.

Root opened a separate window in the already running dedicated profile. Its
new target was used for every action; the older tab and its unknown AskAI input
were untouched. Each scenario guarded the personal account, absent composer
and mounted list before nonmutating help/Command actions. No mail, editor,
preference or Send action was declared.

| Original case | Bounded result |
| --- | --- |
| Normal open/close | All11 declared actions plus start completed; `ev_50527d19b7d261eebfec03e1edce08bc535f65834953702f6d823fed6671b6ce`. Enter/active classes settle to enter-done. Escape retains exit/active help while ThreadList's focus region returns immediately; help is absent after the400ms settle. |
| Rapid reopen | All17 declared actions plus start completed; `ev_4077b0ef48f2240e670a8946bc7e90828821107fd3dedefe15c42fef827b24d4`. One exiting help remains while Command opens/filters; reopening produces one entering/settled help. Final close removes it. |
| Command navigation | All13 declared actions plus start completed; `ev_88a34380bd79253e1edfbed3724df6a3a97171f7b24b61bca40b87f0e2bd40e6`. Up/Down wraps; Escape clears a query before a second Escape closes. These corrections are separate pending implementation work. |

These captures use Chrome156.0.8078.48,1512×862/DPR1,light,en-US,
America/Los_Angeles and motion enabled. Every capture still reports missing
events/equalityEligible:false. DOM classes and focus-region ownership do not
measure exact opacity,250ms removal, document.activeElement or editor focus.
No scenario screenshot was requested for these cases. The first search locator
matched both Shortcuts and Account Settings(Account Shortcuts); that strict
failure remains retained. Only its observed exact entry selector was narrowed.

## Implementation and verification

Manifest `34d1dd203063eeacf5d4c0c400dc50212f5742460a4dbffc30043511567facc0`
binds494 paths:285 unchanged API,204 frontend and five collector references.
The four-path delta is App, its affected test, a Shortcuts component and scoped
CSS. Other modals and Command retain their prior implementation. Logical close
still uses the existing App focus/context guards. Retiring help is inert,
aria-hidden and excluded from the active dialog/ref/pointer/close ownership.
Generation checks cancel stale frames/timers. A cold initial style boundary
precedes the entry frame; interruption/reversal pixels remain a local unknown.

Owner13 and independently rerun13+3 focused purposes pass with denial0. The
new clock purpose proves a modal opening100ms into retirement cannot renew its
original249/250ms boundary, and fails against the prior immediate-suppression
candidate. Independent review digest is `db1a515b…`. Root's full frontend gate
passes766/766 with71 zero-denial markers and exact494 source/support hashes
before/after; log digest is `b7f649fc…`. Strict checks/build pass. The native
TypeScript launcher replaces Node, so its empty log does not prove a dynamic
zero-network-attempt count.

Earlier candidates and failures remain immutable. The first source review found
a missing initial-style boundary, but both earlier own-browser variants completed
five natural opening/closing transition-event cycles at elapsedTime0.2 seconds.
No skipped browser fade was reproduced. A later direct original comparison found
the concrete immediate-suppression difference; the applied successor fixes it.
Those minimal React/style browser probes are supplementary evidence, distinct
from whole-App and original moving-pixel comparison.

Root applied four frontend paths and matched all494 held files. The API stayed
running; no schema/environment change occurred. All three local tabs had no
editor before the update. Native read-only before/after snapshots preserve20
draft rows,seven attachments and four sealed rows exactly, with six selected
operation counts zero. This is selected protection, not all-table equality.
Main types/build and served-module/API-health checks pass. A local help open/close
smoke found one active help, then zero active/retiring help and focus returned to
its Shortcuts invoker. It performed no message or preference action.

## Concrete acceptance and remaining coverage

| Case | Scenario and present coverage |
| --- | --- |
| SM-01 | Open/close read-only help: declared fade/lifetime and original retained exit/list focus are sampled; exact pixels/timing remain open. |
| SM-02 | Close then open Command before retirement: old help stays inactive and cannot close/focus the new owner; original presence and local guarded-clock controls support this. |
| SM-03 | Rapid reopen/stale callbacks: retain one current help and ignore old cleanup; original sampled count and local StrictMode/latest-owner controls support this. |
| SM-04 | Preserve Subject, rich body, recipients and unsent AskAI text/focus: local actual-App controls pass; original editor-origin comparison remains open. |
| SM-05 | Reproduce catalogue/filter, geometry, hover/backdrop, responsive/reduced-motion and interrupted pixels: pending. The scoped patch retains the earlier local help content. |

The private1088-test Trash API candidate is separate and unapplied. Trash client
integration, other dismissal animations, moving selection highlights, tooltip
variants, physical held-key behavior and full1-to-1 parity remain open.
