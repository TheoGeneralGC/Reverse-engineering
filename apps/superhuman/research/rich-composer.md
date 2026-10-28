# Rich composer: SH-010 implementation checkpoint

The browser client now uses an independently installed open-source editor. This
is a scoped implementation with recorded replica browser checks. SH-010 is
still **in progress**, not verified. No vendor-extracted implementation is reused.

## Observed original runtime

Parent-led REA captures used the existing signed-in Superhuman web session. The
original page build/resource identity remains the one recorded in
[source-inventory.md](source-inventory.md). Captured screenshots were actually
**1036 × 690**, despite a requested larger viewport; no claim is made for an
unobserved viewport or other account entitlement. All text used for these probes
was synthetic. Private screenshots and captured DOM remain ignored.

Source identity was recaptured with the pinned CLI in
`ev_c9cd198429df274d27c277961039d34686e2f97631f879de9e5ebfd16522e777`:
`db8c4288f33febf25ad9.page.js` retained the SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.

- `ev_7a12389ab1dbd5b35767fc954f4d59b1ad794e5c1d32305e9bd0463c1d77a2f0`:
  empty composer has no persistent formatting button in its bottom tools. Its
  body is a shadow-DOM editable hosted by
  `div.Shadowbox.ComposeFormEditor[data-editor-location="compose"]`; the subject
  is a separate input. This capture alone does not establish formatting behavior.
- `ev_79bc888986538ed8a32b268b1f0ed989b6d98fea6612e965a52b103a5a247324`:
  selecting synthetic body text reveals a dark floating toolbar below the
  selection, clamped to the compose card's left edge. Approximate outer size is
  337 × 40 pixels. Controls, in order: bold, italic, underline, strikethrough,
  link, color, numbered list, bulleted list, quote, Write AI. Cmd+B visibly made
  selected text bold. Cmd+K replaced the bar with an approximately 214 × 40 pixel
  dark URL input, placeholder “Paste or type a link”, with no visible save or
  cancel buttons. Escape dismissed it. Private references:
  `evidence/private/composer/selection-toolbar.png` and `link-popover.png`.
- `ev_f2459aa4540154e7cc26be0b92bfed56f8c390fa8492e6c084a878b83cba37b5`:
  Enter applied the entered link, confirmed by an accessibility anchor with its
  exact synthetic URL. Cmd+Z removed it. The attempted lowercase
  Meta+Shift+z did **not** restore it in this screenshot-instrumented capture;
  the later non-interfering control below established redo for this link workflow. List and blockquote roles were observed after
  their controls were used. The color control opened a dark bar approximately
  221 × 44 pixels with six named circles: No color (swatch RGB 34,34,34), Lava Red
  (222,84,84), Irascible Orange (233,150,56), Seafoam Green (92,186,135),
  Conscientious Blue (74,143,225), Pretty In Pink (201,118,209). A tooltip advertised
  Cmd+O to change color. Private references include `palette-result.png`,
  `linked-text.png`, `link-undone.png`, `link-redone.png`,
  `numbered-list-result.png`, `bulleted-list-result.png`, and
  `block-quote-result.png`. Filenames alone do not establish success.
- `ev_41289005f08a9f37a4d0b5c94af2a1c434ebc9f96ba0395af27c12738f46b6f2`:
  cleanup reopened the exact probe draft, cleared synthetic text and residual
  list/quote structure, then returned to Inbox with two Escapes. Existing user
  drafts were not changed. Intermediate Escape focused the composer before
  closing; the replica's overall Escape/focus behavior is not established as
  equivalent by this implementation.
- `ev_b5a44c98c9c0dee3ae0b593935cebd95b6551147fe554e89ec4de5e93c1b2fce`:
  a separate 19-step probe repeated link application and undo, then tried the
  uppercase `Meta+Shift+Z` event. The link was still absent in the resulting
  accessibility snapshot. This does not establish that original redo is
  unavailable in all contexts; the later control below supersedes this uncertainty
  for the specific tested link workflow.
  Synthetic content was reset and the original returned to Inbox.

- `ev_44a5599a51730d1b5124d2f8c45d40292eec013e7fa0f8882c651c4330658cb4`:
  the original passed all 22 steps of a focused link/undo/redo probe when DOM,
  accessibility and URL were captured between steps and the screenshot was
  deferred until after the redo assertion. The synthetic link returned after
  Meta+Shift+Z. Synthetic content was cleared and Inbox restored.

## Implementation and deliberate boundaries

The client imports pinned `squire-rte@2.4.10` (MIT) for selection-aware editing and
undo. It imports `dompurify@3.4.17` for the HTML fragment boundary. These are public
package dependencies, separate from the privately retained original bundle.
Primary documentation: [Squire](https://github.com/fastmail/Squire) and
[DOMPurify](https://github.com/cure53/DOMPurify). Squire provides the editing API;
our React component provides the observed toolbar and popovers.

The accessible body is a `role="textbox"` contenteditable named “Message body”.
It serializes both plain `body` and optional sanitized `html`. Autosave, composer
close, scheduling and send snapshot the editor before saving. Reopening old
plain drafts remains supported. Metadata/attachment responses merge without
replacing current body edits. Snippets insert at the retained selection; AI
replacement is an undoable editor operation.

The client implements bold/italic/underline/strikethrough, link creation,
numbered/bulleted lists, quote, indentation, the six observed color choices,
undo/redo and sanitized rich/plain paste. Clipboard images use the existing draft
attachment upload path. These client choices and shortcuts have not all been
runtime-compared against the original. The Write AI toolbar control now opens inline selection editing; observations,
controlled async tests and remaining model/UI limits are in [ai-writing.md](ai-writing.md).

Client and server use matching markup and CSS boundaries: safe inline/paragraph,
list, quote and code tags, bounded style values, safe link schemes, and no remote
image/active content. `ol start` is constrained to a positive bounded integer.
The backend independently sanitizes persisted/sent HTML. This is a reconstruction
policy, not evidence of Superhuman's paste or remote-content policy. Unsupported
markup may be normalized or removed. Literal plaintext markup is escaped.

`web/test/composer.test.ts` uses synthetic jsdom content, no external resources or
provider calls. Eleven tests cover selected formatting, undo/redo, caret/snippet
insertion, lists/quotes, link/color serialization, controlled update stability,
AI replacement undo, rich-paste sanitation, plaintext round trips and readonly
delivery states. Nine App-level synthetic transition tests additionally hold save/dispatch responses,
prove send editing locks and duplicate prevention, and assert current rich content
is saved before an account switch, with draft retention on either failure. They
also distinguish ambiguous provider outcomes, confirmed preflight failures,
queued delivery before the stored status changes, read-only completion polling,
and unavailable status recovery without an automatic resend. Eight
existing sync-state tests also pass. Strict frontend types
and the production build pass. These tests establish only replica behavior.
Backend rich persistence/MIME tests are recorded separately by the backend owner.

## Recorded replica comparison and remaining scope

`ev_f58edf570f48ffffa4fe942fad11f614806631916243057d4dc16f8f5b21e0bf`
passed 45 rich-compose steps plus stored body/HTML assertions at the earlier
composer checkpoint. The paginated mailbox checkpoint repeated all 45 steps in
`ev_557faeabdaabffd581875cfb8824034c8c0d3cfb4f6ca5873cd8705b3d749226`.
The synthetic case selects text, applies bold and a link, undoes/redoes it,
applies the observed color/list/quote controls, then saves, reopens and reloads.
Intermediate screenshots are omitted for history-sensitive steps. No mail is sent.
Exact App hashes and the fixture boundary are in [scenarios/README.md](scenarios/README.md).

Original and replica observations support the scoped toolbar/link/list/quote/color
workflow. The toolbar is approximately aligned, with an observed replica vertical
offset of about four pixels; pixel equality is not established. SH-010 remains in
progress. Paste, indentation, AI selection flow, empty link handling, link removal,
rich signature/snippet expansion, clipboard attachments, selection at line wraps,
mobile positioning and all focus transitions require further comparison.

## Redo investigation: capture interference

The actual App's keyboard/React/autosave path passes without screenshots; a
matching negative control reproduces the failed redo when screenshot caret-style
changes are inserted. Both original and replica browser redo probes subsequently
passed without intermediate screenshots. Exact pinned source locations, controls,
evidence and limits are in [screenshot/undo interference](screenshot-undo-interference.md).
No production workaround was added for this instrumentation finding.
