import { emptyActivity, migrateActivity, parseActivity, trackAssessment, goals } from './activity.ts'
import type { Activity } from './activity.ts'
import { parseReviewSession, assessReview } from './reviewModel.ts'
import type { ReviewSession } from './reviewModel.ts'
import { words } from './vocabulary.ts'
import type { VocabularyWord } from './vocabulary.ts'
import { assessAnswer, parseSession, sanitizeIds } from './dailyTestModel.ts'
import type { TestSession } from './dailyTestModel.ts'
import { emptyHistory, parseHistory } from './learningHistory.ts'
import type { LearningHistory } from './learningHistory.ts'
import { isTestMode } from './learningTypes.ts'
import type { TestMode } from './learningTypes.ts'

export type StoredPractice = {source:'daily'|'review';practice:TestSession;archivedAt?:number}
export type LearningState = { version: 5; sessions?:Record<string,StoredPractice>; preferredMode: TestMode; history: LearningHistory; session: TestSession | null; reviewSession: ReviewSession | null; dailyGoal: number; activity: Activity }
export const LEARNING_STATE_KEY = 'kelime-learning-state'
export const emptyLearningState = (catalog: readonly VocabularyWord[] = words, now = Date.now()): LearningState => ({ version: 5, preferredMode: 'englishToTurkish', history: emptyHistory(catalog), session: null, reviewSession: null, dailyGoal: 10, activity: emptyActivity(now) })

export function parseLearningState(value: unknown, catalog: readonly VocabularyWord[] = words, now = Date.now(), legacyCatalog: readonly VocabularyWord[] = catalog, deletedIds: readonly number[] = []): LearningState {
  if (!value || typeof value !== 'object' || ![1, 2, 3, 4, 5].includes(Number((value as LearningState).version))) return emptyLearningState(catalog, now)
  const state = value as LearningState
  const session = parseSession(state.session, catalog, false, legacyCatalog, deletedIds)
  const reviewSession = Number(state.version) >= 3 ? parseReviewSession(state.reviewSession, catalog, legacyCatalog, deletedIds) : null
  const sessions:Record<string,StoredPractice>={}
  for(const [id,record] of Object.entries(state.sessions??{})) {
    if(!record||!['daily','review'].includes(record.source)||record.practice?.syncId!==id)continue
    const archived=typeof record.archivedAt==='number'&&Number.isFinite(record.archivedAt)
    const deleted=archived?(Array.isArray(record.practice.questions)?record.practice.questions:[]).filter(q=>deletedIds.includes(q.wordId)).map(q=>q.snapshot?.word).filter(Boolean):[]
    const practice=parseSession(record.practice,[...catalog,...deleted],record.source==='review',legacyCatalog,deletedIds)
    if(practice)sessions[id]={source:record.source,practice,...(archived?{archivedAt:record.archivedAt}:{})}
  }
  return { version: 5, ...(state.sessions?{sessions}:{}), preferredMode: isTestMode(state.preferredMode) ? state.preferredMode : 'englishToTurkish', history: parseHistory(state.history, Number(state.version) === 1, catalog), session, reviewSession,
    dailyGoal: goals.some(goal => goal === state.dailyGoal) ? state.dailyGoal : 10,
    activity: Number(state.version) >= 4 ? parseActivity(state.activity, now) : migrateActivity(session, reviewSession?.practice ?? null, catalog, now) }

}
function parseJson(raw: string | null): unknown {
  try { return raw === null ? null : JSON.parse(raw) }
  catch { return null }
}

// Idempotent migration: presence of the new key takes precedence, even if corrupt.
// No historical attempts or dates can be reconstructed from legacy membership.
export function loadLearningState(storage: Pick<Storage, 'getItem' | 'setItem'>, catalog: readonly VocabularyWord[] = words, now = Date.now(), legacyCatalog: readonly VocabularyWord[] = catalog, deletedIds: readonly number[] = []): { value: LearningState; error: boolean } {
  let value = emptyLearningState(catalog, now)
  try {
    const existing = storage.getItem(LEARNING_STATE_KEY)
    if (existing !== null) {
      const raw = parseJson(existing)
      value = parseLearningState(raw, catalog, now, legacyCatalog, deletedIds)
      if (raw && typeof raw === 'object' && [1, 2, 3, 4].includes(Number((raw as { version?: number }).version))) storage.setItem(LEARNING_STATE_KEY, JSON.stringify(value))
      return { value, error: false }
    }
    for (const id of sanitizeIds(parseJson(storage.getItem('kelime-learned')), catalog)) { value.history[id].learned = true; value.history[id].legacyReviewPending = true }
    value.session = parseSession(parseJson(storage.getItem('kelime-daily-test')), catalog, false, legacyCatalog, deletedIds)
    value.activity = migrateActivity(value.session, null, catalog, now)
    storage.setItem(LEARNING_STATE_KEY, JSON.stringify(value))
    return { value, error: false }
  } catch { return { value, error: true } }
}
export function loadBrowserLearningState(catalog: readonly VocabularyWord[] = words, legacyCatalog: readonly VocabularyWord[] = catalog, deletedIds: readonly number[] = []) {
  try { return loadLearningState(localStorage, catalog, Date.now(), legacyCatalog, deletedIds) }
  catch { return { value: emptyLearningState(catalog), error: true } }
}
export function assessLearningState(state: LearningState, known: boolean, now = Date.now(), catalog: readonly VocabularyWord[] = words): LearningState {
  if (state.session?.phase !== 'feedback') return state
  const next = assessAnswer(state.session, state.history, known, now)
  return { ...state, ...next, activity: trackAssessment(state.activity, 'daily', state.session, next.session, catalog, now) }
}

export function assessReviewState(state: LearningState, known: boolean, now = Date.now(), catalog: readonly VocabularyWord[] = words): LearningState {
  if (state.reviewSession?.practice.phase !== 'feedback') return state
  const next = assessReview(state.reviewSession, state.history, known, now)
  return { ...state, ...next, activity: trackAssessment(state.activity, 'review', state.reviewSession.practice, next.reviewSession.practice, catalog, now) }
}
