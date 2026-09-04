import { readUserVocabulary, combinedCatalog, legacyCatalog, USER_VOCABULARY_KEY, saveImportedWords, saveEditedWord } from '../userVocabulary.ts'
import { loadLearningState, LEARNING_STATE_KEY } from '../learningState.ts'
import { sanitizeIds } from '../dailyTestModel.ts'
import { cleanupDeletedWords, deletePersonalWord, removeDeletedHistory } from '../vocabularyDeletion.ts'
import { parseHistory } from '../learningHistory.ts'
import type { AppData } from './models.ts'
import type { ImportRow } from '../vocabularyImport.ts'
import type { WordEntry } from '../wordFields.ts'
export type StorageAccess = Pick<Storage,'getItem'|'setItem'>
export function memoryStorage(data?: AppData): StorageAccess {
  const map = new Map<string,string>()
  if (data) { map.set(USER_VOCABULARY_KEY,JSON.stringify(data.vocabulary));map.set(LEARNING_STATE_KEY,JSON.stringify(data.learning));map.set('kelime-favorites',JSON.stringify(data.favorites)) }
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value)}}
}
export function loadLocal(storage: StorageAccess): {data: AppData; error: boolean} {
  const vocabulary = readUserVocabulary(storage), catalog=combinedCatalog(vocabulary)
  const cleaned=cleanupDeletedWords(storage,vocabulary)
  const learning=loadLearningState(storage,catalog,Date.now(),legacyCatalog(vocabulary),vocabulary.deletedIds)
  let favorites: number[]=[]
  try { favorites=sanitizeIds(JSON.parse(storage.getItem('kelime-favorites')??'[]'),catalog) } catch { /* Malformed favorites recover independently. */ }
  return {data:{vocabulary,learning:learning.value,favorites},error:learning.error||!cleaned}
}
export function saveLocal(storage: StorageAccess,data: AppData) {
  // Write one recovery envelope first, then keep the existing keys compatible.
  storage.setItem('kelime-local-recovery',JSON.stringify(data))
  storage.setItem(USER_VOCABULARY_KEY,JSON.stringify(data.vocabulary))
  storage.setItem(LEARNING_STATE_KEY,JSON.stringify(data.learning))
  storage.setItem('kelime-favorites',JSON.stringify(data.favorites))
  storage.setItem('kelime-local-recovery','null')
}
export function recoverLocal(storage: StorageAccess) {
  const raw=storage.getItem('kelime-local-recovery')
  if(raw&&raw!=='null') { const pending=JSON.parse(raw); if(pending?.vocabulary&&pending?.learning&&Array.isArray(pending.favorites)) saveLocal(storage,pending) }
}
export const vocabularyRepository = {
  import(data: AppData,rows: ImportRow[]) { const result=saveImportedWords(memoryStorage(data),rows);return {data:{...data,vocabulary:result.value,learning:{...data.learning,history:parseHistory(data.learning.history,false,combinedCatalog(result.value))}},added:result.added.length,updated:result.updated.length} },
  edit(data: AppData,id: number,entry: WordEntry,separate: boolean) { return {...data,vocabulary:saveEditedWord(memoryStorage(data),id,entry,separate)} },
  delete(data: AppData,id: number) { const result=deletePersonalWord(memoryStorage(data),id,data.learning);return {...data,vocabulary:result.value,learning:removeDeletedHistory(data.learning,result.value.deletedIds),favorites:data.favorites.filter(value=>value!==id)} },
}
export const progressRepository = { save: (data: AppData,learning: AppData['learning']): AppData=>({...data,learning}), favorites: (data: AppData,favorites: number[]): AppData=>({...data,favorites}) }
export const testRepository = { save: progressRepository.save }
