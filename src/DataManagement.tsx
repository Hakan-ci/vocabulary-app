import { useEffect, useRef, useState } from 'react'
import type { Application } from './data/application'
import type { ClearLevel } from './vocabularyManagement'
import { words } from './vocabulary'

const descriptions:Record<ClearLevel,{title:string;body:string}>={
 personal:{title:'Delete only my added words',body:'Deletes personal vocabulary and active progress, archives affected unfinished practice, and preserves built-in words and historical activity.'},
 progress:{title:'Reset vocabulary and learning progress',body:'Restores shipped built-ins, removes personal words, edits, hidden words, Favorites and current progress. Historical completed practice and activity remain; your goal and direction stay.'},
 everything:{title:'Clear everything',body:'Also removes historical sessions, answers, activity, streaks, conflicts and migration backups. Your account, sign-in, ID high-water marks, sync receipts and PWA files remain.'},
}
function ClearDialog({level,onCancel,onConfirm}:{level:ClearLevel;onCancel:()=>void;onConfirm:(text:string)=>void}){
 const ref=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),[text,setText]=useState(''),[error,setError]=useState('')
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,dialog=ref.current!;dialog.showModal();cancel.current?.focus();return()=>{dialog.close();previous?.focus()}},[])
 return <dialog ref={ref} className="delete-dialog" onCancel={event=>{event.preventDefault();onCancel()}} aria-labelledby="clear-title"><h2 id="clear-title">{descriptions[level].title}?</h2><p>{descriptions[level].body}</p>{level==='everything'&&<label>Type <strong>DELETE</strong> to confirm<input autoComplete="off" value={text} onChange={event=>setText(event.target.value)}/></label>}{error&&<p role="alert" className="answer-error">{error}</p>}<div className="test-actions"><button ref={cancel} className="secondary-button" onClick={onCancel}>Cancel</button><button className="danger-button" disabled={level==='everything'&&text.trim()!=='DELETE'} onClick={()=>{try{onConfirm(text)}catch(e){setError(e instanceof Error?e.message:'The action could not be saved.')}}}>Confirm</button></div></dialog>
}
export function DataManagement({app}:{app:Application}){
 const [clear,setClear]=useState<ClearLevel|null>(null),hidden=app.current.vocabulary.hiddenBuiltinIds.map(id=>app.current.vocabulary.overrides[id]??words.find(word=>word.id===id)).filter(Boolean)
 return <section className="data-management" aria-labelledby="data-management-title"><h2 id="data-management-title">Data Management</h2><p>Manage vocabulary stored in {app.scope==='guest'?'this browser':'your synchronized account'}.</p>
  <details><summary>Hidden built-in words ({hidden.length})</summary>{hidden.length===0?<p className="test-hint">No built-in words are hidden.</p>:<><ul className="hidden-word-list">{hidden.map(word=><li key={word!.id}><span><strong>{word!.english}</strong> · {word!.turkishMeanings[0]}</span><button className="secondary-button" onClick={()=>app.restoreBuiltIns([word!.id])}>Restore</button></li>)}</ul><button className="secondary-button" onClick={()=>app.restoreBuiltIns(hidden.map(word=>word!.id))}>Restore all</button></>}</details>
  <h3>Clear Vocabulary</h3>{(Object.keys(descriptions) as ClearLevel[]).map(level=><div className="clear-option" key={level}><div><strong>{descriptions[level].title}</strong><p>{descriptions[level].body}</p></div><button className={level==='everything'?'danger-button':'secondary-button'} onClick={()=>setClear(level)}>{level==='everything'?'Clear everything':'Continue'}</button></div>)}
  {clear&&<ClearDialog level={clear} onCancel={()=>setClear(null)} onConfirm={text=>{app.clearVocabulary(clear,text);setClear(null)}}/>}
 </section>
}
