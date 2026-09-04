import { localDate } from './activity.ts'
import { answerMatches } from './answerMatching.ts'
import type { MatchingRule } from './answerMatching.ts'
import { validateEntry, primaryMeaning, creationTime } from './wordFields.ts'
export { answerMatches } from './answerMatching.ts'
import type { VocabularyWord } from './vocabulary.ts'
import { words } from './vocabulary.ts'
import { calculateDifficulty, calculatedWord, recordAssessment } from './learningHistory.ts'
import type { LearningHistory } from './learningHistory.ts'
import { isDirection, isTestMode } from './learningTypes.ts'
import type { TestDirection, TestMode, Difficulty } from './learningTypes.ts'
import { selectQuestions } from './adaptiveSelection.ts'
import type { TestQuestion } from './adaptiveSelection.ts'
export type { TestQuestion } from './adaptiveSelection.ts'
export type QuestionSnapshot = TestQuestion & { snapshot: { word: VocabularyWord; prompt: string; acceptedAnswers: string[]; rule: MatchingRule } }
export type TestResult = QuestionSnapshot & { answer: string; known: boolean; correct: boolean; answeredAt?: number | null; activityDate?: string | null }
export type CompletionSnapshot = {
  needsReviewIds: number[]
  hardest: (TestQuestion & Difficulty)[]
}
export type TestSession = {
  version: 4
  syncId?: string
  startedAt?: number | null
  completedAt?: number | null
  mode: TestMode
  questions: QuestionSnapshot[]
  reviewWordIds: number[] | null
  index: number
  phase: 'answering' | 'feedback' | 'completed'
  draft: string
  submittedAnswer: string
  submittedCorrect: boolean | null
  results: TestResult[]
  newlyLearnedIds: number[]
  completion: CompletionSnapshot | null
}
const validId = (id: unknown, catalog: readonly VocabularyWord[]): id is number => typeof id === 'number' && catalog.some(word => word.id === id)
export const sanitizeIds = (value: unknown, catalog: readonly VocabularyWord[] = words): number[] => Array.isArray(value) ? [...new Set(value.filter(id => validId(id, catalog)))] : []
export function snapshotQuestion(question: TestQuestion, catalog: readonly VocabularyWord[], random = Math.random, rule: MatchingRule = 'strict'): QuestionSnapshot {
  const word = catalog.find(w => w.id === question.wordId)!
  const forward = question.direction === 'englishToTurkish'
  const prompt = forward ? word.english : word.turkishMeanings[rule === 'legacy' ? 0 : Math.floor(random() * word.turkishMeanings.length)]
  const acceptedAnswers = forward ? rule === 'legacy' ? [primaryMeaning(word)] : [...word.turkishMeanings] : [word.english, ...(rule === 'legacy' ? [] : word.englishAlternatives ?? [])]
  return { ...question, snapshot: { word: { ...word, turkishMeanings: [...word.turkishMeanings], tags: [...word.tags], ...(word.englishAlternatives ? {englishAlternatives:[...word.englishAlternatives]} : {}) }, prompt, acceptedAnswers, rule } }
}
export function questionContent(question: TestQuestion | QuestionSnapshot, catalog: readonly VocabularyWord[] = words) {
  const { snapshot } = 'snapshot' in question ? question : snapshotQuestion(question, catalog, () => 0)
  const forward = question.direction === 'englishToTurkish'
  return { word: snapshot.word, prompt: snapshot.prompt, expected: snapshot.acceptedAnswers[0], acceptedAnswers: snapshot.acceptedAnswers, rule: snapshot.rule, sourceLang: forward ? 'en' : 'tr', answerLang: forward ? 'tr' : 'en', answerLabel: forward ? 'Turkish meaning' : 'English meaning' }
}
export function questionMatches(answer: string, question: QuestionSnapshot) {
  return answerMatches(answer, question.snapshot.acceptedAnswers, question.direction, question.snapshot.rule)
}
export function createSession(history: LearningHistory, now = Date.now(), random = Math.random, mode: TestMode = 'englishToTurkish', previousIds: number[] = [], catalog: readonly VocabularyWord[] = words): TestSession {
  const questions = selectQuestions(history, mode, now, random, previousIds, catalog).map(q => snapshotQuestion(q, catalog, random))
  return { version: 4, syncId: crypto.randomUUID(), startedAt: now, completedAt: null, mode, questions, reviewWordIds: questions.filter(q => history[q.wordId].timesTested > 0 || history[q.wordId].learned).map(q => q.wordId),
    index: 0, phase: 'answering', draft: '', submittedAnswer: '', submittedCorrect: null, results: [], newlyLearnedIds: [], completion: null }
}
export function submitAnswer(session: TestSession): TestSession {
  return session.phase === 'answering' && session.draft.trim() ? { ...session, phase: 'feedback', submittedAnswer: session.draft.trim(), submittedCorrect: questionMatches(session.draft, session.questions[session.index]) } : session
}
export function completionSnapshot(questions: TestQuestion[], history: LearningHistory, now: number): CompletionSnapshot {
  return {
    needsReviewIds: questions.filter(q => calculatedWord(history[q.wordId], now).needsReview).map(q => q.wordId),
    hardest: questions.map((q, index) => ({ ...q, ...calculateDifficulty(history[q.wordId][q.direction], now), index }))
      .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).map(({ index: _index, ...entry }) => entry),
  }
}
export function assessAnswer(session: TestSession, history: LearningHistory, known: boolean, now = Date.now()) {
  if (session.phase !== 'feedback') return { session, history }
  const question = session.questions[session.index]
  const previous = history[question.wordId]
  const added = known && !previous.learned
  const index = session.index + 1
  const nextHistory = { ...history, [question.wordId]: recordAssessment(previous, known, now, question.direction) }
  const completed = index === session.questions.length
  const next: TestSession = { ...session, completedAt: completed ? now : null, index, phase: completed ? 'completed' : 'answering', draft: '', submittedAnswer: '', submittedCorrect: null,
    results: [...session.results, { ...question, answer: session.submittedAnswer, known, correct: session.submittedCorrect!, answeredAt: now, activityDate: localDate(now) }],
    newlyLearnedIds: added ? [...new Set([...session.newlyLearnedIds, question.wordId])] : session.newlyLearnedIds,
    completion: completed ? completionSnapshot(session.questions, nextHistory, now) : null }
  return { session: next, history: nextHistory }
}
function validSubset(value: unknown, ids: number[]): value is number[] {
  return Array.isArray(value) && new Set(value).size === value.length && value.every(id => ids.includes(id))
}
export function parseSession(value: unknown, catalog: readonly VocabularyWord[] = words, variableLength = false, legacyCatalog: readonly VocabularyWord[] = catalog, deletedIds: readonly number[] = []): TestSession | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const historicalDeletion = raw.version === 4 && raw.phase === 'completed'
  const allowedCount = catalog.length + (historicalDeletion ? deletedIds.length : 0)
  const legacy = raw.version === 1 || raw.version === 2
  if (!legacy && raw.version !== 3 && raw.version !== 4) return null
  const questions = legacy && Array.isArray(raw.wordIds) ? raw.wordIds.map(wordId => ({ wordId, direction: 'englishToTurkish' })) : raw.questions
  const mode = legacy ? 'englishToTurkish' : raw.mode
  if (!Array.isArray(questions) || (variableLength ? questions.length < 1 || questions.length > allowedCount : questions.length !== Math.min(10, allowedCount)) || !isTestMode(mode) || questions.some(q => !q || (!validId(q.wordId, catalog) && !(historicalDeletion && deletedIds.includes(q.wordId))) || !isDirection(q.direction) || (mode !== 'mixed' && q.direction !== mode))) return null
  const ids = questions.map(q => q.wordId)
  if (new Set(ids).size !== ids.length || !Number.isInteger(raw.index) || Number(raw.index) < 0 || Number(raw.index) > ids.length ||
    !['answering','feedback','completed'].includes(String(raw.phase)) || typeof raw.draft !== 'string' || typeof raw.submittedAnswer !== 'string' ||
    !Array.isArray(raw.results) || raw.results.length !== raw.index) return null
  if ((raw.phase === 'completed') !== (raw.index === ids.length)) return null
  if (raw.phase === 'feedback' ? !raw.submittedAnswer.trim() || raw.submittedAnswer !== raw.draft.trim() : raw.submittedAnswer !== '') return null
  if (raw.phase === 'completed' && raw.draft !== '') return null
  if (raw.results.some((r, i) => !r || r.wordId !== ids[i] || typeof r.answer !== 'string' || !r.answer.trim() || typeof r.known !== 'boolean' || (!legacy && r.direction !== questions[i].direction))) return null
  let snapshots: QuestionSnapshot[]
  if (raw.version === 4) {
    if (questions.some(q => {
      const snap = q.snapshot
      return !snap || !validateEntry(snap.word) || snap.word.id !== q.wordId || typeof snap.prompt !== 'string' || !snap.prompt.trim() || !['legacy','strict'].includes(snap.rule) || !Array.isArray(snap.acceptedAnswers) || !snap.acceptedAnswers.length || snap.acceptedAnswers.some((a: unknown) => typeof a !== 'string' || !a.trim())
    })) return null
    snapshots = questions.map(q => ({ wordId: q.wordId, direction: q.direction, snapshot: { word: { ...validateEntry(q.snapshot.word)!, id: q.wordId, createdAt: creationTime(q.snapshot.word.createdAt) }, prompt: q.snapshot.prompt, acceptedAnswers: [...q.snapshot.acceptedAnswers], rule: q.snapshot.rule } }))
    if (raw.results.some(r => typeof r.correct !== 'boolean')) return null
    if (raw.phase === 'feedback' ? typeof raw.submittedCorrect !== 'boolean' : raw.submittedCorrect !== null) return null
  } else {
    snapshots = questions.map(q => snapshotQuestion(q, legacyCatalog.some(w => w.id === q.wordId) ? legacyCatalog : catalog, () => 0, 'legacy'))
  }
  const results: TestResult[] = raw.results.map((r, i) => ({ ...snapshots[i], answer: r.answer, known: r.known, correct: raw.version === 4 ? r.correct : questionMatches(r.answer, snapshots[i]), ...(r.answeredAt !== undefined ? {answeredAt: creationTime(r.answeredAt)} : {}), ...(typeof r.activityDate === 'string' ? {activityDate:r.activityDate} : {}) }))
  const submittedCorrect = raw.phase === 'feedback' ? raw.version === 4 ? raw.submittedCorrect as boolean : questionMatches(raw.submittedAnswer, snapshots[Number(raw.index)]) : null

  if (!validSubset(raw.newlyLearnedIds, results.filter(r => r.known).map(r => r.wordId))) return null
  const reviewWordIds = raw.version === 1 ? null : raw.reviewWordIds
  if (reviewWordIds !== null && !validSubset(reviewWordIds, ids)) return null
  let completion: CompletionSnapshot | null = null
  if (!legacy && raw.completion !== null) {
    if (raw.phase !== 'completed' || !raw.completion || typeof raw.completion !== 'object') return null
    const c = raw.completion as CompletionSnapshot
    if (!validSubset(c.needsReviewIds, ids) || !Array.isArray(c.hardest) || c.hardest.length !== Math.min(3, ids.length) || new Set(c.hardest.map(h => h?.wordId)).size !== c.hardest.length) return null
    if (c.hardest.some(h => !h || !questions.some(q => q.wordId === h.wordId && q.direction === h.direction) || !Number.isInteger(h.score) || h.score < 0 || h.score > 100 || !['New','Easy','Medium','Hard','Very Hard'].includes(h.level))) return null
    completion = c
  }
  return { version: 4, ...(typeof raw.syncId === 'string' ? {syncId:raw.syncId} : {}), ...(raw.startedAt !== undefined ? {startedAt:creationTime(raw.startedAt)} : {}), ...(raw.completedAt !== undefined ? {completedAt:creationTime(raw.completedAt)} : {}), mode, questions: snapshots, index: Number(raw.index), phase: raw.phase as TestSession['phase'], draft: raw.draft, submittedAnswer: raw.submittedAnswer, submittedCorrect,
    results, newlyLearnedIds: raw.newlyLearnedIds, reviewWordIds, completion }
}
export function sessionSummary(session: TestSession, _catalog: readonly VocabularyWord[] = words) {
  const correct = (result: TestResult) => result.correct
  const score = session.results.filter(correct).length
  const directionalAccuracy = (direction: TestDirection) => {
    const results = session.results.filter(r => r.direction === direction)
    return results.length ? Math.round(results.filter(correct).length / results.length * 100) : null
  }
  const known = session.results.filter(r => r.known).length
  return { score, total: session.results.length, known, missed: session.results.length - known, newlyLearned: session.newlyLearnedIds.length,
    accuracy: session.results.length ? Math.round(score / session.results.length * 100) : 0,
    englishToTurkishAccuracy: directionalAccuracy('englishToTurkish'), turkishToEnglishAccuracy: directionalAccuracy('turkishToEnglish'),
    reviewWords: session.reviewWordIds === null ? null : session.results.filter(r => session.reviewWordIds!.includes(r.wordId)).length,
    needsReviewIds: session.completion?.needsReviewIds ?? null, hardest: session.completion?.hardest ?? null }
}
