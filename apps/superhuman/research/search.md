# Local search grammar

A later [controlled date comparison](search-date-comparison-20261029.md) found
an original/replica mismatch for slash-form dates near midnight UTC. The
original's ISO-form date behaved differently from its slash form. The applied
UTC behavior below is unchanged; the timezone correction remains private work.

The browser's advertised `before:` and `after:` filters previously fell through
to literal body matching. On the seeded dataset, both `after:2026/06/01` and
`before:2027/01/01` returned zero results although all 13 threads fall in that
range. The local parser/matcher now evaluates those filters and composes them
with the existing search operators. No Gmail requests are needed to test it.

## Original evidence

- REA capture: `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`.
- Captured main script SHA-256:
  `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
- `tipsForProvider` declares date, sender, recipient, phrase, attachment, subject,
  folder/label and read/star filters at main script line 990, column 183367.
- The static parser recognizes date aliases `after`, `before`, `older`, `newer`
  and contact fields at line 438, column 5257. Its grouping logic near the
  `_parseMore` declaration supports conjunction, disjunction, grouping and
  negation. These are static observations, not executed reference queries.
- The original search surface was observed in `discovery-session.bundle.json`;
  exact query result membership, date boundaries and original time-zone behavior
  have not been compared against controlled fixtures.

## Implemented local behavior

- Free text and quoted phrases, including escaped quotes.
- `from:`, `to:`, `cc:`, `subject:`, `filename:`, `has:attachment`.
- `label:`/`l:` by account-scoped name, local ID or provider ID; `in:` can also
  resolve a label name. Provider Inbox/Sent memberships remain nonexclusive.
- `is:unread`, `read`, `starred`/`flagged`, `important`, `unimportant`, `muted`,
  `snoozed`; `from:me` and `to:me` use the selected account address.
- `before:`/`older:` and `after:`/`newer:` accept valid `YYYY/MM/DD`,
  `YYYY-MM-DD`, or nine/ten-digit Unix seconds.
- Adjacent terms and `AND` form conjunctions; `OR` forms alternatives.
  Parentheses group expressions; braces use implicit alternatives.
  `-`, `!`, and `NOT` negate terms/groups. Field-prefix groups such as
  `from:(alice OR bob)` are supported.
- Unknown operators retain literal-text matching. Unstored headers such as
  Bcc/Reply-To/Delivered-To are not silently presented as searchable metadata.

Date-only boundaries are currently **UTC**, `after` is inclusive, `before` is
exclusive, and dates match the thread's `lastMessageAt`. These are explicit local
implementation choices. The original may match individual message dates or
apply provider-specific time zones. These choices require original/replica
comparison before SH-006 can be marked verified. Invalid calendar dates match
no threads instead of overflowing into another month.

Search runs only over imported local data. It does not claim complete provider
search, fuzzy matching, remote suggestions, semantic retrieval, or highlighting.

## Validation

`api/test/search.test.ts` contains ten synthetic tests covering date boundaries,
quoted text, boolean grouping, account-scoped labels, attachments, CC, mixed
provider folders, literal fallback, and account isolation. All ten passed with
Node 24.22.1 on 2026-10-27. Run with:

```sh
node --experimental-strip-types --test apps/superhuman/api/test/search.test.ts
```

These tests establish local replica behavior. Original result equivalence,
original date/time-zone semantics, and whole-mailbox completeness remain open.
