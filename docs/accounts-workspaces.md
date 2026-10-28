# Accounts Phase 2: users, private workspaces and Platform Admin

Phase 5 extends this foundation with company management, email-bound invitations
and organization libraries; see [Organizations & Teams](organizations-teams.md).
Its invitation flow supersedes direct member insertion through the foundation RPC.

No production migration, account provisioning, environment change or deployment
is performed by this implementation. Public registration stays disabled.

## Scope and user interface

The existing Device Editor > Defaults > Account entry opens email-code sign-in,
password sign-in, registration (only when configured), account recovery and TOTP
MFA controls. The signed-in account lists its workspace memberships and roles.
Sign-out returns to the untouched browser recovery library and leaves the open
project intact. Cloud libraries and favourites are available to ordinary users;
Platform Admin is not required for personal-library access.

Every existing and newly created Auth user gets one private personal workspace
and an Owner membership. The existing personal registry, artwork hashes/bytes,
preferences, generation, migration markers and promotion receipts remain keyed
by their original account_id. No content is copied, resized or rewritten. The
personal workspace is the ownership boundary for that same personal library.

Enterprise-kind workspaces and membership administration are a foundation only:
they may be provisioned by a trusted administrator in a transaction that also
creates an Owner membership. They appear in member workspace lists. There is no
Enterprise onboarding/invitation UI or shared workspace-library/project storage
in this phase. The active editable library remains the user's personal library;
an Enterprise Viewer still owns their separate personal library. Billing, cloud
project storage and collaboration remain unimplemented. Existing .avd files and
local Engine editing do not acquire account IDs or depend on an Auth service.

## Deployment order (instructions only)

1. Back up Supabase and retain the current Blob store and Phase 1 registry.
   Test restoration before release. Record existing owner library generation,
   registry checksum, artwork count/hashes and Auth user UUIDs.
2. Apply these migrations once, in order, skipping already-applied versions:
   - `202609290001_owner_library.sql`
   - `202610270001_secure_publishing.sql`
   - `202610280001_accounts_workspaces.sql`
   The third migration is transactional and backfills all existing Auth users.
   Use the trusted migration/database administrator, not an authenticated browser.
   Confirm each user has exactly one personal workspace and Owner membership;
   compare the original library/artwork checksums. No Platform Admin is auto-granted.
3. Retain `WIRENEXUS_SUPABASE_URL` and browser-safe
   `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`. Retain the Phase 1 server-only
   `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`, `BLOB_READ_WRITE_TOKEN` and
   `PUBLIC_VIEWER_ORIGIN` settings for publishing. No new browser secret exists.
   Leave `WIRENEXUS_REGISTRATION_ENABLED` absent or false. This public UI flag
   cannot authorize a signup: the database registration policy is independent.
4. Keep Supabase **Allow new users to sign up** OFF and anonymous sign-ins OFF.
   Keep email confirmation ON, configure production SMTP and an appropriate
   minimum password length (UI minimum: 12 characters). Configure signup,
   magic-link and recovery email templates to display `{{ .Token }}` for the
   existing code-entry flow. Auth URL-token detection remains disabled; do not
   assume redirect-link recovery is implemented. Configure the approved editor
   Site URL and review Auth rate limits/CAPTCHA before any future registration launch.
5. Enable/verify Supabase TOTP MFA enrollment and verification in staging. The
   product role is provisioned separately as described below. Test recovery and
   MFA removal without using customer accounts or disabling production MFA.
6. Validate two real staging accounts: sign-in/out, confirmed signup when enabled
   only in staging, recovery, isolation, original owner data, MFA elevation,
   revoked membership and representative .avd open/save. Release the account UI,
   library adapter and SQL together only after approval. Refresh old browser tabs.
   A pre-Phase-2 owner identity without MFA entitlement evidence is not treated as
   Platform Admin by the new client; its personal library remains accessible.

The registration database row is inserted as false by the migration. A BEFORE
INSERT Auth trigger blocks unapproved account creation even if a client changes
its registration flag or the Auth signup setting is accidentally enabled.
Trusted administrator creation while registration is closed must use Auth Admin
`createUser` with `app_metadata: {wirenexus_provisioned: true}`. Never implement a
public endpoint that sets this marker; raw_user_meta_data is deliberately ignored.
Dashboard creation without this administrator marker can be rejected by the guard.

Enabling public registration later requires a separate explicit change to all
three gates: the Supabase signup setting, the private account_policy row and
`WIRENEXUS_REGISTRATION_ENABLED=true`. This phase does not make those changes.

## Platform Admin provisioning and MFA

Only a trusted database administrator can provision the role, for example:

```sql
insert into wirenexus_private.platform_admins(user_id, reason)
values ('VERIFIED-EXISTING-AUTH-USER-UUID', 'Approved platform administrator; ticket reference');
```

Do not infer this role from an email domain, workspace ownership, the legacy
singleton owner, user_metadata, app UI state, plan or subscription fields. Keep
the granting database credentials out of the client; record and audit the change.

Admin MFA controls appear only for provisioned administrators. This is step-up
protection for Platform Admin authority, not an optional all-data MFA policy for
ordinary users. The user signs in, opens Account, then Set Up / Verify Admin MFA. They scan the TOTP QR
and verify a code. The database enables Platform Admin and full product entitlement
only when the private role exists, the verified Auth JWT has aal2, and a verified
TOTP factor still exists. Without MFA the user retains ordinary personal access,
not administrative authority. Removing the factor immediately defeats the database
check, even before a cached aal2 token expires; the client also refreshes its session.
Role revocation is checked on the next identity request, independent of JWT refresh.

```sql
delete from wirenexus_private.platform_admins where user_id='VERIFIED-AUTH-USER-UUID';
```

Lost-authenticator recovery requires a trusted operator to verify the person's
identity, revoke the Platform Admin role, perform the Auth provider's MFA recovery
procedure, then restore the role only after fresh enrollment. Email recovery alone
never grants Admin. No browser-accessible role grant or MFA bypass is provided.

Full product entitlement is distinct from resource permissions. Platform Admin
never bypasses workspace membership or reads private customer libraries/projects.
Phase 1 publishing approval remains separate: provision an approved publisher if
needed under `docs/secure-publishing.md`; entitlement does not override publication
ownership. Factory catalogue deployment still requires repository authority and
the reviewed promotion workflow; local authoring build flags do not grant API roles.

## Server permissions and compatibility

- Profiles: users may read/edit only their own display name.
- Workspaces: members may read their workspaces; only Owners/Admins may rename.
  Column-level grants prohibit changing IDs, kind or personal ownership.
- Memberships: members may list their workspace members. Direct membership writes
  are denied. `wirenexus_account('set_member'|'remove_member', payload)` checks the
  caller's membership, locks the workspace and validates role changes. Only Owners
  can manage Owners/Admins; Admins manage Editors/Viewers only. Editors/Viewers
  cannot manage membership. A workspace must retain an Owner. Personal workspace
  memberships cannot be shared or reassigned through this RPC.
- Personal library/artwork: RLS reads are account-scoped. Writes remain RPC-only
  with server-derived auth.uid(), generation CAS, entry revisions and verified
  artwork. The client latches expectedAccountId to reject account-switch races.
  The old singleton owner table and Phase 1 publishing data remain untouched.
- Enterprise creation and account deletion are not public operations. Before an
  operator deletes an Auth user, transfer any Enterprise Owner responsibility;
  service-level deletion/cascades are outside membership RPC last-Owner protection.

The old browser recovery store remains a separate local recovery source. Import
requires an explicit review; sign-in never silently imports it or writes cloud
artwork back into it. Use separate browser profiles on shared/untrusted machines.
An open local project is intentionally not erased when switching accounts.

## Rollback

First close registration at all three gates and pause affected account operations.
Retain private workspace tables, role records, Auth users, library/artwork rows and
Phase 1 publication records. Roll back faulty UI with a compatible personal-library
adapter, or temporarily hide account actions; do not make all users admin to keep
an older owner-only UI working. Never restore unauthenticated publishing endpoints.
Do not drop the registration guard or workspace tables on a live multi-user system.
A destructive database restore requires a reviewed maintenance window and backups
that preserve users and data created after migration. Keep local .avd recovery available.

## Verification and remaining boundaries

`test/workspaces.test.mjs` executes the actual migration and RLS in PGlite, testing
default-closed signup, administrative provisioning, forged metadata, personal
ownership, role escalation, MFA, customer isolation, migration compatibility and
account-switch races. Existing Phase 1 security and account-library tests remain.
`scripts/accounts-workspaces-smoke.mjs` uses the real bundled Auth SDK, actual SQL
and a LOCAL simulated email/JWT issuer for registration, confirmation, password
sign-in, recovery, MFA and two-user browser workflows. It does not enable real
registration or verify production email delivery, JWT validation or provisioning.
The pre-existing broad account-library smoke .avd download timeout remains documented
in `docs/secure-publishing.md`; no unrelated save code or test is weakened.

Provider references: [signup](https://supabase.com/docs/reference/javascript/auth-signup),
[user metadata](https://supabase.com/docs/guides/auth/users),
[password recovery](https://supabase.com/docs/guides/auth/passwords), and
[MFA](https://supabase.com/docs/guides/auth/auth-mfa).
