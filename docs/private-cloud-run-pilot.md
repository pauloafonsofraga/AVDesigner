# Phase 6.6O: first private staging pilot

Deployment verified on 2026-10-30. This is an operator-only pilot, not a public
release. The restrictions and expiry in [the security disposition](final-security-disposition.md)
continue to apply, including reassessment by 2026-11-06 and synthetic data only.

## Deployed service

- Project `wirenexus-staging`, region `europe-west1`, service `wirenexus-staging`.
- URL: https://wirenexus-staging-837085353595.europe-west1.run.app
- Ready revision: `wirenexus-staging-00001-nkj`, receiving 100% of traffic.
- Image: `europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus@sha256:fdba185aa262f916bb705ae929eae68c61eaf05afba37ec4aa55b1f1e0919598`.
- Image source: `54990e8196ffc250f370b8692d6ca23ef27a872b`; no rebuild or runtime
  code changes were made for this deployment.
- Existing runtime identity: `wirenexus-runtime@wirenexus-staging.iam.gserviceaccount.com`.
- Gen2, port 8080, 1 CPU, 1 GiB, concurrency 8, timeout 300 seconds,
  minimum 0 instances, service/revision maximum 3, request-based CPU allocation.
- Existing non-root image entrypoint retained; no command overrides, extra
  containers, volumes, devices, or privileged execution were introduced.

IAM Invoker checking is enabled. The service-level Invoker policy contains only
`user:paulo@videocore.net`; no `allUsers` or `allAuthenticatedUsers` grant exists.
Inherited invoke-capable identities inspected were the existing operator Owner
and Google-managed Cloud Run service agent, not additional human operators.
Ingress permits direct Google-managed HTTPS requests, but IAM authorization is
mandatory. Network reachability is not anonymous application access.

The native URL does not provide an interactive Google login page: an authorized
Google ID token (or appropriately configured authenticated operator proxy) is
required. Google IAM and Supabase application authentication remain separate;
the checks used `X-Serverless-Authorization` for IAM and `Authorization` for the
Supabase bearer. No IAP or public viewer access was enabled.

## Configuration and storage

Both editor and viewer origins use the actual native service URL above.
`WIRENEXUS_CLOUD_RUN_ACCESS=iam-private`, publishing storage is `gcs`, and
Supabase targets only `https://puyrylatmtcwlvyycplc.supabase.co`.
Registration remains disabled in application configuration and Supabase Auth.

Secret references, not values, are pinned to version `1`:

- `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`: `wirenexus-staging-supabase-server`.
- `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`: `wirenexus-staging-supabase-publishable`.

The runtime identity retains only its existing scoped secret/storage permissions.
Bucket `wirenexus-staging-publications-837085353595` retains enforced public access
prevention and uniform bucket-level access. The native URL was added to the
existing PUT-only CORS rule alongside its existing staging-domain origin; all
headers and the 300-second cache limit were preserved. IAM bindings were unchanged.
No object was created by the CORS checks; untrusted origins receive no allow-origin.

`infra/staging/resources.json` and `infra/staging/publishing-cors.json` are historical
Phase J preparation fixtures, not the effective live deployment configuration.
The [deployment evidence](security/phase-66o-deployment-evidence.json) records the
effective Phase O settings and test results without secret payloads.

## Verification

- Anonymous application/health requests: 403; invalid Google token: 401.
- Authorized health, build metadata, account configuration, editor, Output Viewer,
  viewer and viewer-shell routes: 200. GCS selected; Blob credentials absent.
- All 688 shipped runtime asset sizes and SHA-256 hashes match the pinned source.
- Secret/source/protected-file paths and unknown API routes: 404.
- Missing or invalid Supabase publishing bearer: 401.
- Existing operator password authentication succeeded at AAL1. A valid bearer
  reached post-authentication validation (intentional no-op: 400); finalizing an
  unowned/nonexistent publication was denied (403). Temporary session signed out.
- No project/publication/user was created and no invitation was sent. Auth/session
  records and normal request-throttle counters are not claimed to be write-free.
- Reviewed 713 revision log entries: one listening marker, zero startup failures,
  zero ERROR-or-higher entries in that observed window. No secrets, session tokens,
  request bodies or signed URLs were printed.

This is HTTP/runtime validation, not full interactive browser acceptance. AAL2,
browser cloud Save/Open, real publication uploads and multi-user collaboration
were not retested here. Known image advisories remain as documented in Phase N;
this deployment is not evidence that they have been patched.

Local focused checks passed: `node --test test/cloudRunHosting.test.mjs
test/cloudRunPrivateIam.test.mjs test/stagingInfrastructureConfig.test.mjs`
(16 passed, zero failures). The historical staging fixture tests do not replace
the live IAM/CORS checks above. All 245 protected baseline file hashes matched
after accounting in memory for previously committed hosting changes; unrelated
Device JSON Import edits, artwork, Masters and backups remain unstaged and intact.

## Costs and operational boundaries

At published Tier 1 request-based rates, 1 CPU plus 1 GiB costs approximately
$0.0954 per aggregate active instance-hour, plus $0.40 per million requests,
before applicable shared free allowances. Ten active instance-hours plus 100,000
requests is approximately $0.994 before allowances and extras. Minimum zero
avoids reserved idle compute; startup, logging, network and existing Registry,
Storage and Secret Manager usage can still cost money. Maximum three instances
is not a spending cap. See https://cloud.google.com/run/pricing.

Created one Cloud Run service/revision and its logs; used existing registry,
bucket, service account and secret versions. No load balancer, reserved IP,
custom domain, DNS record, new secret version or container image was created.
Vercel, production, Squarespace DNS, Google Workspace email, Supabase policies,
MFA and invitation settings were not changed. No temporary impersonation grant
was used or retained.

For rollback, stop the pilot by deleting only this staging Cloud Run service
after operator approval (there is no earlier service revision to roll back to).
Do not delete the shared staging bucket, secrets, registry or Supabase data.
Remove only the added native-origin CORS entry if retiring the pilot; preserve
the historical staging origin. Do not make the service public to troubleshoot
access failures. Revalidate the security disposition before extending access.
