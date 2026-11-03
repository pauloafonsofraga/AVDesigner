# Individual Device Packages

## Library workflow

- Right-click a Device Library entry and choose **Export Device**, or export the
  current Device Editor draft with its **Export Device** footer button.
- **Import Device** in the Device Library accepts `.wnx` packages. Review the
  confirmation before importing. Existing IDs are imported as separate copies;
  existing library entries and project instances are never replaced.
  Every import allocates fresh device identities, including paired dependencies.
- The existing **Export Device JSON** action remains a whole-library export.
- **Created by** and **Creation date** are read-only on the Device tab. New
  authenticated definitions and duplicates receive the current public creator
  identity automatically. Existing and imported definitions are not reattributed
  to the importer. Unauthenticated/legacy definitions show unknown, unverified
  authorship rather than invented names or dates.

## Format v1

`.wnx` is a binary envelope containing gzip-compressed UTF-8 JSON. The 46-byte
header contains the eight-byte `WNXPKG\r\n` magic, a big-endian uint16 version,
uint32 expanded byte count, and SHA-256 of the expanded bytes. Both envelope and
payload have version checks. Limits are 32 MiB compressed and 128 MiB expanded;
decompression stops at the declared expanded size. Unsafe JSON properties,
missing dependencies, malformed topology and external artwork URLs are rejected.

The payload contains the selected root definition, required paired-device
closure, required connector definitions (including compatibility parents), and
original embedded image bytes. Cards, slot assignments, faceplate/backplate
transforms and capability metadata remain part of the authored definition.
Gzip naturally compresses repeated artwork; the existing personal-library store
deduplicates durable artwork by content hash. No image resampling or conversion
is performed. MIME labels are corrected from actual bytes.

Compression is **not encryption**. The checksum detects corruption, not an
attacker who can rewrite the file and its checksum. Treat received packages as
untrusted definitions; importing never executes them or fetches their artwork.
Do not put confidential information into a shared device definition.

## Public attribution and trust

Public names come from `display_name`, `full_name` or `name`, never from an email
address or its prefix. Missing/unsuitable names use `WireNexus contributor`.
Creator IDs are account UUIDs, not email addresses. A browser claim is always
**unverified** unless a trusted server signature validates it.

Optional ES256 attestations bind the public creator, first server-attestation
date and a canonical digest of the complete package content. Canonical namespace
mapping lets genuine signatures survive local device/node collision aliases.
Editing authored content invalidates verification. Signatures do not prove
originality, copyright ownership or electrical correctness; they attest that an
authenticated account claimed the content.

`GET /api/device-package` returns only the deployment's trusted public keyring.
`POST` authenticates through the existing server-only Supabase guard and request
throttling, independently obtains the verified user, and signs only that user's
own attribution. No plan, role or email supplied by the browser is trusted.
No file-provided key, URL or `verified` flag establishes trust.

Administrator configuration, **not performed by this change**:

1. Configure existing server-only Supabase authentication credentials as usual.
2. Generate a dedicated P-256 signing key outside source control. Inject its
   private JWK as server-only `WIRENEXUS_DEVICE_ATTRIBUTION_PRIVATE_JWK` through
   the deployment's secret mechanism. Never use a Supabase key as a signing key.
3. For rotation, keep old public entries in
   `WIRENEXUS_DEVICE_ATTRIBUTION_PUBLIC_KEYS`, a JSON array of `{id,jwk}`.
   The active public key and its SHA-256 ID are derived server-side. Public JWKs
   must not contain private `d` values. Distribute the same trusted public keys
   to other authorized deployments that need portable verification.
4. Validate real authentication/signing in a separately approved environment
   before claiming production attribution verification. Unknown deployment keys
   retain the signed claim but display **unverified**.

The restricted Vercel development Preview intentionally has no Supabase or
signing secret. Packages work there, but attribution remains unverified. No
remote migration, signing key provisioning, production change or Google Cloud
staging change is required or performed. Signing errors fail explicitly rather
than silently downgrading an attempted authenticated attestation.

## Validation

`node --test test/devicePackage.test.mjs` covers binary round trips, original
artwork, cards/slots, paired closure, device/node collisions, compatibility,
durable reopening, public names, trusted signatures, tampering, unavailable
signing, malformed files and size limits.

`node scripts/device-package-smoke.mjs` tests real Chrome downloads and file
input, duplicate-safe library insertion, unchanged canvas topology, IndexedDB
reopening, read-only attribution, re-export and invalid-file rejection.
Use `AVDESIGNER_BASE_URL` for the isolated local validation server.

Import is an atomic personal-library save, not a project mutation or an Undo
entry. It reuses existing account/workspace library permissions. Paired devices
are dependencies of the selected root; unrelated library entries are excluded.
Signed creation dates represent first server attestation, which may be later
than an unsigned local draft's creation date. Cross-deployment verification
requires an operator-maintained public trust keyring; it is not automatic.
