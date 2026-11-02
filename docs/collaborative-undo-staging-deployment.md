# Collaborative undo staging deployment

Date: 2026-11-02. Target: `wirenexus-staging`, `europe-west1`.
Approved source: `dd109d4c58b57fc88fc79072ff8ecb9eaf24565c`.

## Build And Security Decision

Cloud Build `6f74b9d1-2238-476d-9246-6b9671fc9c93` succeeded. It fetched the
pinned public source archive, verified SHA-256
`072ced700feba7743086e01aa1882f56cbe5b56ec998c1b9bbe726666ebed9d7`, and reused
the existing allowlisted build-context preparation. No local checkout, unrelated
Device JSON Import changes, backups, Masters or credentials were uploaded.

Candidate:

```text
europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus@sha256:81ae647d17c7631f1c6d55e7606bcc97ad780d146a4816b7d3206ffec1ea862a
```

All 90 Linux undo/collaboration/hosting/security tests passed. The real container
entrypoint passed in both IAM-private and load-balancer modes: Linux AMD64,
UID 1000, port 8080, all 688 asset hashes, unauthorized publishing rejection,
source denial and secret-filtered configuration. Dependency endpoints in these
container checks were loopback fixtures, not hosted acceptance.

Trivy 0.76.1, database updated 2026-11-02, scanned the exact candidate archive
without ignore flags: **219 occurrences**, 103 distinct advisory IDs; 1 critical,
32 high, 101 medium, 83 low and 2 unknown. Original report SHA-256:
`ed9fc237102eabfe63bf9fa72ebbc0c429ebe976bf237ce1ea3eedebbc0c9c13`.
All high/critical IDs are in the previous security register; fewer occurrences
with a newer advisory database are not claimed as package remediation.

The critical remains CVE-2023-45853 against the unchanged
`zlib1g 1:1.2.13.dfsg-1`. The unchanged pinned base and Debian's
[MiniZip build notes](https://security-tracker.debian.org/tracker/CVE-2023-45853)
support the existing exact-package disposition. See the prior
[security register and pilot controls](final-security-disposition.md).

Fresh npm audit reports **13 package entries: 4 high, 9 moderate**, including
the new [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Its seven additional parent-chain entries are not seven new exploits. Shipped
minimatch versions are 3.1.5 and 5.1.9 under ExcelJS/archiver; the cited
`firstPhasePreProcess` / `optimizationLevel >= 2` path is not present in those
inspected modules. No server API imports archiver/minimatch or accepts glob
patterns; the application uses ExcelJS's browser prebundle. Retain the finding,
do not force the suggested ExcelJS downgrade or assert a general package fix.
Existing embedded Zod and UUID findings remain unchanged and unresolved.

New medium OS IDs were reviewed against Debian:

- [CVE-2026-115455](https://security-tracker.debian.org/tracker/CVE-2026-115455):
  libstdc++ wide-stream bitset extraction; no such application feature exists.
- [CVE-2026-114691](https://security-tracker.debian.org/tracker/CVE-2026-114691):
  oversized `vector<bool>` construction; no exposed native container-allocation
  API. Bounded request sizes/non-root operation remain; dependency uncertainty
  is not represented as proof of absence.
- [CVE-2026-114690](https://security-tracker.debian.org/tracker/CVE-2026-114690):
  parallel-mode native search buffers; no request-driven native search/compiler
  workflow. These three IDs repeat across gcc/libgcc/libstdc++ package attribution.
- [CVE-2026-84243](https://security-tracker.debian.org/tracker/CVE-2026-84243):
  malicious gettext catalogs plus attacker-controlled LANGUAGE/locale environment.
  HTTP input cannot set process environment or install locale catalogs; no SSH,
  shell, host volume or environment-administration endpoint is exposed.

**Technical GO only for the explicitly approved, operator-only, IAM-private,
synthetic-data staging pilot.** No public/production clearance. Keep the original
2026-11-06 review deadline and all pilot restrictions; re-review any relevant
new advisory or configuration change. No finding was suppressed or called fixed.

The existing build identity received temporary repository-only Writer for this
build; that binding was removed and verified after successful image storage.
No new resource, runtime permission or credential was created. Build/scan compute,
logs and retained registry storage incur existing staging usage charges.

## Deployment And Hosted Verification

Revision **`wirenexus-staging-00003-zpp`** is ready with 100% traffic and the
candidate digest above. Read-back proves the runtime spec is identical after
normalizing only the image and `WIRENEXUS_BUILD_SHA`. Operator-only Invoker IAM
is unchanged. All three secret Accessor policies and private GCS bucket IAM are
unchanged; public access prevention and uniform bucket access remain enabled.
Registry IAM is restored to its pre-build bindings. Rollback target is preserved
`wirenexus-staging-00002-4ph`; original `00001-nkj` is not removed.

Hosted checks: anonymous health 403, authorized operator health 200;
editor/Engine/Output Viewer routes 200; server-source path 404; collaboration
POST without a Supabase bearer 401. Both application and hosted Supabase Auth
registration remain disabled. No DNS, production, public access, account, role,
workspace, secret version or GCS permission change was made.

Both fresh real account sessions were independently verified through hosted
Auth. The narrow two-user undo reproduction is **pending operator browser
actions**, not yet claimed passed. Pre-reproduction accepted head is sequence 8.
Shared saved version/revision remain 1; the original personal project remains
version/revision 4. No snapshot restore, checkpoint or unrelated acceptance
sequence was initiated during deployment.
