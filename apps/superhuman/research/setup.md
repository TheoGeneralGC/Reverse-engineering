# Setup and access

Recorded 2026-10-27, America/Los_Angeles.

## Verified

- Local workspace was empty; cloned the empty public GitHub repository with
  origin `https://github.com/TheoGeneralGC/Reverse-engineering.git`.
- The stored TheoGeneralGC GitHub CLI account has repository write/admin access.
  The separately active theosteige account has read-only access. Do not change
  the global active account just for this project.
- `/Applications/Superhuman.app` is installed; its plist reports 1041.0.75.
- The installed app includes `Contents/Resources/app.asar` (35,831,302 bytes).
- A running authenticated Electron window exposes `mail.superhuman.com` content.
  It was open to an existing draft; inspection did not click, type, send, or delete.
- The shell Node is 26.3.0 and does not satisfy REA 6.8.0's engines. Codex already
  supplies Node 24.22.1, which the repository launcher can use without an upgrade.
- Official npm package `rea-agents@6.8.0` was selected from morluto/rea's documented
  distribution. Subsequent installation and analysis results are recorded in the
  finding ledger.

## Access needed for the next phase

1. Run `npm run inspect:superhuman` from the repository, then sign into Superhuman
   in the dedicated REA browser profile.
   Existing desktop authentication is separate from that browser profile.
   Keep the browser and this Mac available during capture. Complete MFA yourself.
2. Identify the provider account(s) to connect to the replica. Configure the
   project's OAuth application in Google Cloud and/or Microsoft Entra when we
   have selected callback URLs and the minimum required scopes. Add test users
   if the provider requires them. Store credentials locally, never in chat or Git.
3. For end-to-end sending, name test sender/recipient accounts and authorize
   sending test messages between them. Test archive, labels, snooze, and deletion
   on disposable fixtures so the original mailbox remains useful.
4. Hosting, database, background jobs, attachment storage, public webhook ingress,
   and a production domain will be selected with the implementation. Local work
   can begin before production services exist.
5. AI-assisted features may need a separate model provider key and retrieval
   index. Exact output equality with Superhuman's private models is unverified.
6. Team collaboration requires at least two authorized accounts and the original
   feature entitlement. An inaccessible paid feature remains an explicit gap.

Do not install Hopper/Ghidra for this Electron/browser workflow unless later
evidence establishes a specific native question that needs one.

## Installed tooling

- REA 6.8.0 installed locally; CLI startup and initial static analysis succeeded.
- Codex MCP registration and bundled workflow installation completed with setup
  status `ready`. The registration explicitly uses Codex's existing Node 24.22.1
  executable so it does not depend on the shell's unsupported Node 26.3.0.
- Configuration backups: `~/.codex/config.toml.rea.backup` (before setup) and
  `~/.codex/config.toml.rea.runtime.backup` (before binding the supported runtime).
- Restart Codex to make the new MCP tools available in a fresh session. The
  current conversation can already use the local CLI.
- Production stdio MCP startup check passed: 229/229 expected tools, 6/6 prompts,
  matching package/catalog identity, and a successful `binary_session` request.
  Final scoped Codex/skill diagnostics report `healthy: true` and `aligned`.
- Optional Frida installation scripts were not enabled. Frida is not needed
  for the selected static Electron and browser capture workflow.

## Provider setup references

These are prerequisites for implementation, not evidence of Superhuman internals.

- Google: [server OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server),
  [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
  and [Gmail push synchronization](https://developers.google.com/workspace/gmail/api/guides/push).
  Public distribution may need provider verification; development/test access
  can begin before a public launch review.
- Microsoft: [delegated authorization](https://learn.microsoft.com/en-us/graph/auth-v2-user),
  [permissions](https://learn.microsoft.com/en-us/graph/permissions-reference),
  and [Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview).
  Tenant policies can require administrator consent.
- Discovery candidates: [Superhuman workflows](https://help.superhuman.com/hc/en-us/sections/46130641632525-Core-Features-Workflows),
  [plans and feature availability](https://superhuman.com/plans), and
  [keyboard shortcut reference](https://download.superhuman.com/Superhuman_Keyboard_Shortcuts.pdf).
  Live observations determine which features are actually present in the baseline.
