import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {database} from './dbHarness.mjs'
test('PostgreSQL schema executes: RLS, ownership, atomic rollback and idempotency',async()=>{
 const db=await database()
 try {await db.exec(await readFile(new URL('../supabase/tests/security.sql',import.meta.url),'utf8'))}finally{await db.close()}
})
import assert from 'node:assert/strict'
import {decodeData,encodeData,emptyIdentities} from '../src/data/codec.ts'
import {diffCells} from '../src/data/syncService.ts'
import {createSession,submitAnswer,snapshotQuestion} from '../src/dailyTestModel.ts'
import {assessLearningState,assessReviewState} from '../src/learningState.ts'
import {combinedCatalog} from '../src/userVocabulary.ts'
import {vocabularyRepository} from '../src/data/localRepository.ts'
import {parseVocabulary} from '../src/vocabularyImport.ts'
const owner='10000000-0000-4000-8000-000000000003'
test('real SQL practice mutations preserve snapshots, history, activity, tombstones and first accepted answers',async()=>{
 const db=await database()
 try {
 await db.exec(`insert into auth.users(id) values('${owner}'); select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`)
 const call=async(op)=>(await db.query('select public.kelime_apply($1::jsonb) as result',[JSON.stringify({...op,accountId:owner})])).rows[0].result
 const snapshot=async()=>(await db.query('select public.kelime_snapshot() as result')).rows[0].result
 let data=vocabularyRepository.import(decodeData({},emptyIdentities()),parseVocabulary('commute - işe gidip gelmek - verb')).data
 const map=emptyIdentities();let base=(await snapshot()).cells
 const save=async(kind)=>{const after=encodeData(data,map),op={id:crypto.randomUUID(),kind,changes:diffCells(base,after)};const result=await call(op);assert.equal(result.conflict,false,result.message);base=result.snapshot.cells;return op}
 await save('vocabulary');const id=data.vocabulary.entries[0].id,catalog=combinedCatalog(data.vocabulary)
 data.favorites=[id];await save('favorite')
 data.learning.session=createSession(data.learning.history,1700000000000,()=>0,'mixed',[],catalog)
 await save('start');const original=data.learning.session
 data.learning.session=submitAnswer({...original,draft:'incorrect'});const submitOp=await save('submit')
 assert.equal((await db.query('select count(*)::int as n from public.test_answers')).rows[0].n,0)
 data.learning=assessLearningState(data.learning,true,1700000000100,catalog);const assessment=await save('assess')
 const revision=(await snapshot()).revision;assert.equal((await call(assessment)).conflict,false);assert.equal((await snapshot()).revision,revision)
 const divergent={...assessment,id:crypto.randomUUID()};assert.equal((await call(divergent)).conflict,true)
 assert.equal((await db.query('select count(*)::int as n from public.test_answers')).rows[0].n,1)
 assert.equal((await db.query('select sum(times_tested)::int as n from public.learning_progress')).rows[0].n,1)
 assert.equal((await call({...submitOp,id:crypto.randomUUID()})).conflict,true)
 while(data.learning.session.phase!=='completed'){
  const s=data.learning.session;data.learning.session=submitAnswer({...s,draft:s.questions[s.index].snapshot.acceptedAnswers[0]});await save('submit')
  data.learning=assessLearningState(data.learning,true,1700000000200+data.learning.session.index,catalog);await save('assess')
 }
 assert.equal((await db.query('select count(*)::int as n from public.test_answers')).rows[0].n,10)
 const q=snapshotQuestion({wordId:id,direction:'turkishToEnglish'},catalog,()=>0)
 data.learning.reviewSession={version:2,practice:{...createSession(data.learning.history,1700000000300,()=>0,'mixed',[],catalog),questions:[q],reviewWordIds:[id]}}
 await save('start')
 assert.throws(()=>vocabularyRepository.delete(data,id),/Review/)
 // Also verify the server's active-session guard with a forged deletion operation.
 const ref=`u:${map.localToCloud[id]}`
 await assert.rejects(()=>call({id:crypto.randomUUID(),kind:'delete',changes:[{key:`deleted/${ref}`,before:null,after:true}]}),/Finish the practice/)
 data.learning.reviewSession.practice=submitAnswer({...data.learning.reviewSession.practice,draft:'commute'});await save('submit')
 data.learning=assessReviewState(data.learning,false,1700000000400,catalog);await save('assess')
 const activity=structuredClone(data.learning.activity)
 data=vocabularyRepository.delete(data,id);await save('delete')
 assert.deepEqual(data.learning.activity,activity)
 assert.equal((await db.query('select count(*)::int as n from public.test_answers')).rows[0].n,11)
 const restored=decodeData(base,map);assert.equal(restored.learning.reviewSession.practice.phase,'completed');assert.equal(restored.learning.reviewSession.practice.results[0].correct,true)
 assert.equal((await db.query("select count(*)::int as n from public.user_vocabulary where deleted_at is not null")).rows[0].n,1)
 await assert.rejects(()=>call({id:crypto.randomUUID(),kind:'vocabulary',changes:[{key:`word/${ref}`,before:null,after:{...q.snapshot.word,id:ref}}]}),/cannot be restored/)
 // Import the same legacy session into a different account with unknown dates.
 const second='10000000-0000-4000-8000-000000000004'
 await db.exec(`reset role; insert into auth.users(id) values('${second}'); select set_config('request.jwt.claim.sub','${second}',false); set role authenticated;`)
 for(const session of [data.learning.session,data.learning.reviewSession.practice]){session.startedAt=null;session.completedAt=null;for(const r of session.results){delete r.answeredAt;delete r.activityDate}}
 const cells=encodeData(data,emptyIdentities()),migration={accountId:second,id:crypto.randomUUID(),kind:'migration',migrationId:crypto.randomUUID(),expectedRevision:0,changes:diffCells({},cells)}
 const response=(await db.query('select public.kelime_apply($1::jsonb) as result',[JSON.stringify(migration)])).rows[0].result
 assert.equal(response.conflict,false)
 assert.equal((await db.query('select count(*)::int as n from public.test_answers where answered_at is null and activity_date is null')).rows[0].n,11)
 const imported=decodeData(response.snapshot.cells,emptyIdentities());assert.deepEqual(imported.learning.activity,activity)
 assert.equal(imported.learning.reviewSession.practice.phase,'completed')
 assert.equal((await db.query('select count(*)::int as n from public.user_vocabulary')).rows[0].n,0,'historical deleted word is not restored')
 const again=(await db.query('select public.kelime_apply($1::jsonb) as result',[JSON.stringify(migration)])).rows[0].result
 assert.equal(again.snapshot.revision,response.snapshot.revision)
 }finally{await db.close()}
})
