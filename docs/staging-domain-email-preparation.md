# Phase 6.6F: staging domain and email preparation

Date: 2026-10-29. Branch: `engine-prototype`; reviewed baseline
`cd20a1c1307378ed5fbe7e43343b1de6fd8083f1`.
**Preparation only.** No DNS, hosting, credentials, Supabase settings, users or
production services were changed. No application was deployed. Only documentation
is changed by this phase.

## Approved choices and remaining decisions

| Item | Approved value / status |
| --- | --- |
| Staging editor origin | `https://staging.videocore.net` |
| Reserved production origin | `https://app.videocore.net`; do not create/configure it in this phase |
| Sending provider/domain | Resend, `mail.videocore.net`, sending only |
| Supabase staging | `puyrylatmtcwlvyycplc`, API `https://puyrylatmtcwlvyycplc.supabase.co` |
| Hosting | Prepare Google Cloud hosting; project ID, billing, region and resource identities not supplied/verified |
| Sender addresses | Exact local parts, display names and reply handling need owner approval; do not invent a mailbox |
| Viewer origin | Proposed same staging origin with existing opaque sandbox isolation; approve explicitly before configuring |

Prior Phase 6.6E settings are [recorded separately](staging-auth-realtime-configuration.md):
signup OFF, email/confirmation/TOTP ON, private-only Realtime, private schema not
exposed. They were not modified or re-audited remotely in this preparation phase.
Site URL remains the previously verified localhost value until a separately
approved configuration change; approval of a domain choice is not deployment or
DNS-change approval.

## Existing integration and Google Cloud feasibility

`vercel.json` routes `/account-config.json` to `/api/account-config` and `/v/:id`
to `/viewer.html?id=:id`. Nine handlers exist in `api/`: account-config, build-info,
health, upload, publish, project, organization-invite, collaboration-operations
and collaboration-live. They use Node/Vercel request/response conventions
(`req.body`, `req.query`, `res.status().json()/end()`). There is no Cloud Run
HTTP entry point, container definition, start script or Google Cloud deployment
configuration. Copying the repository to a bucket is not a working replacement
for these APIs. `vercel.json` is not interpreted by Cloud Run.

Recommended proposed hosting: a dedicated staging Google Cloud project, Cloud Run
Node service behind a global external Application Load Balancer/serverless NEG,
Google-managed TLS for `staging.videocore.net`, and an allocated static frontend
IP. Retain current Supabase services; Realtime connections go directly from the
browser to Supabase, not through a new application WebSocket relay. This is a
proposal, not evidence that any Google resource already exists.

Before deployment, separately approve a narrow hosting implementation:

- Add an HTTP adapter that reuses existing handlers and both rewrites. Listen on
  `0.0.0.0:$PORT`, with correct query/body parsing, method checks, error handling
  and existing API size limits. Do not send API errors to the SPA fallback.
- Serve only an audited runtime asset allowlist with correct module, WASM, worker,
  image and PDF MIME types. Do not expose the repository root, `.git`, secrets,
  migrations, tests, backups or Masters. Produce the runtime artifact from the
  approved committed tree, excluding unrelated local imports/artwork.
- Preserve `no-store` on account/API responses, viewer password checks and iframe
  sandbox **without** `allow-same-origin`. Do not cache private responses in CDN.
- Review source-IP throttling: `src/server/publishing.js` uses a Vercel-specific
  forwarded header on Vercel and `req.socket.remoteAddress` otherwise. Behind
  Google proxies the socket address may identify a proxy, not the user. Define
  and test trusted-hop/IP normalization before hosting; never trust an arbitrary
  client-supplied `X-Forwarded-For`, set fake Vercel variables or remove throttling.
- Keep a dedicated **private Vercel Blob store** for current publishing APIs
  (`@vercel/blob`, token signing, upload completion, private reads). Google hosting
  does not replace that dependency. Verify cross-host client upload/callback
  behavior explicitly; moving storage to GCS is separate unapproved work.
- Keep Cloud Projects' existing Supabase versioning/permissions and command APIs.
  Test modern TLS support; the Supabase November 10 cipher deprecation is relevant
  to runtime/browser selection, not a reason to weaken TLS.
- Use a dedicated runtime service account, resource-scoped Secret Manager access,
  separate deploy/build identities and no downloaded long-lived service-account
  key. Pin secret versions. Restrict external Cloud Run ingress to the load
  balancer; explicitly review invoker policy. Network ingress is not Supabase user
  authentication. Disable direct-origin bypass and test host handling.

Google recommends the load-balancer route; direct Cloud Run domain mapping remains
Preview/not recommended for production. Project/billing/network/certificate costs
need owner approval. No GCP account inventory, IAM grant or billable resource
creation was performed here. See official [custom-domain guidance](https://docs.cloud.google.com/run/docs/mapping-custom-domains),
[container contract](https://docs.cloud.google.com/run/docs/container-contract),
[ingress controls](https://docs.cloud.google.com/run/docs/securing/ingress),
and [Secret Manager integration](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

## DNS inventory and preservation boundary

Read-only public DNS observations on 2026-10-29 (not a complete zone export):

| Name/type | Observed value |
| --- | --- |
| Apex NS | `nse1` through `nse4.squarespacedns.com` |
| Apex A | `198.185.159.144`, `198.185.159.145`, `198.49.23.144`, `198.49.23.145` |
| `www` CNAME | `ext-sq.squarespace.com` |
| Apex MX | Priority 10, `smtp.google.com` |
| Apex TXT | Google site-verification record present; SPF `v=spf1 -all` |
| `_dmarc.videocore.net` TXT | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` |
| Apex AAAA/CAA | No answer in queried resolver snapshot |
| `staging`, `app` A/AAAA/CNAME | No answer in queried resolver snapshot |
| `mail` A/CNAME/MX/TXT; `_dmarc.mail` TXT | No answer in queried resolver snapshot |

Direct authoritative queries to `nse1.squarespacedns.com` confirmed NXDOMAIN for
`staging.videocore.net` A and `mail.videocore.net` TXT. Absence in these queries
does not prove no other names/types, verification records or services exist.
Before edits, the DNS operator must export the full zone, including existing
Google Workspace DKIM selectors, Squarespace verification and any wildcard/CAA
records. Record current TTLs and exact rollback values. Do not guess DKIM selectors.

Keep apex NS/A/MX/TXT, `www`, Google Workspace DKIM, verification and root DMARC
unchanged. Do not transfer nameservers, enable a whole-domain DNS wizard, replace
the Squarespace zone with Cloud DNS, or add a second root SPF record. The observed
root SPF `-all` merits a separate mail-owner review, but fixing it is **not** part
of staging setup. Preserve it and Google mail delivery exactly as found.

### Proposed DNS change sheet (not applied)

| Purpose | Name/type | Value source / gate |
| --- | --- | --- |
| Staging HTTPS frontend | `staging.videocore.net` A | Actual reserved Google frontend IPv4, only after allocation and approval; value currently unknown |
| IPv6 | `staging.videocore.net` AAAA | Omit unless an IPv6 frontend is actually provisioned and verified |
| Google certificate verification | Exact owner/type supplied by Google, if required | Copy generated value; do not fabricate CNAME/TXT or modify root CAA automatically |
| Resend DKIM | Exact selector under `mail.videocore.net`, exact type supplied by Resend | Copy the domain's Records tab verbatim; selector/key currently unknown |
| Resend bounce/SPF | Exact return-path owner/type under approved sending namespace | Copy Records tab values/priority; could be CNAME or MX/TXT, depending on the domain setup |
| Production `app` | None | Reserved only, no DNS change |

For Squarespace, translate FQDNs to relative host labels only as its form requires;
avoid accidentally creating `.videocore.net.videocore.net`. CNAME owners cannot
coexist with other records. Stop on collisions; do not delete existing records to
make a wizard succeed. Resend may now generate sending CNAMEs instead of MX/TXT;
do not use a copied AWS region endpoint or assumed `send` value. Sending return-path
records are different from inbound mailbox MX. **Do not enable Resend receiving**
or replace Google MX. [Resend's record-conflict guidance](https://resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records)
explains this distinction.

Inherited DMARC rejects unaligned subdomain mail. Require delivered DKIM
`d=mail.videocore.net` to align exactly with the approved From domain; strict SPF
alignment may not match a nested return path. Verification and later message-header
checks must establish aligned DKIM/DMARC pass. Do not relax root DMARC or add a
weaker child policy as a workaround.

## Supabase Auth and Resend configuration sheet

Apply only after separate configuration approval, to staging project only:

| Setting | Prepared value |
| --- | --- |
| Auth Site URL | `https://staging.videocore.net` |
| Redirect allowlist | Exact `https://staging.videocore.net/`; add bare-origin variant only if an actual caller needs that exact form |
| Signup / anonymous | OFF / OFF; database registration policy false and app flag false |
| Email / confirmation / TOTP | Remain ON; private-only Realtime remains enabled |
| SMTP host | `smtp.resend.com` |
| SMTP port/security | Prefer `465`, implicit TLS; provider-supported alternative `587` requires STARTTLS |
| SMTP username | `resend` |
| SMTP password | Dedicated staging Resend sending-access API key, entered securely, restricted to `mail.videocore.net` |
| From / sender name | Owner-approved address at `mail.videocore.net` / owner-approved staging display name; still required |
| Templates | Code-based Magic link or OTP, Reset password, Confirm sign up from [6.6E](staging-auth-realtime-configuration.md#missing-inputs-and-prepared-mail-configuration), using `{{ .Token }}` |

No production, broad wildcard, temporary `run.app` or preview redirect is needed.
Current UI uses `verifyOtp` code entry and `detectSessionInUrl:false`; no
`/auth/callback` route exists to authorize. An organization invitation points to
`https://staging.videocore.net/#organization-invite=...`, not an Auth redirect;
do not add token-bearing fragments to the allowlist. Keep confirmation code
template ready while signup remains disabled. Disable click/open tracking for
transactional Auth/invitation mail. Choose a working Reply-To policy separately;
verifying a sending domain does not create an inbound mailbox.

Supabase SMTP and organization invitations are separate integrations:

- Supabase Auth stores its SMTP key in its own Auth configuration, not frontend
  environment variables. Custom SMTP unlocks template editing; retain rate limits.
- `src/server/organizationEmail.js` already POSTs to `https://api.resend.com/emails`
  with a 10-second timeout and invitation-ID idempotency key. Keep a second scoped
  key in `WIRENEXUS_INVITE_EMAIL_API_KEY`, an approved sender in
  `WIRENEXUS_INVITE_FROM`, and `WIRENEXUS_EDITOR_ORIGIN=https://staging.videocore.net`.
  Existing server authorization, seat quota and delivery-state checks remain.
- Scope both keys to sending only for the verified domain; use separate named
  staging credentials for audit/rotation. Do not configure production sending.
  Future use of this same approved mail domain by production would share sending
  reputation; separate keys do not provide reputation isolation.

Provider references: [Resend SMTP](https://resend.com/docs/send-with-smtp),
[verified domains](https://resend.com/docs/dashboard/domains/introduction),
[sending-access keys](https://resend.com/changelog/new-api-key-permissions),
[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Exact setup sequence and approval gates

1. **Owner prerequisites:** identify the Google Cloud organization/project ID,
   approved billing account/budget, region, DNS operator, Resend account/team and
   sender identities. Grant only required staging access through secure workflows;
   no secrets in chat. Export DNS, record old Auth configuration securely, and
   verify no staging resources are shared with production.
2. **Approve implementation separately:** implement/test the Cloud Run adapter and
   packaging/security gaps above. Preserve current API behavior. Confirm a dedicated
   private Blob store is available or explicitly approve a separate storage-port
   project. Do not silently migrate storage or deploy the current Vercel tree as-is.
3. **Approve infrastructure separately:** enable only required staging APIs (Run,
   Artifact Registry, build service if selected, Secret Manager, Compute/load
   balancing and certificate services as selected). Create runtime/build identities,
   artifact repository, load balancer frontend/static IP and certificate resources.
   Record their actual generated identities/endpoints and costs; none are known yet.
4. **Approve Resend domain setup separately:** add `mail.videocore.net` as a sending
   domain, select owner-approved region, leave receiving/tracking disabled, retrieve
   exact generated records. Add this to the proposed change sheet alongside Google's
   real DNS/certificate records. No root website or mailbox changes.
5. **Approve DNS sheet:** operator applies only those exact records at the existing
   authoritative Squarespace DNS. Verify authoritative answers, propagation,
   Resend verified status and TLS provisioning. Stop if existing website/mail
   records differ from the export. Do not edit `app.videocore.net`.
6. **Approve secure configuration:** create domain-scoped staging send-only keys;
   operator enters SMTP credential directly in staging Supabase. Configure Auth
   URL/allowlist and code templates above, leaving signup closed. Configure runtime
   Secret Manager versions for the staging elevated Supabase key, invitation key
   and private Blob token. Public config uses only the matching staging URL/key.
7. **Approve deployment separately:** deploy the approved immutable artifact to
   Cloud Run, complete NEG/backend mapping, verify managed TLS and route only the
   staging hostname. Set `WIRENEXUS_REGISTRATION_ENABLED=false`, explicit
   `WIRENEXUS_EDITOR_ORIGIN` and approved `PUBLIC_VIEWER_ORIGIN` (proposed both
   `https://staging.videocore.net`). Keep secrets server-only; no production fallback.
8. **Approve validation/provisioning separately:** only then provision controlled
   test users/Enterprise workspace and run real email/collaboration acceptance.
   This phase stops before step 1 creates/configures any service.

## Validation and recovery checklist

Before any later change, refresh the full DNS export and compare root/`www`, MX,
SPF/DKIM/DMARC, verification and CAA records after every approved change. Check DNS
using the authoritative servers and independent recursive resolvers, and verify
Squarespace HTTPS plus Google Workspace sending/receiving with the mail owner.

After later deployment approval: validate staging TLS/hostname, static assets,
both rewrites, API errors/method/body limits, account-config no-store and absence
of secrets, viewer password/logo/sandbox behavior, private Blob upload completion,
trusted-proxy throttling and no direct-origin bypass. Confirm `.avd` local save/open
and all existing API tests. Verify signup remains OFF through read-only Auth settings
and the database registration gate; do not temporarily enable it for testing.

After later test-user approval: send one controlled Auth OTP/recovery email and
one organization invitation. Inspect headers for aligned DKIM and DMARC pass,
correct From, no tracking and staging-only links. Verify code expiry/reuse,
recovery, MFA aal2, authorized invitation acceptance, denial/revocation and quotas.
Then execute the existing [staging runbook](supabase-staging.md) for real two-client
operations, reconnects, conflicts and private-channel isolation. No such runtime
acceptance was performed in this preparation phase.

Recovery is staged: revert Cloud Run traffic to a validated staging revision,
restore exact previous staging Auth configuration if necessary, revoke affected
staging mail keys, and remove/restore only records from the approved change sheet.
Never restore an entire old zone over unrelated newer changes, delete a shared
Resend domain or reset the database. No migration replay/rollback is required for
domain/email configuration. Keep signup closed and Realtime private throughout.

Local review validation: `node --test test/organizationInviteApi.test.mjs` passed
3/3 (local simulated database/mail, no real send). Historical migration checksums,
protected-file hashes and documentation whitespace are checked before committing.
This document is not deployment or deliverability acceptance.
