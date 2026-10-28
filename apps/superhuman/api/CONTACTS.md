# Local recipient suggestions

This is a local reconstruction design, informed by the [recipient discovery
record](../research/recipients.md). It is not verified Superhuman ranking or a
complete address book. No contact service, network request, or OAuth scope is
added. Results use only participant metadata in already imported threads,
including message sender, To and Cc. The current message model has no Bcc field.
Saved draft recipients and provider address books are not indexed.

`GET /api/contacts/suggestions?accountId=ACCOUNT&q=PREFIX&limit=5` returns:

```json
{
  "contacts": [
    {
      "name": "REA, Two",
      "email": "rea-two@example.test",
      "formatted": "\"REA, Two\" <rea-two@example.test>"
    }
  ],
  "source": "local-message-participants",
  "limited": true
}
```

- Omitted account defaults to the active account. Unknown accounts return no
  contacts. Accounts never share occurrences, chosen names or matching terms.
- Limit defaults to 5 and accepts integers 1–5. Invalid values return 400
  `invalid_limit`. Query length is at most 200 UTF-16 code units before and after
  normalization; malformed Unicode/control characters return 400
  `invalid_query`. A blank trimmed query returns no contacts.
- Matching uses NFKC normalization, lowercase and whitespace normalization.
  Address prefixes, whole display-name prefixes and display-name word prefixes
  match. `%`, `_` and backslash have literal meaning, not SQL wildcard meaning.
  Validated ASCII DNS labels retain their literal text: numeric domains such as
  `12.34` and `12.0.0.34` are distinct. Unicode dot separators normalize to dots;
  only non-ASCII labels use IDNA conversion. URL-style IPv4 rewriting is avoided.
- Results deduplicate normalized bare addresses; no Gmail dot/plus alias merging
  occurs. Exact address matches rank before address prefixes, then name matches;
  ties use the most recent metadata occurrence and binary address order. A
  contact uses its most recent nonempty display name, with a binary name tie
  break. Invalid timestamps have deterministic zero recency. These are local
  choices; no original ranking equivalence is claimed.
- `name` is separate from the address. It falls back to the address if missing.
  `formatted` quotes and escapes a nonempty name, preserving commas and embedded
  quotes. Invalid bare addresses are skipped; unsafe control characters in a
  name discard the name. This index does not implement every RFC mailbox form,
  such as quoted local parts. Selecting a result never sends mail or bypasses
  sender/recipient approval checks.
- All imported folders contribute until a thread is removed or its participants
  change. Incomplete mailbox imports therefore produce incomplete suggestions.
  There is no frequency model, thread-context score, excluded-contact control,
  directory lookup or contact-editing endpoint. `limited:true` is always explicit.

## Persistence and bounded work

Normal `Store.put('thread',...)` writes the original record, summary and recipient
projection under a savepoint, including within action/undo transactions. A
failure rolls all those changes back together. Removal updates the contact
projection in the same SQLite statement. Startup migration projects existing
threads without rewriting their original JSON records.

Persisted triggers use only built-in SQLite JSON functions. They remove stale
occurrences and queue a body-free snapshot of sender/To/Cc/participant metadata.
This also supports older or direct-SQL writer connections without registered
JavaScript functions. Normal writes immediately consume their own snapshot.
Startup drains all pending snapshots; a nonempty suggestion request can consume
at most 64 pending snapshots from its own account. Out-of-band writes beyond
that bound can require subsequent requests before all new contacts are visible.
Stale occurrences are removed immediately, including when a thread moves
between accounts. No suggestion request loads thread records or message bodies.

Queries use indexed account/address and account/name-term prefix ranges, then a
primary-key contact lookup for each candidate. Only metadata matches are sorted;
response size is capped at five contacts. Very broad prefixes can still match
many contacts in a large account. Existing thin summary/bootstrap contracts are
unchanged. Participant metadata is private local data; it is never logged.

After a schema deployment, restart application processes together. Migration
`recipient-contacts-v3` retains the built-in-only triggers introduced by v2 and
rebuilds recipient metadata from unchanged original records to remove older
numeric-domain aliases. It also supersedes provisional function-dependent v1
triggers. All persisted v3 triggers can run on a plain SQLite connection. Restart
all application processes together so no older normalizer can reintroduce aliases.

## Outgoing recipient validation

Draft recipient strings may retain invalid tokens for later correction. A
JSON-quoted invalid fragment is draft persistence data, not a recovered mailbox.
Sending, scheduling, provider draft synchronization and delivery-attempt
preparation reject malformed fragments with 400 `invalid_recipients` before a
provider write. No invalid prefix can be ignored in favor of a trailing valid
address. This also applies when To is valid but Cc or Bcc contains invalid text.

The outgoing parser tracks quote escapes and angle brackets, accepts ordinary
bare addresses and canonical named mailboxes (including quoted commas, escaped
quotes/backslashes and literal angles inside a quoted name), and rejects
unbalanced/nested syntax, empty list fragments and control characters. MIME
headers are rebuilt from those same parsed mailboxes, with display names safely
quoted. Address casing is preserved; approved-recipient comparisons remain
case-insensitive. Import parsing is separate and unchanged.

The supported outgoing subset uses ASCII dot-atom local parts and dotted DNS
domains, with local parts at most 64 characters and addresses at most 254 bytes.
Unicode display names are retained; international local parts, quoted local
parts, domain literals, comments, groups and obsolete routes are unsupported and
fail explicitly. Each header is at most 65,536 UTF-16 code units and 200
mailboxes; display names are at most 512 code units. This is a bounded local
policy, not complete RFC or original-client grammar parity. Quoted-string,
quoted-pair and mailbox-list structure follow
[RFC 5322 sections 3.2–3.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.2).
Google documents sending MIME data in the message's base64URL `raw` field in its
[Gmail sending guide](https://developers.google.com/workspace/gmail/api/guides/sending).

`test/outgoing-recipients.test.ts` covers the former escaped-quote separator
bypass, valid comma/quote names, encoded invalid neighbors, controls, To/Cc/Bcc
approval checks, canonical MIME headers, delivery locks, and rejection before
provider requests or attempt records. These tests are entirely synthetic;
they make no live provider requests or deliveries.

## Local contact context and four recent conversations

`GET /api/contacts/context?accountId=ACCOUNT&email=ADDRESS&excludeThreadId=OPEN`
returns `{contact:{name,email},matched,threads,source,limited}`. `threads` contains
at most four existing `ThreadSummary` objects, sorted by conversation date then
ID descending. The source is always `local-message-participants`, and `limited`
is always true. There is no pagination or caller-controlled result limit.

The selected account defaults to the active account. Email lookup reuses the
participant index's normalization and account isolation; unknown contacts or
accounts yield `matched:false` with an empty list. A raw incomplete address such
as `rea-invalid@` is a successful fallback result, with that trimmed value in
`contact.name`/`contact.email`, rather than an enrichment error. No address is
extracted from a malformed display-name/header string. When a matched imported
contact has no usable name, `contact.name` is explicitly empty. Clients should
keep their immediate authored name when no authoritative imported name exists.
This API returns no biography, avatar, employer, aliases or external links.

Account IDs must be nonblank and at most 512 UTF-16 code units, email input at
most 320 units before/after NFKC, and an optional excluded thread ID nonblank
and at most 1,024 units. Control characters/malformed Unicode or repeated
account/email/exclude query arguments return 400 `invalid_contact_context`.
Empty/incomplete email input itself is permitted and returns an empty match.

The open thread is excluded by its exact ID. Draft-only threads are also
excluded; a received conversation with an unsent draft reply is retained. A
small `recipient_thread_flags` table projects this classification at write time:
when message provider labels exist, every message must explicitly contain
`DRAFT`; legacy records without that provenance fall back to `folder=drafts`.
Archive/undo cannot turn explicitly draft-only messages into recent received
mail. Other imported folders participate. These are local selection choices,
not a verified equivalent of the original's cache/provider search fallback.

The query begins at indexed account/email occurrences and performs exact-key
summary and flag lookups; only matching metadata is sorted. Requests parse at
most four summaries and at most 64 body-free pending participant snapshots, as
described above. They never select original `records.data` or load full messages.
Broadly shared contacts can require sorting many metadata rows; response size
remains fixed. Summary/bootstrap contracts remain unchanged.

Migration `recipient-thread-flags-v1` creates one derived table and three
built-in-only SQLite triggers, backfills atomically and leaves original record
JSON unchanged. It is idempotent and compatible with plain older SQLite writers;
updates/removals and outer transaction rollback also maintain the flags. The
focused `test/contact-context.test.ts` covers isolation, name fallback, current
thread exclusion, mixed draft provenance, stale metadata, undo/deletion, rollback,
legacy/concurrent writers, bounded HTTP input and the indexed query plan.

## Offline checks

`test/contacts.test.ts` covers account isolation, message-only recipients, quoted
commas/quotes, Unicode normalization and boundaries, limits, ranking, literal
query characters, updates/deletes, transactional rollback, legacy migration,
old connection compatibility, metadata-only request work and indexed query plans.
Its HTTP handler runs in memory without binding a socket. Runtime `createApp`
configuration rejects unknown option keys before opening SQLite, and Node test
workers must explicitly configure a database. Tests never rely on a production
database default; new HTTP checks set both `databasePath` and `DATABASE_PATH` to
`:memory:`.
An optional blank/whitespace environment `DATABASE_PATH` retains the ordinary
runtime default, while explicitly empty `options.databasePath` is rejected.
Tests still require a nonempty effective path; the default is never opened.

Run the optional synthetic 10,000-thread benchmark from the monorepo root:

```sh
node --experimental-strip-types apps/superhuman/api/test/contacts.benchmark.ts
```

It uses a fresh temporary database with two accounts and moderate synthetic
bodies, reports lookup/summary/read costs, then removes its database. It reads
no environment configuration or application state. Optional `--report PATH`
writes a new private report with mode 0600. Measurements are local observations,
not performance guarantees or original-product comparisons.
