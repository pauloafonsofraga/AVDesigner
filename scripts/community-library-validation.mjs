import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
execFileSync(process.execPath,[new URL('./build-community-package.mjs',import.meta.url).pathname,'--check'],{stdio:'inherit'});
const sql=await readFile(new URL('../supabase/migrations/20261103181243_community_device_library.sql',import.meta.url),'utf8');
for(const table of ['limits','accounts','devices','versions','artwork','version_artwork','uploads','chunks','events'])assert.ok(sql.includes(`alter table wirenexus_private.community_${table} enable row level security`));
assert.match(sql,/revoke all on function public.wirenexus_community\(text,jsonb\) from public,anon,authenticated/);
assert.match(sql,/grant execute on function public.wirenexus_community\(text,jsonb\) to service_role/);
console.log('Community validation PASS: reproducible server-only package validator, private RLS tables and restricted RPC');
