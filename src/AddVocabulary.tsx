import { TagEditor } from './TagEditor'
import { catalogTags } from './catalogQuery'
import { speechSuggestions } from './wordFields'
import { useEffect, useRef, useState } from 'react'
import type { VocabularyWord } from './vocabulary'
import { classifyPreview, parseVocabulary, validateEntry } from './vocabularyImport'
import type { ImportRow } from './vocabularyImport'
import type { WordEntry } from './wordFields'
import { englishKey } from './wordFields'
import { PronunciationButton } from './Pronunciation'
import { usePronunciation } from './pronunciationContext'
export type EntryMode = 'single' | 'bulk'
type Props = { mode: EntryMode; onMode: (mode: EntryMode) => void; catalog: readonly VocabularyWord[]; editingWord?: VocabularyWord; onClose: () => void; onSave: (rows: ImportRow[]) => number; onEdit: (id: number, entry: WordEntry, separate: boolean) => void }
function AnswerFields({ values, onChange, language }: { values: string[]; onChange: (values: string[]) => void; language: 'Turkish' | 'English' }) {
  const move = (index: number, to: number) => { const copy = [...values]; const [value] = copy.splice(index,1); copy.splice(to,0,value); onChange(copy) }
  return <fieldset className="answer-fields"><legend>{language === 'Turkish' ? 'Turkish meanings' : 'English alternatives (optional)'}</legend>
    {values.map((value,index) => <div className="meaning-row" key={index}><label>{language} {language === 'Turkish' ? 'meaning' : 'alternative'} {index+1}{language === 'Turkish' && index === 0 ? ' · Primary' : ''}<input lang={language === 'Turkish' ? 'tr' : 'en'} required={language === 'Turkish'} value={value} onChange={e => onChange(values.map((old,i) => i === index ? e.target.value : old))} /></label>
      <div className="meaning-actions"><button type="button" disabled={index === 0} onClick={() => move(index,index-1)} aria-label={`Move ${language} answer ${index+1} up`}>↑</button><button type="button" disabled={index === values.length-1} onClick={() => move(index,index+1)} aria-label={`Move ${language} answer ${index+1} down`}>↓</button>{language === 'Turkish' && index > 0 && <button type="button" onClick={() => move(index,0)}>Make primary</button>}<button type="button" disabled={language === 'Turkish' && values.length === 1} onClick={() => onChange(values.filter((_,i) => i !== index))} aria-label={`Remove ${language} answer ${index+1}`}>Remove</button></div>
    </div>)}
    <button className="secondary-button" type="button" onClick={() => onChange([...values,''])}>{language === 'Turkish' ? 'Add meaning' : 'Add English alternative'}</button>
  </fieldset>
}
export function AddVocabulary({ mode, onMode, catalog, editingWord, onClose, onSave, onEdit }: Props) {
  const { stop: stopPronunciation } = usePronunciation()
  const [english,setEnglish] = useState(editingWord?.english ?? '')
  const [meanings,setMeanings] = useState(editingWord?.turkishMeanings ?? [''])
  const [alternatives,setAlternatives] = useState(editingWord?.englishAlternatives ?? [])
  const [tags,setTags] = useState(editingWord?.tags ?? [])
  const [speech,setSpeech] = useState(editingWord?.partOfSpeech ?? '')
  const [example,setExample] = useState(editingWord?.example ?? '')
  const [separate,setSeparate] = useState(false)
  const [text,setText] = useState(''), [rows,setRows] = useState<ImportRow[] | null>(null), [error,setError] = useState('')
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { if (editingWord) { panel.current?.scrollIntoView({block:'start'}); panel.current?.querySelector('input')?.focus() } }, [editingWord])
  useEffect(() => stopPronunciation, [stopPronunciation])
  const invalidate = () => { setRows(null); setError('') }
  const preview = rows === null ? null : classifyPreview(rows,catalog)
  const valid = preview?.filter(row => row.status === 'Ready' || row.status === 'Merge').length ?? 0
  const conflicts = editingWord ? catalog.filter(w => w.id !== editingWord.id && englishKey(w.english) === englishKey(english)) : []
  return <section ref={panel} className="add-panel" aria-label={editingWord ? 'Edit vocabulary' : 'Add vocabulary'}>
    <div className="add-panel-heading">{editingWord ? <h3>Edit word</h3> : <div className="add-tabs" role="group" aria-label="Entry method"><button className={mode==='single'?'active':''} aria-pressed={mode==='single'} onClick={() => {onMode('single');invalidate()}}>Add Word</button><button className={mode==='bulk'?'active':''} aria-pressed={mode==='bulk'} onClick={() => {onMode('bulk');invalidate()}}>Bulk Add</button></div>}<button className="secondary-button" onClick={onClose}>Close</button></div>
    {mode === 'single' || editingWord ? <form onSubmit={event => {
      event.preventDefault(); setError('')
      const entry=validateEntry({english,turkishMeanings:meanings,englishAlternatives:alternatives,partOfSpeech:speech,example,tags})
      if (!entry) {setError('English and at least one Turkish meaning are required.');return}
      if (editingWord) {try {onEdit(editingWord.id,entry,separate)} catch(e) {setError(e instanceof Error ? e.message : 'Your changes could not be saved. Try again.')}}
      else setRows([{id:0,source:english,entry}])
    }}>
      <div className="entry-fields"><label>English<span className="editor-english-row"><input required lang="en" value={english} onChange={e => {setEnglish(e.target.value);setSeparate(false);invalidate()}} /><PronunciationButton text={english.trim()} speechKey="editor:english" label="Pronounce current English word" disabled={!english.trim()} /></span></label><label>Part of speech (optional)<input list="speech-suggestions" value={speech} onChange={e => {setSpeech(e.target.value);invalidate()}} /></label><label>Example sentence (optional)<textarea rows={3} lang="en" value={example} onChange={e => {setExample(e.target.value);invalidate()}} /></label></div>
      <datalist id="speech-suggestions">{speechSuggestions.map(s => <option key={s} value={s} />)}</datalist>
      <TagEditor tags={tags} suggestions={catalogTags(catalog)} onChange={v=>{setTags(v);invalidate()}} />
      <AnswerFields language="Turkish" values={meanings} onChange={v => {setMeanings(v);invalidate()}} />
      <AnswerFields language="English" values={alternatives} onChange={v => {setAlternatives(v);invalidate()}} />
      <p className="test-hint">Teach meanings from one context. English alternatives must be valid answers for every Turkish meaning here.</p>
      {conflicts.length > 0 && <label className="separate-choice"><input type="checkbox" checked={separate} onChange={e => setSeparate(e.target.checked)} /> Keep as a separate entry (preserves this word’s ID and history)</label>}
      <button className="primary-button" type="submit" disabled={!!editingWord && conflicts.length > 0 && !separate}>{editingWord?'Save word':'Preview word'}</button>
    </form> : <>
      <label className="bulk-label" htmlFor="bulk-words">Paste your vocabulary</label><p className="test-hint" id="bulk-help">Separate English and Turkish with tabs or spaced hyphens. Use semicolons between Turkish meanings; optional third and fourth columns are part of speech and comma-separated tags.</p>
      <pre className="import-example">{'commute - işe gidip gelmek - verb - Work, Travel\nlook after - bakmak; ilgilenmek\nbook\tkitap'}</pre>
      <textarea id="bulk-words" rows={7} aria-describedby="bulk-help" value={text} onChange={e => {setText(e.target.value);invalidate()}} placeholder="Paste words here…" />
      <button className="secondary-button" disabled={!text.trim()} onClick={() => {setRows(parseVocabulary(text));setError('')}}>Preview</button>
    </>}
    {preview && !editingWord && <>
      <p className="import-counts" role="status">{preview.length} detected · {preview.filter(r=>r.status==='Ready').length} ready · {preview.filter(r=>r.status==='Merge').length} merges · {preview.filter(r=>r.status==='Duplicate').length} duplicates · {preview.filter(r=>r.status==='Needs resolution').length} need resolution · {preview.filter(r=>r.status==='Invalid').length} invalid</p>
      <div className="preview-scroll" tabIndex={0} role="region" aria-label="Vocabulary preview"><table className="import-table"><thead><tr><th>English</th><th>Turkish meanings</th><th>Status / target</th><th>Remove</th></tr></thead><tbody>{preview.map(row => <tr key={row.id}><td>{row.entry?.english ?? row.source}{row.entry?.partOfSpeech && <small>{row.entry.partOfSpeech}</small>}<small>{row.entry?.tags.length ? `Tags: ${row.entry.tags.join(", ")}` : "Untagged"}</small>{row.entry?.englishAlternatives?.length ? <small>Alternatives: {row.entry.englishAlternatives.join('; ')}</small> : null}{row.error && <small>{row.error}</small>}</td><td lang="tr">{row.entry?.turkishMeanings.map(m => <div key={m}>{m}</div>) ?? '—'}{row.target && <><small>Existing: {row.target.turkishMeanings.join('; ')}</small><small>Add: {row.additions.join('; ') || 'No new meanings'}</small><small>Add tags: {row.tagAdditions.join(', ') || 'No new tags'}</small></>}</td><td><span className="import-status">{row.status}</span>{row.target && <small>Target: {row.target.english} ({row.target.partOfSpeech ?? 'unspecified'})</small>}{row.candidates.length > 0 && row.entry && <select aria-label={`Resolve row ${row.id+1}`} value={row.resolution ?? ''} onChange={e => setRows(current => current!.map(r => r.id === row.id ? {...r,resolution:e.target.value === '' ? undefined : e.target.value === 'new' ? 'new' : Number(e.target.value)} : r))}><option value="">{row.status === 'Needs resolution' ? 'Choose…' : 'Proposed target'}</option>{row.candidates.map(w => <option key={w.id} value={w.id}>{w.english} · {w.partOfSpeech ?? 'unspecified'} · {w.turkishMeanings[0]}</option>)}<option value="new">Create separate entry</option></select>}</td><td><button className="preview-remove" aria-label={`Remove row ${row.id+1}: ${row.entry?.english ?? row.source}`} onClick={() => setRows(current => current!.filter(r => r.id !== row.id))}>×</button></td></tr>)}</tbody></table></div>
      <p className="test-hint">Merges append only the new Turkish meanings and tags shown above. The target’s primary meaning, English alternatives, example, and part of speech stay unchanged. Unresolved and invalid rows will not be saved.</p>
      <button className="primary-button" disabled={!valid} onClick={() => {setError('');try {const count=onSave(preview.map(r=>({...r,resolution:r.status==='Merge'?r.target!.id:r.resolution})));if(!count)setError('No new words, meanings, or tags to save.')}catch{setError('Your changes could not be saved. Check browser storage and try again; your preview is still here.')}}}>Save valid changes</button>
    </>}
    {error && <p className="answer-error" role="alert">{error}</p>}
  </section>
}
