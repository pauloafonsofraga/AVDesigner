-- Phase 4: policy only; no registration, billing, deletion or deployment.
begin;
create table wirenexus_private.plan_definitions (
  code text primary key check(code in ('free','paid','enterprise')), revision bigint not null default 1,
  features jsonb not null, limits jsonb not null
);
insert into wirenexus_private.plan_definitions values
 ('free',1,'{"cloudSave":true,"historyRecovery":true,"publishing":false}',
   '{"projects":3,"storageBytes":104857600,"historyVersions":5,"publications":0}'),
 ('paid',1,'{"cloudSave":true,"historyRecovery":true,"publishing":true}',
   '{"projects":100,"storageBytes":5368709120,"historyVersions":100,"publications":25}'),
 ('enterprise',1,'{"cloudSave":true,"historyRecovery":true,"publishing":true}',
   '{"projects":1000,"storageBytes":53687091200,"historyVersions":500,"publications":250}');
create table wirenexus_private.workspace_plans (
  workspace_id uuid primary key references public.wirenexus_workspaces(id),
  plan_code text not null default 'free' references wirenexus_private.plan_definitions(code),
  status text not null default 'active' check(status in ('active','revoked')),
  revision bigint not null default 1, updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  provider text not null default 'manual' check(provider in ('manual','stripe')),
  provider_customer_ref text, provider_subscription_ref text
);
create table wirenexus_private.plan_events (
  id bigint generated always as identity primary key, actor_id uuid not null references auth.users(id),
  operation text not null, details jsonb not null, created_at timestamptz not null default now()
);
alter table wirenexus_private.plan_definitions enable row level security;
alter table wirenexus_private.workspace_plans enable row level security;
alter table wirenexus_private.plan_events enable row level security;
revoke all on wirenexus_private.plan_definitions,wirenexus_private.workspace_plans,wirenexus_private.plan_events from public,anon,authenticated;
create function wirenexus_private.default_workspace_plan() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into wirenexus_private.workspace_plans(workspace_id) values(new.id);return new;end $$;
revoke all on function wirenexus_private.default_workspace_plan() from public,anon,authenticated;
create trigger wirenexus_workspace_plan after insert on public.wirenexus_workspaces for each row execute function wirenexus_private.default_workspace_plan();
insert into wirenexus_private.workspace_plans(workspace_id) select id from public.wirenexus_workspaces;
alter table wirenexus_private.publications add column workspace_id uuid references public.wirenexus_workspaces(id);
update wirenexus_private.publications p set workspace_id=w.id from public.wirenexus_workspaces w where w.personal_owner_id=p.owner_id;
alter table wirenexus_private.publications alter column workspace_id set not null;
create index publications_workspace on wirenexus_private.publications(workspace_id);

create function wirenexus_private.plan_admin(uid uuid,aal text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(aal,'aal1')='aal2' and exists(select 1 from wirenexus_private.platform_admins where user_id=uid)
   and exists(select 1 from auth.mfa_factors where user_id=uid and status='verified' and factor_type='totp')
$$;
create function wirenexus_private.plan_policy(wid uuid,uid uuid,aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare assignment wirenexus_private.workspace_plans; def wirenexus_private.plan_definitions; elevated boolean;
begin
 select * into assignment from wirenexus_private.workspace_plans where workspace_id=wid;
 select * into def from wirenexus_private.plan_definitions where code=case when assignment.status='active' then assignment.plan_code else 'free' end for share;
 if def.code is null then raise exception 'Workspace plan unavailable';end if;
 elevated:=wirenexus_private.plan_admin(uid,aal);
 return jsonb_build_object('plan',def.code,'assignedPlan',assignment.plan_code,'status',assignment.status,'revision',assignment.revision,
   'adminOverride',elevated,'features',case when elevated then (select jsonb_object_agg(key,true) from jsonb_object_keys(def.features) k(key)) else def.features end,
   'limits',case when elevated then (select jsonb_object_agg(key,null::text) from jsonb_object_keys(def.limits) k(key)) else def.limits end);
end $$;
create function wirenexus_private.plan_usage(wid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'projects',(select count(*) from wirenexus_private.cloud_projects where workspace_id=wid)+
     (select count(distinct project_id) from wirenexus_private.cloud_uploads u where workspace_id=wid and not committed and expires_at>now()
       and not exists(select 1 from wirenexus_private.cloud_projects p where p.id=u.project_id)),
   'storageBytes',(select coalesce(sum(byte_count),0) from wirenexus_private.cloud_uploads where workspace_id=wid and (committed or expires_at>now()))+
     (select coalesce(sum(project_bytes+html_bytes),0) from wirenexus_private.publications where workspace_id=wid)+
     (select coalesce(sum(octet_length(a.bytes)),0) from wirenexus_private.artwork a join public.wirenexus_workspaces w on w.personal_owner_id=a.account_id where w.id=wid)+
     (select coalesce(sum(octet_length(l.document::text)),0) from wirenexus_private.library l join public.wirenexus_workspaces w on w.personal_owner_id=l.account_id where w.id=wid),
   'historyVersions',(select coalesce(max(n),0) from (
     select project_id,count(*) n from (
       select v.project_id from wirenexus_private.cloud_versions v join wirenexus_private.cloud_projects p on p.id=v.project_id where p.workspace_id=wid
       union all select project_id from wirenexus_private.cloud_uploads where workspace_id=wid and not committed and expires_at>now()
     ) versions group by project_id) counts),
   'publications',(select count(*) from wirenexus_private.publications where workspace_id=wid and (status='published' or (status='pending' and expires_at>now()))))
$$;
-- All positive resource mutations take this workspace lock, including reservations.
-- Configuration SHARE locks serialize quota edits with writers at the DB boundary.
create function wirenexus_private.enforce_plan(wid uuid,uid uuid,aal text,feature text,deltas jsonb default '{}',pid uuid default null,history_delta integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare policy jsonb; usage jsonb; k text; amount numeric; maximum numeric;
begin
 perform 1 from public.wirenexus_workspaces where id=wid for update;
 if not exists(select 1 from public.wirenexus_memberships where workspace_id=wid and user_id=uid and role in ('owner','admin','editor')) then
   raise exception 'Workspace write access denied' using errcode='42501';end if;
 policy:=wirenexus_private.plan_policy(wid,uid,aal);
 if feature is not null and not coalesce((policy->'features'->>feature)::boolean,false) then
   raise exception 'This feature is not included in the workspace plan' using errcode='P0403';end if;
 usage:=wirenexus_private.plan_usage(wid);
 for k in select jsonb_object_keys(deltas) loop
   amount:=coalesce((usage->>k)::numeric,0)+(deltas->>k)::numeric;maximum:=(policy->'limits'->>k)::numeric;
   if maximum is not null and amount>maximum then raise exception 'Workspace % quota exceeded. Existing data is retained; upgrade or use local Save As.',k using errcode='P0402';end if;
 end loop;
 if pid is not null then
   select count(*) into amount from wirenexus_private.cloud_versions where project_id=pid;
   amount:=amount+(select count(*) from wirenexus_private.cloud_uploads where project_id=pid and not committed and expires_at>now())+history_delta;
   maximum:=(policy->'limits'->>'historyVersions')::numeric;
   if maximum is not null and amount>maximum then raise exception 'Workspace historyVersions quota exceeded. Existing versions remain readable.' using errcode='P0402';end if;
 end if;
end $$;
revoke all on function wirenexus_private.plan_admin(uuid,text),wirenexus_private.plan_policy(uuid,uuid,text),wirenexus_private.plan_usage(uuid),wirenexus_private.enforce_plan(uuid,uuid,text,text,jsonb,uuid,integer) from public,anon,authenticated;

create function public.wirenexus_plans(operation text default 'status',payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); wid uuid; assignment wirenexus_private.workspace_plans; def wirenexus_private.plan_definitions; k text; value jsonb; kind text; details jsonb;
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' or payload->>'expectedAccountId' is distinct from uid::text then
   raise exception 'Sign in required or account changed' using errcode='42501';end if;
 if operation='status' then
   return (select coalesce(jsonb_agg(jsonb_build_object('workspaceId',w.id,'name',w.name,'kind',w.kind,'role',m.role,
     'policy',wirenexus_private.plan_policy(w.id,uid,auth.jwt()->>'aal'),'usage',wirenexus_private.plan_usage(w.id)) order by w.created_at,w.id),'[]')
     from public.wirenexus_workspaces w join public.wirenexus_memberships m on m.workspace_id=w.id where m.user_id=uid);
 end if;
 if not wirenexus_private.platform_admin() then raise exception 'MFA-verified Platform Admin required' using errcode='42501';end if;
 if operation='definitions' then return (select jsonb_agg(to_jsonb(d) order by code) from wirenexus_private.plan_definitions d);end if;
 if operation='configure' then
   select * into def from wirenexus_private.plan_definitions where code=payload->>'plan' for update;
   if def.code is null then raise exception 'Unknown plan';end if;
   if def.revision is distinct from (payload->>'expectedRevision')::bigint then raise exception 'Plan configuration changed. Refresh.' using errcode='40001';end if;
   for k in select jsonb_object_keys(def.features) loop
     if jsonb_typeof(payload->'features'->k) is distinct from 'boolean' then raise exception 'Invalid feature configuration';end if;
   end loop;
   if (select count(*) from jsonb_object_keys(payload->'features'))<>(select count(*) from jsonb_object_keys(def.features)) then raise exception 'Unknown feature';end if;
   for k in select jsonb_object_keys(def.limits) loop
     value:=payload->'limits'->k;
     if value is null or (value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$' or (value::text)::numeric>9007199254740991)) then raise exception 'Invalid quota configuration';end if;
   end loop;
   if (select count(*) from jsonb_object_keys(payload->'limits'))<>(select count(*) from jsonb_object_keys(def.limits)) then raise exception 'Unknown quota';end if;
   update wirenexus_private.plan_definitions set features=payload->'features',limits=payload->'limits',revision=revision+1 where code=def.code returning * into def;
   details:=to_jsonb(def);
 elsif operation in ('assignment','assign','revoke') then
   wid:=(payload->>'workspaceId')::uuid;
   select w.kind into kind from public.wirenexus_workspaces w where id=wid for update;
   if kind is null then raise exception 'Workspace not found';end if;
   select * into assignment from wirenexus_private.workspace_plans where workspace_id=wid;
   if operation='assignment' then return to_jsonb(assignment);end if;
   if assignment.revision is distinct from (payload->>'expectedRevision')::bigint then raise exception 'Workspace plan changed. Refresh.' using errcode='40001';end if;
   if operation='assign' and (payload->>'plan' not in ('free','paid','enterprise') or payload->>'plan' is null or (payload->>'plan'='enterprise' and kind<>'enterprise')) then raise exception 'Enterprise plans require an organization workspace';end if;
   update wirenexus_private.workspace_plans set plan_code=case when operation='assign' then payload->>'plan' else plan_code end,
     status=case when operation='revoke' then 'revoked' else 'active' end,revision=revision+1,updated_by=uid,updated_at=now()
     where workspace_id=wid returning * into assignment;
   details:=to_jsonb(assignment);
 else raise exception 'Unsupported plan operation';end if;
 insert into wirenexus_private.plan_events(actor_id,operation,details) values(uid,operation,details);
 return details;
end $$;
revoke all on function public.wirenexus_plans(text,jsonb) from public,anon;
grant execute on function public.wirenexus_plans(text,jsonb) to authenticated;

-- Keep the tested Phase 3 implementation private and meter all public mutations.
alter function public.wirenexus_cloud(text,jsonb) rename to cloud_unmetered;
alter function public.cloud_unmetered(text,jsonb) set schema wirenexus_private;
revoke all on function wirenexus_private.cloud_unmetered(text,jsonb) from public,anon,authenticated;
create function public.wirenexus_cloud(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); wid uuid; pid uuid; u wirenexus_private.cloud_uploads; p wirenexus_private.cloud_projects; size bigint; delta jsonb; hd integer:=0; feature text:='cloudSave';
begin
 if uid is null or payload->>'expectedAccountId' is distinct from uid::text then raise exception 'Account changed' using errcode='42501';end if;
 if operation in ('begin','chunk','finish','duplicate','recover') then
   if operation='begin' then
     wid:=(payload->>'workspaceId')::uuid;pid:=(payload->>'projectId')::uuid;
     if pid is not null and not exists(select 1 from wirenexus_private.cloud_projects where id=pid and workspace_id=wid) then
       raise exception 'Project access denied' using errcode='42501';end if;
     delta:=jsonb_build_object('storageBytes',(payload->>'byteCount')::bigint,'projects',case when pid is null then 1 else 0 end);
     hd:=1;
   elsif operation in ('chunk','finish') then
     select * into u from wirenexus_private.cloud_uploads where id=(payload->>'uploadId')::uuid;
     if u.created_by is distinct from uid then raise exception 'Upload unavailable' using errcode='42501';end if;
     wid:=u.workspace_id;pid:=u.project_id;delta:='{"storageBytes":0,"projects":0}';
   else
     pid:=(payload->>'projectId')::uuid;select * into p from wirenexus_private.cloud_projects where id=pid;wid:=p.workspace_id;
     select up.byte_count into size from wirenexus_private.cloud_versions v join wirenexus_private.cloud_uploads up on up.id=v.upload_id
       where v.project_id=pid and ((payload->>'versionId' is null and v.version=p.current_version) or v.id=(payload->>'versionId')::uuid);
     delta:=jsonb_build_object('storageBytes',coalesce(size,0),'projects',case when operation='duplicate' then 1 else 0 end);
     hd:=case when operation='recover' then 1 else 0 end;
     if operation='recover' then feature:='historyRecovery';end if;
   end if;
   perform wirenexus_private.enforce_plan(wid,uid,auth.jwt()->>'aal',feature,delta,
     case when operation='duplicate' then null else pid end,hd);
   if (operation='begin' and pid is null) or operation='duplicate' then
     -- New projects also consume their first history slot.
     if (wirenexus_private.plan_policy(wid,uid,auth.jwt()->>'aal')->'limits'->>'historyVersions')::numeric<1 then raise exception 'Workspace historyVersions quota exceeded' using errcode='P0402';end if;
   end if;
 end if;
 return wirenexus_private.cloud_unmetered(operation,payload);
end $$;
revoke all on function public.wirenexus_cloud(text,jsonb) from public,anon;
grant execute on function public.wirenexus_cloud(text,jsonb) to authenticated;

alter function public.wirenexus_library(text,jsonb) rename to library_unmetered;
alter function public.library_unmetered(text,jsonb) set schema wirenexus_private;
revoke all on function wirenexus_private.library_unmetered(text,jsonb) from public,anon,authenticated;
create function public.wirenexus_library(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); wid uuid; size bigint:=0;old_size bigint:=0;
begin
 if operation in ('upload','commit') then
   if uid is null or (payload ? 'expectedAccountId' and payload->>'expectedAccountId' is distinct from uid::text) then raise exception 'Account changed' using errcode='42501';end if;
   select id into wid from public.wirenexus_workspaces where personal_owner_id=uid;
   -- Lock before measuring deduplicated artwork/metadata deltas.
   perform 1 from public.wirenexus_workspaces where id=wid for update;
   if operation='upload' then
     if not exists(select 1 from wirenexus_private.artwork where account_id=uid and hash=payload->>'hash') then size:=octet_length(decode(payload->>'base64','base64'));end if;
   else
     select octet_length(document::text) into old_size from wirenexus_private.library where account_id=uid;
     size:=greatest(0,octet_length((payload->'document')::text)-coalesce(old_size,0));
   end if;
   if size>0 then perform wirenexus_private.enforce_plan(wid,uid,auth.jwt()->>'aal',null,jsonb_build_object('storageBytes',size));end if;
 end if;
 return wirenexus_private.library_unmetered(operation,payload);
end $$;
revoke all on function public.wirenexus_library(text,jsonb) from public,anon;
grant execute on function public.wirenexus_library(text,jsonb) to authenticated;

-- Service-only publishing retains ownership/path/password protections. The API
-- supplies the verified actor and AAL, never client-controlled subscription flags.
create or replace function public.wirenexus_publishing(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; wid uuid; p wirenexus_private.publications; ident text; prefix text; m jsonb; delta jsonb;
begin
 if operation='throttle' then
   if payload->>'scope' not in ('branding','unlock','auth') or payload->>'key' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid throttle';end if;
   perform wirenexus_private.publish_limit((payload->>'scope')||':'||(payload->>'key'),case payload->>'scope' when 'unlock' then 15 when 'auth' then 60 else 90 end,60);
   if payload->>'scope'='unlock' and payload->>'publicationId' ~ '^[a-z0-9][a-z0-9-]{2,90}$' then perform wirenexus_private.publish_limit('unlock-publication:'||(payload->>'publicationId'),60,60);end if;
   return '{}'::jsonb;
 end if;
 if operation='lookup' then
   select * into p from wirenexus_private.publications where id=payload->>'id';
   if not found then return 'null'::jsonb;end if;
   if p.status<>'published' then return jsonb_build_object('unavailable',true);end if;
   return p.metadata || jsonb_build_object('htmlPath',p.html_path,'projectPath',p.project_path);
 end if;
 uid:=(payload->>'accountId')::uuid;
 if uid is null then raise exception 'Publishing not authorized' using errcode='42501';end if;
 if operation='reserve' then
   wid:=(payload->>'workspaceId')::uuid;
   if wid is null then select id into wid from public.wirenexus_workspaces where personal_owner_id=uid;end if;
   delta:=jsonb_build_object('publications',1,'storageBytes',(payload->>'projectBytes')::bigint+(payload->>'htmlBytes')::bigint);
 else
   select * into p from wirenexus_private.publications where id=payload->>'id';
   if not found or p.owner_id<>uid then raise exception 'Publication unavailable' using errcode='42501';end if;
   wid:=p.workspace_id;delta:='{"publications":0,"storageBytes":0}';
 end if;
 if operation<>'revoke' then
   if exists(select 1 from wirenexus_private.publishers where account_id=uid and not enabled) then raise exception 'Publishing disabled' using errcode='42501';end if;
   perform wirenexus_private.enforce_plan(wid,uid,payload->>'actorAal','publishing',delta);
 else
   -- Owners can revoke their own publication even after downgrade/membership loss.
   perform 1 from public.wirenexus_workspaces where id=wid for update;
 end if;
 if operation='reserve' then
   perform wirenexus_private.publish_limit('reserve:'||uid,20,3600);
   perform wirenexus_private.publish_limit('reserve-day:'||uid,40,86400);
   ident:='pub-'||gen_random_uuid()::text;prefix:='avdesigner/publications/'||uid||'/'||ident||'/';
   insert into wirenexus_private.publications(id,owner_id,workspace_id,project_path,html_path,project_bytes,html_bytes)
     values(ident,uid,wid,prefix||'project.json',prefix||'viewer.html',(payload->>'projectBytes')::bigint,(payload->>'htmlBytes')::bigint) returning * into p;
 else
   select * into p from wirenexus_private.publications where id=p.id for update;
   if operation='revoke' then
     perform wirenexus_private.publish_limit('manage:'||uid,60,3600);
     update wirenexus_private.publications set status='revoked' where id=p.id;
     return jsonb_build_object('id',p.id,'revoked',true);
   end if;
   if p.status<>'pending' or p.expires_at<=now() then raise exception 'Publication is no longer pending' using errcode='42501';end if;
   if operation='upload' then
     perform wirenexus_private.publish_limit('upload:'||uid,120,3600);
     if coalesce(payload->>'pathname','') not in (p.project_path,p.html_path) then raise exception 'Upload path not authorized' using errcode='42501';end if;
   elsif operation='finalize' then
     perform wirenexus_private.publish_limit('finalize:'||uid,60,3600);m:=payload->'metadata';
     if jsonb_typeof(m) is distinct from 'object' or coalesce(length(m->>'title'),0) not between 1 and 120
       or coalesce(m->'password'->>'hash','') !~ '^[a-f0-9]{64}$' or coalesce(m->'password'->>'salt','') !~ '^[a-f0-9]{32}$'
       or m->'password'->>'iterations' is distinct from '120000' or m->'password'->>'digest' is distinct from 'sha256'
       or octet_length(m::text)>1100000 then raise exception 'Invalid publication metadata';end if;
     update wirenexus_private.publications set metadata=m,status='published' where id=p.id;
   elsif operation<>'pending' then raise exception 'Invalid operation';end if;
 end if;
 return jsonb_build_object('id',p.id,'projectPath',p.project_path,'htmlPath',p.html_path,'projectBytes',p.project_bytes,'htmlBytes',p.html_bytes,'expiresAt',p.expires_at);
end $$;
revoke all on function public.wirenexus_publishing(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_publishing(text,jsonb) to service_role;
commit;
