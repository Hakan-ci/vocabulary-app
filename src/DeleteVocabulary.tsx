import { useEffect, useRef, useState } from 'react'
import type { VocabularyDeletionPlan } from './vocabularyManagement'
export function DeleteVocabulary({plan,onCancel,onDelete}:{plan:VocabularyDeletionPlan;onCancel:()=>void;onDelete:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null,element=dialog.current!;element.showModal();cancel.current?.focus();return()=>{element.close();previous?.focus()}},[])
  const confirm=()=>{setBusy(true);try{onDelete()}catch(e){setError(e instanceof Error?e.message:'Deletion could not be saved. Please try again.');setBusy(false)}}
  return <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={event=>{event.preventDefault();if(!busy)onCancel()}}>
    <h2 id="delete-title">Remove {plan.ids.length} {plan.ids.length===1?'word':'words'}?</h2>
    <div id="delete-description"><p><strong>{plan.personalIds.length} personal</strong> {plan.personalIds.length===1?'word':'words'} will be permanently deleted with active Favorites and learning progress.</p><p><strong>{plan.builtInIds.length} built-in</strong> {plan.builtInIds.length===1?'word':'words'} will be hidden and can be restored with prior progress in Account.</p>{plan.affectedSessions.length>0&&<p>Unfinished {plan.affectedSessions.join(' and ')} sessions that contain these words will be archived. Their assessed answers remain counted.</p>}{plan.ids.length<=20&&<p>You will have 10 seconds to undo this command.</p>}</div>
    {error&&<p role="alert" className="answer-error">{error}</p>}
    <div className="test-actions"><button ref={cancel} disabled={busy} className="secondary-button" onClick={onCancel}>Cancel</button><button disabled={busy} className="danger-button" onClick={confirm}>{busy?'Deleting…':'Remove words'}</button></div>
  </dialog>
}
