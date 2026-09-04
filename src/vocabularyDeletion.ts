import { combinedCatalog, legacyCatalog, loadUserVocabulary, readUserVocabulary, USER_VOCABULARY_KEY } from './userVocabulary.ts'
import type { UserVocabulary } from './userVocabulary.ts'
import { LEARNING_STATE_KEY, parseLearningState } from './learningState.ts'
import type { LearningState } from './learningState.ts'
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>

export function deletionBlock(id: number, state: LearningState): string | null {
  const sessions = [
    ...(state.session && state.session.phase !== 'completed' && state.session.questions.some(q => q.wordId === id) ? ['Daily Test'] : []),
    ...(state.reviewSession && state.reviewSession.practice.phase !== 'completed' && state.reviewSession.practice.questions.some(q => q.wordId === id) ? ['Review'] : []),
  ]
  return sessions.length ? `Finish ${sessions.join(' and ')} before deleting this word.` : null
}
export function removeDeletedHistory(state: LearningState, ids: readonly number[]): LearningState {
  return { ...state, history: Object.fromEntries(Object.entries(state.history).filter(([id]) => !ids.includes(Number(id)))) }
}
// Markers remain durable: interrupted cleanup is retried on load without undoing deletion.
export function cleanupDeletedWords(storage: StorageAccess, value: UserVocabulary): boolean {
  if (!value.deletedIds.length) return true
  let complete = true
  for (const key of ['kelime-favorites', 'kelime-learned', LEARNING_STATE_KEY]) {
    try {
      const raw = storage.getItem(key)
      if (raw === null) continue
      const data = JSON.parse(raw)
      const cleaned = key === LEARNING_STATE_KEY
        ? data && typeof data === 'object' && data.history && typeof data.history === 'object'
          ? { ...data, history: Object.fromEntries(Object.entries(data.history).filter(([id]) => !value.deletedIds.includes(Number(id)))) } : data
        : Array.isArray(data) ? data.filter(id => !value.deletedIds.includes(id)) : data
      if (JSON.stringify(cleaned) !== raw) storage.setItem(key, JSON.stringify(cleaned))
    } catch { complete = false }
  }
  return complete
}
export function loadManagedVocabulary() {
  const loaded = loadUserVocabulary()
  try { return { ...loaded, error: !cleanupDeletedWords(localStorage, loaded.value) || loaded.error } }
  catch { return { ...loaded, error: true } }
}
export function deletePersonalWord(storage: StorageAccess, id: number, current: LearningState) {
  const value = readUserVocabulary(storage)
  if (!value.entries.some(w => w.id === id)) throw Error('Only personal vocabulary can be deleted.')
  const blocked = deletionBlock(id, current)
  if (blocked) throw Error(blocked)
  const raw = storage.getItem(LEARNING_STATE_KEY)
  if (raw) {
    const saved = parseLearningState(JSON.parse(raw), combinedCatalog(value), Date.now(), legacyCatalog(value), value.deletedIds)
    const savedBlock = deletionBlock(id, saved)
    if (savedBlock) throw Error(savedBlock)
  }
  const next = { ...value, entries: value.entries.filter(w => w.id !== id), legacyEntries: value.legacyEntries.filter(w => w.id !== id), deletedIds: [...new Set([...value.deletedIds, id])] }
  storage.setItem(USER_VOCABULARY_KEY, JSON.stringify(next))
  return { value: next, cleanupComplete: cleanupDeletedWords(storage, next) }
}
