import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotQuestion } from '../src/dailyTestModel.ts'
import { emptyHistory, recordAssessment, DAY_MS } from '../src/learningHistory.ts'
import { selectPracticeTargets } from '../src/aiPractice/targetWordSelector.ts'
import { buildPracticeContext } from '../src/aiPractice/contextBuilder.ts'
import { validateFeedback } from '../src/aiPractice/feedbackValidator.ts'
import { MockPracticeProvider, containsPhrase } from '../src/aiPractice/mockProvider.ts'
import { PracticeService } from '../src/aiPractice/practiceService.ts'
import { transition, practiceProgress } from '../src/aiPractice/practiceModel.ts'
import { createReviewRequests } from '../src/aiPractice/reviewRequest.ts'
const now=20*DAY_MS
const catalog=['achieve','avoid','opportunity','improve','challenge','book','journey','give up','learn','read'].map((english,id)=>({id,english,turkishMeanings:['anlam '+id,'diğer '+id],englishAlternatives:id===0?['accomplish']:[],tags:[],createdAt:null}))
function fixture(){
 const history=emptyHistory(catalog)
 const questions=catalog.map(w=>snapshotQuestion({wordId:w.id,direction:'turkishToEnglish'},catalog,()=>0))
 const quiz={version:4,syncId:'quiz-1',startedAt:0,completedAt:now,mode:'turkishToEnglish',questions,reviewWordIds:[],index:10,phase:'completed',draft:'',submittedAnswer:'',submittedCorrect:null,results:questions.map(q=>({...q,answer:q.snapshot.word.english,correct:true,known:true})),newlyLearnedIds:[],completion:null}
 return {quiz,history,catalog}
}
function service(mode='conversation',provider=new MockPracticeProvider(),extra={}){let id=0;return new PracticeService({...fixture(),mode,provider,now:()=>now,id:()=>`id-${++id}`,...extra})}
const raw=(targets,turnId='learner')=>({words:targets.map(t=>({wordId:t.wordId,outcome:'correct',retrieval:'recognized',semantic:'unassessed',grammar:'unassessed',evidence:[turnId],explanation:'Recognized.'})),corrections:[],strengths:[]})

test('selection ranks mistakes, weak, newly learned, due, correct without changing quiz',()=>{
 const f=fixture();f.quiz.results[4].correct=false
 f.history[3]=recordAssessment(f.history[3],false,now,'turkishToEnglish')
 f.quiz.newlyLearnedIds=[2];f.history[1]=recordAssessment(f.history[1],true,0,'turkishToEnglish')
 const before=structuredClone(f),targets=selectPracticeTargets(f.quiz,f.catalog,f.history,now)
 assert.deepEqual(targets.slice(0,5).map(t=>t.wordId),[4,3,2,1,0]);assert.equal(targets.length,8)
 assert.deepEqual(f,before);assert.deepEqual(targets,selectPracticeTargets(f.quiz,f.catalog,f.history,now))
})
test('selection excludes unavailable, deduplicates, supports small or empty catalogs and frozen snapshots',()=>{
 const f=fixture();f.quiz.results.push(f.quiz.results[0]);const edited=f.catalog.slice(0,3).map(w=>({...w,english:'changed'}))
 const targets=selectPracticeTargets(f.quiz,edited,f.history,now)
 assert.deepEqual(targets.map(t=>t.wordId),[0,1,2]);assert.equal(targets[0].snapshot.word.english,'achieve');assert.equal(targets[0].direction,'turkishToEnglish')
 targets[0].snapshot.acceptedAnswers.push('mutated');assert.ok(!f.quiz.results[0].snapshot.acceptedAnswers.includes('mutated'))
 assert.deepEqual(selectPracticeTargets({...f.quiz,phase:'answering'},f.catalog,f.history,now),[])
 assert.deepEqual(selectPracticeTargets(f.quiz,[],f.history,now),[])
})
test('context explicitly whitelists nested vocabulary and history and preserves alternatives',()=>{
 const f=fixture(),targets=selectPracticeTargets(f.quiz,f.catalog.slice(0,1),f.history,now)
 targets[0].auth='secret';targets[0].recent.account='private';targets[0].snapshot.word.syncQueue=['secret'];targets[0].difficulty.device='secret'
 const context=buildPracticeContext(targets,'conversation'),encoded=JSON.stringify(context)
 assert.equal(context.targets.length,1);assert.deepEqual(context.targets[0].turkishMeanings,catalog[0].turkishMeanings);assert.deepEqual(context.targets[0].englishAlternatives,['accomplish']);assert.equal(context.targets[0].difficulty.level,'New')
 assert.doesNotMatch(encoded,/secret|private|syncQueue|account|device|auth|avoid/)
})
test('feedback validates evidence, rejects unknown/non-target IDs, duplicates and malformed outcomes',()=>{
 const f=fixture(),targets=selectPracticeTargets(f.quiz,f.catalog,f.history,now),turns=[{id:'learner',role:'learner',text:'I achieve things.'},{id:'tutor',role:'tutor',text:'Prompt'}]
 assert.equal(validateFeedback(raw(targets),targets,turns).words.length,8)
 for(const mutate of [r=>r.words[0].wordId=999,r=>r.words[0].wordId=9,r=>r.words[1].wordId=r.words[0].wordId,r=>r.words[0].outcome='great',r=>r.words[0].evidence=['missing'],r=>r.words[0].evidence=['tutor'],r=>r.words.pop(),r=>r.corrections=[{wordId:0,turnId:'missing'}],r=>r.words[0].evidence=[]]){
  const r=raw(targets);mutate(r);assert.throws(()=>validateFeedback(r,targets,turns))
 }
 const r=raw(targets);r.private='secret';r.words[0].arbitrary={write:'history'};assert.doesNotMatch(JSON.stringify(validateFeedback(r,targets,turns)),/secret|arbitrary|history/)
 r.words[0].outcome={toString:()=> 'correct'};assert.throws(()=>validateFeedback(r,targets,turns))
})
test('grammar-only issues cannot become vocabulary failures or review recommendations',()=>{
 const f=fixture(),targets=selectPracticeTargets(f.quiz,f.catalog.slice(0,1),f.history,now),turns=[{id:'learner',role:'learner',text:'I want achieve my goals.'}],r=raw(targets)
 r.words[0].grammar='needsCorrection';r.corrections=[{wordId:0,turnId:'learner',kind:'grammar',original:'want achieve',replacement:'want to achieve'}]
 assert.deepEqual(validateFeedback(r,targets,turns).suggestedReviewWordIds,[])
 r.words[0].outcome='needsPractice';assert.throws(()=>validateFeedback(r,targets,turns))
 r.words[0].outcome='correct';r.suggestedReviewWordIds=[0];assert.throws(()=>validateFeedback(r,targets,turns))
})
test('mock phrase matching respects phrases, explicit alternatives and word boundaries',()=>{
 assert.equal(containsPhrase('I achieved it','achieve'),false);assert.equal(containsPhrase('We give up.','give up'),true);assert.equal(containsPhrase('bookish','book'),false);assert.equal(containsPhrase('I ACHIEVE it.','achieve'),true)
})
test('mock is deterministic, tracks finalized responses, and separates supported semantic/grammar evidence',async()=>{
 const a=service('useTheWord'),b=service('useTheWord')
 for(const s of [a,b]){await s.start();await s.submit('I want achieve my goals.');await s.end()}
 assert.deepEqual(a.getSnapshot(),b.getSnapshot())
 const result=a.getSnapshot().feedback.words.find(w=>w.wordId===0)
 assert.equal(result.outcome,'correct');assert.equal(result.semantic,'acceptable');assert.equal(result.grammar,'needsCorrection')
 assert.equal(a.getSnapshot().feedback.corrections[0].replacement,'want to achieve');assert.ok(!a.getSnapshot().feedback.suggestedReviewWordIds.includes(0))
 assert.equal(a.getSnapshot().feedback.words.filter(w=>w.outcome==='notAttempted').length,7)
 assert.deepEqual(practiceProgress(a.getSnapshot()).successful,[0]);a.finish();assert.equal(a.getSnapshot().status,'completed');assert.equal(a.getSnapshot().endedAt,now)
})
test('voice answers use local accepted alternatives and never call the provider',async()=>{
 const provider={prepare(){throw Error('Must not call')},respond(){throw Error('Must not call')},finish(){throw Error('Must not call')},dispose(){}}
 const s=service('voiceAnswer',provider);await s.start();assert.doesNotMatch(s.getSnapshot().turns[0].text,/achieve|accomplish/);await s.submit('accomplish');await s.submit('wrong');await s.end()
 assert.equal(s.getSnapshot().feedback.words[0].outcome,'correct');assert.equal(s.getSnapshot().feedback.words[1].outcome,'needsPractice')
})
test('forward voice mode accepts multiple Turkish meanings',async()=>{
 const f=fixture();const q=snapshotQuestion({wordId:0,direction:'englishToTurkish'},catalog,()=>0);f.quiz.results=[{...q,correct:true,known:true,answer:'anlam 0'}]
 const s=service('voiceAnswer',new MockPracticeProvider(),f);await s.start();await s.submit('diğer 0');await s.end();assert.equal(s.getSnapshot().feedback.words[0].outcome,'correct')
})
test('conversation recognizes multiple targets and steers toward unattempted vocabulary',async()=>{
 const s=service();await s.start();await s.submit('I achieve goals and avoid delays.');assert.deepEqual(practiceProgress(s.getSnapshot()).successful,[0,1]);assert.match(s.getSnapshot().turns.at(-1).text,/chance/)
 await s.submit('I have no example.');await s.end();assert.equal(s.getSnapshot().feedback.words.find(w=>w.wordId===2).outcome,'needsPractice')
})
test('service prevents duplicate in-flight submissions and ignores late cancelled responses',async()=>{
 let resolve,calls=0
 const provider=new MockPracticeProvider();provider.respond=()=>{calls++;return new Promise(r=>resolve=r)}
 const s=service('conversation',provider);await s.start();const pending=s.submit('achieve');assert.equal(await s.submit('achieve'),false);assert.equal(calls,1)
 s.cancel();const before=structuredClone(s.getSnapshot());resolve({message:'late',feedback:{}});await pending;assert.deepEqual(s.getSnapshot(),before);assert.equal(s.getSnapshot().status,'cancelled');s.dispose()
})
test('late prepare and end responses cannot resurrect disposed practice',async()=>{
 for(const method of ['prepare','finish']){
  let resolve;const provider=new MockPracticeProvider();provider[method]=()=>new Promise(r=>resolve=r)
  const s=service('conversation',provider);let pending
  if(method==='prepare')pending=s.start();else{await s.start();pending=s.end()}
  s.dispose();const before=structuredClone(s.getSnapshot());resolve({});await pending;assert.deepEqual(s.getSnapshot(),before)
 }
})
test('failure and invalid feedback leave original quiz/history unchanged',async()=>{
 for(const failAt of ['prepare','respond','finish']){
  const f=fixture(),before=structuredClone(f),s=service('conversation',new MockPracticeProvider({failAt}),f)
  await s.start();if(failAt!=='prepare')await s.submit('achieve');if(failAt==='finish')await s.end()
  assert.equal(s.getSnapshot().status,'failed');assert.deepEqual(f,before)
 }
 const provider=new MockPracticeProvider();provider.finish=async()=>({words:[]});const s=service('conversation',provider);await s.start();await s.end();assert.equal(s.getSnapshot().status,'failed')
})
test('explicit review requests are validated, transient and idempotent without learning mutations',async()=>{
 const f=fixture(),before=structuredClone(f),s=service('voiceAnswer',new MockPracticeProvider(),f)
 await s.start();await s.submit('wrong');await s.end();const first=s.stageReview([0,0],catalog),second=s.stageReview([0],catalog)
 assert.deepEqual(first,second);assert.deepEqual(first,[{wordId:0,direction:'turkishToEnglish',requestedAt:now,source:'aiPractice',sourceSessionId:s.getSnapshot().id}]);assert.deepEqual(f,before)
 assert.throws(()=>s.stageReview([1],catalog));assert.throws(()=>s.stageReview([0],[]));assert.throws(()=>createReviewRequests({...s.getSnapshot(),feedback:null},[0],catalog,now))
})
test('transitions reject terminal resurrection and premature completion',async()=>{
 const s=service();assert.throws(()=>transition(s.getSnapshot(),'completed',now));await s.start();s.cancel();assert.throws(()=>transition(s.getSnapshot(),'ready',now));assert.equal(await s.submit('hello'),false)
})
test('mock distinguishes partial semantic usage and does not add infinitives to nouns',async()=>{
 const s=service('useTheWord');await s.start();await s.submit('I achieve to school.');await s.end();const word=s.getSnapshot().feedback.words[0]
 assert.equal(word.outcome,'partial');assert.equal(word.retrieval,'recognized');assert.equal(word.semantic,'inappropriate');assert.equal(word.grammar,'unassessed')
 const noun=service('conversation');await noun.start();await noun.submit('I want book');await noun.end();assert.deepEqual(noun.getSnapshot().feedback.corrections,[])
 s.dispose();assert.throws(()=>s.stageReview([0],catalog))
})
test('application account outbox and durable storage remain untouched throughout practice',async()=>{
 const {Application}=await import('../src/data/application.ts')
 const {memoryStorage}=await import('../src/data/localRepository.ts')
 const {combinedCatalog}=await import('../src/userVocabulary.ts')
 const {createSession,submitAnswer}=await import('../src/dailyTestModel.ts')
 const {assessLearningState}=await import('../src/learningState.ts')
 const storage=memoryStorage();let writes=0,pushes=0
 const app=new Application({getItem:storage.getItem,setItem(key,value){writes++;storage.setItem(key,value)}},{project:'practice-test',transport:{async pull(){return {revision:0,cells:{}}},async push(){pushes++;throw Error('Unexpected sync write')}}})
 await app.setUser({id:'practice-user'});app.chooseAccount();app.setOnline(false)
 const currentCatalog=combinedCatalog(app.current.vocabulary)
 let learning={...app.current.learning,session:createSession(app.current.learning.history,now,()=>.3,'mixed',[],currentCatalog)}
 while(learning.session.phase!=='completed'){learning={...learning,session:submitAnswer({...learning.session,draft:'wrong'})};learning=assessLearningState(learning,false,now,currentCatalog)}
 app.saveLearning(learning)
 const before={data:structuredClone(app.current),queue:structuredClone(app.sync.cache.queue),writes,pushes}
 const s=service('voiceAnswer',new MockPracticeProvider(),{quiz:app.current.learning.session,history:app.current.learning.history,catalog:currentCatalog})
 await s.start();await s.submit('wrong');await s.end();s.stageReview([s.getSnapshot().targets[0].wordId],currentCatalog);s.dispose()
 assert.deepEqual(app.current,before.data);assert.deepEqual(app.sync.cache.queue,before.queue);assert.equal(writes,before.writes);assert.equal(pushes,before.pushes);app.sync.dispose()
})
