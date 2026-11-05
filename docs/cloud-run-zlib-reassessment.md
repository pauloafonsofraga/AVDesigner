# Cloud Run zlib security reassessment

Date: 2026-11-05, fresh scan completed 12:35 UTC. Branch: `engine-prototype`.

## Decision

**NO-GO under the existing zero-critical/high requirement.** No supported stable
fix or updated distroless base was available at this check. Do not deploy the
retained candidate. No finding was suppressed and no exception was accepted.

No application/base-image change or rebuild was justified by the available
updates. This reassessment changes documentation only; existing uncommitted
container, dependency, publishing-freeze and editor work remains excluded.

## Exact artifact and supported update checks

Retained application image:

`europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus@sha256:02d0c88ed5314469ded0d6c6d34bc743de319ad54ab4d453d8035e3550ccf736`

- Linux AMD64; UID/GID `65532:65532`; Node `v24.22.2`.
- Exported OCI index names that same retained image digest. Trivy's image/config
  identity is `sha256:bb32ea3d4cb05ad34dfcc9aa5de63b141177fb3328b88c2087c5022ab2bf2a7a`,
  matching the previous scan, not a newly built image.
- Current official `gcr.io/distroless/nodejs24-debian13:nonroot` still resolves
  to index `sha256:b8cec4b2f2126ff7bd034ec9ac207ffb3272667dfdc48376e3b035d3270549ba`,
  AMD64 manifest `sha256:1dfdd0613f3163fe913861ded2540584525b281d65541749726c7d3906382c06`.
- The retained runtime's own dpkg metadata confirms `zlib1g`
  `1:1.3.dfsg+really1.3.1-1+b1`, architecture AMD64.
- Fresh apt metadata in an isolated pinned Node/Trixie inspection container
  still offers that same package as its candidate. No stable security upgrade
  was offered. No package was installed into the application image.
- Debian lists Bookworm/Trixie affected and sid
  `1:1.3.dfsg+really1.3.2-4` fixed. An unstable package transplant or custom
  library replacement is not a supported stable update for this candidate.

Sources: [Debian zlib status](https://security-tracker.debian.org/tracker/source-package/zlib),
[distroless support](https://github.com/GoogleContainerTools/distroless/blob/main/SUPPORT_POLICY.md),
[upstream fixing commit](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148).

## Actual vulnerability and exposure

The affected code is zlib's gzip-file write/error-recovery path, not webpack.
After an underlying write failure, stale input pointers can cause a subsequent
gzip-file write to overwrite heap memory; older implementations require an
intervening `gzclearerr()`. The upstream fix resets the pending input state on
the failure path. The mismatched scanner title is not grounds to dismiss the
affected package. See [Debian's CVE entry](https://security-tracker.debian.org/tracker/CVE-2026-76844).

First-party server/API search found no `gzopen`, `gzdopen`, `gzwrite`,
`gzprintf` or `gzclearerr` usage. Repeated network-disabled native PNG tests on
the exact retained image passed Sharp encode, Canvas decode/encode and Sharp
decode, including the expected red RGBA pixel and dimensions. `/proc/self/maps`
after that workflow had no system `libz.so` mapping. Sharp reports bundled
zlib-ng `2.3.3`; Node reports `1.3.2.1-motley-285e94b`.

These observations narrow demonstrated exposure; they do not prove that every
optional native path, statically linked implementation or future dependency
cannot reach related code. Version strings alone do not establish patch status
for embedded copies. The shipped Debian package remains affected.

## Fresh exact-image scan

Trivy `0.76.1`, pinned scanner image
`sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c`.
Database updated `2026-11-05T07:00:54.926777429Z`, downloaded fresh at
`2026-11-05T12:35:35.036847588Z`. Scanned the exported exact image without an
ignore file or ignore-unfixed filtering.

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 1 |
| Medium | 37 |
| Low | 8 |

The only high remains `CVE-2026-76844` in the installed zlib1g package, status
`affected`, with no fixed version offered for this distribution. OS findings
account for 36 medium and 8 low; one additional medium is npm `uuid`.
Trivy emitted third-party SBOM warnings; actual runtime dpkg inspection
independently confirms the affected zlib version.

Raw report SHA-256:
`ca231affecb6707b0593b989af2749a6d553cc49f04cb1d999db5330352e6235`.
Protected evidence outside Git:
`~/Library/Application Support/WireNexus/Staging Security/20261105/zlib-reassessment/`
contains `trivy.json` and `trivy-db-metadata.json` (directory 0700, files 0600).

## Functional and security regression checks

The retained image passed the real-entrypoint smoke test in both load-balancer
and IAM-private modes, with network disabled and only loopback dependency
fixtures. Tests verified 701 asset hashes, nonroot execution, startup gates,
Sharp/Canvas, API/static routing, source-file exclusion, closed-registration
configuration and spoofed client-IP handling.

With publishing frozen, new upload/publish/community-write requests returned
403 before storage/authentication work. Existing viewer HTML/routes remained
available and the existing viewer API was not blocked by the freeze. This is
container fixture verification, not a new hosted publication-content test.

## Exception recommendation and next gate

A tightly time-boxed, operator-only, synthetic-data exception has a technically
arguable basis because no affected system-library call path was demonstrated.
Nevertheless, **do not waive the gate now**: the package is genuinely affected,
and the working localhost-to-private-staging test path avoids deploying this
known high vulnerability. A waiver requires separate explicit risk-owner
approval, including restricted users/data, upload limits, rollback and expiry;
this report grants none.

Wait for a supported Debian security package/distroless rebuild. Then pin it,
build from the latest approved committed source (including collaboration fixes),
repeat native/publishing/viewer tests and scan the exact new image. The retained
artifact predates the latest collaboration fixes and is not a substitute for
that future build, even if an exception were subsequently approved.

No hosted database, migration, IAM, secret, rollback revision, deployed service,
Vercel configuration, production resource or DNS record was changed. No remote
resource was created and no application image was pushed during this reassessment.
