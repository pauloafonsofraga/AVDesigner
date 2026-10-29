-- Auth applies custom app_metadata after INSERT. Bind each approved Admin API
-- creation to a short-lived UUID/email authorization instead of exempting Auth.
begin;

create table wirenexus_private.admin_provisioning_authorizations (
  user_id uuid primary key,
  email_sha256 text not null check (email_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
alter table wirenexus_private.admin_provisioning_authorizations enable row level security;
revoke all on wirenexus_private.admin_provisioning_authorizations
  from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function wirenexus_private.registration_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from wirenexus_private.account_policy where registration_enabled)
      and coalesce(new.raw_app_meta_data->>'wirenexus_provisioned','false')<>'true' then
    -- DELETE locks and consumes exactly one authorization in the Auth transaction.
    -- A failed user/profile/workspace transaction restores it through rollback.
    delete from wirenexus_private.admin_provisioning_authorizations
      where user_id=new.id
        and email_sha256=encode(sha256(convert_to(lower(btrim(new.email)),'UTF8')),'hex')
        and expires_at>clock_timestamp();
    if not found then
      raise exception 'Registration is disabled' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function wirenexus_private.registration_guard() from public,anon,authenticated;

commit;
