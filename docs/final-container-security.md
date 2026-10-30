# Phase 6.6M: final container security and build

Target `wirenexus-staging` / `837085353595`, `europe-west1`; review date
2026-10-30. Starting source `da9d2d50dcbd66e7e002ef4615a54975a4df28e4`.
Only staging build/registry writes and temporary repository-scoped build upload
access are authorized. No Cloud Run deployment, public access, DNS, production,
Supabase data/Auth or Vercel configuration change is part of this procedure.

## Remaining dependency review

The current upstream metadata was checked again: `@vercel/cli-config@0.3.5`
still depends on Zod 4.1.11 and ExcelJS remains 4.4.0 with UUID ^8.3.0. No safe
upstream embedded-artifact replacement was found. The Phase L pinned Blob 2.8.0
and patched Undici 6.29.1 remain unchanged. There is no forced downgrade,
dependency-only override pretending to repair embedded code, or advisory waiver.

The six npm findings (four high, two moderate) represent **two underlying
advisories**, including their vulnerable parent paths:

| Finding / impact | Observed exposure and limits | Disposition |
| --- | --- | --- |
| Zod memory exhaustion; Blob -> OIDC -> CLI-config -> embedded Zod 4.1.11 (four high package entries) | The inspected OIDC code reads Vercel CLI configuration/auth files through CLI-config. Its prebundle embeds Zod rather than importing the separately installed copy. WireNexus HTTP handlers use bounded JSON/publishing validators, not these Zod config schemas. GCS routes inject GCS storage rather than making Blob calls, but shared modules still import the SDK. No Vercel CLI credential/config files are included in the clean image. Malicious oversized configuration reaching the affected parser could exhaust process memory; module presence and future/fallback call paths prevent a blanket unreachable claim. | Unresolved. Require patched upstream bundled code or separately reviewed rebuild/fork and Vercel credential-flow regression, or explicit security-owner acceptance of a narrowly evidenced staging exposure. |
| UUID missing bounds checks for caller-supplied buffers/offsets in v3/v5/v6 (two moderate entries through ExcelJS) | The actual application imports ExcelJS's browser prebundle. Its observed conditional-formatting UUID call uses v4 without attacker-supplied output buffers; the advisory specifically distinguishes v4 from affected methods. Project/XLSX data is not an observed path to the vulnerable buffer API. Replacing only the separate Node UUID package leaves the browser artifact unchanged. The package/code remains present and future API changes can alter reachability. | Unresolved. Require patched upstream browser artifact, separately reviewed source build with browser/XLSX regression, or explicit narrow reachability acceptance. |

These are exposure observations, not exploit tests against hosted services and
not authorization to deploy. Primary references:
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Reproducible build and scan procedure

`node scripts/prepare-staging-image-build.mjs NEW_CONFIG --scan` reuses the
existing pinned source/build/real-entrypoint checks, then exports that exact
validated local image to a tar archive. Trivy scans the archive, not a moving
registry tag. Only after a successful scan/report step is the candidate pushed
to the existing private registry. Findings do not fail scanner execution or
constitute security approval: the report explicitly records
`deploymentApproved: false` and retains fixed **and unfixed** vulnerabilities.
A scanner/database/OS-evidence failure fails the build instead of being called a
clean result. There is no ignore-unfixed flag, severity filtering or suppression.

Scanner: Trivy **0.76.1**, official immutable multiarchitecture image pinned to
`ghcr.io/aquasecurity/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c`.
The digest was independently resolved from GHCR and compared to the official
release/package evidence; AMD64 is present. The release includes the October CA
incident mitigation. The application base and Docker builder remain separately
digest-pinned in `cloudbuild.validation.json`.

Trivy uses its published vulnerability database repositories; the exact database
timestamp and scanner version are recorded. Database content is point-in-time,
not permanently pinned or a promise about future CVEs. `container-scan-report.mjs`
records every finding (target, package/version, advisory, severity, fix/status and
source) plus summary counts and the original JSON report checksum in Cloud
Logging. OS scan/database evidence is mandatory. Vulnerability scanning only is
requested; this is not a secret, penetration, runtime exploitability, license or
misconfiguration audit. Embedded packages can be missed by generic scanners,
which is why the independent npm/bundled-code review above remains applicable.

No new scanning API, paid Artifact Analysis subscription, storage bucket,
runtime permission, service-account key or deployment role is needed. The
existing build identity receives Artifact Registry Writer on the named repository
only for execution, followed by removal and independent policy verification.
The builder retains only Logs Writer at project scope. Build compute, scan time,
logs, downloads and retained image storage can incur the existing staging costs.

Official scanner references: [release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.1),
[database sources](https://trivy.dev/docs/dev/configuration/db/).

## Acceptance gates

The build must prove Linux AMD64, non-root user, port 8080, the actual startup
command, both default LB and explicit IAM-private startup, all 688 assets,
server-source denial, secret-filtered account-config and unauthorized publishing
rejection. Dependency calls in this container smoke use loopback fixtures, not
real secrets. Hosted Cloud Run IAM enforcement is not claimed without deployment.

Both existing Supabase Secret Manager references must be pinned to enabled
numeric version 1 with only the existing runtime Secret Accessor grants. Runtime
bucket metadata/read/create and self-sign permissions remain scoped and unchanged.
The registry stays private. Real service origin/CORS, Invoker IAM and hosted
Supabase/GCS acceptance still require separately approved deployment preparation.
Unresolved findings and any required fix/waiver remain deployment blockers even
when build, startup and scanner execution pass.

Execution evidence, final digest and scan findings are appended after the build.

Pre-build isolated validation: **2,299 repository tests passed**, zero failed,
skipped or canceled; all **16 static validators** passed. The 245 protected and
unrelated file hashes match their established baseline. Hosted metadata confirms
both version-1 secrets enabled with runtime-only Secret Accessor, no project-wide
runtime role, self-only signing and private uniform bucket access. No secret
payload was read for this metadata verification.
