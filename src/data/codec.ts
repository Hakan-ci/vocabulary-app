import {parseEvidence,parseRequest} from '../aiPractice/learningEvidence.ts'
import { emptyUserVocabulary, combinedCatalog } from '../userVocabulary.ts'
import { emptyLearningState, parseLearningState } from '../learningState.ts'
import { emptyWordHistory,parseWordHistory } from '../learningHistory.ts'
import { validateEntry, creationTime } from '../wordFields.ts'
import type { AppData, Cells, IdentityMap, Json } from './models.ts'
import { equal,json,newId } from './models.ts'
export const emptyIdentities = (): IdentityMap=>({nextId:1_000_000,localToCloud:{}})
export function reference(id: number,map: IdentityMap): string {
  if(id<1_000_000)return `b:${id}`
  if(!map.localToCloud[id])map.localToCloud[id]=newId()
  map.nextId=Math.max(map.nextId,id+1)
  const ref=`u:${map.localToCloud[id]}`
  usedReferences?.push([id,ref])
  return ref
}
// Performance: encodeData runs on every save and re-encoded every ARCHIVED session —
// the one part of the state that grows with every test taken (~33% of a signed-in
// click at 200 tests). Archived records are finished and never edited in place (the
// app only replaces them), so an archived record object that was encoded before is
// reused, provided (a) its cheap fingerprint still matches and (b) every vocabulary
// reference it resolved still maps to the same cloud ID. Cached cells are deep-frozen,
// so a consumer mutating a cell would throw instead of corrupting later saves.
type Encoded={map:IdentityMap;refs:[number,string][];fingerprint:string;cell:Json|undefined}
type ArchivedRecord={archivedAt?:number;practice:{syncId?:string;phase:string;index:number;results:unknown[]}}
const fingerprint=(r:ArchivedRecord)=>`${r.archivedAt}|${r.practice.syncId}|${r.practice.phase}|${r.practice.index}|${r.practice.results.length}`
let usedReferences:[number,string][]|undefined
const deepFreeze=<T,>(value:T):T=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const v of Object.values(value))deepFreeze(v)}return value}
function encodeArchived(memo:WeakMap<object,Encoded>,source:ArchivedRecord,map:IdentityMap,build:()=>Json|undefined):Json|undefined{
  const hit=memo.get(source),print=fingerprint(source)
  if(hit&&hit.map===map&&hit.fingerprint===print&&hit.refs.every(([id,ref])=>ref===`u:${map.localToCloud[id]}`))return hit.cell
  const refs:[number,string][]=[];usedReferences=refs
  let cell:Json|undefined
  try{cell=build()}finally{usedReferences=undefined}
  memo.set(source,{map,refs,fingerprint:print,cell:deepFreeze(cell)})
  return cell
}
const archivedRecords=new WeakMap<object,Encoded>()
export function localId(ref: string,map: IdentityMap): number {
  if(/^b:\d+$/.test(ref))return Number(ref.slice(2))
  if(!/^u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref))throw Error('Invalid vocabulary identity received.')
  const uuid=ref.slice(2),index=decodeIndex?.map===map?decodeIndex.byCloud:undefined
  if(index){const known=index.get(uuid);if(known!==undefined)return known}
  else{const found=Object.entries(map.localToCloud).find(([,v])=>v===uuid);if(found)return Number(found[0])}
  while(map.localToCloud[map.nextId])map.nextId++
  const id=map.nextId++;map.localToCloud[id]=uuid;index?.set(uuid,id);return id
}
// Performance: the reverse lookup above scans the whole identity map, so a full
// decodeData (run after every account save) was O(words²) — ~72% of CPU per Daily
// Test action with 1,000 personal words. While a decode runs, localId uses this
// reverse index instead. It is exact: it keeps the FIRST matching entry in
// Object.entries order (as .find does), and during a synchronous decode the map
// only changes through localId adding a UUID that was absent.
let decodeIndex:{map:IdentityMap;byCloud:Map<string,number>}|undefined
function withDecodeIndex<T>(map:IdentityMap,run:()=>T):T{
  if(decodeIndex)return run()
  const byCloud=new Map<string,number>()
  for(const [id,uuid] of Object.entries(map.localToCloud))if(!byCloud.has(uuid))byCloud.set(uuid,Number(id))
  decodeIndex={map,byCloud}
  try{return run()}finally{decodeIndex=undefined}
}
const idLists=new Set(['wordIds','newlyLearnedIds','reviewWordIds','needsReviewIds'])
function mapSnapshot(value: unknown,map: IdentityMap,encode: boolean,key=''): unknown {
  if(value===null)return null
  if(Array.isArray(value))return value.map(v=>idLists.has(key)?encode?reference(v as number,map):localId(v as string,map):mapSnapshot(v,map,encode))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapSnapshot(v,map,encode,k)]))
  if((key==='wordId'||key==='id')&&(encode?typeof value==='number':typeof value==='string'&&/^[bu]:/.test(value)))return encode?reference(value as number,map):localId(value as string,map)
  return value
}
export function encodeData(data: AppData,map: IdentityMap): Cells {
  const cells: Cells={}
  if(data.learning.learningEpoch)cells['learning/epoch']=data.learning.learningEpoch
  for(const [id,e] of Object.entries(data.learning.aiEvidence??{}))cells['ai-evidence/'+id]=json({...e,words:e.words.map(w=>({...w,wordId:reference(w.wordId,map)}))})
  for(const [id,r] of Object.entries(data.learning.reviewRequests??{}))cells['review-request/'+id]=json({...r,wordId:reference(r.wordId,map)})
  for(const word of [...data.vocabulary.entries,...Object.values(data.vocabulary.overrides)])cells[`word/${reference(word.id,map)}`]=json({...word,id:reference(word.id,map)})
  for(const session of [data.learning.session,data.learning.reviewSession?.practice,...Object.values(data.learning.sessions??{}).filter(r=>r.archivedAt).map(r=>r.practice)])if(session)for(const q of session.questions)if(data.vocabulary.deletedIds.includes(q.wordId))cells[`archived-word/${reference(q.wordId,map)}`]=json({...q.snapshot.word,id:reference(q.wordId,map)})
  for(const id of data.vocabulary.deletedIds)cells[`deleted/${reference(id,map)}`]=true
  for(const id of data.vocabulary.suppressedBuiltinIds)cells[`suppressed/b:${id}`]=true
  for(const id of data.vocabulary.hiddenBuiltinIds){cells[`hidden/b:${id}`]=true;const archived=data.vocabulary.hiddenBuiltinState[id];if(archived)cells[`hidden-state/b:${id}`]=json(archived)}
  for(const [id,h] of Object.entries(data.learning.history))if(!equal(h,emptyWordHistory()))cells[`progress/${reference(Number(id),map)}`]=json(h)
  for(const id of data.favorites)cells[`favorite/${reference(id,map)}`]=true
  cells['setting/goal']=data.learning.dailyGoal;cells['setting/mode']=data.learning.preferredMode;cells['setting/auto-pronunciation']=data.learning.autoPronunciation
  cells['activity/start']=json({startedAt:data.learning.activity.startedAt,startedDate:data.learning.activity.startedDate})
  cells['activity/undated']=json(data.learning.activity.undated)
  for(const [day,bucket] of Object.entries(data.learning.activity.days))cells[`activity/${day}`]=json(bucket)
  for(const [id,record] of Object.entries(data.learning.sessions??{}))cells[`session-record/${id}`]=record.archivedAt?encodeArchived(archivedRecords,record,map,()=>json(mapSnapshot(record,map,true)))!:json(mapSnapshot(record,map,true))
  if(data.learning.session)cells['session/daily']=json(mapSnapshot(data.learning.session,map,true))
  if(data.learning.reviewSession)cells['session/review']=json(mapSnapshot(data.learning.reviewSession,map,true))
  return cells
}
export function decodeData(cells: Cells,map: IdentityMap,now=Date.now()): AppData {
  return withDecodeIndex(map,()=>decodeCells(cells,map,now))
}
function decodeCells(cells: Cells,map: IdentityMap,now: number): AppData {
  const vocabulary=emptyUserVocabulary(),history: Record<number,unknown>={},favorites:number[]=[],days:Record<string,Json>={}
  for(const [key,value] of Object.entries(cells)) {
    const [kind,ref]=key.split('/')
    if(kind==='word'&&value&&typeof value==='object'&&!Array.isArray(value)) {const entry=validateEntry(value);if(!entry)throw Error('Invalid vocabulary received from account.');const id=localId(ref,map),word={...entry,id,createdAt:creationTime(value.createdAt)};if(ref.startsWith('b:'))vocabulary.overrides[id]=word;else vocabulary.entries.push(word)}
    if(kind==='deleted'&&value===true)vocabulary.deletedIds.push(localId(ref,map))
    if(kind==='suppressed'&&value===true)vocabulary.suppressedBuiltinIds.push(localId(ref,map))
    if(kind==='hidden'&&value===true)vocabulary.hiddenBuiltinIds.push(localId(ref,map))
    if(kind==='hidden-state'&&value&&typeof value==='object'&&!Array.isArray(value)){const raw=value as {id?:unknown;hiddenAt?:unknown;history?:unknown;favorite?:unknown},id=localId(ref,map),archived=parseWordHistory(raw.history);if(id<1_000_000&&archived&&typeof raw.hiddenAt==='number'&&Number.isFinite(raw.hiddenAt)&&typeof raw.favorite==='boolean')vocabulary.hiddenBuiltinState[id]={id,hiddenAt:raw.hiddenAt,history:archived,favorite:raw.favorite}}
    if(kind==='progress')history[localId(ref,map)]=value
    if(kind==='favorite'&&value===true)favorites.push(localId(ref,map))
    if(kind==='activity'&&/^\d{4}-\d{2}-\d{2}$/.test(ref))days[ref]=value
  }
  vocabulary.entries=vocabulary.entries.filter(w=>!vocabulary.deletedIds.includes(w.id));vocabulary.nextId=map.nextId
  const catalog=combinedCatalog(vocabulary),initial=emptyLearningState(catalog,now)
  const start=cells['activity/start'] as {startedAt:number;startedDate:string}|undefined
  const sessions=Object.fromEntries(Object.entries(cells).filter(([key])=>key.startsWith('session-record/')).map(([key,v])=>[key.slice(15),mapSnapshot(v,map,false)]))
  const unavailable=[...vocabulary.deletedIds,...vocabulary.hiddenBuiltinIds]
  // Malformed new records recover independently. Only vocabulary references cross
  // the identity map; practice/request/assessment UUIDs are never vocabulary IDs.
  const aiEvidence:Record<string,unknown>={},reviewRequests:Record<string,unknown>={}
  for(const [key,raw] of Object.entries(cells))try{
    if(key.startsWith('ai-evidence/')){
      const value=raw as unknown as {words:{wordId:string}[]}
      const decoded=parseEvidence({...value,words:value.words.map(w=>({...w,wordId:localId(w.wordId,map)}))})
      if(decoded)aiEvidence[key.slice(12)]=decoded
    }
    if(key.startsWith('review-request/')){
      const value=raw as unknown as {wordId:string}
      const decoded=parseRequest({...value,wordId:localId(value.wordId,map)})
      if(decoded)reviewRequests[key.slice(15)]=decoded
    }
  }catch{/* Preserve vocabulary, history and independently valid evidence. */}
  const learning=parseLearningState({...initial,aiEvidence,reviewRequests,learningEpoch:cells['learning/epoch']??0,...(Object.keys(sessions).length?{sessions}:{}),history,preferredMode:cells['setting/mode']??initial.preferredMode,autoPronunciation:typeof cells['setting/auto-pronunciation']==='boolean'?cells['setting/auto-pronunciation']:true,dailyGoal:cells['setting/goal']??10,activity:{...initial.activity,...start,undated:cells['activity/undated']??initial.activity.undated,days},session:mapSnapshot(cells['session/daily']??null,map,false),reviewSession:mapSnapshot(cells['session/review']??null,map,false)},catalog,now,catalog,unavailable)
  return {vocabulary,learning,favorites:favorites.filter(id=>catalog.some(w=>w.id===id))}
}
