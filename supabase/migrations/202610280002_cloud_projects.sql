-- Apply after Accounts Phase 2. Private, complete .avd snapshots; no public bucket.
begin;
create table wirenexus_private.cloud_projects (
  id uuid primary key, workspace_id uuid not null references public.wirenexus_workspaces(id),
  name text not null check(length(name) between 1 and 120),
  revision bigint not null default 1, current_version integer not null default 1,
  archived boolean not null default false, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index cloud_projects_workspace on wirenexus_private.cloud_projects(workspace_id,updated_at desc);
create table wirenexus_private.cloud_uploads (
  id uuid primary key default gen_random_uuid(), project_id uuid not null,
  workspace_id uuid not null references public.wirenexus_workspaces(id),
  created_by uuid not null references auth.users(id), name text not null check(length(name) between 1 and 120),
  expected_revision bigint not null, byte_count integer not null check(byte_count between 2 and 67108864),
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  chunk_count integer not null check(chunk_count between 1 and 342),
  committed boolean not null default false, expires_at timestamptz not null default now()+interval '24 hours'
);
create table wirenexus_private.cloud_chunks (
  upload_id uuid not null references wirenexus_private.cloud_uploads(id) on delete cascade,
  ordinal integer not null check(ordinal between 0 and 341), bytes bytea not null check(octet_length(bytes) between 1 and 196608),
  primary key(upload_id,ordinal)
);
create table wirenexus_private.cloud_versions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references wirenexus_private.cloud_projects(id),
  version integer not null, upload_id uuid not null unique references wirenexus_private.cloud_uploads(id),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  recovered_from uuid references wirenexus_private.cloud_versions(id), unique(project_id,version)
);
alter table wirenexus_private.cloud_projects enable row level security;
alter table wirenexus_private.cloud_uploads enable row level security;
alter table wirenexus_private.cloud_chunks enable row level security;
alter table wirenexus_private.cloud_versions enable row level security;
revoke all on wirenexus_private.cloud_projects,wirenexus_private.cloud_uploads,wirenexus_private.cloud_chunks,wirenexus_private.cloud_versions from public,anon,authenticated;
grant select on wirenexus_private.cloud_projects,wirenexus_private.cloud_versions to authenticated;
create policy project_members_read on wirenexus_private.cloud_projects for select to authenticated
  using(wirenexus_private.workspace_role(workspace_id) is not null);
create policy version_members_read on wirenexus_private.cloud_versions for select to authenticated
  using(exists(select 1 from wirenexus_private.cloud_projects p where p.id=project_id));

create function public.wirenexus_cloud(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); wid uuid; pid uuid; role_name text; upload wirenexus_private.cloud_uploads;
  project wirenexus_private.cloud_projects; ver wirenexus_private.cloud_versions;
  new_upload uuid; new_id uuid; content bytea; doc jsonb; n integer; name_value text;
begin
  if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true'
    or payload->>'expectedAccountId' is distinct from uid::text then
    raise exception 'Sign in required or account changed' using errcode='42501';
  end if;
  -- Resolve ownership from database records, never caller-selected paths/owners.
  if operation in ('chunk','finish','cancel') then
    select * into upload from wirenexus_private.cloud_uploads where id=(payload->>'uploadId')::uuid for update;
    if upload.id is null or upload.created_by<>uid or upload.committed or upload.expires_at<now() then
      raise exception 'Upload is unavailable' using errcode='42501';
    end if;
    wid:=upload.workspace_id;pid:=upload.project_id;
  elsif operation in ('list','begin') then
    wid:=(payload->>'workspaceId')::uuid;pid:=(payload->>'projectId')::uuid;
  else
    pid:=(payload->>'projectId')::uuid;
    select * into project from wirenexus_private.cloud_projects where id=pid;
    wid:=project.workspace_id;
  end if;
  role_name:=wirenexus_private.workspace_role(wid);
  if role_name is null then raise exception 'Project access denied' using errcode='42501'; end if;
  if operation='list' then
    return (select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id),'[]')
      from wirenexus_private.cloud_projects p where p.workspace_id=wid and p.archived=coalesce((payload->>'archived')::boolean,false));
  end if;
  if operation in ('versions','read') then
    if project.id is null then raise exception 'Project not found' using errcode='42501'; end if;
    if operation='versions' then
      return (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'created_at',v.created_at,'created_by',v.created_by,'recovered_from',v.recovered_from) order by v.version desc),'[]')
        from wirenexus_private.cloud_versions v where v.project_id=pid);
    end if;
    select * into ver from wirenexus_private.cloud_versions where project_id=pid
      and ((payload->>'versionId' is null and version=project.current_version) or id=(payload->>'versionId')::uuid);
    if ver.id is null then raise exception 'Version not found'; end if;
    select * into upload from wirenexus_private.cloud_uploads where id=ver.upload_id;
    if payload ? 'ordinal' then
      select bytes into content from wirenexus_private.cloud_chunks where upload_id=upload.id and ordinal=(payload->>'ordinal')::integer;
      if content is null then raise exception 'Chunk not found'; end if;
      return jsonb_build_object('base64',encode(content,'base64'));
    end if;
    return jsonb_build_object('project',to_jsonb(project),'versionId',ver.id,'version',ver.version,
      'byteCount',upload.byte_count,'chunkCount',upload.chunk_count,'digest',upload.digest);
  end if;
  if role_name not in ('owner','admin','editor') then raise exception 'Workspace is read-only' using errcode='42501'; end if;
  if operation='begin' then
    name_value:=trim(payload->>'name');
    if pid is not null then
      select * into project from wirenexus_private.cloud_projects where id=pid;
      if project.id is null or project.workspace_id<>wid then raise exception 'Project access denied' using errcode='42501'; end if;
      if project.revision is distinct from (payload->>'expectedRevision')::bigint or project.archived then
        raise exception 'Cloud project changed. Open the latest version or save a separate copy.' using errcode='40001';
      end if;
    elsif (payload->>'expectedRevision')::bigint is distinct from 0::bigint then raise exception 'Invalid new project revision';
    end if;
    -- Limit abandoned staging data per account; committed history is never evicted.
    delete from wirenexus_private.cloud_uploads where created_by=uid and not committed and expires_at<now();
    if (select count(*) from wirenexus_private.cloud_uploads where created_by=uid and not committed)>=8 then raise exception 'Too many pending uploads. Cancel or wait for expiry.'; end if;
    insert into wirenexus_private.cloud_uploads(project_id,workspace_id,created_by,name,expected_revision,byte_count,digest,chunk_count)
      values(coalesce(pid,gen_random_uuid()),wid,uid,name_value,(payload->>'expectedRevision')::bigint,
        (payload->>'byteCount')::integer,payload->>'digest',(payload->>'chunkCount')::integer) returning * into upload;
    return jsonb_build_object('uploadId',upload.id);
  elsif operation='cancel' then
    delete from wirenexus_private.cloud_uploads where id=upload.id;return '{}'::jsonb;
  elsif operation='chunk' then
    n:=(payload->>'ordinal')::integer;
    if n is null or n<0 or n>=upload.chunk_count or length(payload->>'base64')>270000 then raise exception 'Invalid chunk'; end if;
    content:=decode(payload->>'base64','base64');
    insert into wirenexus_private.cloud_chunks values(upload.id,n,content)
      on conflict(upload_id,ordinal) do update set bytes=excluded.bytes;
    return '{}'::jsonb;
  elsif operation='finish' then
    select string_agg(bytes,''::bytea order by ordinal),count(*) into content,n from wirenexus_private.cloud_chunks where upload_id=upload.id;
    if n<>upload.chunk_count or octet_length(content) is distinct from upload.byte_count
      or encode(sha256(content),'hex') is distinct from upload.digest then raise exception 'Incomplete or corrupt upload. Previous version retained.'; end if;
    doc:=convert_from(content,'UTF8')::jsonb;
    if jsonb_typeof(doc) is distinct from 'object' or jsonb_typeof(doc->'devices') is distinct from 'array'
      or jsonb_typeof(doc->'connections') is distinct from 'array' then raise exception 'Invalid .avd project'; end if;
    -- Lock and compare at finalization, not just at upload reservation.
    select * into project from wirenexus_private.cloud_projects where id=pid for update;
    if project.id is null then
      if upload.expected_revision<>0 then raise exception 'Project changed' using errcode='40001'; end if;
      insert into wirenexus_private.cloud_projects(id,workspace_id,name,created_by) values(pid,wid,upload.name,uid) returning * into project;
    else
      if project.workspace_id<>wid or project.revision<>upload.expected_revision or project.archived then
        raise exception 'Cloud project changed. Open the latest version or save a separate copy.' using errcode='40001';
      end if;
      update wirenexus_private.cloud_projects set revision=revision+1,current_version=current_version+1,updated_at=now() where id=pid returning * into project;
    end if;
    update wirenexus_private.cloud_uploads set committed=true where id=upload.id;
    insert into wirenexus_private.cloud_versions(project_id,version,upload_id,created_by) values(pid,project.current_version,upload.id,uid);
    return to_jsonb(project);
  elsif operation in ('rename','archive','duplicate','recover') then
    select * into project from wirenexus_private.cloud_projects where id=pid for update;
    if project.revision is distinct from (payload->>'expectedRevision')::bigint then
      raise exception 'Cloud project changed. Refresh before trying again.' using errcode='40001';
    end if;
    if operation in ('duplicate','recover') then
      select * into ver from wirenexus_private.cloud_versions where project_id=pid
        and ((payload->>'versionId' is null and version=project.current_version) or id=(payload->>'versionId')::uuid);
      if ver.id is null then raise exception 'Version not found'; end if;
      if operation='recover' and project.archived then raise exception 'Restore archived project before recovering a version'; end if;
      new_id:=case when operation='duplicate' then gen_random_uuid() else pid end;
      insert into wirenexus_private.cloud_uploads(project_id,workspace_id,created_by,name,expected_revision,byte_count,digest,chunk_count,committed)
        select new_id,wid,uid,project.name,0,byte_count,digest,chunk_count,true from wirenexus_private.cloud_uploads where id=ver.upload_id returning id into new_upload;
      insert into wirenexus_private.cloud_chunks select new_upload,ordinal,bytes from wirenexus_private.cloud_chunks where upload_id=ver.upload_id;
      if operation='duplicate' then
        insert into wirenexus_private.cloud_projects(id,workspace_id,name,created_by)
          values(new_id,wid,trim(payload->>'name'),uid) returning * into project;
      else
        update wirenexus_private.cloud_projects set revision=revision+1,current_version=current_version+1,updated_at=now() where id=pid returning * into project;
      end if;
      insert into wirenexus_private.cloud_versions(project_id,version,upload_id,created_by,recovered_from)
        values(new_id,project.current_version,new_upload,uid,ver.id);
    elsif operation='rename' then
      update wirenexus_private.cloud_projects set name=trim(payload->>'name'),revision=revision+1,updated_at=now() where id=pid returning * into project;
    else
      update wirenexus_private.cloud_projects set archived=(payload->>'archived')::boolean,revision=revision+1,updated_at=now() where id=pid returning * into project;
    end if;
    return to_jsonb(project);
  end if;
  raise exception 'Unsupported cloud operation';
end $$;
revoke all on function public.wirenexus_cloud(text,jsonb) from public,anon;
grant execute on function public.wirenexus_cloud(text,jsonb) to authenticated;
commit;
