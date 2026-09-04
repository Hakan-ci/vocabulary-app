import { useEffect, useRef, useState } from 'react'
import type { VocabularyWord } from './vocabulary'
export function DeleteVocabulary({ word, onCancel, onDelete }: { word: VocabularyWord; onCancel: () => void; onDelete: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null)
  const [error,setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal(); cancel.current?.focus()
    return () => { element.close(); previous?.focus() }
  }, [])
  return <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={e=>{e.preventDefault();onCancel()}}>
    <h2 id="delete-title">Delete “{word.english}”?</h2><p id="delete-description">This removes the personal word, its Favorites membership, and its learning and difficulty history in both directions. Completed results, activity totals, and study days stay as records of past practice. This cannot be undone.</p>
    {error && <p role="alert" className="answer-error">{error}</p>}
    <div className="test-actions"><button ref={cancel} className="secondary-button" onClick={onCancel}>Cancel</button><button className="danger-button" onClick={()=>{try{onDelete()}catch(e){setError(e instanceof Error?e.message:'Deletion could not be saved. Please try again.')}}}>Delete word</button></div>
  </dialog>
}
