# Phase 6.6J: staging infrastructure

Target: `wirenexus-staging` / `837085353595`, organization `videocore.net`,
region `europe-west1`, Supabase `puyrylatmtcwlvyycplc`.
Assessment date: 2026-10-30. Application baseline: `6a04fb7`.
The [hosting runbook](google-cloud-hosting.md) and successful
[Linux container validation](cloud-container-validation.md) remain in force.

## Change approval and inventory

**Provisioning approved and performed on 2026-10-30.** The operator approved the
specified resources, scoped IAM and estimated costs before creation. The actual
configuration is recorded in `infra/staging/resources.json`; null secret versions
deliberately mean not configured, never an implicit `latest` reference.

Preflight preparation passed an isolated **2,297 repository tests** with zero
failures/skips/cancellations and all **16 static validators**. The focused
infrastructure/hosting/publishing set passed 32 tests. Post-provisioning focused
hosting/configuration/response tests also pass (14 tests). Hosted verification results and
temporary access cleanup are recorded below; local tests alone are not evidence
of hosted access enforcement.

The final isolated staged source passed **2,288 tests** using
`node --test test/*.test.mjs` (all tracked matching files, excluding unrelated
uncommitted import tests), with zero failures/skips/cancellations, and all
**16** `scripts/*-validation.mjs` validators. The 14 focused tests include the
new expiry-response regression cases. No application dependency was changed.

| Resource | Created exact identity / configuration |
| --- | --- |
| Docker repository | `europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images`, immutable tags; empty, private, no paid scanner enabled |
| Publication bucket | `gs://wirenexus-staging-publications-837085353595`, `europe-west1`, Standard, uniform access, explicit public access prevention, seven-day soft delete |
| Runtime service account | `wirenexus-runtime@wirenexus-staging.iam.gserviceaccount.com`, no downloaded key |
| Server credential reference | `wirenexus-staging-supabase-server` -> `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`; pinned enabled version `1` |
| Publishable key reference | `wirenexus-staging-supabase-publishable` -> `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`; numeric version pending secure injection |

Secrets use one user-managed replica in `europe-west1`. The publishable key is
not a privileged secret, but this reference keeps operator configuration out of
source. Only the authorized `WireNexus-Staging-AuthAdmin` Keychain item was read.
Its credential was accepted by the target project's Auth settings endpoint, which
also confirmed `disable_signup: true`. It was transferred directly in memory to
the server secret and read back for a constant-time byte comparison. No key was
printed, passed as a command argument, written to a temporary file or committed.
No Supabase setting or database data was modified.

The publishable container remains empty: there is no supplied Keychain item or
secure Management API credential in this operator environment. An authorized
connector can return configuration, but copying its key through tool output or
command arguments would not satisfy the requested no-credential-logging rule.
Leave its version null until an approved direct, in-memory configuration-to-secret
transfer is available; do not invent a key or substitute the server credential.
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

### Hosted results (2026-10-30)

The completed verifier reported `STORAGE_PASS_PREREQUISITES_PENDING`, not an
unqualified deployment-ready result:

- PASS: runtime metadata confirms uniform access and enforced public-access
  prevention; exact-byte signed PUT succeeds; authenticated private read matches.
- PASS: anonymous reads, runtime object list/delete and secret inventory return
  403; signed overwrites return 412; both undersized and oversized bodies return
  400. Allowed-origin CORS succeeds; an unauthorized origin receives no grant.
- PASS: expired signed PUT returns 400 with an explicit expiry error. The verifier
  requires both a rejection status and an expiry-specific XML error; an arbitrary
  400/403 does not pass. Focused response tests preserve that distinction.
- PASS: runtime can access only the configured pinned server-secret version;
  it has no sign/token authority over the build-validation service account.
- PASS: operator policy inspection confirms no runtime project-wide grant, no
  public bindings on the new resources, exact scoped secret access, zero registry
  images and unchanged build-account Logs Writer access.
- PENDING: the runtime project-level `testIamPermissions` diagnostic is blocked by
  disabled `cloudresourcemanager.googleapis.com` in this project. Its 403 is
  explicitly classified as pending, not as proof of authorization enforcement.
  No extra API was enabled. Enabling that diagnostic API requires a separately
  approved staging configuration change; policy inspection above still passed.
- PENDING: publishable-key secure injection and its runtime access check.

Early attempts encountered normal custom-role/IAM propagation delays and then
exposed the disabled diagnostic API and GCS's 400 expiry response. No broader role
was substituted. Four successful synthetic canary uploads across these attempts
were generation-matched and deleted by the operator; no cleanup failed. Seven-day
soft delete retains these tiny test objects temporarily. A final operator listing
confirmed zero active canary objects; Cloud Run services and registry images are
also absent.

After testing, the temporary operator impersonation binding was removed and
`wirenexusRuntimeVerification` soft-deleted. The runtime account has zero
user-managed keys; its account policy retains only its self-signing grant.
Short-lived probe tokens were memory-only and expire within ten minutes; removing
the binding is not a claim that already issued OAuth tokens are instantly revoked.
All 245 protected/unrelated files matched their established hashes, including the
existing Device JSON Import edits, artwork, Masters and backups.

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
publishable-key injection, the pending Resource Manager diagnostic,
load-balancer/Compute API/TLS/DNS
approvals and real hosted acceptance are still required. Do not set the trusted
LB flag before its network contract is configured. Keep registration disabled.
No Supabase database, Squarespace DNS, Google Workspace email, Vercel deployment
or production modification is part of this phase.
