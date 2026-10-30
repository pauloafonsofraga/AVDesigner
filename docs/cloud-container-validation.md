# Phase 6.6I: Cloud container build validation

Target: `wirenexus-staging` (`837085353595`), `europe-west1`. Date: 2026-10-30.
This is build validation only: no Cloud Run service/revision, DNS, Supabase,
production or Vercel configuration changes are permitted by this procedure.

## Authorized resources and verified permissions

The operator explicitly approved one build-only service account and its Logs
Writer grant, plus Cloud Build execution/log records. Created:
`wirenexus-build-validation@wirenexus-staging.iam.gserviceaccount.com`.
Its only project role is `roles/logging.logWriter`, verified after creation.
It has no Storage, Artifact Registry, Secret Accessor or Cloud Run deployment role.

Google CLI 591.0.0 was unpacked from Google's checksum-verified macOS ARM archive
in a temporary local directory, without changing shell settings. The operator
completed normal Google SDK sign-in privately as `paulo@videocore.net`; isolated
credential storage is outside the repository. No credentials are copied into
the build, image, source archive or documentation.

Actual API permission checks confirmed the operator can create/get/list builds,
create/get service accounts and inspect/update the relevant IAM policies.
`iam.serviceAccounts.actAs` on the new account was independently confirmed; no
extra operator grant was needed. Cloud Build, IAM and Logging APIs are enabled.
The existing Google-managed Cloud Build service agent already has its expected
service-agent role; it was not newly created or given extra grants here.

## Reproducible build and image checks

`cloudbuild.validation.json` is submitted with `--no-source`, explicit project and
region, and a 600-second execution limit. It has no deployment step, trigger,
private worker pool, artifact destination, image push or source-staging bucket.
Cloud Logging is the sole log destination. Worker machine is explicitly selected
as `e2-standard-2` when submitted.

The repository was verified publicly readable without authentication. The build
downloads an exact 40-character commit's GitHub archive and verifies its SHA-256,
supplied independently at submission. It does not use a moving branch or local
working tree. `scripts/prepare-cloud-build-context.mjs` creates a separate
allowlisted context and asset manifest. It excludes Git data, tests, docs, Masters,
backups, PSDs, `.env` files and unrelated local files. It refuses working checkouts,
symlinks and existing output directories. Validation tools remain outside the
production image and are mounted read-only for testing.

Both the Node 24 base image and Google Docker builder are pinned by registry
digest in the checked-in configuration. The image is built as `linux/amd64` and
kept only on the temporary Cloud Build worker under a staging-validation tag.
It is not a retained deployable registry artifact; any later registry push needs
separate approval and an actual destination.

The image check asserts Linux AMD64, `USER node`, the existing startup command,
and exposed `8080/tcp`. The actual startup script is exercised in a non-root,
read-only container with networking disabled and `/tmp` as tmpfs. GCS metadata
and Supabase RPC dependencies use loopback fixtures inside the container, not
real credentials or hosted services. The test verifies:

- All 688 runtime asset hashes and byte counts against the independent manifest.
- Private-bucket metadata checked before the configured listener becomes healthy.
- Missing configuration exits safely; configured startup listens on port 8080.
- Editor, Output Viewer, password-viewer shell and `/v/:id` routes.
- CSS/JavaScript/image/JSON MIME types, account-config filtering and `no-store`.
- HEAD behavior, private server-source/backup denial and unknown API errors.
- Invalid trusted-IP rejection and unauthenticated publishing denial.

This does not verify real ADC signing, GCS CORS/upload permissions, Supabase RLS,
emails, MFA or live collaboration. Those remain hosted acceptance requirements.

## Defect found and scoped repair

`output-viewer.html` requests `src/engine/outputViewer.css`, but the Phase 6.6G
allowlist omitted CSS below `src/`. New regression assertions reproduced both
the allowlist rejection and HTTP 404 before correction. The sole application
repair adds `.css` to that existing static allowlist, keeping server modules
private. Both regressions pass afterward. No renderer, artwork, topology, Legacy
or device-definition changes were made.

Before cloud submission, the isolated scoped tree passed **2,293 repository
tests**, zero failed/skipped/canceled, and all **16 static validators**. The exact
startup/asset smoke also passed locally with production-only dependencies and
loopback fixtures; that local macOS ARM result is not the Linux container result.

## Existing dependency advisory review

`npm audit --json` still reports **seven vulnerable package entries: five high,
two moderate**, with no critical finding. Versions/lockfile are unchanged.
These are inherited paths, not seven independent directly imported libraries:

| Installed package | Audit level | Dependency path / disposition |
| --- | --- | --- |
| `@vercel/blob@2.8.0` | High | Inherits OIDC/Zod and brings Undici; retain existing Vercel compatibility, do not apply npm's suggested SDK downgrade blindly |
| `@vercel/oidc@3.8.9` | High | Blob -> OIDC -> CLI config -> Zod; requires reviewed upstream update or scoped override |
| `@vercel/cli-config@0.3.0` | High | Pins vulnerable Zod 4.1.11; Vercel configuration parsing path, not this application's request-body validator |
| `zod@4.1.11` | High | Oversized constrained-collection parsing can exhaust memory; patched range begins at 4.6.6 |
| `undici@6.28.1` | High | Blob -> Undici; five underlying advisories for EventSource/content-encoding/TLS/WebSocket behavior; patched 6.x range begins at 6.29.1 |
| `exceljs@4.4.0` | Moderate | Inherited UUID issue; npm proposes an older ExcelJS release, which is not a safe automatic fix |
| `uuid@8.3.2` | Moderate | ExcelJS uses v4 at its observed call sites, while the advisory concerns v3/v5/v6 caller-supplied buffers; no blanket waiver or forced major UUID upgrade |

GCS mode avoids Vercel Blob operations, but those modules remain installed and
imported by shared API modules; this is **not** proof that all affected behavior
is unreachable. No exploit was attempted against any hosted service. The build
is an isolated validation, not security approval to deploy these dependencies.
Resolve or explicitly disposition these findings in a focused dependency pass
with Vercel/publishing/export regression tests. OS/base-image vulnerability scanning
is separate and is not claimed complete by `npm audit` or a successful build.

Underlying references: [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
[Undici EventSource](https://github.com/advisories/GHSA-4qv8-2p9j-2685),
[content encoding](https://github.com/advisories/GHSA-xjj6-f33q-929c),
[TLS options](https://github.com/advisories/GHSA-2m5v-pch6-74hx),
[TLS renegotiation](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm),
[WebSocket buffering](https://github.com/advisories/GHSA-9fm3-97px-rjf6).

## Execution record and remaining gates

Cloud execution outcome will be recorded after the build finishes; local checks
alone must not be reported as a successful Google Cloud container build.
Potential charges are bounded build-worker execution, normal network use and
Cloud Logging ingestion/retention, subject to the billing account's free tiers
and current [Cloud Build pricing](https://cloud.google.com/build/pricing).
No registry repository, GCS source/application bucket or running application
service is created by this configuration. The service account and IAM binding
are persistent metadata, not running compute. No invoice amount is asserted.

The [Phase 6.6H prerequisites](google-cloud-staging-readiness.md) still apply:
private application bucket and signing/CORS checks, runtime/deploy identities,
Secret Manager versions, actual image registry destination, load balancer/Compute
API/TLS/DNS approvals, and hosted Supabase/collaboration acceptance. No production
publication cutover or data migration is part of this task.
