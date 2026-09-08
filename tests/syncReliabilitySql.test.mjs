import test from 'node:test'
import assert from 'node:assert/strict'
import {database} from './dbHarness.mjs'
import {decodeData,emptyIdentities,encodeData} from '../src/data/codec.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {diffCells} from '../src/data/syncService.ts'
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002'
test('v4 reconciliation, compacted draft receipts and direct submission preserve session integrity',async()=>{
 const db=await database()
 try{
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);await db.exec(`set "request.jwt.claim.sub"='${owner}'`)
  const map=emptyIdentities(),data=decodeData({},map);let cells=encodeData(data,map)
  const apply=async op=>(await db.query('select public.kelime_apply_v4($1) result',[JSON.stringify(op)])).rows[0].result
  const op=(kind,before,after)=>({id:crypto.randomUUID(),accountId:owner,protocol:4,kind,at:Date.now(),changes:diffCells(before,after)})
  data.learning.session=createSession(data.learning.history,Date.now(),()=>0)
  const s=data.learning.session;data.learning.sessions={[s.syncId]:{source:'daily',practice:s}}
  let next=encodeData(data,map);await apply(op('start',cells,next));cells=next
  const drafts=[]
  for(const draft of ['d','di','dis','disc','disco']){data.learning.session={...data.learning.session,draft};data.learning.sessions[s.syncId].practice=data.learning.session;next=encodeData(data,map);drafts.push(op('draft',cells,next));cells=next}
  const result=(await db.query('select public.kelime_compact_drafts($1,$2) result',[JSON.stringify(drafts),crypto.randomUUID()])).rows[0].result
  assert.deepEqual(new Set(result.accepted),new Set(drafts.map(p=>p.id)))
  const revision=result.snapshot.revision
  for(const draft of drafts){const retry=await apply(draft);assert.equal(retry.conflict,false);assert.equal(retry.snapshot.revision,revision)}
  // No remote draft checkpoint for the final typed text: submit directly from acknowledged baseline.
  data.learning.session=submitAnswer({...data.learning.session,draft:'latest answer'});data.learning.sessions[s.syncId].practice=data.learning.session
  next=encodeData(data,map);const submit=op('submit',cells,next);const feedback=await apply(submit);assert.equal(feedback.conflict,false)
  assert.equal(feedback.snapshot.cells['session-record/'+s.syncId].practice.submittedAnswer,'latest answer')
  await db.exec(`set "request.jwt.claim.sub"='${other}'`)
  const isolated=(await db.query('select public.kelime_reconcile($1) result',[drafts.map(p=>p.id)])).rows[0].result;assert.deepEqual(isolated.accepted,[])
  await db.exec(`set "request.jwt.claim.sub"=''`);await assert.rejects(()=>db.query('select public.kelime_reconcile($1)',[[submit.id]]),e=>e.code==='42501')
 }finally{await db.close()}
})
test('v4 reports validation separately from stale deletion conflicts',async()=>{
 const db=await database()
 try{
  await db.query('insert into auth.users(id) values($1)',[owner]);await db.exec(`set "request.jwt.claim.sub"='${owner}'`)
  const apply=async(kind,changes)=>db.query('select public.kelime_apply_v4($1)',[JSON.stringify({id:crypto.randomUUID(),accountId:owner,protocol:4,at:Date.now(),kind,changes})])
  await assert.rejects(()=>apply('preferences',[{key:'setting/auto-pronunciation',before:null,after:'invalid'}]),e=>e.code==='23514')
  await db.query('insert into public.profiles(id) values($1)',[owner])
  await db.query('insert into public.account_records(user_id,key,value) values($1,$2,$3)',[owner,'deleted/u:10000000-0000-4000-8000-000000000099','true'])
  const stale=await apply('vocabulary',[{key:'word/u:10000000-0000-4000-8000-000000000099',before:null,after:{english:'old'}}])
  assert.equal(stale.rows[0].kelime_apply_v4.conflict,true)
  assert.match(stale.rows[0].kelime_apply_v4.message,/Deleted words/)
 }finally{await db.close()}
})
