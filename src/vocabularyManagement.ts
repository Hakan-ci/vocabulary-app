import { emptyActivity } from './activity.ts'
import { emptyHistory, emptyWordHistory } from './learningHistory.ts'
import type { LearningState } from './learningState.ts'
import { words } from './vocabulary.ts'
import { FIRST_USER_ID, combinedCatalog } from './userVocabulary.ts'
import type { UserVocabulary } from './userVocabulary.ts'
import type { AppData } from './data/models.ts'

export type DeletionKind='personal'|'builtIn'
export type SessionSource='Daily Test'|'Review'
export type VocabularyDeletionPlan={version:1;ids:number[];personalIds:number[];builtInIds:number[];missingIds:number[];affectedSessions:SessionSource[];words:{id:number;english:string;kind:DeletionKind}[]}
export type DeletionSnapshot={version:1;commandId:string;createdAt:number;deadline:number|null;plan:VocabularyDeletionPlan;before:AppData;after:AppData}
export type ClearLevel='personal'|'progress'|'everything'

const unique=(ids:readonly number[])=>[...new Set(ids.filter(Number.isSafeInteger))]
export function planVocabularyDeletion(data:AppData,ids:readonly number[]):VocabularyDeletionPlan{
  const requested=unique(ids),catalog=combinedCatalog(data.vocabulary),byId=new Map(catalog.map(word=>[word.id,word])),personal=new Set(data.vocabulary.entries.map(word=>word.id))
  const found=requested.filter(id=>byId.has(id)),personalIds=found.filter(id=>personal.has(id)),builtInIds=found.filter(id=>id<FIRST_USER_ID)
  const targets=new Set(found),affected=new Set<SessionSource>()
  const records=[...Object.values(data.learning.sessions??{}),...(data.learning.session?[{source:'daily' as const,practice:data.learning.session}]:[]),...(data.learning.reviewSession?[{source:'review' as const,practice:data.learning.reviewSession.practice}]:[])]
  for(const record of records)if(!record.archivedAt&&record.practice.phase!=='completed'&&record.practice.questions.some(question=>targets.has(question.wordId)))affected.add(record.source==='daily'?'Daily Test':'Review')
  return {version:1,ids:found,personalIds,builtInIds,missingIds:requested.filter(id=>!byId.has(id)),affectedSessions:[...affected],words:found.map(id=>({id,english:byId.get(id)!.english,kind:personal.has(id)?'personal':'builtIn'}))}
}
function archiveAffected(state:LearningState,ids:Set<number>,now:number):LearningState{
  const sessions={...(state.sessions??{})}
  let session=state.session,reviewSession=state.reviewSession
  const archive=(source:'daily'|'review',practice:NonNullable<LearningState['session']>)=>{
    if(practice.phase==='completed'||!practice.questions.some(question=>ids.has(question.wordId)))return false
    if(practice.syncId)sessions[practice.syncId]={source,practice,archivedAt:now}
    return true
  }
  if(session&&archive('daily',session))session=null
  if(reviewSession&&archive('review',reviewSession.practice))reviewSession=null
  for(const [id,record] of Object.entries(sessions))if(!record.archivedAt&&archive(record.source,record.practice))sessions[id]={...record,archivedAt:now}
  return {...state,sessions,session,reviewSession}
}
export function deleteVocabularyEntries(data:AppData,ids:readonly number[],now=Date.now()):{data:AppData;plan:VocabularyDeletionPlan}{
  const plan=planVocabularyDeletion(data,ids),targets=new Set(plan.ids),learning=archiveAffected(data.learning,targets,now),v=data.vocabulary
  const hiddenBuiltinState={...v.hiddenBuiltinState}
  for(const id of plan.builtInIds)hiddenBuiltinState[id]={id,hiddenAt:now,history:learning.history[id]??emptyWordHistory(),favorite:data.favorites.includes(id)}
  const history=Object.fromEntries(Object.entries(learning.history).filter(([id])=>!targets.has(Number(id))))
  const vocabulary:UserVocabulary={...v,entries:v.entries.filter(word=>!targets.has(word.id)),legacyEntries:v.legacyEntries.filter(word=>!targets.has(word.id)),deletedIds:unique([...v.deletedIds,...plan.personalIds]),hiddenBuiltinIds:unique([...v.hiddenBuiltinIds,...plan.builtInIds]),hiddenBuiltinState}
  return {plan,data:{vocabulary,learning:{...learning,history},favorites:data.favorites.filter(id=>!targets.has(id))}}
}
export function hideBuiltInEntries(data:AppData,ids:readonly number[],now=Date.now()){return deleteVocabularyEntries(data,ids.filter(id=>id<FIRST_USER_ID),now)}
export function restoreBuiltInEntries(data:AppData,ids:readonly number[]):AppData{
  const restoring=unique(ids).filter(id=>data.vocabulary.hiddenBuiltinIds.includes(id)),history={...data.learning.history},favorites=[...data.favorites],state={...data.vocabulary.hiddenBuiltinState}
  for(const id of restoring){const archived=state[id];history[id]=archived?.history??emptyWordHistory();if(archived?.favorite&&!favorites.includes(id))favorites.push(id);delete state[id]}
  return {...data,vocabulary:{...data.vocabulary,hiddenBuiltinIds:data.vocabulary.hiddenBuiltinIds.filter(id=>!restoring.includes(id)),hiddenBuiltinState:state},learning:{...data.learning,history},favorites}
}
export function clearUserVocabulary(data:AppData,now=Date.now()):AppData{return deleteVocabularyEntries(data,data.vocabulary.entries.map(word=>word.id),now).data}
export function resetVocabularyProgress(data:AppData,now=Date.now()):AppData{
  const allPersonal=data.vocabulary.entries.map(word=>word.id),learning=archiveAffected(data.learning,new Set(combinedCatalog(data.vocabulary).map(word=>word.id)),now)
  const vocabulary:UserVocabulary={...data.vocabulary,entries:[],overrides:{},suppressedBuiltinIds:[],hiddenBuiltinIds:[],hiddenBuiltinState:{},legacyEntries:[],deletedIds:unique([...data.vocabulary.deletedIds,...allPersonal])}
  return {vocabulary,favorites:[],learning:{...learning,history:emptyHistory(words),session:null,reviewSession:null,preferredMode:data.learning.preferredMode,dailyGoal:data.learning.dailyGoal}}
}
export function clearVocabularyData(data:AppData,now=Date.now()):AppData{
  const reset=resetVocabularyProgress(data,now)
  return {...reset,learning:{...reset.learning,sessions:{},activity:emptyActivity(now),dailyGoal:10,preferredMode:'englishToTurkish'}}
}
export function vocabularyDeletionSnapshot(data:AppData,ids:readonly number[],commandId:string,now=Date.now()):DeletionSnapshot{
  const result=deleteVocabularyEntries(data,ids,now)
  return {version:1,commandId,createdAt:now,deadline:result.plan.ids.length<=20?now+10_000:null,plan:result.plan,before:structuredClone(data),after:result.data}
}

// Serializable shape reserved for a future full backup exporter.
export const deletionPreflight=(data:AppData,ids:readonly number[])=>structuredClone(planVocabularyDeletion(data,ids))
