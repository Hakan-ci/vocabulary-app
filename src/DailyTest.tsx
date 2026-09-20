import type {ReviewRequests} from './aiPractice/learningEvidence'
import type {LearningHistory} from './learningHistory'
import { primaryMeaning } from './wordFields'
import { useEffect, useRef } from 'react'
import type { VocabularyWord } from './vocabulary'
import { sessionSummary, questionContent } from './dailyTestModel'
import type { TestSession } from './dailyTestModel'
import { modeLabels } from './learningTypes'
import type { TestMode } from './learningTypes'
import { PracticeQuestion } from './PracticeQuestion'
import { DirectionSetting } from './DirectionSetting'
import { AutoPronunciationSetting } from './Pronunciation'

type Props = { requests?:ReviewRequests;
  history: LearningHistory
  now: number
  catalog: readonly VocabularyWord[]
  mode: TestMode
  onModeChange: (mode: TestMode) => void
  autoPronunciation: boolean
  onAutoPronunciationChange: (value: boolean) => void
  session: TestSession | null
  onStart: () => void
  draftScope: string
  onSubmit: (answer: string, identity: string) => boolean
  onAssess: (known: boolean) => void
  onLearned: () => void
  onPracticeAI: () => void
}

export function DailyTest({ requests, history, now, catalog, mode, onModeChange, autoPronunciation, onAutoPronunciationChange, session, onStart, draftScope, onSubmit, onAssess, onLearned, onPracticeAI }: Props) {
  const summaryRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (session?.phase === 'completed') summaryRef.current?.focus()
  }, [session?.phase, session?.index])

  if (!session) return <section className="test-panel test-intro">
    <span className="test-emblem" aria-hidden="true">✧</span>
    <div className="eyebrow">A LITTLE PRACTICE, EVERY DAY</div>
    <h2>Ten words. One small step forward.</h2>
    <p>Practice in either direction, then decide how well you knew each word.</p>
    <div className="test-details"><span>10 words</span><span>Practice tailored to you</span><span>Progress saved as you go</span></div>
    <DirectionSetting mode={mode} onChange={onModeChange} />
    <AutoPronunciationSetting checked={autoPronunciation} onChange={onAutoPronunciationChange} compact />
    <button className="primary-button" onClick={onStart}>Start test →</button>
    <p className="test-hint">Practice as often as you like. Missed words, new discoveries, and timely reviews keep your learning moving.</p>
  </section>

  if (session.phase === 'completed') {
    const summary = sessionSummary(session, catalog)
    return <section className="test-panel">
      <div className="eyebrow">10 / 10 · TEST COMPLETE</div>
      <h2 ref={summaryRef} tabIndex={-1}>A little more confident.</h2>
      <p>Here’s how you rated your words in this test.</p>
      <p className="test-mode-label">{modeLabels[session.mode]}</p>
      <div className="test-stats directional-stats">
        <div><strong>{summary.score} / {summary.total}</strong><span>Score</span></div>
        <div><strong>{summary.accuracy}%</strong><span>Accuracy</span></div>
        <div><strong>{summary.englishToTurkishAccuracy === null ? '—' : `${summary.englishToTurkishAccuracy}%`}</strong><span>EN→TR accuracy</span></div>
        <div><strong>{summary.turkishToEnglishAccuracy === null ? '—' : `${summary.turkishToEnglishAccuracy}%`}</strong><span>TR→EN accuracy</span></div>
        <div><strong>{summary.newlyLearned}</strong><span>Newly learned</span></div>
        <div><strong>{summary.needsReviewIds?.length ?? '—'}</strong><span>Needing review</span></div>
      </div>
      <p className="summary-secondary">{summary.known} Known · {summary.missed} Didn’t know · {summary.reviewWords ?? '—'} Review words</p>
      <p className="test-hint">Score and accuracy measure typed answers. Learning progress follows your self-assessment.</p>
      {summary.reviewWords === null && <p className="test-hint">Review counts weren’t recorded for this older test.</p>}
      <h3>Words learned during this test</h3>
      {session.newlyLearnedIds.length ? <ul className="learned-summary">{session.newlyLearnedIds.map(id => {
        const word = session.questions.find(q => q.wordId === id)!.snapshot.word
        return <li key={id}><strong>{word.english}{!catalog.some(w=>w.id===id) && <small> · Deleted</small>}</strong><span lang="tr">{primaryMeaning(word)}</span></li>
      })}</ul> : <p className="test-hint">No new words added this time. Every practice session helps.</p>}
      <h3 className="summary-section-title">Words needing review</h3>
      {summary.needsReviewIds === null ? <p className="test-hint">Review status wasn’t recorded when this older test finished.</p> : summary.needsReviewIds.length ? <ul className="learned-summary">{summary.needsReviewIds.map(id => {
        const word = session.questions.find(q => q.wordId === id)!.snapshot.word
        return <li key={id}><strong>{word.english}{!catalog.some(w=>w.id===id) && <small> · Deleted</small>}</strong><span lang="tr">{primaryMeaning(word)}</span></li>
      })}</ul> : <p className="test-hint">None of these words needed review at completion.</p>}
      <h3 className="summary-section-title">Hardest words in this test</h3>
      {summary.hardest === null ? <p className="test-hint">Difficulty wasn’t recorded when this older test finished.</p> : <ul className="learned-summary hardest-summary">{summary.hardest.map(entry => {
        const content = questionContent(session.questions.find(q => q.wordId === entry.wordId)!, catalog)
        return <li key={entry.wordId}><div><strong lang={content.sourceLang}>{content.prompt}{!catalog.some(w=>w.id===entry.wordId) && <small> · Deleted</small>}</strong><small>{modeLabels[entry.direction]}</small></div><span>{entry.level} · {entry.score}/100</span></li>
      })}</ul>}
      <DirectionSetting mode={mode} onChange={onModeChange} />
      <AutoPronunciationSetting checked={autoPronunciation} onChange={onAutoPronunciationChange} compact />
      <div className="test-actions"><button className="primary-button" onClick={onStart}>Start another test</button><button className="secondary-button" onClick={onLearned}>View Learned</button><button className="secondary-button" onClick={onPracticeAI}>Practice with AI</button></div>
    </section>
  }

  return <PracticeQuestion requests={requests} history={history} now={now} catalog={catalog} session={session} label="Daily Test" autoPronunciation={autoPronunciation} draftScope={draftScope} onSubmit={onSubmit} onAssess={onAssess} />
}
