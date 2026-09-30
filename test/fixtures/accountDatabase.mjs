import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const OWNER = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
export const STRANGER = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
export async function accountDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${OWNER}'),('${STRANGER}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(await readFile(new URL('../../supabase/migrations/202609290001_owner_library.sql', import.meta.url), 'utf8'));
  await db.query('insert into wirenexus_private.owner(account_id) values ($1)', [OWNER]);
  const rpc = (accountId = OWNER) => async (name, args) => {
    if (name !== 'wirenexus_library') return { error: { message: 'Unknown RPC' } };
    try {
      const data = await db.transaction(async tx => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [accountId || '']);
        await tx.exec(`set local role ${accountId ? 'authenticated' : 'anon'}`);
        return (await tx.query('select public.wirenexus_library($1,$2) as value', [args.operation, JSON.stringify(args.payload || {})])).rows[0].value;
      });
      return { data, error: null };
    } catch (error) { return { data: null, error: { message: error.message, code: error.code } }; }
  };
  return { db, rpc };
}
