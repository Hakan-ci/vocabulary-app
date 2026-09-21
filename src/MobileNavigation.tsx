import {useEffect,useRef,useState} from 'react'
import {InstallButton} from './Pwa'
export type View='all'|'favorites'|'test'|'aiPractice'|'review'|'learned'|'progress'|'account'
export function MobileNavigation({view,onChange,reviewCount}:{view:View;onChange:(view:View)=>void;reviewCount:number}) {
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close()},[open])
 useEffect(()=>{
  const refresh=()=>{const viewport=window.visualViewport;const focused=document.activeElement;const editing=focused instanceof HTMLInputElement||focused instanceof HTMLTextAreaElement;const keyboard=!!viewport&&editing&&window.innerHeight-viewport.height>120;document.documentElement.classList.toggle('keyboard-open',keyboard);document.documentElement.style.setProperty('--visible-height',`${viewport?.height??window.innerHeight}px`)}
  visualViewport?.addEventListener('resize',refresh);document.addEventListener('focusin',refresh);document.addEventListener('focusout',refresh)
  return()=>{visualViewport?.removeEventListener('resize',refresh);document.removeEventListener('focusin',refresh);document.removeEventListener('focusout',refresh);document.documentElement.classList.remove('keyboard-open')}
 },[])
 const close=()=>{setOpen(false);trigger.current?.focus()}
 const navigate=(next:View)=>{close();onChange(next)}
 return <><nav className="mobile-nav" aria-label="Mobile navigation">{([['all','Vocabulary','▤'],['test','Daily Test','✎'],['review','Review','↻'],['aiPractice','AI Practice','◇']] as const).map(([value,label,symbol])=><button key={value} aria-current={view===value?'page':undefined} onClick={()=>onChange(value)}><span aria-hidden="true">{symbol}</span><span>{label}{value==='review'&&reviewCount>0?` (${reviewCount})`:''}</span></button>)}<button ref={trigger} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(true)}><span aria-hidden="true">•••</span><span>More</span></button></nav><dialog ref={dialog} className="more-drawer" aria-labelledby="more-title" onCancel={close} onClose={()=>setOpen(false)}><div className="drawer-heading"><h2 id="more-title">More from Kelime</h2><button className="secondary-button" onClick={close} autoFocus>Close</button></div>{([['progress','Progress'],['favorites','Favorites'],['learned','Learned'],['account','Account']] as const).map(([value,label])=><button key={value} className="secondary-button" onClick={()=>navigate(value)}>{label}</button>)}<InstallButton/></dialog></>
}
