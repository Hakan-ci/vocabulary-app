import type { VoiceConnector } from './voiceSession'
import type { LearningState } from '../learningState'
import { selectIndependentTargets, selectPracticeTargets } from './targetWordSelector'
import { VoicePractice } from './VoicePractice'
import { OpenAIPracticeProvider } from './openAIProvider'
import type { PracticeTransport } from './openAIProvider'
import { approvedPracticeTransport } from './providerConnection'
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

export type AIPracticeProps={voiceConnector?:VoiceConnector;persistence:PracticePersistence;quiz?:TestSession;learning?:LearningState;history:LearningHistory;catalog:readonly VocabularyWord[];onExit:()=>void;providerFactory?:()=>AIPracticeProvider;loadTransport?:typeof approvedPracticeTransport}
export function AIPractice(props:AIPracticeProps){
  const {quiz,catalog,onExit,loadTransport=approvedPracticeTransport}=props
  const [persistence]=useState(props.persistence)
  const [transport,setTransport]=useState<PracticeTransport|null>(null)
  const [provider,setProvider]=useState('mock')
  useEffect(()=>{const controller=new AbortController();void loadTransport(controller.signal).then(value=>{if(!controller.signal.aborted)setTransport(()=>value)}).catch(()=>{});return()=>controller.abort()},[loadTransport])
  const [mode,setMode]=useState<PracticeMode|'voice'>('conversation')
  const [selection,setSelection]=useState('automatic'),[selected,setSelected]=useState<number[]>([]),[search,setSearch]=useState('')
  const [voiceAvailable,setVoiceAvailable]=useState(false),[voiceStarted,setVoiceStarted]=useState(false)
  useEffect(()=>{const abort=new AbortController();if(transport)void transport({action:'voiceAvailability'},abort.signal).then(v=>{if(!abort.signal.aborted)setVoiceAvailable((v as {available?:boolean}).available===true)}).catch(()=>{});return()=>abort.abort()},[transport])
  const [service,setService]=useState<PracticeService|null>(null)
  const [error,setError]=useState('')
  const heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{heading.current?.focus()},[])
  useEffect(()=>()=>service?.dispose(),[service])
  useEffect(()=>{
    if(service&&((quiz?.syncId??null)!==service.getSnapshot().sourceQuizId||service.getSnapshot().targets.some(t=>!catalog.some(w=>w.id===t.wordId)))){service.dispose();onExit()}
  },[quiz?.syncId,catalog,onExit,service])
  if(service&&voiceStarted&&transport)return <VoicePractice onChooseText={()=>{setService(null);setVoiceStarted(false);setMode('conversation')}} connector={props.voiceConnector} service={service} transport={transport} persistence={persistence} onExit={onExit}/>
  if(service)return <PracticeSessionView persistence={persistence} service={service} catalog={props.catalog} onExit={props.onExit}/>
  return <section className="test-panel ai-practice" aria-label="AI practice setup">
    <div className="eyebrow">OPTIONAL AI PRACTICE</div><h2 ref={heading} tabIndex={-1}>AI Practice</h2>
    <p className="storage-notice">{mode==='voice'?'OpenAI voice tutoring — selected vocabulary and live audio are sent to OpenAI':mode==='voiceAnswer'?'Typed translation checked locally — no model calls':provider==='openai'?'OpenAI text tutoring — selected vocabulary and finalized messages are sent to OpenAI':'Mock practice — no AI service connected'}</p>{transport&&mode!=='voiceAnswer'&&mode!=='voice'&&<label className="ai-mode">Tutor<select value={provider} onChange={event=>setProvider(event.target.value)}><option value="mock">Mock tutor</option><option value="openai">OpenAI tutor</option></select></label>}{!transport&&<p>Real AI is available only to approved signed-in accounts when the pilot is enabled.</p>}<p>Practice independently with selected vocabulary. Only compact completed outcomes are saved; conversation text is not saved by this app. OpenAI may retain data under its separate service policies.</p>
    <label className="ai-mode">Practice mode<select value={mode} onChange={event=>setMode(event.target.value as PracticeMode|'voice')}>{Object.entries(practiceModeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="voice" disabled={!voiceAvailable}>Conversation — Voice{!voiceAvailable?' (pilot unavailable)':''}</option></select></label>
    {!quiz&&<><label className="ai-mode">Target selection<select value={selection} onChange={e=>setSelection(e.target.value)}><option value="automatic">Automatic Practice</option><option value="manual">Choose Words</option></select></label>{selection==='manual'&&<fieldset><legend>Choose 1–8 words ({selected.length}/8)</legend><label>Search vocabulary<input value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="ai-word-picker">{catalog.filter(w=>(w.english+' '+w.turkishMeanings.join(' ')).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(w=><label key={w.id}><input type="checkbox" checked={selected.includes(w.id)} disabled={!selected.includes(w.id)&&selected.length>=8} onChange={()=>setSelected(ids=>ids.includes(w.id)?ids.filter(id=>id!==w.id):[...ids,w.id])}/>{w.english} · {w.turkishMeanings.join('; ')}</label>)}</div></fieldset>}</>}
    {mode==='voice'&&<p className="storage-notice">AI-generated tutor voice · Two-minute session. Your microphone starts only when you choose Start Voice. Review what was heard before feedback.</p>}
    <p role="alert">{error}</p>
    <div className="test-actions"><button className="primary-button" disabled={!catalog.length||mode==='voice'&&!voiceAvailable} onClick={()=>{try{
      const targets=quiz?selectPracticeTargets(quiz,catalog,props.history,Date.now()):selectIndependentTargets(catalog,props.learning??{history:props.history,reviewRequests:{},aiEvidence:{},session:null},Date.now(),selection==='manual'?selected:undefined)
      const next=new PracticeService({...props,start:{targets,sourceQuizId:quiz?.syncId??null,provenance:quiz?'quizFollowup':selection==='manual'?'manual':'automatic',inputModality:mode==='voice'?'voice':'text'},mode:mode==='voice'?'conversation':mode,provider:props.providerFactory?.()??((mode==='voice'||provider==='openai')&&transport?new OpenAIPracticeProvider(transport):new MockPracticeProvider())})
      setService(next);if(mode==='voice')setVoiceStarted(true);else void next.start()
    }catch{setError('Choose one to eight available words to practice.')}}}>{mode==='voice'?'Start Voice':'Start practice'}</button><button className="secondary-button" onClick={props.onExit}>{quiz?'Return to quiz results':'Return to vocabulary'}</button></div>
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
  const retryable=session.status==='retryable'
  const ready=session.status==='ready',hasMore=progress.unpracticed.length>0
  return <section className="test-panel ai-practice" aria-label="AI practice session">
    <div className="eyebrow">OPTIONAL AI PRACTICE</div><h2 ref={heading} tabIndex={-1}>{practiceModeLabels[session.mode]}</h2>
    <p className="storage-notice">{session.evaluator==='deterministic'?'Typed translation checked locally — no model calls':session.evaluator==='openai'?'OpenAI text tutor':'Mock practice — no AI service connected'}</p>
    <p role="status">Status: {session.status} · {progress.attempted.length} / {session.targets.length} targets attempted</p>
    <progress value={progress.attempted.length} max={session.targets.length} aria-label="Practice target progress"/>
    <ul className="ai-targets" aria-label="Target vocabulary">{session.targets.map((t,index)=><li key={t.wordId}>{session.mode==='voiceAnswer'&&!progress.attempted.includes(t.wordId)?`Target ${index+1} · Not revealed`:t.snapshot.word.english}{progress.attempted.includes(t.wordId)?' · Attempted':''}</li>)}</ul>
    <ol className="ai-messages" aria-label="Practice conversation">{session.turns.map(turn=><li key={turn.id}><strong>{turn.role==='learner'?'You':session.evaluator==='openai'?'AI tutor':session.evaluator==='deterministic'?'Local checker':'Mock tutor'}</strong><p>{turn.text}</p></li>)}</ol>
    {retryable&&<p role="alert">{session.error}</p>}{retryable&&<button className="secondary-button" onClick={()=>void service.retry()}>Retry tutor action</button>}
    {failed?<p role="alert">{session.error??'Practice cancelled.'}</p>:<form onSubmit={event=>{event.preventDefault();if(ready&&hasMore&&draft.trim()){void service.submit(draft);setDraft('')}}}>
      <label htmlFor="ai-practice-answer">{session.mode==='voiceAnswer'?'Your translation':'Your response'}</label><textarea id="ai-practice-answer" ref={input} value={draft} maxLength={2000} disabled={!ready||!hasMore} onChange={event=>setDraft(event.target.value)} rows={3}/>
      <button className="primary-button" disabled={!ready||!hasMore||!draft.trim()} type="submit">Send response</button>
    </form>}
    {!hasMore&&!failed&&<p>All targets have been attempted. End practice to see your feedback.</p>}
    <div className="test-actions">{failed?<button className="primary-button" onClick={onExit}>Return to quiz results</button>:<><button className="primary-button" disabled={!ready&&!retryable} onClick={()=>void service.end()}>End Practice</button><button className="secondary-button" onClick={()=>{service.cancel();onExit()}}>Cancel</button></>}</div>
  </section>
}
