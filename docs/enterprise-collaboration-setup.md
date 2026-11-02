# Enterprise collaboration setup

Date: 2026-11-02 (Asia/Dubai). Target: Supabase staging
`puyrylatmtcwlvyycplc`, existing Cloud Run project `wirenexus-staging`.

**Status: partial setup; NOT ready for live collaboration acceptance.**
No simultaneous-edit test was started.

## Completed

- Provisioned only the explicitly approved secondary test identity through the
  server-only Auth Admin SDK and the existing short-lived UUID/email-bound
  authorization. Exact identity details remain in the restricted operator
  worksheet, not this repository. The authorization was consumed once.
- Verified the staging credential against the fixed project URL and existing
  operator account before creation. No secret, password, OTP or session token
  was printed or committed.
- Verified the trusted provisioning marker, administrator-confirmed approved
  email, one profile, one personal workspace and one personal Owner membership.
  The new personal plan is Free and there is no Platform Admin grant.
- Actual ordinary password authentication and authenticated account identity
  succeeded. The unique generated password was used only in memory and not
  retained. The temporary verification session was signed out successfully;
  subsequent interactive access should use the existing application email-code
  flow, not a password copied from an operator log.
- Existing operator retains Platform Admin, verified TOTP and personal Owner
  membership. Both personal plans and existing projects remain unchanged.
- Public Auth signup and the database registration policy remained disabled;
  both Auth guard/provisioning triggers stayed enabled.

Before/after personal-project metadata fingerprints match:

| Workspace | Projects | SHA-256 |
| --- | --- | --- |
| Existing operator personal | 1 | `6464bf75ae50d44ebdf3d12e62632ad72d4ad4fce890dd011ee88bd200bf44ea` |
| New secondary personal | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |

## Not Completed

- `WireNexus Collaboration Acceptance` company workspace and Enterprise assignment.
- Synthetic shared AV project.
- Secondary account Editor membership and real shared-project access verification.
- Two authenticated isolated application browser sessions.

The previous temporary Google SDK installation was unavailable. Restored the
official macOS ARM SDK locally, checking its published SHA-256; no cloud resources
were created. No saved CLI account was available. An official SDK login for the
existing operator ended with `missing_code`, without a valid authorization
callback. Do not substitute a different Google principal, grant IAM permissions,
forge an application session, or perform Owner/MFA actions using SQL claims.
Live Cloud Run configuration could not be refreshed in this attempt.

The existing organization workflow requires a delivered email invitation before
adding a new member. Its service requires separate Resend invitation credentials
and sender, not merely Supabase sign-in SMTP. The last reviewed deployment lacked
those variables; their current live presence remains unverified. The user
explicitly excluded invitation-email configuration changes. No invitation was
issued or falsely marked delivered, no memberships were inserted directly, and no
new membership/bootstrap API or policy was added to work around that constraint.
See [the approved provisioning runbook](staging-user-provisioning.md#enterprise-test-accounts-and-roles).

## Resume Safely

1. Complete the official Google CLI authorization for the existing operator and
   recheck the unchanged IAM-private service/configuration read-only. Reuse the
   existing application login/MFA and browser IAM transport; no new authentication
   helper is needed.
2. In the existing application, create the named company as the existing operator,
   assign its Enterprise plan through MFA-protected Plan Administration and save
   exactly one synthetic project into that workspace, not a personal workspace.
3. Verify supported invitation delivery is already available. If configuration is
   missing, stop for separate approval; the current task does not authorize
   configuring it, deploying a new revision, or bypassing invitation acceptance.
4. Reuse the already-provisioned secondary identity; never recreate it or reset
   its password/metadata automatically. Send and accept an Editor invitation using
   the normal application. Verify its personal workspace is retained, shared
   project read/write is permitted, organization/plan administration is denied,
   and no Platform Admin authority exists.
5. Stop after those setup/access checks. Do not activate or execute the live
   two-user acceptance sequence without its separate instruction.

## Validation and Boundaries

`node --test test/adminProvisioning.test.mjs test/workspaces.test.mjs test/plans.test.mjs test/organizations.test.mjs test/organizationInviteApi.test.mjs`
passed **34/34**, zero failures. Local tests are not evidence that the pending
real invitation/Editor/browser checks have passed.

No migration, RLS policy, platform role, existing account permission, Cloud Run
IAM, DNS, application deployment, production setting or invitation-email
configuration was changed. No custom authentication helper was created. Existing
artwork, Masters, backups and unrelated Device JSON Import edits were untouched.
