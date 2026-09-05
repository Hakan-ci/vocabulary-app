import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
export async function database() {
 const db=new PGlite()
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`)
 await db.exec(await readFile(new URL('../supabase/migrations/001_kelime.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/002_events.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/003_vocabulary_deletion.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/004_pronunciation.sql',import.meta.url),'utf8'))
 return db
}
