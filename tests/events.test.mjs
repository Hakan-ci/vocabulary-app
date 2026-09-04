import test from 'node:test'
import assert from 'node:assert/strict'
import {database} from './dbHarness.mjs'
import {decodeData,encodeData,emptyIdentities} from '../src/data/codec.ts'
import {diffCells} from '../src/data/syncService.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {assessLearningState} from '../src/learningState.ts'
const owner='20000000-0000-4000-8000-000000000001'
test('event SQL merges distinct offline sessions exactly once, freezes feedback, archives, and blocks old writers',async()=>{
 const db=await database()
 try{
 await db.exec(`insert into auth.users(id) values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`)
 const call=async op=>(await db.query('select public.kelime_apply_v2($1::jsonb) as r',[JSON.stringify({...op,accountId:owner})])).rows[0].r
 const snapshot=async()=>(await db.query('select public.kelime_snapshot_v2() as r')).rows[0].r
 const client=()=>({data:decodeData({},emptyIdentities(),1700000000000),map:emptyIdentities(),base:{}})
 const save=async(c,kind)=>{c.data.learning.sessions={...c.data.learning.sessions,[c.data.learning.session.syncId]:{source:'daily',practice:c.data.learning.session}};const after=encodeData(c.data,c.map),op={id:crypto.randomUUID(),protocol:2,at:1700000001000,kind,changes:diffCells(c.base,after)};const r=await call(op);assert.equal(r.conflict,false);c.base=after;return op}
 const a=client(),b=client()
 // Both devices start from the same acknowledged baseline, with distinct UUIDs.
 for(const c of [a,b]){c.data.learning.session=createSession(c.data.learning.history,1700000000000,()=>0,'englishToTurkish');await save(c,'start')}
 const sidA=a.data.learning.session.syncId,sidB=b.data.learning.session.syncId
 assert.notEqual(sidA,sidB)
 for(const c of [a,b]){c.data.learning.session=submitAnswer({...c.data.learning.session,draft:'wrong'});await save(c,'submit')}
 assert.equal((await db.query('select count(*)::int n from public.assessment_events')).rows[0].n,0)
 for(const [i,c] of [a,b].entries()){c.data.learning=assessLearningState(c.data.learning,i===0,1700000000200-i*100);c.op=await save(c,'assess')}
 const state=await snapshot(),restored=decodeData(state.cells,emptyIdentities())
 const id=a.data.learning.session.questions[0].wordId
 assert.equal(restored.learning.history[id].timesTested,2)
 assert.equal(restored.learning.history[id].timesKnown,1)
 assert.equal(restored.learning.history[id].timesMissed,1)
 assert.equal(restored.learning.history[id].consecutiveKnown,0)
 assert.equal(restored.learning.history[id].lastTestedAt,1700000000200)
 assert.equal(restored.learning.sessions[sidA].practice.index,1)
 assert.equal(restored.learning.sessions[sidB].practice.index,1)
 const count=()=>db.query('select count(*)::int n from public.assessment_events')
 await call(a.op);assert.equal((await count()).rows[0].n,2)
 await call({...a.op,id:crypto.randomUUID()});assert.equal((await count()).rows[0].n,2)
 const conflict=structuredClone(a.op);conflict.id=crypto.randomUUID();for(const c of conflict.changes)if(c.key==='session/daily')c.after.results[0].known=false
 await assert.rejects(()=>call(conflict),/different answer/)
 assert.equal((await count()).rows[0].n,2)
 const archive={id:crypto.randomUUID(),kind:'archive',at:1700000002000,changes:[{key:'session-record/'+sidA,before:state.cells['session-record/'+sidA],after:{...state.cells['session-record/'+sidA],archivedAt:1700000002000}},{key:'session/daily',before:state.cells['session/daily'],after:null}]}
 await call(archive)
 assert.equal((await db.query('select count(*)::int n from public.test_sessions where archived_at is not null')).rows[0].n,1)
 assert.equal((await db.query('select sum(known_count+missed_count)::int n from public.test_sessions')).rows[0].n,2)
 await assert.rejects(()=>db.query('select public.kelime_apply($1::jsonb)',[JSON.stringify({...a.op,accountId:owner,id:crypto.randomUUID()})]),/Update Kelime/)
 // Continue B through completion using authoritative data after every event.
 let base=(await snapshot()).cells, data=decodeData(base,b.map)
 data.learning.session=data.learning.sessions[sidB].practice
 while(data.learning.session.phase!=='completed'){
  data.learning.session=submitAnswer({...data.learning.session,draft:'wrong'})
  data.learning.sessions[sidB]={source:'daily',practice:data.learning.session}
  let r=await call({id:crypto.randomUUID(),kind:'submit',changes:diffCells(base,encodeData(data,b.map))});base=r.snapshot.cells;data=decodeData(base,b.map)
  data.learning.session=data.learning.sessions[sidB].practice
  data.learning=assessLearningState(data.learning,true,1700000003000+data.learning.session.index)
  data.learning.sessions[sidB]={source:'daily',practice:data.learning.session}
  r=await call({id:crypto.randomUUID(),kind:'assess',changes:diffCells(base,encodeData(data,b.map))});base=r.snapshot.cells;data=decodeData(base,b.map);data.learning.session=data.learning.sessions[sidB].practice
 }
 assert.equal(data.learning.session.results.length,10)
 assert.ok(data.learning.session.completion)
 const activity=Object.values(data.learning.activity.days).reduce((n,d)=>n+d.daily.completed,0);assert.equal(activity,1)
 assert.equal((await count()).rows[0].n,11)
 // Anonymous denial and cross-owner isolation include the new ledger.
 await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)")
 await assert.rejects(()=>db.query('select public.kelime_apply_v2($1::jsonb)',[JSON.stringify(a.op)]),/permission denied/)
 await db.exec("reset role;insert into auth.users(id) values('20000000-0000-4000-8000-000000000002');set role authenticated;select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false)")
 assert.equal((await count()).rows[0].n,0)
 await assert.rejects(()=>call(a.op),/Authentication required/)
 }finally{await db.close()}
})

test('v2 migration retains undated archived prefixes as a baseline without replaying events',async()=>{
 const db=await database()
 try{
 await db.exec(`insert into auth.users(id) values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`)
 const data=decodeData({},emptyIdentities(),1700000000000);data.learning.session=createSession(data.learning.history,1700000000000,()=>0)
 data.learning.session=submitAnswer({...data.learning.session,draft:'wrong'});data.learning=assessLearningState(data.learning,true,1700000000100)
 const partial=data.learning.session;partial.startedAt=null;partial.results[0].answeredAt=null;partial.results[0].activityDate=null
 data.learning.sessions={[partial.syncId]:{source:'daily',practice:partial,archivedAt:1700000000300}};data.learning.session=null
 const op={id:crypto.randomUUID(),kind:'migration',migrationId:crypto.randomUUID(),expectedRevision:0,accountId:owner,changes:diffCells({},encodeData(data,emptyIdentities()))}
 const call=async value=>(await db.query('select public.kelime_apply_v2($1::jsonb) r',[JSON.stringify(value)])).rows[0].r
 const result=await call(op);assert.equal(result.conflict,false);const restored=decodeData(result.snapshot.cells,emptyIdentities());assert.equal(restored.learning.sessions[partial.syncId].practice.results.length,1);assert.deepEqual(restored.learning.activity,data.learning.activity)
 assert.equal((await db.query('select count(*)::int n from public.assessment_events')).rows[0].n,0)
 assert.equal((await db.query('select count(*)::int n from public.test_answers where answered_at is null and activity_date is null')).rows[0].n,1)
 assert.equal((await call(op)).snapshot.revision,result.snapshot.revision)
 // Explicit membership changes retain prior assessment counters.
 const ref='progress/b:'+partial.questions[0].wordId,before=result.snapshot.cells[ref]
 const membership={id:crypto.randomUUID(),kind:'learned',accountId:owner,changes:[{key:ref,before:null,after:{...before,learned:false}}]}
 const changed=await call(membership);assert.equal(changed.snapshot.cells[ref].timesTested,1);assert.equal(changed.snapshot.cells[ref].learned,false)
 }finally{await db.close()}
})

test('offline sessions continue after server-derived newly-learned membership differs from device snapshots',async()=>{
 const db=await database()
 try{
 await db.exec(`insert into auth.users(id) values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`)
 const clients=Array.from({length:2},()=>({data:decodeData({},emptyIdentities(),1700000000000),map:emptyIdentities(),base:{}}))
 const save=async(c,kind)=>{const practice=c.data.learning.session;c.data.learning.sessions={[practice.syncId]:{source:'daily',practice}};const next=encodeData(c.data,c.map);const op={id:crypto.randomUUID(),kind,accountId:owner,changes:diffCells(c.base,next)};const r=(await db.query('select public.kelime_apply_v2($1::jsonb) r',[JSON.stringify(op)])).rows[0].r;assert.equal(r.conflict,false);c.base=next;return r}
 for(const c of clients){c.data.learning.session=createSession(c.data.learning.history,1700000000000,()=>0);await save(c,'start');c.data.learning.session=submitAnswer({...c.data.learning.session,draft:'wrong'});await save(c,'submit');c.data.learning=assessLearningState(c.data.learning,true,1700000000100);await save(c,'assess')}
 const c=clients[1]
 // Continue entirely from this device's original offline snapshots, without replacing its prefix.
 c.data.learning.session=submitAnswer({...c.data.learning.session,draft:'wrong'});await save(c,'submit');c.data.learning=assessLearningState(c.data.learning,true,1700000000200);const result=await save(c,'assess')
 const restored=decodeData(result.snapshot.cells,c.map),practice=restored.learning.sessions[c.data.learning.session.syncId].practice
 assert.equal(practice.index,2);assert.deepEqual(practice.newlyLearnedIds,[practice.questions[1].wordId]);assert.equal((await db.query('select count(*)::int n from public.assessment_events')).rows[0].n,3)
 }finally{await db.close()}
})
