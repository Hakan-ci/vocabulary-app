import type {PracticePersistence,PracticeSaveResult} from './persistence'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PracticeSession } from './practiceModel'
import type { PracticeService } from './practiceService'

const saveMessage=(result:PracticeSaveResult)=>result.pendingSync?'Saved on this device, awaiting sync.':result.synchronized?'Saved and synchronized.':'Saved on this device.'
const labels={correct:'Correct retrieval',partial:'Partial',needsPractice:'Needs practice',notAttempted:'Not attempted'}
export function PracticeFeedback({session,service,onFinish,persistence}:{session:PracticeSession;service:PracticeService;onFinish:()=>void;persistence:PracticePersistence}){
  const feedback=session.feedback!
  const [selected,setSelected]=useState(feedback.suggestedReviewWordIds)
  const [notice,setNotice]=useState('')
  const [saved,setSaved]=useState(false)
  const [saving,setSaving]=useState(true)
  const [error,setError]=useState('')
  const mounted=useRef(true),pending=useRef(false)
  const complete=useCallback(async()=>{
    if(pending.current)return
    pending.current=true;setSaving(true);setError('');setNotice('')
    try{const result=await persistence.complete(session);if(mounted.current){setSaved(true);setNotice('Practice outcomes saved. '+saveMessage(result))}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not save practice. Retry.')}
    finally{pending.current=false;if(mounted.current)setSaving(false)}
  },[persistence,session])
  useEffect(()=>{mounted.current=true;queueMicrotask(()=>{if(mounted.current)void complete()});return()=>{mounted.current=false}},[complete]) // One completion checkpoint per mounted feedback screen.
  const add=async()=>{
    if(pending.current||!saved)return
    pending.current=true;setSaving(true);setError('');setNotice('')
    try{const result=await persistence.request(session.id,selected);if(mounted.current)setNotice('Selected words added to Review. '+saveMessage(result))}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not save selection. Retry.')}
    finally{pending.current=false;if(mounted.current)setSaving(false)}
  }
  const heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{heading.current?.focus()},[])
  const name=(id:number)=>session.targets.find(t=>t.wordId===id)!.snapshot.word.english
  return <section className="test-panel ai-practice" aria-label="AI practice feedback">
    <h2 tabIndex={-1} ref={heading}>AI Practice Complete</h2>
    <p className="storage-notice">{session.evaluator==='openai'?'AI feedback — contextual judgments can be inaccurate.':session.evaluator==='deterministic'?'Local translation matching — context and grammar are unassessed.':'Mock feedback — vocabulary recognition is simulated. General language quality is not assessed.'}</p>
    <div className="test-stats directional-stats"><div><strong>{feedback.words.length}</strong><span>Target vocabulary</span></div>{(Object.keys(labels) as (keyof typeof labels)[]).map(outcome=><div key={outcome}><strong>{feedback.words.filter(w=>w.outcome===outcome).length}</strong><span>{labels[outcome]}</span></div>)}</div>
    <h3>Vocabulary feedback</h3>
    <ul className="ai-feedback-list">{feedback.words.map(word=><li key={word.wordId}><strong>{name(word.wordId)} · {labels[word.outcome]}</strong><p>{word.explanation}</p><p className="test-hint">Retrieval: {word.retrieval} · Context: {word.semantic} · Grammar: {word.grammar}</p></li>)}</ul>
    <h3>Grammar and vocabulary corrections</h3>
    {feedback.corrections.length?<ul className="ai-feedback-list">{feedback.corrections.map((c,index)=><li key={index}><strong>{c.kind==='grammar'?'Grammar':'Vocabulary'} · {name(c.wordId)}</strong><p><q>{c.original}</q> → <q>{c.replacement}</q></p></li>)}</ul>:<p>No corrections reported. This does not establish grammatical correctness.</p>}
    {feedback.strengths.length>0&&<><h3>Strengths</h3><ul>{feedback.strengths.map(s=><li key={s}>{s}</li>)}</ul></>}
    <h3>Suggested review</h3>
    <p>Only selected suggestions are added to Review. AI outcomes do not change your Known/Missed history.</p>
    {feedback.suggestedReviewWordIds.length?<div className="ai-review-selection">{feedback.suggestedReviewWordIds.map(id=><label key={id}><input type="checkbox" disabled={saving} checked={selected.includes(id)} onChange={()=>setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}/>{name(id)}</label>)}</div>:<p>No vocabulary review suggestions.</p>}
    <p role="status">{saving?'Saving on this device…':notice}</p>
    {error&&<p role="alert">{error} {!saved&&'Practice outcomes have not been saved. Leaving now may discard them.'}</p>}
    <div className="test-actions">{!saved&&<button className="secondary-button" disabled={saving} onClick={()=>void complete()}>Retry saving outcomes</button>}<button className="secondary-button" disabled={!selected.length||!saved||saving} onClick={()=>void add()}>Add Selected to Review</button><button className="primary-button" disabled={saving} onClick={()=>{service.finish();onFinish()}}>Finish</button></div>
  </section>
}
