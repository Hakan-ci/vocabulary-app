import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { emptyHistory, emptyWordHistory, emptyStatistics, recordAssessment, calculateDifficulty, difficultyLevel, calculatedWord, directionalReviewDue, learningStatus, parseHistory, parseWordHistory, learnedIds, DAY_MS } from '../src/learningHistory.ts'
import { selectQuestions, directionWeight, chooseDirection, selectionWeight } from '../src/adaptiveSelection.ts'
import { createSession, submitAnswer, parseSession, sessionSummary } from '../src/dailyTestModel.ts'
import { LEARNING_STATE_KEY, loadLearningState, parseLearningState, assessLearningState } from '../src/learningState.ts'
const NOW = 30 * DAY_MS
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function known(streak, at = NOW, direction = 'englishToTurkish') { let h = emptyWordHistory(); for (let i=0;i<streak;i++) h=recordAssessment(h,true,at,direction);return h }
function mockStorage(values={}) { const data=new Map(Object.entries(values));return {writes:[],getItem(k){return data.get(k)??null},setItem(k,v){this.writes.push(k);data.set(k,v)}} }
const toLegacyHistory = history => Object.fromEntries(Object.entries(history).map(([id, { englishToTurkish:_en, turkishToEnglish:_tr, legacyReviewPending:_pending, ...old }]) => [id,old]))
function legacySession(s, version=2) { const {questions,mode:_mode,completion:_completion,...rest}=s;return {...rest,version,wordIds:questions.map(q=>q.wordId),results:s.results.map(({direction:_direction,...r})=>r),...(version===1?{reviewWordIds:undefined}:{})} }

test('difficulty boundaries and zero attempts never divide by zero',()=>{
  assert.deepEqual(calculateDifficulty(emptyStatistics(),NOW),{score:0,level:'New'})
  for(const [score,level] of [[0,'Easy'],[25,'Easy'],[26,'Medium'],[50,'Medium'],[51,'Hard'],[75,'Hard'],[76,'Very Hard'],[100,'Very Hard']]) assert.equal(difficultyLevel(score),level)
  assert.equal(calculateDifficulty(recordAssessment(emptyWordHistory(),false,NOW),NOW).score,100)
  assert.equal(calculateDifficulty(known(5),NOW).score,0)
})
test('difficulty uses miss rate, seven-day decay, and capped streak reduction',()=>{
  let h=recordAssessment(known(1),false,NOW)
  assert.equal(calculateDifficulty(h,NOW).score,65)
  assert.equal(calculateDifficulty(h,NOW+3.5*DAY_MS).score,58)
  assert.equal(calculateDifficulty(h,NOW+7*DAY_MS).score,50)
  h=recordAssessment(h,true,NOW+1)
  assert.equal(calculateDifficulty(h,NOW+1).score,28)
  const stats={...emptyStatistics(),timesTested:100,timesMissed:50,timesKnown:50,consecutiveKnown:20,lastTestedAt:NOW,lastKnownAt:NOW}
  assert.equal(calculateDifficulty(stats,NOW).score,25)
})
test('directional schedules and misses are independent and use 1/3/7/14-day boundaries',()=>{
  for(const [streak,days] of [[1,1],[2,3],[3,7],[4,14],[8,14]]){
    let h=known(streak)
    assert.equal(directionalReviewDue(h,'englishToTurkish',NOW+days*DAY_MS-1),false)
    assert.equal(directionalReviewDue(h,'englishToTurkish',NOW+days*DAY_MS),true)
    assert.equal(directionalReviewDue(h,'turkishToEnglish',NOW+100*DAY_MS),false)
    h=recordAssessment(h,false,NOW+1,'turkishToEnglish')
    h=recordAssessment(h,true,NOW+2,'englishToTurkish')
    assert.equal(h.englishToTurkish.consecutiveKnown,streak+1)
    assert.equal(h.turkishToEnglish.consecutiveKnown,0)
    assert.equal(calculatedWord(h,NOW+2).needsReview,true)
    assert.equal(h.learned,true)
  }
})
test('same-day assessments increment streaks and backwards clock does not corrupt timestamps',()=>{
  let h=known(4)
  h=recordAssessment(h,true,NOW+1,'turkishToEnglish')
  h=recordAssessment(h,false,NOW-1,'englishToTurkish')
  assert.equal(h.timesTested,6);assert.equal(h.englishToTurkish.timesTested,5)
  assert.ok(parseWordHistory(h))
})
test('Mixed randomness favors weakness and explores an untested direction',()=>{
  const h=known(8)
  assert.equal(directionWeight(h,'turkishToEnglish',NOW),70)
  const random=rng(14)
  let unseen=0
  for(let i=0;i<1000;i++) if(chooseDirection(h,'mixed',NOW,random)==='turkishToEnglish') unseen++
  assert.ok(unseen>650&&unseen<850)
  let weak=recordAssessment(h,false,NOW,'turkishToEnglish')
  let reverse=0
  for(let i=0;i<1000;i++) if(chooseDirection(weak,'mixed',NOW,random)==='turkishToEnglish') reverse++
  assert.ok(reverse>800)
  assert.equal(chooseDirection(h,'englishToTurkish',NOW,random),'englishToTurkish')
})
test('selection weights incorporate difficulty, missed history, due status, and recency',()=>{
  const h=recordAssessment(emptyWordHistory(),false,NOW)
  assert.ok(selectionWeight(h,'englishToTurkish',NOW)>selectionWeight(known(4),'englishToTurkish',NOW))
  const recent=known(1), old={...recent,lastTestedAt:NOW-2*DAY_MS}
  assert.equal(selectionWeight(recent,'englishToTurkish',NOW)*4,selectionWeight(old,'englishToTurkish',NOW))
  assert.equal(selectionWeight({...recent,lastTestedAt:NOW-DAY_MS/2},'englishToTurkish',NOW)*2,selectionWeight(old,'englishToTurkish',NOW))
})
test('overlapping quotas reserve 3 weak, 2 additional missed, 2 new, 2 due, and 1 random',()=>{
  const h=emptyHistory()
  for(let id=0;id<10;id++) h[id]=recordAssessment(emptyWordHistory(),false,NOW)
  for(let id=16;id<26;id++) h[id]=known(2,NOW-4*DAY_MS)
  for(let id=26;id<30;id++) h[id]=known(5)
  for(let seed=1;seed<30;seed++){
    const selected=selectQuestions(h,'englishToTurkish',NOW,rng(seed),[],words.slice(0,30))
    assert.equal(new Set(selected.map(q=>q.wordId)).size,10)
    assert.ok(selected.filter(q=>q.wordId<10).length>=5)
    assert.ok(selected.filter(q=>q.wordId>=10&&q.wordId<16).length>=2)
    assert.ok(selected.filter(q=>q.wordId>=16&&q.wordId<26).length>=2)
    assert.ok(selected.filter(q=>directionalReviewDue(h[q.wordId],q.direction,NOW)).length>=7)
  }
})
test('selection fills every shortage and avoids an identical prior set',()=>{
  for(const mode of ['englishToTurkish','turkishToEnglish','mixed']) for(const fill of ['new','weak','recent']){
    const h=emptyHistory()
    for(const w of words) h[w.id]=fill==='weak'?recordAssessment(h[w.id],false,NOW):fill==='recent'?known(4):emptyWordHistory()
    const first=selectQuestions(h,mode,NOW,rng(5))
    const again=selectQuestions(h,mode,NOW,rng(5),first.map(q=>q.wordId))
    assert.equal(first.length,10);assert.equal(new Set(again.map(q=>q.wordId)).size,10)
    assert.notDeepEqual([...first.map(q=>q.wordId)].sort(),[...again.map(q=>q.wordId)].sort())
  }
})
test('version 1 aggregate history migrates into EN→TR only, preserving counters and membership',()=>{
  const h=emptyHistory();h[0]=known(3);h[5]=recordAssessment(known(1),false,NOW);h[23]=emptyWordHistory(true)
  const old=toLegacyHistory(h)
  const mock=mockStorage({[LEARNING_STATE_KEY]:JSON.stringify({version:1,history:old,session:null}),'kelime-favorites':'[2]','kelime-learned':'[1]'})
  const loaded=loadLearningState(mock)
  assert.equal(loaded.error,false);assert.equal(loaded.value.version,6)
  assert.equal(loaded.value.preferredMode,'englishToTurkish')
  assert.equal(loaded.value.history[0].englishToTurkish.timesKnown,3)
  assert.equal(loaded.value.history[0].turkishToEnglish.timesTested,0)
  assert.equal(loaded.value.history[23].legacyReviewPending,true)
  assert.equal(directionalReviewDue(loaded.value.history[23],'englishToTurkish',NOW),true)
  assert.equal(directionalReviewDue(loaded.value.history[23],'turkishToEnglish',NOW),false)
  assert.deepEqual(learnedIds(loaded.value.history),[0,5,23])
  assert.deepEqual(mock.writes,[LEARNING_STATE_KEY]);assert.equal(mock.getItem('kelime-favorites'),'[2]')
  loadLearningState(mock);assert.equal(mock.writes.length,1)
})
test('legacy session phases and summaries migrate without fabricated snapshots',()=>{
  const draft={...createSession(emptyHistory(),NOW,rng(4)),draft:'saved answer'}
  let completed=parseLearningState({version:2,preferredMode:'englishToTurkish',history:emptyHistory(),session:draft},words,NOW)
  for(let i=0;i<10;i++) completed=assessLearningState({...completed,session:submitAnswer({...completed.session,draft:'wrong'})},true,NOW+i)
  for(const s of [draft,submitAnswer(draft),completed.session]) for(const version of [1,2]){
    const restored=parseSession(legacySession(s,version))
    assert.deepEqual(restored.questions.map(q=>q.wordId),s.questions.map(q=>q.wordId));assert.ok(restored.questions.every(q=>q.snapshot.rule==='legacy'))
    assert.equal(restored.draft,s.draft);assert.equal(restored.phase,s.phase)
    assert.equal(restored.mode,'englishToTurkish');assert.equal(restored.completion,null)
    assert.ok(restored.results.every(r=>r.direction==='englishToTurkish'))
    if(s.phase==='completed'){assert.equal(sessionSummary(restored).score,0);assert.equal(sessionSummary(restored).hardest,null)}
  }
})
test('old membership-only migration and preferred mode persist without reimporting old keys',()=>{
  const mock=mockStorage({'kelime-learned':'[0,5,5,999]','kelime-daily-test':'bad json'})
  const {value}=loadLearningState(mock)
  assert.deepEqual(learnedIds(value.history),[0,5])
  value.preferredMode='mixed';value.history[5].learned=false
  mock.setItem(LEARNING_STATE_KEY,JSON.stringify(value))
  const restored=loadLearningState(mock).value
  assert.equal(restored.preferredMode,'mixed');assert.equal(restored.history[5].learned,false)
})
test('invalid records recover independently and storage failures stay usable',()=>{
  const good=known(2)
  for(const bad of [{...good,timesTested:-1},{...good,timesKnown:99},{...good,englishToTurkish:{}},{...good,lastKnownAt:'today'}]) assert.equal(parseWordHistory(bad),null)
  const recovered=parseHistory({0:good,1:{bad:true},999:good})
  assert.deepEqual(recovered[0],good);assert.deepEqual(recovered[1],emptyWordHistory());assert.equal(recovered[999],undefined)
  for(const raw of ['bad','null','{"version":99}']) assert.deepEqual(learnedIds(loadLearningState(mockStorage({[LEARNING_STATE_KEY]:raw,'kelime-learned':'[5]'})).value.history),[])
  assert.equal(loadLearningState({getItem(){throw Error('blocked')},setItem(){}}).error,true)
  const mock=mockStorage({'kelime-learned':'[5]'});mock.setItem=()=>{throw Error('quota')}
  const loaded=loadLearningState(mock);assert.equal(loaded.error,true);assert.equal(loaded.value.history[5].learned,true)
  assert.equal(parseLearningState({version:2,preferredMode:'bad',history:recovered,session:null}).preferredMode,'englishToTurkish')
})
test('review labels cannot be cleared by knowing the other direction',()=>{
  let h=recordAssessment(emptyWordHistory(),false,NOW,'turkishToEnglish')
  h=recordAssessment(h,true,NOW+1,'englishToTurkish')
  assert.equal(learningStatus(h,NOW+1),'Needs Review')
  assert.equal(calculatedWord(h,NOW+1).turkishToEnglish.level,'Very Hard')
  assert.equal(calculatedWord(h,NOW+1).englishToTurkish.level,'Easy')
})
