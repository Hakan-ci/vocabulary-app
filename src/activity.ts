import { directions } from './learningTypes.ts'
import type { TestDirection } from './learningTypes.ts'
import type { VocabularyWord } from './vocabulary.ts'
import { sessionSummary } from './dailyTestModel.ts'
import type { TestSession, TestResult } from './dailyTestModel.ts'

export const goals = [5, 10, 15, 20, 25, 30] as const
export type Source = 'daily' | 'review'
export type Counts = { answered: number; correct: number; known: number; missed: number }
export type SourceActivity = { directions: Record<TestDirection, Counts>; completed: number; scoreSum: number; bestScore: number | null }
export type ActivityBucket = Record<Source, SourceActivity>
export type Activity = { startedAt: number; startedDate: string; days: Record<string, ActivityBucket>; undated: ActivityBucket }
export const localDate = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const shiftDate = (key: string, offset: number) => {
  const [y, m, d] = key.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + offset, 12).getTime())
}
export const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDate(value, 0) === value
export const emptyCounts = (): Counts => ({ answered: 0, correct: 0, known: 0, missed: 0 })
export const emptySource = (): SourceActivity => ({ directions: { englishToTurkish: emptyCounts(), turkishToEnglish: emptyCounts() }, completed: 0, scoreSum: 0, bestScore: null })
export const emptyBucket = (): ActivityBucket => ({ daily: emptySource(), review: emptySource() })
export const emptyActivity = (now: number): Activity => ({ startedAt: now, startedDate: localDate(now), days: {}, undated: emptyBucket() })
export function addCounts(a: Counts, b: Counts): Counts {
  return { answered: a.answered + b.answered, correct: a.correct + b.correct, known: a.known + b.known, missed: a.missed + b.missed }
}
export const sourceCounts = (s: SourceActivity) => addCounts(s.directions.englishToTurkish, s.directions.turkishToEnglish)
export const bucketCounts = (b: ActivityBucket) => addCounts(sourceCounts(b.daily), sourceCounts(b.review))
export const accuracy = (c: Counts) => c.answered ? 100 * c.correct / c.answered : null
function addResult(bucket: ActivityBucket, source: Source, result: TestResult, _catalog: readonly VocabularyWord[]): ActivityBucket {
  const s = bucket[source], old = s.directions[result.direction]
  const correct = result.correct
  return { ...bucket, [source]: { ...s, directions: { ...s.directions, [result.direction]: addCounts(old, { answered: 1, correct: Number(correct), known: Number(result.known), missed: Number(!result.known) }) } } }
}
function complete(bucket: ActivityBucket, source: Source, session: TestSession, catalog: readonly VocabularyWord[]): ActivityBucket {
  const s = bucket[source], score = sessionSummary(session, catalog).score
  return { ...bucket, [source]: { ...s, completed: s.completed + 1, scoreSum: s.scoreSum + (source === 'daily' ? score : 0), bestScore: source === 'daily' ? Math.max(s.bestScore ?? 0, score) : null } }
}
export function migrateActivity(daily: TestSession | null, review: TestSession | null, catalog: readonly VocabularyWord[], now: number): Activity {
  const activity = emptyActivity(now)
  for (const [source, session] of [['daily', daily], ['review', review]] as const) {
    if (!session) continue
    for (const result of session.results) activity.undated = addResult(activity.undated, source, result, catalog)
    if (session.phase === 'completed') activity.undated = complete(activity.undated, source, session, catalog)
  }
  return activity
}
export function trackAssessment(activity: Activity, source: Source, before: TestSession, after: TestSession, catalog: readonly VocabularyWord[], now: number): Activity {
  if (before.phase !== 'feedback' || after.results.length !== before.results.length + 1) return activity
  const day = localDate(now)
  let bucket = addResult(activity.days[day] ?? emptyBucket(), source, after.results[after.results.length - 1], catalog)
  if (after.phase === 'completed') bucket = complete(bucket, source, after, catalog)
  return { ...activity, days: { ...activity.days, [day]: bucket } }
}
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
function parseSource(value: unknown, source: Source): SourceActivity {
  if (!value || typeof value !== 'object') return emptySource()
  const s = value as SourceActivity
  if (!s.directions || !count(s.completed) || !count(s.scoreSum)) return emptySource()
  for (const direction of directions) {
    const c = s.directions[direction]
    if (!c || ![c.answered, c.correct, c.known, c.missed].every(count) || c.correct > c.answered || c.known + c.missed !== c.answered) return emptySource()
  }
  if (source === 'review' ? s.scoreSum !== 0 || s.bestScore !== null : s.completed === 0 ? s.scoreSum !== 0 || s.bestScore !== null : !count(s.bestScore) || s.bestScore > 10 || s.scoreSum < s.bestScore || s.scoreSum > s.completed * s.bestScore) return emptySource()
  return { directions: { englishToTurkish: { ...s.directions.englishToTurkish }, turkishToEnglish: { ...s.directions.turkishToEnglish } }, completed: s.completed, scoreSum: s.scoreSum, bestScore: s.bestScore }
}
function parseBucket(value: unknown): ActivityBucket {
  const b = value && typeof value === 'object' ? value as ActivityBucket : emptyBucket()
  return { daily: parseSource(b.daily, 'daily'), review: parseSource(b.review, 'review') }
}
export function parseActivity(value: unknown, now: number): Activity {
  if (!value || typeof value !== 'object') return emptyActivity(now)
  const a = value as Activity
  const validStart = typeof a.startedAt === 'number' && Number.isFinite(a.startedAt) && a.startedAt >= 0 && a.startedAt <= 8640000000000000
  const start = validStart ? a.startedAt : now
  const days: Record<string, ActivityBucket> = {}
  if (a.days && typeof a.days === 'object' && !Array.isArray(a.days)) for (const [day, bucket] of Object.entries(a.days)) if (validDate(day)) days[day] = parseBucket(bucket)
  return { startedAt: start, startedDate: validDate(a.startedDate) ? a.startedDate : localDate(start), days, undated: parseBucket(a.undated) }
}
