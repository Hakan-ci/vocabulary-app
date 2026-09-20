import test from 'node:test'
import assert from 'node:assert/strict'
import {database} from './dbHarness.mjs'
import {readFile} from 'node:fs/promises'
const id=()=>crypto.randomUUID(),owner=id(),other=id(),hash='a'.repeat(64)
async function fixture(){const db=await database();await db.query('insert into auth.users values($1),($2)',[owner,other]);return db}
const params=(extra={})=>({owner,session:id(),request:id(),attempt:id(),hash,cost:50000,...extra})
async function reserve(db,p=params()){return (await db.query('select public.kelime_ai_reserve($1,$2,$3,$4,$5,$6,$7) r',[p.owner,p.session,p.request,p.attempt,p.hash,'gpt-5.6-terra',p.cost])).rows[0].r}
const settle=(db,p,input=null,output=null)=>db.query("select public.kelime_ai_settle($1,$2,'success',20,$3,$4)",[p.owner,p.attempt,input,output])
test('007 upgrades 006 evaluator whitelist without changing protocol, evidence immutability or browser grants',async()=>{
 const db=await database(6)
 try{
 await db.query('insert into auth.users values($1)',[owner]);await db.exec(await readFile(new URL('../supabase/migrations/007_ai_provider.sql',import.meta.url),'utf8'))
 await db.exec(`set "request.jwt.claim.sub"='${owner}';set role authenticated`)
 const e={id:id(),sourceQuizId:null,completedAt:1,mode:'conversation',evaluator:'openai',epoch:0,words:[{wordId:'b:0',direction:'turkishToEnglish',outcome:'correct',retrieval:'recognized',semantic:'acceptable',grammar:'needsCorrection',suggested:false}]}
 const op=()=>({id:id(),accountId:owner,protocol:5,learningEpoch:0,at:1,kind:'ai-complete',changes:[{key:'ai-evidence/'+e.id,before:null,after:e}]})
 assert.equal((await db.query('select public.kelime_apply_v5($1) r',[op()])).rows[0].r.conflict,false)
 e.evaluator='mock';assert.equal((await db.query('select public.kelime_apply_v5($1) r',[op()])).rows[0].r.conflict,true)
 e.id=id();e.evaluator='deterministic';assert.equal((await db.query('select public.kelime_apply_v5($1) r',[op()])).rows[0].r.conflict,false)
 e.id=id();e.evaluator='forged';await assert.rejects(()=>db.query('select public.kelime_apply_v5($1)',[op()]),/Invalid compact evidence/)
 for(const table of ['ai_practice_attempts','ai_practice_sessions','ai_practice_lock'])await assert.rejects(()=>db.query('select * from public.'+table),/permission denied/)
 await assert.rejects(()=>reserve(db),/permission denied/);await assert.rejects(()=>db.query('select public.kelime_ai_cleanup()'),/permission denied/)
 }finally{await db.close()}
})
test('atomic reservations deduplicate, bound regeneration, reject mismatched identity and preserve unknown costs',async()=>{
 const db=await fixture()
 try{
 const p=params();assert.equal(await reserve(db,p),'reserved');assert.equal(await reserve(db,p),'duplicate');assert.equal(await reserve(db),'busy')
 await settle(db,p);assert.equal(await reserve(db,p),'duplicate')
 assert.equal((await db.query('select cost_micros from public.ai_practice_attempts')).rows[0].cost_micros,50000)
 assert.equal(await reserve(db,{...p,attempt:id(),hash:'b'.repeat(64)}),'identity_mismatch')
 const retry={...p,attempt:id()};assert.equal(await reserve(db,retry),'reserved');await settle(db,retry,100,100)
 assert.equal((await db.query('select cost_micros from public.ai_practice_attempts where id=$1',[retry.attempt])).rows[0].cost_micros,1450)
 assert.equal(await reserve(db,{...p,attempt:id()}),'attempt_limit')
 assert.equal(await reserve(db,{...params({owner:other}),session:p.session}),'session_limit')
 // Concurrent callers pass through one serialized transaction lock.
 const results=await Promise.all([reserve(db),reserve(db)]);assert.equal(results.filter(x=>x==='reserved').length,1)
 }finally{await db.close()}
})
test('per-user/global budgets fail closed, expired leases release, and seven-day cleanup removes operational records',async()=>{
 const db=await fixture()
 try{
 const p=params({cost:960000});assert.equal(await reserve(db,p),'reserved');await settle(db,p);assert.equal(await reserve(db),'budget')
 const q=params({owner:other});assert.equal(await reserve(db,q),'reserved')
 await db.query("update public.ai_practice_attempts set expires_at=clock_timestamp()-interval '1 second' where id=$1",[q.attempt]);assert.equal(await reserve(db,params({owner:other})),'reserved')
 await db.exec("update public.ai_practice_sessions set created_at=clock_timestamp()-interval '8 days';select public.kelime_ai_cleanup()")
 assert.equal((await db.query('select count(*) n from public.ai_practice_attempts')).rows[0].n,0)
 const g=params();await reserve(db,g);await settle(db,g);await db.exec('update public.ai_practice_attempts set cost_micros=10000000')
 assert.equal(await reserve(db,params({owner:other})),'budget')
 }finally{await db.close()}
})
test('rate, daily, session and lifetime limits are independent of budgets; malformed settlement cannot release a reservation',async()=>{
 const db=await fixture()
 try{
 const p=params();await reserve(db,p)
 await assert.rejects(()=>db.query("select public.kelime_ai_settle($1,$2,'success',20,1,null)",[owner,p.attempt]),/Invalid settlement/)
 await settle(db,p,1,1)
 for(let i=1;i<6;i++){const n=params();assert.equal(await reserve(db,n),'reserved');await settle(db,n,1,1)}
 assert.equal(await reserve(db),'rate_limit')
 await db.exec("update public.ai_practice_attempts set created_at=clock_timestamp()-interval '2 minutes'")
 await db.query("update public.ai_practice_sessions set created_at=clock_timestamp()-interval '61 minutes' where id=$1",[p.session])
 assert.equal(await reserve(db,params({session:p.session})),'session_limit')
 await db.exec("update public.ai_practice_sessions set created_at=clock_timestamp()")
 for(let i=6;i<24;i++){const n=params({session:p.session});assert.equal(await reserve(db,n),'reserved');await settle(db,n,1,1);await db.exec("update public.ai_practice_attempts set created_at=clock_timestamp()-interval '2 minutes'")}
 // Five of the initial attempts belonged to other sessions.
 for(let i=0;i<5;i++){const n=params({session:p.session});assert.equal(await reserve(db,n),'reserved');await settle(db,n,1,1);await db.exec("update public.ai_practice_attempts set created_at=clock_timestamp()-interval '2 minutes'")}
 assert.equal(await reserve(db,params({session:p.session})),'rate_limit')
 }finally{await db.close()}
})
test('daily attempt cap survives cheap usage reconciliation and operational RPCs remain service-only',async()=>{
 const db=await fixture()
 try{
 const p=params();assert.equal(await reserve(db,p),'reserved');await settle(db,p,1,1)
 await db.query(`insert into public.ai_practice_attempts(id,owner_id,session_id,request_id,fingerprint,model,created_at,expires_at,cost_micros,status)
 select gen_random_uuid(),owner_id,session_id,gen_random_uuid(),fingerprint,model,clock_timestamp()-interval '2 minutes',clock_timestamp(),1,'success' from public.ai_practice_attempts cross join generate_series(1,99) where id=$1`,[p.attempt])
 assert.equal(await reserve(db),'rate_limit')
 await db.exec('set role service_role');assert.equal(await reserve(db,params({owner:other})),'reserved')
 await assert.rejects(()=>db.query('select * from public.ai_practice_attempts'),/permission denied/)
 }finally{await db.close()}
})
