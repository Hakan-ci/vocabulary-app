import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PronunciationActionsContext } from '../pronunciationContext'
import { buildPracticeContext } from './contextBuilder'
import type { PracticeTransport } from './openAIProvider'
import type { PracticePersistence } from './persistence'
import type { PracticeService } from './practiceService'
import { PracticeFeedback } from './PracticeFeedback'
import { VoiceSession } from './voiceSession'
import type { VoiceConnector } from './voiceSession'
import { browserVoiceConnector } from './voiceTransport'
export function VoicePractice({service,transport,persistence,onExit,onChooseText,connector}:{service:PracticeService;transport:PracticeTransport;persistence:PracticePersistence;onExit:()=>void;onChooseText:()=>void;connector?:VoiceConnector}){
 const [voice]=useState(()=>new VoiceSession(connector??browserVoiceConnector(transport,buildPracticeContext(service.getSnapshot().targets,'conversation'),service.getSnapshot().id)))
 const state=useSyncExternalStore(voice.subscribe,voice.getSnapshot),practice=useSyncExternalStore(service.subscribe,service.getSnapshot)
 const [excluded,setExcluded]=useState(new Set<string>()),[manual,setManual]=useState(false),[remaining,setRemaining]=useState(120)
 const lifecycle=useRef(0)
 const isCurrent=useCallback((generation:number)=>lifecycle.current===generation,[])
 const ended=['ended','error'].includes(state.status)
 const pronunciation=useContext(PronunciationActionsContext),heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{const generation=++lifecycle.current;heading.current?.focus();const release=pronunciation?.acquire();let alive=true;queueMicrotask(()=>{if(alive)void voice.start()});return()=>{alive=false;release?.();queueMicrotask(()=>{if(isCurrent(generation))voice.dispose()})}},[voice,pronunciation,isCurrent])
 useEffect(()=>{if(ended)return;const timer=setInterval(()=>setRemaining(n=>Math.max(0,n-1)),1000);return()=>clearInterval(timer)},[ended])
 if(practice.status==='feedback')return <PracticeFeedback persistence={persistence} session={practice} service={service} onFinish={onExit}/>
 const evaluating=['processing','retryable'].includes(practice.status)
 return <section className="test-panel ai-practice" aria-label="Voice conversation"><h2 ref={heading} tabIndex={-1}>Conversation — Voice</h2>
 <p className="storage-notice">AI-generated tutor voice · Audio and transcripts are not saved by this app. OpenAI has separate retention policies.</p>
 <p role="status">{state.status} · Microphone: {state.microphone}{!ended&&remaining<=20?' · Session ending soon':''}</p>
 {state.error&&<p role="alert">{state.error}</p>}
 <p>Targets: {practice.targets.map(t=>t.snapshot.word.english).join(', ')}</p>
 <ol className="ai-messages" aria-label="Voice transcript">{state.turns.map(t=><li key={t.id}><strong>{t.role==='learner'?'You — heard text':'AI tutor — captions'}</strong><p>{t.text}</p>{ended&&t.role==='learner'&&<label><input type="checkbox" checked={!excluded.has(t.id)} disabled={evaluating} onChange={()=>setExcluded(previous=>{const next=new Set(previous);if(next.has(t.id))next.delete(t.id);else next.add(t.id);return next})}/>Include in feedback</label>}</li>)}</ol>
 {ended?<><h3>Review what was heard</h3><p>Exclude misheard segments before requesting feedback. Recognition can be inaccurate. Unused targets remain unattempted.</p>
 {practice.status==='retryable'?<><p role="alert">{practice.error}</p><button className="primary-button" onClick={()=>void service.retry()}>Retry feedback</button></>:<button className="primary-button" disabled={evaluating||state.microphone!=='granted'} onClick={()=>void service.evaluateVoice(voice.finalized(excluded))}>{evaluating?'Evaluating…':'Get feedback'}</button>}
 {state.confirmed&&practice.status==='preparing'&&<button className="secondary-button" onClick={()=>{setRemaining(120);setExcluded(new Set());void voice.reconnect()}}>Reconnect with a new voice session</button>}</>:<>
 <button className="secondary-button" aria-pressed={state.muted} onClick={()=>voice.mute(!state.muted)}>{state.muted?'Unmute microphone':'Mute microphone'}</button>
 <label><input type="checkbox" checked={manual} onChange={e=>{setManual(e.target.checked);voice.mute(e.target.checked)}}/>Push-to-talk fallback</label>
 {manual&&<button className="secondary-button" onPointerDown={()=>voice.mute(false)} onPointerUp={()=>voice.mute(true)} onPointerCancel={()=>voice.mute(true)} onBlur={()=>voice.mute(true)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();voice.mute(false)}}} onKeyUp={e=>{if(e.key===' '||e.key==='Enter')voice.mute(true)}}>Hold to talk</button>}
 <button className="primary-button" disabled={state.status==='ending'} onClick={()=>void voice.end()}>End Practice</button></>}
 {ended&&<button className="secondary-button" disabled={evaluating} onClick={()=>{voice.dispose();service.cancel();onChooseText()}}>Choose text practice</button>}
 <button className="secondary-button" onClick={()=>{voice.dispose();service.cancel();onExit()}}>{ended?'Return to practice':'Cancel'}</button>
 </section>
}
