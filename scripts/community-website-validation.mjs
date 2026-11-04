import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sql=await readFile(new URL('../supabase/migrations/20261104052902_community_library_website.sql',import.meta.url),'utf8');
assert.match(sql,/alter table wirenexus_private.community_presentations enable row level security/);
assert.match(sql,/revoke all on function wirenexus_private.community_phase2\(text,jsonb\) from public,anon,authenticated,service_role/);
assert.match(sql,/revoke all on function public.wirenexus_community\(text,jsonb\) from public,anon,authenticated/);
assert.match(sql,/grant execute on function public.wirenexus_community\(text,jsonb\) to service_role/);
assert.doesNotMatch(sql,/grant .* to (?:anon|authenticated)/i);
const directory=await mkdtemp(join(tmpdir(),'community-static-'));
try{
  const output=join(directory,'site');
  execFileSync(process.execPath,[new URL('./build-videocore-website.mjs',import.meta.url).pathname,output,'https://app.example.test/','https://api.example.test/api/community-devices'],{stdio:'pipe'});
  const bundle=await readFile(join(output,'library.js'),'utf8');
  assert.ok(bundle.includes('https://app.example.test/'));assert.ok(bundle.includes('https://api.example.test/api/community-devices'));
  assert.doesNotMatch(bundle,/innerHTML|service_role|access_token|supabase-js|localStorage/);
  for(const page of ['index','device'])assert.match(await readFile(join(output,'wirenexus/library',page+'.html'),'utf8'),/library.js/);
}finally{await rm(directory,{recursive:true,force:true});}
console.log('Community website validation PASS: isolated public build, private presentation/RPC grants and token-free handoff');
