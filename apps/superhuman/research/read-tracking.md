# Read statuses, Recent Opens, and notifications (SH014)

Research only, 2026-10-28. The Settings entries, Notifications form, and an already populated Recent Opens pane were observed. Tracking delivery, receipt details, team sharing, browser permission, and notification delivery were not exercised. No feature is marked implemented or parity verified by this record.

## Identity and evidence

The retained original web build is `db8c4288f33febf25ad9`; main JavaScript SHA-256 is `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`, retained by `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`. The retained stylesheet SHA-256 is `487dc45e96a4d54d4069a9552f28f97883ba07f7962b83788e7b5d8d80e2e396`. Prior native identity is 1041.0.75; this investigation did not re-read the installed native version or recompare the current served JavaScript byte for byte.

REA CLI 6.8.0 and the installed `reverse-engineer-anything` skill version 49 were used. Original browser target `D671989E0783BD8ED03CAB22FC99F38F` reported Chromium 156.0.8078.48. Captures requested 1440×900 at device scale factor 1; saved PNGs are 2880×1800. The external browser's actual CSS viewport/DPR was not independently measured. Do not use those dimensions as a pixel parity measurement.

Private records reside under `evidence/private/read-tracking/`; vendor fragments, account identifiers, mail subjects, and screenshots remain private.

| Record | Evidence | Result |
| --- | --- | --- |
| Passive no-composer preflight | `ev_190e083d386f1008dd7371cb3bccc181ec83fbcb9c7b80b180acbb3376f5e1f5` | Existing Inbox inspected; no Subject/composer. |
| Settings entries | `ev_1a205c9c8620d6b592ff385e1b301221d77a975a7d7d017048c8f4f9e857675c` | All 4 actions completed. |
| Notifications form | `ev_7be1b5bd000ac14d5ba540f994e67fa626343363c6de049d6e52fa47405f524d` | All 6 actions completed; form only. |
| Inbox restoration and existing Recent Opens | `ev_fa8c05572b4b1d1c5f6a697b820a1232a9716e96ed7118cdf143f91c2d84d88c` | All 5 actions completed; Settings/Notifications hidden, no composer. |

All three action captures lack retained events, report `equality_eligible:false`, and disconnect from the externally owned browser. DOM/accessibility/screenshot observations support the stated UI facts; they do not prove that no network work occurred. No setting, notification checkbox, permission, tracking link, message, or feed row was activated, and no mail was composed or sent.

## Observed UI

Settings has direct **Read Statuses** and **Recent Opens** switches, both checked in this account. These are observed current values, not factory defaults. Opening Notifications shows a checked Email notifications box, explanatory Important • Other copy, per-calendar checkboxes, and a lead-time selector displaying **2 mins before events**. One owned calendar is checked and a holiday calendar is unchecked. The calendar identities are omitted here. Neither the selector nor any checkbox was changed.

After returning to Inbox, the right pane shows **Recent Opens**, two existing controlled test-mail entries, an address/contact line, a relative hour timestamp, and a subject line. No row was opened. This corroborates a populated feed, not the cause, completeness, or human authenticity of the underlying open events.

Useful scoped selectors from these captures are `.RightPane .Footer-settings-menu:visible`, its `.Footer-row:has(.Footer-label:text-is("Notifications"))`, `.NotificationSettings:visible`, `.ActivityFeedPane`, and `.ActivityFeedPane-content`. The settings rows contain `role="switch"` and `aria-checked`; clicking Read Statuses or Recent Opens changes settings immediately, so they are not safe read-only navigation selectors.

## Static declarations, not runtime proof

Twenty-six selected method/function excerpts, totaling 20,326 bytes, were inertly parsed from the retained main script. `static-fragment-identity.json` records original UTF-16 offsets, one-based lines/columns, original hashes, and independently authored parser shells. No vendor code was executed. REA parent `ev_1fcffed48596582a6b2e437100f244b06e6b81c329543307b06821bdd5849889`, summary `ev_993c35193208504d22d37e369c4f30eeccb93c902ced97ca03163fb0f71659c5`, analyzed all 26 files with zero parse failures. Its application graph remains partial, semantic coverage unknown, and 1,061 semantic unknowns remain. Complete-within-view summary coverage is not complete original-application coverage.

The first sandboxed analyzer attempt failed before source parsing while compiling its macOS process helper; partial record `ev_efa0b6c1ba7f40de283eb1155f08e3fa01e42c7020e13b4563ac531f7b109e7f` is retained. Read-only diagnostics followed, then the authorized host run completed. No configuration or engine installation was performed.

| Area | Declaration and original location | Consequence / limit |
| --- | --- | --- |
| Outgoing marker | `BodyContent.generateReadStatusPixel`, 394:31096 | Emits a per-message pixel placeholder unless `disableReadStatus`; the excerpt does not show server substitution or a final pixel URL. No per-draft control was observed. |
| Pixel isolation | `RendererStatic._getReadStatusUrls`, 736:1271; `isReadStatusPixel`, 412:67221 | Recognized URLs or small image dimensions identify candidates. Rendering substitutes a blank source and removes responsive-image attributes. Classification can be heuristic. |
| Controlled image loading | `MessagePaneController._hitReadStatusPixels`, 839:44768 | Requires an expanded message, visible thread pane, and remote-content blocking set to NONE. The Superhuman tracking host path can receive a viewer-email parameter. No request was fired or inspected in this investigation. |
| Receipt model | `MessageModel.getReads`, 368:42471 | Reads map by email to device/time entries; dedupe same email/device/minute, parse dates, associate recipient contacts, remove current-user entries, sort descending. Result fields are device, nullable email/contact, and readAt. This does not specify the remote receipt-ingestion API. |
| Checkmarks | `ReadStatus.render`, 804:35002 | Single/double checks and accessible unopened/opened labels. Self-addressed mail and a tracked reply/draft reply can produce an opened presentation without a newly observed pixel receipt. Reply-derived status must remain distinguishable from direct open evidence. |
| Detail | `ReadStatusDetail.render`, 804:32532; `ReadStatusRow.render`, 804:30728 | Hover detail contains count, device/contact, timestamps, optional shared-by/team upsell. Seven or more rows use a scrolling class; a separate count branch displays a plus suffix. Complete event retention and limits are unknown. |
| Account gates | `ToggleReadStatuses.run`, 784:285827; `ToggleActivityFeed.run`, 856:75181 | Read Statuses toggling also changes the feed-disabled setting. Enabling the feed while tracking is disabled can offer an enabling action. Settings and Cmd+K Recent Opens commands can mutate account settings. |
| Feed gate and navigation | `FooterSettingsMenu._maybeRenderRecentOpensToggle`, 898:13913; `ShowActivityFeed.run`, 588:304985 | Feature flag `recent_opens`, feed disabled when read statuses are disabled. A separate Show action changes only the visible right pane. |
| Feed storage/rendering | `ActivityFeed._doRefresh`, 696:4948; `ActivityFeedPane.render`, 990:18107 | Reads an account-local activity table with thread_id/message_id/email/updated_at and stored thread data; filters contacts/domains, groups by date, handles loading/empty/error. Row activation targets the recorded message/thread. Remote synchronization, retention, and pagination are unknown. |
| Notification form | `NotificationSettings`, 891:25415; `UpdateDisableNotifications.run`, 856:89855 | Reads both device and user disabled flags. User changes write device settings; enabling also clears the user disabled flag. Calendar lead-time declarations are 60/120/300 seconds, with 120 as the UI fallback. Current form values alone do not establish defaults. |
| Native/push boundary | `Account.authorizePushNotifications`, 758:9346; `ElectronChromeNotificationsApi`, 588:4554 | Declares registration/authentication and native Chrome notification create/update/clear/click callbacks. Actual permissions, background behavior, OS delivery, service selection, and priority classification were not verified. |

## Official documentation corroboration

The current [Read Statuses and Recent Opens documentation](https://help.superhuman.com/hc/en-us/articles/46005603745293-Read-Statuses-and-Recent-Opens-Feed) describes per-account tracking for mail sent through Superhuman, receipt details on checkmark hover, and a Business/Enterprise Recent Opens feed. It explicitly says open-event notifications are unavailable. This is documentation evidence, not a runtime entitlement or delivery test.

The [Email Notifications documentation](https://help.superhuman.com/hc/en-us/articles/46185909973517-Email-Notifications) distinguishes new-email notifications from read statuses: app, browser, and device settings matter, and Important • Other changes which incoming messages notify. No notification was requested or delivered here. Browser notification permissions are origin-scoped and ordinarily require a user gesture; persistent notifications use a service worker. See [MDN Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API). A checked application box alone cannot prove browser/OS permission.

## Proposed independent implementation boundary

This is a local design proposal, not a reconstruction of a discovered vendor API. Keep account-scoped preferences, immutable sent-message tracking registration, an opaque public image token, a bounded receipt event ledger, and a separate authenticated receipt/feed read API. A delivery attempt must bind the tracked payload once; Undo, retry ambiguity, provider drafts, and historical keys must not create unrelated tracking identities. Unsent drafts should not create open events. Treat image fetches as image-fetch evidence, with self/proxy/unknown-device distinctions and an explicit reply-derived state rather than claiming a person read the mail.

A tracking image needs a public reachable HTTPS ingress; localhost cannot receive ordinary remote recipient fetches. No vendor tracking credentials, vendor private endpoint, or extra Google scope was obtained or is implied by the static host name. A separately implemented ingress/event store can be hosted by this project; hosting URL, retention, token policy, and test recipient access remain deployment decisions. Push notification transport and browser/OS permission are separate from that ingress and from Gmail OAuth. Team-shared receipts require an actual account/team authorization model; do not substitute cosmetic team state. Open-event push alerts would exceed the documented current original behavior.

## Concrete candidate acceptance cases

These are future tests, not completed comparisons.

| ID | Test and required assertion |
| --- | --- |
| RT-01 | Open Settings without mutation; show server-backed per-account tracking/feed values and capability/plan state. Never infer a default from the captured checked account. |
| RT-02 | With an explicitly approved settings-change fixture, toggle tracking for account A only; account B remains unchanged and the dependent feed state follows the confirmed policy. Restore the original value. |
| RT-03 | Send one approved-pair tracked HTML fixture through the existing durable delivery flow; inspect exact MIME for one bound opaque image token. Cancelled sends and draft saves produce no false Sent/receipt claims. Requires a separately authorized send fixture. |
| RT-04 | Fetch that one controlled token; receipt/feed shows the exact account/message and remains isolated from another account. Unknown or foreign tokens disclose no mail metadata. Repeat fetches follow explicit dedupe rules. |
| RT-05 | Compare unopened, direct-open, self-open, reply-derived and unknown-recipient checkmarks/details with controlled original mail; verify accessible labels, time/device, count and ordering independently. No real recipient is opened merely to populate a test. |
| RT-06 | Feed loading, empty, error and populated states; controlled row opens its exact recorded message. Stale responses after account/mode/thread changes cannot replace newer contact/AI/Calendar views. |
| RT-07 | Blocked images and known-pixel blocking do not accidentally load a tracking candidate; expanded/visible/remote-content policy is explicit. Proxy/preload fetches never become guaranteed human-read claims. |
| RT-08 | Notifications form opens read-only with current email/calendar settings and 1/2/5-minute options. Any future settings-change test requires an owned/restorable settings fixture. |
| RT-09 | Separately verify permission default/denied/granted and browser/OS delivery with a synthetic incoming-email fixture. Important • Other behavior needs classifier evidence; do not synthesize notifications from an unverified “Important” label. |
| RT-10 | Team receipts/upsell, entitlement absence, disconnect, clock/timezone boundaries and large receipt histories fail honestly; no invite, purchase, or account-wide mutation occurs as a side effect. |

Remaining unknowns include final marker substitution, remote event transport/schema, device detection, IP/proxy filtering, event authenticity and retention, per-composer overrides, full account/plan matrix, receipt hover geometry, shared-read permissions, notification priority decisions, and native-versus-browser delivery. SH014 remains partially researched and unimplemented in this investigation.
