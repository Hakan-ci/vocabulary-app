import {reviewEligible} from './reviewEligibility.ts'
import type {ReviewRequests} from './aiPractice/learningEvidence.ts'
import type { VocabularyWord } from './vocabulary.ts'
import type { LearningHistory } from './learningHistory.ts'
import { calculateDifficulty, calculatedWord, learningStatus } from './learningHistory.ts'
import { directions, modeLabels } from './learningTypes.ts'
import { reviewDeadline } from './reviewModel.ts'
import { accuracy, addCounts, bucketCounts, emptyBucket, emptyCounts, localDate, shiftDate, sourceCounts } from './activity.ts'
import type { Activity, Source } from './activity.ts'
export const percentage = (count: number, total: number) => total ? Math.round(count / total * 100) : 0
export function studyStreak(activity: Activity, today: string) {
  const days = Object.keys(activity.days).filter(day => day <= today && activity.days[day].daily.completed + activity.days[day].review.completed > 0).sort()
  let best = 0, run = 0, previous: string | null = null
  for (const day of days) { run = previous && shiftDate(previous, 1) === day ? run + 1 : 1; best = Math.max(best, run); previous = day }
  const last = days.at(-1) ?? null
  return { current: last === today || last === shiftDate(today, -1) ? run : 0, best, last }
}
export function dashboard(catalog: readonly VocabularyWord[], history: LearningHistory, favorites: number[], activity: Activity, now: number, requests:ReviewRequests={}) {
  const today = localDate(now)
  const rows = catalog.map(word => {
    const h = history[word.id], calculated = calculatedWord(h, now)
    const deadlines = directions.map(direction => reviewDeadline(h, direction)).filter((d): d is number => d !== null && Number.isFinite(new Date(d).getTime()))
    return { word, history: h, ...calculated, needsReview:reviewEligible(word.id,h,now,requests), status: reviewEligible(word.id,h,now,requests)?'Needs Review':learningStatus(h, now), overdue: deadlines.some(d => localDate(d) < today), scheduledToday: deadlines.some(d => localDate(d) === today) }
  })
  const buckets = [activity.undated, ...Object.values(activity.days)]
  const totalSource = (source: Source) => buckets.reduce((sum, b) => addCounts(sum, sourceCounts(b[source])), emptyCounts())
  const completed = buckets.reduce((sum,b) => sum + b.daily.completed, 0)
  const scoreSum = buckets.reduce((sum,b) => sum + b.daily.scoreSum, 0)
  const scores = buckets.flatMap(b => b.daily.bestScore === null ? [] : [b.daily.bestScore])
  const directional = directions.map(direction => {
    const tested = rows.filter(row => row.history[direction].timesTested > 0)
    const counts = buckets.reduce((sum, b) => addCounts(sum, addCounts(b.daily.directions[direction], b.review.directions[direction])), emptyCounts())
    return { direction, answered: rows.reduce((sum,row) => sum + row.history[direction].timesTested, 0), accuracy: accuracy(counts), recorded: counts.answered,
      difficulty: tested.length ? tested.reduce((sum,row) => sum + calculateDifficulty(row.history[direction], now).score, 0) / tested.length : null }
  })
  const strength = directional.map(d => d.accuracy === null || d.difficulty === null ? null : .5 * (100 - d.accuracy) + .5 * d.difficulty)
  const weaker = strength[0] === null || strength[1] === null ? 'Not enough data' : strength[0] === strength[1] ? 'Balanced' : modeLabels[directions[strength[0] > strength[1] ? 0 : 1]]
  const hardest = rows.filter(row => row.history.timesTested > 0).sort((a,b) => b.difficulty.score - a.difficulty.score || b.history.timesMissed - a.history.timesMissed || a.word.id - b.word.id).slice(0,10)
  const attention = rows.filter(row => row.needsReview || row.difficulty.score > 50 || row.history.timesMissed >= 2).sort((a,b) => Number(b.needsReview) - Number(a.needsReview) || Number(b.overdue) - Number(a.overdue) || b.difficulty.score - a.difficulty.score || b.history.timesMissed - a.history.timesMissed || a.word.id - b.word.id).slice(0,10)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(today, i - 6), bucket = activity.days[date]
    const available = date >= activity.startedDate || !!bucket
    const counts = bucketCounts(bucket ?? emptyBucket())
    return { date, available, ...counts, accuracy: available ? accuracy(counts) : null }
  })
  return { total: catalog.length, newWords: rows.filter(r => !r.history.timesTested && !r.history.learned).length,
    learning: rows.filter(r => r.history.timesTested > 0 && !r.history.learned).length, learned: rows.filter(r => r.history.learned).length,
    needsReview: rows.filter(r => r.needsReview).length, favorites: catalog.filter(w => favorites.includes(w.id)).length, scheduledToday: rows.filter(r => r.scheduledToday).length,
    daily: { ...totalSource('daily'), completed, accuracy: accuracy(totalSource('daily')), average: completed ? scoreSum / completed : null, best: scores.length ? Math.max(...scores) : null },
    directional, weaker, hardest, attention, days, today: bucketCounts(activity.days[today] ?? emptyBucket()).answered, streak: studyStreak(activity, today) }
}
export type Dashboard = ReturnType<typeof dashboard>
