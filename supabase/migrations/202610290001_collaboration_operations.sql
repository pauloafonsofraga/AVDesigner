-- Phase 6.3. Apply after Phase 5, in staging first. No browser table writes.
begin;
update wirenexus_private.plan_definitions set features=features||jsonb_build_object('collaboration',code='enterprise');
create table wirenexus_private.collaboration_policy (
  singleton boolean primary key default true check(singleton),
  checkpoint_every integer not null default 50 check(checkpoint_every between 1 and 1000),
  max_project_bytes integer not null default 3145728 check(max_project_bytes between 1024 and 3145728)
);
insert into wirenexus_private.collaboration_policy default values;
create table wirenexus_private.collaboration_heads (
  project_id uuid primary key references wirenexus_private.cloud_projects(id),
  session_id uuid not null default gen_random_uuid(), sequence bigint not null default 0 check(sequence>=0),
  document jsonb not null, replay_state jsonb not null,
  checkpoint_sequence bigint not null default 0, checkpoint_version_id uuid not null references wirenexus_private.cloud_versions(id),
  checkpoint_state jsonb not null, updated_at timestamptz not null default now()
);
create table wirenexus_private.collaboration_operations (
  project_id uuid not null references wirenexus_private.collaboration_heads(project_id),
  sequence bigint not null, command_id text not null check(length(command_id) between 1 and 512),
  actor_id uuid not null references auth.users(id), request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  command jsonb not null check(octet_length(command::text)<=524288),
  receipt jsonb not null, created_at timestamptz not null default now(),
  primary key(project_id,sequence), unique(project_id,command_id)
);
create table wirenexus_private.collaboration_rate (
  actor_id uuid primary key references auth.users(id), window_start timestamptz not null, requests integer not null
);
alter table wirenexus_private.collaboration_policy enable row level security;
alter table wirenexus_private.collaboration_heads enable row level security;
alter table wirenexus_private.collaboration_operations enable row level security;
alter table wirenexus_private.collaboration_rate enable row level security;
revoke all on wirenexus_private.collaboration_policy,wirenexus_private.collaboration_heads,
  wirenexus_private.collaboration_operations,wirenexus_private.collaboration_rate from public,anon,authenticated;

-- Keep the existing function OID: already-prepared quota calls must see this usage.
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
     (select coalesce(sum(octet_length(document::text)),0) from wirenexus_private.organization_library where workspace_id=wid)+
     (select coalesce(sum(octet_length(h.document::text)+octet_length(h.replay_state::text)+octet_length(h.checkpoint_state::text)),0)
        from wirenexus_private.collaboration_heads h join wirenexus_private.cloud_projects p on p.id=h.project_id where p.workspace_id=wid)+
     (select coalesce(sum(octet_length(o.command::text)+octet_length(o.receipt::text)),0)
        from wirenexus_private.collaboration_operations o join wirenexus_private.cloud_projects p on p.id=o.project_id where p.workspace_id=wid),
   'historyVersions',(select coalesce(max(n),0) from (
     select project_id,count(*) n from (
       select v.project_id from wirenexus_private.cloud_versions v join wirenexus_private.cloud_projects p on p.id=v.project_id where p.workspace_id=wid
       union all select project_id from wirenexus_private.cloud_uploads where workspace_id=wid and not committed and expires_at>now()
     ) versions group by project_id) counts),
   'publications',(select count(*) from wirenexus_private.publications where workspace_id=wid and (status='published' or (status='pending' and expires_at>now()))),
   'members',(select count(*) from public.wirenexus_memberships where workspace_id=wid)+
     (select count(*) from wirenexus_private.organization_invites where workspace_id=wid and state in ('pending_delivery','sent') and expires_at>now()))
$$;

-- Called only with workspace then project locks held; bytes come from the validated
-- durable head, never a checkpoint snapshot supplied by the caller.
create function wirenexus_private.collaboration_checkpoint(pid uuid,uid uuid,aal text) returns void
language plpgsql security definer set search_path='' as $$
declare h wirenexus_private.collaboration_heads; p wirenexus_private.cloud_projects; content bytea; up uuid; vid uuid; n integer;
begin
 select * into h from wirenexus_private.collaboration_heads where project_id=pid;
 if h.sequence=h.checkpoint_sequence then return;end if;
 select * into p from wirenexus_private.cloud_projects where id=pid;
 content:=convert_to(h.document::text,'UTF8');
 perform wirenexus_private.enforce_plan(p.workspace_id,uid,aal,'collaboration',
   jsonb_build_object('storageBytes',octet_length(content)+octet_length(h.replay_state::text)-octet_length(h.checkpoint_state::text)),pid,1);
 insert into wirenexus_private.cloud_uploads(project_id,workspace_id,created_by,name,expected_revision,byte_count,digest,chunk_count,committed)
   values(pid,p.workspace_id,uid,p.name,p.revision,octet_length(content),encode(sha256(content),'hex'),
     (octet_length(content)+196607)/196608,true) returning id into up;
 for n in 0..((octet_length(content)-1)/196608) loop
   insert into wirenexus_private.cloud_chunks values(up,n,substring(content from n*196608+1 for 196608));
 end loop;
 update wirenexus_private.cloud_projects set revision=revision+1,current_version=current_version+1,updated_at=now() where id=pid returning * into p;
 insert into wirenexus_private.cloud_versions(project_id,version,upload_id,created_by) values(pid,p.current_version,up,uid) returning id into vid;
 update wirenexus_private.collaboration_heads set checkpoint_sequence=sequence,checkpoint_version_id=vid,checkpoint_state=replay_state where project_id=pid;
end $$;
revoke all on function wirenexus_private.collaboration_checkpoint(uuid,uuid,text) from public,anon,authenticated;

-- Trusted backend RPC only. Actor/AAL are overwritten using verified Auth by the
-- API, which also runs the shared JS protocol and topology validators before commit.
create function public.wirenexus_collaboration(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; aal text:=payload->>'actorAal'; pid uuid:=(payload->>'projectId')::uuid;
 p wirenexus_private.cloud_projects; h wirenexus_private.collaboration_heads; o wirenexus_private.collaboration_operations;
 role_name text; policy wirenexus_private.collaboration_policy; doc jsonb; replay jsonb; content bytea; ver uuid; seq bigint;
 result jsonb; page jsonb:='[]'; item record; count_value integer; bytes integer:=0; delta bigint;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid) then raise exception 'Access denied' using errcode='42501';end if;
 select * into p from wirenexus_private.cloud_projects where id=pid;
 -- Same lock order as membership revocation, plans and cloud quota reservations.
 perform 1 from public.wirenexus_workspaces where id=p.workspace_id for update;
 select role into role_name from public.wirenexus_memberships where workspace_id=p.workspace_id and user_id=uid;
 if role_name is null then raise exception 'Project access denied' using errcode='42501';end if;
 select * into p from wirenexus_private.cloud_projects where id=pid for update;
 if not exists(select 1 from public.wirenexus_workspaces where id=p.workspace_id and kind='enterprise') then
   raise exception 'Enterprise workspace required' using errcode='P0403';end if;
 insert into wirenexus_private.collaboration_rate values(uid,date_trunc('minute',clock_timestamp()),1)
   on conflict(actor_id) do update set window_start=excluded.window_start,
   requests=case when wirenexus_private.collaboration_rate.window_start=excluded.window_start then wirenexus_private.collaboration_rate.requests+1 else 1 end
   returning requests into count_value;
 if count_value>600 then raise exception 'Request limit reached' using errcode='P0429';end if;
 if operation not in ('head','history') or coalesce((payload->>'write')::boolean,false) then
   if role_name not in ('owner','admin','editor') then raise exception 'Project is read-only' using errcode='42501';end if;
   if p.archived then raise exception 'Project is archived' using errcode='40001';end if;
   perform wirenexus_private.enforce_plan(p.workspace_id,uid,aal,'collaboration');
 end if;
 select * into policy from wirenexus_private.collaboration_policy;
 select * into h from wirenexus_private.collaboration_heads where project_id=pid;
 if operation in ('baseline','activate') then
   if h.project_id is not null then
     return jsonb_build_object('document',h.document,'sessionId',h.session_id,'sequence',h.sequence,'replayState',h.replay_state);
   end if;
   select v.id,string_agg(c.bytes,''::bytea order by c.ordinal) into ver,content
     from wirenexus_private.cloud_versions v join wirenexus_private.cloud_chunks c on c.upload_id=v.upload_id
     where v.project_id=pid and v.version=p.current_version group by v.id;
   if content is null or octet_length(content)>policy.max_project_bytes then raise exception 'Collaboration project size limit' using errcode='22023';end if;
   doc:=convert_from(content,'UTF8')::jsonb;
   if octet_length(doc::text)>policy.max_project_bytes then raise exception 'Collaboration project size limit' using errcode='22023';end if;
   if operation='baseline' then return jsonb_build_object('document',doc);end if;
   if p.revision is distinct from (payload->>'expectedRevision')::bigint then raise exception 'Project changed' using errcode='40001';end if;
   replay:=jsonb_build_object('sessionId',gen_random_uuid(),'revisions','{}'::jsonb,'scopeRevisions','{}'::jsonb,'applied','{}'::jsonb);
   perform wirenexus_private.enforce_plan(p.workspace_id,uid,aal,'collaboration',
     jsonb_build_object('storageBytes',octet_length(doc::text)+2*octet_length(replay::text)));
   insert into wirenexus_private.collaboration_heads(project_id,session_id,document,replay_state,checkpoint_version_id,checkpoint_state)
     values(pid,(replay->>'sessionId')::uuid,doc,replay,ver,replay) returning * into h;
 end if;
 if h.project_id is null then raise exception 'Collaboration is not active' using errcode='40001';end if;
 if operation in ('receipt','commit') then
   select * into o from wirenexus_private.collaboration_operations where project_id=pid and command_id=payload->>'commandId';
   if o.project_id is not null then
     if o.actor_id<>uid or o.request_hash is distinct from payload->>'requestHash' then raise exception 'Command identity reused' using errcode='40001';end if;
     return o.receipt||jsonb_build_object('duplicate',true);
   end if;
   if operation='receipt' then return null;end if;
 end if;
 if operation in ('commit','checkpoint') then
   if h.sequence is distinct from (payload->>'expectedSequence')::bigint then raise exception 'Project changed' using errcode='40001';end if;
   if operation='commit' then
     if h.session_id::text is distinct from payload->>'sessionId' or payload->'command'->>'sessionId' is distinct from h.session_id::text
       or payload->'command'->>'commandId' is distinct from payload->>'commandId'
       or jsonb_typeof(payload->'document') is distinct from 'object'
       or octet_length((payload->'document')::text)>policy.max_project_bytes
       or jsonb_typeof(payload->'replayState') is distinct from 'object'
       or payload->'replayState'->>'sessionId' is distinct from h.session_id::text
       or payload->'replayState'->'applied' is distinct from '{}'::jsonb then raise exception 'Invalid validated operation' using errcode='22023';end if;
     if h.sequence>=9007199254740991 then raise exception 'Sequence exhausted' using errcode='22023';end if;
     if octet_length((payload->'replayState')::text)>524288 then raise exception 'Replay metadata limit' using errcode='22023';end if;
     seq:=h.sequence+1;
     result:=jsonb_build_object('sequence',seq,'commandId',payload->>'commandId','sessionId',h.session_id,'duplicate',false);
     delta:=octet_length((payload->'document')::text)+octet_length((payload->'replayState')::text)
       -octet_length(h.document::text)-octet_length(h.replay_state::text)+octet_length((payload->'command')::text)+octet_length(result::text);
     perform wirenexus_private.enforce_plan(p.workspace_id,uid,aal,'collaboration',jsonb_build_object('storageBytes',greatest(delta,0)));
     update wirenexus_private.collaboration_heads set document=payload->'document',replay_state=payload->'replayState',sequence=seq,updated_at=now() where project_id=pid;
     insert into wirenexus_private.collaboration_operations(project_id,sequence,command_id,actor_id,request_hash,command,receipt)
       values(pid,seq,payload->>'commandId',uid,payload->>'requestHash',payload->'command',result);
     if seq-h.checkpoint_sequence>=policy.checkpoint_every then perform wirenexus_private.collaboration_checkpoint(pid,uid,aal);end if;
     return result;
   end if;
   perform wirenexus_private.collaboration_checkpoint(pid,uid,aal);
   select * into h from wirenexus_private.collaboration_heads where project_id=pid;
 end if;
 if operation='history' then
   seq:=(payload->>'after')::bigint;count_value:=(payload->>'limit')::integer;
   if seq is null or seq<0 or seq>h.sequence or count_value is null or count_value not between 1 and 25 then raise exception 'Invalid cursor' using errcode='22023';end if;
   for item in select sequence,actor_id,command,created_at from wirenexus_private.collaboration_operations
       where project_id=pid and sequence>seq order by sequence limit count_value loop
     bytes:=bytes+octet_length(to_jsonb(item)::text);
     if bytes>1048576 then exit;end if;
     page:=page||jsonb_build_array(to_jsonb(item));seq:=item.sequence;
   end loop;
   return jsonb_build_object('operations',page,'after',seq,'headSequence',h.sequence,'hasMore',seq<h.sequence,
     'sessionId',h.session_id,'checkpointSequence',h.checkpoint_sequence,'checkpointVersionId',h.checkpoint_version_id,'checkpointState',h.checkpoint_state);
 end if;
 if operation not in ('head','activate','checkpoint') then raise exception 'Unsupported operation' using errcode='22023';end if;
 return jsonb_build_object('document',h.document,'sessionId',h.session_id,'sequence',h.sequence,'replayState',h.replay_state,
   'checkpointSequence',h.checkpoint_sequence,'checkpointVersionId',h.checkpoint_version_id,'checkpointState',h.checkpoint_state);
end $$;
revoke all on function public.wirenexus_collaboration(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_collaboration(text,jsonb) to service_role;

-- Guard both reservation AND finalization (including uploads staged before activation),
-- and recovery/duplication of an obsolete checkpoint. No bypass via private RPCs.
alter function public.wirenexus_cloud(text,jsonb) rename to cloud_before_collaboration;
alter function public.cloud_before_collaboration(text,jsonb) set schema wirenexus_private;
revoke all on function wirenexus_private.cloud_before_collaboration(text,jsonb) from public,anon,authenticated;
create function public.wirenexus_cloud(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid;wid uuid;
begin
 if operation in ('begin','finish','recover','duplicate','archive') then
   if operation='finish' then select project_id into pid from wirenexus_private.cloud_uploads where id=(payload->>'uploadId')::uuid;
   else pid:=(payload->>'projectId')::uuid;end if;
   select workspace_id into wid from wirenexus_private.cloud_projects where id=pid;
   perform 1 from public.wirenexus_workspaces where id=wid for update;
   if exists(select 1 from wirenexus_private.collaboration_heads where project_id=pid) then
     if wirenexus_private.workspace_role(wid) is null then raise exception 'Project access denied' using errcode='42501';end if;
     raise exception 'Active collaboration: use operations and checkpoints, or save a separate copy.' using errcode='40001';
   end if;
 end if;
 return wirenexus_private.cloud_before_collaboration(operation,payload);
end $$;
revoke all on function public.wirenexus_cloud(text,jsonb) from public,anon;
grant execute on function public.wirenexus_cloud(text,jsonb) to authenticated;
commit;
