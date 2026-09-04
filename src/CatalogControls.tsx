import type { VocabularyWord } from './vocabulary'
import { catalogTags } from './catalogQuery'
import type { CatalogFilters } from './catalogQuery'
import { normalizeTags } from './wordFields'
export function CatalogControls({ catalog, value, onChange, onClear }: { catalog: readonly VocabularyWord[]; value: CatalogFilters; onChange: (filters: CatalogFilters) => void; onClear: () => void }) {
  return <div className="catalog-controls">
    <div className="catalog-selects">
      <label>Learning status<select value={value.status} onChange={e => onChange({...value,status:e.target.value as CatalogFilters['status']})}>{['All','New','Learning','Learned','Needs Review'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Difficulty<select value={value.difficulty} onChange={e => onChange({...value,difficulty:e.target.value as CatalogFilters['difficulty']})}>{['All','New','Easy','Medium','Hard','Very Hard'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Part of speech<select value={value.speech} onChange={e => onChange({...value,speech:e.target.value})}><option value="">All</option><option value="__unspecified">Unspecified</option>{normalizeTags(catalog.flatMap(w=>w.partOfSpeech?[w.partOfSpeech]:[])).sort().map(s=><option key={s}>{s}</option>)}</select></label>
      <label className="favorites-filter"><input type="checkbox" checked={value.favoritesOnly} onChange={e=>onChange({...value,favoritesOnly:e.target.checked})} /> Favorites only</label>
    </div>
    <details className="tag-filter"><summary>Filter by tags{value.tags.length || value.untagged ? ` (${value.tags.length+Number(value.untagged)} selected)` : ''}</summary><div className="tag-options"><label><input type="checkbox" checked={value.untagged} onChange={e=>onChange({...value,untagged:e.target.checked})}/> Untagged</label>{catalogTags(catalog).map(tag=><label key={tag}><input type="checkbox" checked={value.tags.includes(tag)} onChange={e=>onChange({...value,tags:e.target.checked?[...value.tags,tag]:value.tags.filter(t=>t!==tag)})}/> {tag}</label>)}</div><p className="test-hint">Matches any selected tag; combines with the other filters.</p></details>
    <button className="secondary-button" onClick={onClear}>Clear filters and search</button>
  </div>
}
