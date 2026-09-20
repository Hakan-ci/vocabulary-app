import {projectOperation} from '../src/data/eventProjection.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {Application} from '../src/data/application.ts'
import {memoryStorage,loadLocal} from '../src/data/localRepository.ts'
import {emptyLearningState,parseLearningState,assessLearningState,assessReviewState} from '../src/learningState.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {words} from '../src/vocabulary.ts'
import {createReviewSession,reviewQueue} from '../src/reviewModel.ts'
import {PracticeService} from '../src/aiPractice/practiceService.ts'
import {MockPracticeProvider} from '../src/aiPractice/mockProvider.ts'
import {compactEvidence,confirmReviewRequests,resolveRequests,reviewRequestIdentity} from '../src/aiPractice/learningEvidence.ts'
import {encodeData,decodeData,emptyIdentities} from '../src/data/codec.ts'
import {diffCells} from '../src/data/syncService.ts'
import {prepareMigration} from '../src/data/migration.ts'
import {deleteVocabularyEntries,restoreBuiltInEntries,resetVocabularyProgress,clearVocabularyData} from '../src/vocabularyManagement.ts'
const now=Date.now()
function learnedQuiz(catalog=words){let state=emptyLearningState(catalog,now);state.session=createSession(state.history,now,()=>.3,'turkishToEnglish',[],catalog);while(state.session.phase!=='completed'){state={...state,session:submitAnswer({...state.session,draft:'wrong'})};state=assessLearningState(state,true,now,catalog)}return state}
async function practice(state,catalog=words){const s=new PracticeService({quiz:state.session,history:state.history,catalog,mode:'voiceAnswer',provider:new MockPracticeProvider(),now:()=>now});await s.start();await s.submit('wrong');await s.end();return s.getSnapshot()}
async function guest(){const storage=memoryStorage(),app=new Application(storage);app.saveLearning(learnedQuiz());const session=await practice(app.current.learning);return {storage,app,session,id:session.targets[0].wordId}}
test('compact evidence is whitelisted, idempotent and leaves mastery untouched; confirmation is separate',async()=>{
 const {app,session,id,storage}=await guest(),before=structuredClone(app.current.learning.history)
 await app.completeAIPractice(session);await app.completeAIPractice(session)
 assert.equal(Object.keys(app.current.learning.aiEvidence).length,1);assert.deepEqual(app.current.learning.reviewRequests,{})
 const encoded=JSON.stringify(app.current.learning.aiEvidence);assert.doesNotMatch(encoded,/turns|transcript|answer|explanation|corrections|strengths/)
 await Promise.all([app.requestReview(session.id,[id]),app.requestReview(session.id,[id])]);assert.equal(Object.keys(app.current.learning.reviewRequests).length,1)
 assert.deepEqual(app.current.learning.history,before);assert.equal(reviewQueue(words,before,now,app.current.learning.reviewRequests).filter(r=>r.selected.due).length,1)
 assert.deepEqual(loadLocal(storage).data.learning.aiEvidence,app.current.learning.aiEvidence);assert.deepEqual(loadLocal(storage).data.learning.reviewRequests,app.current.learning.reviewRequests)
 await assert.rejects(()=>app.requestReview(session.id,[999999]));await assert.rejects(()=>app.requestReview(crypto.randomUUID(),[id]))
})
test('requests survive opening/cancelling, resolve only observed matching directions, and missed Review still stays due',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);let state=app.current.learning
 const requests=structuredClone(state.reviewRequests),queue=reviewQueue(words,state.history,now,state.reviewRequests);assert.equal(queue.find(r=>r.word.id===id).selected.direction,'turkishToEnglish')
 const review=createReviewSession(words,state.history,now,()=>0,state.reviewRequests);assert.deepEqual(state.reviewRequests,requests)
 state={...state,reviewSession:{...review,practice:submitAnswer({...review.practice,draft:'wrong'})}}
 const result=assessReviewState(state,false,now,words),event=result.reviewSession.practice.results[0]
 assert.deepEqual(event.resolvedReviewRequestIds,Object.keys(requests));assert.equal(result.reviewRequests[event.resolvedReviewRequestIds[0]].status,'resolved')
 assert.equal(reviewQueue(words,result.history,now,result.reviewRequests).find(r=>r.word.id===id).selected.due,true)
 assert.deepEqual(assessReviewState(result,true,now,words),result)
 const late={...Object.values(requests)[0],id:crypto.randomUUID(),sourceSessionId:crypto.randomUUID()}
 const merged=resolveRequests({...requests,[late.id]:late},event.resolvedReviewRequestIds,id,event.direction,event.eventId)
 assert.equal(merged[late.id].status,'active')
 const opposite={...late,id:crypto.randomUUID(),direction:'englishToTurkish'}
 assert.equal(resolveRequests({[opposite.id]:opposite},[opposite.id],id,'turkishToEnglish',event.eventId)[opposite.id].status,'active')
})
test('normal and explicit eligibility deduplicate and both directions remain independent',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const r=Object.values(app.current.learning.reviewRequests)[0]
 const requests={...app.current.learning.reviewRequests,[crypto.randomUUID()]:{...r,id:crypto.randomUUID(),direction:'englishToTurkish'}}
 const queue=reviewQueue(words,app.current.learning.history,now,requests).filter(e=>e.selected.due)
 assert.equal(queue.length,1);assert.equal(queue[0].directions.length,2)
 assert.equal(createReviewSession(words,app.current.learning.history,now,()=>0,requests).practice.questions.length,1)
})
test('v6 migration and corrupt new records recover without losing history',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const state=app.current.learning
 const old={...state,version:6};delete old.aiEvidence;delete old.reviewRequests;delete old.learningEpoch
 const restored=parseLearningState(old);assert.equal(restored.version,7);assert.deepEqual(restored.aiEvidence,{});assert.deepEqual(restored.history,state.history)
 const damaged=parseLearningState({...state,aiEvidence:{...state.aiEvidence,bad:{id:'bad'}},reviewRequests:{...state.reviewRequests,bad:{wordId:0}}})
 assert.deepEqual(damaged,state)
})
test('identity conversion maps every evidence/request word but not UUID identities',async()=>{
 const custom=words.slice(0,3).map((w,i)=>({...w,id:1000000+i})),state=learnedQuiz(custom),session=await practice(state,custom)
 state.aiEvidence[session.id]=compactEvidence(session,0,now);state.reviewRequests=confirmReviewRequests(state.aiEvidence[session.id],[session.targets[0].wordId],{},custom,now)
 const base=new Application(memoryStorage()).current,data={...base,vocabulary:{...base.vocabulary,entries:custom,nextId:1000003},learning:state}
 const map=emptyIdentities(),cells=encodeData(data,map),other=emptyIdentities();other.nextId=2000000
 const round=decodeData(cells,other),e=round.learning.aiEvidence[session.id],r=Object.values(round.learning.reviewRequests)[0]
 assert.equal(e.id,session.id);assert.equal(e.sourceQuizId,session.sourceQuizId);assert.ok(e.words.every(w=>w.wordId>=2000000));assert.equal(r.sourceSessionId,session.id)
 const raw=cells['ai-evidence/'+session.id];assert.ok(raw.words.every(w=>w.wordId.startsWith('u:')));assert.equal(cells['review-request/'+r.id].wordId,raw.words[0].wordId)
 assert.equal(await reviewRequestIdentity(session.id,0),await reviewRequestIdentity(e.id,0))
})
test('deletion cancels requests, restoration cannot revive them; resets clear AI state and increment epoch',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const before=app.current
 const deleted=deleteVocabularyEntries(before,[id],now).data;assert.equal(Object.values(deleted.learning.reviewRequests)[0].status,'cancelled');assert.ok(deleted.learning.aiEvidence[session.id])
 assert.equal(Object.values(restoreBuiltInEntries(deleted,[id]).learning.reviewRequests)[0].status,'cancelled')
 for(const next of [resetVocabularyProgress(before),clearVocabularyData(before)]){assert.deepEqual(next.learning.aiEvidence,{});assert.deepEqual(next.learning.reviewRequests,{});assert.equal(next.learning.learningEpoch,1)}
 const commands=app.aiPracticeCommands();app.clearVocabulary('progress');await assert.rejects(()=>commands.complete(session),/changed/)
})
test('guest failure reports error, keeps stable evidence and retries through recovery storage',async()=>{
 const memory=memoryStorage();let fail=false
 const app=new Application({getItem:memory.getItem,setItem(k,v){if(fail)throw Error('Quota');memory.setItem(k,v)}});app.saveLearning(learnedQuiz());const session=await practice(app.current.learning)
 fail=true;await assert.rejects(()=>app.completeAIPractice(session));const original=structuredClone(app.current.learning.aiEvidence)
 fail=false;await app.completeAIPractice(session);assert.deepEqual(app.current.learning.aiEvidence,original);assert.deepEqual(loadLocal(memory).data.learning.aiEvidence,original)
})
test('optimistic replay cannot resurrect terminal requests or cross a reset epoch',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);const before=encodeData(app.current,emptyIdentities());await app.requestReview(session.id,[id]);const after=encodeData(app.current,emptyIdentities()),r=Object.values(app.current.learning.reviewRequests)[0]
 const op={id:crypto.randomUUID(),kind:'review-request',learningEpoch:0,changes:diffCells(before,after),at:now,status:'pending'}
 const terminal={...after,['review-request/'+r.id]:{...r,wordId:'b:'+id,status:'resolved',resolvedBy:crypto.randomUUID()}}
 assert.equal(projectOperation(terminal,op)['review-request/'+r.id].status,'resolved')
 assert.deepEqual(projectOperation({'learning/epoch':1},op),{'learning/epoch':1})
})
test('guest import remaps linked words and never reactivates resolved requests',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const map=emptyIdentities(),cells=encodeData(app.current,map),r=Object.values(app.current.learning.reviewRequests)[0]
 cells['review-request/'+r.id]={...cells['review-request/'+r.id],status:'resolved',resolvedBy:crypto.randomUUID()}
 const preview=prepareMigration(app.current,cells,map,{})
 assert.equal(preview.cells['review-request/'+r.id].status,'resolved')
})

test('account IndexedDB failure/reload retains one evidence and one request operation, stable retry identities, and scope isolation',async()=>{
 await import('fake-indexeddb/auto')
 const {IndexedAccountStore}=await import('../src/data/accountStore.ts'),{emptyCache,cacheKey,projection}=await import('../src/data/syncService.ts')
 const local=memoryStorage(),store=new IndexedAccountStore(crypto.randomUUID()),project='https://practice.example',user={id:crypto.randomUUID()},key=cacheKey(project,user.id)
 const cache=emptyCache(),base=new Application(memoryStorage()).current;cache.initialized=true;cache.migrationChoice='account';cache.base.cells=encodeData({...base,learning:learnedQuiz()},cache.identities)
 await store.save(key,cache);local.setItem('kelime-last-account:'+project,JSON.stringify(user))
 let fail=false;const wrapped={load:(...args)=>store.load(...args),save:async(...args)=>{if(fail)throw Error('Disk full');return store.save(...args)}}
 const app=new Application(local,{project,store:wrapped});app.online=false;await app.restoreAccount();const session=await practice(app.current.learning),id=session.targets[0].wordId,commands=app.aiPracticeCommands(),history=structuredClone(app.current.learning.history)
 fail=true;await assert.rejects(()=>commands.complete(session));assert.equal(app.sync.cache.queue.length,1);const evidenceId=app.sync.cache.queue[0].id
 fail=false;assert.equal((await commands.complete(session)).pendingSync,true);assert.equal(app.sync.cache.queue[0].id,evidenceId)
 fail=true;await assert.rejects(()=>commands.request(session.id,[id]));assert.equal(app.sync.cache.queue.length,2);const requestId=app.sync.cache.queue[1].id
 fail=false;await Promise.all([commands.request(session.id,[id]),commands.request(session.id,[id])]);assert.equal(app.sync.cache.queue.length,2);assert.equal(app.sync.cache.queue[1].id,requestId)
 assert.deepEqual(app.current.learning.history,history);assert.deepEqual(app.sync.cache.queue.map(op=>op.kind),['ai-complete','review-request']);assert.deepEqual(app.sync.cache.queue.map(op=>op.changes.length),[1,1]);assert.ok(app.sync.cache.queue[0].changes.every(c=>c.key.startsWith('ai-evidence/')));assert.ok(app.sync.cache.queue[1].changes.every(c=>c.key.startsWith('review-request/')))
 const saved=await store.load(key,local);assert.equal(saved.version,6);assert.ok(saved.queue.every(op=>op.protocol===5&&op.learningEpoch===0));assert.equal(Object.keys(decodeData(projection(saved),saved.identities).learning.reviewRequests).length,1)
 await app.setUser(null);await assert.rejects(()=>commands.request(session.id,[id]),/changed/);assert.deepEqual(app.current.learning.aiEvidence,{})
 local.setItem('kelime-last-account:'+project,JSON.stringify(user));const reload=new Application(local,{project,store});reload.online=false;await reload.restoreAccount();assert.equal(reload.current.learning.aiEvidence[session.id].id,session.id);assert.equal(Object.keys(reload.current.learning.reviewRequests).length,1)
 await reload.setUser(null);await store.close()
})
test('lost evidence responses resend the same operation; confirmed batches remain non-coalescing barriers',async()=>{
 const {SyncService,projection}=await import('../src/data/syncService.ts'),{app,session,id}=await guest();await app.completeAIPractice(session)
 const map=emptyIdentities(),evidenceCells=encodeData(app.current,map);await app.requestReview(session.id,[id]);const all=encodeData(app.current,map)
 const before={...evidenceCells};delete before['ai-evidence/'+session.id]
 let remote={revision:0,cells:before},lost=true;const accepted=new Set(),sent=[]
 const sync=new SyncService(memoryStorage(),'practice-test',{async pull(){return remote},async push(op){sent.push(structuredClone(op));if(!accepted.has(op.id)){remote={revision:remote.revision+1,cells:projectOperation(remote.cells,op)};accepted.add(op.id)}if(lost){lost=false;throw Error('Lost response')}return {conflict:false,snapshot:remote}}})
 sync.setOnline(false);sync.cache.base={revision:0,cells:before};sync.enqueue('ai-complete',before,evidenceCells);sync.enqueue('review-request',evidenceCells,all);assert.equal(sync.cache.queue.length,2)
 sync.offline=false;await sync.flush();await sync.flush();assert.equal(sync.cache.queue.length,0);assert.equal(remote.revision,2);assert.deepEqual(sent[0].wirePayload,sent[1].wirePayload);assert.equal(sent[0].id,sent[1].id);assert.equal(Object.keys(decodeData(projection(sync.cache),map).learning.reviewRequests).length,1);sync.dispose()
})
test('short Undo restores active requests without re-creating evidence',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const before=structuredClone(app.current.learning.reviewRequests)
 app.deleteWords([id]);assert.equal(Object.values(app.current.learning.reviewRequests)[0].status,'cancelled');app.undoVocabularyDeletion();assert.deepEqual(app.current.learning.reviewRequests,before)
})
test('malformed cloud AI references are isolated; terminal duplicate suggestions win recovery',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const map=emptyIdentities(),cells=encodeData(app.current,map),valid=Object.values(app.current.learning.reviewRequests)[0]
 cells['ai-evidence/'+crypto.randomUUID()]={...cells['ai-evidence/'+session.id],words:[{wordId:'not-a-reference'}]};cells['review-request/'+crypto.randomUUID()]={wordId:'u:bad'}
 const restored=decodeData(cells,map);assert.deepEqual(restored.learning.aiEvidence,app.current.learning.aiEvidence);assert.deepEqual(restored.learning.history,app.current.learning.history)
 const terminal={...valid,id:crypto.randomUUID(),status:'resolved',resolvedBy:crypto.randomUUID()}
 const recovered=parseLearningState({...app.current.learning,reviewRequests:{[valid.id]:valid,[terminal.id]:terminal}})
 assert.deepEqual(Object.values(recovered.reviewRequests).map(r=>r.status),['resolved'])
})
test('optimistic deletion/reset/import applies lifecycle rules to requests not in the original operation',async()=>{
 const {app,session,id}=await guest();await app.completeAIPractice(session);await app.requestReview(session.id,[id]);const cells=encodeData(app.current,emptyIdentities()),key='review-request/'+Object.keys(app.current.learning.reviewRequests)[0]
 const deletion={id:crypto.randomUUID(),kind:'bulk-delete',at:now,status:'pending',changes:[{key:'hidden/b:'+id,before:null,after:true}]}
 assert.equal(projectOperation(cells,deletion)[key].status,'cancelled')
 assert.equal(projectOperation(cells,{...deletion,kind:'reset-progress',changes:[]})[key],undefined)
 const terminal={...cells,[key]:{...cells[key],status:'resolved',resolvedBy:crypto.randomUUID()}}
 assert.equal(projectOperation(terminal,{...deletion,kind:'migration',changes:[{key,before:null,after:cells[key]}]})[key].status,'resolved')
})
test('request ordering keeps misses and migrated eligibility first, deterministic direction ties, and fixed active questions',async()=>{
 const {emptyHistory,emptyWordHistory,recordAssessment}=await import('../src/learningHistory.ts')
 const catalog=words.slice(0,4),history=emptyHistory(catalog)
 history[0]=recordAssessment(history[0],false,now,'englishToTurkish');history[1]=emptyWordHistory(true);history[3]=recordAssessment(history[3],true,now,'englishToTurkish')
 const make=(direction)=>({id:crypto.randomUUID(),wordId:2,direction,requestedAt:now,source:'aiPractice',sourceSessionId:crypto.randomUUID(),epoch:0,status:'active'})
 const a=make('englishToTurkish'),b=make('turkishToEnglish'),requests={[a.id]:a,[b.id]:b}
 const queue=reviewQueue(catalog,history,now,requests);assert.deepEqual(queue.map(e=>e.word.id),[0,1,2,3]);assert.equal(queue[2].selected.direction,'englishToTurkish');assert.equal(queue[2].selected.deadline,now);assert.equal(queue[2].group,'Needs Review')
 const session=createReviewSession(catalog,history,now,()=>0,requests),questions=structuredClone(session.practice.questions)
 const extra={...a,id:crypto.randomUUID(),wordId:3};requests[extra.id]=extra;assert.deepEqual(session.practice.questions,questions);assert.equal(session.practice.questions.some(q=>q.wordId===3),false)
})

test('UUID-shaped malformed cloud word references are dropped without allocating identities or losing valid evidence',async()=>{
 const {app,session}=await guest();await app.completeAIPractice(session)
 const original=encodeData(app.current,emptyIdentities())
 for(const ref of ['u:'+'-'.repeat(36),'u:'+'a'.repeat(36),'u:1234567-12345-1234-1234-123456789012']){
  const badId=crypto.randomUUID(),map=emptyIdentities(),before=structuredClone(map)
  const cells={...original,['ai-evidence/'+badId]:{...original['ai-evidence/'+session.id],id:badId,words:[{...original['ai-evidence/'+session.id].words[0],wordId:ref}]}}
  const recovered=decodeData(cells,map)
  assert.equal(recovered.learning.aiEvidence[badId],undefined,ref)
  assert.deepEqual(recovered.learning.aiEvidence,app.current.learning.aiEvidence)
  assert.deepEqual(recovered.learning.history,app.current.learning.history)
  assert.deepEqual(map,before)
 }
})
test('guest recovery restores evidence and confirmed requests after envelope success but primary learning write failure',async()=>{
 for(const checkpoint of ['evidence','request']){
  const memory=memoryStorage();let fail=false
  const storage={getItem:memory.getItem,setItem(key,value){if(fail&&key==='kelime-learning-state')throw Error('Interrupted primary write');memory.setItem(key,value)}}
  const app=new Application(storage);app.saveLearning(learnedQuiz());const session=await practice(app.current.learning),wordId=session.targets[0].wordId
  if(checkpoint==='request')await app.completeAIPractice(session)
  const history=structuredClone(app.current.learning.history),activity=structuredClone(app.current.learning.activity)
  fail=true
  await assert.rejects(()=>checkpoint==='evidence'?app.completeAIPractice(session):app.requestReview(session.id,[wordId]))
  assert.notEqual(memory.getItem('kelime-local-recovery'),'null')
  const expectedEvidence=structuredClone(app.current.learning.aiEvidence),expectedRequests=structuredClone(app.current.learning.reviewRequests)
  fail=false;const recovered=new Application(storage)
  assert.deepEqual(recovered.current.learning.aiEvidence,expectedEvidence);assert.deepEqual(recovered.current.learning.reviewRequests,expectedRequests)
  assert.deepEqual(recovered.current.learning.history,history);assert.deepEqual(recovered.current.learning.activity,activity)
  await recovered.completeAIPractice(session)
  if(checkpoint==='request')await recovered.requestReview(session.id,[wordId])
  assert.deepEqual(recovered.current.learning.aiEvidence,expectedEvidence);assert.deepEqual(recovered.current.learning.reviewRequests,expectedRequests)
  assert.equal(memory.getItem('kelime-local-recovery'),'null')
 }
})
test('concurrent overlapping confirmations retain all selections once without changing mastery or activity',async()=>{
 const {app}=await guest(),state=app.current.learning
 const service=new PracticeService({quiz:state.session,history:state.history,catalog:words,mode:'voiceAnswer',provider:new MockPracticeProvider()})
 await service.start();await service.submit('wrong');await service.submit('wrong');await service.end()
 const session=service.getSnapshot(),ids=session.feedback.suggestedReviewWordIds,history=structuredClone(state.history),activity=structuredClone(state.activity)
 assert.equal(ids.length,2);await app.completeAIPractice(session)
 await Promise.all([app.requestReview(session.id,[ids[0]]),app.requestReview(session.id,ids),app.requestReview(session.id,[ids[1]])])
 assert.deepEqual(Object.values(app.current.learning.reviewRequests).map(r=>r.wordId).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b))
 assert.deepEqual(app.current.learning.history,history);assert.deepEqual(app.current.learning.activity,activity)
 service.dispose()
})
