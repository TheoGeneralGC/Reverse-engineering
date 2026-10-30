# Hosted import cooperation between committed units

The mail child can service reads between committed import groups. It yields one real event-loop turn after each successful user-label unit and each existing main/catchup thread checkpoint, then rechecks the original ingress authority. Atomic thread/attachment/contact/Split publication, provider order, account queue, command FIFO, leases and final prune remain unchanged. One giant thread, native call, prune or read query can still block; no hard latency bound follows.

## Source and controlled observations

The reviewed scheduler patch cbad0f6ff95edafcf715e1d0b8f7c08969e2fc12db2a6984847817a6024ff673 adds one runtime delta and a test on bd544db. Default scheduling is a real Node setImmediate turn, exposed only through the trusted timing test seam. Yield is refused while SQL remains in a transaction. No result/authority cache, retry, lease renewal, arbitrary read priority or cancellation-on-drain is added.

One actual local Actor/Control/native child comparison uses13 fictional labels and one five-message thread, with explicitly injected10ms per mail response and one short held response. Before the queued bootstrap reaches the child, committed label ACKs fall13→1; before its actual HTTP handler13→3. Total bootstrap time in that injected fixture is7248→1743ms. These are local scheduling measurements, not hosted latency, RTT, fresh-tab rendering or proof of the earlier live opening delay. One turn does not guarantee HTTP completion. The candidate uses112 more wire requests for fresh authority checks (4253 versus4141), a disclosed cost.

Final schema/counts/integrity/FK and fake read counts match:224 objects, one thread/five messages,13 labels, two contacts, ten Split people, five ingress sources/versions, no active lease/draft. Full arbitrary row/ciphertext equality was not measured. Earlier bootstrap may naturally observe a partial label prefix under existing import-in-progress semantics.

Actual owner revoke while paused terminates the child, issues no more mail requests and preserves uncertainty/no takeover; graceful close is not claimed there. A separate held-response drain lets the same admitted import finish while quiescing, then waits for its held read before close acknowledgement, observed normal child exit and durable quiescence. No earlier operation is cancelled or replayed to make shutdown pass.

## Checks and remaining limits

Author28 producer controls/strict and two independent Root purposes pass. The latter verifies already-imported checkpoint durability before a rejected turn, outer-transaction refusal without awaiting, and account-version replacement during a committed-label pause refusing later work. Three real memory Stores close with matching explicit database environments and zero native-provider/external calls. The original failed test-cleanup receipt remains retained; the owner is never revived for cleanup.

The final composed sync/hosting gate passes217 controls across31 files plus strict types, zero external attempts and39 owned loopback socket calls. The new test's supplied environment explicitly matches its memory Store; the frozen author test remains unchanged in its private record. No real account, scope, resource, API credential or access-policy change is part of this source change. A healthy deployed owner/browser check remains a separate release step. Initial import completeness, giant units, parent saturation, Original timing and full1:1 parity remain open.
