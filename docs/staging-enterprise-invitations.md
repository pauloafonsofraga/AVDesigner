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

## Acceptance Results

The normal Owner session was independently verified through hosted Auth before
the existing invitation API was called. It returned HTTP 200 with `delivered:
true`. The operator confirmed inbox receipt and accepted the invitation through
the normal application in the isolated secondary account session. Hosted SQL
independently confirms accepted status, the intended accepting identity and
Editor membership. No membership was fabricated through direct SQL.

The secondary session's identity was independently verified through Auth. Using
that session and the existing cloud-project client, listing and reading the
shared project succeeded, including all chunks and digest verification. This
was a non-mutating API read, not a new browser-rendering acceptance test.
Project version/revision remain 1, and no collaboration head exists.

The secondary identity RPC confirms no Platform Admin authority and its original
personal workspace. Organization-management access and access to the Owner's
personal workspace both reject with `42501`. Hosted checks confirm the Owner
remains Owner and Platform Admin, both personal Owner memberships remain, and
the existing personal project remains version/revision 4. No account, project,
plan or history version was created during invitation verification.

Final checks again returned anonymous HTTP 403, operator health HTTP 200 and
Supabase `disable_signup: true`. The same 19 focused tests passed again.
Live collaboration acceptance remains deliberately unstarted and requires a
separate instruction. Both users are enrolled for that next test.

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
