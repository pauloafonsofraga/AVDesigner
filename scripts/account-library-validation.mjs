import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
execFileSync(process.execPath, [new URL('./build-account-auth.mjs', import.meta.url).pathname, '--check'], { stdio:'inherit' });
const sql = await readFile(new URL('../supabase/migrations/202609290001_owner_library.sql',import.meta.url),'utf8');
for (const pattern of [/auth.uid\(\)/,/security definer set search_path = ''/,/for update/,/expectedRevisions/,/expectedGeneration/,/sha256\(bytes\)/]) assert.match(sql,pattern);
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
assert.doesNotMatch(html,/Saved in this browser|Use Factory Default|"Factory default"/);
console.log('Account validation PASS: reproducible Auth SDK bundle, server owner/CAS/artwork guards and UI terminology');
