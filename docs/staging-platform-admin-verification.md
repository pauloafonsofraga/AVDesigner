# Staging Platform Admin verification

Verified: 2026-10-30 (Asia/Dubai). Exclusive target:
`puyrylatmtcwlvyycplc`, WireNexus Staging. Account identifiers, passwords,
authenticator seeds/codes, API keys and session tokens are omitted from this report.

## Outcome

The explicitly approved first staging operator account has one verified application
TOTP factor and one Platform Admin role. Enrollment/AAL2 were verified before the
trusted SQL administrator bootstrapped the role. No Auth metadata, email-domain
rule or workspace Owner role was used to grant Platform Admin.

The operator scanned the enrollment QR and submitted the authenticator code
privately. A loopback-only helper used the pinned Supabase SDK and real staging
Auth/RPC APIs; secrets and sessions stayed in process memory and were not printed.
This was not enrollment in the Supabase Dashboard organization's MFA, an
application deployment, or automatic enrollment without operator interaction.

## Real session checks

All checks passed, using genuine Auth sessions rather than edited JWTs or
SQL-injected claims:

| Session | Verification |
| --- | --- |
| Password-only sign-in before TOTP challenge | AAL1; account identity `admin=false`, `mfaRequired=true`; plans `definitions` RPC rejected with SQLSTATE `42501` |
| After a fresh TOTP challenge | AAL2; server Auth getUser matched the signed-in account; account identity `admin=true`, `fullProductAccess=true`; plans `definitions` RPC succeeded |
| After signing out and signing in again without TOTP | AAL1; Admin identity unavailable and the same privileged RPC rejected with `42501` |
| Cleanup | Both temporary test sessions signed out; verified TOTP retained; no password change or factor removal |

The helper's non-sensitive final result was:

```json
{
  "passed": true,
  "aal1BeforeDenied": true,
  "aal2AdminAllowed": true,
  "aal1AfterDenied": true,
  "testSessionsSignedOut": true
}
```

The final AAL1 test used sign-out followed by a new password-only session, not
unenrollment or fabricated token downgrading. This does not claim that a previously
issued AAL2 access JWT is immediately invalidated by sign-out; its normal access
token expiry remains distinct from refresh-session revocation.

## Preserved state

Read-only hosted checks after completion confirmed exactly one approved matching
account, profile, personal workspace and corresponding Owner membership; one
verified TOTP factor and one platform-role record. Public registration remains
closed, and all nine existing migration records remain. No additional user,
workspace membership, plan assignment, migration or policy was added in this step.

Existing public/private/Realtime/Storage policy catalogue SHA-256 is unchanged:

`d8bbf732a15033bcfc376356e2902bbb73b792eb3fb2ebdf208cc5f809ed3dd5`

Platform Admin remains entitlement authority, not membership in customer
workspaces. No new customer access was granted. Cross-account isolation was
covered by the existing local regression tests; no second hosted user was created
for this verification.

## Local helper and UI limitations

The existing account UI exposes its MFA controls only after a platform role is
present. To respect the approved MFA-before-role sequence, enrollment used a
temporary private operator page. Its browser form issues were corrected locally:
per-browser cookie handling, same-origin referrer policy for POST Origin headers,
CSRF validation, strict Host/Origin checks, no caching/embedding and loopback-only
binding. No helper fixes were deployed or applied to the production application.

The access-check page now retains only the non-sensitive completed result and
offers no further verification form. Reposting an earlier completed form returns
403; that does not mean the authenticator code failed. View the result with a
fresh GET of the root page instead. It can be stopped after the operator has seen
the result; no active test credentials need to be retained.

The full deployed WireNexus browser UI was not tested here. Verified capabilities
were the real account identity and read-only plan administration RPC, exercised
with the same SDK/Auth flow. No plan configuration or quota was changed.

Regression command rerun after hosted verification:

```sh
node --test test/workspaces.test.mjs test/plans.test.mjs
```

17/17 passed, including explicit verified-MFA Admin, AAL1 denial, private-workspace
isolation, role revocation, plan permissions and preservation tests. Documentation
only is committed for this completion record; unrelated source edits and protected
artwork/backups/Masters remain untouched.

## Remaining staging work

No deployment, production configuration, registration enablement, team invitations
or live collaboration test was performed. The earlier leaked-password-protection
advisor warning still needs a separate review; this setup did not change that
setting. Email OTP/recovery delivery had already been confirmed separately, but
Resend event logs and message authentication headers were not audited here.

Administrative sessions must challenge the existing authenticator to reach AAL2.
Do not bootstrap another role or reenroll MFA merely because a fresh password-only
session correctly lacks administrative access.
