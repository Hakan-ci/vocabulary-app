import { calculatedWord } from './learningHistory'
import type { WordLearningHistory, LearningStatus } from './learningHistory'
export function WordDifficulty({ history, now, status }: { history: WordLearningHistory; now: number; status: LearningStatus }) {
  const calculated = calculatedWord(history, now)
  const difficulty = calculated.difficulty
  return <div className="word-difficulty">
    <div className="learning-status-row">
      <span className={`learning-status difficulty-${difficulty.level.toLowerCase().replaceAll(' ', '-')}`} title={difficulty.level === 'New' ? 'Not tested yet' : `Difficulty: ${difficulty.score} / 100`}>{difficulty.level}</span>
      {calculated.needsReview ? <span className="learning-status status-needs-review">Needs Review</span> : status !== 'New' && <span className={`learning-status status-${status.toLowerCase()}`}>{status}</span>}
    </div>
    <div className="directional-difficulty" aria-label="Difficulty by direction">
      <span title={`English to Turkish: ${calculated.englishToTurkish.score} / 100`}>EN→TR <strong>{calculated.englishToTurkish.level}</strong></span>
      <span title={`Turkish to English: ${calculated.turkishToEnglish.score} / 100`}>TR→EN <strong>{calculated.turkishToEnglish.level}</strong></span>
    </div>
  </div>
}
