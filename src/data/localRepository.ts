import {invalidateRequests} from '../aiPractice/learningEvidence.ts'
import { readUserVocabulary, combinedCatalog, legacyCatalog, USER_VOCABULARY_KEY, saveImportedWords, saveEditedWord } from '../userVocabulary.ts'
import { loadLearningState, LEARNING_STATE_KEY } from '../learningState.ts'
import type { LearningState, StoredPractice } from '../learningState.ts'
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
// Guest storage layout for finished tests ("save only what changed").
// Archived sessions are immutable and grow with every test taken, so each one lives in
// its own key, written once when it is archived; ARCHIVE_INDEX_KEY lists their IDs.
// LEARNING_STATE_KEY keeps everything else (history, settings, the live test), so a
// Daily Test click rewrites only that, instead of the whole history of past tests.
// Compatibility: loading merges the archive back, so in-memory state is unchanged.
// Older app versions still read/write LEARNING_STATE_KEY; records they keep or add
// there win over (or join) archived copies, and they never touch the archive keys.
// Crash safety: archive records and the index are written BEFORE the main key stops
// containing them, so an interrupted save can only leave a duplicate, never a gap.
export const ARCHIVE_INDEX_KEY='kelime-learning-archive'
const archiveKey=(id:string)=>`${ARCHIVE_INDEX_KEY}:${id}`
// Per storage: archived record objects known to be stored under their own key, and the
// index as last read or written (avoids rewriting it when the set is unchanged).
const storedArchive=new WeakMap<StorageAccess,{records:WeakSet<object>;index:string|null}>()
const archiveState=(storage:StorageAccess)=>{let state=storedArchive.get(storage);if(!state){state={records:new WeakSet(),index:storage.getItem(ARCHIVE_INDEX_KEY)};storedArchive.set(storage,state)}return state}
function readArchive(storage:StorageAccess):Record<string,unknown>{
  const records:Record<string,unknown>={},raw=storage.getItem(ARCHIVE_INDEX_KEY)
  archiveState(storage).index=raw
  let ids:unknown=null;try{ids=JSON.parse(raw??'null')}catch{/* A malformed index hides no main-key data. */}
  if(Array.isArray(ids))for(const id of ids)if(typeof id==='string')try{const record=JSON.parse(storage.getItem(archiveKey(id))??'null');if(record&&typeof record==='object')records[id]=record}catch{/* Skip one unreadable record, as parseLearningState skips invalid ones. */}
  return records
}
// Writes new/changed archived records under their own keys and returns the learning
// state to store under LEARNING_STATE_KEY (without them).
function storeArchive(storage:StorageAccess,learning:LearningState):LearningState{
  const state=archiveState(storage),live:Record<string,StoredPractice>={},ids:string[]=[]
  for(const [id,record] of Object.entries(learning.sessions??{})){
    if(!record.archivedAt){live[id]=record;continue}
    if(!state.records.has(record)){storage.setItem(archiveKey(id),JSON.stringify(record));state.records.add(record)}
    ids.push(id)
  }
  const index=JSON.stringify(ids)
  if(index!==state.index&&!(ids.length===0&&state.index===null)){
    let previous:unknown=null;try{previous=JSON.parse(state.index??'null')}catch{/* rewrite below */}
    storage.setItem(ARCHIVE_INDEX_KEY,index);state.index=index
    // Release records no longer referenced (reset/clear/deletion), after the index stops listing them.
    if(Array.isArray(previous))for(const id of previous)if(typeof id==='string'&&!ids.includes(id))storage.setItem(archiveKey(id),'null')
  }
  return learning.sessions?{...learning,sessions:live}:learning
}
export function loadLocal(storage: StorageAccess): {data: AppData; error: boolean} {
  const vocabulary = applyDeletionJournal(readUserVocabulary(storage),readDeletionJournal(storage)), catalog=combinedCatalog(vocabulary)
  const cleaned=cleanupDeletedWords(storage,vocabulary)
  const archive=readArchive(storage)
  // Merge archived records into the stored state before the usual parsing/migration.
  // Records present in the main key (e.g. written by an older version) take precedence.
  const merged:StorageAccess=Object.keys(archive).length?{setItem:(key,value)=>storage.setItem(key,value),getItem:key=>{
    const raw=storage.getItem(key);if(key!==LEARNING_STATE_KEY||raw===null)return raw
    try{const value=JSON.parse(raw);if(!value||typeof value!=='object')return raw;return JSON.stringify({...value,sessions:{...archive,...value.sessions}})}catch{return raw}
  }}:storage
  const learning=loadLearningState(merged,catalog,Date.now(),legacyCatalog(vocabulary),[...vocabulary.deletedIds,...vocabulary.hiddenBuiltinIds])
  // Records that came from the archive are already stored there: don't rewrite them.
  let mainSessions:Record<string,unknown>={};try{mainSessions=JSON.parse(storage.getItem(LEARNING_STATE_KEY)??'null')?.sessions??{}}catch{/* treat as none */}
  const known=archiveState(storage).records
  for(const [id,record] of Object.entries(learning.value.sessions??{}))if(record.archivedAt&&id in archive&&!(id in mainSessions))known.add(record)
  let favorites: number[]=[]
  try { favorites=sanitizeIds(JSON.parse(storage.getItem('kelime-favorites')??'[]'),catalog) } catch { /* Malformed favorites recover independently. */ }
  return {data:{vocabulary,learning:learning.value,favorites},error:learning.error||!cleaned}
}
export function saveLocal(storage: StorageAccess,data: AppData,previous?:AppData) {
  // Write one recovery envelope first, then keep the existing keys compatible.
  const entries:Record<string,unknown>={}
  if(data.vocabulary!==previous?.vocabulary)entries[USER_VOCABULARY_KEY]=data.vocabulary
  if(data.learning!==previous?.learning)entries[LEARNING_STATE_KEY]=storeArchive(storage,data.learning)
  if(data.favorites!==previous?.favorites)entries['kelime-favorites']=data.favorites
  // Performance: serialize each changed domain ONCE and splice the same JSON into the
  // envelope. The learning state (every archived session) is the large one, and it was
  // being stringified twice per Daily Test click. Written bytes are identical to
  // JSON.stringify({version:2,entries}) and JSON.stringify(value).
  const encoded=Object.entries(entries).map(([key,value])=>[key,JSON.stringify(value)] as const)
  storage.setItem('kelime-local-recovery',encoded.every(([,json])=>json!==undefined)?`{"version":2,"entries":{${encoded.map(([key,json])=>JSON.stringify(key)+':'+json).join(',')}}}`:JSON.stringify({version:2,entries}))
  for(const [key,json] of encoded)storage.setItem(key,json as string)
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
