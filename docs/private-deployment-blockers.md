# Phase 6.6L: private deployment blockers

Date: 2026-10-30. Branch `engine-prototype`; starting commit
`8af4342b67c01a861b3cead9612d866f4361007e`. Google project `wirenexus-staging`,
Supabase staging `puyrylatmtcwlvyycplc`. No deployment, image push, public-access
grant, DNS, production, Supabase schema or Auth configuration change is authorized
or performed by this pass.

## Publishable key: resolved

The operator approved access to the exact macOS Keychain item
`WireNexus-Staging-Publishable`. The value was captured in process memory only,
validated as a publishable/anon credential, and accepted by the intended staging
project's read-only Auth settings endpoint. `disable_signup` remains true.

The existing `wirenexus-staging-supabase-publishable` Secret Manager container now
has enabled version **1**. A read-back matched using a constant-time byte
comparison. `infra/staging/resources.json` pins this numeric version. No key was
printed, placed in command arguments, written to a file, injected into a build,
or committed. The server secret remains version 1 and was not changed. Existing
secret-scoped runtime Accessor permissions remain sufficient; no new IAM grant or
operator impersonation was introduced. Hosted runtime secret access will be
exercised when the approved service is actually deployed.

## Direct private Cloud Run: implemented

Set **`WIRENEXUS_CLOUD_RUN_ACCESS=iam-private`** only on the future private staging
service. The existing default is still `load-balancer`; no existing deployment
changes mode implicitly. Unknown modes fail startup.

Private mode requires `K_SERVICE`, one explicit HTTPS `*.run.app` origin used by
both `WIRENEXUS_EDITOR_ORIGIN` and `PUBLIC_VIEWER_ORIGIN`, no nondefault port,
complete existing staging credentials, and registration disabled. It rejects
`WIRENEXUS_TRUST_GOOGLE_LB=true` rather than reusing that trust flag.

The **outer authentication boundary is Google's Cloud Run Invoker IAM check**.
The application does not claim to verify a caller's Google identity from a
header. Deployment must retain the Invoker IAM check, no unauthenticated access,
and no `allUsers`/`allAuthenticatedUsers` bindings. Do not disable IAM and assume
this environment setting replaces it. No service exists yet, so hosted IAM
denial/acceptance cannot be certified by local HTTP tests.

In private mode all publishing/authentication/collaboration source throttles use
a single synthetic limiter identity (`127.0.0.1`), not an asserted client IP.
Caller-controlled forwarding, Vercel, client-IP and authorization headers cannot
split this bucket. The existing durable Supabase throttle RPCs and limits remain
active, shared across instances and fail closed. This is deliberately more
conservative than per-IP limits: authorized developers share capacity and may
receive 429s sooner. Per-user/workspace authorization, quotas and ownership remain
unchanged. No client-controlled identity or process-local limiter replaces them.

The load-balancer mode still requires its trusted overwritten IP header and the
existing restricted-ingress contract. Missing or invalid IPs still reject. Vercel
uses the unchanged existing publishing path. Local fixture mode is not a
production workaround.

For future direct HTTPS API tests, use `X-Serverless-Authorization` for Google's
IAM ID token and preserve `Authorization` for the Supabase session. A Google
token or header alone does not authorize WireNexus publication actions. The
[Google contract](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
supports these separate headers. Never put either token into client assets or
URLs. Keep the existing service identity, private bucket and numeric secret
references; the runtime needs no new registry, deployment or project-wide role.

## Dependency findings: partially remediated

The application keeps the currently installed **Blob 2.8.0** API, now exactly
pinned instead of `latest`. A Blob-scoped override upgrades Undici **6.28.1 ->
6.29.1**, with matching lockfile integrity. This is a compatible 6.x update and
fixes its five underlying TLS/content-encoding/EventSource/WebSocket advisories.
An Agent dispatch regression verifies preservation of a function-valued TLS
validation callback; loopback requests and Blob SDK exports are tested.

Fresh `npm audit --json`: **six package findings remain: four high, two moderate,
zero critical**, down from seven entries/five high/two moderate. No advisory is
suppressed and no automatic downgrade or forced audit fix is used.

| Remaining entries | Why not force an override | Required next step |
| --- | --- | --- |
| Blob, OIDC, CLI config, Zod (four high, inherited path) | Installed CLI config's actual `dist/index.js` embeds Zod `major:4,minor:1,patch:11` with no external `require('zod')`. A dependency-only Zod override would not repair these embedded bytes. The reviewed current CLI-config 0.3.5 metadata still pins Zod 4.1.11. | Patched upstream embedded artifact, or separately reviewed rebuild/fork with patched Zod >=4.6.6 and full Vercel credential/config regression. No waiver is granted here. |
| ExcelJS, UUID (two moderate) | The application imports `exceljs/dist/exceljs.min.js`, an upstream prebundle containing its UUID code. Overriding the separate Node dependency does not rebuild that browser artifact. Observed conditional-formatting use is UUID v4, not the vulnerable buffered v3/v5/v6 paths; this is context, not a blanket security waiver. | Patched upstream browser bundle, or an explicitly reviewed source-build change with XLSX/graphics/export browser acceptance; alternatively an approved narrow reachability disposition. |

References: [Undici fix](https://github.com/advisories/GHSA-2m5v-pch6-74hx),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Validation and remaining gates

Focused tests cover private-mode configuration, spoofed header immunity, shared
durable throttle rejection, health/config routes, secret filtering, Supabase
authentication and ownership denial, plus unchanged load-balancer/GCS security
and the patched dependency behavior. `scripts/cloud-run-image-smoke.mjs` now
exercises the real entrypoint and runtime assets in **both** access modes with
loopback dependency fixtures; it never uses actual credentials for startup tests.

Final evidence:

- Fresh isolated `npm ci --ignore-scripts` and `node --test test/*.test.mjs`:
  **2,296 passed**, zero failures/skips/cancellations. All **16** static
  `scripts/*-validation.mjs` validators passed. Focused security/dependency suite:
  **38 passed**; Cable Schedule XLSX bundle freshness check passed.
- Clean allowlisted production context, `npm ci --omit=dev --ignore-scripts`, and
  real startup command: PASS for both modes, 688 asset hashes, non-root UID 501,
  local macOS ARM64. This is not new Linux-container or hosted Google IAM proof.
- The output-viewer validator initially rejected its source fingerprint because
  package/lockfile inputs changed. The existing generator refreshed **only
  `sourceHash`**; JavaScript, CSS, icons, module list and bundle hash are identical.
  No renderer or artwork was changed to make a validator pass.
- Hosted read-only metadata independently confirms publishable version 1 enabled
  and the existing runtime-only Secret Accessor binding. No Cloud Run service
  exists in `europe-west1`; no new IAM/impersonation grant was needed.
- All **245** protected/unrelated file hashes match their established baseline.
  Original uncommitted Device JSON Import changes, artwork, Masters and backups
  remain excluded from the scoped commit.

Readiness is **conditional / not deployment-approved**:

1. Resolve or explicitly disposition the remaining four high/two moderate package
   findings, including embedded artifacts. Audit count alone is not sufficient.
2. Build a **new** Linux AMD64 image from the eventual approved commit and scan
   its OS/base layers. The Phase K image does not include this implementation or
   dependency patch and must not be deployed as if it did.
3. Resolve the actual service origin, approve private deployment, keep IAM checks
   enabled, verify Invoker policy (including inherited access), and test actual
   unauthorized denial before browser acceptance.
4. Configure exact-origin GCS CORS for that approved run.app origin and verify
   browser upload/host/Auth redirect behavior. Existing CORS is still only
   `https://staging.videocore.net`; it was not silently broadened here. No DNS or
   existing Supabase redirect setting was changed.
5. Complete real hosted authentication, private Secret Manager/GCS and application
   acceptance after separate approval. The Resource Manager API diagnostic remains
   pending; no extra API or runtime permissions were added.

For an approved future deployment: retain the Phase K 1 vCPU/1 GiB, min 0/max 3,
concurrency 8, port 8080, request-based billing and existing runtime account.
Set the new explicit access mode, remove LB trust, use the verified single
run.app origin, and pin both Supabase secrets to version 1. No custom domain,
public Invoker binding, production cutover or deployment is performed here.
