import type { VocabularyWord } from './vocabulary.ts'
import { words } from './vocabulary.ts'
import { directions } from './learningTypes.ts'
import type { DirectionalStatistics, TestDirection, Difficulty, DifficultyLevel } from './learningTypes.ts'
export type { DirectionalStatistics, TestDirection, TestMode } from './learningTypes.ts'

export type WordLearningHistory = DirectionalStatistics & {
  learned: boolean
  englishToTurkish: DirectionalStatistics
  turkishToEnglish: DirectionalStatistics
  // Membership imported before attempts were recorded is due in the original direction.
  legacyReviewPending: boolean
}
export type LearningHistory = Record<number, WordLearningHistory>
export type LearningStatus = 'New' | 'Learning' | 'Learned' | 'Needs Review'
export const DAY_MS = 24 * 60 * 60 * 1000
export const emptyStatistics = (): DirectionalStatistics => ({ timesTested: 0, timesKnown: 0, timesMissed: 0, consecutiveKnown: 0, lastTestedAt: null, lastKnownAt: null })
export const emptyWordHistory = (learned = false): WordLearningHistory => ({ ...emptyStatistics(), learned, englishToTurkish: emptyStatistics(), turkishToEnglish: emptyStatistics(), legacyReviewPending: learned })
export const emptyHistory = (catalog: readonly VocabularyWord[] = words): LearningHistory => Object.fromEntries(catalog.map(word => [word.id, emptyWordHistory()]))
export const learnedIds = (history: LearningHistory, catalog: readonly VocabularyWord[] = words) => catalog.filter(word => history[word.id]?.learned).map(word => word.id)
export const latestWasMissed = (s: DirectionalStatistics) => s.timesMissed > 0 && s.consecutiveKnown === 0
export const reviewIntervalDays = (streak: number) => streak >= 4 ? 14 : streak === 3 ? 7 : streak === 2 ? 3 : 1
export function difficultyLevel(score: number): Exclude<DifficultyLevel, 'New'> {
  return score <= 25 ? 'Easy' : score <= 50 ? 'Medium' : score <= 75 ? 'Hard' : 'Very Hard'
}
export function calculateDifficulty(s: DirectionalStatistics, now: number): Difficulty {
  if (!s.timesTested) return { score: 0, level: 'New' }
  const age = Math.max(0, now - (s.lastTestedAt ?? now))
  const bonus = latestWasMissed(s) ? 15 * Math.max(0, 1 - age / (7 * DAY_MS)) : 0
  const score = Math.round(Math.max(0, Math.min(100, 100 * s.timesMissed / s.timesTested + bonus - Math.min(25, 5 * s.consecutiveKnown))))
  return { score, level: difficultyLevel(score) }
}
export function directionalReviewDue(h: WordLearningHistory, direction: TestDirection, now: number): boolean {
  const s = h[direction]
  if (latestWasMissed(s)) return true
  if (direction === 'englishToTurkish' && h.legacyReviewPending && h.learned) return true
  return s.lastKnownAt !== null && now >= s.lastKnownAt + reviewIntervalDays(s.consecutiveKnown) * DAY_MS
}
export const isReviewDue = (h: WordLearningHistory, now: number) => directions.some(d => directionalReviewDue(h, d, now))
export function calculatedWord(h: WordLearningHistory, now: number) {
  return { difficulty: calculateDifficulty(h, now), needsReview: isReviewDue(h, now),
    englishToTurkish: calculateDifficulty(h.englishToTurkish, now), turkishToEnglish: calculateDifficulty(h.turkishToEnglish, now) }
}
export function learningStatus(h: WordLearningHistory, now: number): LearningStatus {
  if (isReviewDue(h, now)) return 'Needs Review'
  if (h.learned) return 'Learned'
  return h.timesTested ? 'Learning' : 'New'
}
function updateStatistics(s: DirectionalStatistics, known: boolean, now: number): DirectionalStatistics {
  // A system-clock adjustment must not produce timestamps that invalidate saved history.
  const at = Math.max(now, s.lastTestedAt ?? 0)
  return { timesTested: s.timesTested + 1, timesKnown: s.timesKnown + Number(known), timesMissed: s.timesMissed + Number(!known),
    consecutiveKnown: known ? s.consecutiveKnown + 1 : 0, lastTestedAt: at, lastKnownAt: known ? at : s.lastKnownAt }
}
export function recordAssessment(h: WordLearningHistory, known: boolean, now: number, direction: TestDirection = 'englishToTurkish'): WordLearningHistory {
  const at = Math.max(now, h.lastTestedAt ?? 0)
  return { ...h, ...updateStatistics(h, known, at), [direction]: updateStatistics(h[direction], known, at),
    learned: known || h.learned, legacyReviewPending: direction === 'englishToTurkish' ? false : h.legacyReviewPending }
}
export function removeFromLearned(history: LearningHistory, id: number): LearningHistory {
  return history[id] ? { ...history, [id]: { ...history[id], learned: false } } : history
}
const counter = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const timestamp = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
export function parseStatistics(value: unknown): DirectionalStatistics | null {
  if (!value || typeof value !== 'object') return null
  const s = value as DirectionalStatistics
  if (![s.timesTested, s.timesKnown, s.timesMissed, s.consecutiveKnown].every(counter) ||
    s.timesTested !== s.timesKnown + s.timesMissed || s.consecutiveKnown > s.timesKnown ||
    !timestamp(s.lastTestedAt) || !timestamp(s.lastKnownAt)) return null
  if (s.timesTested === 0 ? s.lastTestedAt !== null : s.lastTestedAt === null) return null
  if (s.timesKnown === 0 ? s.lastKnownAt !== null : s.lastKnownAt === null) return null
  if (s.lastKnownAt !== null && (s.lastTestedAt === null || s.lastKnownAt > s.lastTestedAt)) return null
  if (s.timesTested > 0 && !s.timesMissed && s.consecutiveKnown !== s.timesKnown) return null
  return { timesTested: s.timesTested, timesKnown: s.timesKnown, timesMissed: s.timesMissed, consecutiveKnown: s.consecutiveKnown, lastTestedAt: s.lastTestedAt, lastKnownAt: s.lastKnownAt }
}
export function parseWordHistory(value: unknown, legacy = false): WordLearningHistory | null {
  const aggregate = parseStatistics(value)
  if (!aggregate || !value || typeof value !== 'object') return null
  const h = value as WordLearningHistory
  if (typeof h.learned !== 'boolean') return null
  if (legacy) return { ...aggregate, learned: h.learned, englishToTurkish: { ...aggregate }, turkishToEnglish: emptyStatistics(), legacyReviewPending: h.learned && !aggregate.timesTested }
  const en = parseStatistics(h.englishToTurkish), tr = parseStatistics(h.turkishToEnglish)
  if (!en || !tr || typeof h.legacyReviewPending !== 'boolean') return null
  if ((['timesTested', 'timesKnown', 'timesMissed'] as const).some(k => aggregate[k] !== en[k] + tr[k])) return null
  if (aggregate.lastTestedAt !== Math.max(en.lastTestedAt ?? 0, tr.lastTestedAt ?? 0) && aggregate.timesTested > 0) return null
  if (aggregate.lastKnownAt !== Math.max(en.lastKnownAt ?? 0, tr.lastKnownAt ?? 0) && aggregate.timesKnown > 0) return null
  if (h.legacyReviewPending && en.timesTested > 0) return null
  return { ...aggregate, learned: h.learned, englishToTurkish: en, turkishToEnglish: tr, legacyReviewPending: h.legacyReviewPending }
}
export function parseHistory(value: unknown, legacy = false, catalog: readonly VocabularyWord[] = words): LearningHistory {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<number, unknown> : {}
  return Object.fromEntries(catalog.map(word => [word.id, parseWordHistory(source[word.id], legacy) ?? emptyWordHistory()]))
}
