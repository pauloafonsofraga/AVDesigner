-- Phase 5 only. No signup, billing, realtime or destructive data migration.
begin;
update wirenexus_private.plan_definitions set features=features||jsonb_build_object('organizationTeams',code='enterprise'),
  limits=limits||jsonb_build_object('members',case when code='enterprise' then 100 else 1 end),revision=revision+1;
create table wirenexus_private.organization_policy(singleton boolean primary key default true check(singleton),max_owned integer not null default 5 check(max_owned between 1 and 100));
insert into wirenexus_private.organization_policy values(true,5);
create table wirenexus_private.organization_invites (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.wirenexus_workspaces(id),
  email text not null check(email=lower(trim(email)) and length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check(role in ('owner','admin','editor','viewer')),invited_by uuid not null references auth.users(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending_delivery' check(state in ('pending_delivery','sent','accepted','revoked','failed')),
  created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',
  accepted_by uuid references auth.users(id),accepted_at timestamptz
);
create unique index organization_invites_pending on wirenexus_private.organization_invites(workspace_id,email) where state in ('pending_delivery','sent');
create index organization_invites_workspace on wirenexus_private.organization_invites(workspace_id);
create table wirenexus_private.organization_library (
  workspace_id uuid primary key references public.wirenexus_workspaces(id),
  document jsonb not null default '{"version":2,"generation":0,"entries":{},"migrations":{}}'
);
create table wirenexus_private.organization_artwork (
  workspace_id uuid not null references public.wirenexus_workspaces(id),hash text not null check(hash ~ '^[a-f0-9]{64}$'),bytes bytea not null,
  primary key(workspace_id,hash),check(encode(sha256(bytes),'hex')=hash)
);
create table wirenexus_private.organization_events (
  id bigint generated always as identity primary key,workspace_id uuid not null references public.wirenexus_workspaces(id),
  actor_id uuid not null references auth.users(id),operation text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table wirenexus_private.organization_policy enable row level security;
alter table wirenexus_private.organization_invites enable row level security;
alter table wirenexus_private.organization_library enable row level security;
alter table wirenexus_private.organization_artwork enable row level security;
alter table wirenexus_private.organization_events enable row level security;
revoke all on wirenexus_private.organization_policy,wirenexus_private.organization_invites,wirenexus_private.organization_library,wirenexus_private.organization_artwork,wirenexus_private.organization_events from public,anon,authenticated;
grant select on wirenexus_private.organization_library,wirenexus_private.organization_artwork to authenticated;
create policy org_library_members on wirenexus_private.organization_library for select to authenticated using(wirenexus_private.workspace_role(workspace_id) is not null);
create policy org_artwork_members on wirenexus_private.organization_artwork for select to authenticated using(wirenexus_private.workspace_role(workspace_id) is not null);
create function wirenexus_private.seed_organization_library() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.kind='enterprise' then insert into wirenexus_private.organization_library(workspace_id) values(new.id);end if;return new;end $$;
revoke all on function wirenexus_private.seed_organization_library() from public,anon,authenticated;
create trigger wirenexus_organization_library after insert on public.wirenexus_workspaces for each row execute function wirenexus_private.seed_organization_library();
insert into wirenexus_private.organization_library(workspace_id) select id from public.wirenexus_workspaces where kind='enterprise';

alter table public.wirenexus_workspaces add column organization_settings jsonb not null default '{}',add column settings_revision bigint not null default 1;
create function wirenexus_private.validate_organization_settings() returns trigger language plpgsql set search_path='' as $$
begin
 if new.organization_settings is distinct from old.organization_settings then
   if new.kind<>'enterprise' or jsonb_typeof(new.organization_settings)<>'object' or octet_length(new.organization_settings::text)>2000
     or exists(select 1 from jsonb_object_keys(new.organization_settings) k where k not in ('website','contactEmail'))
     or (new.organization_settings ? 'website' and (jsonb_typeof(new.organization_settings->'website')<>'string' or (new.organization_settings->>'website'<>'' and new.organization_settings->>'website' !~ '^https://[^[:space:]]+$')))
     or (new.organization_settings ? 'contactEmail' and (jsonb_typeof(new.organization_settings->'contactEmail')<>'string' or length(new.organization_settings->>'contactEmail')>254)) then raise exception 'Invalid organization settings';end if;
 end if;
 new.settings_revision:=old.settings_revision+1;return new;
end $$;
revoke all on function wirenexus_private.validate_organization_settings() from public,anon,authenticated;
create trigger wirenexus_organization_settings before update of name,organization_settings on public.wirenexus_workspaces for each row execute function wirenexus_private.validate_organization_settings();
grant update(organization_settings) on public.wirenexus_workspaces to authenticated;

-- Replace in place: already prepared quota callers must retain the metered OID.
create or replace function wirenexus_private.plan_usage(wid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'projects',(select count(*) from wirenexus_private.cloud_projects where workspace_id=wid)+
     (select count(distinct project_id) from wirenexus_private.cloud_uploads u where workspace_id=wid and not committed and expires_at>now()
       and not exists(select 1 from wirenexus_private.cloud_projects p where p.id=u.project_id)),
   'storageBytes',(select coalesce(sum(byte_count),0) from wirenexus_private.cloud_uploads where workspace_id=wid and (committed or expires_at>now()))+
     (select coalesce(sum(project_bytes+html_bytes),0) from wirenexus_private.publications where workspace_id=wid)+
     (select coalesce(sum(octet_length(a.bytes)),0) from wirenexus_private.artwork a join public.wirenexus_workspaces w on w.personal_owner_id=a.account_id where w.id=wid)+
     (select coalesce(sum(octet_length(l.document::text)),0) from wirenexus_private.library l join public.wirenexus_workspaces w on w.personal_owner_id=l.account_id where w.id=wid)+
     (select coalesce(sum(octet_length(bytes)),0) from wirenexus_private.organization_artwork where workspace_id=wid)+
     (select coalesce(sum(octet_length(document::text)),0) from wirenexus_private.organization_library where workspace_id=wid),
   'historyVersions',(select coalesce(max(n),0) from (
     select project_id,count(*) n from (
       select v.project_id from wirenexus_private.cloud_versions v join wirenexus_private.cloud_projects p on p.id=v.project_id where p.workspace_id=wid
       union all select project_id from wirenexus_private.cloud_uploads where workspace_id=wid and not committed and expires_at>now()
     ) versions group by project_id) counts),
   'publications',(select count(*) from wirenexus_private.publications where workspace_id=wid and (status='published' or (status='pending' and expires_at>now()))),
   'members',(select count(*) from public.wirenexus_memberships where workspace_id=wid)+
     (select count(*) from wirenexus_private.organization_invites where workspace_id=wid and state in ('pending_delivery','sent') and expires_at>now()))
$$;
revoke all on function wirenexus_private.plan_usage(uuid) from public,anon,authenticated;

-- Close the old foundation's direct-insert membership path. Existing members
-- can still be managed after downgrade; adding members requires email acceptance.
alter function public.wirenexus_account(text,jsonb) rename to account_phase2;
alter function public.account_phase2(text,jsonb) set schema wirenexus_private;
revoke all on function wirenexus_private.account_phase2(text,jsonb) from public,anon,authenticated;
create function public.wirenexus_account(operation text default 'identity',payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare wid uuid;result jsonb;
begin
 if operation in ('set_member','remove_member') then
   wid:=(payload->>'workspaceId')::uuid;perform 1 from public.wirenexus_workspaces where id=wid for update;
   if coalesce(wirenexus_private.workspace_role(wid),'') not in ('owner','admin') then raise exception 'Workspace management not authorized' using errcode='42501';end if;
   perform wirenexus_private.publish_limit('org-members:'||auth.uid(),240,3600);
   if operation='set_member' and not exists(select 1 from public.wirenexus_memberships where workspace_id=wid and user_id=(payload->>'userId')::uuid) then
     raise exception 'Invite new members by email' using errcode='42501';end if;
 end if;
 result:=wirenexus_private.account_phase2(operation,payload);
 if operation in ('set_member','remove_member') then insert into wirenexus_private.organization_events(workspace_id,actor_id,operation,details) values(wid,auth.uid(),operation,jsonb_build_object('userId',payload->>'userId','role',payload->>'role'));end if;
 return result;
end $$;
revoke all on function public.wirenexus_account(text,jsonb) from public,anon;
grant execute on function public.wirenexus_account(text,jsonb) to authenticated;

create function public.wirenexus_organizations(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();wid uuid;personal uuid;w public.wirenexus_workspaces;inv wirenexus_private.organization_invites;
 actor text;issuer text;email_value text;policy jsonb;maximum numeric;result jsonb;
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' or payload->>'expectedAccountId' is distinct from uid::text then raise exception 'Sign in required or account changed' using errcode='42501';end if;
 if operation='list' then
   return (select coalesce(jsonb_agg(to_jsonb(ws)||jsonb_build_object('role',m.role) order by ws.created_at,ws.id),'[]') from public.wirenexus_workspaces ws join public.wirenexus_memberships m on m.workspace_id=ws.id where m.user_id=uid);
 elsif operation='create' then
   if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and email is not null) then raise exception 'Verified email required' using errcode='42501';end if;
   select id into personal from public.wirenexus_workspaces where personal_owner_id=uid for update;
   if personal is null or (select count(*) from public.wirenexus_workspaces ws join public.wirenexus_memberships m on m.workspace_id=ws.id where ws.kind='enterprise' and m.user_id=uid and m.role='owner') >= (select max_owned from wirenexus_private.organization_policy) then raise exception 'Organization creation limit reached';end if;
   insert into public.wirenexus_workspaces(name,kind) values(trim(payload->>'name'),'enterprise') returning * into w;
   insert into public.wirenexus_memberships values(w.id,uid,'owner');
   insert into wirenexus_private.organization_events(workspace_id,actor_id,operation) values(w.id,uid,'create');return to_jsonb(w)||jsonb_build_object('role','owner');
 elsif operation='accept' then
   if coalesce(payload->>'token','') !~ '^[a-f0-9]{64}$' then raise exception 'Invitation unavailable' using errcode='42501';end if;
   select * into inv from wirenexus_private.organization_invites where token_hash=encode(sha256(convert_to(payload->>'token','UTF8')),'hex');
   wid:=inv.workspace_id;perform 1 from public.wirenexus_workspaces where id=wid for update;
   select * into inv from wirenexus_private.organization_invites where id=inv.id for update;
   select lower(email) into email_value from auth.users where id=uid and email_confirmed_at is not null;
   select role into issuer from public.wirenexus_memberships where workspace_id=wid and user_id=inv.invited_by;
   if inv.id is null or inv.state<>'sent' or inv.expires_at<=now() or email_value is distinct from inv.email
      or coalesce(issuer,'') not in ('owner','admin') or (issuer='admin' and inv.role in ('owner','admin')) then raise exception 'Invitation unavailable or email not verified' using errcode='42501';end if;
   if not exists(select 1 from public.wirenexus_memberships where workspace_id=wid and user_id=uid) then
     policy:=wirenexus_private.plan_policy(wid,uid,auth.jwt()->>'aal');maximum:=(policy->'limits'->>'members')::numeric;
     if not coalesce((policy->'features'->>'organizationTeams')::boolean,false) then raise exception 'Enterprise teams entitlement required' using errcode='P0403';end if;
     if maximum is not null and (wirenexus_private.plan_usage(wid)->>'members')::numeric>maximum then raise exception 'Workspace members quota exceeded' using errcode='P0402';end if;
     insert into public.wirenexus_memberships values(wid,uid,inv.role);
   end if;
   update wirenexus_private.organization_invites set state='accepted',accepted_by=uid,accepted_at=now() where id=inv.id;
   insert into wirenexus_private.organization_events(workspace_id,actor_id,operation,details) values(wid,uid,'accept',jsonb_build_object('invitationId',inv.id));
   return jsonb_build_object('workspaceId',wid,'role',wirenexus_private.workspace_role(wid));
 end if;
 wid:=(payload->>'workspaceId')::uuid;select * into w from public.wirenexus_workspaces where id=wid for update;
 actor:=wirenexus_private.workspace_role(wid);
 if w.id is null or w.kind<>'enterprise' or actor is null then raise exception 'Organization access denied' using errcode='42501';end if;
 if operation='leave' then
   if actor='owner' and (select count(*) from public.wirenexus_memberships where workspace_id=wid and role='owner')<=1 then raise exception 'The workspace must retain an Owner';end if;
   delete from public.wirenexus_memberships where workspace_id=wid and user_id=uid;
 elsif operation in ('set_member','remove_member') then return public.wirenexus_account(operation,payload);
 elsif actor not in ('owner','admin') then raise exception 'Organization management not authorized' using errcode='42501';
 elsif operation='members' then
   return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'email',u.email,'role',m.role) order by u.email),'[]') from public.wirenexus_memberships m join auth.users u on u.id=m.user_id where m.workspace_id=wid),
     'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'state',case when expires_at<=now() and state in ('sent','pending_delivery') then 'expired' else state end,'expiresAt',expires_at) order by created_at desc),'[]') from wirenexus_private.organization_invites where workspace_id=wid));
 elsif operation='settings' then
   if w.settings_revision is distinct from (payload->>'expectedRevision')::bigint then raise exception 'Organization settings changed. Refresh.' using errcode='40001';end if;
   update public.wirenexus_workspaces set name=trim(payload->>'name'),organization_settings=payload->'settings' where id=wid returning * into w;result:=to_jsonb(w);
 elsif operation='revoke_invite' then
   select * into inv from wirenexus_private.organization_invites where id=(payload->>'invitationId')::uuid and workspace_id=wid;
   if inv.id is null or (actor='admin' and inv.role in ('owner','admin')) then raise exception 'Invitation management not authorized' using errcode='42501';end if;
   update wirenexus_private.organization_invites set state='revoked' where id=inv.id and state in ('pending_delivery','sent');
 else raise exception 'Unsupported organization operation';end if;
 insert into wirenexus_private.organization_events(workspace_id,actor_id,operation) values(wid,uid,operation);
 return coalesce(result,'{}');
end $$;
revoke all on function public.wirenexus_organizations(text,jsonb) from public,anon;
grant execute on function public.wirenexus_organizations(text,jsonb) to authenticated;

-- Email delivery is service-only; the actor was verified by Auth in the API.
create function public.wirenexus_invite_delivery(operation text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid;wid uuid;actor text;inv wirenexus_private.organization_invites;secret text;email_value text;role_value text;name_value text;
begin
 if uid is null then raise exception 'Invitation not authorized' using errcode='42501';end if;
 if operation='issue' then
   wid:=(payload->>'workspaceId')::uuid;perform 1 from public.wirenexus_workspaces where id=wid and kind='enterprise' for update;
   if not found then raise exception 'Organization unavailable' using errcode='42501';end if;
   actor:= (select role from public.wirenexus_memberships where workspace_id=wid and user_id=uid);role_value:=payload->>'role';email_value:=lower(trim(payload->>'email'));
   if coalesce(actor,'') not in ('owner','admin') or coalesce(role_value,'') not in ('owner','admin','editor','viewer') or (actor='admin' and role_value in ('owner','admin')) then raise exception 'Invitation not authorized' using errcode='42501';end if;
   perform wirenexus_private.publish_limit('team-invite-user:'||uid,50,3600);perform wirenexus_private.publish_limit('team-invite-org:'||wid,100,3600);
   if exists(select 1 from public.wirenexus_memberships m join auth.users u on u.id=m.user_id where m.workspace_id=wid and lower(u.email)=email_value) then raise exception 'This email is already a member';end if;
   update wirenexus_private.organization_invites set state='revoked' where workspace_id=wid and email=email_value and state in ('pending_delivery','sent');
   perform wirenexus_private.enforce_plan(wid,uid,payload->>'actorAal','organizationTeams','{"members":1}');
   secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
   insert into wirenexus_private.organization_invites(workspace_id,email,role,invited_by,token_hash) values(wid,email_value,role_value,uid,encode(sha256(convert_to(secret,'UTF8')),'hex')) returning * into inv;
   select name into name_value from public.wirenexus_workspaces where id=wid;
   insert into wirenexus_private.organization_events(workspace_id,actor_id,operation,details) values(wid,uid,'invite',jsonb_build_object('id',inv.id,'email',inv.email,'role',inv.role));
   return jsonb_build_object('id',inv.id,'token',secret,'email',inv.email,'name',name_value);
 end if;
 select * into inv from wirenexus_private.organization_invites where id=(payload->>'invitationId')::uuid;
 if inv.id is null or inv.invited_by<>uid then raise exception 'Invitation unavailable' using errcode='42501';end if;
 perform 1 from public.wirenexus_workspaces where id=inv.workspace_id for update;
 if operation='delivered' then
   update wirenexus_private.organization_invites set state='sent',expires_at=now()+interval '7 days' where id=inv.id and state='pending_delivery' and expires_at>now();
 elsif operation='failed' then update wirenexus_private.organization_invites set state='failed' where id=inv.id and state='pending_delivery';
 else raise exception 'Unsupported delivery operation';end if;
 return jsonb_build_object('id',inv.id);
end $$;
revoke all on function public.wirenexus_invite_delivery(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_invite_delivery(text,jsonb) to service_role;

create function public.wirenexus_workspace_library(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();wid uuid:=(payload->>'workspaceId')::uuid;actor text;current_doc jsonb;next_doc jsonb;expected jsonb;entry record;ref jsonb;bytes bytea;hash_value text;size bigint:=0;ident jsonb;
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' or (payload ? 'expectedAccountId' and payload->>'expectedAccountId' is distinct from uid::text) then raise exception 'Sign in required or account changed' using errcode='42501';end if;
 actor:=wirenexus_private.workspace_role(wid);
 if actor is null or not exists(select 1 from public.wirenexus_workspaces where id=wid and kind='enterprise') then raise exception 'Shared library access denied' using errcode='42501';end if;
 if operation='identity' then
   ident:=public.wirenexus_account('identity');return ident||jsonb_build_object('workspaceId',wid,'workspaceRole',actor);
 elsif operation='asset' then
   select a.bytes into bytes from wirenexus_private.organization_artwork a where a.workspace_id=wid and a.hash=payload->>'hash';
   if bytes is null then raise exception 'Required shared artwork missing';end if;return jsonb_build_object('base64',encode(bytes,'base64'));
 elsif operation='read' then return (select document from wirenexus_private.organization_library where workspace_id=wid);end if;
 perform 1 from public.wirenexus_workspaces where id=wid for update;
 if coalesce(wirenexus_private.workspace_role(wid),'') not in ('owner','admin','editor') then raise exception 'Shared library is read-only' using errcode='42501';end if;
 if operation='upload' then
   bytes:=decode(payload->>'base64','base64');hash_value:=payload->>'hash';
   if bytes is null or octet_length(bytes)=0 or encode(sha256(bytes),'hex') is distinct from hash_value then raise exception 'Artwork hash mismatch';end if;
   if not exists(select 1 from wirenexus_private.organization_artwork where workspace_id=wid and hash=hash_value) then size:=octet_length(bytes);end if;
   perform wirenexus_private.enforce_plan(wid,uid,auth.jwt()->>'aal','organizationTeams',jsonb_build_object('storageBytes',size));
   insert into wirenexus_private.organization_artwork values(wid,hash_value,bytes) on conflict do nothing;return jsonb_build_object('hash',hash_value);
 elsif operation<>'commit' then raise exception 'Unsupported shared library operation';end if;
 select document into current_doc from wirenexus_private.organization_library where workspace_id=wid for update;
 next_doc:=payload->'document';expected:=payload->'expectedRevisions';
 if (payload->>'expectedGeneration')::bigint is distinct from (current_doc->>'generation')::bigint then raise exception 'Shared library changed. Refresh and review before saving.' using errcode='40001';end if;
 if next_doc->>'version' is distinct from '2' or jsonb_typeof(next_doc->'entries') is distinct from 'object' or jsonb_typeof(next_doc->'migrations') is distinct from 'object'
   or (next_doc->>'generation')::bigint is distinct from (current_doc->>'generation')::bigint+1 then raise exception 'Invalid library document';end if;
 for entry in select key from jsonb_each(current_doc->'entries') union select key from jsonb_each(next_doc->'entries') loop
   if current_doc->'entries'->entry.key is distinct from next_doc->'entries'->entry.key then
     if not coalesce(expected ? entry.key,false) or expected->entry.key is distinct from coalesce(current_doc->'entries'->entry.key->'revision','null'::jsonb) then raise exception 'Definition revision conflict' using errcode='40001';end if;
     if next_doc->'entries' ? entry.key then
       if entry.key in ('__proto__','constructor','prototype') or next_doc->'entries'->entry.key->'definition'->>'id' is distinct from entry.key
         or coalesce(next_doc->'entries'->entry.key->>'revision','')='' or next_doc->'entries'->entry.key->>'revision'=current_doc->'entries'->entry.key->>'revision'
         or jsonb_typeof(next_doc->'entries'->entry.key->'dependencies'->'nodes') is distinct from 'array' or jsonb_typeof(next_doc->'entries'->entry.key->'dependencies'->'devices') is distinct from 'array' then raise exception 'Invalid definition or unchanged revision';end if;
     end if;
   end if;
 end loop;
 for ref in select value from jsonb_path_query(next_doc->'entries','$.** ? (@.type() == "string")') as v(value) loop
   if (ref #>> '{}') like 'wirenexus-artwork:%' then
     if not exists(select 1 from wirenexus_private.organization_artwork where workspace_id=wid and hash=substr(ref #>> '{}',19)) then raise exception 'Required shared artwork missing. Previous library retained.';end if;
   elsif (ref #>> '{}') ~ '^(blob:|data:image/)' then raise exception 'Artwork must be stored by verified content identity';end if;
 end loop;
 size:=greatest(0,octet_length(next_doc::text)-octet_length(current_doc::text));
 perform wirenexus_private.enforce_plan(wid,uid,auth.jwt()->>'aal','organizationTeams',jsonb_build_object('storageBytes',size));
 update wirenexus_private.organization_library set document=next_doc where workspace_id=wid;return next_doc;
end $$;
revoke all on function public.wirenexus_workspace_library(text,jsonb) from public,anon;
grant execute on function public.wirenexus_workspace_library(text,jsonb) to authenticated;
commit;
