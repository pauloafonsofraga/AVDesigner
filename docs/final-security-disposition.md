# Phase 6.6N: final security disposition

Review date: **2026-10-30 (Asia/Dubai)**. Reviewed image:
`sha256:fdba185aa262f916bb705ae929eae68c61eaf05afba37ec4aa55b1f1e0919598`.
Registry: `europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus`.
Build source: `54990e8196ffc250f370b8692d6ca23ef27a872b`.

## Decision

**GO recommendation for a limited, named-operator-only, IAM-private Cloud Run
staging pilot of this exact digest under the controls below. NO-GO for public,
production, customer-data, broad-team, privileged-host or other-image deployment.**

This is a risk-based technical release recommendation, not a claim that packages
are patched, an organizational risk-owner approval, a clean scanner result, or
permission to deploy. The owner must still separately approve deployment and its
policy. The recommendation expires **2026-11-06**, or immediately on a relevant
new advisory or change to image, entrypoint, permissions, access mode, data scope
or controls. No reminder or automatic deployment is created.

The scanner's 1 critical and 56 high occurrences map to **12 distinct CVEs**.
The exact binary/component and reachable trigger matter more than ancestor/source
package counts. Each is assessed below; none is removed from the raw findings.
The six npm package entries represent two underlying advisories, assessed separately.

## Exact-image evidence

The private image was read through the authorized registry API, not executed or
deployed. Its manifest, config and **all 13 compressed layers** were SHA-256
verified against their OCI descriptors. Layer whiteouts and symbolic links were
resolved before inspecting the merged filesystem. No credentials or signed
download URLs were logged or committed.

[Runtime inspection evidence](security/phase-66n-runtime-inspection.json) records:

- Linux AMD64; image user `node`, existing Node startup command, no declared
  volumes. Phase M's actual Linux run independently proved UID 1000.
- Exact dpkg-installed versions, executable permission bits, package/component
  absence, source hashes, and an empty effective `/etc/fstab`.
- No MiniZip, `systemd-homed`/`homectl`, or `Archive/Tar` paths. Neither systemd
  service package nor Perl's full module package is installed.
- No observed `child_process`, `spawn` or `execFile` reference in the shipped
  first-party API/server/entrypoint sources. This is a bounded source inspection,
  not formal proof about every dependency or all possible native calls.
- Embedded Zod 4.1.11 is present; ExcelJS is the existing browser prebundle.
  These are not misrepresented as repaired dependencies.

## Critical: exact MiniZip/zlib assessment

`zlib1g:amd64` is exactly **`1:1.2.13.dfsg-1`**, source `zlib`. The installed
`lib/x86_64-linux-gnu/libz.so.1.2.13` resolves to
`usr/lib/x86_64-linux-gnu/libz.so.1.2.13`. Its bytes match the installed package's
MD5 record, and its independently computed SHA-256 is
`7e2a72b4c4b38c61e6962de6e3f4a5e9ae692e732c68deead10a7ce2135a7f68`.
The MD5 comparison is a package-consistency check, not a substitute for signed
vendor provenance; the image/layer SHA-256 checks bind it to the reviewed digest.

Debian's [CVE-2023-45853 tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853)
states that the vulnerable contrib/MiniZip code is not built into Bookworm's zlib
binaries. Its source-package status can still appear vulnerable. This image also
contains no MiniZip package/path. **Disposition: not affected for this exact
zlib binary**, not a general waiver for MiniZip, other zlib builds or future
images. Preserve zlib: deleting a required compression library is not a fix.

## High/Critical Register

For the register, `UL` means installed util-linux source version
`2.38.1-5+deb12u3` (bsdutils has binary epoch `1:`). The first six rows explain
48 repeated scanner occurrences across UL binaries/libraries. Scanner attribution
to libuuid/libsmartcols does not establish that each contains the vulnerable mount
or partition-parser function. All reviewed Bookworm high entries currently lack
a vendor fixed version for that release; newer-release packages are not safe
drop-in upgrades.

| CVE / severity | Actual component, trigger and shipped exposure | Mitigations and private-staging recommendation |
| --- | --- | --- |
| [CVE-2026-53613](https://security-tracker.debian.org/tracker/CVE-2026-53613), high | UL mount/libmount target-path race during an authorized non-root mount. Mount code and setuid mount executable are present. | No active fstab entries, no application mount/subprocess route, non-root startup; Cloud Run disallows setuid escalation and in-container mount operations. Accept only within this profile; affected source remains unfixed. |
| [CVE-2026-53615](https://security-tracker.debian.org/tracker/CVE-2026-53615), high | UL/libblkid extended-partition arithmetic can produce incorrect disk metadata when probing hostile disk images. `libblkid1` is present. | No disk-probing or raw-device feature in the server, no uploaded disk-image processing, no device or volume attachment in the pilot. Accept inaccessible trigger for this profile; do not call the library fixed. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642), high | UL mount post-hooks can run after helper failure and change filesystem privileges. Mount/libmount are present. | No fstab-authorized user mounts or configured hooks, no root mount helper invocation, Cloud Run privilege/mount restrictions. Accept private profile only; reevaluate if mounting is introduced. |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408), high | UL `nsenter --join-cgroup` can retain privileged cgroup authority across execution. The utility is present; exploit requires privileged invocation against hostile state. | Node UID 1000 entrypoint, no root operator/namespace-entry workflow, no subprocess route, platform boundary restricts host/cgroup access. Accept this inactive path; never use this acceptance for privileged Docker or host maintenance. |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409), high | UL mount subdirectory path resolution can escape an authorized mount tree. Tracker marks the installed source affected; no optimistic version-based exclusion is made. | Empty effective fstab, no authorized subdirectory mount or request-controlled mount arguments; Cloud Run denies in-container mounting. Accept profile only; source remains flagged. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410), high | UL restricted bind-mount source races can redirect later privileged ownership/mode changes. Mount code is present. | No relevant fstab entry, bind-mount helper, privileged post-hook or host volume; non-root and platform mount restrictions. Accept profile only; not patched. |
| [CVE-2026-41992](https://security-tracker.debian.org/tracker/CVE-2026-41992), high | GNU gzip `1.12-1` legacy multi-format CLI decompression can reuse poisoned state. The gzip binary is shipped. | Server does not execute gzip or process LZW/LZH through it; non-identity compressed API bodies are rejected. Node's compression APIs are not that GNU CLI path. Accept inactive trigger for pilot; no broad gzip waiver. |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369), high | `libacl1 2.3.1-3` pathname ACL functions can follow attacker-replaced symlinks during privileged operations. Library is present. | No ACL-management endpoint or observed privileged libacl caller; non-root app and no host volumes. Accept profile with residual native/dependency uncertainty. Fix introduces new ABI; do not copy unstable distro libraries into Bookworm. |
| [CVE-2026-16742](https://security-tracker.debian.org/tracker/CVE-2026-16742), high | Scanner flags libsystemd0/libudev1 `252.39-1~deb12u2`, but the described vulnerable feature is account/group management by systemd-homed. | Exact image has no homed binary/service or managed-user workflow. **Affected component not shipped**, despite source-package/library attribution. Accept this CVE for this image; not a statement that all systemd library code is safe. |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720), high | ncurses `6.4-4` `infocmp` CLI string analysis has a stack overflow. `infocmp` is shipped; source attribution also flags libtinfo/ncurses data. | Headless Node service has no terminal-analysis or infocmp subprocess feature. Accept inactive CLI path in the restricted pilot. Reassess before exposing terminal utilities or processing attacker terminfo. |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538), high | `perl-base 5.36.0-7+deb12u4` is flagged for memory exhaustion in Perl Archive::Tar. Perl interpreter exists, but the module is not in the minimal base. | Exact inventory has no Archive/Tar files, full Perl module package or application Perl/tar route. **Affected component absent** for this image. Installing that module invalidates this assessment. |
| [CVE-2023-45853](https://security-tracker.debian.org/tracker/CVE-2023-45853), critical | Exact Bookworm zlib package/binary verified above; MiniZip is not shipped. | **Not affected for the installed binary**, per Debian's build notes. Keep the raw critical result; do not broaden this assessment to other binaries or future tags. |

## Six npm Package Entries

Fresh npm audit still reports **four high and two moderate entries**, not six
independent exploits. The inspected image contains the same locked dependencies.
Latest inspected CLI-config 0.3.5 still uses Zod 4.1.11; ExcelJS remains 4.4.0
with UUID ^8.3.0. No safe upstream embedded-artifact replacement was found.

| npm entry | Exposure and release recommendation |
| --- | --- |
| `@vercel/blob@2.8.0`, high | Inherits the Zod path through OIDC/CLI-config. Module is shipped/imported, but the configured Cloud Run GCS handlers inject GCS operations and do not fall back to Blob. Accept only the explicit GCS pilot; do not extend to Vercel production or enable Blob credentials here. |
| `@vercel/oidc@3.8.9`, high | Its reviewed credential path reads local Vercel CLI configuration. No first-party API passes request JSON into that parser. No CLI config/credentials or Vercel environment should be introduced in the pilot. Accept scoped inactive credential flow, not a globally repaired library. |
| `@vercel/cli-config@0.3.0`, high | Its shipped entrypoint embeds Zod 4.1.11. A normal dependency override cannot replace those bytes. Accept only with no untrusted CLI config/auth files and no request-to-parser path; require upstream rebuild or reviewed fork before broader use. |
| `zod@4.1.11`, high | [Oversized-collection validation can exhaust memory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). WireNexus's active APIs use bounded JSON/explicit validators rather than this schema path. Vulnerable code is present, so retain the finding and accept only this restricted reachability assessment; future schema use invalidates it. |
| `exceljs@4.4.0`, moderate | Parent of the UUID advisory; the application imports its browser prebundle. No request-driven server XLSX/Perl/native decompression worker is introduced. Retain finding; accept observed v4-only use in the pilot. A package-only override does not rebuild that browser artifact. |
| `uuid@8.3.2`, moderate | [The affected buffered methods are v3/v5/v6](https://github.com/advisories/GHSA-w5hq-g745-h8pq); observed ExcelJS conditional-formatting calls use v4 without a supplied buffer/offset. Accept this specific use; do not expose other methods or claim the entire package is patched. |

## Required Pilot Controls

1. Deploy only the reviewed digest to `wirenexus-staging`, `europe-west1`, using
   the existing staging runtime identity and **`WIRENEXUS_CLOUD_RUN_ACCESS=iam-private`**.
   Preserve image user/entrypoint; no root override, debug shell service, extra
   sidecar, device, volume, filesystem mount, helper or user-provided code runner.
2. Keep Google's Invoker IAM check enabled and unauthenticated access disabled.
   Explicit Invoker access is for `paulo@videocore.net` or separately named trusted
   operators only. Review inherited project/organization grants as well as service
   IAM. Any public principal or unreviewed broad group is **NO-GO**.
3. Keep Supabase authentication, RLS/ownership, closed registration, quotas and
   existing durable throttles. Google's token is not a replacement for Supabase
   authorization. Use the two existing numeric version-1 secret references, no
   production credentials/data, no Vercel CLI/auth configuration or Blob fallback.
4. Keep this an operator-only pilot with synthetic/non-sensitive test projects.
   No broad Enterprise invitations, public publication links or customer uploads.
   Retain existing server-source/static allowlist and viewer sandbox protections.
5. Respect Cloud Run's [container security contract](https://docs.cloud.google.com/run/docs/container-contract):
   no privileged mode, setuid privilege escalation or in-container mounts. Some
   setuid bits remain in the filesystem; they were not silently stripped or
   represented as absent. This is a platform-specific mitigation and is not
   portable to an ordinary/privileged Docker host.
6. Use the existing bounded memory/request/scaling profile; no automatic package
   installation or shell maintenance inside the running service. Establish the
   actual HTTPS origin/CORS, then verify anonymous denial at Google's gate,
   authorized health, Supabase denial, workspace isolation and secret filtering
   immediately after separately approved deployment. Stop traffic on any failure.

The controls above are release preconditions and acceptance checks, not claims
that a not-yet-created Cloud Run service has already passed hosted testing.

## Fixes, Limits and Recommendation Boundaries

No runtime code, Dockerfile, dependency, image, RLS, permission or scanner-ignore
configuration changed in this review. No rebuild/rescan was necessary: the review
reads the existing digest and preserves its original unfiltered Trivy evidence.
The exact-image evidence and this document are the only intended repository changes.

No safely applicable Bookworm high/critical vendor update was identified. Moving
individual libraries from unstable/Trixie, changing the base family, forcing a
major dependency override or deleting required libraries would need a separately
tested rebuild and rescan, not a documentation-only claim of remediation. Optional
future setuid-bit removal is defense in depth, not needed to pretend scanner CVEs
are patched. The tzdata administrative update is not a high/critical code issue
and is deferred for this short UTC-oriented pilot; this is not an unlimited deferral.

**No findings are suppressed.** Original counts remain 230 occurrences, including
the critical; four high/two moderate npm package entries remain. This targeted
review does not fully disposition all medium/low findings, prove exploit absence,
certify every native dependency, or authorize public/production release. The
runtime inspection does not execute malicious payloads. Maintain the pinned scan
as evidence and re-review on expiry/change; no blanket permanent exception is granted.

## Validation Record

- Direct registry reads verified the manifest/config and all 13 layer digests;
  the merged filesystem was inspected without executing image code or provisioning
  cloud resources. Root-owned fstab is mode 0644 with no effective entries.
- Coverage check confirms a register entry for every one of the 12 unique
  high/critical IDs in the unmodified Phase M report. npm audit remains six
  entries (four high, two moderate). No ignore/suppression file was added.
- **34 focused tests passed**, zero failed/skipped/canceled: private IAM startup
  and limiter behavior, unchanged LB/GCS boundaries, patched dependency behavior,
  real local SQL publishing ownership/password/revocation checks and plan gates.
  These use local fixtures, not live Supabase policy modifications.
- Phase M's existing 2,300 repository tests, 16 static validators and real Linux
  startup/scan evidence remain the baseline for this unchanged image; they are
  not misrepresented as a new build or a repeated full-suite run in this phase.
- No runtime source, package lock, Dockerfile or image change was made, so no
  rebuild/rescan is asserted or needed to bind this review to the exact digest.
  Vercel hosting, Supabase permissions, production, DNS and public-access settings
  were not modified. Only documentation and inspection evidence are committed.
