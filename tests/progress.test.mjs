import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { emptyActivity, emptyBucket, bucketCounts, localDate, shiftDate, parseActivity, sourceCounts } from '../src/activity.ts'
import { dashboard, studyStreak, percentage } from '../src/progressModel.ts'
import { emptyHistory, emptyWordHistory, recordAssessment, DAY_MS } from '../src/learningHistory.ts'
import { emptyLearningState, parseLearningState, loadLearningState, assessLearningState, assessReviewState, LEARNING_STATE_KEY } from '../src/learningState.ts'
import { createSession, submitAnswer, questionContent } from '../src/dailyTestModel.ts'
import { createReviewSession } from '../src/reviewModel.ts'
const now = new Date(2026,8,4,12).getTime(), today = localDate(now)
function answer(state, known, correct, at=now) {
  const q=state.session.questions[state.session.index]
  state={...state,session:submitAnswer({...state.session,draft:correct?questionContent(q).expected:'wrong'})}
  return assessLearningState(state,known,at)
}
function runTest(state, correct=7, at=now) {
  state={...state,session:createSession(state.history,at,()=>.4)}
  for(let i=0;i<10;i++) state=answer(state,i%2===0,i<correct,at+i)
  return state
}
test('empty dashboard has real zero counts and unavailable metrics, percentages are zero-safe',()=>{
  const d=dashboard(words,emptyHistory(),[],emptyActivity(now),now)
  assert.equal(d.total,150);assert.equal(d.newWords,150)
  assert.equal(d.daily.accuracy,null);assert.equal(d.daily.average,null);assert.equal(d.daily.best,null)
  assert.equal(d.directional[0].difficulty,null);assert.equal(d.weaker,'Not enough data')
  assert.equal(d.days.filter(d=>d.available).length,1);assert.equal(d.days[6].answered,0)
  assert.equal(d.hardest.length,0);assert.equal(d.attention.length,0)
  assert.equal(percentage(0,0),0);assert.equal(percentage(85,300),28)
  assert.equal(dashboard([],{},[],emptyActivity(now),now).total,0)
})
test('membership overlap, imported IDs, current deadlines and rankings use real history',()=>{
  const catalog=[...words,{id:1000000,english:'custom',turkishMeanings:['özel'],tags:['My words'],createdAt:null}],h=emptyHistory(catalog)
  h[0]=recordAssessment(emptyWordHistory(),true,now-DAY_MS)
  h[0]=recordAssessment(h[0],false,now)
  h[1]=recordAssessment(emptyWordHistory(),false,now-DAY_MS)
  h[2]=recordAssessment(emptyWordHistory(),true,now-2*DAY_MS)
  h[1000000]=recordAssessment(emptyWordHistory(),false,now)
  h[1000000]=recordAssessment(h[1000000],false,now+1)
  const d=dashboard(catalog,h,[1000000,0,999999],emptyActivity(now),now)
  assert.equal(d.learned,2);assert.equal(d.learning,2);assert.equal(d.newWords,147);assert.equal(d.needsReview,4)
  assert.equal(d.scheduledToday,2);assert.equal(d.favorites,2)
  assert.equal(d.hardest[0].word.id,1000000)
  assert.equal(d.attention[0].word.id,1)
  assert.equal(d.hardest[0].turkishToEnglish.level,'New')
  assert.equal(d.directional[0].answered,6)
})
test('assessments update goal and accuracy once; completions aggregate scores and study dates',()=>{
  let state=emptyLearningState(words,now)
  state.session=createSession(state.history,now,()=>.3)
  const submitted={...state,session:submitAnswer({...state.session,draft:'wrong'})}
  assert.equal(Object.keys(submitted.activity.days).length,0)
  state=assessLearningState(submitted,true,now)
  assert.deepEqual(assessLearningState(state,true,now),state)
  assert.deepEqual(bucketCounts(state.activity.days[today]),{answered:1,known:1,missed:0,correct:0})
  for(let i=1;i<10;i++) state=answer(state,false,true,now+i)
  let d=dashboard(words,state.history,[],state.activity,now)
  assert.equal(d.daily.completed,1);assert.equal(d.daily.accuracy,90);assert.equal(d.daily.average,9);assert.equal(d.daily.best,9)
  assert.equal(d.streak.current,1)
  state=runTest(state,5,now+100)
  d=dashboard(words,state.history,[],state.activity,now+200)
  assert.equal(d.today,20);assert.equal(d.daily.completed,2);assert.equal(d.daily.average,7);assert.equal(d.daily.best,9)
  assert.equal(d.streak.current,1)
  assert.equal(d.days[6].answered,20)
})
test('Review activity counts toward goals and directional accuracy but not Daily Test scores',()=>{
  let state=emptyLearningState(words,now)
  state.history[0]=recordAssessment(emptyWordHistory(),false,now,'turkishToEnglish')
  state.reviewSession=createReviewSession(words,state.history,now)
  state.reviewSession.practice=submitAnswer({...state.reviewSession.practice,draft:'Hello'})
  state=assessReviewState(state,false,now+1)
  assert.equal(state.activity.days[today].review.completed,1)
  const d=dashboard(words,state.history,[],state.activity,now+2)
  assert.equal(d.today,1);assert.equal(d.daily.completed,0);assert.equal(d.daily.answered,0)
  assert.equal(d.directional[1].accuracy,100);assert.equal(d.directional[1].answered,2)
  assert.equal(d.streak.current,1);assert.equal(d.directional[1].recorded,1)
  assert.deepEqual(assessReviewState(state,false,now+2),state)
})
test('weaker direction combines unrounded accuracy and current difficulty without averaging New words',()=>{
  const h=emptyHistory(),a=emptyActivity(now)
  h[0]=recordAssessment(emptyWordHistory(),true,now)
  h[1]=recordAssessment(emptyWordHistory(),false,now,'turkishToEnglish')
  const b=emptyBucket()
  b.daily.directions.englishToTurkish={answered:3,correct:2,known:3,missed:0}
  b.review.directions.turkishToEnglish={answered:3,correct:3,known:0,missed:3}
  a.days[today]=b
  let d=dashboard(words,h,[],a,now)
  assert.equal(d.directional[0].difficulty,0);assert.equal(d.directional[1].difficulty,100)
  assert.equal(d.weaker,'Turkish → English')
  h[1]=recordAssessment(emptyWordHistory(),true,now,'turkishToEnglish')
  b.review.directions.turkishToEnglish={...b.daily.directions.englishToTurkish}
  d=dashboard(words,h,[],a,now);assert.equal(d.weaker,'Balanced')
})
test('calendar windows and streaks handle yesterday, gaps, multiple sessions and month boundaries',()=>{
  const a=emptyActivity(now-10*DAY_MS)
  for(const day of ['2026-08-30','2026-08-31','2026-09-01','2026-09-03']) {a.days[day]=emptyBucket();a.days[day].review.completed=2}
  assert.deepEqual(studyStreak(a,'2026-09-04'),{current:1,best:3,last:'2026-09-03'})
  assert.equal(studyStreak(a,'2026-09-05').current,0)
  a.days['2026-09-04']=emptyBucket();a.days['2026-09-04'].daily.completed=1
  assert.equal(studyStreak(a,'2026-09-04').current,2)
  assert.equal(shiftDate('2026-03-08',1),'2026-03-09');assert.equal(shiftDate('2026-11-01',-1),'2026-10-31')
  assert.equal(shiftDate('2024-02-28',1),'2024-02-29')
  const d=dashboard(words,emptyHistory(),[],a,now)
  assert.equal(d.days[0].date,'2026-08-29');assert.equal(d.days[6].date,today)
})
test('legacy results migrate once undated; unfinished prefix is not counted twice on completion',()=>{
  let legacy=emptyLearningState(words,now)
  legacy.session=createSession(legacy.history,now,()=>.2)
  legacy=answer(legacy,true,true);legacy=answer(legacy,false,false)
  const raw={...legacy,version:3}, map=new Map([[LEARNING_STATE_KEY,JSON.stringify(raw)]])
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}
  let state=loadLearningState(storage,words,now).value
  assert.equal(state.version,6);assert.equal(state.dailyGoal,10)
  assert.equal(sourceCounts(state.activity.undated.daily).answered,2)
  assert.equal(Object.keys(state.activity.days).length,0)
  assert.deepEqual(loadLearningState(storage,words,now+100).value,state)
  for(let i=2;i<10;i++) state=answer(state,true,true,now+i)
  const d=dashboard(words,state.history,[],state.activity,now+20)
  assert.equal(d.daily.answered,10);assert.equal(d.today,8);assert.equal(d.daily.completed,1);assert.equal(d.daily.average,9)
  assert.equal(d.streak.current,1)
  const completedMigration=parseLearningState({...state,version:3},words,now)
  const old=dashboard(words,completedMigration.history,[],completedMigration.activity,now)
  assert.equal(old.daily.completed,1);assert.equal(old.daily.best,9);assert.equal(old.today,0);assert.equal(old.streak.current,0)
})
test('malformed activity recovers independently, goal defaults and saved progress survives failures',()=>{
  const state=runTest(emptyLearningState(words,now))
  const broken=structuredClone(state)
  broken.dailyGoal=17
  broken.activity.days[today].daily.directions.englishToTurkish.correct=-1
  broken.activity.days['2026-02-30']=emptyBucket()
  const restored=parseLearningState(broken,words,now)
  assert.equal(restored.dailyGoal,10);assert.equal(restored.activity.days[today].daily.completed,0)
  assert.equal(restored.activity.days['2026-02-30'],undefined)
  assert.deepEqual(restored.history,state.history);assert.deepEqual(restored.session,state.session)
  const stable=parseLearningState({...state,dailyGoal:25},words,now+100)
  assert.deepEqual(stable.activity,state.activity);assert.equal(stable.dailyGoal,25)
  const failed=loadLearningState({getItem:()=>JSON.stringify({...state,version:3}),setItem:()=>{throw Error('quota')}},words,now)
  assert.equal(failed.error,true);assert.deepEqual(failed.value.session,state.session)
  assert.equal(failed.value.activity.undated.daily.completed,1)
  const missing=parseActivity(null,now);assert.equal(missing.startedDate,today)
})
