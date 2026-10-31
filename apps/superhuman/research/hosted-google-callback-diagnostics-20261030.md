# Hosted Google callback diagnostics

A hosted Calendar authorization reached Google consent but its callback returned
the existing generic500 response. A read-only audit found consumed state and no
Calendar grant/token persisted. The actual cause is still unknown. A fictional
full hosted callback passed, so that memory result is not a diagnosis of real
network or managed storage behavior.

This change reports only a fixed callback phase, a fixed exception class and an
optional finite SQLite/libsql code. It never logs exception messages, stacks,
causes, OAuth codes/state, tokens, URLs, headers, identity or request/response
bodies. The explicit instance observer is opt-in; absence is a no-op. The normal
worker supplies it through validated child-to-parent observations because raw
child stdout/stderr are intentionally discarded. Child and parent cap messages;
malformed observations are ignored, and logging cannot grant native work, resolve
requests, change leases or fail the Core. Public responses/checks and existing
transaction/rollback order stay unchanged.

The first diagnostic boundary passed43 affected Calendar/OAuth/thread controls
and strict types. A narrow successor removed its unintended standalone default
logger; five direct controls and strict types passed on that successor. Other
runtime/IPC paths stayed exact. The actual child control covers redaction,
32-message bounds, malformed observations, throwing logger containment, the
unchanged500 response, a healthy subsequent read and normal close/quiescence.
All inputs are fictional/isolated and external traffic is denied. Prior fixture,
sandbox and type-check failures remain preserved as separate evidence.

This adds observation only. It does not retry the consumed authorization code,
change scopes/identity checks, create an event, repair a journal or prove a live
Calendar connection. A new authorized flow and its actual result are a separate
acceptance step. No feature family is marked verified and full parity remains
open.
