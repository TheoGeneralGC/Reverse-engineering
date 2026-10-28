# Runtime observations, 2026-10-27

These are original-app observations. Private capture bundles contain account data
and must remain ignored. No messages were sent, removed, archived, or labeled in
the original. Blank and recipient-free synthetic formatting drafts were created
for controlled probes, then their test content was cleared and the original
returned to Inbox. No pre-existing user draft was changed. The extended
list/quote probe needed a separate recorded cleanup after its final Escape check
timed out; see [rich-composer.md](rich-composer.md).

| Surface | Original evidence | Observation | Remaining limits |
| --- | --- | --- | --- |
| Inbox | `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`; screenshot `ev_560b850f09a6c5aacfe70a4a9fb027ec330bd1af24ec6e42f01285d7bd089271` | Authenticated mail list; 40px app rail; light theme; compact rows; right context panel; bottom shortcut strip | Capture is attach-limited; original data is not a synthetic test fixture |
| Command | `ev_ffd0b953da36d01b7e9ddf94ddf0fa6a10aae1e4f4ce5f0cc4ca895e529153a2` | Meta+K opens a dark centered command picker; action list includes Done, Remind, Star, Move, Label, Trash, Spam, Read/Unread | No original state-changing command was submitted |
| Search and compose | Captured in `discovery-session.bundle.json` | `/` opens a full main-pane search with grammar tips; C opens a new-message card; Escape returns to the list | Initial capture was blank composition only; later formatting probes are recorded separately; no original sending or attachment upload tested |
| Settings | `ev_673506aefe95ecf95f476f0e6293a763b21bf22bcf06fbe3fa73fa17d9f2f624` | Settings replace the right panel with sections for AI, splits, sales, learning, account, calendar, notifications, writing, workflow, and advanced options | Visibility does not establish entitlement or backend semantics; values left unchanged |
| Thread and pickers | `ev_390feaa6da630fa77a132b6c805bf5f969c2e01b0153b4997d8ace5b83fc6057` | Enter opens a message card; H opens a natural-language reminder picker; L opens a dark label picker; Escape closes pickers | No reminder or label was submitted; conditional reminders and contact enrichment remain unimplemented |
| Rich composer | [Exact evidence ledger](rich-composer.md) | Selection reveals a floating toolbar; Cmd+B applies bold; Cmd+K opens URL-only entry; Enter creates a link; undo removes it; lists, quote and six-color palette observed | Link undo/redo passed without intervening screenshots; screenshot instrumentation can invalidate history. Paste, rich signatures, link removal and comprehensive focus semantics remain incomplete |

| Calendar | [Calendar evidence ledger](calendar.md) | Week/sidebar, existing-event details, unsaved form, repeat/custom/meeting-link menus and three normalized date expressions observed | No event or invitation saved; runtime/provider recurrence, booking and full visual behavior remain open |
| Selection AI writing | [AI writing ledger](ai-writing.md) | Selected synthetic text opens inline commands; Shorten replaces it directly; Done/Retry appear; Escape keeps the replacement | Other commands, retry semantics, errors, voice and comprehensive quality remain unverified |

The first connected scenarios used REA's UTC default, which shifted some displayed
dates relative to the original screenshot. Subsequent replica scenarios explicitly
set America/Los_Angeles. Match timezone and data before claiming date or pixel
equivalence. Initial original captures are 1036×690 at device scale factor 1. Later Calendar
and AI observations include actual 500×963 and 1920×963 viewports, as recorded
in their specific ledgers; requested sizes do not override connected windows.

Static source identity and exact layout declarations are in
[source-inventory.md](source-inventory.md). Static declarations, screenshots, and
runtime transitions remain distinct evidence types.
