import {invalidateRequests} from '../aiPractice/learningEvidence.ts'
import { readUserVocabulary, combinedCatalog, legacyCatalog, USER_VOCABULARY_KEY, saveImportedWords, saveEditedWord } from '../userVocabulary.ts'
import { loadLearningState, LEARNING_STATE_KEY } from '../learningState.ts'
import { sanitizeIds } from '../dailyTestModel.ts'
import { cleanupDeletedWords, deletePersonalWord, removeDeletedHistory } from '../vocabularyDeletion.ts'
import { clearUserVocabulary, clearVocabularyData, deleteVocabularyEntries, resetVocabularyProgress, restoreBuiltInEntries } from '../vocabularyManagement.ts'
import { parseHistory } from '../learningHistory.ts'
import type { AppData } from './models.ts'
import type { ImportRow } from '../vocabularyImport.ts'
import type { WordEntry } from '../wordFields.ts'
import type { HiddenBuiltinArchive,UserVocabulary } from '../userVocabulary.ts'
export type StorageAccess = Pick<Storage,'getItem'|'setItem'>
export const DELETION_JOURNAL_KEY='kelime-vocabulary-deletion-journal'
type DeletionJournal={version:1;revision:number;deletedIds:number[];hidden:Record<number,HiddenBuiltinArchive|null>}
const emptyJournal=():DeletionJournal=>({version:1,revision:0,deletedIds:[],hidden:{}})
export function readDeletionJournal(storage:StorageAccess):DeletionJournal{try{const raw=JSON.parse(storage.getItem(DELETION_JOURNAL_KEY)??'null') as DeletionJournal;if(raw?.version===1&&Number.isSafeInteger(raw.revision)&&Array.isArray(raw.deletedIds)&&raw.hidden&&typeof raw.hidden==='object')return raw}catch{/* Preserve the primary dataset if a journal is malformed. */}return emptyJournal()}
export function recordDeletionJournal(storage:StorageAccess,vocabulary:UserVocabulary,affectedBuiltIns:readonly number[]=[]){const old=readDeletionJournal(storage),hidden={...old.hidden};for(const id of affectedBuiltIns)hidden[id]=vocabulary.hiddenBuiltinIds.includes(id)?vocabulary.hiddenBuiltinState[id]??null:null;const next:DeletionJournal={version:1,revision:old.revision+1,deletedIds:[...new Set([...old.deletedIds,...vocabulary.deletedIds])],hidden};storage.setItem(DELETION_JOURNAL_KEY,JSON.stringify(next));return next}
function applyDeletionJournal(vocabulary:UserVocabulary,journal:DeletionJournal):UserVocabulary{const deletedIds=[...new Set([...vocabulary.deletedIds,...journal.deletedIds])],hiddenBuiltinIds=[...vocabulary.hiddenBuiltinIds],hiddenBuiltinState={...vocabulary.hiddenBuiltinState};for(const [key,state] of Object.entries(journal.hidden)){const id=Number(key);if(state){if(!hiddenBuiltinIds.includes(id))hiddenBuiltinIds.push(id);hiddenBuiltinState[id]=state}else{const at=hiddenBuiltinIds.indexOf(id);if(at>=0)hiddenBuiltinIds.splice(at,1);delete hiddenBuiltinState[id]}}return {...vocabulary,entries:vocabulary.entries.filter(word=>!deletedIds.includes(word.id)),legacyEntries:vocabulary.legacyEntries.filter(word=>!deletedIds.includes(word.id)),deletedIds,hiddenBuiltinIds,hiddenBuiltinState}}
export function memoryStorage(data?: AppData): StorageAccess {
  const map = new Map<string,string>()
  if (data) { map.set(USER_VOCABULARY_KEY,JSON.stringify(data.vocabulary));map.set(LEARNING_STATE_KEY,JSON.stringify(data.learning));map.set('kelime-favorites',JSON.stringify(data.favorites)) }
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value)}}
}
export function loadLocal(storage: StorageAccess): {data: AppData; error: boolean} {
  const vocabulary = applyDeletionJournal(readUserVocabulary(storage),readDeletionJournal(storage)), catalog=combinedCatalog(vocabulary)
  const cleaned=cleanupDeletedWords(storage,vocabulary)
  const learning=loadLearningState(storage,catalog,Date.now(),legacyCatalog(vocabulary),[...vocabulary.deletedIds,...vocabulary.hiddenBuiltinIds])
  let favorites: number[]=[]
  try { favorites=sanitizeIds(JSON.parse(storage.getItem('kelime-favorites')??'[]'),catalog) } catch { /* Malformed favorites recover independently. */ }
  return {data:{vocabulary,learning:learning.value,favorites},error:learning.error||!cleaned}
}
export function saveLocal(storage: StorageAccess,data: AppData,previous?:AppData) {
  // Write one recovery envelope first, then keep the existing keys compatible.
  const entries:Record<string,unknown>={}
  if(data.vocabulary!==previous?.vocabulary)entries[USER_VOCABULARY_KEY]=data.vocabulary
  if(data.learning!==previous?.learning)entries[LEARNING_STATE_KEY]=data.learning
  if(data.favorites!==previous?.favorites)entries['kelime-favorites']=data.favorites
  storage.setItem('kelime-local-recovery',JSON.stringify({version:2,entries}))
  for(const [key,value] of Object.entries(entries))storage.setItem(key,JSON.stringify(value))
  storage.setItem('kelime-local-recovery','null')
}
export function recoverLocal(storage: StorageAccess) {
  const raw=storage.getItem('kelime-local-recovery')
  if(raw&&raw!=='null') { const pending=JSON.parse(raw); if(pending?.version===2&&pending.entries){for(const key of [USER_VOCABULARY_KEY,LEARNING_STATE_KEY,'kelime-favorites'])if(key in pending.entries)storage.setItem(key,JSON.stringify(pending.entries[key]));storage.setItem('kelime-local-recovery','null')}else if(pending?.vocabulary&&pending?.learning&&Array.isArray(pending.favorites)) saveLocal(storage,pending) }
}
export const vocabularyRepository = {
  import(data: AppData,rows: ImportRow[]) { const result=saveImportedWords(memoryStorage(data),rows);return {data:{...data,vocabulary:result.value,learning:{...data.learning,history:parseHistory(data.learning.history,false,combinedCatalog(result.value))}},added:result.added.length,updated:result.updated.length} },
  edit(data: AppData,id: number,entry: WordEntry,separate: boolean) { return {...data,vocabulary:saveEditedWord(memoryStorage(data),id,entry,separate)} },
  delete(data: AppData,id: number) { const result=deletePersonalWord(memoryStorage(data),id,data.learning);return {...data,vocabulary:result.value,learning:{...removeDeletedHistory(data.learning,result.value.deletedIds),reviewRequests:invalidateRequests(data.learning.reviewRequests,result.value.deletedIds)},favorites:data.favorites.filter(value=>value!==id)} },
  deleteMany(data:AppData,ids:readonly number[],now=Date.now()){return deleteVocabularyEntries(data,ids,now)},
  restoreBuiltIns(data:AppData,ids:readonly number[]){return restoreBuiltInEntries(data,ids)},
  clearPersonal(data:AppData,now=Date.now()){return clearUserVocabulary(data,now)},
  resetProgress(data:AppData,now=Date.now()){return resetVocabularyProgress(data,now)},
  clearEverything(data:AppData,now=Date.now()){return clearVocabularyData(data,now)},
}
export const progressRepository = { save: (data: AppData,learning: AppData['learning']): AppData=>({...data,learning}), favorites: (data: AppData,favorites: number[]): AppData=>({...data,favorites}) }
export const testRepository = { save: progressRepository.save }
