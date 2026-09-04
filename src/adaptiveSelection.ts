import type { VocabularyWord } from './vocabulary.ts'
import { words } from './vocabulary.ts'
import { calculateDifficulty, directionalReviewDue, DAY_MS } from './learningHistory.ts'
import type { LearningHistory, WordLearningHistory } from './learningHistory.ts'
import type { TestDirection, TestMode } from './learningTypes.ts'
export type TestQuestion = { wordId: number; direction: TestDirection }
export function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const old = result[i]; result[i] = result[j]; result[j] = old
  }
  return result
}
export function directionWeight(h: WordLearningHistory, direction: TestDirection, now: number) {
  const s = h[direction]
  if (!s.timesTested) return 70
  return 20 + calculateDifficulty(s, now).score + (directionalReviewDue(h, direction, now) ? 30 : 0)
}
export function chooseDirection(h: WordLearningHistory, mode: TestMode, now: number, random: () => number): TestDirection {
  if (mode !== 'mixed') return mode
  const en = directionWeight(h, 'englishToTurkish', now), tr = directionWeight(h, 'turkishToEnglish', now)
  return random() * (en + tr) < en ? 'englishToTurkish' : 'turkishToEnglish'
}
export function selectionWeight(h: WordLearningHistory, direction: TestDirection, now: number): number {
  const stats = h[direction]
  const age = h.lastTestedAt === null ? Infinity : Math.max(0, now - h.lastTestedAt)
  const recency = age < DAY_MS / 24 ? .25 : age < DAY_MS ? .5 : 1
  return (1 + calculateDifficulty(stats, now).score / 25 + Math.min(stats.timesMissed, 5) / 5) * (directionalReviewDue(h, direction, now) ? 2 : 1) * recency
}
export function selectQuestions(history: LearningHistory, mode: TestMode, now = Date.now(), random = Math.random, previousIds: number[] = [], catalog: readonly VocabularyWord[] = words): TestQuestion[] {
  const candidates = catalog.map(word => ({ wordId: word.id, direction: chooseDirection(history[word.id], mode, now, random) }))
  const weak = candidates.filter(q => { const s = history[q.wordId][q.direction]; return calculateDifficulty(s, now).score > 50 || (s.timesMissed > 0 && s.consecutiveKnown < 2) })
  const missed = candidates.filter(q => history[q.wordId][q.direction].timesMissed > 0)
  const unseen = candidates.filter(q => history[q.wordId][q.direction].timesTested === 0)
  const due = candidates.filter(q => history[q.wordId].learned && directionalReviewDue(history[q.wordId], q.direction, now))
  const selected: TestQuestion[] = []
  function pick(pool: TestQuestion[], uniform = false): TestQuestion {
    const weights = pool.map(q => uniform ? 1 : selectionWeight(history[q.wordId], q.direction, now))
    let value = random() * weights.reduce((sum, weight) => sum + weight, 0)
    let index = 0
    while (index < weights.length - 1 && value >= weights[index]) value -= weights[index++]
    return pool[index]
  }
  function draw(pool: TestQuestion[], count: number, uniform = false) {
    for (let i = 0; i < count && selected.length < 10; i++) {
      const available = pool.filter(q => !selected.some(s => s.wordId === q.wordId))
      if (!available.length) return
      selected.push(pick(available, uniform))
    }
  }
  draw(weak, 3); draw(missed, 2); draw(unseen, 2); draw(due, 2); draw(candidates, 1, true)
  for (const pool of [weak, missed, unseen, due, candidates]) draw(pool, 10 - selected.length)
  const outside = candidates.filter(q => !selected.some(s => s.wordId === q.wordId))
  if (outside.length && selected.length === previousIds.length && selected.every(q => previousIds.includes(q.wordId))) {
    selected[Math.floor(random() * selected.length)] = pick(outside)
  }
  return shuffle(selected, random)
}
