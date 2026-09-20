import type {PracticePersistence} from './persistence'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TestSession } from '../dailyTestModel'
import type { LearningHistory } from '../learningHistory'
import type { VocabularyWord } from '../vocabulary'
import { PracticeService } from './practiceService'
import { MockPracticeProvider } from './mockProvider'
import { practiceModeLabels, practiceProgress } from './practiceModel'
import type { PracticeMode } from './practiceModel'
import type { AIPracticeProvider } from './provider'
import { PracticeFeedback } from './PracticeFeedback'

export type AIPracticeProps={persistence:PracticePersistence;quiz:TestSession;history:LearningHistory;catalog:readonly VocabularyWord[];onExit:()=>void;providerFactory?:()=>AIPracticeProvider}
export function AIPractice(props:AIPracticeProps){
  const {quiz,catalog,onExit}=props
  const [persistence]=useState(props.persistence)
  const [mode,setMode]=useState<PracticeMode>('conversation')
  const [service,setService]=useState<PracticeService|null>(null)
  const [error,setError]=useState('')
  const heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{heading.current?.focus()},[])
  useEffect(()=>()=>service?.dispose(),[service])
  useEffect(()=>{
    if(service&&((quiz.syncId??null)!==service.getSnapshot().sourceQuizId||service.getSnapshot().targets.some(t=>!catalog.some(w=>w.id===t.wordId)))){service.dispose();onExit()}
  },[quiz.syncId,catalog,onExit,service])
  if(service)return <PracticeSessionView persistence={persistence} service={service} catalog={props.catalog} onExit={props.onExit}/>
  return <section className="test-panel ai-practice" aria-label="AI practice setup">
    <div className="eyebrow">QUIZ COMPLETE · OPTIONAL PRACTICE</div><h2 ref={heading} tabIndex={-1}>Practice with AI</h2>
    <p className="storage-notice">Mock practice — no AI service connected</p><p>Your quiz is complete. Practice here uses typed input. Only compact completed outcomes are saved; conversation text stays in memory.</p>
    <label className="ai-mode">Practice mode<select value={mode} onChange={event=>setMode(event.target.value as PracticeMode)}>{Object.entries(practiceModeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <p role="alert">{error}</p>
    <div className="test-actions"><button className="primary-button" onClick={()=>{try{const next=new PracticeService({...props,mode,provider:props.providerFactory?.()??new MockPracticeProvider()});setService(next);void next.start()}catch{setError('No available quiz words to practice. Return to your quiz results.')}}}>Start practice</button><button className="secondary-button" onClick={props.onExit}>Return to quiz results</button></div>
  </section>
}
function PracticeSessionView({service,onExit,persistence}:{persistence:PracticePersistence;service:PracticeService;catalog:readonly VocabularyWord[];onExit:()=>void}){
  const session=useSyncExternalStore(service.subscribe,service.getSnapshot)
  const [draft,setDraft]=useState('')
  const input=useRef<HTMLTextAreaElement>(null),heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{heading.current?.focus()},[])
  useEffect(()=>{if(session.status==='ready')input.current?.focus()},[session.status])
  const progress=practiceProgress(session)
  if(session.status==='feedback')return <PracticeFeedback persistence={persistence} session={session} service={service} onFinish={onExit}/>
  const failed=session.status==='failed'||session.status==='cancelled'
  const ready=session.status==='ready',hasMore=progress.unpracticed.length>0
  return <section className="test-panel ai-practice" aria-label="AI practice session">
    <div className="eyebrow">QUIZ COMPLETE · OPTIONAL PRACTICE</div><h2 ref={heading} tabIndex={-1}>{practiceModeLabels[session.mode]}</h2>
    <p className="storage-notice">Mock practice — no AI service connected</p>
    <p role="status">Status: {session.status} · {progress.attempted.length} / {session.targets.length} targets attempted</p>
    <progress value={progress.attempted.length} max={session.targets.length} aria-label="Practice target progress"/>
    <ul className="ai-targets" aria-label="Target vocabulary">{session.targets.map((t,index)=><li key={t.wordId}>{session.mode==='voiceAnswer'&&!progress.attempted.includes(t.wordId)?`Target ${index+1} · Not revealed`:t.snapshot.word.english}{progress.attempted.includes(t.wordId)?' · Attempted':''}</li>)}</ul>
    <ol className="ai-messages" aria-label="Practice conversation">{session.turns.map(turn=><li key={turn.id}><strong>{turn.role==='learner'?'You':'Mock tutor'}</strong><p>{turn.text}</p></li>)}</ol>
    {failed?<p role="alert">{session.error??'Practice cancelled.'}</p>:<form onSubmit={event=>{event.preventDefault();if(ready&&hasMore&&draft.trim()){void service.submit(draft);setDraft('')}}}>
      <label htmlFor="ai-practice-answer">{session.mode==='voiceAnswer'?'Typed simulated transcription':'Your response'}</label><textarea id="ai-practice-answer" ref={input} value={draft} maxLength={2000} disabled={!ready||!hasMore} onChange={event=>setDraft(event.target.value)} rows={3}/>
      <button className="primary-button" disabled={!ready||!hasMore||!draft.trim()} type="submit">Send response</button>
    </form>}
    {!hasMore&&!failed&&<p>All targets have been attempted. End practice to see your feedback.</p>}
    <div className="test-actions">{failed?<button className="primary-button" onClick={onExit}>Return to quiz results</button>:<><button className="primary-button" disabled={!ready} onClick={()=>void service.end()}>End Practice</button><button className="secondary-button" onClick={()=>{service.cancel();onExit()}}>Cancel</button></>}</div>
  </section>
}
