# Private Knowledge: implementation candidate

This private candidate implements account-scoped durable file/page sources and
bounded read-only Ask AI retrieval. It is not a live rollout or full parity claim.
The original controlled TXT upload, correct three-fact answer, Knowledge source
citation and editor are recorded in
`research/knowledge-base-runtime.md`. The original 21 extensions and 50 MiB client
limit are declarations; acceptance of every format and all original backend
limits remain unmeasured.

## Files and extraction

`POST /api/knowledge/sources/files?accountId&clientRequestId&name` accepts raw
`application/octet-stream` bytes, with an actual 50 MiB limit independent of the
ordinary JSON budget. The server computes SHA-256. A durable source/blob/job/key
transaction returns 201, or 200 for the exact prior upload. A changed action under
a used key conflicts. Equal active file bytes are deduplicated within one
account; other accounts remain independent. No mailbox Draft/Thread is used.

| Extensions | Real extraction |
| --- | --- |
| c,cpp,cs,css,go,java,js,json,md,php,py,rb,sh,tex,ts,txt | Inert UTF-8 text; never compile, evaluate, execute or run TeX. |
| html | parse5 visible text; script/style/template/noscript content is omitted. |
| doc,docx | word-extractor OLE/OOXML text, including supported notes/header/footer/text-box views; no macro execution or layout fidelity claim. |
| pdf | PDF.js text content, at most 200 pages; no OCR or faithful layout. |
| pptx | Bounded ZIP/XML extraction follows presentation slide relationships and their referenced notes; orphan/external parts are omitted. |

Exact direct dependency pins are `pdfjs-dist@6.4.299` (Apache-2.0),
`word-extractor@1.0.4` (MIT), `fflate@0.8.3` (MIT) and `saxes@6.0.0` (ISC).
The private package lock pins the transitive tree, including PDF.js's optional
platform canvas binding. The maintainer's
[word-extractor API](https://github.com/morungos/node-word-extractor) supports
Buffer input and both Word formats. The
[fflate streaming ZIP API](https://github.com/101arrowz/fflate) is used with
explicit expansion limits, rather than allocating from untrusted ZIP64 sizes.
PDF.js APIs/types and licenses were checked in the pinned published package;
[PDF.js](https://mozilla.github.io/pdf.js/) documents the project.

Extraction runs in a subprocess using the current supported Node executable,
without inherited account/model/OAuth environment values. It receives bytes on
stdin, not a user filesystem path. Node filesystem permissions allow only the API
source directory, its package metadata, and individually resolved installed parser
package roots from a fixed parser list and bounded dependency graph. Exact selected
package symlink aliases are included because Node reads package metadata before
resolving the real entry. No entire workspace or `node_modules` tree is granted.
Hoisted npm workspaces and symlinked packages are supported; installation paths
containing permission-list separators, glob-like characters or controls are rejected conservatively.
Parser HTTP/DNS/socket APIs are disabled.
PDF's trusted optional native canvas binding requires Node's addon permission,
so this is not claimed as a complete OS security sandbox.

Default budgets are 192 MiB JavaScript heap, 10 CPU seconds on POSIX, 15 wall seconds,
1 MiB extracted UTF-8 text and about 2 MiB IPC output. Windows uses the wall budget
without the POSIX CPU limit. ZIP parsing caps 2000 entries / 16 MiB expanded XML,
rejects traversal/duplicate paths and unsafe XML, and writes no extracted files.
Large successful documents report truncation; malformed, encrypted, unsupported
encoding, empty or failed content remains an explicit error rather than ready.
All 21 extension families have generated synthetic parser tests; the legacy DOC
fixture is a real CFB/FIB/CLX extraction structure, not proof of complete Word GUI
interchange compatibility.

## Metadata, jobs and recovery

Sources use `pending → processing → ready|error`, an opaque contentVersion and
monotonic metadata revision. Only ready indexed text is retrievable. A file's
original name/type/bytes/hash remain distinct from its extensionless default
source name. The initial description is a deterministic local excerpt; no hidden
paid model call occurs. Explicit user descriptions, including an empty clear,
win over late ingestion results (`descriptionOrigin:'user'`).

- `GET /api/knowledge/status?accountId` → `{knowledge:KnowledgeStatus}`.
- `GET /api/knowledge/sources?accountId&limit&cursor` → metadata-only page.
- `GET /api/knowledge/sources/:id?accountId` → `{source}`.
- `GET /api/knowledge/source-actions/by-request/:key?accountId` → same source,
  never another ingestion. A deleted original key cannot resurrect/retarget.
- `PATCH /api/knowledge/sources/:id` accepts
  `{accountId,expectedRevision,name?,description?}`. Save never invokes a model
  or reingests content.
- `POST /api/knowledge/sources/:id/retry` accepts
  `{accountId,expectedRevision,clientRequestId}` and starts one new version only
  for an errored source. Exact key recovery never repeats it.
- `DELETE /api/knowledge/sources/:id` accepts `{accountId,expectedRevision}`.
  The explicit action removes blobs/chunks/index entries and leaves a private
  metadata/key tombstone. Prior chat text/receipts stay historical; citation
  resolution becomes unavailable. No original-product source is deleted here.
- `GET /api/knowledge/sources/:id/download?accountId` returns owned original
  bytes or the cached page snapshot with attachment/nosniff headers; never a
  signed external redirect.

One bounded local extraction job runs at a time. Revision/content-version and
owner fences reject late callbacks after deletion, replacement or dead-owner
reclamation while preserving newer human metadata. Another live owner is never
stolen. Interrupted local parse jobs may resume on startup because parsing has
no mailbox/model write; failed jobs require explicit Retry. Reads do not ingest.
Local budgets additionally cap 1000 active sources and 500 MiB raw storage per
account. These are local choices, not recovered original limits.

Visibility is always private. Team sharing is unavailable until actual
memberships/permissions exist; no switch can cosmetically grant sharing.

## Public links

`POST /api/knowledge/sources/links` accepts
`{accountId,clientRequestId,url}`. The initial implementation reads one public
HTTPS UTF-8 HTML/plain page (2 MiB, 15 seconds, at most 3 redirects). It has no cookies,
embedded credentials, authenticated session, browser JavaScript, domain crawl or
automatic live refresh. Those original-product claims remain fulfillment gaps.
`link.requestedUrl` permanently identifies the normalized submitted URL;
`link.url` identifies the final cached URL. Fragments are stripped. Retry starts
from requestedUrl, and download returns the cached bytes.

Each redirect resolves and validates all DNS addresses before a pinned TLS read.
Literal/numeric addresses are canonicalized. Numeric CIDRs reject private,
loopback, link-local, mapped, documentation, benchmark, multicast and reserved
ranges. The policy conservatively rejects special-purpose protocol allocations,
including all IPv6 IETF 2001::/23, even where some suballocations are reachable.
The address rules were checked against the primary
[IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and
[IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) registries.
DNS rebinding cannot substitute an unvalidated address for the pinned connection.
All development URL tests use injected transport; no actual page was fetched.

## Typed Ask AI grounding

`context.resources` accepts `knowledge`; `[]` still forbids new retrieval.
The frontend defaults Knowledge on alongside Mail as a local policy. The server
does not dump all sources or ingest when opening/chatting. `knowledge_search`
uses bounded account-scoped FTS literals; `knowledge_read` accepts only source
receipt IDs actually offered to the current turn. Search returns up to 5 hits;
read accepts up to 4 receipts, with a whole-turn 8-read budget and existing 60-second,
provider/tool/context/output budgets. Text chunks are at most 8192 UTF-8 bytes.
This is literal local retrieval, not a recovered semantic-ranking algorithm.

Receipts use target kind `knowledge`, sourceId and chunkIds, with
`knowledge-summary|knowledge-text` bases and `local-private` coverage. They are
never represented as mail. Metadata/chunk hashes, current account and source
version are rechecked by the existing scoped citation resolver. Edited content
is changed; deleted/unready/foreign sources are unavailable. Historical receipts
are immutable, and arbitrary model IDs/URLs cannot mint navigable citations.
Partial cached/indexed data is never described as complete original coverage.

## Offline checkpoint and remaining recovery gap

The private candidate passed407/407 API tests and strict NodeNext types: the375
base plus15Knowledge core/API cases, ten independent generated-format/worker
cases and seven independent URL/account/job/citation cases. The model integration
was a mocked three-round Claude stream, not a live call. No real account, model,
mail provider, website source, existing draft or original-product source was
accessed by these tests. Initial independent PPTX ordering/orphan and IPv6
benchmark failures remain retained privately; their fixes pass the final suite.

Input boundary tests also cover a valid20,000-byte escaped description through
its64KiB JSON route, a16KiB link request budget, and a4,096-byte canonical URL
limit after encoding. Original parser accuracy, generated descriptions, remote
freshness, domain crawling and team permissions remain separate gaps.

The subsequent combined private candidate passed444/444 API tests and strict
types, including Personalization, delivery, cached-mail-grant migration and two
Knowledge/Personalization integration cases. A relocated npm-workspace control
extracts generated TXT, DOC, DOCX, PDF and PPTX through the actual worker using
hoisted symlinked dependencies; an unrelated sibling package remains unreadable.
A separate control rejects unusual permission-path separators, glob-like
characters and controls. These are local deployment/security checks, not original
product comparisons or a complete OS-sandbox guarantee. The earlier407 archive
is preserved unchanged.

A known safe recovery limitation remains: if an accepted upload/retry loses its
response and another window deletes that source, the key's read route returns404.
The client preserves uncertainty and never uploads again automatically, but this
can block later writes for that account. An explicit historical action receipt
with a deleted/unavailable resolution is a future improvement. Do not clear the
journal, retarget the key or infer failure from404.
