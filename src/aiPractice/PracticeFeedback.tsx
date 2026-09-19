import { useEffect, useRef, useState } from 'react'
import type { PracticeSession } from './practiceModel'
import type { VocabularyWord } from '../vocabulary'
import type { PracticeService } from './practiceService'

const labels={correct:'Correct retrieval',partial:'Partial',needsPractice:'Needs practice',notAttempted:'Not attempted'}
export function PracticeFeedback({session,service,catalog,onFinish}:{session:PracticeSession;service:PracticeService;catalog:readonly VocabularyWord[];onFinish:()=>void}){
  const feedback=session.feedback!
  const [selected,setSelected]=useState(feedback.suggestedReviewWordIds)
  const [notice,setNotice]=useState('')
  const heading=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{heading.current?.focus()},[])
  const name=(id:number)=>session.targets.find(t=>t.wordId===id)!.snapshot.word.english
  return <section className="test-panel ai-practice" aria-label="AI practice feedback">
    <h2 tabIndex={-1} ref={heading}>AI Practice Complete</h2>
    <p className="storage-notice">Mock feedback — vocabulary recognition is simulated. General language quality is not assessed.</p>
    <div className="test-stats directional-stats"><div><strong>{feedback.words.length}</strong><span>Target vocabulary</span></div>{(Object.keys(labels) as (keyof typeof labels)[]).map(outcome=><div key={outcome}><strong>{feedback.words.filter(w=>w.outcome===outcome).length}</strong><span>{labels[outcome]}</span></div>)}</div>
    <h3>Vocabulary feedback</h3>
    <ul className="ai-feedback-list">{feedback.words.map(word=><li key={word.wordId}><strong>{name(word.wordId)} · {labels[word.outcome]}</strong><p>{word.explanation}</p><p className="test-hint">Retrieval: {word.retrieval} · Context: {word.semantic} · Grammar: {word.grammar}</p></li>)}</ul>
    <h3>Grammar and vocabulary corrections</h3>
    {feedback.corrections.length?<ul className="ai-feedback-list">{feedback.corrections.map((c,index)=><li key={index}><strong>{c.kind==='grammar'?'Grammar':'Vocabulary'} · {name(c.wordId)}</strong><p><q>{c.original}</q> → <q>{c.replacement}</q></p></li>)}</ul>:<p>No corrections from this mock. This does not establish grammatical correctness.</p>}
    {feedback.strengths.length>0&&<><h3>Strengths</h3><ul>{feedback.strengths.map(s=><li key={s}>{s}</li>)}</ul></>}
    <h3>Suggested review</h3>
    <p>Selections are temporary and do not update your Review queue. They are discarded when you leave practice.</p>
    {feedback.suggestedReviewWordIds.length?<div className="ai-review-selection">{feedback.suggestedReviewWordIds.map(id=><label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={()=>setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}/>{name(id)}</label>)}</div>:<p>No vocabulary review suggestions.</p>}
    <p role="status">{notice}</p>
    <div className="test-actions"><button className="secondary-button" disabled={!selected.length} onClick={()=>{try{const requests=service.stageReview(selected,catalog);setNotice(`${requests.length} review request${requests.length===1?'':'s'} staged temporarily. Review queue unchanged.`)}catch{setNotice('These words are no longer available. No review changes were made.')}}}>Stage selected review requests</button><button className="primary-button" onClick={()=>{service.finish();onFinish()}}>Finish</button></div>
  </section>
}
