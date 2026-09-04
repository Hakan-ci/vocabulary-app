import type { TestDirection } from './learningTypes.ts'
export type MatchingRule = 'legacy' | 'strict'
export const cleanText = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ')
export const searchNormalize = (value: string) => value.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
export function normalizeAnswer(value: string, direction: TestDirection, rule: MatchingRule = 'strict') {
  const spaced = cleanText(value)
  if (rule === 'legacy') return direction === 'englishToTurkish' ? searchNormalize(spaced) : spaced.toLocaleLowerCase('en')
  return spaced.replace(/[.,!?…]+$/u, '').trim().toLocaleLowerCase(direction === 'englishToTurkish' ? 'tr' : 'en')
}
export function answerMatches(answer: string, expected: string | readonly string[], direction: TestDirection = 'englishToTurkish', rule: MatchingRule = 'strict') {
  const key = normalizeAnswer(answer, direction, rule)
  return !!key && (typeof expected === 'string' ? [expected] : expected).some(value => normalizeAnswer(value, direction, rule) === key)
}
export function uniqueAnswers(value: unknown, direction: TestDirection): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(item => {
    if (typeof item !== 'string') return []
    const text = cleanText(item), key = normalizeAnswer(text, direction)
    if (!key || seen.has(key)) return []
    seen.add(key); return [text]
  })
}
