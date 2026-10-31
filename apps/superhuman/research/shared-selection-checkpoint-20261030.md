# Shared mailbox selection highlight checkpoint

The browser now uses one shared background and focus bar for mailbox selection.
Keyboard changes retarget its transform immediately using the reference's
declared256ms easing; pointer selection snaps and avoids forced scrolling.
Animation completion never gates keyboard navigation or Done/Trash admission.
This source checkpoint remains separate from actual Production deployment.

The overlay measures the eligible rendered row in list-content coordinates.
Headings and retained departing rows keep their physical slots; an OUT row
cannot own the highlight. The old per-row focus affordance remains a fallback
until measurement succeeds. The two visual elements are aria-hidden and add no
focusable node. Queued frames, observers and listeners belong to one fixed list
owner and cannot adopt a replacement view with identical thread IDs.

Command query Escape still clears the query first. A second Escape closes it;
the existing list highlight now returns without another selection key or pointer
movement. Disabled/editor context and window blur remain suppressed. No focus(),
provider operation, request or synthetic navigation revision is introduced by
the presentation controller.

## Original comparison

Current reference build49584c503344063bea77/version2026-10-30T19:06:29Z was
inspected in Chrome156.0.8078.76. Static source establishes two shared overlays
and their declared transition, plus different keyboard/pointer/layout policies.
Those declarations do not measure computed pixels or elapsed animation time.

Query-only capture `ev_d80deea28e7d0faef54c7b6e7a758019bd4b8de0c639306f0111ba4cc3ea5f3a`
completed25 steps and found two owned test rows. Within keyboard capture
`ev_218e414d7000c995011b2b37edccdfe24e0820768bcbb58b6f1658abe3bdfd53`,
J selected the ordinary row with both targets at Y68/scale1; K returned to the
attachment row at Y0/scale1.88889. No-reader/no-focused-editor and pointer-away
guards completed. The whole capture remains40/51 FAILED at a later view-return
guard, with10 cancelled actions. Separate navigation-only capture
`ev_3503e1b5e373b1c664bb9988affb147d1c6ec84fd10117337529593aa9396e6d`
completed15/15 and restored the original single test search/selection.

No screenshot was taken during the motion case because the installed REA
scenario adapter disables animations. A separate settled screenshot reports a
different viewport from the scenario request. Missing event coverage remains;
runner key-step durations are not physical typing cadence or transition times.

## Implementation validation

The web-only change preserves all backend, hosted/collector, transport, action
queue, Command/AI implementation, configuration and dependency inputs of the
preceding prepared release. Presentation metadata remains separate from
navigation/admission revisions. No private owner-auth code is included.

Three concrete defects were caught and retained before this checkpoint: an old
controller could adopt a replacement owner, same-target pointer transfer failed
to cancel an inflight keyboard transition, and Command close left the highlight
hidden after focus returned to the body. The final source binds construction
ownership, flushes pointer snaps even at unchanged geometry, and reconciles a
current body/list return with a separate window-focus latch. Earlier failed
sources/results remain separate.

The final41 affected mailbox/controller/actual-App purposes, strict source/test
checks and build pass. Independent review reran two unchanged actual-App
purposes: held Done with retained slots/headings/offscreen J/K, and view/ref
turnover followed by Command clear/close. Both pass, including the same
previously failed visibility assertion, without an extra key/focus workaround.
Source/support hashes held; owned roots/windows/children were closed and network
denial counts were zero. No broad API/frontend suite or real mailbox mutation
was repeated for this web-only change.

## Acceptance and open limits

| Case | Bounded result |
| --- | --- |
| HL-01 Rapid keyboard transfer | Shared targets update without animation/network waits; declared-layout controls pass. |
| HL-02 Pointer transfer | Snap/no-forced-scroll and same-target interruption controls pass; Original physical hover remains open. |
| HL-03 Layout and ownership | Actual eligible slots, OUT exclusion, scope turnover and stale-frame disposal pass synthetic controls. |
| HL-04 Command return | Actual query clear/close restores the same highlight/selection/geometry; editor/window guards remain. |

The current actual mail rows are still36px without filename chips. Synthetic
68/36px geometry proves controller support, not matched attachment-row markup.
Exact fonts are absent from public packaging and fallback typography remains.
Exact inset/colors, physical hover/scroll/held repeat, responsive/reduced-motion
equivalence, computed easing, moving pixels and full1:1 parity remain open.
Initial/scope/layout snapping and reduced-motion behavior are explicit local
policies. All22 feature families remain unverified.
