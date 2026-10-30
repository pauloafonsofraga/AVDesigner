# Auth Admin provisioning compatibility

Date: 2026-10-29. Branch: `engine-prototype`. Applied **only** to staging project
`puyrylatmtcwlvyycplc`, WireNexus Staging. No application deployment or production
change. Public signup remains disabled.

## Design

Supabase Auth inserts the account before applying custom `app_metadata`. The
existing BEFORE INSERT registration guard therefore could not see a trusted
marker passed to Admin createUser. The new migration adds one narrow alternative
authorization inside that same enabled trigger:

- A database administrator prepares a random user UUID plus SHA-256 of the
  normalized email in `wirenexus_private.admin_provisioning_authorizations`.
- Each authorization expires within ten minutes (operator examples use nine).
  It matches both the exact UUID and email; an email-only allowlist is not used.
- The registration guard atomically deletes the matching unexpired authorization
  in the Auth transaction. Failed account/workspace transactions restore it by
  rollback. Successful creation consumes it once.
- No direct read/write privileges are granted to anon, authenticated,
  service_role or supabase_auth_admin. RLS is enabled without policies. There is
  no browser or service RPC to mint authorizations. The trusted SQL administrator
  and the existing security-definer guard own this narrow boundary.
- The existing registration policy and trusted app-metadata behavior are retained
  for compatibility. User-controlled metadata never authorizes creation. No
  blanket exemption is added for the Auth database role or service credentials.
- The existing AFTER INSERT personal profile/workspace/Owner provisioning remains
  unchanged. Platform roles, entitlements, memberships and cable/project data are
  not modified by this migration.

The UUID must be supplied through Auth Admin createUser's supported `id` field.
Public signup does not accept an administrator-selected Auth UUID. Even if the
public Auth signup setting were accidentally changed, this database gate still
rejects an unapproved insert. Keep all three registration gates closed anyway.

## Version and hosted checks

Source migration:
`supabase/migrations/20261029124656_admin_provisioning_authorizations.sql`.
Generated using pinned official CLI `supabase@2.122.0 migration new`; no linked
CLI push, credential file or repository configuration was created.

Hosted ledger version: `20261029124918`.
Hosted name: `20261029124656_admin_provisioning_authorizations`.
Source and stored SQL SHA-256 match:

`037f84145f612531ceddbfa0f948c80ed9ecb541c6914eb3d87cc8b886d489aa`

The MCP runner version differs from the source prefix, as with the original
eight migrations. Do not replay migration files through a linked CLI without
reconciling the existing mapping. The original eight source files and their
checksum manifest are unchanged; there are now nine applied staging migrations.

Before application: target identity confirmed, registration closed, account absent,
authorization table absent, eight recorded migrations and both Auth triggers
enabled. After application: both triggers still enabled; existing policy hash
unchanged, as are the existing account provisioning/platform-admin functions and
application RPCs. New table RLS/privileges verified directly in the hosted database.
Existing policy catalogue SHA-256:

`d8bbf732a15033bcfc376356e2902bbb73b792eb3fb2ebdf208cc5f809ed3dd5`

The existing read-only `docs/staging-preflight.sql` also executed successfully
after application; explicit new-table grants, RLS and post-provision checks were
verified separately rather than relying on the preflight's final result alone.

## Operator workflow for subsequent approved staging accounts

1. Verify the exact staging project, closed Auth/database/app registration gates,
   enabled triggers, and absence of the requested account. Obtain explicit account
   approval and securely supply its credentials. Never insert into `auth.users`.
2. Generate a fresh UUID. On the trusted staging SQL administrator connection,
   prepare just that UUID/email hash, with a short expiry. No secrets or passwords
   belong in SQL, logs or source. Example below is a parameterized operator query,
   not a browser RPC:

```sql
insert into wirenexus_private.admin_provisioning_authorizations
  (user_id, email_sha256, expires_at)
values ($1::uuid,
  encode(sha256(convert_to(lower(btrim($2::text)),'UTF8')),'hex'),
  clock_timestamp() + interval '9 minutes');
```

3. From the trusted server-only Auth SDK process, use the **same** UUID:

```js
const {data, error} = await admin.auth.admin.createUser({
  id: approvedUserId,
  email: approvedEmail,
  password: securelyLoadedPassword,
  email_confirm: true,
  app_metadata: {wirenexus_provisioned: true}
});
```

Only administrator-vetted, controlled inboxes may be auto-confirmed. Read the
staging key/password from the exact authorized Keychain items or another approved
secret-manager process; capture subprocess output privately, never print the
credential or full Auth response. A key belongs only to the fixed staging URL.
No .env/source/shell-argument secret injection or production credential reuse.

4. Verify the returned UUID, trusted marker, confirmed identity, one personal
   profile/workspace and matching Owner membership, plus consumed authorization.
   Check password authentication and authenticated account identity as appropriate;
   revoke the temporary test session. Platform Admin remains a separate approved
   MFA bootstrap, never part of account creation.
5. On failure/timeout, inspect the precise UUID through trusted read-only checks
   before any retry. Never recreate an existing account, overwrite its password,
   or automatically issue new UUIDs. Remove only an explicitly abandoned pending
   authorization using the trusted operator connection; expired entries cannot
   authorize an insert. Do not toggle registration or disable the trigger.

## Validation and actual result

`node --test test/adminProvisioning.test.mjs test/workspaces.test.mjs test/plans.test.mjs test/organizations.test.mjs test/organizationInviteApi.test.mjs`
passed **34/34**. The five new tests simulate Auth's actual insert-then-update
ordering, unauthorized and forged-metadata rejection, Auth-role non-exemption,
UUID/email mismatch, expiry/maximum TTL, single-use consumption, transaction
rollback, profile/workspace/Owner creation, no Platform Admin and cross-account
RLS isolation. Local fixtures alone are not evidence of real authentication.

Real hosted checks also passed:

- Public signup with forged user metadata rejected: HTTP 422 `signup_disabled`.
- The explicitly approved first operator account was created through the Auth
  Admin API with its authorized UUID and trusted app metadata.
- Exactly one confirmed/marked account, profile, personal workspace and Owner
  membership; zero platform-role grants and zero remaining authorizations.
- Actual password sign-in and authenticated account identity passed. The
  temporary test session was signed out successfully. No tokens were printed.
- Registration remains closed; no production, SMTP, Realtime or RLS-policy change.

No second hosted user was provisioned for isolation testing; cross-account denial
was verified by the focused SQL/RLS tests. Resend delivery, MFA enrollment and
Platform Admin bootstrap were not performed. Stop before those separate steps.

Subsequent separately approved setup is recorded in
[staging Platform Admin verification](staging-platform-admin-verification.md):
TOTP/AAL2 verified before the role grant, real AAL2 Admin allowed, fresh AAL1
Admin denied and temporary sessions signed out. The historical provisioning-only
phase boundary above remains unchanged.

Security advisors show the existing six intentional authenticated security-definer
RPC warnings, twenty deny-all-private RLS/no-policy INFO findings (one new table),
and a leaked-password-protection warning. The latter setting was not changed;
review [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
before wider testing. Do not add policies merely to suppress the intentional
[RLS/no-policy finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

All 245 protected files and original migration checksums remain intact; unrelated
Device JSON Import edits remain excluded. Recovery must not delete the new user
or workspace. If a future rollback is needed, revoke pending authorizations and
use a separately reviewed forward migration to restore the previous guard; never
disable it or reset Auth/database data.
