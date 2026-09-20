import {directionEligible} from './reviewEligibility'
import type {ReviewRequests} from './aiPractice/learningEvidence'
import {calculateDifficulty, emptyWordHistory} from './learningHistory'
import type {LearningHistory} from './learningHistory'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabularyWord } from './vocabulary'
import { questionContent } from './dailyTestModel'
import type { TestSession } from './dailyTestModel'
import { modeLabels } from './learningTypes'
import { PronunciationButton } from './Pronunciation'
import { usePronunciationActions } from './pronunciationContext'

type Props = { requests?:ReviewRequests; history:LearningHistory; now:number; catalog: readonly VocabularyWord[]; session: TestSession; label: 'Daily Test' | 'Review'; autoPronunciation:boolean; draftScope: string; onSubmit: (answer: string, identity: string) => boolean; onAssess: (known: boolean) => void }
export function PracticeQuestion({ requests={}, history, now, catalog, session, label, autoPronunciation, draftScope, onSubmit, onAssess }: Props) {
  const feedbackRef = useRef<HTMLDivElement>(null)
  const { autoSpeakOnce, stop } = usePronunciationActions()
  useEffect(() => {
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
    const timer=setTimeout(() => {if (forwardPrompt || reverseReveal) {
      const phase = forwardPrompt ? 'prompt' : 'reveal'
      autoSpeakOnce(`${source}:${sessionKey}:${session.index}:${phase}`, englishText, autoPronunciation)
    }},0)
    return () => {clearTimeout(timer);stop()}
  }, [source, sessionKey, session.index, session.phase, question.direction, englishText, autoPronunciation, autoSpeakOnce, stop])
  return <section className="test-panel" aria-label={`${label} question`}>
    <div className="test-progress"><span>{label === 'Review' ? 'SPACED REVIEW' : 'DAILY PRACTICE'}</span><span aria-label="Question progress">{session.index + 1} / {session.questions.length}</span></div>
    <progress value={session.index} max={session.questions.length} aria-label="Completed questions" />
    <p className="test-mode-label">{modeLabels[question.direction]}</p>
    <div className="practice-badges"><span>{difficulty.level}</span>{directionEligible(question.wordId,h,question.direction,now,requests)&&<span>Needs Review</span>}</div>
    <p className="test-prompt">What is the {content.answerLang === 'tr' ? 'Turkish' : 'English'} meaning of this word?</p>
    <div className="practice-word-row"><h2 className="test-word" lang={content.sourceLang}>{content.prompt}</h2>{question.direction === 'englishToTurkish' && <PronunciationButton text={englishText} speechKey={`${source}:${sessionKey}:${session.index}:manual`} label={`Pronounce ${englishText}`} />}</div>
    {content.word.partOfSpeech && <span className="test-word-type">{content.word.partOfSpeech}</span>}
    {session.phase === 'answering' ? <AnswerForm key={`${draftScope}:${source}:${sessionKey}:${session.index}`} storageKey={`kelime-draft:${draftScope}:${source}:${sessionKey}:${session.index}`} identity={`${sessionKey}:${session.index}`} initial={session.draft} content={content} onSubmit={onSubmit} /> : <>
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

function AnswerForm({storageKey,identity,initial,content,onSubmit}: {storageKey:string;identity:string;initial:string;content:ReturnType<typeof questionContent>;onSubmit:Props['onSubmit']}) {
  const [answer,setAnswer] = useState(() => {try {return localStorage.getItem(storageKey) ?? initial} catch {return initial}})
  const [validation,setValidation] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const current = useRef(answer)
  const submitted = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const save = useCallback(() => {if (!submitted.current) try {localStorage.setItem(storageKey,current.current)} catch {/* The live answer remains available for submission. */}}, [storageKey])
  useEffect(() => {
    inputRef.current?.focus()
    const flush = () => {clearTimeout(timer.current); save()}
    const hidden = () => {if(document.visibilityState === 'hidden') flush()}
    window.addEventListener('pagehide',flush); document.addEventListener('visibilitychange',hidden)
    return () => {flush(); window.removeEventListener('pagehide',flush); document.removeEventListener('visibilitychange',hidden)}
  }, [storageKey, save])
  return <form onSubmit={event => {
      event.preventDefault()
      if (!answer.trim()) { setValidation(true); inputRef.current?.focus(); return }
      setValidation(false)
      if (onSubmit(answer, identity)) { submitted.current = true; clearTimeout(timer.current); try { localStorage.removeItem(storageKey) } catch {/* Submitted state remains authoritative. */} }
    }}>
      <label htmlFor="test-answer">{content.answerLabel}</label>
      <input ref={inputRef} id="test-answer" lang={content.answerLang} autoComplete="off" spellCheck={false} value={answer} placeholder="Type your answer…" aria-invalid={validation} aria-describedby={validation ? 'answer-error' : 'answer-hint'} onChange={event => { setValidation(false); current.current = event.target.value; setAnswer(event.target.value); clearTimeout(timer.current); timer.current = setTimeout(save, 400) }} />
      {validation ? <p id="answer-error" className="answer-error" role="alert">Type an answer before submitting.</p> : <p id="answer-hint" className="test-hint">{content.rule === 'legacy' ? 'This saved session uses the original matching rules, including Turkish accent tolerance.' : 'Type one complete answer. Turkish letters matter; capitalization, extra spaces, and trailing punctuation don’t.'}</p>}
      <button className="primary-button" type="submit">Submit answer →</button>
    </form>
}
