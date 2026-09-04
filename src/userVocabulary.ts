import { words } from './vocabulary.ts'
import type { VocabularyWord } from './vocabulary.ts'
import { classifyPreview } from './vocabularyImport.ts'
import type { ImportRow } from './vocabularyImport.ts'
import { englishKey, compatibleSpeech, validateEntry, creationTime, normalizeTags } from './wordFields.ts'
import { uniqueAnswers } from './answerMatching.ts'
export const USER_VOCABULARY_KEY = 'kelime-user-vocabulary'
export const FIRST_USER_ID = 1_000_000
export type UserVocabulary = { version: 3; nextId: number; entries: VocabularyWord[]; overrides: Record<number, VocabularyWord>; suppressedBuiltinIds: number[]; legacyEntries: VocabularyWord[]; deletedIds: number[] }
export const emptyUserVocabulary = (): UserVocabulary => ({ version: 3, nextId: FIRST_USER_ID, entries: [], overrides: {}, suppressedBuiltinIds: [], legacyEntries: [], deletedIds: [] })
export function parseUserVocabulary(value: unknown, builtins: readonly VocabularyWord[] = words): UserVocabulary {
  const result = emptyUserVocabulary()
  if (!value || typeof value !== 'object') return result
  const raw = value as Record<string, unknown>
  if (![1,2,3].includes(Number(raw.version))) return result
  if (Number.isSafeInteger(raw.nextId) && Number(raw.nextId) >= FIRST_USER_ID) result.nextId = Number(raw.nextId)
  if (Array.isArray(raw.deletedIds)) result.deletedIds = [...new Set(raw.deletedIds.filter((id): id is number => Number.isSafeInteger(id) && Number(id) >= FIRST_USER_ID && Number(id) < Number.MAX_SAFE_INTEGER))]
  for (const id of result.deletedIds) result.nextId = Math.max(result.nextId, id + 1)
  const ids = new Set<number>(result.deletedIds)
  for (const item of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!item || typeof item !== 'object') continue
    if (Number.isSafeInteger(item.id) && item.id >= FIRST_USER_ID && item.id < Number.MAX_SAFE_INTEGER) result.nextId = Math.max(result.nextId, item.id + 1)
    if (!Number.isSafeInteger(item.id) || item.id < FIRST_USER_ID || item.id >= Number.MAX_SAFE_INTEGER || ids.has(item.id)) continue
    const entry = validateEntry(raw.version === 3 ? item : {...item, topic: item.topic ?? 'My words'})
    if (!entry) continue
    ids.add(item.id); result.entries.push({ ...entry, id: item.id, createdAt: creationTime(item.createdAt) })
  }
  if (raw.version === 1) result.legacyEntries = result.entries.map(w => ({...w}))
  else if (Array.isArray(raw.legacyEntries)) result.legacyEntries = raw.legacyEntries.flatMap(item => { const entry = validateEntry(item); return entry && !result.deletedIds.includes(item.id) && Number.isSafeInteger(item.id) && item.id >= FIRST_USER_ID ? [{...entry,id:item.id,createdAt: creationTime(item.createdAt)}] : [] })
  if (raw.version === 1) result.suppressedBuiltinIds = builtins.filter(word => word.id >= 30 && result.entries.some(entry => englishKey(entry.english) === englishKey(word.english) && compatibleSpeech(entry,word))).map(w => w.id)
  else {
    if (Array.isArray(raw.suppressedBuiltinIds)) result.suppressedBuiltinIds = [...new Set(raw.suppressedBuiltinIds.filter(id => typeof id === 'number' && id >= 30 && builtins.some(w => w.id === id)))]
    if (raw.overrides && typeof raw.overrides === 'object') for (const [key,item] of Object.entries(raw.overrides)) {
      const original = builtins.find(w => w.id === Number(key)), entry = validateEntry(raw.version !== 3 && original && item && typeof item === 'object' ? {...item, topic: original.tags[0]} : item)
      if (original && entry) result.overrides[original.id] = { ...entry, id: original.id, createdAt: original.createdAt }
    }
  }
  return result
}
export function combinedCatalog(value: UserVocabulary, builtins: readonly VocabularyWord[] = words): VocabularyWord[] {
  return [...builtins.filter(w => !value.suppressedBuiltinIds.includes(w.id)).map(w => value.overrides[w.id] ?? w), ...value.entries]
}
export function readUserVocabulary(storage: Pick<Storage, 'getItem'>): UserVocabulary {
  const raw = storage.getItem(USER_VOCABULARY_KEY)
  let value: unknown = null
  try { value = raw === null ? null : JSON.parse(raw) } catch { /* Recover malformed JSON. */ }
  return parseUserVocabulary(value)
}
export function loadUserVocabulary() {
  let value = emptyUserVocabulary()
  try {
    value = readUserVocabulary(localStorage)
    const raw = localStorage.getItem(USER_VOCABULARY_KEY)
    if (raw && [1,2].includes(JSON.parse(raw)?.version)) localStorage.setItem(USER_VOCABULARY_KEY, JSON.stringify(value))
    return { value, error: false }
  } catch { return { value, error: true } }
}
function replaceWord(value: UserVocabulary, word: VocabularyWord): UserVocabulary {
  return word.id >= FIRST_USER_ID ? { ...value, entries: value.entries.map(w => w.id === word.id ? word : w) } : { ...value, overrides: { ...value.overrides, [word.id]: word } }
}
// Revalidate against storage and write before changing the visible catalog.
export function saveImportedWords(storage: Pick<Storage, 'getItem' | 'setItem'>, rows: ImportRow[], now = Date.now()) {
  let value = readUserVocabulary(storage)
  const preview = classifyPreview(rows, combinedCatalog(value))
  const mapped = new Map<number,number>(), added: VocabularyWord[] = [], updated = new Set<number>()
  for (const row of preview) {
    if (row.status === 'Ready') {
      if (value.nextId >= Number.MAX_SAFE_INTEGER) throw Error('Vocabulary ID limit reached.')
      const word: VocabularyWord = { ...row.entry!, id: value.nextId, createdAt:now }
      mapped.set(-(row.id+1),word.id)
      value = { ...value, nextId:value.nextId+1, entries:[...value.entries,word] }; added.push(word)
    } else if (row.status === 'Merge') {
      const id = mapped.get(row.target!.id) ?? row.target!.id
      const target = combinedCatalog(value).find(w => w.id === id)
      if (!target) continue
      const word = {...target,turkishMeanings:uniqueAnswers([...target.turkishMeanings,...row.additions],'englishToTurkish'), tags:normalizeTags([...target.tags,...row.tagAdditions])}
      value = replaceWord(value,word)
      if (!added.some(w => w.id === id)) updated.add(id)
    }
  }
  if (added.length || updated.size) storage.setItem(USER_VOCABULARY_KEY,JSON.stringify(value))
  return { value, added: added.map(w => value.entries.find(e => e.id === w.id)!), updated: [...updated] }
}
export function saveEditedWord(storage: Pick<Storage, 'getItem' | 'setItem'>, id: number, input: unknown, separate = false) {
  let value = readUserVocabulary(storage)
  const catalog = combinedCatalog(value), previous = catalog.find(w => w.id === id), entry = validateEntry(input)
  if (!previous || !entry) throw Error('The word or its meanings are invalid.')
  if (!separate && catalog.some(w => w.id !== id && englishKey(w.english) === englishKey(entry.english))) throw Error('This English word also exists. Choose “Keep as a separate entry” to preserve this word and its history.')
  value = replaceWord(value,{...entry,id,createdAt:previous.createdAt})
  storage.setItem(USER_VOCABULARY_KEY,JSON.stringify(value))
  return value
}

export const legacyCatalog = (value: UserVocabulary) => [...words.filter(w => w.id < 30), ...value.legacyEntries, ...value.entries.filter(w => !value.legacyEntries.some(old => old.id === w.id))]
