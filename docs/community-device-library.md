# Community Device Library: Backend and Moderation

## Development Status

Phase 2 provides a backend API, an offline migration, account-bound signing,
private package/artwork storage and moderation. It does not add a Community
browser or moderation UI to the application. Existing `.wnx` import remains the
client-side installation path. No factory catalogue or personal library is
written by these APIs.

The HTTP endpoint is disabled unless `WIRENEXUS_COMMUNITY_ENABLED=true`.
This change does **not** deploy, apply remote migrations, configure secrets,
enable signup or change Google Cloud staging. Real hosted verification remains
an approval-gated prerequisite.

## Storage and Authorization

The migration is
`supabase/migrations/20261103181243_community_device_library.sql`, generated
with the repository's pinned Supabase CLI 2.122.0. Apply only after the existing
account/workspace and Plans/Entitlements migrations and the previously approved
migration chain. Historical migrations are unchanged.

Nine new `wirenexus_private.community_*` tables hold limits, per-account rate
windows, devices, immutable versions, content-addressed PNG artwork, version
artwork references, quarantined uploads/chunks and moderation events.

All tables have RLS enabled, with no direct table privileges for `anon`,
`authenticated` or the runtime service role. A service-only, search-path-pinned
RPC, `public.wirenexus_community(text,jsonb)`, performs explicit ownership and
moderation checks. Anonymous and authenticated clients cannot invoke it directly.
This follows the existing publishing/collaboration trusted-server boundary.

The API verifies Bearer credentials through the existing Supabase `getUser`
guard. It never forwards client actor IDs, roles, AAL claims, ownership flags or
prevalidated materializations. Platform Admin moderation additionally requires
the existing database `plan_admin` check: current role assignment, AAL2 from the
verified session, and an enrolled verified TOTP factor. Workspace Admin roles
and user-editable metadata do not grant moderation access.

Public reads are explicit approved-only projections, not raw rows or views.
Only the active approved version's metadata and sanitized preview are public.
Internal review reasons, package bytes, raw account data and unpublished artwork
are excluded. Public responses use `no-store`; unpublishing blocks subsequent
preview/download requests. Previously downloaded files cannot be recalled.

Packages use private PostgreSQL `bytea`, as existing account/cloud storage does,
rather than introducing a bucket or signed URL. Packages, artwork references,
version allocation and audit events commit in one database transaction. A future
object-storage adapter can preserve this contract; no bucket is created here.

## Submission and Attribution

1. An authenticated account reserves an upload; the server generates upload and
   Community device IDs. Updating a device requires ownership and its revision.
2. Fixed-size chunks are appended in order. Identical chunk retries are safe;
   changed retries, incomplete uploads and source SHA-256 mismatches reject.
3. On `submit`, the server reads quarantined bytes and runs the existing `.wnx`
   version, envelope/checksum, dependency, topology and artwork-field validation.
4. Artwork is processed sequentially by pinned `sharp@0.35.5`, bounded by pixels,
   bytes and processing time. Static PNG, JPEG, WebP, GIF and AVIF are accepted.
   Animated images and SVG are rejected for this initial public-sharing profile.
   Accepted artwork is losslessly PNG-normalized after orientation handling,
   stripping EXIF/other metadata. Public previews fit inside 640 x 480 pixels.
   Original local files and personal definitions are not changed.
5. Creator UUID, public name and first creation timestamp come from the reserved
   authenticated account record, never from uploaded authorship fields. Names
   cannot contain email addresses, markup or control characters. Missing names
   use `WireNexus contributor`. The root package receives an ES256 attestation
   over the complete dependency closure. Dependency claims are reset to the
   submitting account, without inventing independent verified signatures.
6. Server-generated metadata is restricted to plain title, brand, category,
   description, connector-type names and definition-level port/card counts.
   Markup, controls and email-shaped contact data are removed/redacted from this
   public projection. This is not a general confidential-information detector:
   authors and moderators must inspect authored text before sharing it.
7. A single transaction stores the validated package, version, sanitized artwork
   references and event. Every submission starts `pending`. Package/definition
   identities, connector locations, slots and relationships are retained inside
   the package. Import uses the existing collision-safe `.wnx` installation logic.

Verified creator means an authenticated account claimed the submitted content.
It is not proof of original authorship, licensing or electrical correctness.
Moderation is still required. Public identity is a display name, never an account
email. Account UUIDs appear in portable cryptographic attribution, not public
catalogue identity fields.

The v1 signature claims use fixed field ordering so PostgreSQL JSONB reordering
cannot invalidate them. Existing server-produced v1 signatures remain compatible.
Compression remains compression, not encryption.

## Limits and Atomicity

- Package input and normalized output: 8 MiB compressed, 32 MiB expanded.
- Chunks: 256 KiB; at most 128 artwork references and 129 stored image variants.
- Image: at most 4,194,304 pixels and 8,192 pixels per axis; 16,777,216 total
  decoded unique-input pixels, 16 MiB sanitized artwork, 5-second native operation
  timeouts and a 30-second artwork-loop budget.
- Default per account: two unfinished uploads, ten new reservations per hour,
  100 stored versions and 128 MiB of logical package-plus-artwork storage.
- The existing trusted-IP request throttle also applies. Clients must honor
  `Retry-After`; no arbitrary forwarded-IP header is trusted.
- Limits/rate windows are private. Operators can change database limits only
  through an approved administrative configuration change, not browser flags.

Reservations are counted against quotas. Account row locks serialize positive
resource mutations; configuration share locks serialize quota changes with
writers. Device revisions protect resubmission and moderation races. A failed
validation, quota check or stale write cannot replace any existing version.

Quarantine expires after 24 hours and is reclaimed on the owner's next upload
operation. `cancel` removes an unfinished upload and its chunks. An optional
future scheduled cleanup needs separate approval; no scheduler is created.
Completed upload receipts remain for idempotency. Rejected/unpublished versions
remain private history and count against quotas; retention/deletion policies
and account-erasure workflows are future work, not destructive cleanup here.

## API Contract

Endpoint: `/api/community-devices`. JSON requests/responses use the existing
server request-size bound. Bearer tokens belong only in the Authorization header,
never query parameters. No account/session values should be logged.

Public `GET` query actions:

| Action | Parameters | Result |
| --- | --- | --- |
| `list` (default) | `limit` 1..50, optional `after` device UUID, `search` <=100 chars | Active approved entries, ascending device UUID |
| `preview` | `deviceId` | Approved metadata and preview hash |
| `artwork` | `deviceId`, `hash` | Only that active version's preview, `image/png` |

Authenticated `POST` JSON actions:

| Action | Fields | Result |
| --- | --- | --- |
| `begin` | `byteCount`, `sha256`, optional owned `deviceId` + `expectedRevision` | Generated IDs, chunk size, expiry |
| `chunk` | `uploadId`, `index`, canonical base64 `data` | Received byte count |
| `submit` | `uploadId` | Pending version/receipt after server validation |
| `cancel` | `uploadId` | Removes unfinished quarantine |
| `mine` | Optional `limit`, `after` version UUID | Own version statuses and review reasons |
| `queue` | Optional `limit`, `after` version UUID | MFA Platform Admin pending queue |
| `review-artwork` | `versionId`, `hash` | Owner/MFA Admin preview of pending or historical versions |
| `approve`, `reject`, `unpublish` | `versionId`, `expectedRevision`, optional private `reason` | MFA Platform Admin, revision-checked transition |
| `download` | `versionId` | Authenticated manifest, SHA-256, bytes and chunk size |
| `download-chunk` | `versionId`, `index` | Authenticated base64 chunk |

Download clients concatenate chunks, verify the manifest SHA-256 and run
`decodeDevicePackage`; they can then use existing user-confirmed Import Device.
There is no server action that writes directly to a personal library. Chunking
avoids serverless single-response body limits. Every chunk rechecks authorization;
there are no reusable signed URLs bypassing unpublish/revocation checks.

Owners and MFA Admins can download private review/history versions. Other signed-in
users can download only the current approved version. No anonymous package download.
Pending updates do not displace an existing approved version. Rejecting an update
leaves that version public. Approving a replacement unpublishes the old active
version; an MFA Admin can explicitly reapprove an unpublished immutable version.

Errors are sanitized: 400 invalid package/input, 401 missing sign-in, 403 unavailable
or unauthorized data, 409 revision/chunk conflict, 413 quota, 429 throttled, 503
disabled or missing administrator configuration/storage. Internal SQL/provider
errors and uploaded metadata never become diagnostic response text.

## Approved Future Setup and Rollback

No following step has been performed remotely by this implementation.

1. Back up the explicitly approved target and inspect its migration ledger.
   Apply the existing dependency chain, then the new migration once. Do not edit
   old migrations or blindly push to a linked production/staging database.
2. Run local tests, the 17 validators, and `docs/community-library-preflight.sql`
   against the approved hosted target. Check Data API function grants explicitly.
3. Use existing server-only Supabase URL/service credentials. Provision a dedicated
   persistent attribution private JWK using the already documented signing-key
   setup; preserve old public verification keys for rotation. No private key or
   service credential is public or included in the generated validator bundle.
4. Confirm Linux optional native Sharp/libvips packages are installed, perform
   container/native vulnerability scanning, and size memory/time/concurrency
   limits for untrusted image processing. Sharp is pinned; existing dependency
   entries were unchanged by its installation.
5. Only with deployment/configuration approval, deploy the app/API and set
   `WIRENEXUS_COMMUNITY_ENABLED=true` on the intended environment. Configure no
   public signup changes. No bucket, DNS or Google Cloud change is required by
   the schema itself.
6. Verify real Supabase permissions, two-user ownership denial, real AAL1/AAL2
   moderation, simultaneous reservations and quota changes on separate DB
   connections, maximum-size upload/normalization/download, API body/time limits,
   Linux image decoding, unpublish visibility and native-image failure recovery.

Rollback is feature-flag off and/or the prior application revision, preserving
all new tables and immutable versions. Do not drop storage/history to roll back
code. Any schema removal needs a separate approved backup and data-retention plan.

Local concurrency tests use PGlite's serialized connections to exercise transaction
and CAS contracts; they do not replace real hosted multi-connection tests. A public
UI, moderator UI, license/abuse reports, notifications, retention jobs, account-erasure
policy and full-text relevance search are not implemented in this backend phase.

The dependency audit currently reports 13 advisory entries (4 high, 9 moderate),
identical on the untouched starting lockfile and this lockfile. No findings are
reported for Sharp or its new dependencies. Existing Vercel/ExcelJS-chain findings
are not silently repaired or suppressed in this scoped task; review them before
any separately approved deployment, along with the native-container scan.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Supabase Storage authorization](https://supabase.com/docs/guides/storage/security/access-control),
[Sharp security](https://sharp.pixelplumbing.com/security/),
[Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/).
