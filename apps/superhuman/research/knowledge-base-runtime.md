# Private Knowledge Base: controlled runtime observation

Recorded 2026-10-28. This is a bounded original-product observation, not a
statement of implementation completeness or full parity. See
[the proposed contracts and acceptance cases](knowledge-settings-acceptance.md).

The account owner approved one upload of the public synthetic fixture
`research/fixtures/rea-private-knowledge-20261028-01.txt` to Private Knowledge,
followed by a retrieval question. The regular, non-symlink file contains 219
bytes; SHA-256 is
`9beaa325fa09d0b5e7a5c369ca96f7bbf1a2c222a46088c84c8708445191b63d`.
All facts in it are fictional. No existing source was edited or deleted, and no
team share was enabled.

## Target and evidence

The file chooser was operated in the installed `/Applications/Superhuman.app`,
version **1041.0.75**, after checking the selected personal Google account and
Private Knowledge destination. Exactly one native Open action submitted the
approved file. The first resulting row displayed the complete filename and
Syncing. This native observation is retained privately; it does not have a REA
browser evidence ID.

Subsequent comparisons used the authenticated original web client, Chromium
156.0.8078.48, build `db8c4288f33febf25ad9`, main script SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
All browser captures use pinned REA 6.8.0. Captures, native state, signed download
URLs and chat identifiers stay in ignored private storage.

| Observation | Evidence | Result |
| --- | --- | --- |
| Reload private source list | `ev_bd93b98711bbe7556afd3e91e096c57546d587ea4849db01fd1a8a007812a6e7` | Four steps completed. One owned row persisted with a title omitting `.txt`, separate TXT type, owner Me, timestamp and a generated description mentioning the fictional project. Syncing was absent. |
| Submit one source-only question from Inbox | `ev_44644552eac4cb4b0af8c0fb5d5b2c42c7b2d26ec8bc37fde9b863c57241629a` | Nine steps completed. The question identified the file/reference and asked for its day/time, sample count and codename without supplying those answers. The settled answer contained all three correct facts and citation 1 beside each. |
| Restore exact owned chat and expand Sources | `ev_5d0fe6973cb4f504637e837efd66620e764f6d57db1bd6095da11853e0ffc2f8` | Eight steps completed. Sources showed one numbered Knowledge base source with the owned title. No second question was submitted. |
| Open owned source citation | `ev_fb1dfed8ff8dc554a60b3e5fa4190e49822a65c7b882e4b3129b50a90b688c2b` | Ten steps completed. The citation opened a Private Knowledge editor with Name, generated description, Updated, Owner, attachment Download, Share with team switch, Delete, and disabled unchanged Save. No field or switch was changed. |

These captures report missing event coverage and `equality_eligible:false`.
Completed actions and retained DOM/AX establish the displayed states. They do
not establish comprehensive network absence, all tool calls, backend storage or
the model's internal retrieval algorithm. The matching source row and citation
support retrieval of this fixture; they do not prove universal citation accuracy.

## Failed probes and limits

The first post-upload wait looked for a title including `.txt`; it timed out,
although its retained DOM already showed the persisted extensionless title.
The corrected title capture above passed. A later Sources probe reloaded Inbox
and lost the active conversation; its click was cancelled. A history wait used a
nonunique locator and failed after capturing the rows. The corrected flow
reopened only the exact owned chat. None of these failures caused a second
upload or question. They remain in the private evidence record.

The original source remained private and retained after inspection. Download
was not clicked. Rename, Save, Share, Delete, source reprocessing, deletion
effects on old citations, other formats, file boundaries, failures and link
crawling remain untested. The generated title/description is observed output;
the service or algorithm producing it is unknown. This fixture establishes
neither a processing-time guarantee nor full Knowledge Base parity.

## Separate replica implementation checks

The [combined checkpoint](combined-checkpoint-20261028.md) retains the replica's
earlier 444 API/385 web source, 55-step synthetic Knowledge/personalization
workflow, actual local chooser proof and one real Claude retrieval/navigation
check. These do not change the original observations above.

The subsequent [456 API/398 web recovery checkpoint](knowledge-recovery-check-20261028.md)
passed a nine-step seeded browser-remount check after terminal-controlled
acknowledgement loss and deletion of one disposable synthetic source. A separate
seven-step read-only editor check retained Name focus and equal Updated/Owner
columns. Original lost-acknowledgement/deleted-key behavior was not tested; this
is a local recovery policy, with no claim of in-browser upload loss or full
visual parity. The earlier failed fixture comparison remains failed.
