-- Requires the owner-library migration; no signup or client table access.
create table wirenexus_private.publishers (
  account_id uuid primary key references auth.users(id), enabled boolean not null default true
);
create table wirenexus_private.publications (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,90}$'),
  owner_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','published','revoked')),
  project_path text not null unique, html_path text not null unique,
  project_bytes bigint not null check (project_bytes between 1 and 67108864),
  html_bytes bigint not null check (html_bytes between 1 and 134217728),
  metadata jsonb, created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create table wirenexus_private.publish_limits (key text primary key, bucket bigint not null, count integer not null);
alter table wirenexus_private.publishers enable row level security;
alter table wirenexus_private.publications enable row level security;
alter table wirenexus_private.publish_limits enable row level security;
revoke all on wirenexus_private.publishers, wirenexus_private.publications, wirenexus_private.publish_limits from public, anon, authenticated;

create function wirenexus_private.publish_limit(k text, maximum integer, seconds integer)
returns void language plpgsql set search_path = '' as $$
declare b bigint := floor(extract(epoch from now()) / seconds); n integer;
begin
  insert into wirenexus_private.publish_limits as l values(k,b,1)
  on conflict(key) do update set bucket=excluded.bucket,
    count=case when l.bucket=excluded.bucket then l.count+1 else 1 end
  returning count into n;
  if n > maximum then raise exception 'Request limit reached' using errcode='P0429'; end if;
end $$;
revoke all on function wirenexus_private.publish_limit(text,integer,integer) from public,anon,authenticated;

-- Only API code with the server key may invoke this RPC. The API verifies the
-- caller with Supabase Auth; a browser cannot supply or grant an owner identity.
create function public.wirenexus_publishing(operation text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; p wirenexus_private.publications; ident text; prefix text; m jsonb;
begin
  if operation='throttle' then
    if payload->>'scope' not in ('branding','unlock','auth') or payload->>'key' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid throttle'; end if;
    perform wirenexus_private.publish_limit((payload->>'scope')||':'||(payload->>'key'),
      case payload->>'scope' when 'unlock' then 15 when 'auth' then 60 else 90 end,60);
    if payload->>'scope'='unlock' and payload->>'publicationId' ~ '^[a-z0-9][a-z0-9-]{2,90}$' then
      perform wirenexus_private.publish_limit('unlock-publication:'||(payload->>'publicationId'),60,60);
    end if;
    return '{}'::jsonb;
  end if;
  if operation='lookup' then
    select * into p from wirenexus_private.publications where id=payload->>'id';
    if not found then return 'null'::jsonb; end if;
    if p.status<>'published' then return jsonb_build_object('unavailable',true); end if;
    return p.metadata || jsonb_build_object('htmlPath',p.html_path,'projectPath',p.project_path);
  end if;
  uid := (payload->>'accountId')::uuid;
  if uid is null or not (exists(select 1 from wirenexus_private.owner where account_id=uid)
      or exists(select 1 from wirenexus_private.publishers where account_id=uid and enabled)) then
    raise exception 'Publishing not authorized' using errcode='42501';
  end if;
  if operation='reserve' then
    perform wirenexus_private.publish_limit('reserve:'||uid,20,3600);
    perform wirenexus_private.publish_limit('reserve-day:'||uid,40,86400);
    ident := 'pub-'||gen_random_uuid()::text;
    prefix := 'avdesigner/publications/'||uid||'/'||ident||'/';
    insert into wirenexus_private.publications(id,owner_id,project_path,html_path,project_bytes,html_bytes)
      values(ident,uid,prefix||'project.json',prefix||'viewer.html',(payload->>'projectBytes')::bigint,(payload->>'htmlBytes')::bigint)
      returning * into p;
  else
    select * into p from wirenexus_private.publications where id=payload->>'id' for update;
    if not found or p.owner_id<>uid then raise exception 'Publication unavailable' using errcode='42501'; end if;
    if operation='revoke' then
      perform wirenexus_private.publish_limit('manage:'||uid,60,3600);
      update wirenexus_private.publications set status='revoked' where id=p.id;
      return jsonb_build_object('id',p.id,'revoked',true);
    end if;
    if p.status<>'pending' or p.expires_at<=now() then raise exception 'Publication is no longer pending' using errcode='42501'; end if;
    if operation='upload' then
      perform wirenexus_private.publish_limit('upload:'||uid,120,3600);
      if coalesce(payload->>'pathname','') not in (p.project_path,p.html_path) then raise exception 'Upload path not authorized' using errcode='42501'; end if;
    elsif operation='finalize' then
      perform wirenexus_private.publish_limit('finalize:'||uid,60,3600);
      m:=payload->'metadata';
      if jsonb_typeof(m) is distinct from 'object' or coalesce(length(m->>'title'),0) not between 1 and 120
          or coalesce(m->'password'->>'hash','') !~ '^[a-f0-9]{64}$'
          or coalesce(m->'password'->>'salt','') !~ '^[a-f0-9]{32}$'
          or m->'password'->>'iterations' is distinct from '120000'
          or m->'password'->>'digest' is distinct from 'sha256'
          or octet_length(m::text)>1100000 then raise exception 'Invalid publication metadata'; end if;
      update wirenexus_private.publications set metadata=m,status='published' where id=p.id;
    elsif operation<>'pending' then raise exception 'Invalid operation'; end if;
  end if;
  return jsonb_build_object('id',p.id,'projectPath',p.project_path,'htmlPath',p.html_path,
    'projectBytes',p.project_bytes,'htmlBytes',p.html_bytes,'expiresAt',p.expires_at);
end $$;
revoke all on function public.wirenexus_publishing(text,jsonb) from public,anon,authenticated;
grant execute on function public.wirenexus_publishing(text,jsonb) to service_role;
