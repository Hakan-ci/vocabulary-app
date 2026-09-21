import test from 'node:test'
import assert from 'node:assert/strict'
import {database} from './dbHarness.mjs'
import {readFile} from 'node:fs/promises'
const id=()=>crypto.randomUUID(),hash='a'.repeat(64)
async function fixture(){const db=await database();const owner=id();await db.query('insert into auth.users values($1)',[owner]);return {db,owner}}
const reserve=async(db,owner,attempt=id())=>(await db.query('select public.kelime_voice_reserve($1,$2,$3,$4) r',[owner,attempt,id(),hash])).rows[0].r
const state=async(db,owner,attempt,action,provider=null,seconds=null)=>(await db.query('select public.kelime_voice_state($1,$2,$3,$4,$5) r',[owner,attempt,action,provider,seconds])).rows[0].r
const healthy=db=>db.query('select public.kelime_voice_heartbeat()')
test('008 upgrades evidence provenance and preserves old records, RLS and protocol gates',async()=>{
 const db=await database(7),owner=id()
 try{
  await db.query('insert into auth.users values($1)',[owner]);await db.exec(await readFile(new URL('../supabase/migrations/008_independent_ai_voice.sql',import.meta.url),'utf8'))
  await db.exec(`set "request.jwt.claim.sub"='${owner}';set role authenticated`)
  const e={id:id(),sourceQuizId:null,completedAt:1,mode:'conversation',evaluator:'openai',epoch:0,words:[{wordId:'b:0',direction:'turkishToEnglish',outcome:'notAttempted',retrieval:'unassessed',semantic:'unassessed',grammar:'unassessed',suggested:false}]}
  const apply=async after=>(await db.query('select public.kelime_apply_v5($1) r',[{id:id(),accountId:owner,protocol:5,learningEpoch:0,at:1,kind:'ai-complete',changes:[{key:'ai-evidence/'+after.id,before:null,after}]}])).rows[0].r
  assert.equal((await apply(e)).conflict,false)
  const modern={...e,id:id(),schemaVersion:2,provenance:'automatic',inputModality:'voice'};assert.equal((await apply(modern)).conflict,false)
  assert.equal((await apply({...modern,inputModality:'text'})).conflict,true)
  for(const patch of [{schemaVersion:3},{inputModality:'audio'},{provenance:null},{provenance:'manual',sourceQuizId:id()},{evaluator:'mock'}])await assert.rejects(()=>apply({...modern,id:id(),...patch}),/Invalid evidence/)
  for(const table of ['ai_voice_sessions','ai_voice_health'])await assert.rejects(()=>db.query('select * from public.'+table),/permission denied/)
  await assert.rejects(()=>healthy(db),/permission denied/);await assert.rejects(()=>reserve(db,owner),/permission denied/)
 }finally{await db.close()}
})
test('voice reservations fail closed, serialize concurrency, deduplicate, enforce ownership and terminal status',async()=>{
 const {db,owner}=await fixture()
 try{
  assert.equal(await reserve(db,owner),'unavailable');await healthy(db)
  const attempt=id();assert.equal(await reserve(db,owner,attempt),'reserved');assert.equal(await reserve(db,owner,attempt),'duplicate');assert.equal(await reserve(db,owner),'busy')
  assert.equal(await state(db,id(),attempt,'get'),null)
  await state(db,owner,attempt,'attach','live_test');await state(db,owner,attempt,'closed',null,60)
  await state(db,owner,attempt,'uncertain');assert.equal((await state(db,owner,attempt,'get')).closed,true)
  assert.equal((await db.query('select cost_micros from public.ai_voice_sessions where id=$1',[attempt])).rows[0].cost_micros,50000)
  const results=await Promise.all([reserve(db,owner),reserve(db,owner)]);assert.equal(results.filter(r=>r==='reserved').length,1)
 }finally{await db.close()}
})
test('voice and text share daily budgets; unknown and overdue sessions block new voice, cleanup retains uncertain charges',async()=>{
 const {db,owner}=await fixture()
 try{
  await healthy(db);const attempt=id();await reserve(db,owner,attempt);await state(db,owner,attempt,'closed')
  assert.equal((await db.query("select public.kelime_ai_reserve($1,$2,$3,$4,$5,'gpt-5.6-terra',810000) r",[owner,id(),id(),id(),hash])).rows[0].r,'budget')
  const a=id();assert.equal(await reserve(db,owner,a),'reserved');await db.query("update public.ai_voice_sessions set deadline=clock_timestamp()-interval '1 second' where id=$1",[a]);assert.equal(await reserve(db,owner),'unavailable')
  const rows=(await db.query('select public.kelime_voice_sweep() r')).rows[0].r;assert.equal(rows.length,1)
  assert.equal((await db.query('select cost_micros from public.ai_voice_sessions where id=$1',[a])).rows[0].cost_micros,200000)
  await state(db,owner,a,'closed');await db.query("update public.ai_voice_sessions set created_at=clock_timestamp()-interval '8 days'");await db.query('select public.kelime_voice_sweep()');assert.equal((await db.query('select count(*) n from public.ai_voice_sessions')).rows[0].n,0)
 }finally{await db.close()}
})

test('global concurrency, minute/day caps, heartbeat expiry and retention safety latch are enforced',async()=>{
 const {db,owner}=await fixture()
 try{
  await healthy(db);const others=[id(),id(),id()];for(const user of others)await db.query('insert into auth.users values($1)',[user])
  const attempts=[id(),id(),id()];for(const [i,user] of [owner,...others.slice(0,2)].entries())assert.equal(await reserve(db,user,attempts[i]),'reserved')
  assert.equal(await reserve(db,others[2]),'busy')
  for(const [i,user] of [owner,...others.slice(0,2)].entries())await state(db,user,attempts[i],'closed')
  for(let i=0;i<2;i++){const a=id();assert.equal(await reserve(db,owner,a),'reserved');await state(db,owner,a,'closed')}
  assert.equal(await reserve(db,owner),'rate_limit')
  await db.query("update public.ai_voice_sessions set created_at=clock_timestamp()-interval '2 minutes' where owner_id=$1",[owner])
  const fourth=id();assert.equal(await reserve(db,owner,fourth),'reserved');await state(db,owner,fourth,'closed');assert.equal(await reserve(db,owner),'rate_limit')
  await db.query("update public.ai_voice_health set checked_at=clock_timestamp()-interval '91 seconds'");assert.equal(await reserve(db,others[2]),'unavailable');await healthy(db)
  const orphan=id();assert.equal(await reserve(db,others[2],orphan),'reserved');await db.query("update public.ai_voice_sessions set created_at=clock_timestamp()-interval '8 days' where id=$1",[orphan]);await db.query('select public.kelime_voice_sweep()');await healthy(db)
  assert.equal((await db.query('select blocked from public.ai_voice_health')).rows[0].blocked,true)
  assert.equal(await reserve(db,others[0]),'unavailable');assert.equal((await db.query('select count(*) n from public.ai_voice_sessions where id=$1',[orphan])).rows[0].n,0)
 }finally{await db.close()}
})
