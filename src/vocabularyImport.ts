import type { VocabularyWord } from './vocabulary.ts'
import { cleanText, uniqueAnswers } from './answerMatching.ts'
import { englishKey, compatibleSpeech, validateEntry, normalizeTags } from './wordFields.ts'
import type { WordEntry } from './wordFields.ts'
export { englishKey, validateEntry } from './wordFields.ts'
export type { WordEntry } from './wordFields.ts'
export const cleanField = cleanText
export type ImportRow = { id: number; source: string; entry: WordEntry | null; error?: string; resolution?: number | 'new' }
export type PreviewRow = ImportRow & { status: 'Ready' | 'Merge' | 'Duplicate' | 'Needs resolution' | 'Invalid'; target?: VocabularyWord; candidates: VocabularyWord[]; additions: string[]; tagAdditions: string[] }
export function parseVocabulary(text: string): ImportRow[] {
  return text.split(/\r\n|\n|\r/).flatMap((source, id) => {
    if (!source.trim()) return []
    const delimited = source.includes('\t') || /(?:^|\s)-(?=\s|$)/.test(source)
    const fields = source.includes('\t') ? source.split('\t') : delimited ? source.split(/(?<!\S)-(?!\S)/) : source.trim().split(/\s+/)
    if (fields.length < 2 || fields.length > (delimited ? 4 : 2)) return [{ id, source, entry: null, error: 'Use tabs or spaced hyphens for phrases; optional columns are part of speech and comma-separated tags.' }]
    const entry = validateEntry({ english: fields[0], turkishMeanings: fields[1].split(';'), partOfSpeech: fields[2], tags: fields[3]?.split(',') })
    return [{ id, source, entry, ...(!entry ? {error:'English and at least one Turkish meaning are required.'} : {}) }]
  })
}
export function classifyPreview(rows: ImportRow[], catalog: readonly VocabularyWord[]): PreviewRow[] {
  let staged = [...catalog]
  return rows.map(row => {
    const base = { ...row, candidates: [] as VocabularyWord[], additions: [] as string[], tagAdditions: [] as string[] }
    if (!row.entry) return { ...base, status: 'Invalid' }
    const entry = row.entry
    const candidates = staged.filter(word => englishKey(word.english) === englishKey(entry.english))
    let target: VocabularyWord | undefined
    if (typeof row.resolution === 'number') target = candidates.find(word => word.id === row.resolution)
    else if (row.resolution !== 'new' && candidates.length === 1 && compatibleSpeech(entry, candidates[0])) target = candidates[0]
    if ((typeof row.resolution === 'number' && !target) || (row.resolution !== 'new' && candidates.length && !target)) return { ...base, candidates, status: 'Needs resolution' }
    if (!target) {
      staged.push({ ...entry, id: -(row.id + 1), createdAt: null })
      return { ...base, candidates, status: 'Ready', additions: entry.turkishMeanings, tagAdditions: entry.tags }
    }
    const merged = uniqueAnswers([...target.turkishMeanings, ...entry.turkishMeanings], 'englishToTurkish')
    const additions = merged.slice(target.turkishMeanings.length)
    const tags = normalizeTags([...target.tags, ...entry.tags]), tagAdditions = tags.slice(target.tags.length)
    if (additions.length || tagAdditions.length) staged = staged.map(word => word.id === target.id ? {...word,turkishMeanings:merged,tags} : word)
    return { ...base, candidates, target, additions, tagAdditions, status: additions.length || tagAdditions.length ? 'Merge' : 'Duplicate' }
  })
}
