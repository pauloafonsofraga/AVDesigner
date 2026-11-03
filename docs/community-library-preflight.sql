-- Read-only checks, only against a separately approved target after migration.
select n.nspname,c.relname,c.relrowsecurity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='wirenexus_private' and c.relkind='r' and c.relname like 'community_%'
 order by c.relname;
select has_function_privilege('anon','public.wirenexus_community(text,jsonb)','execute') as anon_must_be_false,
 has_function_privilege('authenticated','public.wirenexus_community(text,jsonb)','execute') as authenticated_must_be_false,
 has_function_privilege('service_role','public.wirenexus_community(text,jsonb)','execute') as service_must_be_true;
select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname='wirenexus_community')
 or (n.nspname='wirenexus_private' and p.proname in ('community_creator','community_projection'));
select count(*)=0 as invalid_package_receipts_must_be_true
 from wirenexus_private.community_versions where encode(sha256(package_bytes),'hex')<>package_sha;
select count(*)=0 as invalid_approved_heads_must_be_true
 from wirenexus_private.community_devices d left join wirenexus_private.community_versions v on v.id=d.approved_version_id
 where d.approved_version_id is not null and (v.state<>'approved' or v.device_id<>d.id);
select count(*)=0 as invalid_artwork_receipts_must_be_true
 from wirenexus_private.community_artwork where encode(sha256(bytes),'hex')<>hash;
select count(*)=0 as invalid_owner_attribution_must_be_true
 from wirenexus_private.community_versions v join wirenexus_private.community_devices d on d.id=v.device_id
 where v.attribution->>'creatorId' is distinct from d.owner_id::text;
