import { PracticeResume } from './PracticeResume'
import { pruneDrafts } from './localDrafts'
import { PwaProvider, UpdateNotice } from './Pwa'
import { MobileNavigation } from './MobileNavigation'
import { ScreenBoundary } from './ScreenBoundary'
import { CatalogControls } from './CatalogControls'
import { WordTags } from './WordTags'
import { DeleteVocabulary } from './DeleteVocabulary'
import type { VocabularyDeletionPlan } from './vocabularyManagement'
import { emptyFilters, queryCatalog, vocabularyCounts, sortOptions } from './catalogQuery'
import type { CatalogSort } from './catalogQuery'
import { Meanings } from './Meanings'
import type { WordEntry } from './wordFields'
import type { VocabularyWord } from './vocabulary'
import { primaryMeaning } from './wordFields'
const Progress = lazy(() => import('./Progress').then(module => ({default:module.Progress})))
import { dashboard } from './progressModel'
import { goals } from './activity'
const Review = lazy(() => import('./Review').then(module => ({default:module.Review})))
import { reviewQueue, createReviewSession } from './reviewModel'
import { assessReviewState } from './learningState'
const AddVocabulary = lazy(() => import('./AddVocabulary').then(module => ({default:module.AddVocabulary})))
import type { EntryMode } from './AddVocabulary'
import { combinedCatalog } from './userVocabulary'
import type { ImportRow } from './vocabularyImport'
import { useState, useMemo, useEffect, useSyncExternalStore, lazy, Suspense } from 'react'
const Account = lazy(() => import('./Account').then(module => ({default:module.Account})))
import { application, connectApplication } from './data/application'
import type { Application } from './data/application'
import './App.css'
const DailyTest = lazy(() => import('./DailyTest').then(module => ({default:module.DailyTest})))
import { createSession, submitAnswer } from './dailyTestModel'
import { assessLearningState } from './learningState'
import { learnedIds, learningStatus, removeFromLearned } from './learningHistory'
import { WordDifficulty } from './WordDifficulty'
import type { TestMode } from './learningTypes'
import { useReviewClock } from './useReviewClock'
import { PronunciationButton, PronunciationProvider } from './Pronunciation'
import { usePronunciationActions } from './pronunciationContext'

function Icon({ name, size = 20 }: { name: 'book' | 'star' | 'search' | 'leaf'; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'book' && <path d="M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" />}
    {name === 'star' && <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />}
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {name === 'leaf' && <path d="M5 19C-1 7 11 3 21 3c0 12-5 18-13 14M4 21 16 9" />}
  </svg>
}
function App() {
  const app = application()
  useEffect(() => connectApplication(app), [app])
  return <ApplicationView app={app} />
}
export function ApplicationView({app}: {app: Application}) {
  useSyncExternalStore(app.subscribe, app.getSnapshot)
  return <PronunciationProvider><PwaProvider><Workspace key={app.scope} app={app} /></PwaProvider></PronunciationProvider>
}
function Workspace({app}: {app: Application}) {
  const { stop: stopPronunciation } = usePronunciationActions()
  const [view, setView] = useState<'all' | 'favorites' | 'test' | 'review' | 'learned' | 'progress' | 'account'>('all')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [deletionPlan,setDeletionPlan] = useState<VocabularyDeletionPlan | null>(null)
  const [selecting,setSelecting]=useState(false)
  const [selected,setSelected]=useState<Set<number>>(()=>new Set())
  const [sort, setSort] = useState<CatalogSort>('default')
  const userStore = { value: app.current.vocabulary }
  const words = useMemo(() => combinedCatalog(userStore.value), [userStore.value])
  const [editingWord, setEditingWord] = useState<VocabularyWord | undefined>()
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null)
  const [importNotice, setImportNotice] = useState('')
  const favoritesStore = { value: app.current.favorites, current: { get current() { return app.current.favorites } }, save: (ids: number[]) => app.saveFavorites(ids) }
  const learningStore = { value: app.current.learning, current: { get current() { return app.current.learning } }, save: (state: typeof app.current.learning) => app.saveLearning(state) }
  const clock = useReviewClock()
  const favorites = favoritesStore.value
  const history = app.current.learning.history
  const learned = useMemo(() => learnedIds(history, words), [history, words])
  const queue = useMemo(() => reviewQueue(words, history, clock.now), [words, history, clock.now])
  const reviewCount = queue.filter(entry => entry.selected.due).length
  const session = learningStore.value.session
  const sessions=learningStore.value.sessions
  const reviewSession=learningStore.value.reviewSession
  useEffect(()=>{
    pruneDrafts(app.draftScope,[...Object.values(sessions??{}),...(session?[{source:'daily' as const,practice:session}]:[]),...(reviewSession?[{source:'review' as const,practice:reviewSession.practice}]:[])])
  },[app,sessions,session,reviewSession])
  const storageError = app.storageError || app.sync?.storageError
  const toggleFavorite = (id: number) => {
    const current = favoritesStore.current.current
    favoritesStore.save(current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }
  const removeLearned = (id: number) => {
    const current = learningStore.current.current
    learningStore.save({ ...current, history: removeFromLearned(current.history, id) })
  }
  const startTest = () => {
    const current = learningStore.current.current
    clock.refresh()
    learningStore.save({ ...current, session: createSession(current.history, clock.refresh(), Math.random, current.preferredMode, current.session?.questions.map(q => q.wordId) ?? [], words) })
  }
  const setMode = (preferredMode: TestMode) => learningStore.save({ ...learningStore.current.current, preferredMode })
  const setAutoPronunciation = (autoPronunciation: boolean) => learningStore.save({ ...learningStore.current.current, autoPronunciation })
  const submit = (answer: string, identity: string) => {
    const current = learningStore.current.current
    if (current.session?.phase !== 'answering' || `${current.session.syncId ?? 'legacy'}:${current.session.index}` !== identity) return false
    learningStore.save({ ...current, session: submitAnswer({...current.session, draft:answer}) })
    return true
  }
  const assess = (known: boolean) => {
    const current = learningStore.current.current
    if (current.session?.phase !== 'feedback') return
    learningStore.save(assessLearningState(current, known, clock.refresh(), words))
    clock.refresh()
  }
  const startReview = () => {
    const current = learningStore.current.current
    if (current.reviewSession && current.reviewSession.practice.phase !== 'completed') return
    const reviewSession = createReviewSession(words, current.history, clock.refresh())
    if (reviewSession) learningStore.save({ ...current, reviewSession })
    clock.refresh()
  }
  const reviewSubmit = (answer: string, identity: string) => {
    const current = learningStore.current.current
    const review = current.reviewSession
    if (review?.practice.phase !== 'answering' || `${review.practice.syncId ?? 'legacy'}:${review.practice.index}` !== identity) return false
    learningStore.save({ ...current, reviewSession: { ...review, practice: submitAnswer({...review.practice,draft:answer}) } })
    return true
  }
  const reviewAssess = (known: boolean) => {
    const current = learningStore.current.current
    if (current.reviewSession?.practice.phase !== 'feedback') return
    learningStore.save(assessReviewState(current, known, clock.refresh(), words))
    clock.refresh()
  }
  const importWords = (rows: ImportRow[]) => {
    const result = app.importWords(rows)
    if (!result.added && !result.updated) return 0
    setEntryMode(null)
    setImportNotice(`${result.added} words added · ${result.updated} words updated.`)
    return result.added + result.updated
  }
  const editWord = (id: number, entry: WordEntry, separate: boolean) => {
    app.editWord(id,entry,separate)
    setEditingWord(undefined); setEntryMode(null); setImportNotice('Word updated. Learning history preserved.')
  }
  const setGoal = (dailyGoal: number) => {
    if (goals.some(goal => goal === dailyGoal)) learningStore.save({ ...learningStore.current.current, dailyGoal })
  }
  const clearFilters = () => { setSearch(''); setFilters(emptyFilters()) }
  const filtered = queryCatalog(words, history, favorites, filters, search, sort, clock.now, view === 'favorites' || view === 'learned' ? view : 'all')
  const counts = vocabularyCounts(words,history,clock.now)
  const confirmDeletion=()=>{if(!deletionPlan)return;const result=app.deleteWords(deletionPlan.ids);setDeletionPlan(null);setSelecting(false);setSelected(new Set());setImportNotice(`${result.personalIds.length} personal words deleted · ${result.builtInIds.length} built-in words hidden.`)}
  const emptyCollection = (view === 'favorites' && !favorites.length) || (view === 'learned' && !learned.length)
  const changeView = (next: typeof view) => { stopPronunciation();setSelecting(false);setSelected(new Set());setView(next); clearFilters(); clock.refresh() }
  return <div className="app-shell">
    <MobileNavigation view={view} onChange={changeView} reviewCount={reviewCount} />
    {deletionPlan && <DeleteVocabulary plan={deletionPlan} onCancel={()=>setDeletionPlan(null)} onDelete={confirmDeletion} />}
    {app.pendingDeletion&&<div className="undo-notice" role="status">Words removed <button onClick={()=>app.undoVocabularyDeletion()}>Undo</button></div>}
    <aside className="sidebar">
      <a href="#" className="brand" onClick={() => changeView('all')} aria-label="Kelime home"><span className="brand-mark"><Icon name="book" size={23} /></span>kelime<span className="brand-dot">.</span></a>
      <div className="sidebar-label">YOUR LEARNING SPACE</div>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${view === 'all' ? 'active' : ''}`} onClick={() => changeView('all')} aria-current={view === 'all' ? 'page' : undefined}><Icon name="book" /> Vocabulary <span>{words.length}</span></button>
        <button className={`nav-item ${view === 'favorites' ? 'active' : ''}`} onClick={() => changeView('favorites')} aria-current={view === 'favorites' ? 'page' : undefined}><Icon name="star" /> Favorites <span>{favorites.length}</span></button>
        <button className={`nav-item ${view === 'test' ? 'active' : ''}`} onClick={() => changeView('test')} aria-current={view === 'test' ? 'page' : undefined}><Icon name="book" /> Daily Test</button>
        <button className={`nav-item ${view === 'review' ? 'active' : ''}`} onClick={() => changeView('review')} aria-current={view === 'review' ? 'page' : undefined}><Icon name="book" /> Review <span>{reviewCount}</span></button>
        <button className={`nav-item ${view === 'learned' ? 'active' : ''}`} onClick={() => changeView('learned')} aria-current={view === 'learned' ? 'page' : undefined}><Icon name="leaf" /> Learned <span>{learned.length}</span></button>
        <button className={`nav-item ${view === 'progress' ? 'active' : ''}`} onClick={() => changeView('progress')} aria-current={view === 'progress' ? 'page' : undefined}><Icon name="leaf" /> Progress</button>
        <button className={`nav-item ${view === 'account' ? 'active' : ''}`} onClick={() => changeView('account')} aria-current={view === 'account' ? 'page' : undefined}><Icon name="leaf" /> Account</button>
      </nav>
      <div className="sidebar-bottom"><div className="little-note"><Icon name="leaf" size={25} /><h3>A little, every day.</h3><p>Small steps today.<br />A world of words tomorrow.</p></div><div className="language-pair"><span>EN</span> → <span>TR</span><small>English to Turkish</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><button className="sync-indicator" onClick={() => changeView('account')} aria-label={`Account: ${app.status}`}>{app.status}</button><div className="course"><span className="status-dot" /> English <span>→</span> <span lang="tr">Türkçe</span></div></header>
      <main>
        <UpdateNotice blocked={entryMode!==null||!!storageError} save={()=>app.ensureSaved()} />
        {app.networkNotice && <p className="network-notice" role="status">{app.networkNotice}</p>}
        <ScreenBoundary key={view}><Suspense fallback={<p role="status" className="test-panel">Loading your learning space…</p>}>
        <section className="intro"><div className="eyebrow">WORDS OPEN WORLDS</div><h1>{view === 'account' ? 'Your personal learning space.' : view === 'progress' ? 'See how far you’ve come.' : view === 'review' ? 'Keep good words close.' : view === 'test' ? 'A little practice. Lasting progress.' : view === 'learned' ? 'Look how far you’ve come.' : view === 'all' ? 'A new word. A new possibility.' : 'Good words, worth keeping.'}</h1><p>{view === 'account' ? 'Keep your words close, on every device.' : view === 'progress' ? 'Small moments of practice, meaningful progress.' : view === 'review' ? 'A timely review makes a lasting memory.' : view === 'test' ? 'Recall, reflect, and make each word your own.' : view === 'learned' ? 'The words you know, ready to revisit whenever you like.' : view === 'all' ? 'Build your English vocabulary, one little discovery at a time.' : 'Your personal collection. Come back, revisit, and make them yours.'}</p></section>
        {storageError && <p className="storage-notice" role="status">Your browser couldn’t read or save some learning data. You can keep practicing, but changes may not survive a refresh.</p>}
        {app.migrationOpen && view !== 'account' && <p className="storage-notice">We found learning data on this device. <button className="secondary-button" onClick={() => changeView('account')}>Review synchronization options</button></p>}
        {(view==='test'||view==='review')&&app.isProvisional(view==='test'?'daily':'review')&&<p className="network-notice">These results are provisional until synchronization finishes.</p>}
        {view === 'account' ? <Account app={app} autoPronunciation={learningStore.value.autoPronunciation} onAutoPronunciationChange={setAutoPronunciation} /> : view === 'progress' ? <Progress data={dashboard(words, history, favorites, learningStore.value.activity, clock.now)} goal={learningStore.value.dailyGoal} onGoal={setGoal} onReview={() => changeView('review')} /> : view === 'review' ? <PracticeResume key="review" app={app} source="review" onStart={startReview}><Review history={history} now={clock.now} catalog={words} queue={queue} session={learningStore.value.reviewSession} autoPronunciation={learningStore.value.autoPronunciation} onAutoPronunciationChange={setAutoPronunciation} onStart={startReview} draftScope={app.draftScope} onSubmit={reviewSubmit} onAssess={reviewAssess} /></PracticeResume> : view === 'test' ? <PracticeResume key="daily" app={app} source="daily" onStart={startTest}><DailyTest history={history} now={clock.now} catalog={words} mode={learningStore.value.preferredMode} onModeChange={setMode} autoPronunciation={learningStore.value.autoPronunciation} onAutoPronunciationChange={setAutoPronunciation} session={session} onStart={startTest} draftScope={app.draftScope} onSubmit={submit} onAssess={assess} onLearned={() => changeView('learned')} /></PracticeResume> : <>
        <section className="featured" aria-label="Featured word"><div className="featured-copy"><div className="featured-label"><span>✧</span> A WORD TO INSPIRE YOU</div><div className="featured-word">Discover <span>verb</span></div><div className="featured-translation" lang="tr">Keşfetmek</div><p>“There is always something new to discover.”</p></div><div className="word-art" aria-hidden="true"><span className="art-spark spark-one">✧</span><div className="art-card art-back"><span>Merhaba</span><small>A world of possibilities</small></div><div className="art-card art-front"><Icon name="leaf" size={26} /><span>Hello<span className="art-dot">.</span></span><small>It starts with a word.</small></div><span className="art-spark spark-two">✦</span></div></section>
        <section className="vocabulary" aria-labelledby="vocabulary-heading">
          <div className="section-heading"><div><h2 id="vocabulary-heading">{view === 'learned' ? 'Your learned words' : view === 'all' ? 'Your vocabulary' : 'Your favorites'} <span>{view === 'all' ? words.length : view === 'learned' ? learned.length : favorites.length}</span></h2><p>{view === 'all' ? 'Explore, save, and make these words your own.' : 'A little collection for your next learning moment.'}</p></div>{view === 'all' && <div className="entry-actions"><button className="secondary-button" onClick={() => { setSelecting(false);setSelected(new Set());setEditingWord(undefined); setEntryMode('single'); setImportNotice('') }}>Add Word</button><button className="primary-button" onClick={() => { setSelecting(false);setSelected(new Set());setEditingWord(undefined); setEntryMode('bulk'); setImportNotice('') }}>Bulk Add</button><button className="secondary-button" aria-pressed={selecting} onClick={()=>{setEntryMode(null);setEditingWord(undefined);setSelecting(true)}}>Select</button></div>}</div>
          {view === 'all' && entryMode && <AddVocabulary key={editingWord?.id ?? 'new'} editingWord={editingWord} onEdit={editWord} mode={entryMode} onMode={setEntryMode} catalog={words} onClose={() => {setEntryMode(null);setEditingWord(undefined)}} onSave={importWords} />}
          {importNotice && <p className="import-notice" role="status">{importNotice}</p>}
          <div className="search-row"><div className="search-box"><Icon name="search" /><input aria-label="Search vocabulary" placeholder="Search words, meanings, examples, tags…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="clear-search" aria-label="Clear search" onClick={() => setSearch('')}>×</button>}</div><label className="sort-control">Sort by <select value={sort} onChange={event => setSort(event.target.value as CatalogSort)} aria-label="Sort vocabulary">{sortOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
          <CatalogControls catalog={words} value={filters} onChange={setFilters} onClear={clearFilters} />
          <div className="catalog-summary" aria-label="Vocabulary summary">{Object.entries(counts).map(([label,count])=><span key={label}>{label}: <strong>{count}</strong></span>)}</div>
          <p className="test-hint">Catalog-wide totals. Needs Review can overlap Learned or Learning.</p>
          <p className="catalog-results" role="status">{filtered.length} {filtered.length===1?'word':'words'} matching your search and filters</p>
          {selecting&&<div className="selection-toolbar" aria-live="polite"><strong>{selected.size} selected</strong>{[...selected].some(id=>!filtered.some(word=>word.id===id))&&<span>{[...selected].filter(id=>!filtered.some(word=>word.id===id)).length} outside current results</span>}<button className="secondary-button" onClick={()=>setSelected(current=>new Set([...current,...filtered.map(word=>word.id)]))}>Select all results</button><button className="secondary-button" onClick={()=>setSelected(new Set())}>Deselect all</button><button className="danger-button" disabled={!selected.size} onClick={()=>setDeletionPlan(app.deletionPlan([...selected]))}>Delete Selected</button><button className="secondary-button" onClick={()=>{setSelecting(false);setSelected(new Set())}}>Cancel</button></div>}
          <div className="word-grid">{filtered.map(word => <article className={`word-card ${selecting&&selected.has(word.id)?'selected':''}`} key={word.id}>{selecting&&<label className="select-word"><input type="checkbox" checked={selected.has(word.id)} onChange={()=>setSelected(current=>{const next=new Set(current);if(next.has(word.id))next.delete(word.id);else next.add(word.id);return next})}/><span>Select {word.english}</span></label>}<div className="card-top"><WordTags tags={word.tags} />{!selecting&&<button className={`favorite-button ${favorites.includes(word.id) ? 'saved' : ''}`} onClick={() => toggleFavorite(word.id)} aria-label={`${favorites.includes(word.id) ? 'Remove' : 'Add'} ${word.english} ${favorites.includes(word.id) ? 'from' : 'to'} favorites`} aria-pressed={favorites.includes(word.id)}><Icon name="star" /></button>}</div><WordDifficulty history={history[word.id]} now={clock.now} status={learningStatus(history[word.id], clock.now)} /><div className="word-title-row"><h3>{word.english}</h3>{!selecting&&<PronunciationButton text={word.english} speechKey={`word:${word.id}`} />}</div><p className="word-translation" lang="tr">{primaryMeaning(word)}</p><Meanings word={word} />{word.example && <p className="word-example" lang="en">{word.example}</p>}<div className="card-bottom">{word.partOfSpeech && <span>{word.partOfSpeech}</span>}<span>EN <span className="tiny-arrow">→</span> TR</span></div>{!selecting&&<><button className="edit-word" aria-label={`Edit ${word.english}`} onClick={() => {setView('all');setEditingWord(word);setEntryMode('single');setImportNotice('')}}>Edit</button>{userStore.value.entries.some(w=>w.id===word.id) && <div className="delete-word-action"><button className="delete-word" aria-label={`Delete ${word.english}`} onClick={()=>setDeletionPlan(app.deletionPlan([word.id]))}>Delete</button></div>}{view === 'learned' && <button className="remove-learned" aria-label={`Remove ${word.english} from Learned`} onClick={() => removeLearned(word.id)}>Remove from Learned</button>}</>}</article>)}</div>
          {filtered.length === 0 && <div className="empty-state">
            <Icon name={view === 'learned' ? 'leaf' : view === 'favorites' ? 'star' : 'search'} size={32} />
            <h3>{emptyCollection ? view === 'learned' ? 'Your progress starts with practice.' : 'Your collection starts with a star.' : 'No words found.'}</h3>
            <p>{emptyCollection ? view === 'learned' ? 'Choose “I knew this” during Daily Test or Review to add words here.' : 'Tap the star on any vocabulary card to save it here.' : 'Try another word or adjust your filters.'}</p>
            <button onClick={() => { if (emptyCollection) changeView(view === 'learned' ? 'test' : 'all'); else { clearFilters() } }}>{emptyCollection ? view === 'learned' ? 'Open Daily Test' : 'Explore vocabulary' : 'Clear filters'} →</button>
          </div>}
        </section>
        </>}
        </Suspense></ScreenBoundary>
        <footer><span>Made for curious minds.</span><span>One word closer, every day. <Icon name="leaf" size={14} /></span></footer>
      </main>
    </div>
  </div>
}
export default App
