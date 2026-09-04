import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { emptyHistory, emptyWordHistory, recordAssessment, DAY_MS, removeFromLearned } from '../src/learningHistory.ts'
import { reviewQueue, reviewDeadline, createReviewSession, parseReviewSession, assessReview } from '../src/reviewModel.ts'
import { createSession, questionContent, sessionSummary, submitAnswer } from '../src/dailyTestModel.ts'
import { emptyLearningState, loadLearningState, parseLearningState, assessReviewState, assessLearningState, LEARNING_STATE_KEY } from '../src/learningState.ts'

const now = new Date(2026, 8, 4, 12).getTime()
const en = 'englishToTurkish', tr = 'turkishToEnglish'
const knownAt = (time, streak = 1, direction = en) => {
  let h = emptyWordHistory()
  for (let i = 0; i < streak; i++) h = recordAssessment(h, true, time, direction)
  return h
}
test('review deadlines preserve elapsed intervals and exact boundaries in both directions', () => {
  for (const direction of [en, tr]) for (const [streak, days] of [[1,1],[2,3],[3,7],[4,14],[5,14]]) {
    const history = emptyHistory(), time = now - days * DAY_MS
    history[0] = knownAt(time, streak, direction)
    assert.equal(reviewDeadline(history[0], direction), now)
    assert.equal(reviewQueue(words, history, now - 1)[0].group, 'Next scheduled reviews')
    assert.equal(reviewQueue(words, history, now)[0].group, 'Due today')
    assert.equal(createReviewSession(words, history, now).practice.questions[0].direction, direction)
  }
})
test('queue groups unique words, missed/migrated first, and includes removed Learned words', () => {
  let history = emptyHistory()
  history[0] = knownAt(now - 3 * DAY_MS)
  history[1] = knownAt(now - DAY_MS - 1000)
  history[2] = knownAt(now - DAY_MS + 1000)
  history[3] = recordAssessment(emptyWordHistory(), false, now)
  history[4] = emptyWordHistory(true)
  history = removeFromLearned(history, 0)
  const queue = reviewQueue(words, history, now)
  assert.deepEqual(queue.map(e => [e.word.id, e.group]), [[3,'Needs Review'],[4,'Needs Review'],[0,'Overdue'],[1,'Due today'],[2,'Next scheduled reviews']])
  assert.equal(queue[4].directions.length, 1)
  assert.equal(queue[4].directions[0].direction, en)
  assert.equal(createReviewSession(words, history, now).practice.questions.length, 4)
  assert.equal(createReviewSession(words, emptyHistory(), now), null)
})
test('select only due directions, preferring misses, difficulty, older deadlines then English', () => {
  const history = emptyHistory()
  history[0] = recordAssessment(knownAt(now - 5 * DAY_MS), false, now, tr)
  assert.equal(createReviewSession(words, history, now).practice.questions[0].direction, tr)
  history[0] = recordAssessment(knownAt(now - 5 * DAY_MS), true, now, tr)
  assert.equal(createReviewSession(words, history, now).practice.questions[0].direction, en)
  history[0] = recordAssessment(knownAt(now - 5 * DAY_MS), true, now - 4 * DAY_MS, tr)
  assert.equal(createReviewSession(words, history, now).practice.questions[0].direction, en)
  history[0] = recordAssessment(knownAt(now - 5 * DAY_MS), true, now - 5 * DAY_MS, tr)
  assert.equal(createReviewSession(words, history, now).practice.questions[0].direction, en)
  history[0] = recordAssessment(emptyWordHistory(), false, now - 6 * DAY_MS, tr)
  history[0] = recordAssessment(history[0], true, now - 5 * DAY_MS, tr)
  history[0] = recordAssessment(history[0], true, now - 5 * DAY_MS, en)
  assert.equal(createReviewSession(words, history, now).practice.questions[0].direction, tr)
})
test('all due words are snapshotted once without ten-word cap, including imported IDs', () => {
  const catalog = [...words, { id:1000000, english:'custom', turkishMeanings:['özel'], tags:['My words'],createdAt:null }]
  const history = emptyHistory(catalog)
  for (const word of catalog) history[word.id] = recordAssessment(emptyWordHistory(), false, now)
  const review = createReviewSession(catalog, history, now)
  assert.equal(review.practice.questions.length, 151)
  assert.equal(new Set(review.practice.questions.map(q => q.wordId)).size, 151)
  assert.deepEqual(parseReviewSession(review, catalog), review)
  assert.equal(parseReviewSession(review, words), null)
})
test('reviews preserve independent counters, next-session retry, summary snapshots and duplicate guards', () => {
  let state = emptyLearningState()
  state.history[0] = recordAssessment(knownAt(now - 2 * DAY_MS), false, now, tr)
  state.history[1] = knownAt(now - 2 * DAY_MS)
  state.reviewSession = createReviewSession(words, state.history, now)
  const originalQuestions = state.reviewSession.practice.questions
  let practice = state.reviewSession.practice
  assert.deepEqual(submitAnswer(practice), practice)
  practice = submitAnswer({ ...practice, draft: questionContent(practice.questions[0]).expected })
  state.reviewSession = { version:2, practice }
  const beforeDaily = createSession(state.history)
  state.session = beforeDaily
  state = assessReviewState(state, false, now + 1)
  assert.equal(state.reviewSession.practice.index, 1)
  assert.deepEqual(assessReviewState(state, false, now + 1), state)
  assert.deepEqual(state.session, beforeDaily)
  assert.equal(state.history[0][tr].consecutiveKnown, 0)
  assert.equal(state.history[0].learned, true)
  assert.equal(state.history[0][en].timesTested, 1)
  state.history[2] = recordAssessment(emptyWordHistory(), false, now + 2)
  assert.deepEqual(state.reviewSession.practice.questions, originalQuestions)
  state.reviewSession.practice = submitAnswer({ ...state.reviewSession.practice, draft:'wrong' })
  state = assessReviewState(state, true, now + 3)
  const summary = sessionSummary(state.reviewSession.practice)
  assert.equal(summary.accuracy, 50)
  assert.equal(summary.known, 1)
  assert.equal(summary.missed, 1)
  assert.deepEqual(summary.needsReviewIds, [0])
  const next = createReviewSession(words, state.history, now + 4)
  assert.deepEqual(next.practice.questions.map(q => q.wordId).sort(), [0,2])
  state.history[0] = recordAssessment(state.history[0], true, now + 5, tr)
  assert.deepEqual(sessionSummary(state.reviewSession.practice), summary)
  assert.deepEqual(parseReviewSession(state.reviewSession, words), state.reviewSession)
  assert.equal(state.history[1][en].consecutiveKnown, 2)
})
test('storage migration preserves Daily Test; Review phases restore and corrupt Review is isolated', () => {
  const old = { ...emptyLearningState(), version:2 }
  old.history[0] = recordAssessment(emptyWordHistory(), false, now)
  old.session = { ...createSession(old.history), draft:'daily draft' }
  const map = new Map([[LEARNING_STATE_KEY, JSON.stringify(old)]])
  const storage = { getItem:key => map.get(key) ?? null, setItem:(key,value) => map.set(key,value) }
  let state = loadLearningState(storage).value
  assert.equal(state.version, 5)
  assert.equal(state.reviewSession, null)
  assert.deepEqual(state.session, old.session)
  state.reviewSession = createReviewSession(words, state.history, now)
  for (const feedback of [false,true]) {
    state.reviewSession.practice = { ...state.reviewSession.practice, draft:'review draft' }
    if (feedback) state.reviewSession.practice = submitAnswer(state.reviewSession.practice)
    storage.setItem(LEARNING_STATE_KEY, JSON.stringify(state))
    assert.deepEqual(loadLearningState(storage).value, state)
  }
  const invalid = { ...state, reviewSession:{ ...state.reviewSession, practice:{ ...state.reviewSession.practice, index:100 } } }
  const recovered = parseLearningState(invalid)
  assert.equal(recovered.reviewSession, null)
  assert.deepEqual(recovered.history, state.history)
  assert.deepEqual(recovered.session, state.session)
  const failed = loadLearningState({getItem:()=>JSON.stringify(old),setItem:()=>{throw Error('quota')}})
  assert.equal(failed.error, true)
  assert.deepEqual(failed.value.history, state.history)
  state.session = submitAnswer(state.session)
  const changed = assessLearningState(state, true, now + 1)
  assert.deepEqual(changed.reviewSession, state.reviewSession)
  assert.deepEqual(assessReview(state.reviewSession, state.history, true, now + 2).reviewSession.practice.phase, 'completed')
})
