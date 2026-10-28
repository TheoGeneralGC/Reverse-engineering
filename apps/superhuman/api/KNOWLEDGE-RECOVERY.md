# Private Knowledge action recovery

This is a local reliability contract built on the frozen combined444 candidate.
It is not a recovered Superhuman server protocol. No original account, live
database, website source, mail provider or model is used by its tests.

An accepted file upload, link addition or explicit retry commits three related
records in the same source/blob/job transaction: the existing request key,
an immutable action receipt, and that key's receipt-ID binding. Neither later
source edits/processing/retries nor source deletion modifies the receipt. Receipt
or binding insertion failure rolls the whole source action back.

The original four-column `knowledge_requests` table remains compatible with older
writers. Startup only adds two tables inside the existing schema transaction;
it does not backfill accepted payloads or scan all old source metadata. Old keys
without either new record resolve as `legacy-reference`. They expose only the
existing key/fingerprint/source association: request, acceptance time and accepted
content version are null. Their stable ID is derived from that association.
This does not invent an original acceptance snapshot from later source metadata.
If only part of a new receipt/binding/key exists, or their identities disagree,
recovery fails closed with `knowledge_action_corrupt` instead of pretending it is
legacy history.

`GET /api/knowledge/source-actions/by-request/:key?accountId=...` now returns:

```ts
type KnowledgeActionResponse = {
  receipt: KnowledgeActionReceipt;
  source: KnowledgeSource | null;
  resolution: {
    availability: 'available' | 'deleted' | 'unavailable';
    sourceId: string | null;
    currentContentVersion: string | null;
  };
};
```

The browser-safe types are in `src/knowledge-types.ts`. Every receipt binds its
account, request key, source ID and fingerprint. New accepted receipts additionally
bind the normalized request descriptor, acceptance time and content version at
acceptance. Current available source metadata can legitimately have a later name,
revision or content version. It never replaces the historical descriptor.

The `knowledge-request-json-sha256-v1` fingerprint hashes UTF-8 `JSON.stringify`
with these exact field names and ordering, matching the earlier key ledger:

```js
{kind:'file', name, sha256}
{kind:'link', url} // canonical requested URL, fragment removed
{kind:'retry', id:sourceId, expectedRevision}
```

New file descriptors also record the exact byte count. A client must verify
account/key and its journal's fingerprint; for accepted receipts it must also
verify the descriptor. A legacy reference has no descriptor/time/version to
compare, so the fingerprint is the available historical payload binding.

Available resolution includes the same account-owned canonical source and its
current version. A canonical deletion tombstone yields `deleted` without parsing
old metadata. Missing, moved or invalid current metadata yields `unavailable`.
Both return null source and null resolution targets while retaining the verified
receipt. The caller can settle its matching accepted action without recreating or
opening a missing source. Unknown keys still return404; absence is not proof that
an ambiguous earlier request was never accepted. If the old ledger and all action
history are absent, this contract cannot fabricate confirmation.

File/link/retry POST acknowledgements return the same additive receipt/resolution
shape, with a current source. Replaying a valid old key while its source remains
available returns its existing identity. A different payload under that key is
`knowledge_request_conflict`409. A matching accepted key whose source is gone is
`knowledge_action_unavailable`409, requiring receipt GET rather than a new upload
or retry. That error is not a declaration of nonacceptance. A fresh user action
with a fresh key may add the same bytes after deletion; the old key still resolves
only its original source. GET never creates a source/job, starts ingestion,
refreshes a link or retries an action.

Save/Delete metadata routes are unchanged. A client must preserve journal compare
and swap semantics when another window replaces its pending action; confirmation
of an older key cannot clear or adopt a newer key.

This slice closes deleted-target recovery for a verifiable key, not the remaining
Knowledge feature gaps: original parser fidelity, document layout/OCR, domain
crawling/live URL refresh, model-generated descriptions and actual team sharing
still need separate implementation and comparison evidence.

The private candidate passed456/456 API tests and strict types: the444 combined
baseline plus eight owner and four independent recovery cases. An additional
memory-only control passed actual API receipts through the matching browser
parser for accepted/available, accepted/deleted, legacy/deleted and accepted with
invalid current metadata. The independent current-metadata RED is retained,
alongside its fix and the separate nonpublic-URL fixture correction. These are
offline local reliability checks; no new original-product comparison or live
provider/model/website call is claimed.
