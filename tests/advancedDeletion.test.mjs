import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyUserVocabulary,combinedCatalog} from '../src/userVocabulary.ts'
import {emptyLearningState} from '../src/learningState.ts'
import {emptyWordHistory,recordAssessment} from '../src/learningHistory.ts'
import {createSession} from '../src/dailyTestModel.ts'
import {clearUserVocabulary,clearVocabularyData,deleteVocabularyEntries,planVocabularyDeletion,resetVocabularyProgress,restoreBuiltInEntries} from '../src/vocabularyManagement.ts'
import {emptyCache,SyncService,projection} from '../src/data/syncService.ts'
import {memoryStorage} from '../src/data/localRepository.ts'
import {Application} from '../src/data/application.ts'
import {parseVocabulary} from '../src/vocabularyImport.ts'
import {database} from './dbHarness.mjs'

const now=2_000_000_000_000
function data(){
 const vocabulary=emptyUserVocabulary(),personal={id:1_000_000,english:'custom',turkishMeanings:['özel'],tags:['Mine'],createdAt:now-1}
 vocabulary.entries=[personal];vocabulary.nextId=1_000_001
 const catalog=combinedCatalog(vocabulary),learning=emptyLearningState(catalog,now)
 learning.history[0]=recordAssessment(emptyWordHistory(),true,now-1000)
 learning.history[personal.id]=recordAssessment(emptyWordHistory(),false,now-500)
 return {vocabulary,learning,favorites:[0,personal.id]}
}
test('mixed deletion plans revalidate IDs and hidden built-ins restore exact active state',()=>{
 const initial=data(),plan=planVocabularyDeletion(initial,[0,1_000_000,1_000_000,99999999])
 assert.deepEqual(plan.personalIds,[1_000_000]);assert.deepEqual(plan.builtInIds,[0]);assert.deepEqual(plan.missingIds,[99999999])
 const removed=deleteVocabularyEntries(initial,plan.ids,now).data
 assert.equal(combinedCatalog(removed.vocabulary).some(word=>word.id===0||word.id===1_000_000),false)
 assert.deepEqual(removed.favorites,[]);assert.equal(removed.learning.history[0],undefined);assert.equal(removed.vocabulary.hiddenBuiltinState[0].favorite,true)
 const restored=restoreBuiltInEntries(removed,[0])
 assert.equal(combinedCatalog(restored.vocabulary).some(word=>word.id===0),true);assert.equal(restored.favorites.includes(0),true);assert.deepEqual(restored.learning.history[0],initial.learning.history[0])
 assert.equal(combinedCatalog(restored.vocabulary).some(word=>word.id===1_000_000),false)
})
test('deletion archives affected unfinished practice and retains assessed prefixes',()=>{
 const initial=data(),catalog=combinedCatalog(initial.vocabulary),session=createSession(initial.learning.history,now,()=>0,'englishToTurkish',[],catalog)
 const id=session.questions[0].wordId
 initial.learning.session={...session,index:1,results:[{wordId:id,direction:session.questions[0].direction,answer:'x',correct:false,known:false,snapshot:session.questions[0].snapshot,answeredAt:now,activityDate:'2033-05-18'}]}
 const result=deleteVocabularyEntries(initial,[id],now+1).data,record=result.learning.sessions[session.syncId]
 assert.equal(result.learning.session,null);assert.equal(record.archivedAt,now+1);assert.equal(record.practice.results.length,1);assert.equal(record.practice.phase,'answering')
})
test('clear levels preserve exactly the intended history and settings',()=>{
 const initial=data();initial.learning.dailyGoal=25;initial.learning.preferredMode='mixed';initial.learning.autoPronunciation=false;initial.learning.activity.days['2033-05-18']={daily:{directions:{englishToTurkish:{answered:1,correct:1,known:1,missed:0},turkishToEnglish:{answered:0,correct:0,known:0,missed:0}},completed:1,scoreSum:1,bestScore:1},review:{directions:{englishToTurkish:{answered:0,correct:0,known:0,missed:0},turkishToEnglish:{answered:0,correct:0,known:0,missed:0}},completed:0,scoreSum:0,bestScore:null}}
 const personal=clearUserVocabulary(initial,now);assert.equal(personal.vocabulary.entries.length,0);assert.ok(personal.learning.history[0]);assert.equal(personal.learning.dailyGoal,25)
 const reset=resetVocabularyProgress(initial,now);assert.equal(reset.vocabulary.overrides[0],undefined);assert.equal(reset.favorites.length,0);assert.equal(reset.learning.dailyGoal,25);assert.equal(reset.learning.autoPronunciation,false);assert.ok(reset.learning.activity.days['2033-05-18'])
 const everything=clearVocabularyData(initial,now);assert.equal(everything.learning.dailyGoal,10);assert.equal(everything.learning.preferredMode,'englishToTurkish');assert.equal(everything.learning.autoPronunciation,true);assert.deepEqual(everything.learning.sessions,{});assert.deepEqual(everything.learning.activity.days,{})
})
test('delayed deletion never uploads before notBefore and can be cancelled',async()=>{
 let pushes=0,pulls=0;const transport={pull:async()=>{pulls++;return {revision:0,cells:{}}},push:async()=>{pushes++;return {conflict:false,snapshot:{revision:1,cells:{}}}}}
 const sync=new SyncService(memoryStorage(),'delayed',transport,undefined,emptyCache());sync.enqueue('bulk-delete',{}, {'deleted/u:00000000-0000-4000-8000-000000000001':true},{notBefore:Date.now()+60_000})
 await sync.flush();assert.equal(pushes,0);assert.equal(pulls,1);assert.equal(projection(sync.cache)['deleted/u:00000000-0000-4000-8000-000000000001'],true)
 const id=sync.cache.queue[0].id;assert.equal(sync.cancelPending(id),true);assert.equal(sync.cache.queue.length,0);sync.dispose()
})
test('guest Undo survives reload and restores personal and built-in data',()=>{
 const storage=memoryStorage(),first=new Application(storage)
 first.importWords(parseVocabulary('device word - cihaz sözcüğü - noun'))
 const personal=first.current.vocabulary.entries[0].id
 first.saveFavorites([0,personal]);first.deleteWords([0,personal])
 assert.ok(first.pendingDeletion);assert.equal(combinedCatalog(first.current.vocabulary).some(word=>word.id===0||word.id===personal),false)
 const reloaded=new Application(storage);assert.ok(reloaded.pendingDeletion);assert.equal(reloaded.undoVocabularyDeletion(),true)
 first.undoVocabularyDeletion()
 assert.equal(combinedCatalog(reloaded.current.vocabulary).some(word=>word.id===0),true);assert.equal(reloaded.current.vocabulary.entries.some(word=>word.id===personal),true);assert.deepEqual(reloaded.current.favorites,[0,personal])
})
test('Clear everything requires exact case-sensitive DELETE text',()=>{
 const app=new Application(memoryStorage());assert.throws(()=>app.clearVocabulary('everything','delete'),/DELETE/);app.clearVocabulary('everything','  DELETE  ');assert.equal(app.current.learning.dailyGoal,10);assert.equal(app.current.learning.preferredMode,'englishToTurkish')
})
test('protocol 3 applies hidden built-in batches once, enforces ownership, and blocks old writers',async()=>{
 const db=await database(),owner='30000000-0000-4000-8000-000000000001'
 try{
  await db.exec(`insert into auth.users(id) values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`)
  const call=async operation=>(await db.query('select public.kelime_apply_v3($1::jsonb) r',[JSON.stringify({...operation,accountId:owner})])).rows[0].r
  const op={id:crypto.randomUUID(),protocol:3,kind:'bulk-delete',at:now,changes:[{key:'hidden/b:0',before:null,after:true},{key:'hidden-state/b:0',before:null,after:{id:0,hiddenAt:now,history:emptyWordHistory(),favorite:false}}]}
  const first=await call(op);assert.equal(first.conflict,false);assert.equal((await db.query('select count(*)::int n from public.hidden_builtin_vocabulary')).rows[0].n,1)
  const revision=first.snapshot.revision;assert.equal((await call(op)).snapshot.revision,revision)
  await assert.rejects(()=>db.query('select public.kelime_apply_v2($1::jsonb)',[JSON.stringify({...op,id:crypto.randomUUID()})]),/Update Kelime/)
  await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)")
  await assert.rejects(()=>db.query('select * from public.hidden_builtin_vocabulary'),/permission denied/)
 }finally{await db.close()}
})
