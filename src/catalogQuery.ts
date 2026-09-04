import type { VocabularyWord } from './vocabulary.ts'
import { normalize } from './vocabulary.ts'
import { calculateDifficulty, emptyWordHistory, isReviewDue } from './learningHistory.ts'
import type { LearningHistory } from './learningHistory.ts'
import type { DifficultyLevel } from './learningTypes.ts'
import { englishKey, normalizeTags, suggestedTags, tagKey } from './wordFields.ts'

export type CatalogSort = 'default' | 'az' | 'za' | 'hardest' | 'easiest' | 'recent' | 'missed' | 'reviewed'
export type CatalogFilters = { status: 'All' | 'New' | 'Learning' | 'Learned' | 'Needs Review'; difficulty: 'All' | DifficultyLevel; favoritesOnly: boolean; speech: string; tags: string[]; untagged: boolean }
export const emptyFilters = (): CatalogFilters => ({ status: 'All', difficulty: 'All', favoritesOnly: false, speech: '', tags: [], untagged: false })
export const sortOptions: [CatalogSort, string][] = [['default','Default order'],['az','Alphabetical A–Z'],['za','Alphabetical Z–A'],['hardest','Difficulty high → low'],['easiest','Difficulty low → high'],['recent','Recently added'],['missed','Most missed'],['reviewed','Least recently reviewed']]
export const catalogTags = (catalog: readonly VocabularyWord[]) => normalizeTags([...suggestedTags, ...catalog.flatMap(w => w.tags)]).sort((a,b) => a.localeCompare(b))
export function vocabularyCounts(catalog: readonly VocabularyWord[], history: LearningHistory, now: number) {
  const counts = { Total: catalog.length, Learned: 0, Learning: 0, New: 0, 'Needs Review': 0 }
  for (const w of catalog) {
    const h = history[w.id] ?? emptyWordHistory()
    counts[h.learned ? 'Learned' : h.timesTested ? 'Learning' : 'New']++
    if (isReviewDue(h,now)) counts['Needs Review']++
  }
  return counts
}
export function queryCatalog(catalog: readonly VocabularyWord[], history: LearningHistory, favorites: readonly number[], filters: CatalogFilters, search: string, sort: CatalogSort, now: number, collection: 'all' | 'favorites' | 'learned' = 'all'): VocabularyWord[] {
  const needle = normalize(search.trim())
  const list = catalog.filter(w => {
    const h = history[w.id] ?? emptyWordHistory(), favored = favorites.includes(w.id)
    if (collection === 'favorites' && !favored || collection === 'learned' && !h.learned || filters.favoritesOnly && !favored) return false
    if (filters.status === 'New' && (h.learned || h.timesTested) || filters.status === 'Learning' && (!h.timesTested || h.learned) || filters.status === 'Learned' && !h.learned || filters.status === 'Needs Review' && !isReviewDue(h,now)) return false
    if (filters.difficulty !== 'All' && calculateDifficulty(h,now).level !== filters.difficulty) return false
    if (filters.speech === '__unspecified' ? !!w.partOfSpeech : filters.speech && englishKey(w.partOfSpeech ?? '') !== englishKey(filters.speech)) return false
    if ((filters.tags.length || filters.untagged) && !(filters.untagged && !w.tags.length) && !w.tags.some(t => filters.tags.some(selected => tagKey(t) === tagKey(selected)))) return false
    return normalize([w.english,...w.englishAlternatives ?? [],...w.turkishMeanings,w.example ?? '',...w.tags].join(' ')).includes(needle)
  })
  return list.sort((a,b) => {
    const ah = history[a.id] ?? emptyWordHistory(), bh = history[b.id] ?? emptyWordHistory()
    let difference = 0
    if (sort === 'az' || sort === 'za') difference = a.english.localeCompare(b.english,'en',{sensitivity:'base'}) * (sort === 'az' ? 1 : -1)
    if (sort === 'hardest' || sort === 'easiest') difference = Number(!ah.timesTested)-Number(!bh.timesTested) || (calculateDifficulty(ah,now).score-calculateDifficulty(bh,now).score)*(sort === 'hardest' ? -1 : 1)
    if (sort === 'missed') difference = bh.timesMissed-ah.timesMissed
    if (sort === 'reviewed') difference = (ah.lastTestedAt ?? -1)-(bh.lastTestedAt ?? -1)
    if (sort === 'recent') {
      const group = (w: VocabularyWord) => w.createdAt !== null ? 0 : w.id >= 1_000_000 ? 1 : 2
      difference = group(a)-group(b) || (group(a) === 0 ? b.createdAt!-a.createdAt! : group(a) === 1 ? b.id-a.id : 0)
    }
    return difference || a.id-b.id
  })
}
