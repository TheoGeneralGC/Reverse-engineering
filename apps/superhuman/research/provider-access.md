# Provider access for real integration

The user can supply any necessary API keys and prioritizes fidelity. The user authorized test delivery between two specified accounts on 2026-10-27;
the exact participants are recorded privately in local configuration. Google Cloud
OAuth client credentials are installed privately and recognized by the restarted
API. Cloud callback/API/scope verification and both approved mailbox grants are
complete. The controlled two-way delivery check passed; see
[live result](gmail-live-check.md). Historical backfill remains in progress.
An authenticated original Superhuman session permits observation; it is not an
OAuth grant for the replica. Do not extract or reuse Superhuman's credentials.

## First integration: Gmail

The backend owner selected these local development values. Use the API's
provider-status response and `api/.env.example` as the implementation source of
truth if variable names later change.

| Value / action | Who supplies it | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | User's Google Cloud OAuth application | Identifies our web application |
| `GOOGLE_CLIENT_SECRET` | Same OAuth application | Server-side code exchange |
| `GOOGLE_REDIRECT_URI=http://127.0.0.1:3001/api/auth/google/callback` | Add this exact authorized redirect URI to the OAuth web client | Local callback; `localhost` and `127.0.0.1` are distinct registrations |
| Gmail API enabled and test user eligible for consent | User/project owner | Lets the selected mailbox authorize development access |
| `TOKEN_ENCRYPTION_KEY` | Generate locally; 32 random bytes encoded as 64 hex characters | Encrypt refresh tokens at rest; retain securely across restarts |
| `APPROVED_TEST_SENDERS` | User names authenticated sending accounts | Restricts delivery to explicitly approved sender accounts |
| `APPROVED_TEST_RECIPIENTS` | User names exact controlled addresses and authorizes test delivery | Comma-separated delivery allowlist; empty means delivery tests remain blocked |
| `WEB_ORIGIN=http://127.0.0.1:5173` | Local configuration | Frontend origin |
| `PORT=3001` | Local configuration | Loopback API listener |
| `DATABASE_PATH` | Optional local path | Default `.local/superhuman.sqlite`; do not commit mailbox storage |

Set values in an ignored local environment file or secret store; do not paste
secrets into research documents. Start the replica, follow its Google connect
flow and complete account consent/MFA. The server-side OAuth flow supports
offline access for background work. [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)

The initial mail scope is `https://www.googleapis.com/auth/gmail.modify`, which
supports reading, composing, sending and ordinary mailbox modifications. It
does not grant immediate permanent deletion bypassing trash. Calendar has separate approved grants described below; external contact
providers would require additional access if selected. [Gmail scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes)

For low-latency Gmail push sync, configure a Pub/Sub topic/subscription and grant
`gmail-api-push@system.gserviceaccount.com` publishing access to that topic.
The backend must store the returned watch expiration/history cursor and renew
watches; Google requires renewal at least every seven days and recommends daily.
Push or pull subscription transport is an implementation choice. Polling alone
does not verify push-sync parity. [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)

For testing, the selected account may need to be listed as a test user in the
OAuth audience configuration. Testing-mode authorizations with Gmail scopes
expire after seven days, including refresh tokens, so test reconnect handling
rather than treating that expiration as a sync bug. Public distribution and restricted scopes can
require verification; development access and launch readiness are separate
milestones. [Google OAuth audience](https://support.google.com/cloud/answer/15549945),
[restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

## Outlook: excluded by the user

The user excluded Outlook on 2026-10-28. The following integration notes are
retained as reference for a future scope change; Outlook setup and verification
are not current requirements.

Register a web application in Microsoft Entra, choose supported account types,
configure its actual backend redirect URI, and supply tenant/client information
plus a secret or certificate. Use delegated authorization for each selected
user; `offline_access` is needed for refresh-token access. Do not invent a
callback or environment variable that the backend has not implemented.
[Microsoft delegated OAuth](https://learn.microsoft.com/en-us/graph/auth-v2-user)

Candidate mail permissions are `Mail.ReadWrite` and `Mail.Send`; read/write does
not include send. Add calendar/contact permissions only for implemented
features. Tenant policy can require administrator consent. [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)

Background notifications need renewable Graph subscriptions and a receiving
backend endpoint; messages, contacts and events have different resources.
Shared/delegated mailbox notifications have additional permission constraints,
so verify that variant explicitly. [Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)

## Claude writing and summaries

The user supplied a Claude key, stored only in the ignored local environment.
`AI_PROVIDER=anthropic` and explicit `ANTHROPIC_MODEL=claude-opus-5-5` are configured. An unscoped key may additionally
need `ANTHROPIC_WORKSPACE_ID`. No provider/model is silently substituted. One synthetic two-sentence rewrite
returned HTTP 200 and preserved its requested facts; UI and broader AI behavior
remain unverified. The configure helper reads a local key file without
printing it. Optional OpenAI use requires explicit `AI_PROVIDER=openai`.
[Anthropic API overview](https://platform.claude.com/docs/en/api/overview)

## Google Calendar checkpoint

The user approved Calendar API and terms, four scoped permissions plus verified
email identity for both accounts, and one synthetic create/Meet/edit/cancel test.
Both grants are saved. The event and sole attendee outcome passed; see
[Calendar results](calendar-live-check.md). The completed fixture's Calendar ID
write allowlist is now empty. Read access remains available; broader provider
behavior and original write parity remain open.

## Typing predictions and autocorrect

The shipped typing code identifies a Typewise SDK dependency, and
[Typewise's own SDK page](https://www.typewise.app/typewise-ai-sdk) names
Superhuman as a customer. Reproducing that engine needs legitimate SDK/package,
model and license access; this has been requested. The existing Claude
configuration remains available for writing and retrieval. No alternate model is
silently treated as the same typing engine. See
[the typing evidence and limits](typing-autocomplete.md).

## Access that depends on observed features

| Feature | Concrete access needed | Verification boundary |
| --- | --- | --- |
| AI writing, summary, retrieval, voice matching | Chosen model provider credentials, model access/budget; local mailbox retrieval/indexing | Assess observed interaction and factual quality. Private Superhuman model output cannot be guaranteed identical |
| Dictation/transcription | Browser microphone permission and chosen speech service credentials if browser capability is insufficient | Permission, streaming/cancellation and resulting text tests |
| Team sharing/comments/shared drafts | Two authorized original accounts with relevant entitlement; two replica identities | Share/revoke and simultaneous editing must be exercised |
| Calendar/conferencing | Calendar scopes plus controlled organizer/attendee accounts; conferencing provider access if needed | Test meetings/invitations require explicit participant authorization |
| CRM or sales integrations | Only credentials for integrations actually observed and selected; controlled CRM test records | Do not assume a vendor from a logo, client string or network hostname alone |
| Tracking and reminders | Controlled sender/recipient, consent to open/link events, hosted callback if implemented | Opens and image loads are imperfect evidence; preserve observed limits |
| Production service | User-selected hosting, domain, database, worker/job runtime, attachment storage and HTTPS webhook ingress | Secrets, callback validation, recovery and real provider tests before deployment |

These are replica architecture requirements inferred from the requested
capabilities, not findings about Superhuman's private service providers. Choose
services only after the original workflow establishes what the integration must
do. Do not purchase subscriptions or grant new account-wide permissions without
the user's approval.
