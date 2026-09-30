-- Run once in the Supabase SQL editor, then provision the owner as documented.
create schema if not exists wirenexus_private;
revoke all on schema wirenexus_private from public, anon, authenticated;
create table wirenexus_private.owner (
  singleton boolean primary key default true check (singleton),
  account_id uuid not null unique references auth.users(id)
);
create table wirenexus_private.library (
  account_id uuid primary key references auth.users(id),
  document jsonb not null default '{"version":2,"generation":0,"entries":{},"migrations":{}}'
);
create table wirenexus_private.artwork (
  account_id uuid not null references auth.users(id),
  hash text not null check (hash ~ '^[a-f0-9]{64}$'),
  bytes bytea not null,
  primary key(account_id, hash),
  check (encode(sha256(bytes), 'hex') = hash)
);
alter table wirenexus_private.owner enable row level security;
alter table wirenexus_private.library enable row level security;
alter table wirenexus_private.artwork enable row level security;
revoke all on all tables in schema wirenexus_private from public, anon, authenticated;

-- No account ID is accepted from the caller. Only a verified Auth JWT can select
-- the singleton owner. Generation CAS covers deletions, preferences and receipts.
create or replace function public.wirenexus_library(operation text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); current_doc jsonb; next_doc jsonb; entry record;
  bytes bytea; ref jsonb; asset_hash text; expected jsonb;
begin
  if uid is null or not exists(select 1 from wirenexus_private.owner o where o.account_id = uid) then
    raise exception 'Owner authorization required' using errcode = '42501';
  end if;
  if operation = 'identity' then return jsonb_build_object('accountId', uid, 'admin', true); end if;
  if operation = 'upload' then
    asset_hash := payload->>'hash'; bytes := decode(payload->>'base64', 'base64');
    if bytes is null or octet_length(bytes) = 0 or encode(sha256(bytes),'hex') is distinct from asset_hash then
      raise exception 'Artwork hash mismatch';
    end if;
    insert into wirenexus_private.artwork values(uid, asset_hash, bytes) on conflict do nothing;
    return jsonb_build_object('hash', asset_hash);
  end if;
  if operation = 'asset' then
    select a.bytes into bytes from wirenexus_private.artwork a where a.account_id = uid and a.hash = payload->>'hash';
    if bytes is null then raise exception 'Required artwork missing'; end if;
    return jsonb_build_object('base64', encode(bytes, 'base64'));
  end if;
  insert into wirenexus_private.library(account_id) values(uid) on conflict do nothing;
  select l.document into current_doc from wirenexus_private.library l where l.account_id = uid for update;
  if operation = 'read' then return current_doc; end if;
  if operation <> 'commit' then raise exception 'Unknown library operation'; end if;
  next_doc := payload->'document'; expected := payload->'expectedRevisions';
  if (payload->>'expectedGeneration')::bigint is distinct from (current_doc->>'generation')::bigint then
    raise exception 'Library changed on another computer. Refresh and review before saving.' using errcode = '40001';
  end if;
  if next_doc->>'version' is distinct from '2' or jsonb_typeof(next_doc->'entries') is distinct from 'object'
    or jsonb_typeof(next_doc->'migrations') is distinct from 'object'
    or (next_doc->>'generation')::bigint is distinct from (current_doc->>'generation')::bigint + 1 then
    raise exception 'Invalid library document';
  end if;
  for entry in select key from jsonb_each(current_doc->'entries') union select key from jsonb_each(next_doc->'entries') loop
    if current_doc->'entries'->entry.key is distinct from next_doc->'entries'->entry.key then
      if not coalesce(expected ? entry.key, false) or expected->entry.key is distinct from coalesce(current_doc->'entries'->entry.key->'revision', 'null'::jsonb) then
        raise exception 'Definition revision conflict' using errcode = '40001';
      end if;
      if next_doc->'entries' ? entry.key then
        if entry.key in ('__proto__','constructor','prototype')
          or next_doc->'entries'->entry.key->'definition'->>'id' is distinct from entry.key
          or coalesce(next_doc->'entries'->entry.key->>'revision','') = ''
          or next_doc->'entries'->entry.key->>'revision' = current_doc->'entries'->entry.key->>'revision'
          or jsonb_typeof(next_doc->'entries'->entry.key->'dependencies'->'nodes') is distinct from 'array'
          or jsonb_typeof(next_doc->'entries'->entry.key->'dependencies'->'devices') is distinct from 'array' then
          raise exception 'Invalid definition or unchanged revision';
        end if;
      end if;
    end if;
  end loop;
  for ref in select value from jsonb_path_query(next_doc->'entries', '$.** ? (@.type() == "string")') as v(value) loop
    if (ref #>> '{}') like 'wirenexus-artwork:%' then
      asset_hash := substr(ref #>> '{}', 19);
      if not exists(select 1 from wirenexus_private.artwork a where a.account_id = uid and a.hash = asset_hash) then
        raise exception 'Required artwork missing. Previous library retained.';
      end if;
    elsif (ref #>> '{}') ~ '^(blob:|data:image/)' then
      raise exception 'Artwork must be stored by verified content identity';
    end if;
  end loop;
  update wirenexus_private.library set document = next_doc where account_id = uid;
  return next_doc;
end $$;
revoke all on function public.wirenexus_library(text,jsonb) from public, anon;
grant execute on function public.wirenexus_library(text,jsonb) to authenticated;
