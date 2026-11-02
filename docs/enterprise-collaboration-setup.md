# Enterprise collaboration setup

Date: 2026-11-02 (Asia/Dubai). Target: Supabase staging
`puyrylatmtcwlvyycplc`, existing Cloud Run project `wirenexus-staging`.

**Status: Enterprise baseline ready; secondary Editor enrollment BLOCKED.
NOT ready for live collaboration acceptance.**
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
- Resumed after the initial credential blocker: official Google SDK sign-in
  succeeded using Google Chrome Dev under the existing operator identity.
  The normal application Account/MFA interface was used; no temporary code-entry
  server or other custom authentication helper was introduced.
- Independently verified the operator's actual application session against server
  Auth at AAL2 before creating the company or assigning a plan.
- Created `WireNexus Collaboration Acceptance` through the existing Organizations
  UI, with the existing operator as Owner. Workspace ID:
  `8f039bb0-df58-411e-beb4-c815d7c88404`.
- Assigned its actual Enterprise plan through MFA-protected Plan Administration,
  revision 1 to 2. Cloud Save, history recovery, organization teams and collaboration
  are enabled by the assigned plan; this is not merely the Admin override. The
  existing Enterprise member limit is 100; its global definition was not changed.
- Created exactly one shared project, `Enterprise Collaboration Synthetic AV`,
  ID `19617748-8724-4bfe-a6eb-37515a2e30fd`, version/revision 1. The baseline has
  two synthetic devices, embedded artwork and four cables. The Owner reopened it
  successfully through Cloud Open. No collaboration head exists for this project.
- Signed both real application accounts into separate isolated Chrome Dev
  contexts using the existing operator-only IAM transport and normal application
  login controls. The secondary account's server-verified identity is distinct,
  has no Platform Admin capabilities and cannot see the company or read its
  project before invitation acceptance (actual server denial `42501`). This is
  correct isolation, not proof of Editor access.
- Signed out both temporary application sessions with local scope and awaited
  the two actual HTTP 204 logout responses before closing the isolated browser.
  Other sessions and account roles were not revoked.

Before/after personal-project metadata fingerprints match:

| Workspace | Projects | SHA-256 |
| --- | --- | --- |
| Existing operator personal | 1 | `6464bf75ae50d44ebdf3d12e62632ad72d4ad4fce890dd011ee88bd200bf44ea` |
| New secondary personal | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |

## Remaining Blocker

- Secondary account Editor membership and real shared-project access verification.

The initial `missing_code` Google SDK failure is resolved. Read-only checks of
the actual Cloud Run service confirmed the same reviewed digest and revision
`wirenexus-staging-00001-nkj`, with Invoker IAM checking enabled and only the
existing operator in the service-level Invoker binding. Both contexts used this
same approved Google invocation identity but separate Supabase sessions. No IAM
role was added for the secondary account.

The existing organization workflow requires a delivered email invitation before
adding a new member. Its service requires separate Resend invitation credentials
and sender, not merely Supabase sign-in SMTP. Live metadata now confirms that
`WIRENEXUS_INVITE_EMAIL_API_KEY` and `WIRENEXUS_INVITE_FROM` are absent. The Owner
attempted exactly one normal UI invitation for the approved secondary account
with role Editor. The API returned **503: Invitation email requires administrator
configuration.** The database confirms zero invitations and no secondary company
membership afterward. No invitation was falsely marked delivered, no membership
was inserted directly, and no new membership/bootstrap API or policy was added.
The user explicitly excluded invitation-email configuration changes, so no fix
or configuration-only deployment was attempted.
See [the approved provisioning runbook](staging-user-provisioning.md#enterprise-test-accounts-and-roles).

## Resume Safely

1. Reuse the company, Enterprise assignment, project and both accounts above.
   Do not recreate them, reset credentials or overwrite either personal workspace.
2. Obtain separate approval to configure supported invitation delivery. The
   current task does not authorize adding its credential/sender, deploying a new
   configuration revision, or bypassing invitation acceptance. Keep the existing
   image, IAM restrictions, DNS and production unchanged.
3. Using the existing application login/MFA and private browser transport, send
   and accept an Editor invitation for the already-provisioned secondary account.
   Open the invitation within its authorized private browser context; ordinary
   unauthenticated visits to the native service must remain denied. Verify shared
   project read/write is permitted, organization/plan administration is denied,
   no Platform Admin authority exists and its personal workspace is retained.
4. Stop after those setup/access checks. Do not activate or execute the live
   two-user acceptance sequence without its separate instruction.

## Validation and Boundaries

`node --test test/adminProvisioning.test.mjs test/workspaces.test.mjs test/plans.test.mjs test/organizations.test.mjs test/organizationInviteApi.test.mjs`
passed **34/34**, zero failures. Local tests are not evidence that the pending
real invitation and Editor-access checks have passed.

Sanitized actual setup results are recorded in
[the setup evidence](security/enterprise-collaboration-setup.json). Existing
personal-project fingerprints still match; both personal plans remain Free at
revision 1. Final hosted checks confirmed one company project, no collaboration
head, zero invitation rows, no secondary company membership, unchanged Operator
Platform Admin, no secondary Platform Admin, closed registration and enabled
Auth triggers. No simultaneous editing, cable mutation, conflict, undo/redo or
reconnect acceptance sequence was run.

No migration, RLS policy, platform role, pre-existing permission, Cloud Run
IAM, DNS, application deployment, production setting or invitation-email
configuration was changed. No custom authentication helper was created. Existing
artwork, Masters, backups and unrelated Device JSON Import edits were untouched.
