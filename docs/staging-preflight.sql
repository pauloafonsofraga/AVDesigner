-- Phase 6.6A: read-only POST-migration inspection, not a migration or repair.
-- Run only against the independently verified staging target, as its trusted
-- database administrator. Never grant these catalogue-inspection rights to users.
-- Review every result; this is NOT an automatic production-readiness certificate.
begin transaction read only;

select current_database() as database_name, current_user as inspection_role,
       current_setting('server_version') as postgres_version,
       current_setting('transaction_read_only') as read_only;

-- All should be present. Built-in SHA-256 is used; no pgcrypto DDL is needed.
select signature, to_regprocedure(signature) is not null as present
from (values
  ('auth.uid()'), ('auth.jwt()'), ('sha256(bytea)'), ('gen_random_uuid()'),
  ('realtime.topic()'), ('realtime.send(jsonb,text,text,boolean)')
) as dependencies(signature);

-- CLI migration ledger is separate from schema existence. A missing ledger
-- requires operator reconciliation, NOT blindly replaying or marking migrations.
select to_regclass('supabase_migrations.schema_migrations') is not null as cli_ledger_present;

-- Browser RPCs: anon=false, authenticated=true. Trusted server RPCs:
-- anon=false, authenticated=false, service_role=true. Missing functions fail false.
with expected(signature, browser_rpc) as (values
  ('public.wirenexus_library(text,jsonb)', true),
  ('public.wirenexus_account(text,jsonb)', true),
  ('public.wirenexus_cloud(text,jsonb)', true),
  ('public.wirenexus_plans(text,jsonb)', true),
  ('public.wirenexus_organizations(text,jsonb)', true),
  ('public.wirenexus_workspace_library(text,jsonb)', true),
  ('public.wirenexus_publishing(text,jsonb)', false),
  ('public.wirenexus_invite_delivery(text,jsonb)', false),
  ('public.wirenexus_collaboration(text,jsonb)', false),
  ('public.wirenexus_live(text,jsonb)', false),
  ('public.wirenexus_collaboration_throttle(text)', false)
), privileges as (
  select signature, browser_rpc, to_regprocedure(signature) as oid from expected
)
select signature, oid is not null as present,
       coalesce(has_function_privilege('anon', oid, 'execute'), false) as anon_execute,
       coalesce(has_function_privilege('authenticated', oid, 'execute'), false) as authenticated_execute,
       coalesce(has_function_privilege('service_role', oid, 'execute'), false) as service_execute,
       oid is not null
         and not coalesce(has_function_privilege('anon', oid, 'execute'), false)
         and coalesce(has_function_privilege('authenticated', oid, 'execute'), false)=browser_rpc
         and (browser_rpc or coalesce(has_function_privilege('service_role', oid, 'execute'), false)) as expected_grants
from privileges order by signature;

-- Every application table must have RLS. live_presence alone is UNLOGGED.
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relpersistence,
       has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon_any_access,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'insert,update,delete') as authenticated_table_write
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and (n.nspname='wirenexus_private'
  or (n.nspname='public' and c.relname like 'wirenexus_%'))
order by schema_name, table_name;

-- Column-limited updates on profiles/workspaces are intentional; no other
-- direct browser writes are intended. Review against the runbook allowlist.
select table_schema, table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where grantee in ('anon','authenticated') and privilege_type<>'SELECT'
  and (table_schema='wirenexus_private'
    or (table_schema='public' and table_name like 'wirenexus_%'))
order by table_schema, table_name, column_name, grantee;

-- Only workspace_role/ platform_admin helpers may be executable by authenticated
-- in this private schema. No unmetered/snapshot guard/helper RPC is a public API.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='wirenexus_private'
order by p.proname;

-- Auth provision/registration and membership/operation invalidation triggers.
select n.nspname as schema_name, c.relname as table_name, t.tgname, t.tgenabled
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and (t.tgname like 'wirenexus_%' or t.tgname like 'live_%')
order by schema_name, table_name, t.tgname;

-- Do not ALTER ownership or ENABLE RLS on this Supabase-managed table.
select relrowsecurity as realtime_rls_enabled from pg_class
where oid=to_regclass('realtime.messages');
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname='realtime' and tablename='messages')
   or schemaname='wirenexus_private'
   or (schemaname='public' and tablename like 'wirenexus_%')
order by schemaname, tablename, policyname;

-- Supabase Dashboard's exposed-schema list still needs separate inspection.
-- This setting can be absent when PostgREST configuration is external.
select current_setting('pgrst.db_schemas', true) as database_exposed_schema_setting;

select registration_enabled=false as registration_closed
from wirenexus_private.account_policy where singleton;
select count(*) as auth_users,
       count(*) filter (where not exists (
         select 1 from public.wirenexus_workspaces w
         join public.wirenexus_memberships m on m.workspace_id=w.id
         where w.personal_owner_id=u.id and w.kind='personal'
           and m.user_id=u.id and m.role='owner'
       )) as users_missing_personal_owner_workspace
from auth.users u;
select count(*) as workspaces_missing_plan
from public.wirenexus_workspaces w
where not exists(select 1 from wirenexus_private.workspace_plans p where p.workspace_id=w.id);
select code, revision, features, limits from wirenexus_private.plan_definitions order by code;
select checkpoint_every, max_project_bytes from wirenexus_private.collaboration_policy where singleton;

commit;
