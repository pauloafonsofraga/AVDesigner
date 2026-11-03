-- Community Phase 2. Offline migration only; does not change personal libraries,
-- factory data, registration, workspace permissions or existing publications.
begin;
create table wirenexus_private.community_limits (
 id boolean primary key default true check(id), max_package_bytes integer not null default 8388608 check(max_package_bytes between 1024 and 8388608),
 max_owner_bytes bigint not null default 134217728 check(max_owner_bytes>0), max_versions integer not null default 100 check(max_versions>0),
 max_pending integer not null default 2 check(max_pending between 1 and 10), hourly_uploads integer not null default 10 check(hourly_uploads>0)
);
insert into wirenexus_private.community_limits(id) values(true);
create table wirenexus_private.community_accounts (
 owner_id uuid primary key references auth.users(id), window_start timestamptz not null default now(), upload_count integer not null default 0
);
create table wirenexus_private.community_devices (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 revision bigint not null default 0, created_at timestamptz not null default now(), approved_version_id uuid, published_at timestamptz
);
create index community_devices_owner on wirenexus_private.community_devices(owner_id,id);
create index community_devices_public on wirenexus_private.community_devices(id) where approved_version_id is not null;
create table wirenexus_private.community_versions (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references wirenexus_private.community_devices(id),
 number integer not null check(number>0), state text not null default 'pending' check(state in ('pending','approved','rejected','unpublished')),
 package_bytes bytea not null check(octet_length(package_bytes) between 47 and 8388608), package_sha text not null check(package_sha ~ '^[a-f0-9]{64}$'),
 content_sha text not null check(content_sha ~ '^[a-f0-9]{64}$'), metadata jsonb not null, attribution jsonb not null, preview_hash text,
 artwork_bytes integer not null check(artwork_bytes between 0 and 16777216), submitted_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id), reviewed_at timestamptz, reason text not null default '',
 unique(device_id,number), unique(device_id,id)
);
alter table wirenexus_private.community_devices add constraint community_approved_version
 foreign key(id,approved_version_id) references wirenexus_private.community_versions(device_id,id);
create index community_pending on wirenexus_private.community_versions(id) where state='pending';
create table wirenexus_private.community_artwork (
 hash text primary key check(hash ~ '^[a-f0-9]{64}$'), bytes bytea not null check(octet_length(bytes) between 1 and 16777216)
);
create table wirenexus_private.community_version_artwork (
 version_id uuid not null references wirenexus_private.community_versions(id), hash text not null references wirenexus_private.community_artwork(hash),
 primary key(version_id,hash)
);
create index community_artwork_versions on wirenexus_private.community_version_artwork(hash,version_id);
create table wirenexus_private.community_uploads (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), device_id uuid not null,
 expected_revision bigint not null check(expected_revision>=0), byte_count integer not null check(byte_count between 47 and 8388608),
 source_sha text not null check(source_sha ~ '^[a-f0-9]{64}$'), creator_name text not null, created_at timestamptz not null,
 received integer not null default 0, expires_at timestamptz not null default now()+interval '24 hours',
 completed_version_id uuid references wirenexus_private.community_versions(id)
);
create index community_upload_owner on wirenexus_private.community_uploads(owner_id,expires_at);
create table wirenexus_private.community_chunks (
 upload_id uuid not null references wirenexus_private.community_uploads(id) on delete cascade, index integer not null check(index>=0),
 bytes bytea not null check(octet_length(bytes) between 1 and 262144), primary key(upload_id,index)
);
create table wirenexus_private.community_events (
 id bigint generated always as identity primary key, actor_id uuid not null references auth.users(id),
 version_id uuid not null references wirenexus_private.community_versions(id), operation text not null,
 created_at timestamptz not null default now(), reason text not null default ''
);

-- No direct Data API access, even to supposedly public rows. Public HTTP reads
-- use a deliberately narrow approved-only projection; raw bytes stay private.
alter table wirenexus_private.community_limits enable row level security;
alter table wirenexus_private.community_accounts enable row level security;
alter table wirenexus_private.community_devices enable row level security;
alter table wirenexus_private.community_versions enable row level security;
alter table wirenexus_private.community_artwork enable row level security;
alter table wirenexus_private.community_version_artwork enable row level security;
alter table wirenexus_private.community_uploads enable row level security;
alter table wirenexus_private.community_chunks enable row level security;
alter table wirenexus_private.community_events enable row level security;
revoke all on wirenexus_private.community_limits,wirenexus_private.community_accounts,wirenexus_private.community_devices,
 wirenexus_private.community_versions,wirenexus_private.community_artwork,wirenexus_private.community_version_artwork,
 wirenexus_private.community_uploads,wirenexus_private.community_chunks,wirenexus_private.community_events from public,anon,authenticated,service_role;

create function wirenexus_private.community_creator(uid uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select btrim(value#>>'{}') from auth.users u cross join lateral
   (values(1,u.raw_user_meta_data->'display_name'),(2,u.raw_user_meta_data->'full_name'),(3,u.raw_user_meta_data->'name')) n(position,value)
   where u.id=uid and jsonb_typeof(value)='string' and length(btrim(value#>>'{}')) between 1 and 100 and (value#>>'{}') !~ '[@[:cntrl:]<>]' order by position limit 1),'WireNexus contributor')
$$;
create function wirenexus_private.community_projection(vid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'versionId',v.id,'version',v.number,'revision',d.revision,'metadata',v.metadata,
   'createdBy',v.attribution->>'displayName','createdAt',v.attribution->>'createdAt','verifiedCreator',true,
   'previewHash',v.preview_hash,'publishedAt',d.published_at,'sha256',v.package_sha,'byteCount',octet_length(v.package_bytes))
 from wirenexus_private.community_versions v join wirenexus_private.community_devices d on d.id=v.device_id where v.id=vid
$$;
revoke all on function wirenexus_private.community_creator(uuid),wirenexus_private.community_projection(uuid) from public,anon,authenticated,service_role;

-- Like existing publishing/collaboration boundaries, only the authenticated
-- application server may supply actorId/actorAal or a validated materialization.
create function public.wirenexus_community(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; elevated boolean:=false; lim wirenexus_private.community_limits; u wirenexus_private.community_uploads;
 d wirenexus_private.community_devices; v wirenexus_private.community_versions; acc wirenexus_private.community_accounts;
 ident uuid; vid uuid; data bytea; image bytea; asset jsonb; result jsonb; existing bytea; total bigint; image_total integer:=0; count_versions integer;
 idx integer; expected integer; k text; text_value text; page_size integer; after_id uuid; search text; metadata jsonb;
begin
 if operation in ('list','preview','artwork') then
   if operation='list' then
     page_size:=coalesce((payload->>'limit')::integer,25);
     if page_size<1 or page_size>50 or length(coalesce(payload->>'search',''))>100 then raise exception 'Invalid page' using errcode='22023';end if;
     after_id:=(payload->>'after')::uuid;search:=lower(coalesce(payload->>'search',''));
     return (select coalesce(jsonb_agg(wirenexus_private.community_projection(id) order by device_id),'[]') from
       (select ver.id,dv.id device_id from wirenexus_private.community_devices dv join wirenexus_private.community_versions ver on ver.id=dv.approved_version_id
         where ver.state='approved' and (after_id is null or dv.id>after_id) and
           position(search in lower(concat_ws(' ',ver.metadata->>'title',ver.metadata->>'brand',ver.metadata->>'category')))>0
         order by dv.id limit page_size) page);
   end if;
   select dv.* into d from wirenexus_private.community_devices dv join wirenexus_private.community_versions ver on ver.id=dv.approved_version_id
     where dv.id=(payload->>'deviceId')::uuid and ver.state='approved';
   if d.id is null then raise exception 'Device unavailable' using errcode='42501';end if;
   if operation='preview' then return wirenexus_private.community_projection(d.approved_version_id);end if;
   select a.bytes into data from wirenexus_private.community_artwork a join wirenexus_private.community_version_artwork r on r.hash=a.hash
     where r.version_id=d.approved_version_id and r.hash=payload->>'hash' and r.hash=(select preview_hash from wirenexus_private.community_versions where id=d.approved_version_id);
   if data is null then raise exception 'Artwork unavailable' using errcode='42501';end if;
   return jsonb_build_object('data',encode(data,'base64'),'mime','image/png');
 end if;
 uid:=(payload->>'actorId')::uuid;
 if uid is null or not exists(select 1 from auth.users where id=uid) then raise exception 'Account unavailable' using errcode='42501';end if;
 elevated:=wirenexus_private.plan_admin(uid,payload->>'actorAal');
 if operation in ('mine','queue') then
   page_size:=coalesce((payload->>'limit')::integer,25);after_id:=(payload->>'after')::uuid;
   if page_size<1 or page_size>50 then raise exception 'Invalid page' using errcode='22023';end if;
   if operation='queue' and not elevated then raise exception 'Verified Platform Admin required' using errcode='42501';end if;
   return (select coalesce(jsonb_agg(wirenexus_private.community_projection(id)||jsonb_build_object('state',state,'reason',reason) order by id),'[]') from
     (select ver.id,ver.state,ver.reason from wirenexus_private.community_versions ver join wirenexus_private.community_devices dv on dv.id=ver.device_id
       where ((operation='mine' and dv.owner_id=uid) or (operation='queue' and ver.state='pending')) and (after_id is null or ver.id>after_id)
       order by ver.id limit page_size) page);
 end if;
 if operation in ('approve','reject','unpublish') then
   if not elevated then raise exception 'Verified Platform Admin required' using errcode='42501';end if;
   select device_id into ident from wirenexus_private.community_versions where id=(payload->>'versionId')::uuid;
   select * into d from wirenexus_private.community_devices where id=ident for update;
   select * into v from wirenexus_private.community_versions where id=(payload->>'versionId')::uuid for update;
   if d.id is null or d.revision is distinct from (payload->>'expectedRevision')::bigint then raise exception 'Moderation changed. Refresh.' using errcode='40001';end if;
   text_value:=coalesce(payload->>'reason','');
   if length(text_value)>1000 or text_value ~ '[[:cntrl:]]' then raise exception 'Invalid moderation reason' using errcode='22023';end if;
   if operation='approve' then
     if v.state not in ('pending','unpublished') then raise exception 'Version cannot be approved' using errcode='40001';end if;
     update wirenexus_private.community_versions set state='unpublished' where id=d.approved_version_id and id<>v.id;
     update wirenexus_private.community_devices set approved_version_id=v.id,published_at=now(),revision=revision+1 where id=d.id;
   elsif operation='reject' then
     if v.state<>'pending' then raise exception 'Version is not pending' using errcode='40001';end if;
     update wirenexus_private.community_devices set revision=revision+1 where id=d.id;
   else
     if d.approved_version_id is distinct from v.id then raise exception 'Version is not published' using errcode='40001';end if;
     update wirenexus_private.community_devices set approved_version_id=null,published_at=null,revision=revision+1 where id=d.id;
   end if;
   update wirenexus_private.community_versions set state=case operation when 'approve' then 'approved' when 'reject' then 'rejected' else 'unpublished' end,
     reviewed_by=uid,reviewed_at=now(),reason=text_value where id=v.id;
   insert into wirenexus_private.community_events(actor_id,version_id,operation,reason) values(uid,v.id,operation,text_value);
   return wirenexus_private.community_projection(v.id)||jsonb_build_object('state',case operation when 'approve' then 'approved' when 'reject' then 'rejected' else 'unpublished' end);
 end if;
 if operation in ('download','download-chunk','review-artwork') then
   select * into v from wirenexus_private.community_versions where id=(payload->>'versionId')::uuid;
   select * into d from wirenexus_private.community_devices where id=v.device_id;
   if v.id is null or not (d.owner_id=uid or elevated or (v.state='approved' and d.approved_version_id=v.id)) then raise exception 'Version unavailable' using errcode='42501';end if;
   if operation='review-artwork' then
     select a.bytes into data from wirenexus_private.community_artwork a join wirenexus_private.community_version_artwork r on r.hash=a.hash
       where r.version_id=v.id and r.hash=v.preview_hash and r.hash=payload->>'hash';
     if data is null then raise exception 'Artwork unavailable' using errcode='42501';end if;
     return jsonb_build_object('data',encode(data,'base64'),'mime','image/png');
   end if;
   if operation='download' then return wirenexus_private.community_projection(v.id)||jsonb_build_object('chunkSize',262144);end if;
   idx:=(payload->>'index')::integer;
   if idx is null or idx<0 or idx::bigint*262144>=octet_length(v.package_bytes) then raise exception 'Invalid chunk' using errcode='22023';end if;
   return jsonb_build_object('index',idx,'data',encode(substring(v.package_bytes from idx*262144+1 for 262144),'base64'));
 end if;
 if operation not in ('begin','chunk','materialize','commit','cancel') then raise exception 'Unknown community operation' using errcode='22023';end if;
 select * into lim from wirenexus_private.community_limits where id for share;
 insert into wirenexus_private.community_accounts(owner_id) values(uid) on conflict do nothing;
 select * into acc from wirenexus_private.community_accounts where owner_id=uid for update;
 delete from wirenexus_private.community_uploads where owner_id=uid and completed_version_id is null and expires_at<=now();
 if operation='begin' then
   expected:=(payload->>'byteCount')::integer;
   if expected is null or expected<47 or expected>lim.max_package_bytes or coalesce(payload->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid upload size or hash' using errcode='22023';end if;
   if (select count(*) from wirenexus_private.community_uploads where owner_id=uid and completed_version_id is null)>=lim.max_pending then raise exception 'Too many pending uploads' using errcode='P0402';end if;
   if acc.window_start+interval '1 hour'<=now() then acc.window_start:=now();acc.upload_count:=0;end if;
   if acc.upload_count>=lim.hourly_uploads then raise exception 'Upload rate exceeded' using errcode='P0429';end if;
   select coalesce(sum(octet_length(ver.package_bytes)+ver.artwork_bytes),0),count(*) into total,count_versions from wirenexus_private.community_versions ver join wirenexus_private.community_devices dv on dv.id=ver.device_id where dv.owner_id=uid;
   total:=total+(select coalesce(sum(byte_count),0) from wirenexus_private.community_uploads where owner_id=uid and completed_version_id is null);
   if total+expected>lim.max_owner_bytes or count_versions>=lim.max_versions then raise exception 'Community storage quota exceeded' using errcode='P0402';end if;
   ident:=(payload->>'deviceId')::uuid;
   if ident is not null then
     select * into d from wirenexus_private.community_devices where id=ident;
     if d.id is null or d.owner_id<>uid then raise exception 'Device unavailable' using errcode='42501';end if;
     if d.revision is distinct from (payload->>'expectedRevision')::bigint then raise exception 'Device changed' using errcode='40001';end if;
   else ident:=gen_random_uuid();end if;
   insert into wirenexus_private.community_uploads(owner_id,device_id,expected_revision,byte_count,source_sha,creator_name,created_at)
     values(uid,ident,coalesce(d.revision,0),expected,payload->>'sha256',wirenexus_private.community_creator(uid),date_trunc('milliseconds',coalesce(d.created_at,now()))) returning * into u;
   update wirenexus_private.community_accounts set window_start=acc.window_start,upload_count=acc.upload_count+1 where owner_id=uid;
   return jsonb_build_object('uploadId',u.id,'deviceId',u.device_id,'chunkSize',262144,'expiresAt',u.expires_at);
 end if;
 select * into u from wirenexus_private.community_uploads where id=(payload->>'uploadId')::uuid and owner_id=uid for update;
 if u.id is null then raise exception 'Upload unavailable' using errcode='42501';end if;
 if u.completed_version_id is not null then
   if operation not in ('materialize','commit') then raise exception 'Upload completed' using errcode='40001';end if;
   return jsonb_build_object('completed',wirenexus_private.community_projection(u.completed_version_id));
 end if;
 if operation='cancel' then delete from wirenexus_private.community_uploads where id=u.id;return '{}'::jsonb;end if;
 if operation='chunk' then
   idx:=(payload->>'index')::integer;data:=decode(payload->>'data','base64');
   if idx is null or idx<0 or data is null or idx::bigint*262144>=u.byte_count then raise exception 'Invalid chunk' using errcode='22023';end if;
   expected:=least(262144,u.byte_count-idx*262144);
   if octet_length(data)<>expected then raise exception 'Invalid chunk size' using errcode='22023';end if;
   select bytes into existing from wirenexus_private.community_chunks where upload_id=u.id and index=idx;
   if existing is not null then
     if existing<>data then raise exception 'Chunk already differs' using errcode='40001';end if;
   else
     if idx<>(select count(*) from wirenexus_private.community_chunks where upload_id=u.id) then raise exception 'Upload chunks out of order' using errcode='40001';end if;
     insert into wirenexus_private.community_chunks values(u.id,idx,data);
     update wirenexus_private.community_uploads set received=received+octet_length(data) where id=u.id;
   end if;
   return jsonb_build_object('received',case when existing is null then u.received+octet_length(data) else u.received end);
 end if;
 if u.received<>u.byte_count then raise exception 'Upload incomplete' using errcode='40001';end if;
 select string_agg(bytes,''::bytea order by index) into data from wirenexus_private.community_chunks where upload_id=u.id;
 if octet_length(data)<>u.byte_count or encode(sha256(data),'hex')<>u.source_sha then raise exception 'Upload integrity failed' using errcode='22023';end if;
 if operation='materialize' then return jsonb_build_object('data',encode(data,'base64'),'creatorId',uid,'displayName',u.creator_name,'createdAt',u.created_at);end if;
 -- A service-only materialization has passed the .wnx decoder, image sanitizer
 -- and account-bound signer. Validate its storage receipt again transactionally.
 data:=decode(payload->>'data','base64');
 if data is null or octet_length(data)<47 or octet_length(data)>lim.max_package_bytes or encode(sha256(data),'hex') is distinct from payload->>'sha256'
   or encode(substring(data from 1 for 10),'hex')<>'574e58504b470d0a0001' or coalesce(payload->>'contentSha','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid validated package' using errcode='22023';end if;
 if payload->'attribution'->>'creatorId' is distinct from uid::text or payload->'attribution'->>'displayName' is distinct from u.creator_name
   or (payload->'attribution'->>'createdAt')::timestamptz is distinct from u.created_at or payload->'attribution'->'proof'->'claims'->>'digest' is distinct from payload->>'contentSha'
   or payload->'attribution'->'proof'->'claims'->>'creatorId' is distinct from uid::text or payload->'attribution'->'proof'->>'algorithm' is distinct from 'ES256' then raise exception 'Invalid trusted attribution' using errcode='22023';end if;
 metadata:=payload->'metadata';
 if jsonb_typeof(metadata) is distinct from 'object' or (select count(*) from jsonb_object_keys(metadata))<>9 then raise exception 'Invalid public metadata' using errcode='22023';end if;
 foreach k in array array['title','brand','category','description'] loop
   text_value:=metadata->>k;
   if jsonb_typeof(metadata->k) is distinct from 'string' or length(text_value)>(case when k='description' then 1000 else 120 end) or text_value ~ '[<>@[:cntrl:]]' or (k='title' and length(btrim(text_value))=0) then raise exception 'Unsafe public metadata' using errcode='22023';end if;
 end loop;
 foreach k in array array['inputCount','outputCount','cardCount','dependencyCount'] loop
   if jsonb_typeof(metadata->k) is distinct from 'number' or (metadata->>k) !~ '^[0-9]{1,5}$' then raise exception 'Invalid device counts' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(metadata->'connectorTypes') is distinct from 'array' or jsonb_array_length(metadata->'connectorTypes')>32 then raise exception 'Invalid connector types' using errcode='22023';end if;
 for text_value in select jsonb_array_elements_text(metadata->'connectorTypes') loop
   if length(text_value)>120 or text_value ~ '[<>@[:cntrl:]]' then raise exception 'Unsafe connector type' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(payload->'artwork') is distinct from 'array' or jsonb_array_length(payload->'artwork')>129 then raise exception 'Invalid artwork manifest' using errcode='22023';end if;
 for asset in select jsonb_array_elements(payload->'artwork') loop
   image:=decode(asset->>'data','base64');
   if image is null or encode(sha256(image),'hex') is distinct from asset->>'hash' or encode(substring(image from 1 for 8),'hex')<>'89504e470d0a1a0a' then raise exception 'Invalid sanitized artwork' using errcode='22023';end if;
   image_total:=image_total+octet_length(image);
   if image_total>16777216 then raise exception 'Artwork quota exceeded' using errcode='P0402';end if;
 end loop;
 if payload->>'previewHash' is not null and not exists(select 1 from jsonb_array_elements(payload->'artwork') a where a->>'hash'=payload->>'previewHash') then raise exception 'Preview missing' using errcode='22023';end if;
 select coalesce(sum(octet_length(ver.package_bytes)+ver.artwork_bytes),0),count(*) into total,count_versions from wirenexus_private.community_versions ver join wirenexus_private.community_devices dv on dv.id=ver.device_id where dv.owner_id=uid;
 total:=total+(select coalesce(sum(byte_count),0) from wirenexus_private.community_uploads where owner_id=uid and completed_version_id is null and id<>u.id);
 if total+octet_length(data)+image_total>lim.max_owner_bytes or count_versions>=lim.max_versions then raise exception 'Community storage quota exceeded' using errcode='P0402';end if;
 insert into wirenexus_private.community_devices(id,owner_id,created_at) values(u.device_id,uid,u.created_at) on conflict do nothing;
 select * into d from wirenexus_private.community_devices where id=u.device_id for update;
 if d.owner_id<>uid or d.revision<>u.expected_revision then raise exception 'Device changed during submission' using errcode='40001';end if;
 insert into wirenexus_private.community_versions(device_id,number,package_bytes,package_sha,content_sha,metadata,attribution,preview_hash,artwork_bytes)
   values(d.id,(select coalesce(max(number),0)+1 from wirenexus_private.community_versions where device_id=d.id),data,payload->>'sha256',payload->>'contentSha',metadata,payload->'attribution',payload->>'previewHash',image_total) returning id into vid;
 for asset in select jsonb_array_elements(payload->'artwork') loop
   insert into wirenexus_private.community_artwork values(asset->>'hash',decode(asset->>'data','base64')) on conflict do nothing;
   insert into wirenexus_private.community_version_artwork values(vid,asset->>'hash');
 end loop;
 update wirenexus_private.community_devices set revision=revision+1 where id=d.id;
 update wirenexus_private.community_uploads set completed_version_id=vid where id=u.id;
 delete from wirenexus_private.community_chunks where upload_id=u.id;
 insert into wirenexus_private.community_events(actor_id,version_id,operation) values(uid,vid,'submit');
 return wirenexus_private.community_projection(vid)||jsonb_build_object('state','pending');
end $$;
revoke all on function public.wirenexus_community(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_community(text,jsonb) to service_role;
commit;
