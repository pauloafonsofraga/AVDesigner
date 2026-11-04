-- Requires accounts, plans, organizations and both collaboration migrations.
-- Storage bytes are verified by the trusted API before service-only confirmation.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('wirenexus-project-artwork','wirenexus-project-artwork',false,67108864,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=67108864,allowed_mime_types=array['application/octet-stream'];

create table wirenexus_private.cloud_project_artwork (
 workspace_id uuid not null references public.wirenexus_workspaces(id),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 -- A GC worker may finish arbitrarily late; never reuse a prior lifetime's path.
 storage_id uuid not null default gen_random_uuid(),
 byte_count bigint not null check(byte_count between 1 and 67108864),
 encoding text not null check(encoding in ('image','data-url')),
 mime text not null check(length(mime)<=120 and mime ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
   and (encoding<>'image' or mime like 'image/%')),
 state text not null default 'pending' check(state in ('pending','ready','deleting')),
 lease_until timestamptz not null default now()+interval '24 hours',
 primary key(workspace_id,hash)
);
create table wirenexus_private.cloud_project_artwork_upload_pins (
 upload_id uuid not null references wirenexus_private.cloud_uploads(id) on delete cascade,
 workspace_id uuid not null, hash text not null,
 primary key(upload_id,workspace_id,hash),
 foreign key(workspace_id,hash) references wirenexus_private.cloud_project_artwork(workspace_id,hash)
);
create index cloud_artwork_upload_references on wirenexus_private.cloud_project_artwork_upload_pins(workspace_id,hash);
create table wirenexus_private.cloud_project_artwork_collaboration_pins (
 project_id uuid not null references wirenexus_private.cloud_projects(id) on delete cascade,
 workspace_id uuid not null, hash text not null,
 primary key(project_id,workspace_id,hash),
 foreign key(workspace_id,hash) references wirenexus_private.cloud_project_artwork(workspace_id,hash)
);
create index cloud_artwork_collaboration_references on wirenexus_private.cloud_project_artwork_collaboration_pins(workspace_id,hash);
alter table wirenexus_private.cloud_project_artwork enable row level security;
alter table wirenexus_private.cloud_project_artwork_upload_pins enable row level security;
alter table wirenexus_private.cloud_project_artwork_collaboration_pins enable row level security;
revoke all on wirenexus_private.cloud_project_artwork,wirenexus_private.cloud_project_artwork_upload_pins,
 wirenexus_private.cloud_project_artwork_collaboration_pins from public,anon,authenticated;

create function wirenexus_private.cloud_artwork_metadata(a wirenexus_private.cloud_project_artwork) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('workspaceId',a.workspace_id,'hash',a.hash,'byteCount',a.byte_count,
   'encoding',a.encoding,'mime',a.mime,'path',a.workspace_id::text||'/'||a.hash||'/'||a.storage_id::text,
   'ready',a.state='ready','state',a.state,'leaseUntil',a.lease_until)
$$;
revoke all on function wirenexus_private.cloud_artwork_metadata(wirenexus_private.cloud_project_artwork) from public,anon,authenticated;

-- Keep this function's OID and all pre-existing accounting terms intact.
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
        from wirenexus_private.collaboration_operations o join wirenexus_private.cloud_projects p on p.id=o.project_id where p.workspace_id=wid)+
     (select coalesce(sum(byte_count),0) from wirenexus_private.cloud_project_artwork where workspace_id=wid),
   'historyVersions',(select coalesce(max(n),0) from (
     select project_id,count(*) n from (
       select v.project_id from wirenexus_private.cloud_versions v join wirenexus_private.cloud_projects p on p.id=v.project_id where p.workspace_id=wid
       union all select project_id from wirenexus_private.cloud_uploads where workspace_id=wid and not committed and expires_at>now()
     ) versions group by project_id) counts),
   'publications',(select count(*) from wirenexus_private.publications where workspace_id=wid and (status='published' or (status='pending' and expires_at>now()))),
   'members',(select count(*) from public.wirenexus_memberships where workspace_id=wid)+
     (select count(*) from wirenexus_private.organization_invites where workspace_id=wid and state in ('pending_delivery','sent') and expires_at>now()))
$$;

create function public.wirenexus_project_artwork(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); wid uuid:=(payload->>'workspaceId')::uuid; role_name text;
 a wirenexus_private.cloud_project_artwork; h text:=payload->>'hash'; result jsonb; n bigint;
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true'
   or payload->>'expectedAccountId' is distinct from uid::text then
   raise exception 'Sign in required or account changed' using errcode='42501';end if;
 perform 1 from public.wirenexus_workspaces where id=wid for update;
 select role into role_name from public.wirenexus_memberships where workspace_id=wid and user_id=uid;
 if role_name is null then raise exception 'Workspace access denied' using errcode='42501';end if;
 if operation='describe' then
   if jsonb_typeof(payload->'hashes') is distinct from 'array' or jsonb_array_length(payload->'hashes')>1000 then
     raise exception 'Invalid hashes' using errcode='22023';end if;
   if exists(select 1 from jsonb_array_elements(payload->'hashes') v where jsonb_typeof(v)<>'string' or (v #>> '{}') !~ '^[a-f0-9]{64}$') then
     raise exception 'Invalid hashes' using errcode='22023';end if;
   select coalesce(jsonb_agg(wirenexus_private.cloud_artwork_metadata(x) order by x.hash),'[]') into result
     from wirenexus_private.cloud_project_artwork x where x.workspace_id=wid and x.state='ready'
       and x.hash in (select jsonb_array_elements_text(payload->'hashes'));
   return result;
 end if;
 if operation<>'reserve' or operation is null then raise exception 'Unsupported artwork operation' using errcode='22023';end if;
 if role_name not in ('owner','admin','editor') then raise exception 'Workspace is read-only' using errcode='42501';end if;
 if h is null or h !~ '^[a-f0-9]{64}$' or jsonb_typeof(payload->'byteCount') is distinct from 'number'
   or (payload->>'byteCount') !~ '^[0-9]{1,8}$' or (payload->>'byteCount')::bigint not between 1 and 67108864
   or coalesce(payload->>'encoding','') not in ('image','data-url') or coalesce(payload->>'mime','') !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
   or length(payload->>'mime')>120 or (payload->>'encoding'='image' and payload->>'mime' not like 'image/%') then
   raise exception 'Invalid artwork metadata' using errcode='22023';end if;
 select * into a from wirenexus_private.cloud_project_artwork where workspace_id=wid and hash=h;
 if a.hash is not null then
   if a.state='deleting' then raise exception 'Artwork is being deleted' using errcode='40001';end if;
   if a.byte_count<>(payload->>'byteCount')::bigint or a.encoding<>payload->>'encoding' or a.mime<>payload->>'mime' then
     raise exception 'Artwork metadata is immutable' using errcode='22023';end if;
   perform wirenexus_private.enforce_plan(wid,uid,auth.jwt()->>'aal',null);
 else
   select count(*) into n from wirenexus_private.cloud_project_artwork where workspace_id=wid and state='pending';
   if n>=128 then raise exception 'Too many pending artwork assets' using errcode='P0429';end if;
   perform wirenexus_private.enforce_plan(wid,uid,auth.jwt()->>'aal',null,jsonb_build_object('storageBytes',(payload->>'byteCount')::bigint));
   insert into wirenexus_private.cloud_project_artwork(workspace_id,hash,byte_count,encoding,mime)
     values(wid,h,(payload->>'byteCount')::bigint,payload->>'encoding',payload->>'mime');
 end if;
 update wirenexus_private.cloud_project_artwork set lease_until=now()+interval '24 hours'
   where workspace_id=wid and hash=h returning * into a;
 return wirenexus_private.cloud_artwork_metadata(a);
end $$;
revoke all on function public.wirenexus_project_artwork(text,jsonb) from public,anon;
grant execute on function public.wirenexus_project_artwork(text,jsonb) to authenticated;

create function public.wirenexus_project_artwork_admin(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(payload->>'actorId')::uuid; wid uuid:=(payload->>'workspaceId')::uuid;
 role_name text; h text:=payload->>'hash'; a wirenexus_private.cloud_project_artwork; result jsonb; object_path text;
begin
 perform 1 from public.wirenexus_workspaces where id=wid for update;
 select role into role_name from public.wirenexus_memberships where workspace_id=wid and user_id=uid;
 if uid is null or role_name is null or role_name not in ('owner','admin','editor') then
   raise exception 'Workspace write access denied' using errcode='42501';end if;
 if operation in ('gc-preview','gc-claim','gc-finish') and role_name not in ('owner','admin') then
   raise exception 'Workspace administration required' using errcode='42501';end if;
 if operation='gc-preview' then
   select coalesce(jsonb_agg(wirenexus_private.cloud_artwork_metadata(x) order by x.hash),'[]') into result
   from wirenexus_private.cloud_project_artwork x
   where x.workspace_id=wid and (x.state='deleting' or x.lease_until<now())
     and not exists(select 1 from wirenexus_private.cloud_project_artwork_upload_pins p where p.workspace_id=wid and p.hash=x.hash)
     and not exists(select 1 from wirenexus_private.cloud_project_artwork_collaboration_pins p where p.workspace_id=wid and p.hash=x.hash);
   return result;
 end if;
 if operation='gc-claim' then
   with claimed as (
     update wirenexus_private.cloud_project_artwork x set state='deleting'
     where x.workspace_id=wid and (x.state='deleting' or x.lease_until<now())
       and not exists(select 1 from wirenexus_private.cloud_project_artwork_upload_pins p where p.workspace_id=wid and p.hash=x.hash)
       and not exists(select 1 from wirenexus_private.cloud_project_artwork_collaboration_pins p where p.workspace_id=wid and p.hash=x.hash)
     returning x.*)
   select coalesce(jsonb_agg(wirenexus_private.cloud_artwork_metadata(c) order by c.hash),'[]') into result from claimed c;
   return result;
 end if;
 if h is null or h !~ '^[a-f0-9]{64}$' then raise exception 'Invalid hash' using errcode='22023';end if;
 select * into a from wirenexus_private.cloud_project_artwork where workspace_id=wid and hash=h;
 if a.hash is null then raise exception 'Artwork not found' using errcode='22023';end if;
 object_path:=wid::text||'/'||h||'/'||a.storage_id::text;
 if operation='inspect' then return wirenexus_private.cloud_artwork_metadata(a);
 elsif operation='confirm' then
   if payload->>'path' is distinct from object_path then
     raise exception 'Artwork storage path changed or missing' using errcode='40001';end if;
   if a.state='deleting' then raise exception 'Artwork is being deleted' using errcode='40001';end if;
   if not exists(select 1 from storage.objects where bucket_id='wirenexus-project-artwork' and name=object_path) then
     raise exception 'Storage object missing' using errcode='22023';end if;
   if not exists(select 1 from storage.objects where bucket_id='wirenexus-project-artwork' and name=object_path
     and metadata->>'size'=a.byte_count::text and metadata->>'mimetype'='application/octet-stream') then
     raise exception 'Storage object metadata does not match reservation' using errcode='22023';end if;
   update wirenexus_private.cloud_project_artwork set state='ready',lease_until=now()+interval '24 hours'
     where workspace_id=wid and hash=h returning * into a;
   return wirenexus_private.cloud_artwork_metadata(a);
 elsif operation='gc-finish' then
   if payload->>'path' is distinct from object_path then
     raise exception 'Artwork storage path changed or missing' using errcode='40001';end if;
   if a.state<>'deleting' then raise exception 'Artwork is not deleting' using errcode='40001';end if;
   if exists(select 1 from storage.objects where bucket_id='wirenexus-project-artwork' and name=object_path) then
     raise exception 'Remove the Storage object first' using errcode='40001';end if;
   delete from wirenexus_private.cloud_project_artwork where workspace_id=wid and hash=h;
   return jsonb_build_object('hash',h,'deleted',true);
 end if;
 raise exception 'Unsupported artwork operation' using errcode='22023';
end $$;
revoke all on function public.wirenexus_project_artwork_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_project_artwork_admin(text,jsonb) to service_role;

-- No path casts: malformed or caller-chosen prefixes simply cannot match metadata.
-- Row-share locks serialize Storage inserts with GC claims until upload commits.
-- Standard raw-body uploads probe contentLength first, then measured size on completion.
-- Missing lengths fail closed; do not allow multipart/older Storage probes without them.
create function wirenexus_private.cloud_artwork_storage_allowed(object_name text,writing boolean,object_metadata jsonb default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare a wirenexus_private.cloud_project_artwork; role_name text; size_text text;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then return false;end if;
 select * into a from wirenexus_private.cloud_project_artwork
   where workspace_id::text||'/'||hash||'/'||storage_id::text=object_name for share;
 if a.hash is null then return false;end if;
 select role into role_name from public.wirenexus_memberships where workspace_id=a.workspace_id and user_id=auth.uid();
 if writing then
   size_text:=coalesce(object_metadata->>'size',object_metadata->>'contentLength');
   if size_text is null or size_text !~ '^[0-9]{1,8}$'
     or object_metadata->>'mimetype' is distinct from 'application/octet-stream' then return false;end if;
   return coalesce(role_name in ('owner','admin','editor') and a.state='pending' and size_text::bigint=a.byte_count,false);
 end if;
 return coalesce((a.state='ready' and role_name is not null) or (a.state='pending' and role_name in ('owner','admin','editor')),false);
end $$;
revoke all on function wirenexus_private.cloud_artwork_storage_allowed(text,boolean,jsonb) from public,anon;
grant execute on function wirenexus_private.cloud_artwork_storage_allowed(text,boolean,jsonb) to authenticated;
create policy cloud_artwork_read on storage.objects for select to authenticated
 using(bucket_id='wirenexus-project-artwork' and wirenexus_private.cloud_artwork_storage_allowed(name,false));
create policy cloud_artwork_insert on storage.objects for insert to authenticated
 with check(bucket_id='wirenexus-project-artwork' and wirenexus_private.cloud_artwork_storage_allowed(name,true,metadata));
create policy cloud_artwork_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'wirenexus-project-artwork' or wirenexus_private.cloud_artwork_storage_allowed(name,false));
create policy cloud_artwork_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'wirenexus-project-artwork' or wirenexus_private.cloud_artwork_storage_allowed(name,true,metadata));
create policy cloud_artwork_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'wirenexus-project-artwork') with check(bucket_id<>'wirenexus-project-artwork');
create policy cloud_artwork_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'wirenexus-project-artwork');
-- Existing permissive anonymous policies must not expose this private bucket.
create policy cloud_artwork_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id<>'wirenexus-project-artwork') with check(bucket_id<>'wirenexus-project-artwork');

-- Walk values, including JSON serialized inside revision snapshot strings.
create function wirenexus_private.cloud_artwork_hashes(value jsonb,depth integer default 0) returns setof text
language plpgsql immutable set search_path='' as $$
declare child jsonb; parsed jsonb; s text;
begin
 if depth>150 then raise exception 'Artwork reference nesting limit' using errcode='22023';end if;
 if jsonb_typeof(value)='object' then
   for child in select v from jsonb_each(value) as e(k,v) loop
     return query select * from wirenexus_private.cloud_artwork_hashes(child,depth+1);
   end loop;
 elsif jsonb_typeof(value)='array' then
   for child in select * from jsonb_array_elements(value) loop
     return query select * from wirenexus_private.cloud_artwork_hashes(child,depth+1);
   end loop;
 elsif jsonb_typeof(value)='string' then
   s:=value #>> '{}';
   if left(s,24)='wirenexus-cloud-artwork:' then
     if s !~ '^wirenexus-cloud-artwork:[a-f0-9]{64}$' then
       raise exception 'Malformed cloud artwork reference' using errcode='22023';end if;
     return next substr(s,25);
   elsif ltrim(s) ~ '^[\[{"]' then
     begin parsed:=s::jsonb;exception when invalid_text_representation then return;end;
     return query select * from wirenexus_private.cloud_artwork_hashes(parsed,depth+1);
   end if;
 end if;
end $$;
revoke all on function wirenexus_private.cloud_artwork_hashes(jsonb,integer) from public,anon,authenticated;

create function wirenexus_private.cloud_artwork_embedded(value jsonb,depth integer default 0) returns boolean
language plpgsql immutable set search_path='' as $$
declare child jsonb; parsed jsonb; s text;
begin
 if depth>150 then raise exception 'Artwork reference nesting limit' using errcode='22023';end if;
 if jsonb_typeof(value)='object' then
   for child in select v from jsonb_each(value) as e(k,v) loop
     if wirenexus_private.cloud_artwork_embedded(child,depth+1) then return true;end if;
   end loop;
 elsif jsonb_typeof(value)='array' then
   for child in select * from jsonb_array_elements(value) loop
     if wirenexus_private.cloud_artwork_embedded(child,depth+1) then return true;end if;
   end loop;
 elsif jsonb_typeof(value)='string' then
   s:=value #>> '{}';if s ~* '^data:image/' then return true;end if;
   if ltrim(s) ~ '^[\[{"]' then
     begin parsed:=s::jsonb;exception when invalid_text_representation then return false;end;
     return wirenexus_private.cloud_artwork_embedded(parsed,depth+1);
   end if;
 end if;
 return false;
end $$;
revoke all on function wirenexus_private.cloud_artwork_embedded(jsonb,integer) from public,anon,authenticated;

create function wirenexus_private.pin_cloud_artwork() returns trigger
language plpgsql security definer set search_path='' as $$
declare wid uuid; doc jsonb; project_doc jsonb; content bytea; h text; hashes text[];
begin
 select workspace_id into wid from wirenexus_private.cloud_projects where id=new.project_id;
 perform 1 from public.wirenexus_workspaces where id=wid for update;
 if tg_table_name='cloud_versions' then
   if not exists(select 1 from wirenexus_private.cloud_uploads where id=new.upload_id and workspace_id=wid and project_id=new.project_id and committed) then
     raise exception 'Invalid artwork upload scope' using errcode='22023';end if;
   select string_agg(bytes,''::bytea order by ordinal) into content from wirenexus_private.cloud_chunks where upload_id=new.upload_id;
   doc:=convert_from(content,'UTF8')::jsonb;
 else doc:=to_jsonb(new);
 end if;
 if tg_table_name='cloud_versions' then project_doc:=doc;
 elsif tg_table_name='collaboration_heads' then project_doc:=new.document;
 else select document into project_doc from wirenexus_private.collaboration_heads where project_id=new.project_id;
 end if;
 if project_doc ? 'cloudArtwork' then
   if project_doc->'cloudArtwork' is distinct from '{"version":1}'::jsonb then
     raise exception 'Unsupported cloud artwork manifest' using errcode='22023';end if;
   if wirenexus_private.cloud_artwork_embedded(doc) then
     raise exception 'Cloud artwork manifests must not embed images' using errcode='22023';end if;
 end if;
 select array_agg(ref.hash) into hashes from (
   select distinct * from wirenexus_private.cloud_artwork_hashes(doc) limit 2049
 ) as ref(hash);
 if cardinality(hashes)>2048 then raise exception 'Too many cloud artwork references' using errcode='22023';end if;
 for h in select unnest(hashes) loop
   if not exists(select 1 from wirenexus_private.cloud_project_artwork where workspace_id=wid and hash=h and state='ready') then
     raise exception 'Required cloud artwork is not ready in this workspace' using errcode='22023';end if;
   if tg_table_name='cloud_versions' then
     insert into wirenexus_private.cloud_project_artwork_upload_pins values(new.upload_id,wid,h) on conflict do nothing;
   else
     insert into wirenexus_private.cloud_project_artwork_collaboration_pins values(new.project_id,wid,h) on conflict do nothing;
   end if;
 end loop;
 return new;
end $$;
revoke all on function wirenexus_private.pin_cloud_artwork() from public,anon,authenticated;
create trigger cloud_version_artwork_pins after insert on wirenexus_private.cloud_versions
 for each row execute function wirenexus_private.pin_cloud_artwork();
create trigger collaboration_head_artwork_pins after insert or update on wirenexus_private.collaboration_heads
 for each row execute function wirenexus_private.pin_cloud_artwork();
create trigger collaboration_operation_artwork_pins after insert on wirenexus_private.collaboration_operations
 for each row execute function wirenexus_private.pin_cloud_artwork();
commit;
