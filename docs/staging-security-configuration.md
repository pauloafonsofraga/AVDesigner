# Phase 6.6C: staging security configuration check

Date: 2026-10-29. Branch: `engine-prototype`. Target exclusively
`puyrylatmtcwlvyycplc`, **WireNexus Staging**, VideoCore.

## Signup closed and independently verified

The earlier interrupted interaction switched the signup control OFF but did not
save it. On continuation, the authenticated Chrome Beta dashboard already showed
the saved switch OFF with Save changes disabled, so no redundant toggle/save was
performed. A separate read-only GET to this project's `/auth/v1/settings` returned
HTTP 200 and `disable_signup=true`. This verifies the effective Auth setting,
not just an unsaved UI preview. No signup request or test email was sent.

The same API response confirms email authentication enabled, anonymous users
disabled and `mailer_autoconfirm=false` (confirmation required). Dashboard
observations agree. Its main-branch PRODUCTION badge belongs to this explicitly
designated staging project; no other project was opened or changed for this check.

## Readiness

| Area | Observed state | Decision |
| --- | --- | --- |
| Public signup | OFF; API `disable_signup=true` | Ready at the Supabase Auth layer |
| Anonymous sign-in | OFF | Ready |
| Manual identity linking | OFF | Ready; left unchanged |
| Email authentication | Enabled; email confirmation ON | Provider configuration ready; delivery not tested |
| TOTP app authenticator | Enabled; maximum 10 factors/user | Provider capability ready; no enrollment/challenge tested |
| AAL1 duration protection | ON; verification required within 15 minutes for enrolled-factor users | Ready; left unchanged |
| SMS MFA | Disabled; provider UI restricts it to paid Supabase plans | Not required by the WireNexus TOTP design; no upgrade proposed |
| Auth Site URL | `http://localhost:3000` | Needs the approved staging editor HTTPS origin |
| Redirect allowlist | Empty | Review/add only approved exact staging callback URLs as needed; no production wildcards |
| Custom SMTP | OFF | Needs controlled test SMTP configuration and delivery verification |
| Sign-in template | Default link-based preview; subject Your sign-in link; Sign in uses `{{ .ConfirmationURL }}` | Needs code-entry-compatible `{{ .Token }}` template, not link-only login |
| Template editing | Dashboard requires custom SMTP before subject/body edits | SMTP setup precedes template changes; recovery/confirmation templates also need review |
| Realtime service | Enabled | Service available, not proof of secure collaboration |
| Realtime public channels | Allow public access ON | **Not ready for private-only Broadcast**; disable only with separate approval |
| Realtime authorization | No WireNexus policies/migrations installed | Await the separately approved migration chain; do not add broad permissive policies |
| Backend/deployment secrets | Not available in this session; no staging deployment binding verified | Needs secure staging-only configuration; never paste secrets in chat |

Realtime settings also show authorization pool 2, Postgres Changes pool 2, maximum
200 concurrent clients, 100 events/second, 20 presence events/second and 256 KB
payloads. These are observed service settings, not load-test acceptance or
application quotas. No channel was joined, notification broadcast or collaboration
test started. Do not enable Postgres Changes for application tables for this design.

Private Broadcast requires both public-channel access OFF and the specific
own-inbox/restrictive policies provided by migration 8. The request authorizes
inspection of this setting, not changing it here, so it remains ON. No managed
Realtime ownership, table grants, RLS or policies were modified.

## Credentials and account prerequisites

An existing active browser-safe publishable key was available through the secure
Supabase connection and used only for GET Auth settings. Its value was not printed
or committed. No service-role/backend secret, database password, SMTP password or
browser stored password was revealed or copied by the agent. No user clipboard
was read. No secrets were written to source/config files or queried from Vault.

Presence-only checks found none of these variables in the execution environment:

- `WIRENEXUS_SUPABASE_URL`
- `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`
- `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` (server-only elevated key)
- `WIRENEXUS_REGISTRATION_ENABLED` (must remain absent/false)
- `BLOB_READ_WRITE_TOKEN` (dedicated private staging Blob)
- `PUBLIC_VIEWER_ORIGIN` and `WIRENEXUS_EDITOR_ORIGIN` (explicit staging origins)
- `WIRENEXUS_INVITE_EMAIL_API_KEY` and `WIRENEXUS_INVITE_FROM` (separate Resend invitation delivery)

Absence here does not prove absence in an external secret manager. No dedicated
staging Vercel deployment/project was identified or inspected, and existing
production/development deployments were left alone. A verified staging deployment
binding and secure secret-manager access are needed before credentials can be
called ready. Supabase SMTP and the Resend organization-invitation service are
separate integrations; configuring one does not configure the other.

Read-only database checks still show zero Auth users and zero enrolled MFA factors.
There is no installed application registration-policy table and the migration list
is still empty. Therefore Platform Admin authorization, its database MFA gate,
personal/Enterprise workspaces, project storage and collaboration RPCs are not yet
installed. Enabled TOTP alone does not provision an administrator or grant access.
The future application/UI registration gates must remain closed alongside Auth.

## Scope and remaining actions

This completes the requested security configuration inspection, not staging
deployment/readiness approval. Remaining work requires separate authorization:
private-only Realtime, SMTP/templates, staging URLs/redirects, password-policy review,
isolated backend/Blob/Resend credentials, then the previously reviewed migrations
and later test-user/Admin/Enterprise provisioning. Actual delivery, enrollment,
RLS, concurrency and live collaboration validation remain deferred.

No database migration, schema/RLS change, user provisioning, app deployment,
collaboration test, billing/plan upgrade or production/development modification
was performed. No application source or local `.avd` behavior changed.
The original unrelated work remains excluded from this documentation update.

Evidence: saved dashboard switches/settings, independent Auth settings GET,
read-only migration list and aggregate user/factor checks, environment variable
presence-only checks. No new application test result is claimed for this check.
The eight migration files and Phase 6.6A manifest remain unchanged.

See [staging runbook](supabase-staging.md) and the historical
[Phase 6.6B inventory](supabase-staging-preflight.md).
