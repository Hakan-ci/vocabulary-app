import { useState } from 'react'
import { normalizeTags, tagKey } from './wordFields'
export function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [draft,setDraft] = useState('')
  const add = () => { if (draft.trim()) { onChange(normalizeTags([...tags,draft])); setDraft('') } }
  return <fieldset className="answer-fields tag-editor"><legend>Category / tags (optional)</legend>
    <div className="tag-chips">{tags.map(tag => <span className="tag-chip" key={tag}>{tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(t => t !== tag))}>×</button></span>)}</div>
    <div className="tag-entry"><label>New tag<input value={draft} list="tag-suggestions" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') {e.preventDefault();add()} }} /></label><button type="button" className="secondary-button" onClick={add} disabled={!draft.trim()}>Add tag</button></div>
    <datalist id="tag-suggestions">{suggestions.filter(t => !tags.some(tag => tagKey(tag) === tagKey(t))).map(tag => <option key={tag} value={tag} />)}</datalist>
    <p className="test-hint">Choose a suggestion or create your own tag. Press Enter or Add tag to include it.</p>
  </fieldset>
}
