import type { VocabularyWord } from './vocabulary.ts'
import { cleanText, uniqueAnswers } from './answerMatching.ts'
export type WordEntry = Pick<VocabularyWord, 'english' | 'turkishMeanings' | 'englishAlternatives' | 'partOfSpeech' | 'example' | 'tags'>
export const primaryMeaning = (word: VocabularyWord) => word.turkishMeanings[0]
export const englishKey = (value: string) => cleanText(value).toLocaleLowerCase('en')
export const compatibleSpeech = (a: WordEntry, b: WordEntry) => !a.partOfSpeech || !b.partOfSpeech || englishKey(a.partOfSpeech) === englishKey(b.partOfSpeech)
export function validateEntry(value: unknown): WordEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.english !== 'string' || !cleanText(raw.english)) return null
  const english = cleanText(raw.english)
  let turkishMeanings = uniqueAnswers(raw.turkishMeanings, 'englishToTurkish')
  if (!turkishMeanings.length && typeof raw.turkish === 'string') turkishMeanings = uniqueAnswers([raw.turkish], 'englishToTurkish')
  if (!turkishMeanings.length) return null
  const englishAlternatives = uniqueAnswers([english, ...(Array.isArray(raw.englishAlternatives) ? raw.englishAlternatives : [])], 'turkishToEnglish').slice(1)
  const speech = typeof raw.partOfSpeech === 'string' && cleanText(raw.partOfSpeech) ? raw.partOfSpeech : raw.type
  const partOfSpeech = typeof speech === 'string' ? cleanText(speech) : ''
  const tags = Array.isArray(raw.tags) ? normalizeTags(raw.tags) : normalizeTags(typeof raw.topic === 'string' ? [raw.topic] : [])
  const example = typeof raw.example === 'string' ? cleanText(raw.example) : ''
  return { english, turkishMeanings, tags, ...(englishAlternatives.length ? { englishAlternatives } : {}), ...(partOfSpeech ? {partOfSpeech} : {}), ...(example ? {example} : {}) }
}

export const suggestedTags = ['Everyday', 'Travel', 'Work', 'Academic', 'Food', 'Technology']
export const speechSuggestions = ['noun', 'verb', 'adjective', 'adverb', 'phrasal verb', 'preposition', 'conjunction', 'other']
export const tagKey = englishKey
export function normalizeTags(value: unknown): string[] {
  const seen = new Set<string>()
  return Array.isArray(value) ? value.flatMap(item => {
    if (typeof item !== 'string') return []
    const text = cleanText(item), key = tagKey(text)
    if (!key || seen.has(key)) return []
    seen.add(key); return [text]
  }) : []
}
export const creationTime = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
