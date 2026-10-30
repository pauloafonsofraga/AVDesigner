# Phase 6.6G: Google Cloud hosting preparation

Date: 2026-10-30. Branch: `engine-prototype`. Starting commit:
`5fb107924cf37992d2cd19f5158ff96e9ff885e9`.

Implementation and local preparation only. No Google resources, DNS records,
Supabase settings, credentials or production data were created or changed.
This is not approval to deploy or evidence of hosted Google acceptance.

## Audit and implementation

The existing Vercel deployment remains the default. `vercel.json`, the Blob
upload callback handler and existing private Blob reads are unchanged. Two small
shared integration changes select the uploader from the server reservation and
support an explicitly trusted Cloud Run request source for existing throttles.

| Existing dependency | Google preparation / retained behavior |
| --- | --- |
| Static HTML, Engine modules, factory catalogue, artwork, PDF workers | Allowlisted immutable runtime artifact, correct MIME types, GET/HEAD; no repository-root static serving |
| `vercel.json` rewrites | `/account-config.json` and `/v/:id` handled by the Node HTTP adapter; viewer already reads path IDs |
| Nine `api/` handlers | Same account-config, upload, publish, project, organization-invite, collaboration-operations, collaboration-live, health and build-info URLs |
| Vercel request/response conventions | Bounded JSON parsing, query parameters and response helpers in `src/server/cloudRun.js` |
| Vercel Blob client tokens/callbacks | GCS adapter issues five-minute signed PUTs only after existing SQL ownership/reservation checks; no GCS completion callback bypass |
| Private Blob head/get | Private GCS metadata and generation-pinned streams behind existing finalize/password/revoke checks |
| Supabase Auth, personal/workspace libraries, cloud project assets/versioning | Remain on existing Supabase APIs and Storage; **not** moved to GCS |
| Collaboration sequencing and Realtime | Existing server validation/API routes; browsers connect directly to Supabase Realtime |
| Organization invitation mail | Existing server Resend API and sender configuration; Auth SMTP remains in Supabase |
| Viewer HTML isolation | Existing restrictive iframe sandbox, no `allow-same-origin`, preserved password gate and CSP |

New files: `Dockerfile.cloud-run`, `scripts/build-cloud-run-public.mjs`,
`scripts/start-cloud-run.mjs`, `src/server/cloudRun.js`, `gcsStorage.js`,
`gcsUpload.js`, `runtimeAssets.js`, and `src/hosting/gcsUploads.js`.
The Google Storage SDK is pinned to 8.4.0. Node 24 is the proposed runtime;
resolve/pin the reviewed base-image digest before deployment approval.

## Required owner decisions

None of these resource identities or hosting endpoints has been invented or
provisioned. Supply/approve through the Google console or secure operator workflow:

1. Dedicated **staging** Google Cloud project ID/number, organization and billing
   account; budget/alerts and load-balancer baseline costs.
2. Approved Cloud Run region and matching serverless NEG region. Prefer proximity
   to Supabase's existing region, subject to residency and availability approval.
3. Artifact Registry repository, Cloud Run service name, dedicated runtime service
   account, separate build/deploy identities and operator permissions.
4. Globally unique private publication bucket name/location and retention,
   soft-delete/recovery, orphan-cleanup and cost policies.
5. Global external Application Load Balancer, serverless NEG, reserved frontend
   IP and Google-managed certificate for `staging.videocore.net`.
6. DNS operator, full zone export and exact change approval. Production
   `app.videocore.net` stays reserved and untouched. Approve the viewer origin
   (proposed same staging origin, with existing opaque iframe isolation).

No credentials should be supplied in chat, source, build arguments or Git.

## Environment and Secret Manager

| Variable | Staging value / handling |
| --- | --- |
| `WIRENEXUS_SUPABASE_URL` | `https://puyrylatmtcwlvyycplc.supabase.co` |
| `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY` | Matching staging publishable/anon key; only this key is returned by account-config |
| `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` | Existing server-only staging elevated key in Secret Manager; never frontend/build input |
| `WIRENEXUS_REGISTRATION_ENABLED` | `false`; Supabase signup stays OFF independently |
| `WIRENEXUS_EDITOR_ORIGIN` | `https://staging.videocore.net` |
| `PUBLIC_VIEWER_ORIGIN` | Explicit approved HTTPS viewer origin; no production fallback in this adapter |
| `WIRENEXUS_PUBLISHING_STORAGE` | `gcs` on Cloud Run only; leave absent on existing Vercel |
| `WIRENEXUS_GCS_BUCKET` | Actual dedicated staging bucket, still to be chosen |
| `WIRENEXUS_TRUST_GOOGLE_LB` | `true` **only after** ingress and overwritten header checks below |
| `K_SERVICE`, `PORT` | Supplied by Cloud Run; do not fake Vercel variables |
| `WIRENEXUS_BUILD_SHA`, `WIRENEXUS_BUILD_BRANCH` | Approved immutable commit and `engine-prototype` |
| `WIRENEXUS_INVITE_EMAIL_API_KEY` | Separate staging send-only Resend key, Secret Manager version, if invitations enabled |
| `WIRENEXUS_INVITE_FROM` | Existing approved verified sender, no invented address |

Use attached runtime service-account ADC, not `GOOGLE_APPLICATION_CREDENTIALS`
downloaded JSON keys. Grant Secret Manager Secret Accessor on **specific** staging
secrets and pin numeric versions on each revision. No secrets in Docker context,
image layers, account-config, URLs or request logs. Keep SMTP credentials only in
Supabase Auth. `BLOB_READ_WRITE_TOKEN` remains only on Vercel or a separately
authorized migration operator, not required by the Google runtime. Existing
Vercel package imports remain for compatibility, but GCS runtime routes inject
the GCS head/get implementations.

Restrict build/deploy permissions separately: artifact writer/build identity,
Cloud Run deployment permission plus `iam.serviceAccounts.actAs` only on the
runtime identity, and resource-scoped infrastructure operator grants. Avoid
project Owner/Editor or service-account keys as a shortcut.

## Private storage and ingress contract

The bucket must have uniform bucket-level access and explicit public access
prevention `enforced`; startup fails closed otherwise. Runtime requires bucket
metadata read (`storage.buckets.get`) and bucket-scoped object viewer/creator
permissions. It does not need object delete/overwrite or public ACL permissions.
Use a narrow metadata custom role rather than broad Storage Admin. Signed URL
generation with attached credentials also requires IAM Credentials API and
`iam.serviceAccounts.signBlob` on the signing service account; grant narrowly
(a self-only Token Creator binding if using that predefined role), not at project
scope. Verify actual ADC signing/IAM in staging before acceptance.

Signed PUTs bind the exact reserved object path, content type, identity encoding,
no-store metadata, exact byte range and generation-match zero (create only).
The browser sends its Supabase bearer only to `/api/upload`, never to GCS, and
does not follow upload redirects. Finalization still checks exact stored sizes
and types and revalidates ownership. Direct browser PUT avoids Cloud Run's HTTP/1
request limit for the existing 64 MiB project / 128 MiB viewer limits. API JSON
requests retain their 1,100,000-byte limit. Failures never activate a publication;
retry publishing creates a fresh reservation. Orphan cleanup is separate and
must not delete active or legacy publication objects.

Configure bucket CORS for the exact approved editor origin and PUT only. Include
the signed request headers `content-type`, `cache-control`, `content-encoding`,
`x-goog-if-generation-match`, `x-goog-content-length-range` in the tested CORS
configuration; no wildcard origins or public object permissions. Validate browser
preflight and upload against the actual bucket, including off-by-one byte sizes,
expired signatures and overwrite refusal. Signed URLs are temporary bearer
credentials: redact query strings and authorization headers in all diagnostics.

Use a global external Application Load Balancer/serverless NEG. Set Cloud Run
ingress to `internal-and-cloud-load-balancing`; externally accessible direct
`run.app` bypass must be denied. The backend must **overwrite**, not append, a
custom request header `X-WireNexus-Client-IP: {client_ip_address}`. The adapter
requires one valid IP in this header and never trusts arbitrary X-Forwarded-For.
The environment flag alone is **not** ingress security. Verify the overwrite
behavior with a spoofed client header and verify direct-origin denial before
enabling traffic. Missing/invalid IP fails API requests closed with 503. Maintain
appropriate organization ingress controls for internal callers too.

The public editor/viewer shell needs an intentional Cloud Run invoker policy
compatible with the load balancer; network ingress is not application user auth.
All existing Supabase bearer/RLS/ownership checks remain. Disable CDN caching for
API/private responses, preserve no-store, and do not log request bodies or signed
query strings. Proposed initial service sizing: 1 vCPU, 1 GiB, concurrency 8,
minimum 0, maximum 3 instances, 300-second request timeout; approve costs and load
test large HTML/password requests before adjusting. No local-disk durable state
or application WebSocket relay is needed. Existing SQL quotas remain shared
across instances.

## Reproducible artifact preparation

From the approved **committed** tree, never the dirty workspace:

```sh
git archive --format=tar APPROVED_SHA | tar -xf - -C /absolute/empty/staging-context
cd /absolute/empty/staging-context
npm ci --ignore-scripts
node scripts/build-cloud-run-public.mjs /absolute/empty/runtime-public --archive
node --test test/cloudRunHosting.test.mjs test/securePublishing.test.mjs
# After separate build approval, from this immutable context only:
docker build -f Dockerfile.cloud-run --build-arg NODE_IMAGE=REVIEWED_DIGEST_REFERENCE -t LOCAL_REVIEW_TAG .
```

Placeholders are intentionally unresolved, not real resource names. The normal
`npm run build:cloud-run -- /absolute/new/output` uses tracked files and refuses
dirty tracked runtime sources. `--archive` is solely for a clean git-archive
context. `.dockerignore` plus runtime allowlisting exclude Masters, backups,
migrations, secrets and original PSD sources from public serving. Runtime keeps
server modules privately for API execution, never exposes them as static files.
Images are copied byte-for-byte, not recompressed. Do not run the Docker build
against this user's dirty working directory.

## Existing publication links and migration design

No publication is moved in this phase. Current Vercel links continue working on
the unchanged deployment. GCS can read both modern server-assigned
`avdesigner/publications/<owner>/<id>/...` paths and historical
`avdesigner/projects/<id>/meta.json` plus viewer paths. IDs, password hashes,
ownership, registry records and viewer routes must remain unchanged.

A future separately approved storage migration must inventory private Vercel
objects/registry references, freeze or reconcile publication writes, copy exact
bytes under identical private GCS keys, preserve Content-Type, verify SHA-256 and
length, and reconcile every active/legacy reference before cutover. Do not rewrite
project definitions or trust client-supplied paths. Never copy production data
into staging. Do not forward private objects or signed URLs to viewers. There
is deliberately no automatic Vercel fallback after GCS errors, which could hide
incomplete migration or bypass revocation checks.

Keeping an old URL hostname working after a future host move requires continued
Vercel service or a separately approved alias/proxy/DNS plan for that exact old
hostname. Moving only `staging.videocore.net` cannot preserve arbitrary old
`*.vercel.app` hosts on Google. Keep the old store/deployment until all links are
verified; do not delete it as part of staging preparation. Following a GCS write
cutover, rollback to Blob requires reconciling **new** GCS-only publications first;
otherwise they cannot be read by the old service.

## Approved-future deployment sequence and rollback

1. Resolve owner decisions, refresh staging runbooks and DNS export, review image
   digest/dependency audit, approve exact infrastructure and cost sheet separately.
2. With separate approval, enable Run, Artifact Registry, Secret Manager, IAM
   Credentials, Compute/load balancing and chosen build/certificate APIs; create
   only dedicated staging resources/identities and the private bucket above.
3. Configure least-privilege IAM/CORS and numeric secret versions securely. Verify
   GCS private flags and signed upload constraints without production data.
4. Deploy the approved digest only after deployment approval. Attach the NEG/LB,
   overwritten IP header and restricted ingress. Verify health/build SHA, API
   host handling, secret filtering, static MIME/worker loading and bypass denial.
5. Obtain the actual reserved LB IP/certificate authorization from Google. The
   proposed DNS sheet is **only** `staging.videocore.net A <actual reserved IP>`,
   plus exact generated certificate-validation records if required. No guessed
   IP/CNAME, apex, `www`, nameserver, Google Workspace MX/SPF/DKIM/DMARC or
   `app.videocore.net` changes. Apply DNS only after explicit approval. Managed TLS
   must be valid before browser acceptance.
6. Separately approve staging Supabase Site URL/redirect configuration for the
   exact HTTPS staging origin per the existing domain/email runbook; keep signup
   disabled, MFA and private Realtime unchanged. No migrations are required by
   this hosting adapter. Do not replay historical migrations.
7. Verify real browser Auth/MFA, local Save/Open, cloud Save/Open/conflicts/history,
   role denial/revocation, quotas, invitations, two-client catch-up and private
   Realtime. Verify GCS upload/finalize/password/revoke and legacy fixture links,
   hostile HTML isolation, load/timeout behavior and private bucket denial.

Stop on any IAM, signature, authorization, data-integrity or isolation failure.
Rollback application traffic to a validated prior staging revision and its pinned
secret versions. Restore only exact staging DNS/Auth entries changed in the
approved sheet. Preserve database data/migration history and both object stores;
do not reset Supabase or replay migrations. Reconcile any new publication writes
before changing storage provider; use a GCS-capable prior revision when needed.
Leave the existing Vercel deployment available throughout.

## Validation and outstanding blockers

Focused tests cover real local PostgreSQL publishing RPC ownership/reservations,
GCS signed constraints/private metadata, failed finalize, password/revocation,
browser token separation, trusted IP configuration, bounded HTTP APIs, rewrites,
static allowlisting, symlink escape rejection and MIME types. These use local
fixtures, not hosted credentials. Existing Vercel publishing security tests remain
unchanged. The isolated candidate passed `node --test --test-concurrency=2`:
2,290 passed, zero failed/skipped/canceled; all 16 `scripts/*-validation.mjs`
validators passed. Its archive produced 687 allowlisted runtime assets;
byte-for-byte copy checks passed, and dirty tracked runtime packaging was rejected
before output creation. The viewer bundle refresh changed only its package
provenance `sourceHash`, not JavaScript, CSS, icons or bundle hash. Protected-file
hashes and the original unstaged Device JSON Import edits remained intact and
excluded from the commit.

Real GCS IAM signing/CORS/byte-range rejection, Google ingress/header behavior,
container runtime/image scan, managed TLS and two-user hosted Supabase acceptance
are **outstanding**, not claimed passed. Docker is not installed in this operator
environment, so no container build was performed. No cloud credentials are
required for the local fixture tests. Existing lockfile dependency advisories
(`@vercel/blob`/OIDC/zod, undici and exceljs/uuid) require a separate reviewed
dependency update before deployment acceptance; this phase does not blindly
upgrade the working Vercel stack. No new audit finding was attributed to the
added Google Storage dependency.

Related: [domain/email preparation](staging-domain-email-preparation.md),
[Supabase staging](supabase-staging.md), [publishing security](secure-publishing.md).
Official contracts: [Cloud Run containers](https://docs.cloud.google.com/run/docs/container-contract),
[ingress](https://docs.cloud.google.com/run/docs/securing/ingress),
[LB custom headers](https://docs.cloud.google.com/load-balancing/docs/https/custom-headers),
[signed URLs](https://docs.cloud.google.com/storage/docs/access-control/signing-urls-with-helpers),
[GCS request headers](https://docs.cloud.google.com/storage/docs/xml-api/reference-headers),
[generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions),
[Secret Manager](https://docs.cloud.google.com/run/docs/configuring/services/secrets).
