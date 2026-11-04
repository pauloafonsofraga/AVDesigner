import {readFile} from 'node:fs/promises';
import {liveCollaborationDatabase,OWNER,STRANGER} from './liveCollaborationDatabase.mjs';
export {OWNER,STRANGER};

export async function cloudArtworkDatabase() {
  const base=await liveCollaborationDatabase();
  // Storage API bytes live outside Postgres; this is its metadata/RLS contract.
  await base.db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,
      metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create policy existing_broad_access on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.buckets(id,name,public) values('other','other',true);`);
  const usageOid=(await base.db.query("select 'wirenexus_private.plan_usage(uuid)'::regprocedure::oid as oid")).rows[0].oid;
  await base.db.exec(await readFile(new URL('../../supabase/migrations/20261104091750_cloud_project_artwork.sql',import.meta.url),'utf8'));
  const artwork=(uid=OWNER)=>async(operation,payload={})=>base.asUser(uid,async tx=>
    (await tx.query('select public.wirenexus_project_artwork($1,$2) as value',
      [operation,JSON.stringify({expectedAccountId:uid,...payload})])).rows[0].value);
  const artworkAdmin=(uid=OWNER)=>async(operation,payload={})=>base.db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return (await tx.query('select public.wirenexus_project_artwork_admin($1,$2) as value',
      [operation,JSON.stringify({actorId:uid,...payload})])).rows[0].value;
  });
  const putObject=(path,uid=OWNER,bucket='wirenexus-project-artwork',metadata={size:8,mimetype:'application/octet-stream'})=>base.asUser(uid,tx=>
    tx.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,path,JSON.stringify(metadata)]));
  return {...base,usageOid,artwork,artworkAdmin,putObject};
}
