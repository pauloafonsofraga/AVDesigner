import {readFile} from 'node:fs/promises';
import {collaborationDatabase,OWNER,STRANGER} from './collaborationDatabase.mjs';
export {OWNER,STRANGER};
export async function liveCollaborationDatabase() {
  const base=await collaborationDatabase();
  // Minimal Realtime contract, not a simulated permission bypass. Actual policies
  // run against this table; SQL send records only transport notifications.
  await base.db.exec(`create schema realtime;
    create table realtime.messages(topic text,payload jsonb,extension text);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select,insert on realtime.messages to authenticated;
    create policy broad_existing_read on realtime.messages for select to authenticated using(true);
    create policy broad_existing_write on realtime.messages for insert to authenticated with check(true);
    create function realtime.topic() returns text language sql stable as $$select current_setting('test.realtime_topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
      insert into realtime.messages values(topic,payload,'broadcast')$$;`);
  await base.db.exec(await readFile(new URL('../../supabase/migrations/202610290002_live_collaboration.sql',import.meta.url),'utf8'));
  const live=async(operation,payload)=>base.db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return (await tx.query('select public.wirenexus_live($1,$2) as value',[operation,JSON.stringify(payload)])).rows[0].value;
  });
  return {...base,live};
}
