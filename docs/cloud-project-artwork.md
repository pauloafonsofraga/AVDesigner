# Separate cloud project artwork

Implemented on `engine-prototype`. Migration and hosting changes are local only:
no remote migrations, deployment, credentials or production/staging configuration
were changed.

## Data and compatibility

The existing cloud chunk/CAS/version protocol remains the project transaction.
New cloud documents contain `cloudArtwork: {version: 1}` and immutable
`wirenexus-cloud-artwork:<sha256>` strings instead of embedded image data. The
shared image MIME detector and existing portable project serializer remain in use.
Connectors, cards, backgrounds, logos, device identities and cable data are not
rewritten. Local canvas/history/editor state remains embedded and independent.

Canonical artwork is stored as its original decoded bytes, never recompressed,
cropped or rendered. A noncanonical historical data URL is instead stored as exact
UTF-8 data-URL bytes; this preserves old revision-pool hashes and original MIME
spelling. Both representations are SHA-256 verified. The resolver traverses
detached snapshots and serialized revision snapshots as well as the artwork pool.

Cloud Open verifies the JSON chunks, authorizes all required assets, verifies
downloaded hashes/sizes/formats, then materializes a complete project before calling
the existing `.avd` loader. Missing/corrupt assets never produce a partially loaded
canvas. Local Save/Save As and revision export remain self-contained and offline.

Old embedded versions stay unchanged and readable. The next ordinary cloud save
creates a reference-based version; old versions remain recoverable, with their
original storage usage. Existing active embedded collaboration heads are not
migrated underneath users. Save a separate reference-based project to adopt the
new format for such a session.

## Private storage and atomicity

- Bucket: `wirenexus-project-artwork`, private, binary content only, 64 MiB maximum
  per object (also subject to the hosted project's global/standard upload limit).
- Deduplication key: workspace UUID plus verified byte hash. Deduplication is not
  cross-workspace, avoiding private asset-existence leaks.
- Storage path: server-generated `<workspace>/<hash>/<storage-lifetime-uuid>`.
  Unchanged assets reuse the same object. A garbage-collected hash receives a new
  lifetime path on re-upload, so a late old cleanup worker cannot delete it.
- Authenticated reservation/describe RPCs check the current account and database
  workspace membership. Editors reserve/upload; Viewers only read ready assets.
  No browser role or subscription metadata is trusted.
- Storage INSERT requires pending metadata, writer membership and exact binary
  size/MIME. Restrictive guards prevent unrelated permissive policies from
  allowing overwrite, delete, path spoofing or anonymous access to this bucket.
- `/api/project-artwork` reuses the existing verified Auth/rate guard and server
  credentials. It downloads the private upload, checks actual SHA-256/size/format,
  then reauthorizes and confirms that exact storage lifetime. Client-supplied paths
  or actors are rejected. Images are not proxied through application request bodies.
- Asset bytes are verified before JSON finalization. Transactional version triggers
  validate/pin every reference, including duplicate/recover/checkpoint versions.
  Missing, pending, foreign-workspace or deleting assets roll back the entire save.
  Existing cloud revision conflicts and incomplete-upload protections remain active.
- Quotas include unique artwork bytes, including pending/deleting reservations.
  Workspace locks serialize reservation/cleanup/plan changes. Existing plan usage
  function identity and all previous accounting terms are preserved.

## Cache, progress and interruptions

The account interface provides a bounded 128 MiB in-memory cache per workspace,
with checksum-verified data URLs and reverse lookup for unchanged artwork. Cache
hits still require fresh server authorization. Account/workspace changes clear
the scope and invalidate pending results; normal SDK token refresh does not
permanently invalidate an active resolver. No persistent shared-account image
cache or temporary signed URL is stored in project JSON.

The existing cloud status UI reports checking/uploading/verifying artwork, asset
counts/bytes, manifest upload, and opening/cached progress. Transfers resume at
asset boundaries: a failed object upload may restart that object, but completed
objects and confirmed uploads are reused. Standard binary uploads are used, not
TUS byte-range resumption. JSON only commits once every asset is ready. Interrupted
or rejected saves leave recoverable private assets, not broken project versions.

Limits: 64 MiB per asset, 128 pending reservations per workspace, 2,048 distinct
references per validated document/command. Describe requests are client-batched.
Corrupt pending objects cannot overwrite immutable paths: they require lease
expiry and approved cleanup before replacement.

## Collaboration and retention

Reference-based collaboration heads and commands remain authoritative and unchanged
by display hydration. Both captured topology snapshots are canonicalized before
constructing the command, and the exact command is retained on uncertain retries.
Initial load and incremental display apply hydrate detached copies. Active gestures
and drafts defer late artwork application. Existing selective undo/redo and replay
validation are unchanged.

Version/checkpoint pins and conservative collaboration pins retain artwork from
heads and command before/after values, even after an object disappears. Removing
a device or manual revision does not delete assets needed by another version or
collaborator's undo history.

Cleanup is intentionally manual. With separately approved server credentials injected
securely into the operator environment, run:

```sh
node scripts/cleanup-cloud-artwork.mjs <workspace-uuid> <owner-or-admin-uuid>
```

Default mode is read-only preview. After reviewing the count and obtaining approval,
append `--apply`. It claims only unpinned assets whose 24-hour lease expired, removes
bytes through the Storage API, then finalizes the matching lifetime. A failed delete
remains quarantined for retry; metadata is never deleted first. No scheduled cleanup
or remote cleanup was configured or run. Retained history is deliberately not pruned.

## Pending rollout

1. Review migration history and preflight the destination. Stop if the reserved
   bucket already contains unrelated objects. Back up existing project/version data.
2. Apply `20261104091750_cloud_project_artwork.sql` only after explicit approval,
   after accounts/plans/organizations and both collaboration migrations. Historical
   migration files are unchanged. Run hosted database/RLS advisors afterward.
3. Verify Storage supplies `metadata.contentLength` during the authorization probe
   and measured `metadata.size` at completion. The client sends raw `Uint8Array`,
   not multipart `Blob`, so binary Content-Length matches the reservation. Missing
   size metadata fails closed. Check Storage global limits and verifier memory/time
   limits against the largest asset; test the actual hosted Storage version.
4. Deploy API and application together only after approval. Reuse existing server-only
   `WIRENEXUS_SUPABASE_URL` / `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`; no service key is
   included in the browser. The Cloud Run route adapter includes the new endpoint,
   but existing deployed services and IAM configuration were not changed.
5. Test real hosted uploads, RLS, quota concurrency, revocation, cleanup interleavings,
   recovery and two-user collaboration. Local PGlite/loopback tests are not proof of
   hosted Storage compatibility or WAN performance.

Rollback: stop new reference-based writes before reverting the application. Keep
the resolver-capable build available for already-saved reference versions; old
applications must not open unresolved manifests. Materialize/export them as local
`.avd` files if reverting fully. Do not drop the bucket, pins or migration history.

## Validation and benchmark

Focused tests cover exact-byte round trips, historical URLs, revisions, missing or
corrupt assets, account changes, retry/deduplication, RLS and quotas, generation-safe
cleanup, two-client artwork edits/duplication, lost acknowledgements, undo/redo and
server checkpoints. `scripts/cloud-artwork-browser-smoke.mjs` exercises the actual
Supabase SDK and Engine in Chrome with local Auth issuance, real SQL/RLS, verifier
and loopback binary HTTP transport, including observed Content-Length and progress.

Reproduce the size/performance measurement with:

```sh
node scripts/cloud-artwork-benchmark.mjs
```

The representative synthetic project uses tracked artwork in device definitions and
instances, card/node imagery, a reference image, logo and four connected cables.
No customer project data or source artwork is changed. One local run measured:

| Measurement | Result |
| --- | ---: |
| Self-contained project JSON | 46,361,036 bytes (44.21 MiB) |
| Cloud manifest | 10,565 bytes |
| Unique artwork (9 assets) | 19,744,970 bytes |
| Old embedded save upload | 61,854,704 bytes; 2,924 ms |
| First separated save upload | 19,763,332 bytes; 1,802 ms |
| Unchanged save upload | 17,261 bytes; 48 ms; zero artwork bytes |
| Cold open download | 19,763,676 bytes; 497 ms |
| Cached open download | 18,706 bytes; 38 ms |

The first save also requires 19,744,970 internal Storage-to-verifier download bytes.
Payload counts include instrumented RPC/asset metadata and binary transfers, but
exclude TLS/HTTP overhead. Timings include real local migration/RLS/RPC and verifier
work with an in-memory binary backend: they are not hosted network timings. Full
project equality, original image bytes and cable topology were asserted after open.
