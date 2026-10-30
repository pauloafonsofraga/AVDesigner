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

## Initial scan and targeted hardening

The first scan/build (`80558c3c-9f3a-48cb-baba-b75bed10eebb`, source `15566cd`)
passed both Linux startup modes, then reported 247 package/advisory occurrences
(118 unique advisory IDs): 1 critical, 62 high, 98 medium, 84 low, 2 unknown.
The complete normalized findings are retained in
`docs/security/phase-66m-container-evidence.json`; that initial image is not the
final deployment candidate.

The critical `CVE-2023-45853` entry is reported against Debian `zlib1g`
`1:1.2.13.dfsg-1`, status `will_not_fix`. Debian's authoritative tracker explains
that Bookworm's zlib source does **not build** the affected contrib/MiniZip code
into its binary packages. This supports a package-specific not-affected
assessment, not removal of essential zlib or blanket dismissal of critical CVEs.
The unfiltered finding remains in every report. See
[Debian's package/build notes](https://security-tracker.debian.org/tracker/CVE-2023-45853).

Seventeen of the first scan's 19 advertised fixes concern Node/npm-bundled tools
(brace-expansion 5.0.9, ip-address 10.5.0, postcss-selector-parser 7.1.4 and
Undici 6.28.0), not the application's separately locked patched versions. The
runtime never invokes package managers: it starts the existing Node entrypoint.
The final Docker stage therefore removes global npm/npx/Yarn/Corepack shims while the build
stage retains npm for `npm ci`. App dependencies and the Node runtime are not
removed. New container assertions prove these package-manager executables are
absent. The same source is rebuilt and rescanned to measure the effect rather
than suppress their findings. This reduces active filesystem attack surface;
base image layer bytes are not claimed erased from the registry.

Other advertised fixes are a tzdata administrative update and UUID's existing
major-version/bundled-artifact issue. No unpinned distro upgrade, repository
switch or forced package override is introduced. The pinned Node base was
independently checked against the current official Node 24 Bookworm Slim tag
and already matches it. Further OS findings require package-specific distro
analysis or an explicitly reviewed base-family/update change.

The first OS scan has 229 occurrences: 170 `affected`, 41 `fix_deferred`,
17 `will_not_fix`, and one advertised fixed update. Its 56 high occurrences
include repeated source-package advisories across util-linux binaries/libraries,
plus gzip, ACL, systemd/udev, ncurses and Perl packages. Most have no vendor fix
listed in the current database. The server/API/entrypoint code has no observed
`child_process`, `spawn` or `execFile` calls, so local utility exploitation is not
an observed ordinary HTTP action; that is not proof that library vulnerabilities
or a compromised container are harmless. Do not purge essential distro libraries
or change OS families merely to obtain a lower count. Remaining OS entries need
per-advisory vendor/exposure review or explicit security-owner acceptance.

The hardened scoped source passed **2,300 repository tests** and all **16 static
validators**, with zero test failures/skips/cancellations before its rebuild.

## Final candidate evidence

| Evidence | Verified value |
| --- | --- |
| Source commit | `54990e8196ffc250f370b8692d6ca23ef27a872b` |
| GitHub source archive SHA-256 | `349d5affc33d7b1c48fedbdd84655413f841502d951435a77df5cfde11fb1ab2` |
| Cloud Build | `5a244ece-0ab2-4ce6-b6ea-65e3f7c46660`, `europe-west1`, SUCCESS, all seven steps passed |
| UTC start / finish | `2026-10-30T11:45:18.515905199Z` / `2026-10-30T11:47:26.007683Z` |
| Private image | `europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus@sha256:fdba185aa262f916bb705ae929eae68c61eaf05afba37ec4aa55b1f1e0919598` |
| Registry verification | Independent describe returns the same digest; SLSA level is unknown, not claimed certified |
| Container proof | Linux x64, UID 1000, port 8080, real entrypoint; IAM-private and LB modes both PASS; all 688 asset hashes/API checks PASS |
| Runtime hardening | npm/npx/Yarn/Corepack/pnpm shims absent; build-stage npm retained; app dependencies unchanged |
| Scanner/database | Trivy 0.76.1; DB updated `2026-10-30T07:16:25.054174501Z`, scan created `2026-10-30T11:47:07.304554741Z` |
| Complete normalized evidence | [hardened scan and startup records](security/phase-66m-hardened-evidence.json) |

### Measured findings

| Severity | Initial candidate | Hardened candidate |
| --- | --- | --- |
| Critical | 1 | 1 |
| High | 62 | 56 |
| Medium | 98 | 88 |
| Low | 84 | 83 |
| Unknown | 2 | 2 |
| Total package/advisory occurrences | 247 | 230 |
| Unique advisory IDs | 118 | 101 |
| Occurrences with an advertised fix | 19 | 2 |

Removing unused package managers eliminated **17** occurrences, including all
six high Node-tooling occurrences, without changing the application dependency
lockfile or server behavior. The final scan still has 229 Debian occurrences and
one language-package occurrence: UUID 8.3.2 at
`app/node_modules/uuid/package.json`. Its two advertised fixes are that previously
reviewed UUID upgrade and tzdata `2026e-0+deb12u1 -> 2026f-0+deb12u1` (unknown
severity/administrative update). No automatic application-major override or
unpinned OS update was used.

Trivy does **not** report the embedded CLI-config Zod copy. That is a scanner
coverage gap, not evidence the four inherited high npm findings disappeared.
The independent npm audit remains **six package entries, four high/two moderate**.
The critical zlib entry remains visible with the Debian-specific not-affected
assessment above. All other OS entries remain recorded and undispositioned;
there is no blanket waiver for `affected` or `fix_deferred` status.

### Final boundaries and readiness

- Both staged build executions used only the existing registry and build account;
  each temporary repository Writer binding was removed in `finally` and verified.
  Final repository IAM has no direct bindings or public principals. Runtime IAM,
  secret-scoped Accessor, self-signing and private bucket flags are unchanged.
- Both Supabase references are pinned to enabled version 1. No secret values,
  runtime credentials or signed URLs were printed or provided to either build.
- No Cloud Run service exists in `europe-west1`. No deployment, DNS, production,
  public-access, Supabase data/Auth or Vercel modification occurred. All 245
  protected/unrelated hashes remain unchanged.
- Two staging builds plus scan/download/logging and retained image storage are
  cost-bearing usage; no new bucket, service account, scanning subscription,
  load balancer or application compute service was created. Build execution
  times were approximately 124.5 and 127.5 seconds, excluding queue/propagation.

**Build/startup validation is complete; security deployment approval is not.**
Remaining blockers: resolve or explicitly accept the embedded Zod/UUID risks and
remaining OS findings; decide the tzdata update; separately approve the private
Cloud Run deployment; resolve the actual service origin and exact CORS/Auth
requirements; then verify real Invoker IAM denial, Supabase/GCS/secret access and
application workflows. The critical package mismatch has a documented vendor
assessment, not a hidden suppression. Do not deploy the initial image or confuse
the final digest with an approval to release it.

Pre-build isolated validation: **2,299 repository tests passed**, zero failed,
skipped or canceled; all **16 static validators** passed. The 245 protected and
unrelated file hashes match their established baseline. Hosted metadata confirms
both version-1 secrets enabled with runtime-only Secret Accessor, no project-wide
runtime role, self-only signing and private uniform bucket access. No secret
payload was read for this metadata verification.
