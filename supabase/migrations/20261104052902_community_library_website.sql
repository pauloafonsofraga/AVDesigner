-- Phase 3 read model. Never grants public access to pending package bytes.
begin;
create table wirenexus_private.community_presentations (
 version_id uuid primary key references wirenexus_private.community_versions(id),
 model text not null, front_hash text, rear_hash text, connectors jsonb not null, truncated boolean not null default false
);
alter table wirenexus_private.community_presentations enable row level security;
revoke all on wirenexus_private.community_presentations from public,anon,authenticated,service_role;
create function wirenexus_private.community_website_projection(vid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select wirenexus_private.community_projection(ver.id)||jsonb_build_object('model',p.model,
 'frontHash',coalesce(p.front_hash,ver.preview_hash),'rearHash',p.rear_hash,'connectors',coalesce(p.connectors,'[]'),
 'connectorsTruncated',coalesce(p.truncated,false))
 from wirenexus_private.community_versions ver left join wirenexus_private.community_presentations p on p.version_id=ver.id where ver.id=vid
$$;
revoke all on function wirenexus_private.community_website_projection(uuid) from public,anon,authenticated,service_role;
alter function public.wirenexus_community(text,jsonb) rename to community_phase2;
alter function public.community_phase2(text,jsonb) set schema wirenexus_private;
revoke all on function wirenexus_private.community_phase2(text,jsonb) from public,anon,authenticated,service_role;
create function public.wirenexus_community(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; presentation jsonb; ver wirenexus_private.community_versions; entry jsonb; ident uuid;
 page_size integer; after_id uuid; filter_name text; datum text; image bytea;
begin
 if operation in ('list','facets') then
   if operation='facets' then return jsonb_build_object(
     'manufacturers',(select coalesce(jsonb_agg(value order by value),'[]') from (select distinct v.metadata->>'brand' value from wirenexus_private.community_devices d join wirenexus_private.community_versions v on v.id=d.approved_version_id where v.state='approved' and v.metadata->>'brand'<>'') names),
     'models',(select coalesce(jsonb_agg(value order by value),'[]') from (select distinct p.model value from wirenexus_private.community_devices d join wirenexus_private.community_versions v on v.id=d.approved_version_id join wirenexus_private.community_presentations p on p.version_id=v.id where v.state='approved' and p.model<>'') names),
     'categories',(select coalesce(jsonb_agg(value order by value),'[]') from (select distinct v.metadata->>'category' value from wirenexus_private.community_devices d join wirenexus_private.community_versions v on v.id=d.approved_version_id where v.state='approved' and v.metadata->>'category'<>'') names));end if;
   page_size:=coalesce((payload->>'limit')::integer,25);after_id:=(payload->>'after')::uuid;
   if page_size<1 or page_size>50 or length(coalesce(payload->>'search',''))>100 then raise exception 'Invalid page' using errcode='22023';end if;
   foreach filter_name in array array['manufacturer','model','category'] loop
     if length(coalesce(payload->>filter_name,''))>120 then raise exception 'Invalid filter' using errcode='22023';end if;
   end loop;
   return (select coalesce(jsonb_agg(wirenexus_private.community_website_projection(id) order by device_id),'[]') from
     (select v.id,d.id device_id from wirenexus_private.community_devices d join wirenexus_private.community_versions v on v.id=d.approved_version_id
       left join wirenexus_private.community_presentations p on p.version_id=v.id
       where v.state='approved' and (after_id is null or d.id>after_id)
       and position(lower(coalesce(payload->>'search','')) in lower(concat_ws(' ',v.metadata->>'title',v.metadata->>'brand',v.metadata->>'category',p.model)))>0
       and (coalesce(payload->>'manufacturer','')='' or lower(v.metadata->>'brand')=lower(payload->>'manufacturer'))
       and (coalesce(payload->>'model','')='' or lower(p.model)=lower(payload->>'model'))
       and (coalesce(payload->>'category','')='' or lower(v.metadata->>'category')=lower(payload->>'category'))
       order by d.id limit page_size) page);
 end if;
 if operation in ('preview','history','artwork') then
   result:=wirenexus_private.community_phase2('preview',payload);
   ident:=(result->>'versionId')::uuid;
   if operation='preview' then return wirenexus_private.community_website_projection(ident);end if;
   if operation='history' then
     -- Publish events only: no pending/rejected content, old package IDs or reasons.
     return (select coalesce(jsonb_agg(jsonb_build_object('version',number,'publishedAt',published,'current',id=ident) order by number desc),'[]') from
       (select v.id,v.number,max(e.created_at) published from wirenexus_private.community_versions v
         join wirenexus_private.community_events e on e.version_id=v.id and e.operation='approve'
         where v.device_id=(payload->>'deviceId')::uuid group by v.id,v.number) history);
   end if;
 elsif operation='review-artwork' then
   result:=wirenexus_private.community_phase2('download',payload);ident:=(payload->>'versionId')::uuid;
 end if;
 if operation in ('artwork','review-artwork') then
   select a.bytes into image from wirenexus_private.community_artwork a join wirenexus_private.community_version_artwork r on r.hash=a.hash
     join wirenexus_private.community_versions v on v.id=r.version_id left join wirenexus_private.community_presentations p on p.version_id=v.id
     where v.id=ident and a.hash=payload->>'hash' and (a.hash=coalesce(p.front_hash,v.preview_hash) or a.hash=p.rear_hash);
   if image is null then raise exception 'Preview unavailable' using errcode='42501';end if;
   return jsonb_build_object('data',encode(image,'base64'),'mime','image/png');
 end if;
 result:=wirenexus_private.community_phase2(operation,payload);
 if operation='commit' and payload ? 'presentation' and not(result ? 'completed') then
   ident:=(result->>'versionId')::uuid;presentation:=payload->'presentation';
   if jsonb_typeof(presentation->'model') is distinct from 'string' or length(presentation->>'model')>120 or (presentation->>'model') ~ '[<>@[:cntrl:]]'
     or jsonb_typeof(presentation->'connectors') is distinct from 'array' or jsonb_array_length(presentation->'connectors')>512
     or jsonb_typeof(presentation->'truncated') is distinct from 'boolean' then raise exception 'Invalid presentation' using errcode='22023';end if;
   for entry in select jsonb_array_elements(presentation->'connectors') loop
     if jsonb_typeof(entry) is distinct from 'object' or (select count(*) from jsonb_object_keys(entry))<>4 or coalesce(entry->>'direction','') not in ('input','output','bidirectional') then raise exception 'Invalid connector preview' using errcode='22023';end if;
     foreach filter_name in array array['name','type','card'] loop
       datum:=entry->>filter_name;
       if jsonb_typeof(entry->filter_name) is distinct from 'string' or length(datum)>120 or datum ~ '[<>@[:cntrl:]]' then raise exception 'Unsafe connector preview' using errcode='22023';end if;
     end loop;
   end loop;
   foreach filter_name in array array['frontHash','rearHash'] loop
     datum:=presentation->>filter_name;
     if datum is not null and not exists(select 1 from wirenexus_private.community_version_artwork where version_id=ident and hash=datum) then raise exception 'Missing preview artwork' using errcode='22023';end if;
   end loop;
   insert into wirenexus_private.community_presentations values(ident,presentation->>'model',presentation->>'frontHash',presentation->>'rearHash',presentation->'connectors',(presentation->>'truncated')::boolean);
 end if;
 if operation in ('commit','approve','reject','unpublish','download') then
   if result ? 'versionId' then return result||wirenexus_private.community_website_projection((result->>'versionId')::uuid);end if;
 end if;
 if operation in ('mine','queue') then
   return (select coalesce(jsonb_agg(item||wirenexus_private.community_website_projection((item->>'versionId')::uuid)),'[]') from jsonb_array_elements(result) item);
 end if;
 return result;
end $$;
revoke all on function public.wirenexus_community(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_community(text,jsonb) to service_role;
commit;
