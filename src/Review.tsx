import { WordTags } from './WordTags'
import { primaryMeaning } from './wordFields'
import { useEffect, useRef, useState } from 'react'
import type { VocabularyWord } from './vocabulary'
import type { ReviewEntry, ReviewGroup, ReviewSession } from './reviewModel'
import { sessionSummary } from './dailyTestModel'
import { modeLabels } from './learningTypes'
import { PracticeQuestion } from './PracticeQuestion'

type Props = { catalog: readonly VocabularyWord[]; queue: ReviewEntry[]; session: ReviewSession | null; onStart: () => void; onDraft: (draft: string) => void; onSubmit: () => void; onAssess: (known: boolean) => void }
const groups: ReviewGroup[] = ['Needs Review', 'Overdue', 'Due today', 'Next scheduled reviews']
export function Review({ catalog, queue, session, onStart, onDraft, onSubmit, onAssess }: Props) {
  const [showPractice, setShowPractice] = useState(true)
  const summaryRef = useRef<HTMLHeadingElement>(null)
  const practice = session?.practice
  const active = practice && practice.phase !== 'completed'
  const dueCount = queue.filter(entry => entry.selected.due).length
  useEffect(() => { if (practice?.phase === 'completed') summaryRef.current?.focus() }, [practice?.phase])
  if (active && showPractice) return <div className="review-page">
    <button className="secondary-button review-back" onClick={() => setShowPractice(false)}>Back to queue</button>
    <PracticeQuestion catalog={catalog} session={practice} label="Review" onDraft={onDraft} onSubmit={onSubmit} onAssess={onAssess} />
  </div>
  const summary = practice?.phase === 'completed' ? sessionSummary(practice, catalog) : null
  const pairs = (ids: number[]) => <ul className="learned-summary">{ids.map(id => {
    const word = practice!.questions.find(q => q.wordId === id)!.snapshot.word
    return <li key={id}><strong lang="en">{word.english}{!catalog.some(w=>w.id===id) && <small> · Deleted</small>}</strong><span lang="tr">{primaryMeaning(word)}</span></li>
  })}</ul>
  return <div className="review-page">
    {summary && practice && <section className="test-panel review-summary" aria-label="Review summary">
      <div className="eyebrow">{summary.total} / {summary.total} · REVIEW COMPLETE</div>
      <h2 ref={summaryRef} tabIndex={-1}>A little stronger, word by word.</h2>
      <div className="test-stats directional-stats">
        <div><strong>{summary.total}</strong><span>Reviewed words</span></div>
        <div><strong>{summary.known}</strong><span>Known</span></div>
        <div><strong>{summary.missed}</strong><span>Missed</span></div>
        <div><strong>{summary.accuracy}%</strong><span>Accuracy</span></div>
        <div><strong>{summary.needsReviewIds!.length}</strong><span>Still needing review</span></div>
      </div>
      <p className="test-hint">Accuracy measures typed answers. Known and Missed follow your self-assessment. These results reflect the moment you finished.</p>
      <h3>Reviewed words</h3>{pairs(practice.results.map(r => r.wordId))}
      <h3 className="summary-section-title">Words still needing review</h3>
      {summary.needsReviewIds!.length ? pairs(summary.needsReviewIds!) : <p className="test-hint">None of these words needed review at completion.</p>}
    </section>}
    <section className="test-panel review-intro" aria-label="Review queue">
      <div className="section-heading"><div><h2>Your review queue <span>{dueCount}</span></h2><p>Revisit words when they’re ready. Missed words come first.</p></div>
        {active ? <button className="primary-button" onClick={() => setShowPractice(true)}>Resume Review ({practice.index + 1} / {practice.questions.length})</button>
          : <button className="primary-button" disabled={!dueCount} onClick={() => { onStart(); setShowPractice(true) }}>Start Review</button>}
      </div>
      {!dueCount && <p className="review-empty" role="status">You’re up to date. New reviews will appear when their scheduled time arrives.</p>}
      <p className="test-hint">Each session covers the words due at its start, once each in their weaker due direction. Missed words remain ready for your next session.</p>
    </section>
    {groups.map(group => {
      const entries = queue.filter(entry => entry.group === group)
      return <section className="review-group" key={group} aria-label={group}>
        <h3>{group} <span>{entries.length}</span></h3>
        {entries.length ? <div className="word-grid">{entries.map(entry => <article className="word-card review-card" key={entry.word.id}>
          <div className="card-top"><WordTags tags={entry.word.tags} /></div>
          <h3 lang="en">{entry.word.english}</h3><p className="word-translation" lang="tr">{primaryMeaning(entry.word)}</p>
          <ul className="review-schedules">{entry.directions.map(item => <li key={item.direction}><strong>{modeLabels[item.direction]}</strong><span>{item.migrated ? 'Ready for review' : item.missed ? 'Missed · Ready now' : 'Scheduled review'}</span>{item.deadline !== null && <time dateTime={new Date(item.deadline).toISOString()}>{new Date(item.deadline).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}</li>)}</ul>
        </article>)}</div> : <p className="test-hint">{group === 'Next scheduled reviews' ? 'No upcoming reviews scheduled yet.' : 'No words in this group.'}</p>}
      </section>
    })}
  </div>
}
