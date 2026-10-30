# Phase 6.6H: Google Cloud staging readiness

Read-only assessment: 2026-10-30. Application candidate remains
`f5ad717ddb123a1025009c60f73fd70c4e233646` on `engine-prototype`.
The [Phase 6.6G architecture and runbook](google-cloud-hosting.md) are unchanged.
This report records confirmed infrastructure details, not a replacement design.

**Status: preparation checks pass; not ready to deploy.** No resources, builds,
images, IAM grants, API enablements, secrets, DNS records or deployments were
created in Google Cloud by this assessment. No production/Vercel/Supabase
configuration was changed.

## Confirmed target and access

| Item | Evidence / result |
| --- | --- |
| Project | Console confirms WireNexus Staging, ID `wirenexus-staging`, number `837085353595` |
| Organization | Project Settings location is `videocore.net` |
| Operator | Console authenticated as `paulo@videocore.net`; project IAM shows Owner (Legacy), with inherited Organization Administrator |
| Billing | Project dashboard/settings link to its billing account; billing is linked. Account overview shows Free Trial terms: confirm upgrade/expiry and budget policy before relying on ongoing staging availability; no billing action performed |
| Region | Owner-approved `europe-west1`; no deployed service region is claimed |
| Supabase | Approved staging `puyrylatmtcwlvyycplc`; no new hosted Supabase validation or configuration changes in this phase |
| Domain | Approved `staging.videocore.net`; no DNS/TLS endpoint assigned or changed |

Access was checked through the existing Google Cloud Console session, not by
extracting browser tokens. No Google Cloud CLI is installed locally. Browser
access is verified; deploy automation/ADC credentials are not yet verified.

## Enabled API snapshot

The complete enabled-services table had 31 entries, with 50 rows per page and no
next page. A second read confirmed the same inventory. Required APIs already
listed as enabled:

- `run.googleapis.com`
- `artifactregistry.googleapis.com`
- `cloudbuild.googleapis.com`
- `storage.googleapis.com` (also Storage component/JSON services)
- `iam.googleapis.com`
- `iamcredentials.googleapis.com`
- `secretmanager.googleapis.com`
- `serviceusage.googleapis.com`
- `logging.googleapis.com` and `monitoring.googleapis.com`

**Missing from that list:** `compute.googleapis.com`, needed for the existing
load-balancer/serverless NEG plan. `certificatemanager.googleapis.com` is also not
listed; enable it only if the selected certificate implementation uses Certificate
Manager rather than a Compute-managed SSL certificate. No API was enabled here.

## Resource and security readiness

| Inventory inspected | Result |
| --- | --- |
| GCS live bucket list, no filter | No rows to display |
| Artifact Registry repositories, no filter | No repositories to display |
| Cloud Run Services, no filter | Empty services list with the create-service prompt; nothing deployed |
| Secret Manager global secrets | This project does not have any secrets |
| Secret Manager regional secrets | This project does not have any regional secrets |
| IAM service accounts | Only the default Compute account is listed, enabled, with no keys; no dedicated application/build/deploy identities |

The default account and the operator's broad administrative roles are **not** a
substitute for the dedicated runtime identity specified in Phase 6.6G. Actual
bucket CORS, private flags, object permissions, Secret Accessor bindings and ADC
signing cannot be accepted before their resources and identities exist.

Required runtime access remains: bucket-scoped object creator/viewer,
`storage.buckets.get`, narrowly scoped `iam.serviceAccounts.signBlob` on the signer,
and Secret Accessor only on the exact staging secrets. Do not grant Storage Admin,
project Owner/Editor or customer-workspace access to the runtime. Use attached
service-account ADC, not downloaded long-lived JSON keys. Keep build/deploy
identities separate and grant `actAs` only on the intended runtime identity.

Required server secret: `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` for this staging
project. Invitation testing also needs `WIRENEXUS_INVITE_EMAIL_API_KEY` and its
approved `WIRENEXUS_INVITE_FROM`. Use Secret Manager numeric versions in the
Cloud Run revision. The matching Supabase URL/publishable key, explicit editor
and viewer origins, `WIRENEXUS_REGISTRATION_ENABLED=false`, GCS bucket/provider,
trusted-LB flag and build SHA use the exact variable names in Phase 6.6G.
There is no new `DATABASE_URL` requirement. Auth SMTP stays in Supabase; the
Vercel Blob token stays on Vercel. No secret values were accessed or exposed.

## Build and test results

Docker, Podman, Buildah, nerdctl, Colima, OrbStack CLI and Apple's container CLI
were not found; Docker/Podman Desktop were not installed in checked locations.
No local container runtime/daemon is available. Cloud Build was **not** used as
an automatic workaround: submitting a remote build creates jobs/artifacts and can
incur cost, outside the no-resource-creation constraint.

The following narrower checks passed against a clean archive of `f5ad717`,
without touching the dirty working tree:

1. `npm ci --ignore-scripts --omit=dev`, matching the Dockerfile dependency step.
2. Existing archive packager: 687 public runtime files, all byte-identical to
   their archived sources, with no backup/Masters/untracked artwork included.
3. Production-only imports of Google Storage, Supabase and all HTTP/API adapters.
4. An in-process native HTTP smoke with fixture credentials/storage: listening
   on `0.0.0.0`, health, public account-config/no-store/no-secret response, editor
   and viewer routes, module MIME, denied server-source access, invalid trusted
   source rejection, unauthorized publication rejection, unknown API rejection.
5. Actual start script refuses missing configuration with exit 1 and a sanitized
   error; it does not silently start an insecure or unconfigured service.
6. Focused suite: **31 passed, zero failed/skipped/canceled**:

```sh
node --test test/cloudRunHosting.test.mjs test/securePublishing.test.mjs \
  test/planPublishingSecurity.test.mjs test/organizationInviteApi.test.mjs
```

The HTTP smoke mocks remote services; it is not Google IAM, upload, Supabase
staging, or browser acceptance. Host runtime is Node 24.4.1 on macOS ARM64,
**not** the Dockerfile's Debian Linux runtime. No container image was built,
run, scanned or pushed. An actual Linux image test remains a deployment blocker.
The install still reports the seven existing dependency advisories (five high,
two moderate) identified in Phase 6.6G; no dependency upgrade was attempted.

## Exact next actions, requiring separate approval

1. **Choose a container builder:** install/authorize Docker Desktop or a suitable
   local Linux runtime, or explicitly approve a Cloud Build job and artifact
   storage. Build only a clean archive of the approved SHA, pin a reviewed Node
   24 base digest, target `linux/amd64` (or a multi-platform manifest including
   it), and test the actual image under its non-root user. Run dependency/image
   security review and resolve or explicitly disposition existing advisories.
2. **Approve the infrastructure change sheet and budget:** enable Compute API;
   choose the certificate implementation and enable Certificate Manager only if
   required. Confirm the linked account's trial/paid lifecycle, limits and alerts.
   Select actual service/repository/bucket/identity names before creation; none
   are invented or reserved by this document.
3. **Provision staging prerequisites only after approval:** Artifact Registry in
   `europe-west1`, dedicated runtime/build/deploy identities, and a private staging
   publication bucket in the approved location. Enforce uniform access and explicit
   public access prevention, exact-origin PUT CORS, immutable upload constraints,
   and the resource-scoped IAM above. Verify actual ADC signing, expired signatures,
   size mismatches, overwrite rejection and private-read denial.
4. **Inject staging secrets securely:** add numeric Secret Manager versions and
   bind the runtime account to only those secrets. Confirm the keys belong to
   `puyrylatmtcwlvyycplc`; keep registration disabled. Do not put values in chat,
   source, Git, image layers, build arguments, URLs or logs.
5. **Approve hosting/TLS setup:** prepare a global external Application Load
   Balancer, `europe-west1` serverless NEG, actual reserved IP, certificate and
   backend header overwrite `X-WireNexus-Client-IP: {client_ip_address}`. Enforce
   `internal-and-cloud-load-balancing` Cloud Run ingress and verify direct-origin
   bypass is denied. Check relevant organization policies and regional quotas;
   they have not been exhaustively audited. The app's trusted-header environment
   flag does not configure or secure the network by itself.
6. **Deployment/DNS remain separate approvals:** only then deploy the verified
   image digest with exact origins/secrets, and authorize the specific staging
   DNS record(s) using Google's actual IP/certificate outputs. Preserve Squarespace,
   Google Workspace email and `app.videocore.net`. Apply staging Auth redirect
   settings separately; do not replay Supabase migrations or enable registration.
   Complete the existing hosted GCS/Auth/MFA/cloud-project/collaboration acceptance
   checklist before declaring staging ready. Keep Vercel and its object store live;
   any publication migration/cutover needs its own verified reconciliation plan.

Official references: [Cloud Run image/port contract](https://docs.cloud.google.com/run/docs/container-contract),
[enabled services](https://docs.cloud.google.com/service-usage/docs/list-services),
[GCS signing prerequisites](https://docs.cloud.google.com/storage/docs/access-control/signing-urls-with-helpers),
[Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).
