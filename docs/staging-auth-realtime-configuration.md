# Phase 6.6E: staging Auth and Realtime configuration

Date: 2026-10-29. Branch: `engine-prototype`. Starting commit:
`1f6dc82ed617bcdf65337b0182c7bb8aeddf7dc0`.
Exclusive target: `puyrylatmtcwlvyycplc`, **WireNexus Staging**, VideoCore.

## Outcome and verified settings

| Setting | Hosted evidence / action |
| --- | --- |
| Realtime service | ON, unchanged |
| Allow public access to channels | Changed ON to OFF, saved; Dashboard reported success. Reload independently confirmed OFF and no pending changes. Only private channels are now allowed. |
| TOTP MFA | Enabled; maximum 10 factors. AAL1 session-duration limit enabled, 15 minutes. Unchanged; no enrollment or challenge performed. |
| Email authentication | Enabled; anonymous sign-in disabled. Read-only Auth settings API returned HTTP 200. |
| Public signup | Still disabled: API `disable_signup=true`, database registration policy false. No signup request or user provisioning. |
| Email confirmation | Required: API `mailer_autoconfirm=false`. Unchanged. |
| Auth Site URL | Still `http://localhost:3000`. No approved staging HTTPS editor URL supplied; not replaced with an invented or production URL. |
| Authorized redirects | Empty. Await exact approved staging redirect URLs. No wildcard added. |
| Custom SMTP | OFF. No provider, sender or credentials supplied; unchanged. |
| Email templates | Default templates. Dashboard requires custom SMTP before subject/body editing; Magic link or OTP preview still uses a sign-in link (`{{ .ConfirmationURL }}`). Code templates below are prepared, not installed. |

Realtime's other limits/pools were not changed. Saving its privacy setting warned
that clients would disconnect; this isolated staging database has zero users.
No channel was joined, message sent or live collaboration test performed.
Private-only service configuration is not proof of two-user authorization: the
existing Realtime RLS policies still require later authorized staging acceptance.

## Data API exposure check resolved

Authenticated Dashboard inspection at
`/dashboard/project/puyrylatmtcwlvyycplc/integrations/data_api/settings`
showed **2 of 3 schemas exposed**: `public` and `graphql_public` checked,
`wirenexus_private` unchecked. No exposure setting was changed. Extra search path
remains `public, extensions`; automatic exposure of new tables was left unchanged.
Future migrations must continue to establish safe RLS and grants before exposing
tables through public APIs.

This resolves Phase 6.6D's outstanding configuration inspection. The earlier
publishable-key GET `/rest/v1/` returned 401 and was inconclusive, not a schema
exposure finding. No elevated key was retrieved to bypass that response. Real
authenticated RPC/catch-up permission tests remain deferred; this is not a claim
that the full application API surface has passed runtime acceptance.

## Missing inputs and prepared mail configuration

Before changing Auth URLs, supply the approved HTTPS staging editor origin and
each exact permitted redirect URL. Keep them separate from production. Current
email-code flows do not consume URL sessions (`detectSessionInUrl:false`), so do
not invent callback routes. Enterprise invitation links also require the approved
`WIRENEXUS_EDITOR_ORIGIN`.

Custom SMTP needs a staging provider, host, supported port/TLS requirements,
SMTP username, verified sender email and display name. The operator must enter
the SMTP password/API credential through the secure provider/Dashboard flow,
never chat, Git, logs or browser-accessible app configuration. Verify the sender's
DNS/domain configuration with that provider. Do not reuse production credentials.
No SMTP credential was requested, retrieved or entered in this phase.

After SMTP is approved and configured, install these three code-only templates.
Use the subject and heading from the table, with the common HTML body below.
These are Supabase template variables, not actual authentication codes.

| Dashboard template | Subject and heading | WireNexus verification flow |
| --- | --- | --- |
| Magic link or OTP | WireNexus Staging sign-in code | `verifyOtp`, type `email`; existing-account requests use `shouldCreateUser:false` |
| Reset password | WireNexus Staging recovery code | `verifyOtp`, type `recovery`, then password update |
| Confirm sign up | WireNexus Staging confirmation code | Email code entry; prepare only, keep public signup disabled |

```html
<h2>WireNexus Staging sign-in code</h2>
<p>Enter this code in the WireNexus Staging account window:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:2px">{{ .Token }}</p>
<p>Do not share this code. If you did not request it, ignore this email.</p>
```

For recovery and confirmation, replace the heading with the corresponding table
entry. Do not add `ConfirmationURL`, token hashes or external tracking links.
Keep token expiry/rate controls enabled; verify delivery, expiry and recovery only
in a later explicitly approved test phase. No email was sent here. Default SMTP
is not a substitute for a configured test sender for arbitrary recipient inboxes.
Organization invitations use the existing separate Resend integration, not these
Supabase Auth templates; its verified sender/key must also be supplied securely.

## Deployment environment readiness

Presence-only inspection found all nine variables below absent in this local
process. This does **not** establish their state in a hosting provider. No approved
dedicated staging Vercel project/deployment scope was supplied, so remote secrets
were not inspected or changed. No production environment was accessed.

| Variable | Required scope |
| --- | --- |
| `WIRENEXUS_SUPABASE_URL` | Staging API URL `https://puyrylatmtcwlvyycplc.supabase.co` |
| `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY` | Matching browser-safe project key; active publishable key available and used only for read-only Auth verification |
| `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` | Matching server-only credential, never browser config or bundle; not retrieved in this phase |
| `WIRENEXUS_REGISTRATION_ENABLED` | Absent or literal `false` |
| `BLOB_READ_WRITE_TOKEN` | Server-only token for a dedicated private staging store |
| `PUBLIC_VIEWER_ORIGIN` | Explicit approved staging HTTPS origin; prevent production fallback |
| `WIRENEXUS_EDITOR_ORIGIN` | Explicit approved staging HTTPS editor origin |
| `WIRENEXUS_INVITE_EMAIL_API_KEY` | Server-only dedicated Resend credential, separate from SMTP |
| `WIRENEXUS_INVITE_FROM` | Provider-verified staging invitation sender |

See the [complete runbook](supabase-staging.md#3-configuration-contract)
for isolation and credential handling. SMTP credentials belong in Supabase Auth's
SMTP configuration, not public app environment variables. Required outstanding
inputs are the dedicated staging deployment identity/URLs, isolated Blob store,
server credentials, SMTP provider/sender/secure credential entry, and separate
Resend sender/credential. Availability and correct scoping must be verified by the
operator without exposing values.

## Preservation and validation

Read-only database snapshots before and after configuration matched exactly:
eight migration ledger entries and stored SQL hashes unchanged, 28 application
tables with RLS enabled, zero Auth users/workspaces/cloud projects, registration
closed, and public/private/Realtime/Storage policy catalogue SHA-256 unchanged:

`d8bbf732a15033bcfc376356e2902bbb73b792eb3fb2ebdf208cc5f809ed3dd5`

No data, RLS policy, grant, migration, application code or historical migration
file changed. Existing Phase 6.6D hosted SQL verification remains recorded in
[database initialization](staging-database-initialization.md); ledger runner-version
mapping still applies. Do not replay migrations through CLI without reconciling it.
No production configuration, users, deployment or live collaboration testing.
All eight local migration checksums passed. All 245 protected artwork, backup,
Masters and unrelated-work file hashes matched the existing protection manifest.
The original unstaged Device JSON Import changes remain excluded (49 added lines
in `index.html`, 40 in `src/personalDefinitions.js`). Documentation whitespace
validation passed. No application test-suite rerun was needed for docs/settings
only; no new application runtime acceptance is claimed.

Remaining acceptance is blocked on URLs/mail/deployment credentials and separate
approval for provisioning/deployment/tests. TOTP enrollment/aal2, real email
delivery/recovery, private-channel denial, revocation, two-client synchronization,
concurrent operations and recovery are **not yet runtime-verified**.

Recovery: no database rollback is needed for this configuration-only change.
Keep public channels disabled; if private-channel testing later fails, inspect
JWT/workspace permissions and existing policies rather than weakening privacy.
Restore approved URL/mail settings only through a staged, recorded change; do
not enable signup or disable MFA protections as a workaround.
