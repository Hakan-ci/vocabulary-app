import {calculateDifficulty, directionalReviewDue, emptyWordHistory} from './learningHistory'
import type {LearningHistory} from './learningHistory'
import { useEffect, useRef, useState } from 'react'
import type { VocabularyWord } from './vocabulary'
import { questionContent } from './dailyTestModel'
import type { TestSession } from './dailyTestModel'
import { modeLabels } from './learningTypes'
import { PronunciationButton } from './Pronunciation'
import { usePronunciation } from './pronunciationContext'

type Props = { history:LearningHistory; now:number; catalog: readonly VocabularyWord[]; session: TestSession; label: 'Daily Test' | 'Review'; autoPronunciation:boolean; onDraft: (draft: string) => void; onSubmit: () => void; onAssess: (known: boolean) => void }
export function PracticeQuestion({ history, now, catalog, session, label, autoPronunciation, onDraft, onSubmit, onAssess }: Props) {
  const [validation, setValidation] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const { autoSpeakOnce, stop } = usePronunciation()
  useEffect(() => {
    if (session.phase === 'answering') inputRef.current?.focus()
    if (session.phase === 'feedback') feedbackRef.current?.focus()
  }, [session.phase, session.index])
  const question = session.questions[session.index]
  const content = questionContent(question, catalog)
  const h=history[question.wordId]??emptyWordHistory()
  const difficulty=calculateDifficulty(h[question.direction],now)
  const correct = session.submittedCorrect
  const englishText = question.snapshot.word.english
  const source = label === 'Daily Test' ? 'daily' : 'review'
  const sessionKey = session.syncId ?? 'legacy'
  useEffect(() => {
    stop()
    const forwardPrompt = question.direction === 'englishToTurkish' && session.phase === 'answering'
    const reverseReveal = question.direction === 'turkishToEnglish' && session.phase === 'feedback'
    if (forwardPrompt || reverseReveal) {
      const phase = forwardPrompt ? 'prompt' : 'reveal'
      autoSpeakOnce(`${source}:${sessionKey}:${session.index}:${phase}`, englishText, autoPronunciation)
    }
    return stop
  }, [source, sessionKey, session.index, session.phase, question.direction, englishText, autoPronunciation, autoSpeakOnce, stop])
  return <section className="test-panel" aria-label={`${label} question`}>
    <div className="test-progress"><span>{label === 'Review' ? 'SPACED REVIEW' : 'DAILY PRACTICE'}</span><span aria-label="Question progress">{session.index + 1} / {session.questions.length}</span></div>
    <progress value={session.index} max={session.questions.length} aria-label="Completed questions" />
    <p className="test-mode-label">{modeLabels[question.direction]}</p>
    <div className="practice-badges"><span>{difficulty.level}</span>{directionalReviewDue(h,question.direction,now)&&<span>Needs Review</span>}</div>
    <p className="test-prompt">What is the {content.answerLang === 'tr' ? 'Turkish' : 'English'} meaning of this word?</p>
    <div className="practice-word-row"><h2 className="test-word" lang={content.sourceLang}>{content.prompt}</h2>{question.direction === 'englishToTurkish' && <PronunciationButton text={englishText} speechKey={`${source}:${sessionKey}:${session.index}:manual`} label={`Pronounce ${englishText}`} />}</div>
    {content.word.partOfSpeech && <span className="test-word-type">{content.word.partOfSpeech}</span>}
    {session.phase === 'answering' ? <form onSubmit={event => {
      event.preventDefault()
      if (!session.draft.trim()) { setValidation(true); inputRef.current?.focus(); return }
      setValidation(false)
      onSubmit()
    }}>
      <label htmlFor="test-answer">{content.answerLabel}</label>
      <input ref={inputRef} id="test-answer" lang={content.answerLang} autoComplete="off" spellCheck={false} value={session.draft} placeholder="Type your answer…" aria-invalid={validation} aria-describedby={validation ? 'answer-error' : 'answer-hint'} onChange={event => { setValidation(false); onDraft(event.target.value) }} />
      {validation ? <p id="answer-error" className="answer-error" role="alert">Type an answer before submitting.</p> : <p id="answer-hint" className="test-hint">{content.rule === 'legacy' ? 'This saved session uses the original matching rules, including Turkish accent tolerance.' : 'Type one complete answer. Turkish letters matter; capitalization, extra spaces, and trailing punctuation don’t.'}</p>}
      <button className="primary-button" type="submit">Submit answer →</button>
    </form> : <>
      <div className={`answer-feedback ${correct ? 'correct' : 'incorrect'}`} ref={feedbackRef} tabIndex={-1} role="status">
        <strong>{correct ? 'Correct answer' : 'Incorrect answer'}</strong>
        <dl><div><dt>Your answer</dt><dd lang={content.answerLang}>{session.submittedAnswer}</dd></div><div><dt>Correct answers</dt><dd><ul className="correct-answers">{content.acceptedAnswers.map(answer => <li lang={content.answerLang} key={answer}>{answer}</li>)}</ul></dd></div></dl>
      </div>
      {question.direction === 'turkishToEnglish' && <div className="revealed-pronunciation"><span>English pronunciation</span><PronunciationButton text={englishText} speechKey={`${source}:${sessionKey}:${session.index}:replay`} label={`Pronounce correct answer: ${englishText}`} /></div>}
      <p className="test-hint">How well did you know it? Your choice decides whether it joins Learned.</p>
      <div className="test-actions"><button className="primary-button" onClick={() => onAssess(true)}>I knew this</button><button className="secondary-button" onClick={() => onAssess(false)}>I didn’t know this</button></div>
    </>}
  </section>
}
