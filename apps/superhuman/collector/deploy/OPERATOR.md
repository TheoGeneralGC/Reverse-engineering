# Operator plan — not executed

All creation, paid resource, secret, deploy and local-main configuration actions
below require the user's review of PROPOSAL.md first. The current packet has
created none. Never substitute the fixed synthetic keys in hosting.test.mjs.

1. Review the final file manifest and exact ancestor45 hashes. Publish only the
   five approved deployment additions under `apps/superhuman/collector`, through
   Root's normal reviewed Git workflow. Keep source origin/version and deploy
   commit SHA fixed. No repository-wide Docker context, `.env`, credential file,
   capture or database enters the image. Blueprint paths are repo-root relative.
2. After approval, select the intended Render workspace and actual quote; create
   only the proposed one web service+1GB disk in Oregon. Do not adopt an existing
   same-name service, change another account/resource, add domains or upgrade the
   workspace. If Render assigns a different onrender name, stop and review that
   actual stable origin; never silently derive/adopt it. Enter it explicitly as
   TRACKING_PUBLIC_ORIGIN. Wrapper compares RENDER_EXTERNAL_URL when present.
3. Only when needed, create dedicated signer/cursor/tenant material locally via
   an explicit operator action. Store it in private0700/0600 paths; never print
   values or put them into this packet. Enter secret values securely as the
   Blueprint's two sync:false environment values. Keep CONFIG_REVISION=initial;
   bootstrap validates and materializes files, never generates/replaces keys.
   Do not configure both file-secret and bootstrap-secret inputs.
4. Render builds the digest-pinned image. Capture built image ID/digest, exact
   commit/source SHA, Node24.22.1 and non-root effective UID/GID. No Docker build
   was performed locally in this packet. Check actual mount ownership and
   canonical/private data paths. No existing data is chmod/chown-adopted.
5. Confirm Render's actual public HTTPS origin/certificate and exact Host;
   `/healthz`204 is only liveness/readability. No custom domain is configured, so
   probes should use the onrender Host. Keep health path exact, no CORS/cookie/
   unsigned private endpoint or proxy rewriting to bypass HMAC/Host checks.
   Public malformed/unknown/inactive tokens retain the same fixed-image shape.
6. Run a separately journaled **synthetic collector-only** acceptance workflow:
   prepared→armed→owned synthetic image fetch→confirmed; exact-key receipt GET,
   current GET and events GET. Test wrong-key/refused request and replay without
   changing valid state. Never interpret an image fetch as Gmail ACK or a human
   read. There is no Send/native-provider action in this acceptance workflow.
7. Perform one owned restart retaining exact disk/origin/signers/cursor. Verify
   original accepted receipts, event history, cursor continuation and nonce replay
   refusal. Do not regenerate keys to make a failing restart look successful.
   A platform-specific failed deployment stays retained; no unknown POST replay.
8. Validate the operator shell/SSH channel under the actual Render account.
   Docker-based SSH may require additional platform/user setup; none is silently
   added here. Use Render's authenticated operator channel, not a public backup
   endpoint. Backup command (explicit operator action, canonical paths):

   `node --experimental-strip-types ops/storage.mjs --backup /var/data/collector /var/data/backups/UTC-ID initial`

   Parent `/var/data/backups` must exist privately0700 owned by UID/GID1000, and UTC-ID must be new.
   The explicit Linux CLI drops to the same service UID/GID1000 before writing; its default plan does not change identity. The helper opens only an exact v2 collector database read-only, uses native
   SQLite backup, validates the copy and pairs it with unchanged0600 signer/
   cursor files. It does not copy the live main file alone, rotate keys, prune
   events, schedule itself or upload anything. Same-disk copies are not offsite
   recovery. Transfer the whole private backup through the operator's authenticated
   channel into a new0700 local directory under `.local/tracking-backups/render/`;
   use the operator's approved encrypted storage/backup policy. No offsite account,
   storage purchase, new encryption key or transfer has been created here.
9. Restore-test the backup into a new empty isolated directory with the reviewed
   manifest digest:

   `node --experimental-strip-types ops/storage.mjs --restore-empty BACKUP NEW-EMPTY-DIRECTORY MANIFEST-SHA`

   The helper refuses existing targets, symlinks, altered file hashes, wrong schema
   and mismatched counts. It never starts a listener or overwrites current data.
   Verify receipts/cursors/nonce fences with the same source and keys. Actual
   disaster recovery needs a reviewed maintenance window: retain the old directory,
   stop the service, restore into an absent target and restart. No automatic
   rollback, deletion, disk-snapshot restore or key regeneration is provided.
10. For code rollback, choose a previously reviewed image/source deployment with
    the same v2 schema and stable credential/origin. Render disks retain state
    across code rollbacks. Recheck env/config against the intended deploy; do not
    allow a rollback to change tenant/signer/cursor identity. Record the deployment
    artifact and keep original failure evidence. Disk-backed deployments have
    downtime; no high-availability claim is made.
11. Main integration is a separate Root-owned action after hosted proof. Create
    the private version1 signer envelope, then review TRACKING_PUBLIC_ORIGIN and
    TRACKING_MAIN_SIGNER_FILE (+optional bounded timeout) for the local API.
    Do not alter existing Gmail/Calendar/model credentials. Preferences remain
    account-scoped/default disabled until explicit user choice. A hosted health
    check alone never turns effectiveReadStatuses/RecentOpens/hostingVerified true.
    Any first real tracked message needs a separate bounded approved-pair plan.

Operations to observe: disk usage/capacity, HTTP health/restart events, signed API
failures, cumulative throttling and actual invoice/traffic. Collector records are
not automatically pruned. No autoscaling or second SQLite writer is configured.
Actual host ingress quotas, edge logs and restore/SSH behavior remain measured
only after deployment; no platform behavior is invented from local tests.
