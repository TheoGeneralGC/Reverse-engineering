# Screenshot capture can invalidate rich-editor redo

This is an instrumentation finding and an offline reproduction. It is not a
claim that original or replica redo is unavailable, nor proof that every failed
browser redo was caused by this mechanism. No production behavior was changed.

## Retained browser observations

Replica REA evidence
`ev_b47e7eb0477151cdd5ecf6a349f85f5f59a037b5ba246abeb510dca689e350ba`
(applied fixture revision in private `replica-e2e/20261028T013457Z`) retained a
synthetic link nested inside bold text. Meta+z removed only the link, preserving
bold. Meta+Shift+Z then left the link absent. Screenshots were requested after
every step, including between Undo and Redo. The retained editable host included
an empty inline `style` attribute after capture.

The original probes likewise did not restore a link after the attempted lowercase
and uppercase shortcut variants. Exact original evidence IDs and scope are in
[rich-composer.md](rich-composer.md). Later original and replica probes passed when intermediate screenshots were
omitted; the exact controls are recorded below.

## Pinned primary implementation sources

Paths are relative to this monorepo's installed dependencies, read without
modification. These dependency files are not copied into the source tree.

| Package | Exact local source location | Relevant behavior |
| --- | --- | --- |
| `rea-agents@6.8.0` | `node_modules/rea-agents/dist/browser/PlaywrightScenarioArtifacts.js:28` | `captureScreenshot` calls Playwright's page screenshot with `caret: "hide"` at line 34 |
| `playwright-core@1.58.2` | `node_modules/playwright-core/lib/server/screenshotter.js:64` | Enumerates `input,textarea,[contenteditable]`, records inline caret style, writes transparent `caret-color` at line 72, restores it at line 77 |
| `squire-rte@2.4.10` | `node_modules/squire-rte/dist/squire-raw.mjs:2623` | Creates the mutation observer; its root observation includes attribute changes |
| `squire-rte@2.4.10` | `node_modules/squire-rte/dist/squire-raw.mjs:3146` | The change handler marks a current undo state changed and advertises no redo after an observed mutation |
| `squire-rte@2.4.10` | `node_modules/squire-rte/dist/squire-raw.mjs:3234` | Redo requires the current undo-state flag in addition to a later history entry |

SHA-256 of these pinned local sources, respectively:

- REA artifact implementation: `2e5c587cb25dc79853083ac3809368a66b58f43fbc4f20cb4cc4f1775f1715bb`
- Playwright screenshotter: `9aaff6c173c6a9a1c80e831dd92ccc24097243d49ad600dc87c4bc1fad9c625b`
- Squire raw module: `56428045f56029c7208b41ee72000f4699ce19c0bbd89612f42cf2622cffd7f6`

The mechanism inferred from these sources is that hiding/restoring a caret changes
the editor root's inline style. Squire observes that attribute change as an edit,
so a redo that was available immediately after Undo can become unavailable before
the next keyboard action. The source description alone does not establish that
the original uses this exact Squire release or that its observer has identical
configuration.

## Offline positive and negative controls

`web/test/draft-transitions.test.ts` loads the actual React App and local editor
with jsdom and mocked fetch responses. It compiles the project's TSX through its
installed Vite transformer. No provider, Chrome, original account, screenshot
capture or external resource is accessed. Both controls start from an empty draft,
fill synthetic text, select/bold it, invoke Meta+K, enter a synthetic URL, apply it
with Enter, wait through autosave, invoke Meta+z, and wait through another autosave.

- **Positive control:** Meta+Shift+Z restores the link. This covers React keyboard
  capture, controlled updates, focus restoration, mutation observer microtasks,
  and the actual App autosave code.
- **Passing negative control:** before Meta+Shift+Z, set the editable host's inline
  caret color to transparent, allow observer microtasks, restore its prior empty
  value, and allow observer microtasks again. Redo then leaves the link absent.
  The test expects this interference specifically for the pinned stack. It is not
  a desired product behavior; a future dependency change that fixes this boundary
  should prompt reevaluation of this control and prior capture interpretation.

Run only these controls from the monorepo root:

```sh
node --experimental-strip-types --test --test-name-pattern='actual keyboard|negative control' apps/superhuman/web/test/draft-transitions.test.ts
```

The paired result reproduces a concrete mechanism while holding the App,
synthetic text, keyboard actions, focus and autosave constant. jsdom is not
Chrome, and the negative control emulates the inspected DOM writes rather than
executing Playwright's screenshotter. Thus attribution of the actual browser
failure remains an inference until a browser comparison removes intermediate
screenshots.

## Browser controls without intermediate screenshots

The original focused probe passed 22/22 steps:
`ev_44a5599a51730d1b5124d2f8c45d40292eec013e7fa0f8882c651c4330658cb4`.
The replica rich-formatting and persistence probe passed 45/45 steps plus stored
HTML/plain-body assertions:
`ev_f58edf570f48ffffa4fe942fad11f614806631916243057d4dc16f8f5b21e0bf`.
Both captured DOM, accessibility and URL between steps and deferred screenshots
until after the redo assertion. The original synthetic draft was cleared and
Inbox restored; the replica used an isolated synthetic database and sent no mail.

These positive controls support capture interference as the explanation for the
retained instrumented failures. They do not establish every editor history path,
or identify the original's exact editor dependency release. Future history-sensitive
scenarios should keep screenshots outside the undo/redo interval and retain
negative controls when changing capture/editor versions.
