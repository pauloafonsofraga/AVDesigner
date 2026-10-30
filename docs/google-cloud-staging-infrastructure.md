# Phase 6.6J: staging infrastructure

Target: `wirenexus-staging` / `837085353595`, organization `videocore.net`,
region `europe-west1`, Supabase `puyrylatmtcwlvyycplc`.
Assessment date: 2026-10-30. Application baseline: `6a04fb7`.
The [hosting runbook](google-cloud-hosting.md) and successful
[Linux container validation](cloud-container-validation.md) remain in force.

## Change approval and inventory

**Creation is pending explicit confirmation of names, permissions and costs.**
No Phase 6.6J remote resource has been created at this point. Proposed configuration
is recorded in `infra/staging/resources.json`; null secret versions deliberately
mean not configured, never an implicit `latest` reference.

Preflight preparation passed an isolated **2,297 repository tests** with zero
failures/skips/cancellations and all **16 static validators**. The focused
infrastructure/hosting/publishing set passed 32 tests. Hosted storage probes have
not run: execution is waiting for the resource/cost confirmation and the exact
authorized Keychain item names. No Keychain secret was read and no secret version,
canary object, role, IAM binding or other Phase 6.6J resource was created.

| Resource | Proposed exact identity / configuration |
| --- | --- |
| Docker repository | `europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images`, immutable tags; empty, private, no paid scanner enabled |
| Publication bucket | `gs://wirenexus-staging-publications-837085353595`, `europe-west1`, Standard, uniform access, explicit public access prevention, seven-day soft delete |
| Runtime service account | `wirenexus-runtime@wirenexus-staging.iam.gserviceaccount.com`, no downloaded key |
| Server credential reference | `wirenexus-staging-supabase-server` -> `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`; numeric version pending secure injection |
| Publishable key reference | `wirenexus-staging-supabase-publishable` -> `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`; numeric version pending secure injection |

Secrets use one user-managed replica in `europe-west1`. The publishable key is
not a privileged secret, but this reference keeps operator configuration out of
source. Only the two specifically identified staging credentials may be copied
from Keychain; do not search unrelated credentials, use production keys or inject
placeholders. The exact item names have been requested without asking for values.
There is no Vercel Blob token or stored Google private key requirement: publishing
uses the runtime identity's ADC and IAM signing. Invitation Resend credentials
remain a separate prerequisite, not inferred from Supabase SMTP settings.

## IAM boundaries

The existing validation account retains its sole Logs Writer role. The new
runtime identity needs no registry writer, project Owner/Editor, Storage Admin,
bucket listing, object deletion or deployment privileges.

- `wirenexusPublicationsStorage`: `storage.buckets.get`, `storage.objects.get`,
  `storage.objects.create`; bind at the publication bucket only.
- `wirenexusPublicationsSigner`: `iam.serviceAccounts.signBlob`; bind on the
  runtime account to that same account only, not on the project or other accounts.
- Secret Accessor: bind at each of the two named secrets only, not project-wide.
- `wirenexusRuntimeVerification`: only `iam.serviceAccounts.getAccessToken`;
  temporary operator binding on the runtime account, with expiry, for verification.
  Remove the binding and soft-delete the temporary role after verification.

Custom-role definitions are project metadata, not project-wide grants. Runtime
tokens in the verifier last ten minutes and remain in memory. Actual self-signing
must be exercised using the runtime token, not the operator's signing rights.
No `allUsers` or `allAuthenticatedUsers` binding is permitted. CORS is limited to
PUT from `https://staging.videocore.net`; it is not an authorization mechanism.
Signed URLs are short-lived bearer authorizations and must never enter logs.

## Verification procedure

`scripts/verify-staging-infrastructure.mjs` requires explicit `--allow-canary-io`,
the operator CLI path and isolated configuration directory. It refuses a different
project/bucket. Run only after resource/IAM approval and propagation. It exercises
the existing application GCS adapter with runtime-authenticated SDK requests and
IAM `signBlob`, not a downloaded signing key.

Checks cover enforced private metadata, signed exact-byte uploads, private reads,
anonymous denial, overwrite denial, wrong sizes, exact-origin CORS, expired
signatures, no runtime list/delete/project-administration rights, no authority over
the build account, and access to only configured numeric secret references.
Disposable canary objects contain no project/user data and are generation-matched
and deleted by the operator afterward; seven-day soft delete still applies.
Provider bodies, credentials, signatures and signed URLs are redacted on failure.
Local config tests do not substitute for successful hosted checks.

## Cost confirmation

No Cloud Run, load balancer, IP, DNS, image push, build or automatic paid scanner
is part of this phase. Empty repositories/buckets have negligible storage usage;
IAM identities/roles are not running compute. Costs grow with retained data,
soft-deleted data, operations, traffic, logging and secret versions/accesses.

Planning estimates in USD: registry storage about $0.10/GiB-month above the shared
0.5-GiB allowance; regional Standard GCS about $0.02-0.03/GiB-month; active secret
versions about $0.06/version-month beyond the six-version shared allowance.
For 2 GiB of images, 10 GiB of assets and two versions, allow about $0.52-0.62/month
before free allowances and excluding operations, egress, logs, tax and scanning.
These are not a cap or invoice; allowances are billing-account-wide.
See [registry](https://cloud.google.com/artifact-registry/pricing),
[storage](https://cloud.google.com/storage/pricing) and
[secrets](https://cloud.google.com/secret-manager/pricing) pricing.

## Dependency findings and deployment gates

A fresh npm audit still reports seven vulnerable package entries: five high,
two moderate, no critical. No package or lockfile is changed by infrastructure setup.
The detailed [Phase 6.6I review](cloud-container-validation.md) remains applicable.
Required remediation is a separately validated dependency change:

1. Upgrade installed Undici 6.28.1 to at least the patched 6.x 6.29.1 range.
2. Update the Vercel OIDC/CLI-config dependency path to patched Zod (at least
   4.6.6), or review a targeted override; regress publishing/authentication first.
3. Resolve ExcelJS's inherited UUID 8.3.2 finding using a compatible patched
   upstream/override, with XLSX export tests. Its observed v4 use differs from the
   vulnerable v3/v5/v6 buffer paths; that is not an automatic blanket waiver.
4. Pin the approved Blob SDK version instead of `latest`; do not blindly apply
   npm's suggested older Blob/ExcelJS versions or `npm audit fix --force`.

OS/base-image scanning remains required before deployment. An empty repository
cannot establish image vulnerability status. A retained image, build-writer grant,
runtime secret injection, GCS/IAM verification, load-balancer/Compute API/TLS/DNS
approvals and real hosted acceptance are still required. Do not set the trusted
LB flag before its network contract is configured. Keep registration disabled.
No Supabase database, Squarespace DNS, Google Workspace email, Vercel deployment
or production modification is part of this phase.
