# Team collaboration and CRM discovery

Bounded research for SH013/SH019, 2026-10-29. No Team, sharing, invitation, CRM connection/write, purchase, original UI action, model request or product implementation was performed for this packet. Both feature families remain candidates. See [21 acceptance cases](team-crm-acceptance.md) for controlled comparison work.

## Retained observation and static identity

The retained original web build is `db8c4288f33febf25ad9`, main JavaScript SHA256 `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`. Prior capture `ev_f6aeb966a644a72f5d16375612f7278b01a5ca757f1008ddd9b4da85a8cc6a23` completed four actions through opening Create Team. Its reviewed screenshot shows a name/email invitation picker, unchecked suggestions, Copy team join link, disabled Send Invite and a joining-seat billing notice. Nobody was selected or invited and no Team was created. The capture lacks events, is equality-ineligible and disconnected from an external browser; it does not prove current entitlement, server writes or every account's defaults.

Thirty-five selected declarations, 72,286 bytes, were extracted inertly from the same source and analyzed with pinned REA 6.8.0 / skill 49. Parent `ev_8a722c556c983c4bdd8da2e852ed1f231ab809c24b32dcd7065f1a64760d0c62`, summary `ev_b0061c06ed732578fa1e216c009a4d8ec71c7acc1f8f7ec9f022255faeee7816`; 3,937 semantic unknowns remain. The first sandboxed helper-compilation failure before source parsing is retained separately as `ev_b125ad42ccba72e125b10971ece906922e574f98d56c9e9689bacfdbcb07f72c`. No vendor code was executed or copied into implementation. Private fragments, original contacts and captures remain uncommitted.

## Declared surfaces, not runtime verification

| Area | Bounded source finding | Remaining question |
| --- | --- | --- |
| Team hub | Create/Join/Add/Manage entries vary with singleton, membership, billing, role and admin-console state. Manage checks `members.read`. | Current role/plan and available destinations were not re-observed. |
| Shared drafts | Separate author/private/read-only states, participant sheet, existing-draft save and attachment copy/upload paths; standalone unshare confirmation describes lost access. | Actual propagation, peer rendering, attachment permissions and send aftermath. |
| Shared conversations/comments | Container-scoped sharing and mentions, separate comment draft/post/delete/reaction paths and guest/link UI. | Guest authentication, link access/revocation, audience and notification effects. A sharing-record role does not itself confer draft editing. |
| CRM providers | Salesforce, HubSpot and Pipedrive have separate OAuth/provider identities, object-field metadata and offline/reauthentication states. | Actual provider connection, consent/scopes, tenant policy and current record access. |
| Salesforce | Contact creation, object updates, references/suggestions and field-error forms; API/object read-permission guidance. | Supported schema, required fields and provider write/concurrency behavior. Some error-dismiss handlers can sign out, so inspection must review handlers first. |
| HubSpot | Contact creation, Company/Deal associations, property updates, dependent picklists and separate Sequence enrollment. | Permission/schema/version behavior. Sequence enrollment can trigger external automation and is not a passive preview. |
| Pipedrive | Metadata/error paths; selected service's create-contact method is empty. | This does not prove all write paths absent. Public edit instructions conflict and require measurement. |
| Sales/analytics | Separate Team Activity and sales-demo candidates exist. | No pipeline/usage analytics surface, metric calculation, rollout or classifier quality was observed. |

Earlier [contact-pane research](contact-context.md) describes insight sections and contact selection. It explicitly does not verify CRM. Client endpoint strings and flags do not establish server authorization or successful traffic.

## Official guidance and access needs

[Shared Drafts](https://help.superhuman.com/hc/en-us/articles/46005578703885-Shared-Drafts) describes live viewing/comments with editing restricted to the original author; reply-draft sharing exposes the conversation. [Shared Conversations and Team Comments](https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments) separates Publisher, participant and guest. Guests can view/comment without Mail, cannot reply/forward, and mentions can email them. Removing an email recipient does not revoke sharing. The guide says individual removal is unavailable; Publisher controls stop/re-share. Runtime identity enforcement remains unknown.

The [Salesforce](https://help.superhuman.com/hc/en-us/articles/44999426280333-Salesforce), [HubSpot](https://help.superhuman.com/hc/en-us/articles/46005546891021-HubSpot) and [Pipedrive](https://help.superhuman.com/hc/en-us/articles/46005524701069-Pipedrive) Mail articles require Business/Enterprise plus provider login. Salesforce needs API access; HubSpot follows object permissions and has separately entitled Sequences. Pipedrive's general edit instructions conflict with its no-edit FAQ. Exact OAuth scopes/consent/admin requirements and the user's current eligibility remain unobserved. These are Mail integrations; instructions for Superhuman Docs Packs must not be substituted.

[Admin Console](https://help.superhuman.com/hc/en-us/articles/46185504799117-Admin-Console) guidance distinguishes Team roles and billed joining, and describes Enterprise admin usage analytics with phased rollout. Team Admin is separate from conversation Publisher/participant status; neither proves unrestricted access to another author's draft. Public documentation is not a current-account runtime comparison.

Full sharing comparison needs two authorized controlled identities and synthetic content, including an appropriate guest session if chosen. CRM comparison needs one selected provider's disposable workspace, role/schema/read permissions and separately scoped write permission. No new access, upgrade, invitation or credential handoff is requested by this research. Outlook remains excluded.

## Future implementation choices

Before implementation, publish typed account/tenant/role/ownership contracts and capabilities. Separate mail recipients, conversation audience, draft author, Team membership, guest identity and notification delivery. Opening a pane must not share, invite, enroll or activate billing. Preserve current rich/recipient editors and histories across all panes.

Explicit external actions need immutable scoped intent/receipt recovery and authoritative readback; unknown share, comment, contact-create or sequence acknowledgements cannot cause a fresh automatic mutation. CRM schema and provider concurrency, not cosmetic controls, govern writes. These are local design recommendations, not recovered vendor API contracts. Current plan, guest enforcement, shared attachment access, named/team receipts, CRM writes and analytics remain open. No feature is marked verified.
