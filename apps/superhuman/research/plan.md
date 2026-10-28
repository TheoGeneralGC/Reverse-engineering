# Investigation and delivery plan

## Definition of completion

One-to-one parity is the target, measured against a recorded original version,
account entitlements, viewport sizes, themes, and scenarios. Do not assert it
from a visual demo or a successful login. Record inaccessible and server-private
behavior as unresolved until an observable acceptance criterion is agreed.
Backend internals and nondeterministic AI outputs cannot be recovered completely
from the client; implement and validate the observable contract.

## Stages

1. **Baseline and tooling:** pin REA, verify CLI/MCP, record app identity, establish
   private evidence storage and a separate authenticated inspection browser.
2. **Discovery:** inventory routes, screens, menus, settings, shortcuts, states,
   gestures, loading/errors, responsive layouts, and account/plan variants.
   Use REA on the installed ASAR for Electron boundaries and packaged modules;
   inspect the live web app for remotely loaded behavior. Static candidates
   require runtime corroboration.
3. **Specification:** write repeatable scenarios with starting mailbox fixtures,
   exact user actions, expected UI, resulting provider/backend state, screenshots,
   timing conditions, and evidence IDs. Inventory fonts, spacing, colors, icons,
   animations, focus behavior, and accessible semantics.
4. **Functional vertical slice:** provider OAuth, encrypted refresh-token storage,
   initial/incremental email sync, persistent messages/threads/drafts/labels,
   attachment handling, background jobs, and one complete inbox-to-compose flow.
   Establish idempotency and recovery from expired tokens, rate limits, and
   duplicate/out-of-order provider events.
5. **Expand by scenario:** implement all observed feature families. Real provider
   APIs own delivery and mailbox truth; our backend owns replica-specific state,
   schedules, collaboration, and preferences. Verify each integration with real
   authorized accounts and separately validate deterministic synthetic fixtures.
6. **Comparison:** run matched original/replica scenarios, inspect screenshot and
   DOM/accessibility differences, verify keyboard/focus and data-state transitions,
   measure relevant perceived latency, and test persistence across reload/restart.
7. **Delivery:** deploy after required external access exists, verify OAuth and
   webhook callbacks, account isolation, background jobs, backup/recovery, and the
   full acceptance matrix. Keep remaining gaps explicit.

Parity rows move through candidate → observed → specified → implemented → verified.
Every verified row links both an original observation and a replica check.

## User scope clarification — 2026-10-28

The user explicitly said Outlook does not matter because they never use it.
Outlook/Microsoft mailbox integration and its live verification are excluded
from the current rebuild scope. Continue Gmail parity, shared application
behavior and the other requested features. This exclusion is not an implemented
or verified Outlook capability.
