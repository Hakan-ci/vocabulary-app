import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { createSession, submitAnswer, assessAnswer, parseSession, answerMatches, questionContent, sessionSummary } from '../src/dailyTestModel.ts'
import { emptyHistory, recordAssessment, learnedIds, removeFromLearned } from '../src/learningHistory.ts'

const now = 10000000
const rng = () => .4
const start = (mode = 'englishToTurkish', history = emptyHistory()) => createSession(history, now, rng, mode)
const submit = s => submitAnswer({ ...s, draft: 'wrong' })
const finish = (session, history, choose = i => i % 2 === 0) => {
  for (let i = session.index; i < 10; i++) {
    const next = assessAnswer(submit(session), history, choose(i), now + i)
    session = next.session; history = next.history
  }
  return { session, history }
}
test('single modes use ten unique words and correct prompt languages', () => {
  for (const mode of ['englishToTurkish', 'turkishToEnglish']) {
    const session = start(mode)
    assert.equal(new Set(session.questions.map(q => q.wordId)).size, 10)
    for (const q of session.questions) {
      assert.equal(q.direction, mode)
      const c = questionContent(q)
      assert.ok(mode === 'englishToTurkish' ? c.prompt === c.word.english : c.word.turkishMeanings.includes(c.prompt))
      assert.equal(c.expected, mode === 'englishToTurkish' ? c.word.turkishMeanings[0] : c.word.english)
    }
  }
})
test('answer matching uses Turkish tolerance or English casing without fuzzy matches', () => {
  for (const [answer, expected] of [[' GUNES ', 'Güneş'], ['  TEŞEKKÜR   EDERİM ', 'Teşekkür ederim'], ['kiz kardes', 'Kız kardeş']]) assert.ok(answerMatches(answer, expected, 'englishToTurkish', 'legacy'))
  assert.ok(answerMatches('  GOOD   MORNING ', 'Good morning', 'turkishToEnglish'))
  assert.ok(answerMatches('SISTER', 'Sister', 'turkishToEnglish'))
  assert.equal(answerMatches('sıster', 'Sister', 'turkishToEnglish'), false)
  for (const wrong of ['', 'gün', 'gunes today', 'sun']) assert.equal(answerMatches(wrong, 'Güneş'), false)
})
test('blank and repeated submissions and duplicate assessments do not advance twice', () => {
  const s = start()
  assert.equal(submitAnswer(s), s)
  assert.equal(submitAnswer({ ...s, draft: '   ' }).phase, 'answering')
  assert.equal(assessAnswer(s, emptyHistory(), true, now).session, s)
  const feedback = submit(s)
  assert.equal(submitAnswer(feedback), feedback)
  const next = assessAnswer(feedback, emptyHistory(), true, now)
  assert.equal(next.session.index, 1)
  assert.equal(assessAnswer(next.session, next.history, true, now).session, next.session)
})
test('self-assessment updates only the selected direction and remains independent of typed result', () => {
  const s = start('turkishToEnglish'), id = s.questions[0].wordId
  const next = assessAnswer(submit(s), emptyHistory(), true, now)
  assert.deepEqual(learnedIds(next.history), [id])
  assert.equal(next.history[id].timesKnown, 1)
  assert.equal(next.history[id].turkishToEnglish.timesKnown, 1)
  assert.equal(next.history[id].englishToTurkish.timesTested, 0)
  const correct = submitAnswer({ ...s, draft: questionContent(s.questions[0]).expected })
  const missed = assessAnswer(correct, next.history, false, now + 1)
  assert.equal(missed.history[id].learned, true)
  assert.equal(missed.history[id].turkishToEnglish.timesMissed, 1)
  assert.equal(missed.history[id].turkishToEnglish.consecutiveKnown, 0)
  assert.deepEqual(missed.session.newlyLearnedIds, [])
})
test('score and per-direction accuracy are independent of Known totals', () => {
  let s = start('mixed'), history = emptyHistory()
  s = { ...s, questions: s.questions.map((q, i) => ({ ...q, direction: i < 5 ? 'englishToTurkish' : 'turkishToEnglish' })) }
  for (let i = 0; i < 10; i++) {
    const typedCorrect = i < 2 || i === 5
    const next = assessAnswer(submitAnswer({ ...s, draft: typedCorrect ? questionContent(s.questions[i]).expected : 'wrong' }), history, i < 7, now + i)
    s = next.session; history = next.history
  }
  const result = sessionSummary(s)
  assert.equal(result.score, 3); assert.equal(result.accuracy, 30)
  assert.equal(result.englishToTurkishAccuracy, 40); assert.equal(result.turkishToEnglishAccuracy, 20)
  assert.equal(result.known, 7); assert.equal(result.missed, 3); assert.equal(result.newlyLearned, 7)
  assert.equal(result.reviewWords, 0)
  assert.equal(sessionSummary(finish(start(), emptyHistory()).session).turkishToEnglishAccuracy, null)
})
test('completion freezes review state and top-three directional difficulty in question order for ties', () => {
  const initial = start()
  const finished = finish(initial, emptyHistory(), () => false)
  assert.equal(finished.session.phase, 'completed')
  assert.equal(finished.session.completion.needsReviewIds.length, 10)
  assert.deepEqual(finished.session.completion.hardest.map(h => h.wordId), initial.questions.slice(0, 3).map(q => q.wordId))
  assert.ok(finished.session.completion.hardest.every(h => h.score === 100 && h.level === 'Very Hard'))
  const before = sessionSummary(finished.session)
  const id = initial.questions[0].wordId
  finished.history[id] = recordAssessment(finished.history[id], true, now + 100)
  assert.deepEqual(sessionSummary(finished.session), before)
  assert.deepEqual(parseSession(JSON.parse(JSON.stringify(finished.session))), finished.session)
})
test('review snapshots and manually removed membership retain history', () => {
  let history = emptyHistory()
  for (const w of words.slice(0,15)) history[w.id] = recordAssessment(history[w.id], true, now)
  const s = start('turkishToEnglish', history)
  assert.deepEqual(s.reviewWordIds, s.questions.filter(q => history[q.wordId].learned).map(q => q.wordId))
  const before = history[0]
  history = removeFromLearned(history, 0)
  assert.deepEqual(history[0], { ...before, learned: false })
  assert.equal(before.learned, true)
})
test('draft, direction, and feedback restoration plus malformed sessions', () => {
  const s = { ...start('mixed'), draft: 'saved draft' }
  for (const value of [s, submitAnswer(s)]) assert.deepEqual(parseSession(JSON.parse(JSON.stringify(value))), value)
  for (const value of [null, {}, 'bad', { ...s, version: 99 }, { ...s, index: 99 }, { ...s, questions: Array(10).fill(s.questions[0]) }, { ...s, phase: 'completed' }, { ...s, phase: 'feedback' }, { ...s, reviewWordIds: [999] }, { ...s, completion: {} }]) assert.equal(parseSession(value), null)
})
