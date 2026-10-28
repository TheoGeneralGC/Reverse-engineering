# Replica AI answer rendering

Recorded 2026-10-28. This describes a local implementation choice and offline
tests. Original observations remain in [ai-assistant.md](ai-assistant.md).
It does not establish full Markdown, clipboard, streaming or visual parity.

The controlled original formatting answer
`ev_85d271e29959e394baa6fe59e064a3d5b6c491fc7aa378af8b98ffe4a74d1b94`
contains a heading, two bold-labelled bullet items, a two-row table and inline
code. Later original citation/source observations establish a numbered bubble,
source expansion/highlighting and navigation to one controlled synthetic email.
Those captures retain incomplete event coverage; successful UI actions do not
establish the private retrieval protocol or a general grounding guarantee.

## Local rendering boundary

`AiMarkdown.tsx` converts Markdown parser tokens into a fixed allowlist of React
elements. Provider strings never enter `dangerouslySetInnerHTML`. Source HTML is
disabled, text/code uses React escaping, and images cannot fetch remote content.
Links require an absolute HTTP(S) or mailto URL without embedded credentials,
control characters or encoded CR/LF. Ordinary links use opener isolation.
Tables, lists, quotes, headings, emphasis, rules and code have distinct elements;
unsupported token tags cannot select arbitrary React/HTML elements or attributes.

The pinned parser is `markdown-it@15.0.3`, with its package integrity retained in
the lockfile. Its [official safety guidance](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md)
recommends disabling source HTML. The [maintainer advisory](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-vfgh-jcmw-g37q)
identifies 15.0.3 as a patched release for the HTML-enabled parsing issue. The
replica additionally bounds input and uses the fixed React element renderer.
This is not an assessment of every parser dependency or browser vulnerability.

The local internal citation marker is `[cite:1]`, mapped to an authoritative
current-turn receipt and displayed as a `1` button. This marker is a design
choice, not recovered original syntax. Plain `[1]`, escaped markers, inline or
fenced code, Markdown link labels and unknown numbers stay noninteractive.
Parsing does not resolve a model-supplied URL into a source. Duplicate labels or
receipt IDs are ambiguous and cannot acquire a clickable binding. Parent session
state must still enforce account/turn identity and resolve sources before explicit
navigation; the renderer cannot prove semantic support for an answer.

Current caps are 32,768 UTF-16 characters, 100 receipt bindings and positive
display numbers up to 999. Oversize answers display an explicit message rather
than a partly active response. These are local caps; original limits are unknown.
Copy controls must use rendered answer content rather than exposing the internal
marker protocol. Exact original clipboard formatting remains open.

## Offline evidence

Seven tests in `web/test/ai-markdown.test.ts` pass with Node 24.22.1:

- Synthetic Cedar/Birch facts retain heading/list/table/code structure and Unicode.
- Only known reserved prose markers become citation buttons; code, escaped,
  unknown, ordinary numeric and link-contained markers remain literal.
- Raw HTML/event handlers and unsafe schemes/application URLs cannot create
  executable markup; image markup creates no image element or automatic fetch.
- External links have the expected destination policy and opener isolation.
- Duplicate/forged receipts cannot create navigation controls.
- Over-limit input cannot partially activate a citation.
- An actual mounted React button dispatches its trusted receipt ID; replacing
  receipts with an empty set removes the old binding.

An initial nested-link test failed because a citation rule consumed brackets in
the parser's silent link-label lookahead. The rule now runs after normal link
parsing and declines silent/inside-link states; the same test passes without
changing its expected result. This was an offline parser integration defect,
not an observed original behavior. Browser comparison of the integrated Ask AI
workspace and its copy/keyboard/streaming paths is still required.
