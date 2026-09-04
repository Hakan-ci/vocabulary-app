import {useRef,useState} from 'react'
import type {ReactNode} from 'react'
import type {Application} from './data/application'
export function PracticeResume({app,source,onStart,children}:{app:Application;source:'daily'|'review';onStart:()=>void;children:ReactNode}) {
 const [continued,setContinued]=useState<string|null>(null),confirm=useRef<HTMLDialogElement>(null)
 const [restored]=useState(()=>new Set([app.current.learning.session?.syncId,app.current.learning.reviewSession?.practice.syncId,...Object.keys(app.current.learning.sessions??{})]))
 const current=source==='daily'?app.current.learning.session:app.current.learning.reviewSession?.practice
 const records=Object.values(app.current.learning.sessions??{}).filter(r=>r.source===source&&!r.archivedAt&&r.practice.phase!=='completed')
 const active=current&&current.phase!=='completed'
 if(!active&&records.length)return <><section className="test-panel resume-panel"><h2>Saved {source==='daily'?'tests':'reviews'}</h2><p>Choose an unfinished session to continue.</p>{records.map(r=><button key={r.practice.syncId} className="secondary-button" onClick={()=>{app.selectSession(source,r.practice.syncId!);setContinued(r.practice.syncId!)}}>Continue {r.practice.index} / {r.practice.questions.length} · {r.practice.startedAt?new Date(r.practice.startedAt).toLocaleString():'Earlier session'}</button>)}</section>{children}</>
 if(!active||!restored.has(current.syncId)||continued===current.syncId)return <>{children}</>
 return <section className="test-panel resume-panel"><h2>Continue your {source==='daily'?'test':'review'}</h2><p>Your question, answer draft, and progress are saved.</p>
 {records.length>1&&<label>Choose a saved session<select value={current.syncId} onChange={e=>app.selectSession(source,e.target.value)}>{records.map(r=><option key={r.practice.syncId} value={r.practice.syncId}>{r.practice.startedAt?new Date(r.practice.startedAt).toLocaleString():'Earlier session'} · {r.practice.index} / {r.practice.questions.length} answered</option>)}</select></label>}
 <p>{current.index} / {current.questions.length} answered</p><div className="test-actions"><button className="primary-button" onClick={()=>setContinued(current.syncId!)}>Continue {source==='daily'?'your test':'Review'}</button><button className="secondary-button" onClick={()=>confirm.current?.showModal()}>Start a new {source==='daily'?'test':'review'}</button></div>
 <dialog ref={confirm} aria-labelledby="restart-title" className="restart-dialog"><h2 id="restart-title">Start again?</h2><p>This session will be archived. Assessed answers and learning history remain saved; this session will not count as completed.</p><div className="test-actions"><button className="secondary-button" autoFocus onClick={()=>confirm.current?.close()}>Cancel</button><button className="primary-button" onClick={()=>{confirm.current?.close();app.archivePractice(source);onStart();const next=source==='daily'?app.current.learning.session:app.current.learning.reviewSession?.practice;setContinued(next?.syncId??null)}}>Archive and start again</button></div></dialog></section>
}
