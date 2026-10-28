-- Apply after the owner-library and secure-publishing migrations. No signup is enabled.
begin;
create table wirenexus_private.account_policy (
  singleton boolean primary key default true check(singleton), registration_enabled boolean not null default false
);
insert into wirenexus_private.account_policy values(true,false);
create table wirenexus_private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(), reason text not null
);
alter table wirenexus_private.account_policy enable row level security;
alter table wirenexus_private.platform_admins enable row level security;
revoke all on wirenexus_private.account_policy,wirenexus_private.platform_admins from public,anon,authenticated;

create table public.wirenexus_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check(length(display_name)<=120)
);
create table public.wirenexus_workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120),
  kind text not null check(kind in ('personal','enterprise')),
  personal_owner_id uuid unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check((kind='personal' and personal_owner_id is not null) or (kind='enterprise' and personal_owner_id is null))
);
create table public.wirenexus_memberships (
  workspace_id uuid not null references public.wirenexus_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','admin','editor','viewer')),
  primary key(workspace_id,user_id)
);
create index wirenexus_memberships_user on public.wirenexus_memberships(user_id);

create function wirenexus_private.provision_account() returns trigger
language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
  insert into public.wirenexus_profiles(user_id,display_name)
    values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',''),120));
  insert into public.wirenexus_workspaces(name,kind,personal_owner_id)
    values('Personal workspace','personal',new.id) returning id into wid;
  insert into public.wirenexus_memberships values(wid,new.id,'owner');
  return new;
end $$;
create function wirenexus_private.registration_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- raw_app_meta_data is controlled by Auth administrators, unlike user metadata.
  if not exists(select 1 from wirenexus_private.account_policy where registration_enabled)
      and coalesce(new.raw_app_meta_data->>'wirenexus_provisioned','false')<>'true' then
    raise exception 'Registration is disabled' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function wirenexus_private.provision_account(),wirenexus_private.registration_guard() from public,anon,authenticated;
create trigger wirenexus_registration_guard before insert on auth.users for each row execute function wirenexus_private.registration_guard();
create trigger wirenexus_provision_account after insert on auth.users for each row execute function wirenexus_private.provision_account();

-- Existing users and owner data are retained; original library/artwork keys do not change.
insert into public.wirenexus_profiles(user_id,display_name)
  select id,left(coalesce(raw_user_meta_data->>'display_name',''),120) from auth.users;
insert into public.wirenexus_workspaces(name,kind,personal_owner_id)
  select 'Personal workspace','personal',id from auth.users;
insert into public.wirenexus_memberships
  select id,personal_owner_id,'owner' from public.wirenexus_workspaces where kind='personal';

create function wirenexus_private.workspace_role(wid uuid) returns text
language sql stable security definer set search_path='' as $$
  select role from public.wirenexus_memberships where workspace_id=wid and user_id=auth.uid()
$$;
create function wirenexus_private.platform_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal','aal1')='aal2'
    and exists(select 1 from wirenexus_private.platform_admins where user_id=auth.uid())
    and exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified' and factor_type='totp')
$$;
revoke all on function wirenexus_private.workspace_role(uuid),wirenexus_private.platform_admin() from public,anon;
grant usage on schema wirenexus_private to authenticated;
grant execute on function wirenexus_private.workspace_role(uuid),wirenexus_private.platform_admin() to authenticated;
alter table public.wirenexus_profiles enable row level security;
alter table public.wirenexus_workspaces enable row level security;
alter table public.wirenexus_memberships enable row level security;
revoke all on public.wirenexus_profiles,public.wirenexus_workspaces,public.wirenexus_memberships from public,anon,authenticated;
grant select on public.wirenexus_profiles,public.wirenexus_workspaces,public.wirenexus_memberships to authenticated;
grant update(display_name) on public.wirenexus_profiles to authenticated;
grant update(name) on public.wirenexus_workspaces to authenticated;
create policy own_profile_read on public.wirenexus_profiles for select to authenticated using(user_id=auth.uid());
create policy own_profile_update on public.wirenexus_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy workspace_read on public.wirenexus_workspaces for select to authenticated using(wirenexus_private.workspace_role(id) is not null);
create policy workspace_rename on public.wirenexus_workspaces for update to authenticated
  using(wirenexus_private.workspace_role(id) in ('owner','admin')) with check(wirenexus_private.workspace_role(id) in ('owner','admin'));
create policy members_read on public.wirenexus_memberships for select to authenticated using(wirenexus_private.workspace_role(workspace_id) is not null);
grant select on wirenexus_private.library,wirenexus_private.artwork to authenticated;
create policy own_library_read on wirenexus_private.library for select to authenticated using(account_id=auth.uid());
create policy own_artwork_read on wirenexus_private.artwork for select to authenticated using(account_id=auth.uid());

create function public.wirenexus_account(operation text default 'identity',payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); wid uuid; target uuid; desired text; target_role text; actor text; w public.wirenexus_workspaces; elevated boolean;
begin
  if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Sign in required' using errcode='42501'; end if;
  if operation='identity' then
    select id into wid from public.wirenexus_workspaces where personal_owner_id=uid and kind='personal';
    if wid is null then raise exception 'Account provisioning required' using errcode='42501'; end if;
    elevated:=wirenexus_private.platform_admin();
    return jsonb_build_object('accountId',uid,'workspaceId',wid,'workspaceRole','owner','admin',elevated,
      'mfaRequired',exists(select 1 from wirenexus_private.platform_admins where user_id=uid) and not elevated,
      'entitlements',jsonb_build_object('fullProductAccess',elevated,'personalLibrary',true),
      'workspaces',(select coalesce(jsonb_agg(jsonb_build_object('id',ws.id,'name',ws.name,'kind',ws.kind,'role',m.role) order by ws.created_at,ws.id),'[]')
        from public.wirenexus_workspaces ws join public.wirenexus_memberships m on m.workspace_id=ws.id where m.user_id=uid));
  end if;
  if operation not in ('set_member','remove_member') then raise exception 'Unsupported account operation'; end if;
  wid:=(payload->>'workspaceId')::uuid; target:=(payload->>'userId')::uuid; desired:=payload->>'role';
  select * into w from public.wirenexus_workspaces where id=wid for update;
  actor:=wirenexus_private.workspace_role(wid);
  if w.id is null or w.kind<>'enterprise' or coalesce(actor,'') not in ('owner','admin') then
    raise exception 'Workspace management not authorized' using errcode='42501';
  end if;
  select role into target_role from public.wirenexus_memberships where workspace_id=wid and user_id=target;
  if target is null or (operation='set_member' and coalesce(desired,'') not in ('owner','admin','editor','viewer')) then raise exception 'Invalid membership'; end if;
  if actor='admin' and (coalesce(target_role,'') in ('owner','admin') or (operation='set_member' and desired in ('owner','admin'))) then
    raise exception 'Only an Owner can manage Owners or Admins' using errcode='42501';
  end if;
  if target_role='owner' and (operation='remove_member' or desired<>'owner')
      and (select count(*) from public.wirenexus_memberships where workspace_id=wid and role='owner')<=1 then
    raise exception 'The workspace must retain an Owner' using errcode='42501';
  end if;
  if operation='remove_member' then delete from public.wirenexus_memberships where workspace_id=wid and user_id=target;
  else insert into public.wirenexus_memberships values(wid,target,desired) on conflict(workspace_id,user_id) do update set role=excluded.role;
  end if;
  return jsonb_build_object('workspaceId',wid,'userId',target);
end $$;
revoke all on function public.wirenexus_account(text,jsonb) from public,anon;
grant execute on function public.wirenexus_account(text,jsonb) to authenticated;

-- Same version-2 registry, CAS and verified artwork protocol, now scoped to any
-- authenticated personal workspace. Platform Admin is never a data-access bypass.
create or replace function public.wirenexus_library(operation text,payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); identity jsonb; current_doc jsonb; next_doc jsonb; entry record;
  bytes bytea; ref jsonb; asset_hash text; expected jsonb;
begin
  if uid is null or (payload ? 'expectedAccountId' and payload->>'expectedAccountId' is distinct from uid::text) then
    raise exception 'Account changed or sign in required' using errcode='42501';
  end if;
  identity:=public.wirenexus_account('identity');
  if operation='identity' then return identity; end if;
  if operation='upload' then
    asset_hash:=payload->>'hash';bytes:=decode(payload->>'base64','base64');
    if bytes is null or octet_length(bytes)=0 or encode(sha256(bytes),'hex') is distinct from asset_hash then raise exception 'Artwork hash mismatch'; end if;
    insert into wirenexus_private.artwork values(uid,asset_hash,bytes) on conflict do nothing;
    return jsonb_build_object('hash',asset_hash);
  end if;
  if operation='asset' then
    select a.bytes into bytes from wirenexus_private.artwork a where a.account_id=uid and a.hash=payload->>'hash';
    if bytes is null then raise exception 'Required artwork missing'; end if;
    return jsonb_build_object('base64',encode(bytes,'base64'));
  end if;
  insert into wirenexus_private.library(account_id) values(uid) on conflict do nothing;
  select l.document into current_doc from wirenexus_private.library l where l.account_id=uid for update;
  if operation='read' then return current_doc; end if;
  if operation<>'commit' then raise exception 'Unknown library operation'; end if;
  next_doc:=payload->'document';expected:=payload->'expectedRevisions';
  if (payload->>'expectedGeneration')::bigint is distinct from (current_doc->>'generation')::bigint then
    raise exception 'Library changed on another computer. Refresh and review before saving.' using errcode='40001';
  end if;
  if next_doc->>'version' is distinct from '2' or jsonb_typeof(next_doc->'entries') is distinct from 'object'
      or jsonb_typeof(next_doc->'migrations') is distinct from 'object'
      or (next_doc->>'generation')::bigint is distinct from (current_doc->>'generation')::bigint+1 then raise exception 'Invalid library document'; end if;
  for entry in select key from jsonb_each(current_doc->'entries') union select key from jsonb_each(next_doc->'entries') loop
    if current_doc->'entries'->entry.key is distinct from next_doc->'entries'->entry.key then
      if not coalesce(expected ? entry.key,false) or expected->entry.key is distinct from coalesce(current_doc->'entries'->entry.key->'revision','null'::jsonb) then
        raise exception 'Definition revision conflict' using errcode='40001';
      end if;
      if next_doc->'entries' ? entry.key then
        if entry.key in ('__proto__','constructor','prototype') or next_doc->'entries'->entry.key->'definition'->>'id' is distinct from entry.key
            or coalesce(next_doc->'entries'->entry.key->>'revision','')='' or next_doc->'entries'->entry.key->>'revision'=current_doc->'entries'->entry.key->>'revision'
            or jsonb_typeof(next_doc->'entries'->entry.key->'dependencies'->'nodes') is distinct from 'array'
            or jsonb_typeof(next_doc->'entries'->entry.key->'dependencies'->'devices') is distinct from 'array' then raise exception 'Invalid definition or unchanged revision'; end if;
      end if;
    end if;
  end loop;
  for ref in select value from jsonb_path_query(next_doc->'entries','$.** ? (@.type() == "string")') as v(value) loop
    if (ref #>> '{}') like 'wirenexus-artwork:%' then
      asset_hash:=substr(ref #>> '{}',19);
      if not exists(select 1 from wirenexus_private.artwork a where a.account_id=uid and a.hash=asset_hash) then raise exception 'Required artwork missing. Previous library retained.'; end if;
    elsif (ref #>> '{}') ~ '^(blob:|data:image/)' then raise exception 'Artwork must be stored by verified content identity'; end if;
  end loop;
  update wirenexus_private.library set document=next_doc where account_id=uid;
  return next_doc;
end $$;
revoke all on function public.wirenexus_library(text,jsonb) from public,anon;
grant execute on function public.wirenexus_library(text,jsonb) to authenticated;
commit;
