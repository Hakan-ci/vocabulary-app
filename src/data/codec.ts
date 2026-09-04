import { emptyUserVocabulary, combinedCatalog } from '../userVocabulary.ts'
import { emptyLearningState, parseLearningState } from '../learningState.ts'
import { emptyWordHistory } from '../learningHistory.ts'
import { validateEntry, creationTime } from '../wordFields.ts'
import type { AppData, Cells, IdentityMap, Json } from './models.ts'
import { equal,json,newId } from './models.ts'
export const emptyIdentities = (): IdentityMap=>({nextId:1_000_000,localToCloud:{}})
export function reference(id: number,map: IdentityMap): string {
  if(id<1_000_000)return `b:${id}`
  if(!map.localToCloud[id])map.localToCloud[id]=newId()
  map.nextId=Math.max(map.nextId,id+1)
  return `u:${map.localToCloud[id]}`
}
export function localId(ref: string,map: IdentityMap): number {
  if(/^b:\d+$/.test(ref))return Number(ref.slice(2))
  if(!/^u:[0-9a-f-]{36}$/i.test(ref))throw Error('Invalid vocabulary identity received.')
  const uuid=ref.slice(2),found=Object.entries(map.localToCloud).find(([,v])=>v===uuid)
  if(found)return Number(found[0])
  while(map.localToCloud[map.nextId])map.nextId++
  const id=map.nextId++;map.localToCloud[id]=uuid;return id
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
  for(const word of [...data.vocabulary.entries,...Object.values(data.vocabulary.overrides)])cells[`word/${reference(word.id,map)}`]=json({...word,id:reference(word.id,map)})
  for(const session of [data.learning.session,data.learning.reviewSession?.practice])if(session?.phase==='completed')for(const q of session.questions)if(data.vocabulary.deletedIds.includes(q.wordId))cells[`archived-word/${reference(q.wordId,map)}`]=json({...q.snapshot.word,id:reference(q.wordId,map)})
  for(const id of data.vocabulary.deletedIds)cells[`deleted/${reference(id,map)}`]=true
  for(const id of data.vocabulary.suppressedBuiltinIds)cells[`suppressed/b:${id}`]=true
  for(const [id,h] of Object.entries(data.learning.history))if(!equal(h,emptyWordHistory()))cells[`progress/${reference(Number(id),map)}`]=json(h)
  for(const id of data.favorites)cells[`favorite/${reference(id,map)}`]=true
  cells['setting/goal']=data.learning.dailyGoal;cells['setting/mode']=data.learning.preferredMode
  cells['activity/start']=json({startedAt:data.learning.activity.startedAt,startedDate:data.learning.activity.startedDate})
  cells['activity/undated']=json(data.learning.activity.undated)
  for(const [day,bucket] of Object.entries(data.learning.activity.days))cells[`activity/${day}`]=json(bucket)
  if(data.learning.session)cells['session/daily']=json(mapSnapshot(data.learning.session,map,true))
  if(data.learning.reviewSession)cells['session/review']=json(mapSnapshot(data.learning.reviewSession,map,true))
  return cells
}
export function decodeData(cells: Cells,map: IdentityMap,now=Date.now()): AppData {
  const vocabulary=emptyUserVocabulary(),history: Record<number,unknown>={},favorites:number[]=[],days:Record<string,Json>={}
  for(const [key,value] of Object.entries(cells)) {
    const [kind,ref]=key.split('/')
    if(kind==='word'&&value&&typeof value==='object'&&!Array.isArray(value)) {const entry=validateEntry(value);if(!entry)throw Error('Invalid vocabulary received from account.');const id=localId(ref,map),word={...entry,id,createdAt:creationTime(value.createdAt)};if(ref.startsWith('b:'))vocabulary.overrides[id]=word;else vocabulary.entries.push(word)}
    if(kind==='deleted'&&value===true)vocabulary.deletedIds.push(localId(ref,map))
    if(kind==='suppressed'&&value===true)vocabulary.suppressedBuiltinIds.push(localId(ref,map))
    if(kind==='progress')history[localId(ref,map)]=value
    if(kind==='favorite'&&value===true)favorites.push(localId(ref,map))
    if(kind==='activity'&&/^\d{4}-\d{2}-\d{2}$/.test(ref))days[ref]=value
  }
  vocabulary.entries=vocabulary.entries.filter(w=>!vocabulary.deletedIds.includes(w.id));vocabulary.nextId=map.nextId
  const catalog=combinedCatalog(vocabulary),initial=emptyLearningState(catalog,now)
  const start=cells['activity/start'] as {startedAt:number;startedDate:string}|undefined
  const learning=parseLearningState({...initial,history,preferredMode:cells['setting/mode']??initial.preferredMode,dailyGoal:cells['setting/goal']??10,activity:{...initial.activity,...start,undated:cells['activity/undated']??initial.activity.undated,days},session:mapSnapshot(cells['session/daily']??null,map,false),reviewSession:mapSnapshot(cells['session/review']??null,map,false)},catalog,now,catalog,vocabulary.deletedIds)
  return {vocabulary,learning,favorites:favorites.filter(id=>catalog.some(w=>w.id===id))}
}
