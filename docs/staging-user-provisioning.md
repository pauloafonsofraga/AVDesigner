# Staging user provisioning with registration closed

Date: 2026-10-29. Exclusive target: `puyrylatmtcwlvyycplc` (WireNexus Staging).
This is an administrator-operated procedure, not a public API or browser feature.
No remote user, role, membership or configuration was created/changed while
preparing or verifying this procedure. No migration or application fix is needed.

## Why Dashboard creation fails

The generic Dashboard **Create user** operation does not supply WireNexus's
trusted creation marker. With registration closed, the existing
`wirenexus_registration_guard` rejects such an insert. Supabase reports the
trigger failure as "Database error creating new user." The supported path is
Supabase's server-only Auth Admin API with:

```js
app_metadata: { wirenexus_provisioned: true }
```

This must accompany the **initial** creation. Adding it afterward cannot repair
an account whose creation was rolled back. `user_metadata`, display names, JWT
role hints and a publishable/anon key are not substitutes. Do not retry Dashboard
creation, toggle registration, disable triggers, insert into `auth.users`, or add
a browser-accessible provisioning endpoint. The provisioning marker is not a
Platform Admin or Enterprise-plan grant.

Supabase documents [`auth.admin.createUser`](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
as server-only. The administrator must have the staging project's elevated Auth
credential (modern server secret or appropriate legacy service-role key), handled
outside the browser. A WireNexus Platform Admin session is **not** that credential
and does not authorize this SDK operation on its own.

## Operator prerequisites

1. Obtain approval for the exact synthetic staging accounts and their controlled
   inboxes. Confirm ownership before using `email_confirm:true`: this explicitly
   confirms only the administrator-vetted test identity; it does not turn off
   global email confirmation. Never use real customer identities or reuse a
   production password/key. Public signup remains disabled throughout.
2. Use a trusted external Node operator process with the repository's pinned
   `@supabase/supabase-js` dependency. Inject credentials and a unique strong
   password using an approved secret-manager process environment. Do not write
   `.env` files here, put secrets in shell command arguments/history, browser
   consoles, source, logs, tickets or chat. Disable shell tracing/session capture
   of sensitive inputs. Clear injected values and terminate the process afterward.
3. Bind `WIRENEXUS_SUPABASE_URL` to the exact staging API URL below, and inject its
   matching `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`. Inject `STAGING_TEST_EMAIL` and
   `STAGING_TEST_PASSWORD` (at least 12 characters, matching current Auth policy).
   Set non-secret `STAGING_PROVISION_PROJECT=puyrylatmtcwlvyycplc` only after
   verifying the target. Do not use a production hosting environment or secret.
4. In the staging Dashboard, verify signup OFF, anonymous sign-in OFF,
   confirmation/TOTP ON, and the SQL registration gate false. Confirm the two
   triggers are enabled using the read-only checks below. No setting must be
   temporarily relaxed. Credential identity must be independently checked by the
   operator; a key format alone does not establish which project issued it.

## Create one account through the Auth Admin API

Run the following from the repository in the **secure operator environment** only
after provisioning approval and secret injection. It deliberately has no role,
plan, membership or arbitrary-metadata inputs. It was not run against staging in
this verification; no recipient/password was supplied.

```sh
node --input-type=module <<'JS'
import { createClient } from '@supabase/supabase-js';

async function main() {
  const project = 'puyrylatmtcwlvyycplc';
  const url = `https://${project}.supabase.co`;
  const env = process.env;
  if (env.STAGING_PROVISION_PROJECT !== project ||
      env.WIRENEXUS_SUPABASE_URL !== url) throw new Error('target');
  const key = env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY;
  const email = env.STAGING_TEST_EMAIL?.trim();
  const password = env.STAGING_TEST_PASSWORD;
  if (!key || /[\r\n]/.test(key) || !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password || password.length < 12) throw new Error('inputs');
  // Reject browser credentials early; Auth still validates the actual server key.
  if (!key.startsWith('sb_secret_')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); }
    catch { throw new Error('credential'); }
    if (claims.role !== 'service_role' || claims.ref !== project)
      throw new Error('credential');
  }
  const settings = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(10000)
  });
  if (!settings.ok) throw new Error('preflight');
  const policy = await settings.json();
  if (policy.disable_signup !== true || policy.external?.email !== true ||
      policy.external?.anonymous_users !== false ||
      policy.mailer_autoconfirm !== false) throw new Error('policy');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { wirenexus_provisioned: true }
  });
  if (error || !data?.user?.id) throw new Error('creation');
  // Record only this UUID in the restricted staging operator worksheet.
  console.log(JSON.stringify({ project, userId: data.user.id }));
}
main().catch(() => {
  console.error('Provisioning stopped. Check target/inputs and redacted Auth logs. Do not retry blindly.');
  process.exitCode = 1;
});
JS
```

Do not print the returned user object or raw provider exception. The command does
not call signUp, inviteUserByEmail, SQL inserts, plan assignment or role grants.
Do not replace createUser with a normal email invitation: invitations in WireNexus
are organization membership operations for already provisioned Auth accounts.

If a request times out or succeeds but later checks fail, its outcome may be
uncertain. Inspect Auth securely through the staging administrator view/Admin
read API before retrying. If the email already exists, verify that account's
identity, marker, workspace and intended purpose; do not overwrite passwords or
metadata, delete accounts or create alternate identities automatically. A failed
database trigger normally rolls back the transaction, but do not infer that from
a generic transport error. Stop on any unexpected profile/workspace count.

## Read-only database verification

Run on the verified staging SQL connection. Keep UUIDs/results in the restricted
operator worksheet. Replace the UUID placeholder with the exact Admin API result;
no user table writes are part of verification.

```sql
select registration_enabled
from wirenexus_private.account_policy where singleton;

select tgname, tgenabled, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal
  and tgname in ('wirenexus_registration_guard','wirenexus_provision_account');

select
  u.id,
  u.raw_app_meta_data->>'wirenexus_provisioned' = 'true' as trusted_marker,
  u.email_confirmed_at is not null as confirmed,
  (select count(*) from public.wirenexus_profiles p where p.user_id=u.id) as profiles,
  (select count(*) from public.wirenexus_workspaces w
    where w.personal_owner_id=u.id and w.kind='personal') as personal_workspaces,
  (select count(*) from public.wirenexus_workspaces w
    join public.wirenexus_memberships m on m.workspace_id=w.id
    where w.personal_owner_id=u.id and w.kind='personal'
      and m.user_id=u.id and m.role='owner') as owner_memberships,
  exists(select 1 from wirenexus_private.platform_admins a
    where a.user_id=u.id) as platform_role
from auth.users u where u.id = '<NEW-STAGING-UUID>'::uuid;
```

Expect registration false; both triggers `O` (enabled); exactly one user result,
trusted/confirmed true, counts 1/1/1, platform_role false before any explicit
bootstrap. The after-insert trigger creates the profile/personal Owner workspace
atomically. Do not construct missing workspaces or memberships manually; stop and
investigate the trigger failure. New personal plans remain Free. Inspect the
account identity and plan through authenticated existing RPC/UI after sign-in.

## Platform Admin bootstrap (separate explicit grant)

Provision P through the same Admin API procedure first. Confirm its UUID, controlled
inbox and 1/1/1 verification. A trusted staging database administrator may then
grant only the separately approved P UUID in the existing private platform-role
table (this is **not** an insert into `auth.users`):

```sql
begin;
do $$
declare target uuid := '<VERIFIED-P-STAGING-UUID>'::uuid;
begin
  if not exists(select 1 from auth.users where id=target
    and email_confirmed_at is not null
    and raw_app_meta_data->>'wirenexus_provisioned'='true') then
    raise exception 'Verified staging test identity required';
  end if;
  insert into wirenexus_private.platform_admins(user_id,reason)
    values(target,'Approved WireNexus staging Platform Admin bootstrap')
    on conflict(user_id) do nothing;
end $$;
commit;
```

This SQL is an unexecuted operator instruction, not authorization to grant a role
to an unspecified identity. Never grant Platform Admin based on email/domain alone,
browser metadata, workspace Owner role or plan selection. No service credential
is given to P. P signs in, uses Account's admin MFA setup, enrolls and verifies
TOTP, and reaches aal2. Until both a verified TOTP factor and aal2 exist, the role
must remain unusable for privileged operations. Do not fabricate factors/JWTs.
P retains full product entitlements but no automatic customer-workspace access.
Role removal is an explicit administrator operation; do not delete the account to
undo a grant. Revocation/session behavior must follow the existing security runbook.

## Enterprise test accounts and roles

Provision distinct controlled accounts P/A/B/C/D/E/F using the same process:

| Account | Intended role |
| --- | --- |
| P | MFA Platform Admin, deliberately not a test-company member |
| A | Company Owner |
| B | Company Admin |
| C / D | Independent Editors |
| E | Read-only Viewer |
| F | Outsider/Owner of a different company for isolation tests |

A and F create separate company workspaces using the existing Organizations
workflow. P assigns Enterprise to each intended company workspace through the
MFA-protected Plan Administration flow with current assignment revisions, not
SQL plan edits or app metadata. Personal workspace plans are independent.
A sends real membership invitations to B/C/D/E via WireNexus, and each verified
recipient signs in and accepts. Do not directly insert memberships or assign
organization roles through Auth metadata. Existing Admin/Owner and seat protections
remain. Invitation acceptance does not itself create an Auth account.

Real invitation delivery needs the approved Resend sender, credentials and deployed
invitation API from [domain/email preparation](staging-domain-email-preparation.md).
If those are not ready, stop before invitations; do not bypass delivery/acceptance
with SQL. Publishing authorization is separate and is not required to create a
Platform Admin or Enterprise workspace; see the [complete test runbook](supabase-staging.md#6-test-accounts-and-enterprise-provisioning).

## Verification performed and limits

Read-only hosted inspection confirmed registration policy false, both original
Auth triggers enabled, unchanged guard/provision/MFA function definitions, eight
migrations, and unchanged public/private/Storage/Realtime policy catalogue hash:
`d8bbf732a15033bcfc376356e2902bbb73b792eb3fb2ebdf208cc5f809ed3dd5`.

Local validation command:

```sh
node --test test/workspaces.test.mjs test/plans.test.mjs test/organizations.test.mjs test/organizationInviteApi.test.mjs
```

29/29 passed: closed registration and forged-user-metadata rejection, denied client
Auth-table writes, trusted provisioning/personal workspace creation, explicit MFA
Platform Admin, no private-data bypass, plan defaults/authorization, organization
role boundaries and invitation delivery failure/acceptance checks. Fixture SQL
seeds only isolated local test databases; it is not a hosted provisioning method.
The operator example passed syntax checking and six additional offline checks
with mocked Auth/SDK calls: exact trusted create payload, wrong URL, wrong project,
publishable-key rejection, open-signup refusal and sanitized provider failure.
These checks did not use a real credential or make external requests.

No hosted createUser, password login, MFA enrollment, SMTP send, role grant or
Enterprise invitation was executed; no approved recipient credentials were
provided. Real Admin API creation and subsequent login/MFA/mail acceptance remain
operator checks. No claim of real end-to-end provisioning success is made from
the local simulation. Existing guards, RLS, migrations, data and production remain
untouched. All eight local migration checksums and 245 protected-file hashes were
verified unchanged before the scoped documentation commit.
