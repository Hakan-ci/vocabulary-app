import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { emptyLearningState, assessLearningState, assessReviewState, parseLearningState } from '../src/learningState.ts'
import { createSession, submitAnswer, questionContent } from '../src/dailyTestModel.ts'
import { createReviewSession } from '../src/reviewModel.ts'
import { dashboard } from '../src/progressModel.ts'

test('imported questions record activity in both practice features and restore without losing totals', () => {
  const catalog = Array.from({length:10}, (_,i) => ({id:1000000+i,english:`custom${i}`,turkishMeanings:[`özel${i}`],tags:['My words'],createdAt:null}))
  const now = new Date(2026,8,4,12).getTime()
  let state = emptyLearningState(catalog,now)
  state.session = createSession(state.history,now,()=>.4,'mixed',[],catalog)
  for(let i=0;i<10;i++) {
    state.session=submitAnswer({...state.session,draft:questionContent(state.session.questions[i],catalog).expected})
    state=assessLearningState(state,false,now+i,catalog)
  }
  state.reviewSession=createReviewSession(catalog,state.history,now+20)
  state.reviewSession.practice=submitAnswer({...state.reviewSession.practice,draft:'wrong'})
  state=assessReviewState(state,true,now+21,catalog)
  const restored=parseLearningState(state,[...words,...catalog],now+22)
  assert.deepEqual(restored.activity,state.activity)
  const d=dashboard(catalog,state.history,[],state.activity,now+22)
  assert.equal(d.today,11);assert.equal(d.daily.completed,1);assert.equal(d.daily.best,10)
  assert.equal(d.days[6].known,1);assert.equal(d.days[6].missed,10)
})
