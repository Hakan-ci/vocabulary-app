import {directionEligible} from './reviewEligibility.ts'
import {activeRequests} from './aiPractice/learningEvidence.ts'
import type {ReviewRequests} from './aiPractice/learningEvidence.ts'
import type { VocabularyWord } from './vocabulary.ts'
import { directions } from './learningTypes.ts'
import type { TestDirection } from './learningTypes.ts'
import { calculateDifficulty, DAY_MS, latestWasMissed, reviewIntervalDays } from './learningHistory.ts'
import type { LearningHistory, WordLearningHistory } from './learningHistory.ts'
import { assessAnswer, parseSession, snapshotQuestion } from './dailyTestModel.ts'
import type { TestSession } from './dailyTestModel.ts'

export type ReviewDirection = { direction: TestDirection; deadline: number | null; missed: boolean; migrated: boolean; due: boolean; difficulty: number; requested:boolean }
export type ReviewGroup = 'Needs Review' | 'Overdue' | 'Due today' | 'Next scheduled reviews'
export type ReviewEntry = { word: VocabularyWord; directions: ReviewDirection[]; selected: ReviewDirection; group: ReviewGroup }
export type ReviewSession = { version: 2; practice: TestSession }

export function reviewDeadline(h: WordLearningHistory, direction: TestDirection): number | null {
  const s = h[direction]
  if (latestWasMissed(s)) return s.lastTestedAt
  if (direction === 'englishToTurkish' && h.legacyReviewPending && h.learned) return null
  return s.lastKnownAt === null ? null : s.lastKnownAt + reviewIntervalDays(s.consecutiveKnown) * DAY_MS
}
export function reviewQueue(catalog: readonly VocabularyWord[], history: LearningHistory, now: number, requests:ReviewRequests={}): ReviewEntry[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const entries: ReviewEntry[] = []
  for (const word of catalog) {
    const h = history[word.id]
    const scheduled = directions.flatMap(direction => {
      const migrated = direction === 'englishToTurkish' && h.legacyReviewPending && h.learned
      const explicit=activeRequests(requests,word.id,direction)
      const normal=reviewDeadline(h,direction)
      const deadline=explicit.length?Math.min(normal??Infinity,...explicit.map(r=>r.requestedAt)):normal
      if (deadline === null && !migrated) return []
      return [{ direction, deadline, migrated, missed: latestWasMissed(h[direction]), requested:explicit.length>0, due: directionEligible(word.id,h,direction,now,requests), difficulty: calculateDifficulty(h[direction], now).score }]
    })
    if (!scheduled.length) continue
    const due = scheduled.filter(d => d.due)
    const relevant = due.length ? due : scheduled
    const selected = [...relevant].sort((a, b) => due.length
      ? Number(b.missed) - Number(a.missed) || b.difficulty - a.difficulty || (a.deadline ?? 0) - (b.deadline ?? 0) || directions.indexOf(a.direction) - directions.indexOf(b.direction)
      : (a.deadline ?? 0) - (b.deadline ?? 0) || directions.indexOf(a.direction) - directions.indexOf(b.direction))[0]
    const group: ReviewGroup = !due.length ? 'Next scheduled reviews' : due.some(d => d.missed || d.migrated || d.requested) ? 'Needs Review' : Math.min(...due.map(d => d.deadline!)) < today.getTime() ? 'Overdue' : 'Due today'
    entries.push({ word, directions: relevant, selected, group })
  }
  return entries.sort((a, b) => {
    const priority = (entry: ReviewEntry) => entry.directions.some(d => d.missed) ? 0 : entry.directions.some(d => d.migrated) ? 1 : entry.selected.due ? 2 : 3
    return priority(a) - priority(b) || (a.selected.deadline ?? 0) - (b.selected.deadline ?? 0) || b.selected.difficulty - a.selected.difficulty || a.word.id - b.word.id
  })
}
export function createReviewSession(catalog: readonly VocabularyWord[], history: LearningHistory, now: number, random = Math.random, requests:ReviewRequests={}): ReviewSession | null {
  const questions = reviewQueue(catalog, history, now,requests).filter(entry => entry.selected.due).map(entry => ({ wordId: entry.word.id, direction: entry.selected.direction })).map(q => snapshotQuestion(q, catalog, random))
  if (!questions.length) return null
  return { version: 2, practice: { version: 4, syncId: crypto.randomUUID(), startedAt: now, completedAt: null, mode: 'mixed', questions, reviewWordIds: questions.map(q => q.wordId), index: 0, phase: 'answering', draft: '', submittedAnswer: '', submittedCorrect: null, results: [], newlyLearnedIds: [], completion: null } }
}
export function parseReviewSession(value: unknown, catalog: readonly VocabularyWord[], legacyCatalog: readonly VocabularyWord[] = catalog, deletedIds: readonly number[] = []): ReviewSession | null {
  if (!value || typeof value !== 'object' || ![1, 2].includes((value as ReviewSession).version)) return null
  const raw = (value as ReviewSession).practice
  if (!raw || ![3,4].includes(raw.version) || raw.mode !== 'mixed') return null
  const practice = parseSession(raw, catalog, true, legacyCatalog, deletedIds)
  if (!practice || (practice.phase === 'completed' && !practice.completion)) return null
  return { version: 2, practice }
}
export function assessReview(session: ReviewSession, history: LearningHistory, known: boolean, now: number) {
  const next = assessAnswer(session.practice, history, known, now)
  return { reviewSession: { ...session, practice: next.session }, history: next.history }
}
