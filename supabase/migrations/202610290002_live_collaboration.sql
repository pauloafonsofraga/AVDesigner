-- Requires Phase 6.3 and Supabase Realtime. Never broadcast project state or cursors.
begin;
create unlogged table wirenexus_private.live_presence (
  project_id uuid not null references wirenexus_private.collaboration_heads(project_id),
  actor_id uuid not null references auth.users(id), client_id uuid not null,
  cursor jsonb, drag jsonb, seen_at timestamptz not null default clock_timestamp(),
  primary key(project_id,actor_id,client_id)
);
alter table wirenexus_private.live_presence enable row level security;
revoke all on wirenexus_private.live_presence from public,anon,authenticated;

create function public.wirenexus_collaboration_throttle(source_key text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if source_key !~ '^[a-f0-9]{64}$' or source_key is null then raise exception 'Invalid source' using errcode='42501';end if;
 perform wirenexus_private.publish_limit('collaboration-auth:'||source_key,3600,60);
end $$;
revoke all on function public.wirenexus_collaboration_throttle(text) from public,anon,authenticated;
grant execute on function public.wirenexus_collaboration_throttle(text) to service_role;

-- Realtime authorizes at join/JWT refresh, NOT on every message. Each user receives
-- a separate inbox. Membership is evaluated at send time; payloads are hints only.
create function wirenexus_private.live_notify(pid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare recipient uuid;wid uuid;
begin
 select workspace_id into wid from wirenexus_private.cloud_projects where id=pid;
 for recipient in select user_id from public.wirenexus_memberships where workspace_id=wid loop
   if coalesce((wirenexus_private.plan_policy(wid,recipient,'aal1')->'features'->>'collaboration')::boolean,false) then
     perform realtime.send(jsonb_build_object('projectId',pid),'invalidate','wirenexus:user:'||recipient::text,true);
   end if;
 end loop;
exception when others then
 -- A transport outage must not roll back an authoritative accepted operation.
 raise warning 'WireNexus notification unavailable; clients will catch up by API';
end $$;
revoke all on function wirenexus_private.live_notify(uuid) from public,anon,authenticated;
create function wirenexus_private.live_operation_notify() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform wirenexus_private.live_notify(new.project_id);return new;end $$;
revoke all on function wirenexus_private.live_operation_notify() from public,anon,authenticated;
create trigger live_operation_accepted after insert on wirenexus_private.collaboration_operations
  for each row execute function wirenexus_private.live_operation_notify();

create function public.wirenexus_live(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid;pid uuid:=(payload->>'projectId')::uuid;wid uuid;role_name text;
 cid uuid:=(payload->>'clientId')::uuid;h wirenexus_private.collaboration_heads;point jsonb;field text;peers jsonb;
begin
 select workspace_id into wid from wirenexus_private.cloud_projects where id=pid;
 perform 1 from public.wirenexus_workspaces where id=wid and kind='enterprise' for update;
 if not found then raise exception 'Enterprise workspace required' using errcode='42501';end if;
 select role into role_name from public.wirenexus_memberships where workspace_id=wid and user_id=uid;
 if role_name is null or not coalesce((wirenexus_private.plan_policy(wid,uid,payload->>'actorAal')->'features'->>'collaboration')::boolean,false) then
   raise exception 'Live access denied' using errcode='42501';end if;
 perform wirenexus_private.publish_limit('live:'||uid::text,360,60);
 select * into h from wirenexus_private.collaboration_heads where project_id=pid;
 if operation not in ('status','presence','leave') then raise exception 'Invalid action' using errcode='22023';end if;
 if operation<>'status' then
   if h.project_id is null or cid is null then raise exception 'Live session unavailable' using errcode='22023';end if;
   if operation='leave' then delete from wirenexus_private.live_presence where project_id=pid and actor_id=uid and client_id=cid;
   else
     for field in select unnest(array['cursor','drag']) loop
       point:=payload->field;
       if point is not null and point<>'null'::jsonb then
         if jsonb_typeof(point) is distinct from 'object' or jsonb_typeof(point->'x') is distinct from 'number'
           or jsonb_typeof(point->'y') is distinct from 'number' or abs((point->>'x')::numeric)>10000000 or abs((point->>'y')::numeric)>10000000
           or (field='drag' and (length(point->>'id') not between 1 and 512 or point->>'id' is null))
           or exists(select 1 from jsonb_object_keys(point) k where k not in ('x','y',case when field='drag' then 'id' else 'x' end)) then
           raise exception 'Invalid temporary preview' using errcode='22023';end if;
       end if;
     end loop;
     if payload->'drag' is not null and payload->'drag'<>'null'::jsonb and
       (role_name='viewer' or not exists(select 1 from jsonb_array_elements(coalesce(h.document->'devices','[]')) d
         where coalesce(d->>'instanceId',d->>'id',d->>'deviceId')=payload->'drag'->>'id')) then
       raise exception 'Invalid drag preview' using errcode='22023';end if;
     delete from wirenexus_private.live_presence where seen_at<clock_timestamp()-interval '30 seconds';
     if (select count(*) from wirenexus_private.live_presence where actor_id=uid)>=16
       and not exists(select 1 from wirenexus_private.live_presence where project_id=pid and actor_id=uid and client_id=cid) then
       raise exception 'Too many open sessions' using errcode='22023';end if;
     insert into wirenexus_private.live_presence values(pid,uid,cid,payload->'cursor',payload->'drag',clock_timestamp())
       on conflict(project_id,actor_id,client_id) do update set cursor=excluded.cursor,drag=excluded.drag,seen_at=excluded.seen_at;
   end if;
   perform wirenexus_private.live_notify(pid);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('actorId',pr.actor_id,'clientId',pr.client_id,'cursor',pr.cursor,'drag',pr.drag)),'[]') into peers
   from wirenexus_private.live_presence pr join public.wirenexus_memberships m on m.workspace_id=wid and m.user_id=pr.actor_id
   where pr.project_id=pid and pr.seen_at>clock_timestamp()-interval '30 seconds';
 return jsonb_build_object('active',h.project_id is not null,'sequence',h.sequence,'sessionId',h.session_id,
   'writable',role_name in ('owner','admin','editor'),'peers',peers);
end $$;
revoke all on function public.wirenexus_live(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_live(text,jsonb) to service_role;

create function wirenexus_private.live_membership_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 for pid in select p.id from wirenexus_private.cloud_projects p join wirenexus_private.collaboration_heads h on h.project_id=p.id where p.workspace_id=old.workspace_id loop
   delete from wirenexus_private.live_presence where project_id=pid and actor_id=old.user_id;
   begin perform realtime.send(jsonb_build_object('projectId',pid),'invalidate','wirenexus:user:'||old.user_id::text,true);
   exception when others then null;end;
   perform wirenexus_private.live_notify(pid);
 end loop;
 return old;
end $$;
revoke all on function wirenexus_private.live_membership_changed() from public,anon,authenticated;
create trigger live_membership_changed after delete or update on public.wirenexus_memberships
  for each row execute function wirenexus_private.live_membership_changed();

create policy wirenexus_live_inbox on realtime.messages for select to authenticated
  using(realtime.topic()='wirenexus:user:'||auth.uid()::text and extension='broadcast');
create policy wirenexus_live_read_namespace on realtime.messages as restrictive for select to authenticated
  using(realtime.topic() not like 'wirenexus:user:%' or (realtime.topic()='wirenexus:user:'||auth.uid()::text and extension='broadcast'));
create policy wirenexus_live_no_client_send on realtime.messages as restrictive for insert to authenticated
  with check(realtime.topic() not like 'wirenexus:user:%');

-- Let ordinary Cloud Open discover active sessions without probing an extra API
-- for every historical/non-collaborative project. Existing authorization runs first.
alter function public.wirenexus_cloud(text,jsonb) rename to cloud_live_snapshot_guard;
alter function public.cloud_live_snapshot_guard(text,jsonb) set schema wirenexus_private;
revoke all on function wirenexus_private.cloud_live_snapshot_guard(text,jsonb) from public,anon,authenticated;
create function public.wirenexus_cloud(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=wirenexus_private.cloud_live_snapshot_guard(operation,payload);
 if operation='list' then
   return (select coalesce(jsonb_agg(item||jsonb_build_object('collaboration_active',
     exists(select 1 from wirenexus_private.collaboration_heads where project_id=(item->>'id')::uuid))),'[]') from jsonb_array_elements(result) item);
 end if;
 return result;
end $$;
revoke all on function public.wirenexus_cloud(text,jsonb) from public,anon;
grant execute on function public.wirenexus_cloud(text,jsonb) to authenticated;
commit;
