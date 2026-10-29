# V3 async clock placement audit

Earlier reviewed private versions remain immutable ancestors. This successor addresses the
independently reproduced queued-clock class, across all asynchronous units. The
wire protocol/cursor and sibling canonical protocol remain unchanged.

| Site | Before/after and authority |
| --- | --- |
| HMAC fast precheck | Arrival `now()` remains an early signature-age refusal only. It is not captured for durable timestamps. Once exact HMAC is verified, the timestamp stays in that invocation's private AsyncLocalStorage context. This does not itself accept a nonce. |
| Generic transaction callback | Reads validated `now()` after the actual primary TX and schema/session checks have been acquired. That single stamp is passed to the unit. A signed request is rechecked against this fresh clock. Before returning and at the adapter's immediate pre-COMMIT fence, a new validated clock must not be earlier than the acquired stamp and signed age must still fit. No clamp or skew-window expansion. |
| Authentication | Uses acquired stamp for durable high watermark, nonce expiry cutoff and nonce used_at. Delayed signatures outside the window refuse401 before any nonce write. All three fields have one coherent unit timestamp instead of separate clocks around network awaits. |
| Registration save/replay | Fresh acquired stamp is fenced against durable watermark before current/history authority. New acceptedAt/createdAt/updatedAt/confirmedAt derive from this stamp, never request arrival. Existing exact-key receipts remain historical and unchanged. A real rollback between nonce acceptance and this unit refuses; the earlier nonce may legitimately remain accepted. |
| Private current/history/event read | Fresh acquired stamp checks signed age and durable high watermark before reading authority. It cannot publish through a rollback after nonce acceptance. Signed GET already consumes a nonce; the new read-unit watermark is an internal durability fence, not a receipt/event or schema migration. |
| Pixel | Only token digest is computed before awaiting TX. Stamp is captured after acquisition. Known active registration checks precede watermark/event/throttle mutation. Unknown or inactive tokens retain no event/watermark write. Older queued calls therefore use a fresh observation timestamp when serialized and cannot spuriously reject after a newer monotonic observation. |
| Event projection/cursor | No wall-clock sample; fixed sequence-through and confirmed binding/context proof use the consistent acquired database snapshot. |
| Health | No auth clock or durable mutation; marker readability only. |
| Schema operator | No event/auth timestamps and no runtime enrollment. |
| libSQL local deadline/fetch timeout | Independent real IO budget, not a source for durable fences, receipt times, nonce expiry, cursor or events.4s AbortSignal and4.5s pre-COMMIT deadline remain unchanged. The injectable HMAC clock does not control these IO timers. |

Five new owner controls are socket-free and use explicit native `:memory:` SQLite:
queued two-pixel order→two events; auth-age expiry before first acquisition→401
and zero nonce; age expiry after nonce but before save→401/no registration;
queued save times reflect acquired unit and later actual rollback blocks read;
rollback after awaited writes→full save-unit rollback before COMMIT. Existing18
controls and19 actual fixed-clock ancestor vectors are unchanged. Independent review reran seven unchanged outside controls and the two
large-page controls successfully against the reviewed V3. Publication packaging
keeps that evidence separate; it does not relabel private predecessor tests. No real remote clock behavior or
managed-host latency is claimed from these synthetic controls.
