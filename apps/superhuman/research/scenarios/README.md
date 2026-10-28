# Replica browser regressions

These scenarios exercise the synthetic local demo through REA 6.8.0 using
temporary, REA-owned Chrome profiles. They never connect to the original
Superhuman browser, never send messages, and never require provider credentials.
The runner refuses to start unless the API's active account is `demo` and all
connected accounts use the `demo` provider.

With the replica API on port 3001 and web server on port 5173, run from repo root:

```sh
python3 apps/superhuman/research/scenarios/run.py
```

Supply case names to rerun only changed behavior:

```sh
python3 apps/superhuman/research/scenarios/run.py search-jordan command-keyboard
```

After connecting real accounts, run a separate demo server in another terminal:

```sh
bash scripts/superhuman-demo-test-server.sh
python3 apps/superhuman/research/scenarios/run.py --api-origin http://127.0.0.1:3002 --web-origin http://127.0.0.1:5174
```

This server uses the private `.local/e2e/superhuman-browser.sqlite` database,
disables provider credentials, and leaves the real app on ports 3001/5173.
The same demo-only checks run before each scenario. Alternate origins must use
an explicit loopback address and port.

The runner invokes `npm run --silent rea -- capture-browser-scenario` with the
pinned package. It saves instantiated scenarios, complete evidence JSON, DOM and
accessibility snapshots, final screenshots, API state before/after, source hashes,
and `report.json` under ignored `evidence/private/replica-e2e/<UTC-run>/`.
macOS sandboxed runs need local networking/process-launch permission for Chrome.
Every scenario sets the time zone to `America/Los_Angeles`.

| Scenario | Assertions |
| --- | --- |
| `draft-save-reopen` | C opens composer; recipient/subject/body fill; Escape saves; G D opens Drafts; draft reopens; edited subject persists after page reload; API retains exact recipient/body |
| `search-jordan` | Slash focuses search input; Enter submits; known inbox Jordan row appears; two matching conversations include the archived Jordan fixture |
| `command-keyboard` | Cmd K focuses input; filtering and ArrowDown selection work; Shift Tab/Tab wrap within modal; Enter runs Go to Drafts |
| `archive-undo-native-button` | E removes selected Jordan row; Undo restores it; Enter on focused Switch folders button opens navigation without opening a message/composer; API confirms Jordan remains in inbox |
| `narrow-viewport` | Inbox and Jordan row render at 390×844; screenshot retained for review |
| `attachment-draft` | Node API creates an owned synthetic draft and uploads 51 UTF-8 bytes; download bytes/hash, MIME, filename, no-store and nosniff match; browser shows the attachment link and remove control |
| `reply-all` | Enter opens selected synthetic thread; second Enter opens composer with expected subject/recipient; captured POST `/api/threads/demo-thread-1/reply` contains `{"mode":"replyAll"}` and returns 201 |
| `reminder-undo` | H focuses Remind me; typed `3 days` produces date option; Enter removes Jordan from inbox; Undo restores row; screenshots retain picker and resulting states |
| `label-picker` | L focuses Add label; filtering Work displays active match; no label mutation performed |
| `rich-compose` | Floating toolbar; bold/link/undo/redo/color/list/quote; save/reopen/reload with stored plain body and sanitized HTML assertions |
| `inline-ai-unconfigured` | Cmd+J opens inline AI; missing configuration is shown; synthetic body stays editable and persists exactly after closing |
| `side-ai-unconfigured` | Independent left Ask AI and right contact coexist; real missing-configuration notice; no generated turn or insertion; New/History and unsent prompt survive close/reopen/reload; Escape retains the mounted composer; the exact draft body persists |
| `recipient-editing` | Enter/comma/semicolon commit; Backspace removes; existing-chip edit stays selected without an input; invalid Escape, local suggested Tab, Cc/Bcc focus, adjacent-field move and shared undo/redo; exact headers/body persist after reopening |
| `calendar-week` | Actual Calendar workspace with injected synthetic provider: week/all-day details, visibility, navigation and unknown/known availability |
| `calendar-create-edit-delete` | Same isolated fixture: observed When phrase, custom repeat dialog, then synthetic create/edit/delete with confirmed local results |
| `contact-context` | Actual recipient/message intents and bounded recent mail; previous/author Backspace; draft editors and Undo retained across search; recent-row/read-thread navigation and return; current-thread exclusion; latest draft reopens with exact persisted values |

The attachment helper uses Node native fetch against the local demo API; it
never invokes delivery. It stores upload/download assertions in
`attachment-api-check.json`.

Saved test drafts remain clearly synthetic, with a run-specific subject and an
`example.test` recipient. They are not sent. Archive is immediately undone.
The runner records page errors and action failures; a zero CLI exit status alone
is insufficient. New runs retain SHA-256 manifests for all frontend/API source, package locks and
Calendar browser-fixture files before/after every case and the complete run. Any
source drift rejects the run. Earlier checkpoints below retained App.tsx hashes
only; their narrower identity boundary remains explicit. Stop making implementation
changes while collecting a final regression run.

Passing these checks proves these replica interactions on demo data. It does
not prove original visual/behavior equivalence, responsive parity, provider
delivery, worker restart persistence or complete product coverage. Those require
the corresponding original evidence and broader acceptance scenarios.

## Calendar fixture boundary

Calendar cases load `web/test/calendar-fixture.html`, a separate test entry that
imports the actual Calendar workspace and injects a deterministic request function.
Its catalogs, events, free/busy results and operation receipts are synthetic.
Every supported Calendar request terminates in that function; unsupported requests
throw, with no network fallback or credentials. The real demo API is still checked
for demo-only accounts before launch. Create/edit/delete mutate only the fixture's
in-memory event collection. This verifies browser interactions and rendering, not
live Calendar authorization, provider writes, persistence or complete parity.

The fixture clock is October 27, 2026, 19:23 America/Los_Angeles; the week cases
request 1920×963 to match the expanded reference. Screenshot metadata must confirm
the actual size. Original evidence and remaining gaps are in [calendar.md](../calendar.md).
The fixture is excluded from the production bundle's entry points.

## Latest frozen Send/Undo-source regression checkpoint — 2026-10-28 UTC

Run `20261028T193639Z` passed **16 cases/407 steps**, all eight persisted-state
assertions, zero page errors and terminated-owned cleanup. Each case/run manifest
retained the same **98 entries** before/after. App SHA-256 is
`5650ebf07a4bf3c92535204d9bfb6a20733d5375fee73f07e617a05e14df492b`. Separate offline gates
passed **325 API/290 web tests**, build and strict types with isolated databases
and mocked providers. These are the frozen source identities for the recorded
runs; subsequent implementation has its own checkpoint.

| Scenario | Completed/expected steps | REA Evidence ID |
| --- | ---: | --- |
| `draft-save-reopen` | 26/26 | `ev_dd4bd3a489ec22f3d617c2e5f870d55386a7c9432e4b0af2aa274acd3ac37836` |
| `search-jordan` | 8/8 | `ev_d1c040ab9727e65f135a93da4c7d3b65137aac1f5e7b0c725a4cefae0c8d195d` |
| `command-keyboard` | 16/16 | `ev_992c6d887271fea659a14c6e575715890096c6fbdd616b0945bc850d121291b8` |
| `archive-undo-native-button` | 12/12 | `ev_cd62951c16f4dc95b731e2fa4b4bb6a1b227c7d7bd21256ceb01c79bdcfe0684` |
| `narrow-viewport` | 3/3 | `ev_36e278f4ffcad58a0c790d3008b2761e2985376513a9ab37ccb434d3aec4e292` |
| `attachment-draft` | 8/8 | `ev_e9676931f3ebc37630981bab592466f95859af6acf32e575484fbcdf73a04e16` |
| `reply-all` | 8/8 | `ev_de8a2550780b4a2e677887b328774a16cce29935a6817e82274166e813b6217e` |
| `reminder-undo` | 11/11 | `ev_fa81451d0534ecac4c5aae13036dace40d9fa3ebca5a10052a3404c7e6f490ce` |
| `label-picker` | 6/6 | `ev_4cb9a7370e151898c67213307a4976ee13a047ceda7e221c3178bf35901275df` |
| `rich-compose` | 45/45 | `ev_75d45ef946a23582c55240f26597d533e0a385fdcf364931ac00d2482d135eb5` |
| `inline-ai-unconfigured` | 18/18 | `ev_66efcdd39cfe2b13f548720238b575501a8c302f962796d871d16a9356afce58` |
| `side-ai-unconfigured` | 42/42 | `ev_2a11730eb551f22ea92aac0b0939a9ea16925ef7d6fdea4ee5e9c9ccf2791ac8` |
| `calendar-week` | 24/24 | `ev_9d3e471ef73c67da2aee23eaf8647fc19c38ac7c947eb7bf5432bdf4f9e28da9` |
| `calendar-create-edit-delete` | 34/34 | `ev_62bdea9d267b0c11de45e480301794b833b3fbbede62ebc55fdef6d428535b41` |
| `recipient-editing` | 66/66 | `ev_c18d0e07d75cc2f650f976b3de7b61aee2c21c7975a661c56c0ab46ec7236dc4` |
| `contact-context` | 80/80 | `ev_789f658e61957993f940777965e46a4ffb6c1168e96894ecd49b22c7d3c27b50` |

Fifteen captures have complete requested sections. Reply-all
`ev_de8a2550780b4a2e677887b328774a16cce29935a6817e82274166e813b6217e` retains missing events and
`equality_eligible=false`; its exact reply-all POST/201 assertion passed. Complete
requested capture sections do not establish equality with the original. This
full run uses synthetic demo mail, fixture Calendar, and missing-AI-configuration
paths; it makes no paid model/provider delivery claim and does not exercise a
live Send/Undo lifecycle.

Private report SHA-256 is `abdd4c79882d7bf03e461bc1376e71943badd5f7d1ee99edc5f95c62d0387422`;
run-source-manifest SHA-256 is `8c8edaf1d832bad61201f80bf68609b222e80faf0f7273f47ec59d30d52101e7`.
The 170-file source checkpoint is
`.local/source-checkpoints/ai-send-undo-api325-web290-20261028T193707Z.json`
with archive SHA-256 `3ab19121d68b47ba20a7ebeb66e4800ef6c7aa41ac82d940ab6813d97ec64d3c`.
Earlier successful and failed runs below remain separate evidence.

### Separate current-source Create regression, no new model turn

`ev_c1c96eba211875497505b9b6cf5b09d51ac7fa432528f688a8e434f0fbd058a3` completed **45/45 steps**
on the isolated Claude/demo API and UI. It restored the exact previously generated
preview/history, opened its existing generation2 draft, replaced text with
Meta+A/Backspace before filling, and checked exact editable DOM, saved PATCH and
reopened text. Only that owned draft was cleared/deleted; one explicit Create
produced a distinct generation3 draft with the original canonical payload. All
original baseline drafts remained unchanged. Captured mutations were exactly
one Create POST, one owned DELETE and one PATCH, with no Send, cancellation,
new-turn/model, schedule, sync or Calendar POST.

Its **105-entry** source manifest stayed stable, zero page errors were recorded,
and the owned browser terminated. It retains missing-event coverage and
`equality_eligible=false`. The original proposal fixture still records its
historical API280/App004f source; the new report separately binds API325/web290
and App5650. No seed provenance was relabeled and no new model turn was submitted.
The older 46-step content failure remains failed; this run does not replace it.
See [the Create ledger](../ai-draft-design.md) and
[Undo observations](../undo-send.md) for separate original and provider limits.

## Earlier frozen Create Draft full checkpoint — 2026-10-28 UTC

Run `20261028T184523Z` passed **16 cases/407 steps**, all eight persisted-state
assertions, zero page errors and terminated-owned cleanup. All case/run manifests
matched the same **93 entries** before/after, with no drift. App SHA-256 is
`004f6a854c5ba9d9887d1ec064234752c6dda48acc94b34b2e75d829717fce40`;
AI draft card is `ae26c84d2b0910025f27ca81eec0b09fbf633c3c63f0b43a4cd5071c24144165`;
API draft service is `1707b5c7659dfa5cae19bb44046a977f204c82803480a8a1f40771496e46063a`.
The target is the isolated synthetic demo on ports 3002/5174, REA 6.8.0/Chromium
156.0.8078.48. Calendar actions stay in the injected fixture; missing-config AI
uses no model. This regression is separate from the live Create check below.

| Case | Steps | Evidence |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_1308fd7e8f42c69ca2657826afc75e4e0ec69388c8849d986fefdfb12bf9e13b` |
| `search-jordan` | 8/8 | `ev_e9b4dbf2408c8ffbc4360ea6d2ffbcac0da5cc1c5b04e2bc01ad60642957d9d1` |
| `command-keyboard` | 16/16 | `ev_4b3017677ee3e2a17df87d3f1e6aec5fec9800f78255a8a8b6252f97f821f985` |
| `archive-undo-native-button` | 12/12 | `ev_d7e448b8144090bfe3f06ecb1bcd7079b00e98cbc4e3466a7358495c53e8b3d7` |
| `narrow-viewport` | 3/3 | `ev_a1d97ad911ba151b576e28372cd2224355f9be2115c04fbc8870e697a68ed6f3` |
| `attachment-draft` | 8/8 | `ev_495928903349092a75500bd7d1cd1324a4f4db609f91c8c3355f168719f9466e` |
| `reply-all` | 8/8 | `ev_465c8362a3a4a23330e51cfd0281d725f80e8baa29147e4acf08e67a1c71186c` |
| `reminder-undo` | 11/11 | `ev_bd0b45c64d8b85e971980a594e8458d2529457402f669e73cbbe00695a08a49e` |
| `label-picker` | 6/6 | `ev_d29351a57d7d0296ace3fe091fa356c4948410aa0fb085012c0b4b2b332fd919` |
| `rich-compose` | 45/45 | `ev_8ba0b975cee833af5646cbfb3e08078db9581a8c97a8ce2e70154db3f98f0fea` |
| `inline-ai-unconfigured` | 18/18 | `ev_9bc7bb0a378575f913ce6e40bedccd8983567e59dc239dedf0ae922b9dd0efca` |
| `side-ai-unconfigured` | 42/42 | `ev_3d466011e6b1beaa3c190653d96d43d139e4790b4af2e0abb0c9e8caae7142d9` |
| `calendar-week` | 24/24 | `ev_cfc63d19e2626b4c988e5df5d5a4390a403036f6ab7c892fe129241ffbbc714a` |
| `calendar-create-edit-delete` | 34/34 | `ev_eea5528a47176e8219f6e3e5e06da054bfa5ba301d3a747e3a2b8573d0acd612` |
| `recipient-editing` | 66/66 | `ev_048904a9ca6ce15c56677414916cdc0aa4706902321d11268e9347c432dd9870` |
| `contact-context` | 80/80 | `ev_81c3411dfbc653541130cde3bbb3f78ec16d14591a8bbc396229baabd916761f` |

Fifteen captures have complete requested sections. Reply-all remains incomplete,
missing `events`, `equality_eligible=false`, with its exact reply-all POST/201
assertion passed. Equality eligibility is not original-product equality.
Private reports/captures remain in `evidence/private/replica-e2e/20261028T184523Z/`.
Report SHA-256: `0358f92328499ca58d82f432153208b957f25014d71faceea7cb90d4c2bcb23f`;
manifest SHA-256: `dac72cdca9ef164a833e045313d685cf8d069be2a3560bef7d7f3fc48438ed31`.

Separate gates passed **280 API/249 web tests**, build and strict types. The
157-file frozen Create archive is
`.local/source-checkpoints/ai-draft-create-pre-send-20261028T1847Z.json` and
its `.tar.gz`, archive SHA-256
`90546ddce3a4544be4c53c0adbefdaaffdcbb3c8d33e0b265152360a36213561`.
Later Send work is outside this checkpoint.

### Separate controlled live Create check and preserved content failure

One real Claude proposal-only turn (resources [], no mail context) produced a
preview without changing any existing draft. An initial UI readiness attempt
stopped before browser actions. A later 46-step browser capture,
`ev_6881a21cda20c6657028029825fcd162e6b8a583d8cb943ff7a57018c6593828`,
completed its actions but **failed exact saved-body content**: direct fill had
concatenated replacement/original text in DOM, PATCH and reopen. The cause remains
an uncertain Squire/automation interaction; this result is not relabeled a pass.
A separate four-GET audit established historical receipt/current payload/baseline
safety without replacing that content failure.

A separate native-keyboard follow-up passed **45/45 steps**:
`ev_fa3a5cb71c2f49ee04a54cb4a037a9ae63144798b0f85ec9de14aa6692d723ac`.
Meta+A/Backspace before filling gave exact DOM/PATCH/reopened text. Only the owned
empty generation1 draft was deleted; a fresh explicit Create generation2 produced
a new canonical draft, with baseline drafts unchanged and the old key still gone.
There was one Create POST, one DELETE and one PATCH, no additional model/Send
POST. It retained 98 stable entries, owned cleanup, missing events and
`equality_eligible=false`. See [the Create ledger](../ai-draft-design.md) for
full source/report hashes, original UI-only limits and retained failed attempts.

## Earlier frozen AI workspace full checkpoint — 2026-10-28 UTC

Run `20261028T175808Z` passed **16 cases and 407/407 steps**, with all eight
persisted-state assertions, zero page errors, no skipped cases and every owned
browser terminated. It used the isolated synthetic demo on ports 3002/5174,
REA 6.8.0 and Chromium 156.0.8078.48. Missing-configuration AI checks make no live
model calls; Calendar writes remain inside the injected in-memory fixture.

All sixteen case manifests and the whole-run manifest retain the same **88
entries** before/after, with no source drift. App SHA-256 is
`c5fe2b2fa1a6998d93345a55b20265a83c2bdff651f6f28fa88dbd932d26ae6a`.
App alone cannot identify later changes: the final AI pane is
`dfe6d9d613c5a20a04248eb18862582cd92209ad76bce8a6892ac0dc5076db90`,
chat controller `cc1ae9a93ed7073886951a2deb0327a5e3ab52d3ad19372b356f58dc12811472`,
and AI CSS `229febaaf22aae81d90ff450c1316529e66737d8fd31305a12eb3eae4bc701c5`.

| Case | Steps | Evidence |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_4174e25f331db8e383382b68d39b68f9ce931a2e0dfab7b6933a9875ea339c80` |
| `search-jordan` | 8/8 | `ev_8233c54491d543adcd518194e59b194b045049fa25fee0033c28b33c90608f80` |
| `command-keyboard` | 16/16 | `ev_e609169f5e57e216e5ae0077b0ff30463b69bda6d0c0264e362904a564d4e73e` |
| `archive-undo-native-button` | 12/12 | `ev_8c4d2c383165f1385b216e179b6c5a8d0e828d0795ae9f97b4fafc066f1a6aec` |
| `narrow-viewport` | 3/3 | `ev_78d4d26ac8be93b6bdf93b97384c9ea4876032539cd3b4e4afe01aa79c50a243` |
| `attachment-draft` | 8/8 | `ev_44c729d1563d891db2788d45bbc8c291c58ba17f722a1d3bdfd2d56f4d7dee4f` |
| `reply-all` | 8/8 | `ev_a50813253e2727940d38c0462c8ab0bbc18384386d5d08c6a804535a24b0b7e3` |
| `reminder-undo` | 11/11 | `ev_b0572e48492169a7538113c5f9d4bdce438a336ab4433f3494e01dad890eb163` |
| `label-picker` | 6/6 | `ev_e46f1001812da0b439daad87f1b0381312a7427daf29ba89a14eef9f5627e38d` |
| `rich-compose` | 45/45 | `ev_571ab0a1399ba9ca21751833fb13e76876e8eb68b8c9b531c63fdd0068a706a4` |
| `inline-ai-unconfigured` | 18/18 | `ev_ebd30338728d68875c23e057de6ed83e4b33d20a7f986813b492354348add365` |
| `side-ai-unconfigured` | 42/42 | `ev_3302dddb75538baad4800e8b644149e7dd5f3d58a24aae913d565c7ac39c7abc` |
| `calendar-week` | 24/24 | `ev_a34d431db835361017cd623111f0e770a18c8ed0215a368fd7b50d365291aca4` |
| `calendar-create-edit-delete` | 34/34 | `ev_6f4a8ad1b948661a6f438e471ea6b3ab143ac11ae2e9f26967b7c3da868629f6` |
| `recipient-editing` | 66/66 | `ev_e19420443d98cf5fa85b08d5b8c10f558ab46b69071cafad4861c30553876801` |
| `contact-context` | 80/80 | `ev_cc136485a6cbf88bff29f9ab29d946e40a26774247af1029c8b57ae6ab4cbef3` |

Fifteen captures have complete requested sections and `equality_eligible=true`.
Reply-all remains incomplete, missing `events`, `equality_eligible=false`; its
captured exact reply-all POST/201 assertion passed. Equality eligibility does not
establish original-product equality. Full evidence is private under
`evidence/private/replica-e2e/20261028T175808Z/`.

- Report SHA-256: `95f122644e58e94fe3a4f84dc894a0977fa8df9b7b331a5c3d0051e546934098`.
- Whole-run manifest SHA-256: `6436138ffc9df6027e78703bc6a1c858e614791aa1e3f8f24dd842380e1fbe01`.
- Root archived **138** source/test/config files before capture, with stable
  identities: `.local/source-checkpoints/ai-left-pre-draft-20261028T175751Z.json`
  and matching `.tar.gz`; archive SHA-256
  `a4efb1a44f6683e313e67626a6d48efda881f3262435f9dbe33fe6ab3281ff2d`.

Separate offline gates passed **261 API/221 web tests**, build and strict types.
These include mocked provider/storage/controller/React cases and do not add
provider or original-product coverage. Subsequent AI draft-action implementation
is outside this frozen checkpoint until separately validated.

The later read-only visual/history restore passed **8/8** steps:
`ev_51dc22fe5a198194a079d8bdae69a7465f1f578c3424387884cf012d7557f724`.
Its network metadata captured zero POSTs, requested sections were complete and
`equality_eligible=true`; owned cleanup completed. It restored an existing owned
formatting answer with no fresh model call. It is distinct from the earlier
70-step paid UI cases below and adds no pixel-diff/full-parity claim. Private
capture: `evidence/private/ai-assistant/replica-visual-restore.json`, SHA-256
`d7b6a8d5bc5e7f72ae8192b52fc3a5b3301dab389384a8d819553f072a9dda31`.

### Preserved New and focus failures before the pass

The earlier full attempt `20261028T174514Z` below remains failed. After its New
prompt race was fixed, focused `20261028T175150Z` failed at `ai-closed`:
`ev_65fc2de0cf203d28b6ea9085d899e4063483afb6c801d073cd8c33376c96dac6`.
It retained 24 completed/one failed/seventeen cancelled of 42 steps, zero page
errors, stable manifests and terminated-owned cleanup. Coverage is incomplete,
missing accessibility/action/DOM/screenshot/URL, `equality_eligible=false`.
A disabled/loading textarea could leave Escape outside the AI focus boundary and
reach Mail. Controlled owner regressions fixed focus containment and a focus
lease so ready-state updates do not steal a user's newer composer focus.

Focused `20261028T175627Z` then passed 42/42:
`ev_b9c66f9a2d386332d21013a917b23a9bd2a38862534690942f79ccdb9c7d932c`.
It is incomplete only for missing DOM at scenario start, equality-ineligible;
all action captures passed. The subsequent full run above has complete side-AI
coverage and supersedes it as a passing checkpoint without deleting either
failure. Earlier contact/recipient failures below also retain their outcomes.

## Subsequent bounded live Ask AI browser checks — 2026-10-28 UTC

Three isolated real-Claude cases passed **70/70 steps** on UI/API ports 5175/3003:
formatting/history 27, synthetic source/navigation 29, Stop 14. App SHA-256 is
`c5fe2b2fa1a6998d93345a55b20265a83c2bdff651f6f28fa88dbd932d26ae6a`.
Every case retained 94 stable manifest entries, zero page errors, unchanged demo
drafts and `terminated-owned-process` cleanup. There was one exact-scope turn
POST per case/five upstream dispatches total. All three captures are incomplete,
`equality_eligible=false`, missing `events`.

| Case | Steps | Evidence |
| --- | --- | --- |
| Formatting, New/History, close/reopen | 27/27 | `ev_f61c73b59a77f57c5f83be81045ea468f2960024941e2f859ba574c61ada5caf` |
| Exact synthetic citation/source navigation, left AI/right contact | 29/29 | `ev_a41a3b765019258299934a5b254f26b549d7403d6d134fe8d39b5fceb3adccba` |
| Stop after genuine partial text | 14/14 | `ev_8844e64152261573594a480de57ffd40e785d1e6ebfbe7fe3496d523d4fa942d` |

Formatting retained an H2, two bold bullets, two table data rows and inline code;
source identity came from the exact full-read receipt. Stop recorded local
cancellation after 2 ms with provider outcome unknown; it proves no zero-cost or
upstream-computation guarantee. No delivery/invitation action was included.
Independent saved-DOM/report review and private paths/hashes are in
[the AI browser record](../ai-chat-browser-check.md). Separate offline gates passed
261 API/217 web tests plus build/strict types.

The subsequent full attempt `20261028T174514Z` remains **failed**: fifteen cases
passed; side AI failed `unsent-question-retained`, with 22 completed/one failed/
nineteen cancelled of 42 steps. Evidence is
`ev_ffb660883287ee0cad0dc9034e9bf568ef6906bf61e896862b02466ab85fb2bc`.
The entire run recorded 407 steps: 387 completed, one failed, nineteen cancelled.
All eight persisted assertions passed, no page errors/source drift were retained,
and owned browsers terminated. The side capture has incomplete/equality-false
coverage, missing accessibility/action/DOM/screenshot/URL. Readiness accepted an
enabled input while New was still creating a session; its newly entered prompt
was then empty before History restore. This requires an owner regression/fix and
new capture, not a different History-row selector. The New/focus fixes and later 407-step pass are recorded above; this failed
attempt retains its original outcome.

## Earlier complete frozen contact checkpoint — 2026-10-28 UTC

Run `20261028T065257Z` passed **16 cases and 380/380 steps**. All eight persisted
assertions passed, including the new saved contact-navigation draft. No cases
were skipped, no actions failed and no page errors were captured. All 16
REA-owned browsers reported `terminated-owned-process`.

The target is the isolated synthetic demo on ports 3002/5174, REA 6.8.0,
Chromium 156.0.8078.48, en-US, America/Los_Angeles, light theme and reduced motion;
viewports remain case-specific. The full-run and all 16 per-case manifests have
the same 74 source/configuration/scenario/fixture entries, with zero drift.
These identities describe the frozen run; subsequent AI implementation is outside
this validation until rerun.

| Identity | SHA-256 |
| --- | --- |
| `web/src/App.tsx` | `43246ef97d71e3bccc3d445bf11b85ddc7fc65e30a6df3042264cad21c5d3975` |
| Full `sources.json` evidence file | `2ae52a3c059d5eed1ec71dfae861f081e5204ff6204bcef48d9bd0caf3179398` |
| `report.json` evidence file | `b5d07566ea599def33379fa7491abd24cf2d482a23c2b527623234cd367763c5` |

Private artifacts remain under
`evidence/private/replica-e2e/20261028T065257Z/`.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_ed7a2c3db5d362941b90da4dbcf30f2816f0822db5571871344c7e29d730d1c8` |
| `search-jordan` | 8/8 | `ev_798a21de75e8606fdea687bf951894b742449f05690141e1467acd58e02a0b56` |
| `command-keyboard` | 16/16 | `ev_55ca1cb9a3bac3b9a93b404b94cf8e3e67c98407690cd9b824b2a5272609264f` |
| `archive-undo-native-button` | 12/12 | `ev_d59ac0b06525e1ff9c8a1840ce4d0ec11d5203c695d2867d9d16bc839cbdef22` |
| `narrow-viewport` | 3/3 | `ev_45ddc5fb71551a4656d843bb18e86f07c4cba66cca314735d43ead4cddb25950` |
| `attachment-draft` | 8/8 | `ev_dd8b4d61aa3908b28eed7b9bfb8fc926480d796307eabce586bd740600cfc958` |
| `reply-all` | 8/8 | `ev_89dc9a64d95173d381c619b0501e9a6f0ef71612f5bafd262a286aeba15dfefe` |
| `reminder-undo` | 11/11 | `ev_b36307652d93603889807bb4c79ca0c3afcd650b8e4c403affaff7e5033f9883` |
| `label-picker` | 6/6 | `ev_fd350b907f3be5d369032d65d30238f82d37b8e52ad2f335af6d7c5fc039928b` |
| `rich-compose` | 45/45 | `ev_619db200eb681fcdcbff55ca167392d520128e6258aecb6829e436d4362f648c` |
| `inline-ai-unconfigured` | 18/18 | `ev_d9a7f3f269924c493865612e7680e664741883249a66eb6328b81d637ea365be` |
| `side-ai-unconfigured` | 15/15 | `ev_c1826bd6af77c7861ad530b7fecdaea4be8599277f4fd8746d8ac5c2aa6a0b13` |
| `calendar-week` | 24/24 | `ev_7034b0bd90b526a6d25ae64d05bec33666a2ab321daa90e9694d9ba52197aaf0` |
| `calendar-create-edit-delete` | 34/34 | `ev_e865ae0bc5fbc08b777949b25c7ac91421a21b6762b92e1eff86fb35eaaac95a` |
| `recipient-editing` | 66/66 | `ev_a59c966fda3be865c04ff24be1a1ed0601a34ea6cd90cbb0f220271ca2f48557` |
| `contact-context` | 80/80 | `ev_89a73bc19401b200243fd2e81163bbb99a678a5159f1a16e34be8507d601a670` |

Fifteen cases, including contact context, report complete requested sections and
`equality_eligible=true`. Reply-all alone retains missing event coverage and
`equality_eligible=false`; its exact replyAll POST/201 assertions passed. These
flags describe capture completeness, not proof of original/replica equality.
The contact case checks bounded local intents, draft/editor Undo preservation,
recent mail, thread search return, exclusion and exact draft reopening. Broader
contact enrichment/address-book/ranking and complete visual parity remain open.

A preceding focused contact run `20261028T065146Z`,
`ev_7000515880a9edfeae9b9ad93d9ee9e0e822ae175f8327e395acc860d1cc2313`,
also passed 80/80 and its persisted assertion at the same App hash. Its overall
capture remains incomplete/equality-ineligible only for missing DOM at
`scenario_start`; every action DOM/accessibility section was captured. It is
preserved separately from the subsequent complete contact capture. The three
earlier failed contact runs below retain their original outcomes.

Separate offline gates passed **209/209 API tests and 175/175 web tests**, plus
the production build and strict type checks. These use isolated local fixtures,
provider mocks and controlled React promises; they add no live provider or
original-product coverage. Existing bounded Gmail/Calendar/Claude live results
remain separate. No broad feature family is fully verified.

## Earlier frozen recipient checkpoint — 2026-10-28 UTC

Run `20261028T051129Z` passed **15 cases and 300/300 steps**. All seven declared
persisted-state assertions passed, adding exact recipient headers and the
recipient-case body to the five earlier draft/undo/AI assertions. No cases were
skipped; no failed actions or page errors were captured. All 15 REA-owned browsers
reported `terminated-owned-process`.

This is the isolated demo on ports 3002/5174, using REA 6.8.0 and Chromium
156.0.8078.48, en-US, America/Los_Angeles, light theme and reduced motion.
Viewports remain case-specific. The full run and all 15 per-case before/after
manifests match the same 68 source/configuration/scenario/fixture entries with
zero drift. At that earlier checkpoint the checked-in App source matched the recorded hash.

| Identity | SHA-256 |
| --- | --- |
| `web/src/App.tsx` | `adbb84d99b6b11c2f3dd7543bf3d7e8006018623735d6291ad339ca08bb1d96d` |
| Full `sources.json` evidence file | `6db9000cc722c4bcff51e18a9be334563f08fc32d6c7e5a9d73792abc1f2c062` |
| `report.json` evidence file | `4d20e8d52168029a61ccc21b7bfac33f7291f07d21bfefaee5a67708b72d0370` |

Private artifacts remain under
`evidence/private/replica-e2e/20261028T051129Z/`.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_9d642195e41b2ededa9c446d527ceb84d5b8b1a5767bee1ba56e4bd91986d83d` |
| `search-jordan` | 8/8 | `ev_cd6b70fe10d958360817baa739ec426c8762c830669796267677342ec38284ec` |
| `command-keyboard` | 16/16 | `ev_71f9e46c28be126ad5491c8b48da62bdbea8d60b5cc6722ad5057d8bea74c1c2` |
| `archive-undo-native-button` | 12/12 | `ev_b1432bafb550949999d51ff72943a4f42f822ceae526bc61180e7b1c6acdf3a4` |
| `narrow-viewport` | 3/3 | `ev_deb8bbddf8f6d816457038659f972159b6b5e4ea894919881af8846165c8d01d` |
| `attachment-draft` | 8/8 | `ev_ee3257099586d82c0f706a1ec025af803d5e7cdbd2a25d2c02ef42adb4de4e55` |
| `reply-all` | 8/8 | `ev_a3e1cedde6b43d94b54de2002dab83b62b16c0b685b6066b0967868d594e013d` |
| `reminder-undo` | 11/11 | `ev_3d1137c4f18c4e47bf2158ff34a13ab4884cb641b5187b5356354a7472035a0c` |
| `label-picker` | 6/6 | `ev_f60cbc0289fd11e026b68eb6d68fe622abb248a8bc275b8d731b44ceb1e4c6e5` |
| `rich-compose` | 45/45 | `ev_da6a65be4a6dd91a10e1a32c87cede231f4dbd789d940235673cdbcc9c9b2216` |
| `inline-ai-unconfigured` | 18/18 | `ev_253e0224d86151e295f68497329dd43ad4f43dff0a9c62fa55a4e974b71fd04a` |
| `side-ai-unconfigured` | 15/15 | `ev_0ad8ebc467dc5fe90c7c531a076e6879f11525246b92202ab3025a3331b18a83` |
| `calendar-week` | 24/24 | `ev_d8b7140f1edb05970e85ab1835fc8fa80482ca3708bad53c003c7953ec707e97` |
| `calendar-create-edit-delete` | 34/34 | `ev_94d0c7af8dbddc3667e0f65535ec5a3145c8ee014b7c3d54cf93eb1d4ab972b1` |
| `recipient-editing` | 66/66 | `ev_6ad98e9504d41001662496c42e5977d7e156a4d9207bf64617b118b294c551d8` |

Fourteen captures report complete requested sections. Reply-all retains missing
event coverage and `equality_eligible=false`; its exact replyAll POST/201
assertions passed. Other completeness flags describe the captured sections,
not original/replica equality. The recipient case verifies the declared synthetic
interaction and persisted headers/body. Its local-participant suggestions do
not establish external address-book access or ranking parity. Clipboard paste
has offline tests but was not exercised by this browser scenario. Bounded
original recipient observations, including shared field history, remain separate
in [recipients.md](../recipients.md).

At that checkpoint, separate offline gates passed **197/197 API tests and 142/142 web tests**, with
the frontend production build passing on the same App hash. These include local
persistence, provider mocks, outgoing-header validation, pure model/editor
invariants and controlled React asynchronous tests. They do not issue real sends,
prove live OAuth/provider outcomes or add steps to this browser run. The API
result is retained privately in `.local/final-api-tests.txt` at the repository
root; the web/build result was reported by its executor.

The AI cases in this full run still test missing configuration only; the separate
bounded [live Claude inline UI check](../ai-writing.md) has its own evidence and
capture limits. Calendar writes
remain synthetic in the injected fixture. Live Gmail and Calendar results have
their own records, and no broad feature family or full visual parity is marked
verified. All preceding failures and checkpoint limits below are preserved.

## Earlier frozen full run — 2026-10-28 UTC

Run `20261028T034153Z` passed all **14 cases and 234/234 steps**, with no skipped
cases, failed actions or captured page errors. All five declared persisted-state
assertions passed: edited draft, restored Jordan inbox membership, rich draft,
inline AI failure preservation and side-panel AI failure preservation. Every
REA-owned browser reported `terminated-owned-process`. The target was the isolated
demo on ports 3002/5174, using REA 6.8.0 and Chromium 156.0.8078.48 with en-US,
America/Los_Angeles, light theme and reduced motion; viewports remain case-specific.

The complete run and all 14 per-case before/after manifests contain the same
63 source/configuration/fixture entries, with no source drift. This is the exact
captured checkpoint, rather than an assertion about later source changes:

| Identity | SHA-256 |
| --- | --- |
| `web/src/App.tsx` | `7bee0fffd9955f656f7ca1541d8abf6a91d0b3b6fad813018ecf9aed55f72ba1` |
| Full `sources.json` evidence file | `faf229d80f8372c4c89fbfd5c4eb52eff63ae75ef3f1459f9d26abccab323c79` |
| `report.json` evidence file | `42368ac68dfc6ad72d23b5b756e4664a8a699cd0c5b21f771747a89b62347a46` |

All manifests, instantiated inputs, evidence and artifacts remain private under
`evidence/private/replica-e2e/20261028T034153Z/`.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_b3b12708584db25513def911529af072a77192dc0643b67619fd7f58be12f2a0` |
| `search-jordan` | 8/8 | `ev_adb4e538d768933109d4984ec9553f6ee9c6f75adefe45ef1ebaa6be16e352b3` |
| `command-keyboard` | 16/16 | `ev_7d41e2fa7b40c8a5b6f49f934076a62f99368facb273bdfea7f519c1394f70e9` |
| `archive-undo-native-button` | 12/12 | `ev_7250dd91efda2051f36920958c68699184eee8f50923fec493c762dd681e25ec` |
| `narrow-viewport` | 3/3 | `ev_ca54f7a8e9b05a8462dfa378e6a6524fe36d3c566057b49a2c4fd7aae3439b12` |
| `attachment-draft` | 8/8 | `ev_6e98e6eff962e3cd5cec5afed8a538f743885f0bcce1544c37edd161b8766141` |
| `reply-all` | 8/8 | `ev_b872783ea7a94e3027447cc0e0f7dd5d4cf73a05b4a1d30e78b41cd6de84fe6c` |
| `reminder-undo` | 11/11 | `ev_04b08317d1d2e8158d9626e8c9d9168a3fa6d16fe9db4a5201f5420275f42f7a` |
| `label-picker` | 6/6 | `ev_3e9b8c45d5cfc33832705feb8835a780a81c16d87c3de6e8717cf49da0c92070` |
| `rich-compose` | 45/45 | `ev_88849fdb8e303db3564cbc12286c1f24db7653096c1e3a1865985a4988ed6784` |
| `inline-ai-unconfigured` | 18/18 | `ev_21e70aeded5e95a6c8f5a26184be28d1083a994b1ca156c7868053e7d38c57e2` |
| `side-ai-unconfigured` | 15/15 | `ev_ff41a317095f9f4d97f5cd74999a79beaf5e48fe54b318c653526850f25f6b2e` |
| `calendar-week` | 24/24 | `ev_63066b82db151a29e421208cc82097e7b591564d56dce155a1284f0c34fdafae` |
| `calendar-create-edit-delete` | 34/34 | `ev_9fa2bbd8be63b5c404b292bd3c639f932dd6f12530d9d23f494bdbf37f4e2c3b` |

Thirteen captures report complete requested sections. Reply-all still reports
missing event coverage and `equality_eligible=false`, while its exact replyAll
POST and 201 response assertions passed. Completeness flags on the other cases
describe capture coverage; they do not establish equality with the original.
Rich editor history steps retain the screenshot boundary described in
[capture interference](../screenshot-undo-interference.md).

At that checkpoint, separate offline gates passed **176 API tests and 105 web tests**. They
cover local persistence, pure model/editor logic and synthetic/mock provider or
controlled React-component behavior, including asynchronous failure paths. The
API total includes the later controlled-harness safety cases. These counts are
not additional browser steps and are not proof of live provider behavior or that
every test ran during this frozen browser capture.

This run verifies declared demo interactions only. Both AI cases exercise missing
configuration, without live model output; Calendar mutations stay within the
injected in-memory fixture. OAuth, real sends/invitations, original-product
comparison and broad pixel parity are outside the run. The separately authorized
[live Calendar check](../calendar-live-check.md) and [Gmail checks](../gmail-live-check.md)
have their own private evidence and limits. Earlier failed captures and narrower
checkpoints below remain part of the record.

## Calendar and inline-editor checkpoint, 2026-10-27

Runs `20261028T030400Z` (11 mail/editor cases) and `20261028T030658Z` (two
Calendar fixture cases) both passed, totaling 219 steps. All declared persisted
state assertions passed, no page errors were captured and all owned browsers
reported cleanup. Complete production/fixture manifests remained stable in each
run. App SHA-256 was
`27200daaf401090e63a9ce485ab8752d942b07c65d0e36c57445fbb4e224f35c`.
This checkpoint passed 133 API tests and 101 web tests, plus strict types/build.
Later Claude, AI-panel lifecycle, delivery reconciliation and Calendar visual
refinements require their own checks; these captures do not silently cover them.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_6a928070f3d70235dd93fcaa2707f3f1595ea6fa0f6e3691dd3ac920e28b42dd` |
| `search-jordan` | 8/8 | `ev_eda72650224e4bb14a4a06807541a29ef40e8b832dbb4c5571e211677dd3a553` |
| `command-keyboard` | 16/16 | `ev_b648aa8b994399bb4b24d85d2163bbe51f50faad6d3e4d4a8383a5bd633703d8` |
| `archive-undo-native-button` | 12/12 | `ev_df3cb02e66d8895eeb24a771a5844fdcee8b8e0cda238501dd31d3300e378d20` |
| `narrow-viewport` | 3/3 | `ev_40680a735ac54e83e92951a7bfb8c63dc255cbea8e66d7caa3ea91aa0ad5dc1b` |
| `attachment-draft` | 8/8 | `ev_913c41d6377ba80892b61fc9221821ee80057daf37d2e72c2d9b3618d2207d19` |
| `reply-all` | 8/8 | `ev_ff3a16ce11b618f9989ce897ef55587cd41bf5753ec9e96cda7e0da825043c88` |
| `reminder-undo` | 11/11 | `ev_5d9e329be0d98054642948aa7efc1892d0fcc65a35252a218396a511aee1bdf6` |
| `label-picker` | 6/6 | `ev_af05fce686dea2161c23083f9d31f4f1fb68d293d4f2a28026111a0b7d831eb0` |
| `rich-compose` | 45/45 | `ev_71a2081811d0b211988b6d6ae25e6d6cfa46bba66e58161d59e0b6234f08548a` |
| `inline-ai-unconfigured` | 18/18 | `ev_b2d8e5fca893d66da835c78bf46c9a17e274625da4f50caf6c9495786a75a36d` |
| `calendar-week` | 24/24 | `ev_5ca3355dd22c2de199f5a89b33dcf331c13d4eef1a884c7f328a3f84cbc65985` |
| `calendar-create-edit-delete` | 34/34 | `ev_caee2d2eee20ba52f2d6c86a705c61bdb537ea71f016c8e2458c5e16e66c8cec` |

Reply-all retains incomplete unrelated event coverage (equality_eligible=false),
while its exact replyAll POST/201 was asserted. Calendar cases use only the injected
synthetic boundary described above. AI checks configuration failure, not live output.

The earlier unbounded Calendar run `20261028T025454Z` hit the host's 180-second
deadline before returning any REA result. No evidence ID or successful cleanup
is invented for it. Focused controls show screenshot/DOM capture succeeds
(`ev_67cf18f82e6afd2f94d99da155a08ed2c79be7a6140cf11909db3d03e1005e33`),
while exact checkbox name Public holidays fails within its explicit two-second
bound (`ev_ffb641ee82d14ff604c7c0ef0ef0a548a3e6b2311569d7ed7003a54560884bfd`).
The actual name Public holidays Read only succeeds and hides the tile
(`ev_7470ed54b749f240181d64b9d54b7649dd2802dbcc1a02f95215186bf228937a`).
REA's pinned Playwright adapter uses exact role names and no default action timeout;
the missing bound strongly explains the stall, whose precise stopping step remains
unknown. All checked-in click/fill/press/wait/goto actions now carry explicit
bounds, and the corrected Calendar fixture scenarios passed. The failed capture
and controls remain private with their limits.

## Latest paginated mailbox checkpoint, 2026-10-27 (America/Los_Angeles)

The full run `20261028T020552Z` completed all ten UI cases without page errors.
Its overall report remained **failed** because the exact persisted plain-body
assertion included a synthetic default signature. The corrected fixture explicitly
selects/clears the body before filling; focused rerun `20261028T021214Z` passed its
26 steps and exact API assertions. Across the full run and corrected case, all ten
workflows have supporting passes totaling 143 steps. No production change was
needed for this fixture correction. All owned Chrome processes terminated.

App.tsx SHA-256 remained
`871b1d926879c458f82417fa7db9396c3250e0fa76ce1d702d4f050728b12cb5`.
The API used a frozen private runtime snapshot of the 85-test mailbox checkpoint
while unrelated Calendar development proceeded. The demo database and provider
credentials were isolated from the live app. The web checkpoint passed 50 tests.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 26/26 | `ev_bcdac4ac3f71f33d7da1294df6a89e5ba4ba40f0e5f6b04d91288f92f57a086d` |
| `search-jordan` | 8/8 | `ev_011353e58b1a242f784a99999ddd8437e3924528e1f0a7c5f884caabdc5a6a20` |
| `command-keyboard` | 16/16 | `ev_b81bf40a03d3cb319b7c0f7011cb88ecffb62a56715b8d13a4107f2ed14c35cf` |
| `archive-undo-native-button` | 12/12 | `ev_be591fbb436c4cef1e87f01785599a42df96be737e190263cd96285780312cc7` |
| `narrow-viewport` | 3/3 | `ev_154e46a27de46497d21056bd8c150194024e68ca038bbccc521cd6134526a90d` |
| `attachment-draft` | 8/8 | `ev_2890c6a1e65a88606894fbfc5e6b851f9b6cc774a526122ee8390ba850483f38` |
| `reply-all` | 8/8 | `ev_56177add7fe2eaf35f87aa2c8c22dbc6c82b4a9b2678ce3024529ba89310db47` |
| `reminder-undo` | 11/11 | `ev_f837d17a287420dcf97911b8ae1f28a5d1323fe12c1c0282b2533d6a0726a87e` |
| `label-picker` | 6/6 | `ev_dc340cb80f448fe40668502ba2d5d26b027cfd8591415b1df7aca2ad43897c85` |
| `rich-compose` | 45/45 | `ev_557faeabdaabffd581875cfb8824034c8c0d3cfb4f6ca5873cd8705b3d749226` |

The initial full-run draft UI evidence is retained as
`ev_a370d64d59531e7a23e705eaf480e1d22f564547d3e370e258b2a307b656f499`;
it is superseded for the persisted-body assertion by the focused corrected case.
The reply case captured and asserted its specific replyAll POST/201, while
unrelated event capture remains incomplete (`equality_eligible=false`). Rich
history steps capture DOM/accessibility/URL only; screenshots follow redo because
caret-style screenshot mutations can invalidate editor history. See
[capture interference](../screenshot-undo-interference.md).

These are replica demo checks. They establish neither full original equivalence,
live Gmail delivery, broad visual equality nor complete feature coverage.

## Earlier complete nine-case regression

Run `20261028T005354Z` used the isolated demo on ports 3002/5174 after real
accounts were connected to the main app. All nine cases passed (96 steps), with
no page errors and all owned Chrome processes terminated. App.tsx SHA-256
remained `23af8f8bba69336b5d77ea16e9292ee574a8c151bdf5b50b94ef3ebb3ea56494`.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 24/24 | `ev_88da81a9b703a33cfc298a67a23350a4b5fcef24cd10de1ee672a357be8f4cbd` |
| `search-jordan` | 8/8 | `ev_c5a834d8609866cd0fce0397b1e9f0e0472c9a987e77ea666438d36aa69500c6` |
| `command-keyboard` | 16/16 | `ev_6112745151b6dfdb0c062517af1923ad174f4386f59671ae047b80cb0608fa77` |
| `archive-undo-native-button` | 12/12 | `ev_6c4e14e936fc9ec2435853ac7d4b0347be4855f0adeb8d8812a4ff48f0f4b81d` |
| `narrow-viewport` | 3/3 | `ev_05e5d16cab321083e949a8059037518ff05bcb3591ffbe2d33cf69faba891950` |
| `attachment-draft` | 8/8 | `ev_ed3dd7d6bf5b68229a728ddf3fdd8351b70a328f887d60a729c4dab6f86aea7b` |
| `reply-all` | 8/8 | `ev_717aee94c142e564d56dce9c52f08febe96eb8e285737939ad2eacaa777b5f8c` |
| `reminder-undo` | 11/11 | `ev_39447c00448725f161ef1982fa3a754a4b969a1bbab0b75060afed64c8a91a8e` |
| `label-picker` | 6/6 | `ev_966987a582eabf01d82552acade4a35470dd8217c075e922bc2de392a39f0363` |

The reply case captured and asserted its specific replyAll POST and 201 response,
while its event capture remains incomplete (`equality_eligible=false`). Other
cases captured all requested artifacts. These cases exercise demo interactions;
they do not verify original equivalence or live delivery.

A separate read-only observation of the connected app's incomplete sync notice
passed both declared checks: `ev_cb1899421fca63c31ee6aa7822c25258b3e7eec57f8b4ad1b6d577ca177ff55a`.
It captured URL and page errors only, with no mail DOM, screenshots or network
bodies, and made no mailbox changes. This establishes the replica's status
presentation for that incomplete import, not original sync-state parity.

## Earlier development regression, 2026-10-27

Run: `20261027T221829Z`. All 9 cases passed, totaling 96 recorded steps.
No captured page errors; all REA-owned Chrome processes terminated.
App.tsx SHA-256 remained `736c5abf930c76bf23c96bc30a27b2340906b5619f4a0a04080718304a7c0dd0` throughout.

| Case | Steps | REA evidence ID |
| --- | --- | --- |
| `draft-save-reopen` | 24/24 | `ev_174a43f5a2d01c314f678299b0c604e9b665086d3c7a0ff7f92b87fdf5557fc9` |
| `search-jordan` | 8/8 | `ev_c6fd8a5bf33e96f3a83c5ac0ca4efac83a492f17c141e77fe86dd7448cef763a` |
| `command-keyboard` | 16/16 | `ev_ddca8c5230a9eb69dba2c6e48fff2dac3a2dd3f5720a1b45092caaa5eec5f99d` |
| `archive-undo-native-button` | 12/12 | `ev_4f0cbd73cf9c35bd10e32f767493804441a8846c834425efe4b0c3093a221bb8` |
| `narrow-viewport` | 3/3 | `ev_5a745139403e9c552214734d2ac1be68ca1e813aa57b0ab681b0a07b83541442` |
| `attachment-draft` | 8/8 | `ev_54277a873ab34108fba28914359f363208ed6706fbbc44ec9ff918514e3ac690` |
| `reply-all` | 8/8 | `ev_8078372eb91560507e64ce2447bf62a1d9f0bb38bab22c5e647c8876ca78d671` |
| `reminder-undo` | 11/11 | `ev_8f126b9d8c6aaac7863ea4dc27fb5f1d9ac3b45c67cf379b71a5d21894a2d0b4` |
| `label-picker` | 6/6 | `ev_b79a94f361d4464aef7b67b4baf5e9e80b2cb9b99ac9489b708e7fa2650c7715` |

Exact screenshots and evidence remain in ignored `evidence/private/replica-e2e/20261027T221829Z/`.
The reply capture is incomplete for some unrelated network bodies, but the specific
reply POST body and 201 status were captured and asserted. Its equality_eligible=false
must not be read as a complete reference comparison. Other cases captured all requested artifacts.

This final rerun followed delivery-state/AI controls, attachment-size display,
and dynamic date grouping changes, plus the final reviewed backend restart. It does not exercise live Gmail, AI output, provider delivery, worker-crash
reconciliation, or original/replica pixel equality. Backend-only delivery and sync fixes
have separate automated regressions. None of the broad feature families is marked fully verified.

At that earlier checkpoint the backend suite passed 21 tests, including interrupted delivery, concurrent mailbox
actions, mixed provider folder membership, OAuth/sync recovery, and provider-consistent snooze wake.
These provider-boundary tests use stubs and do not establish live Gmail behavior.


## Recipient reconstruction checks in progress

The new recipient case is not yet a passing checkpoint. An initial input-only
attempt (`20261028T045106Z`) was rejected before browser execution because pinned
REA does not accept `role=group` locators; no Evidence ID was returned. The
scenario now uses the observed group/label CSS attributes.

`20261028T045125Z`,
`ev_d78ae843ca8375efcd22b64ad285a15d68932c2d9c9ff41cf1dc8a5919b93194`,
completed core chip commits, Backspace, selected existing-chip editing and invalid
literal Escape/removal. Its next input locator timed out: removing the chip had
selected a neighbor, so the scenario incorrectly assumed an append input existed.
The owned browser was terminated and source manifests were stable. The corrected
scenario clicks the To label before appending. Failed/cancelled actions and
missing capture sections remain in the private report; no full recipient pass is
claimed from that capture.


The next focused capture, `20261028T050910Z`,
`ev_234cefa76c769a3341742691e8cc9a9081f6178c3577befe0ba8fc4f499f818c`,
completed all 63 actions (64 captured steps), with complete requested artifacts,
no page errors, stable source manifests and owned-browser cleanup. All three
saved recipient headers exactly matched the planned strings. The aggregate run
still failed its body fixture assertion: the scenario had not cleared the demo
signature before using contenteditable fill, so `Alex` remained below the test
body. The new scenario explicitly selects/deletes the old signature before entry,
retains the exact body expectation, and reports header/body assertions separately.
This unsuccessful report remains preserved; it is not a passing full-run checkpoint.

## Contact-context focused failures, 2026-10-28

These two replica-only demo runs remain **failed**, independently of later fixes.
They do not replace the complete checkpoint above or establish original parity.
Private reports, manifests and step artifacts remain under
`evidence/private/replica-e2e/<run>/`.

| Run / evidence | Recorded outcome | Diagnosis |
| --- | --- | --- |
| `20261028T061452Z` / `ev_f28dba72a9406c987f2e649528130a967f1589364bacfc95ec07854ef060d9fe` | 15 completed, one failed (`backspace-final-a`, 10-second timeout), 62 cancelled of 78 recorded steps. | Real interaction mismatch: first empty-input Backspace removed B but selected A and hid the append input. The second combobox-targeted Backspace therefore could not execute. Original controlled evidence retained the input/focus and used previous-contact then author fallback; changing the locator to the selected region would have concealed the mismatch. |
| `20261028T062318Z` / `ev_7539e6e16e85f4c4d272c8c4019100c076858db478fdfbe9179dd245deecb460` | 73 completed, one failed (`reopen-owned-draft`, 10-second timeout), four cancelled of 78 recorded steps. Its persisted-draft assertion passed. | Real stale Drafts cache: the DOM displayed 36 pre-existing demo drafts and omitted the newly owned draft. The final persisted snapshot contained 37 drafts, including its exact subject, recipients and body. The substituted subject selector was correct; recent-thread navigation had saved the draft without updating the bootstrap draft list. |

Both runs had zero captured page errors, stable source manifests and
`terminated-owned-process` cleanup. Both report incomplete capture,
`equality_eligible=false`, missing accessibility/action/DOM/screenshot/URL
sections and no truncated sections. Their failures and cancelled actions are
not passing observations.

App SHA-256 was unchanged across both runs:
`a3f8c6f6eb8a77064bed2146632b7b895c346ae1dafa8eb6401945373cee9a78`.
RecipientFields SHA-256 changed from
`9082cd53967670281308447df47b81aa7e42e8fb74f087ac70f96a71f96de6fd`
in the first run to
`3c5b92c810a58c59243c4e4be6719400bbecdc29c722dbfef47136137676a40c`
in the second. The latter contains the append-Backspace correction; its offline
regression directly targets the input twice, checks focus and previous/author
intents, and preserves two undo/redo operations and distinct selected Delete
semantics. Thirty-four related offline recipient checks passed. That evidence
does not turn either failed browser run into a full pass. Stale-Drafts correction
and a subsequent frozen browser comparison remain a separate checkpoint.

### Third focused contact failure and async-search correction

Run `20261028T064120Z`,
`ev_488896026ae3dcc59e3eacfd8a85d4831108714d9af5aaf71d871489dc28e3b9`,
remains **failed**: 56 completed steps, one failed
(`recent-thread-navigation`, 10-second timeout), and 21 cancelled, totaling 78.
There were zero captured page errors, no source changes, and cleanup was
`terminated-owned-process`. App SHA-256 stayed
`d291c9af4cf55ee6eca1dd90ebd0c2b86e4dfe0ec76a63bea00c759bf61978de`.
Capture remained incomplete/equality-ineligible, with missing
accessibility/action/DOM/screenshot/URL sections and no truncated sections.

The preceding DOM showed the owned composer/contact/recent rows and Saving…;
the failed step's DOM showed Inbox without the composer/contact. The Mail-search
click had been followed immediately by Escape, without an observable search-state
wait. That timing supports a pending-save race, but the capture retained no
network events and does not independently prove its exact causal ordering.

A controlled actual-App test held the draft PATCH, clicked contact search,
pressed Escape, then released the save. It independently reproduced the draft
closing: search had not yet registered its return target, so Escape took the
ordinary close-draft route. The local correction registers search/return state
before awaiting save, preserving the mounted draft on immediate Escape. This
instantaneous pending-search behavior is a local design choice; only settled
search return was measured against the original. The scenario now explicitly
waits for real `.main[data-contact-search="draft"]` state after both name and
Mail clicks, rather than relying on an already-visible composer or a delay.
Its SHA-256 is
`0cb82a6a664683d78855be1fce574e7b414afc1f0c80a03021bc90cef19cf585`.

The same review found an independent cache issue: an acknowledged delete could
be rejected because the editor's timestamp preceded its latest autosave ACK,
allowing a delayed PATCH ACK to resurrect a cached row. Terminal deletion/send
acknowledgments now take precedence. Both independent controls failed old code
and passed corrected code; 16 focused App/cache checks passed. The full offline
web gate then passed 175 tests plus build/strict types at App
`43246ef97d71e3bccc3d445bf11b85ddc7fc65e30a6df3042264cad21c5d3975`.
These offline checks do not convert any failed browser capture into a pass;
the new frozen comparison is recorded separately when complete.


## Combined delivery, Knowledge and personalization regression — 2026-10-28 UTC

Run `20261028T213713Z` passed 16 cases/407 steps, all eight persisted assertions,
zero page errors and owned-browser cleanup. All 126 source/config/fixture/scenario
manifest entries stayed stable. App SHA-256 is
`f1d6878d618573f0a55cc069647b881060bc16acbb309c47fe3bfb494cefd040`.
Applied offline gates passed 444 API/385 web tests, build and strict types on
Node 24.22.1. The 223-file applied-source archive SHA-256 is
`750118422ce0ddccb41fa6d2c6a5ee75b03c860e178f3716e91aa5bbf9849f53`.
The root API test fixture portability correction and all earlier failed checks
remain separately recorded in the [combined checkpoint](../combined-checkpoint-20261028.md).
These are synthetic local checks; no provider was configured for this run.

| Case | Steps | REA evidence |
| --- | ---: | --- |
| draft-save-reopen | 26 | `ev_7e1f7c37208cb0302a43e38d54691164a4d7c3afcff74a1eac1a5bfa187c5734` |
| search-jordan | 8 | `ev_71a70e37e39f8163dafff6800761e45ae91a3906b8234851a68224ce2725f8c7` |
| command-keyboard | 16 | `ev_7aa78c0dffc268f4907a1aebd9dfddbd00a3f7318ebf71fad24d30359a475bd8` |
| archive-undo-native-button | 12 | `ev_b7824244bbfabf25d58e35910a9f3c2b5b14cd24aa2554a738561530f11eb26d` |
| narrow-viewport | 3 | `ev_2e453a10082a1a58c08ac0f46886950fe57d56c576c256b1fe7235681869da99` |
| attachment-draft | 8 | `ev_35757452d8c9eaa546a3c93d3b440c9bb3894d09fff27e997b68c2ec8b6ae357` |
| reply-all | 8 | `ev_af904b78dc580b5816ee4525014597035bc49ada7ba52c8aeac4f8844243ffb6` |
| reminder-undo | 11 | `ev_60b7f5f9e37c8614b4170e236dea41eba1d67d3545bd6936e55516ee52cccdff` |
| label-picker | 6 | `ev_c7d2fa4d182162a089508732b9afd76e044a32e54611846c130472eb6b032d17` |
| rich-compose | 45 | `ev_e52e6497f1b11b39c6ac4f960a7ec0af5b0e240485ec515cbc7a96b99060388b` |
| inline-ai-unconfigured | 18 | `ev_fbea297e99c67a5cd02b2bf00c04cad467dccc2adb07026cda6e52f50770017e` |
| side-ai-unconfigured | 42 | `ev_b013003d6151e75aabe14517124a3e05b77bf9e0ce689e4729973905a3fafb11` |
| calendar-week | 24 | `ev_5453b8688722200500a18d47ae172d93461ffd359fbed6a9ba03521fc7f3b7b8` |
| calendar-create-edit-delete | 34 | `ev_6e6adad133de96434a88d72df7ebe9c77828cf9ba6b3772771bed9a2e3fd4165` |
| recipient-editing | 66 | `ev_35e8dc39250107c864892bcca4106783fa084ddbecd7340e1b2aa8370fd67c23` |
| contact-context | 80 | `ev_f2f6b4f59bd456b785571b1aca928abc8717955f11d083851354a0601e151267` |

Reply-all retains missing event coverage/equality_eligible=false, with its exact
reply-all POST/201 assertion passing. Other complete captures do not independently
prove equality with the original. The separate 55-step Knowledge/personalization
workflow, actual file chooser proof, live Claude turn and 17-step answer/citation
restore retain their own source identities and coverage limits in the combined
checkpoint. No full feature-family parity is inferred.

## Focused receipt recovery and editor checks — API456/web398

The subsequent applied version passed 456 API/398 web tests, build and strict
types; the web count includes 96 actual-App tests. These focused checks do not
change the preceding 444/385 full 16-case/407-step regression's source identity.
App remains `f1d6878d618573f0a55cc069647b881060bc16acbb309c47fe3bfb494cefd040`.
The recovery API/web manifest SHA-256 values are
`ce3a38d5dbcd57836bcdab2d111e3d7fef891c4201e19d700cd212b27c5f8ae9` and
`cd715597830c026893a201e8e007c5d5db1500bb15b08106640af242b5d83f1f`.

| Focused check | Completed steps | REA evidence | Coverage |
| --- | ---: | --- | --- |
| Exact pending-key journal remount after terminal-controlled accepted upload/deletion | 9 | `ev_c1bd5e267a284bd16544e8c3801e144d227455b4375761b2984eab53070ca040` | Missing events; equality false |
| Protected source editor, initial Name focus and retained Updated/Owner layout | 7 | `ev_4523116ab474afbe7776f758eb1158a7751052c3f55ff384f7e29931fdb0cb11` | Complete/equality eligible; no pixel-equality claim |

Pinned REA 6.8.0 launched Chromium 156.0.8078.48; owned-process cleanup passed.
All 107 runtime source/configuration entries stayed unchanged. The first flow
used two raw API uploads and one guarded disposable DELETE, zero model POSTs,
no providers, and protected the original synthetic source/FTS/preferences/draft.
It proves receipt GET recovery with a seeded remount, not browser file selection
or an in-browser upload failure. The separate chooser proof keeps its own
provenance. The seven-step editor check observed no writes and preserved its
table hashes; it does not assert absence of requests.

Recovery attempt01 remains failed before upload intent: null-prototype SQLite
FTS rows and JSON-roundtripped objects falsely compared unequal. It made zero
POSTs/DELETEs and created no source/receipt. A retained helper successor corrected
only row representation and passed a JSON-roundtrip control before attempt02.
See [the recovery record](../knowledge-recovery-check-20261028.md) for exact
report hashes and original-versus-replica limits.

## Controlled normal-composer live lifecycle — API456/web398

One new owned rich draft and an API-attached synthetic text file completed the
following checks against the explicitly approved account pair. No existing user
draft was edited, and no model request was made by the lifecycle.

| Stage | Completed steps | REA evidence |
| --- | ---: | --- |
| Canonical draft/recipient/body/attachment guards | 21 | `ev_17d11ed857fce8fb4334863b57176e055935815e620467956fe96977e1753f65` |
| Send→keyboard Z Undo→same owned draft | 26 | `ev_02eab7f10b665f799dd66e0d305ac15a18976029c809d64a11834e8a01f9b5c0` |
| Future Schedule→Cancel before claim | 28 | `ev_011006a482313265eb12f9514c7748dbe8da3eaf261faed41b26565dce8d7bd2` |
| Fresh Send→one Instant Send | 18 | `ev_07cca184b95863f06cde85434da8a46d277b87e1ff6fb04a77223e76e96b8647` |

All 93 steps completed, with no captured page errors, 107 unchanged runtime
entries and owned-process cleanup. All four captures retain missing events and
equality false. The 18 baseline drafts, Calendar records and model counters
remained unchanged. Cancelled generations 0 and 1 had zero attempts; generation
2 had one sent attempt and one acceleration. A restricted read-only observer
found one matching sender/recipient imported pair after two polls. Local
canonical rich content and attachment bytes stayed exact; received attachment
metadata, not downloaded bytes, was checked. No due-time scheduled dispatch,
exact cancellation cutoff or latency is claimed.

The first baseline attempt remains failed before any creation or browser action
because its SQL assumed a physical subject column. A new helper added a real
in-memory-schema control. The next attempt's initial undispatched localhost GET
failed under restricted networking; it made no draft/attachment POST, and only
that undispatched stage resumed with loopback access. No Send or cancellation
was retried. The helper's nine offline controls do not replace runtime evidence.
Exact report hashes and comparison limits are in
[Undo observations](../undo-send.md#replica-normal-composer-undo-schedule-cancellation-and-instant-send).
