# Phase 6.6K: private Cloud Run deployment readiness

Date: 2026-10-30. Project `wirenexus-staging` / `837085353595`, region
`europe-west1`, Supabase `puyrylatmtcwlvyycplc`. Branch `engine-prototype`.
**Preparation only; deployment is not authorized.** Existing Vercel, Supabase
data, DNS, Squarespace and Google Workspace remain unchanged.

Phase K's historical blockers below are superseded by the
[Phase L implementation/status](private-deployment-blockers.md): publishable
version 1 is configured and an explicit IAM-private adapter mode is implemented.
Residual embedded dependency findings and a rebuilt/scanned image remain gates.

## Go/no-go

**NO-GO for deployment.** The retained image is a readiness candidate, not a
security-approved release. Required gates:

1. Securely inject the staging publishable key and pin its numeric Secret Manager
   version. The operator has been asked to store it as
   `WireNexus-Staging-Publishable` in macOS Keychain; no value should enter chat,
   tool command arguments, source, logs or image layers.
2. Resolve or explicitly approve a documented disposition for the seven existing
   npm package findings; scan the base OS/image before deployment.
3. Review and implement a narrowly scoped **IAM-private ingress mode**. The current
   adapter deliberately requires `WIRENEXUS_TRUST_GOOGLE_LB=true`, and API routes
   require the load balancer's overwritten `X-WireNexus-Client-IP`. There is no
   load balancer in this phase. Setting the flag on a direct `run.app` service,
   trusting caller-supplied headers, using `--local` in production or disabling
   throttling is not a valid workaround. Existing fail-closed behavior is tested
   and unchanged. An IAM-private mode must retain conservative shared/per-user
   rate limits without claiming a verified client IP, and must leave the existing
   LB contract unchanged.
4. Resolve the actual Google-managed service origin and approve the service-only
   Invoker policy. No Cloud Run URL is invented or treated as an existing service.
   Reconcile that origin with host validation, private browser access, viewer
   links, signed-upload CORS and any required Auth redirects before testing.
5. Obtain separate approval for the actual service deployment and IAM bindings.

The disabled Resource Manager API still prevents runtime `testIamPermissions`
diagnostics. This is a pending diagnostic, not evidence of authorization denial.
No extra API was enabled. Project/resource policy inspection remains available.

## Candidate image

`scripts/prepare-staging-image-build.mjs OUTPUT` derives a build configuration
from the existing `cloudbuild.validation.json`. The first three validation steps
are unchanged; only after they succeed does a fourth step tag and push to:

`europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus:SOURCE_SHA`

The build uses `--no-source`, `europe-west1`, `e2-standard-2`, Cloud Logging only,
and the existing build-validation service account. It downloads the exact public
GitHub archive and verifies the independently supplied SHA-256 before creating
the allowlisted context. No local dirty file, secret, backup or Masters file is
uploaded. Node and Docker builder images remain digest-pinned; `npm ci` uses the
committed lockfile. Validation asserts Linux AMD64, non-root user, port 8080,
startup command, all runtime assets and relevant HTTP routes with loopback
fixtures. It is not hosted Supabase or IAM-private acceptance.

Source commit: `caa70572e8a79d5770c164a8d513c6e9093808ca`.
Source archive SHA-256:
`1180b060b1e4058ec4f5d56931cbf9c01847ff16c98cba244c752f9cbc449522`.
The repository's immutable tag and the resulting digest identify this candidate.
Any dependency or ingress repair requires a new source commit, build, tests and
digest; never deploy this candidate under an approval intended for a repaired one.

### Verified build record

| Evidence | Value |
| --- | --- |
| Cloud Build | `34a92fb7-e3da-45ed-976c-1c254f986c29`, `europe-west1`, SUCCESS, all four steps passed |
| Start / finish UTC | `2026-10-30T11:06:22.642567224Z` / `2026-10-30T11:08:06.164121Z` |
| Registry digest | `sha256:2755e5132704c7a51e0e657a63b15e05d60a8a911cc0a14504f8a3618402e221` |
| Independent registry describe | Same digest and exact approved repository; SLSA build level reported unknown, not claimed verified |
| Container smoke | PASS: Linux x64, UID 1000, port 8080, real entrypoint, 688 asset hashes, all startup/route checks |
| Source context | 710 allowlisted files, 688 public assets; no local worktree, secret, Masters or backup input |
| Temporary writer cleanup | Removed and independently confirmed; repository policy has no remaining direct bindings |
| Deployment inventory | No Cloud Run service in `europe-west1`; no DNS or public-access change |

The fourth step pushes the validated image; Cloud Build's declared-image export
then confirms the same digest (layers already present), not a second candidate.
Build execution was about 103.5 seconds plus queueing; build compute/logging and
retained image storage are cost-bearing. No paid vulnerability scanner was enabled.
Pinned inputs and immutable digests provide reproducible preparation/selection;
no unsupported claim of bit-for-bit identical fresh rebuilds is made.

The isolated scoped tree passed **2,290 repository tests**
(`node --test test/*.test.mjs` over tracked matching files), zero failed/skipped/
canceled, and all **16 static validators**. The focused hosting/readiness set
passed 10 tests, including the explicit private-ingress blocker regression.
The original uncommitted Device JSON Import changes remain excluded.

The build identity needs `roles/artifactregistry.writer` on this repository only,
not at project scope. Its existing project role remains Logs Writer only. The
repository rejected conditional IAM policies; the build therefore uses a
temporary repository-local binding with explicit finally-block removal and
post-build verification. No runtime Secret Accessor, Storage, deployment or
service-account impersonation rights are granted to the builder.

## Dependency decisions required

A fresh `npm audit --json` reports five high and two moderate package entries,
zero critical. No package or lockfile is modified by this readiness pass.

| Path | Required remediation before deployment |
| --- | --- |
| Blob 2.8.0 -> Undici 6.28.1 | Update to patched 6.x >=6.29.1; verify Vercel and GCS publishing behavior |
| Blob -> OIDC 3.8.9 -> CLI config 0.3.0 -> Zod 4.1.11 | Reviewed upstream update or scoped override to Zod >=4.6.6; pin Blob instead of `latest`; preserve Vercel authentication |
| ExcelJS 4.4.0 -> UUID 8.3.2 | Compatible upstream repair or reviewed override to a patched release (11.1.1 branch or newer patched branches), with XLSX export regression tests |

The seven entries include parent packages inheriting vulnerabilities, not seven
independent root defects. Observed UUID v4 use differs from the affected buffered
v3/v5/v6 methods, but is not a blanket waiver. GCS mode does not prove shared
Vercel dependencies unreachable. Do not use `npm audit fix --force` or blindly
accept npm's Blob/ExcelJS downgrade suggestions. Relevant primary advisories:
[Undici](https://github.com/advisories/GHSA-2m5v-pch6-74hx),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Exact proposed service configuration (not applied)

| Setting | Value |
| --- | --- |
| Service name | Proposed `wirenexus-staging`; not created |
| Project / region | `wirenexus-staging` / `europe-west1` |
| Image | Approved **repaired** digest in the existing staging repository; tag alone is insufficient |
| Service identity | `wirenexus-runtime@wirenexus-staging.iam.gserviceaccount.com` |
| CPU / memory | 1 vCPU / 1 GiB |
| Billing / scaling | Request-based, CPU throttling ON, min 0, max 3, CPU boost OFF |
| Concurrency / timeout | 8 / 300 seconds |
| Runtime / port | Second generation, existing Node entrypoint, port 8080 |
| Network ingress | `all` for reachability of the Google HTTPS URL; **not anonymous authorization** |
| Authentication | Invoker IAM check ON; `--no-allow-unauthenticated`; no `allUsers` or `allAuthenticatedUsers` |
| Invoker | Proposed service-scoped `user:paulo@videocore.net` only; not granted yet |
| Storage | Existing private bucket, attached identity ADC, no downloaded key |
| DNS / load balancer | None in this private stage |

Cloud Run's network ingress and IAM authorization are separate controls. Keeping
the IAM check enabled protects a network-reachable `run.app` URL. The runtime
identity is not the developer identity and does not need Invoker or deployment
privileges. A future deployer needs Cloud Run deployment permission and `actAs`
on this runtime account; do not use the build identity as runtime or invoker.
Verify the Google-managed Cloud Run service agent can pull from the same-project
repository when the service is approved; do not grant the runtime registry Writer.

Environment uses these exact existing values/references, with unresolved origin
and private-ingress mode kept as deployment blockers rather than dummy values:

- `WIRENEXUS_SUPABASE_URL=https://puyrylatmtcwlvyycplc.supabase.co`
- `WIRENEXUS_REGISTRATION_ENABLED=false`
- `WIRENEXUS_PUBLISHING_STORAGE=gcs`
- `WIRENEXUS_GCS_BUCKET=wirenexus-staging-publications-837085353595`
- `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` -> secret `wirenexus-staging-supabase-server:1`
- `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY` -> secret `wirenexus-staging-supabase-publishable:NUMERIC_VERSION`, pending
- `WIRENEXUS_EDITOR_ORIGIN` and `PUBLIC_VIEWER_ORIGIN` -> actual verified Google HTTPS origin, pending
- `WIRENEXUS_BUILD_SHA` -> repaired image's exact source SHA; `WIRENEXUS_BUILD_BRANCH=engine-prototype`
- Do **not** set `WIRENEXUS_TRUST_GOOGLE_LB` on a service without its verified LB.
- Cloud Run supplies `K_SERVICE` and `PORT`; do not fake them or Vercel variables.

Runtime grants remain bucket-only metadata/get/create, self-only `signBlob`, and
Secret Accessor on the two named containers only. No project-wide runtime grant,
object delete/list, stored Google private key or operator impersonation is needed.
The server credential must never appear in account-config; only the publishable
key may be returned there. Organization invitations additionally need the existing
separate send-only Resend API credential/sender if that workflow is to be tested;
Supabase SMTP credentials are not interchangeable with that API credential.

## Private HTTPS acceptance after separate approval

1. Recheck service Invoker IAM, no public principals, and the approved image digest
   and pinned secret versions before sending test traffic.
2. Obtain the actual service URL from Cloud Run, never a guessed hostname. An
   unauthenticated request must be denied by Google's IAM layer before the app.
3. Use an authorized developer's Google ID token for HTTPS invocation. For API
   requests also carrying Supabase authorization, use
   `X-Serverless-Authorization: Bearer GOOGLE_ID_TOKEN` and retain
   `Authorization: Bearer SUPABASE_ACCESS_TOKEN`. Cloud Run authenticates the first;
   WireNexus authenticates/authorizes the second. Never print either token.
4. Google's local Cloud Run proxy is suitable for developer browsing only after
   host/origin handling and preservation of Supabase Authorization are verified.
   A naked private URL does not supply an interactive Google login page. Do not
   put IAM tokens into frontend JavaScript, query strings or published viewers.
5. Verify health/build SHA/assets, Auth/MFA, cloud-project permission denial,
   private GCS upload/finalize, CORS, password viewers, quotas and collaboration.
   No real hosted acceptance is claimed before service deployment.

References: [private developer access](https://docs.cloud.google.com/run/docs/authenticating/developers),
[two authorization headers](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).

## Estimated costs and rollback

At current Tier 1 request-based list rates, active compute is approximately
$0.000024/vCPU-second + $0.0000025/GiB-second, plus $0.40 per million requests.
For the proposed 1 vCPU / 1 GiB instance, one aggregate active instance-hour is
about **$0.0954** before free allowances. Ten active instance-hours plus 100,000
requests is about **$0.994** before allowances. With min 0 there is no reserved
idle instance compute charge; startup, shutdown, requests, network and logs still
count. Max 3 is not a monetary budget cap. Free tiers are billing-account-wide.

Add existing registry/GCS/secret storage and operations, internet traffic to
Supabase/clients, build compute, log retention and tax. The Phase J example of
2 GiB registry + 10 GiB assets + two secret versions was about $0.52-0.62/month
before allowances, excluding traffic/operations. This private stage has no paid
load balancer, reserved IP or custom-domain certificate provisioning. See
[Cloud Run pricing](https://cloud.google.com/run/pricing) and the Phase J cost
sheet. These are usage examples, not an invoice or guaranteed spending limit.

If a future private deployment fails, disable its traffic or restore a validated
prior staging revision and pinned secret versions; preserve Supabase data and
private publication objects. For this preparation pass, remove only temporary
build upload IAM and retain the candidate as explicitly not deployment-approved.
Do not delete existing data, reset databases, rotate unrelated credentials or
alter Vercel/DNS as rollback.
