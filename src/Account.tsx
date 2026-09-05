import { InstallButton } from './Pwa'
import { useState } from 'react'
import type { Application } from './data/application'
import { DataManagement } from './DataManagement'
import { AutoPronunciationSetting } from './Pronunciation'
export function Account({app,autoPronunciation,onAutoPronunciationChange}:{app:Application;autoPronunciation:boolean;onAutoPronunciationChange:(value:boolean)=>void}) {
  const [signup,setSignup]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{const result=await action();if(typeof result==='string')setMessage(result)}catch(e){setMessage(e instanceof Error?e.message:'Please try again.')}finally{setBusy(false)}}
  const preview=app.previewOpen?app.preview:null
  return <section className="test-panel account-panel" aria-label="Account">
    <h2>Your learning, wherever you go.</h2><InstallButton/>
    <section className="account-setting" aria-label="Pronunciation settings"><h3>Pronunciation</h3><AutoPronunciationSetting checked={autoPronunciation} onChange={onAutoPronunciationChange} /></section>
    {!app.configured?<p>Synchronization is not configured yet. Your vocabulary and practice continue locally. Follow SUPABASE_SETUP.md to connect a project.</p>:!app.user||!app.authenticated?<>
      <p>{app.user?'Your cached account is available offline. Sign in again to resume synchronization.':''}</p><p>Sign in to synchronize your vocabulary and progress. You can also keep using this device locally.</p>
      {app.user&&<button className="secondary-button" onClick={()=>void run(()=>app.auth.signOut())}>Sign out of cached account</button>}
      <form onSubmit={e=>{e.preventDefault();void run(()=>signup?app.auth.signUp(email,password):app.auth.signIn(email,password))}}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Password<input type="password" autoComplete={signup?'new-password':'current-password'} required minLength={6} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <div className="test-actions"><button className="primary-button" disabled={busy}>{signup?'Sign up':'Sign in'}</button><button type="button" className="secondary-button" onClick={()=>setSignup(!signup)}>{signup?'I already have an account':'Create an account'}</button></div>
      </form></>:<>
      <p>Signed in as <strong>{app.user.email}</strong></p><p role="status">{app.status}{app.scope==='guest'?' · Account synchronization is paused.':''}</p>
      <div className="test-actions"><button className="secondary-button" onClick={()=>void run(()=>app.auth.signOut())} disabled={busy}>Sign out</button><button className="secondary-button" onClick={()=>void app.retry()}>Retry sync</button>{app.scope==='guest'&&!app.migrationOpen&&<button className="primary-button" onClick={()=>app.beginMigration()}>Set up synchronization</button>}</div>
      <p className="test-hint">Signing out returns to this device’s separate local vocabulary. Pending account actions stay saved for this account.</p>
    </>}
    {app.migrationOpen&&<section className="migration-panel" aria-label="Local data migration"><h3>We found learning data on this device.</h3><p>Your local copy stays on this device. Nothing is overwritten without your choices.</p>
      {!app.previewOpen?<div className="test-actions"><button className="primary-button" onClick={()=>app.previewMigration()}>Sync local data to account</button><button className="secondary-button" onClick={()=>app.chooseAccount()}>Keep account data</button><button className="secondary-button" onClick={()=>app.cancelMigration()}>Cancel</button></div>:<>
        <p>A device backup has been saved. {preview?.additions} non-conflicting records · {preview?.historicalAnswers} available historical answers. Missing historical dates stay unavailable; imported answers do not count twice.</p>
        {app.candidates.map(({word,candidates})=><label key={word.id}>Possible duplicate: {word.english}<select value={app.links[word.id]??''} onChange={e=>app.chooseLink(word.id,e.target.value)}><option value="">Choose…</option><option value="new">Keep as a separate word</option>{candidates.map(c=><option key={c.ref} value={c.ref}>Link to {c.word.english} · {c.word.turkishMeanings.join('; ')}</option>)}</select></label>)}
        {preview?.conflicts.map(conflict=><div className="sync-conflict" key={conflict.key}><h4>{conflict.label}</h4><details><summary>Compare device and account</summary><strong>Device</strong><pre>{JSON.stringify(conflict.device,null,2)}</pre><strong>Account</strong><pre>{JSON.stringify(conflict.account,null,2)}</pre></details><div className="test-actions"><button className="secondary-button" onClick={()=>app.chooseConflict(conflict.key,'device')}>Use device values</button><button className="secondary-button" onClick={()=>app.chooseConflict(conflict.key,'account')}>Use account values</button></div></div>)}
        <div className="test-actions"><button className="primary-button" disabled={!!preview?.conflicts.length||app.candidates.some(c=>!app.links[c.word.id])} onClick={()=>void run(async()=>app.commitMigration())}>Confirm import</button><button className="secondary-button" onClick={()=>app.cancelMigration()}>Cancel</button></div>
      </>}
    </section>}
    {app.sync&&<><p>{app.sync.cache.queue.length} pending or conflicted actions</p>{app.sync.cache.queue.filter(op=>op.status==='conflict').map(op=><div className="sync-conflict" key={op.id}><h3>{op.kind} conflict</h3><p>{op.message}</p><details><summary>Saved device action</summary><pre>{app.exportConflict(op.id)}</pre></details><button className="secondary-button" onClick={()=>app.sync?.resolve(op.id,'account')}>Continue with account data</button>{['vocabulary','favorite','learned','preferences'].includes(op.kind)&&<button className="secondary-button" onClick={()=>app.sync?.resolve(op.id,'device')}>Apply my values to current account</button>}</div>)}{app.sync.cache.backups.length>0&&<details><summary>Preserved conflict actions ({app.sync.cache.backups.length})</summary><pre>{JSON.stringify(app.sync.cache.backups,null,2)}</pre></details>}</>}
    {(message||app.error||app.sync?.error)&&<p className="answer-error" role="alert">{message||app.error||app.sync?.error}</p>}
    <DataManagement app={app}/>
  </section>
}
