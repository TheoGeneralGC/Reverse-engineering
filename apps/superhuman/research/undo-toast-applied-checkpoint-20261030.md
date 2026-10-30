# Applied immediate Undo and ordinary Done notification

The local browser app now returns an owned Done row immediately after explicit
Undo, before either Archive or inverse acknowledgement. The current notification
uses the recovered eight-second hold and declared two-second fade, cancels its
timer during pointer entry, and restarts it on pointer exit. New intent replaces
the current notification; late acknowledgement cannot recreate an expired one.
These changes follow the [earlier rapid-E checkpoint](done-applied-checkpoint-20261030.md).
Full interaction parity remains unverified; all 22 inventory statuses are unchanged.

## Source and behavior

The private source manifest is
`3f9e97dd132440b6a10b35433d4be2cdd80afd8192b51ed840d4291e6bd40937`:
492 paths, comprising the unchanged 285 API and five collector reference paths,
plus 202 frontend paths. Root applied exactly 11 frontend paths: eight
replacements, three additions, no deletion. All 492 frozen hashes matched after
application. The API stays on its previous 1035-test source; the frontend now has
**762 passing tests**. Collector53 and separate Vercel23 sources are unchanged.

The inverse is an owned presentation overlay, granted only after saving its
opaque intent. It keeps the original Done reservation through stale refresh,
confirmation cleanup and uncertainty; it does not forge provider labels or folder
counts. The existing ordered queue still waits for positive Archive confirmation
before issuing Undo. Manual J/K/click selection wins, as does an independently
newer canonical row. A queued inverse checks the context captured at explicit
Undo before its first POST; issued work only settles its own journal after a
scope change. Explicit Undo after leaving and returning to the route retains
its prior canonical-refresh behavior rather than injecting an old row owner.

The content-free journal retains the accepted inverse key and dispatch marker.
The possible-issue marker is saved before transport. Null, malformed or404 status
cannot erase that key, grant a fresh one or cause replay. Twelve literal c138
journal vectors cover old records with no marker and null/pending/unknown inverse
shapes. Reloaded unresolved work stays conservatively GET-only. A live owner that
positively knows its inverse never issued may offer a separate explicit
continuation using that same key. Archive routes and server DTOs are unchanged.

Ordinary Done/Undo notices have one current identity, with update distinct from
new intent. A receipt update does not renew the timer. The corrected responsive
left-position formula retains all recovered offsets below1152px. Legacy theme
palette/base geometry follows static declarations; active-theme computed pixels,
variants and complete responsive equivalence remain unverified. Focus pause and
reduced-motion adaptation are explicit local accessibility choices. Generic
legacy notices and Send notifications retain their separate, unverified timing.

## Validation and preserved failures

| Boundary | Result |
| --- | --- |
| Focused owner | 95 purposes passed:54 pure and41 selected actual-App cases, including J/K ownership and12 legacy-journal vectors; strict checks/build passed with zero denied native attempts. |
| Independent review | Five separately executed code/standards controls passed, plus two independently owned held-ACK actual-App cases. The outside assertions retain their original two-RED baseline and unchanged redirects. Review digests `2d53f825…` and `fca4cd65…`. |
| Root full frontend | 762/762 passed, no failures/cancellations/skips;71 zero-attempt denial markers. All492 source files matched before/after. Gate digest `2871624f…`, log `2cf704ee…`. No repeated API suite; inheritance is by exact source identity. |
| Root physical browser | All58 declared actions plus start observation completed. Capture `ev_8d8b930ba7d69cfcfe501d6673f2932c26e951e287675b9e43cde744a77225fe`, SHA`c9c03780e2864e1125566d262dced75a055f3cebe3d656fd14fc64f0e137bf32`. |
| Mandatory stopped audit | Actual demo API completed two Archive and two Undo operations, two identical owned-editor PATCHes, exact protected records/attachments/secrets and owned editor content. All107 stored tables matched the stopped fixture hash protocol. Report digest `bc5db798…`. |

The browser environment was Chrome156.0.8078.76,1512×862 at DPR1,light,en-US,
America/Los_Angeles,motion enabled. Pointer entry used a click on noninteractive
notification text, followed by a nine-second wait; it was not a standalone hover
API. A click on a noninteractive pagination status then moved the pointer away.
The case also verifies current-notice replacement, logical fade/removal before
a held inverse response, no late-notice resurrection, subject focus, serialized
rich body/quote, recipients and attachment retention through the late result.
Exact JavaScript node identity is separate offline actual-App evidence, not an
assertion inferred from physical serialized DOM snapshots.

The first physical attempt remains a partial failure:19 actions completed, its
pointer-leave selector targeted an absent Inbox h1, and38 later actions were
cancelled. The full audit correctly refused that incomplete case. A separate
read-only partial audit preserved the closed backup, one known Done/Undo,
protected hashes and zero native/model work. Only the next packet's action20
locator changed; all58 action identities/guards stayed exact. The actual mounted
App and pinned selector engine proved the new unique noninteractive target,
with no request/selection/action effect. No product edit or broad-suite repeat
was used to repair that fixture.

Both owned temporary browser processes terminated. Both API/Vite manager pairs
received one interrupt each; API shutdown completed and saved its mandatory
backup. No listeners remain on the synthetic3043/5217 ports. The passing capture
still reports missing event coverage and equalityEligible:false. Screenshots use
the tool's animation-disabling adapter, so this is not moving-pixel, runtime
easing/duration, full network containment or Original error-behavior proof.

Strict all-logical-table equality is false for five intended tables: Archive
heads/operations,records,Split source generation and tracking mail epoch. The
owned editor's identical PATCHes may advance revision/timestamps; retained
content and unrelated protected rows are separate exact checks. The memory API
used only fictional demo accounts, explicit matching database configuration,
disabled automatic work and a synthetic Reminder key with automatic:false.
No provider/model call, real account, Main data or Original action participated.

## Applied Main boundary

Root found no editable controls/composer in any of the three open local tabs and
no unsettled Archive/delivery/provider-draft/AI-turn operation. Native read-only
before/after snapshots match all20 draft rows,seven attachments and four sealed
credential rows exactly, including SQLite storage types. This is a selected
protected-state comparison, not a full Main table/schema equality claim.

Only the exact Vite process was briefly paused/resumed while the11 reviewed
files were copied; API and Vite PIDs stayed unchanged, with no backend restart,
migration or configuration change. Root repeated frontend types/build and
verified the new client modules were served and Inbox remained mounted without
opening an editor or performing a message/preference action. The earlier
13-action Main browser smoke retains its c138 identity; it was not repeated.
An internal serving check first guessed the wrong CSS class name; its refusal is
retained and the corrected GET check uses actual frozen identifiers, with no
product change. The inherited large-chunk build warning remains.

## Remaining work

The original immediate-Undo ordering and notification lifetime are supported by
retained same-build static findings; the earlier original Z observation is
separate and partial. Provider-held timing/error behavior, exact moving pixels,
computed geometry, physical operating-system held-key repeat and other notice
variants remain open. Trash/Move/label/reminder eligible dismissal has a separate
plan and protocol investigation; these changes do not upgrade their legacy
recovery or mark DM-08 verified. No feature family is newly marked verified.
