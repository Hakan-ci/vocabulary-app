import test from 'node:test'
import assert from 'node:assert/strict'
import { database } from './dbHarness.mjs'

const OWNER='10000000-0000-4000-8000-000000000001'
const OTHER='10000000-0000-4000-8000-000000000002'
const OP='20000000-0000-4000-8000-000000000001'
test('protocol 4 validates pronunciation settings, is idempotent, and blocks older writers after upgrade',async()=>{
  const db=await database()
  try{
    await db.query('insert into auth.users(id) values($1),($2)',[OWNER,OTHER])
    await db.exec(`set "request.jwt.claim.sub"='${OWNER}'`)
    const apply=async(id,value)=>await db.query('select public.kelime_apply_v4($1::jsonb) result',[JSON.stringify({id,accountId:OWNER,kind:'preferences',changes:[{key:'setting/auto-pronunciation',before:null,after:value}]})])
    await assert.rejects(()=>apply(OP,'true'),/boolean/)
    const first=await apply(OP,false);assert.equal(first.rows[0].result.conflict,false)
    const retry=await apply(OP,false);assert.equal(retry.rows[0].result.conflict,false)
    assert.equal((await db.query("select value from public.account_records where user_id=$1 and key='setting/auto-pronunciation'",[OWNER])).rows[0].value,false)
    assert.equal((await db.query('select sync_protocol from public.profiles where id=$1',[OWNER])).rows[0].sync_protocol,4)
    await assert.rejects(()=>db.query('select public.kelime_apply_v3($1::jsonb)',[JSON.stringify({id:'20000000-0000-4000-8000-000000000002',accountId:OWNER,kind:'preferences',changes:[]})]),/Update Kelime/)
    await db.exec(`set "request.jwt.claim.sub"='${OTHER}'`)
    const other=(await db.query('select public.kelime_snapshot_v4() snapshot')).rows[0].snapshot
    assert.equal(other.cells['setting/auto-pronunciation'],undefined)
    await db.exec(`set "request.jwt.claim.sub"=''`)
    await assert.rejects(()=>db.query('select public.kelime_snapshot_v4()'),/Authentication required/)
  } finally { await db.close() }
})
