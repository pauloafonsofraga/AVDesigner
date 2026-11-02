# Staging Enterprise invitation configuration

Date: 2026-11-02. Project: `wirenexus-staging`, region: `europe-west1`.
Supabase: `puyrylatmtcwlvyycplc`. Staging only; no production changes.

## Approved Configuration Rollout

The operator approved creating the invitation secret and a configuration-only
revision of the existing private service. Revision
`wirenexus-staging-00002-4ph` is ready and receives 100% of staging traffic.
Rollback revision `wirenexus-staging-00001-nkj` remains available.

The image is unchanged:

```text
europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus@sha256:fdba185aa262f916bb705ae929eae68c61eaf05afba37ec4aa55b1f1e0919598
```

Only these environment entries were added:

| Variable | Configuration |
| --- | --- |
| `WIRENEXUS_INVITE_EMAIL_API_KEY` | Secret reference `wirenexus-staging-resend-invites:1` |
| `WIRENEXUS_INVITE_FROM` | `WireNexus Staging <invitations@mail.videocore.net>` |

The secret has regional replication in `europe-west1`, exactly one enabled
version, and a direct `roles/secretmanager.secretAccessor` binding only for
`wirenexus-runtime@wirenexus-staging.iam.gserviceaccount.com`.
Its value was transferred directly from the approved macOS Keychain item in
memory; it was not printed, committed or written to a plaintext credential file.

## Verified Security And Runtime

- Service Invoker IAM checking remains enabled. The service-level Invoker
  binding remains only the approved business operator; no anonymous or Gmail
  Cloud Run access was added.
- Anonymous health request: HTTP 403. IAM-authenticated operator health: HTTP 200.
- Existing runtime identity, environment entries, image, ingress and resource
  settings were compared before and after the rollout and remain unchanged.
- CPU 1, memory 1 GiB, port 8080, Gen2, concurrency 8, timeout 300 seconds,
  min instances 0 and max instances 3 remain unchanged.
- Application registration remains disabled. Hosted Supabase Auth settings
  independently confirm `disable_signup: true`.
- No DNS, SMTP, database, migration, public access or production change was made.
- No new application image was built or pushed. Existing security findings and
  the restricted pilot disposition in `final-security-disposition.md` still apply;
  this configuration change does not remediate those findings.

Focused local validation passed **19/19**:

```sh
node --test test/organizationInviteApi.test.mjs test/cloudRunHosting.test.mjs test/cloudRunPrivateIam.test.mjs test/stagingInfrastructureConfig.test.mjs
```

## Remaining Acceptance

Invitation delivery, acceptance as Editor, and authenticated read-only opening
of the existing shared project are pending normal application sign-in in the
isolated browser sessions. No invitation or membership was fabricated through
direct SQL. The existing workspace, accounts and project are reused; no live
collaboration test has begun.

An Editor's project opening is a non-mutating verification, not a downgrade to
the Viewer role. Do not save, activate collaboration or change project history
during this setup check.

## Rollback

If invitation behavior requires rollback, return staging traffic to the
preserved revision using the approved operator identity:

```sh
gcloud run services update-traffic wirenexus-staging \
  --project=wirenexus-staging --region=europe-west1 \
  --account=paulo@videocore.net \
  --to-revisions=wirenexus-staging-00001-nkj=100
```

This restores the prior configuration without deleting project data, invitations,
secret versions or revisions. Recheck private IAM and health afterward. Do not
delete or disable the secret while a revision using it receives traffic.
