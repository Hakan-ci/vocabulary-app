import type { PracticeSession, WordFeedback } from './practiceModel.ts'
import { validateFeedback } from './feedbackValidator.ts'
import { isDirection } from '../learningTypes.ts'
import type { TestDirection } from '../learningTypes.ts'
import type { VocabularyWord } from '../vocabulary.ts'

export type EvidenceWord = Pick<WordFeedback,'wordId'|'outcome'|'retrieval'|'semantic'|'grammar'> & {direction:TestDirection;suggested:boolean}
export type PracticeEvidence = {id:string;sourceQuizId:string|null;completedAt:number;mode:PracticeSession['mode'];evaluator:'mock';epoch:number;words:EvidenceWord[]}
export type DurableReviewRequest = {id:string;wordId:number;direction:TestDirection;requestedAt:number;source:'aiPractice';sourceSessionId:string;epoch:number;status:'active'|'resolved'|'cancelled';resolvedBy?:string}
export type ReviewRequests = Record<string,DurableReviewRequest>
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const timestamp=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=8640000000000000
const epochValid=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0
export function compactEvidence(session:PracticeSession,epoch:number,completedAt:number):PracticeEvidence{
 if(!['feedback','completed'].includes(session.status)||!session.feedback)throw Error('Finalized feedback is required.')
 const feedback=validateFeedback(session.feedback,session.targets,session.turns)
 const evidence={id:session.id,sourceQuizId:session.sourceQuizId,completedAt,mode:session.mode,evaluator:'mock' as const,epoch,words:feedback.words.map(w=>({wordId:w.wordId,direction:session.targets.find(t=>t.wordId===w.wordId)!.direction,outcome:w.outcome,retrieval:w.retrieval,semantic:w.semantic,grammar:w.grammar,suggested:feedback.suggestedReviewWordIds.includes(w.wordId)}))}
 const parsed=parseEvidence(evidence);if(!parsed)throw Error('Invalid practice evidence.');return parsed
}
export function parseEvidence(value:unknown):PracticeEvidence|null{
 if(!value||typeof value!=='object')return null
 const v=value as PracticeEvidence
 if(!uuid(v.id)||v.sourceQuizId!==null&&!uuid(v.sourceQuizId)||!timestamp(v.completedAt)||!epochValid(v.epoch)||v.evaluator!=='mock'||!['voiceAnswer','useTheWord','conversation'].includes(v.mode)||!Array.isArray(v.words)||v.words.length<1||v.words.length>8)return null
 const seen=new Set<number>(),words:EvidenceWord[]=[]
 for(const w of v.words){
  if(!w||!Number.isSafeInteger(w.wordId)||w.wordId<0||seen.has(w.wordId)||!isDirection(w.direction)||!['correct','partial','needsPractice','notAttempted'].includes(w.outcome)||!['recognized','missing','unassessed'].includes(w.retrieval)||!['acceptable','inappropriate','unassessed'].includes(w.semantic)||!['correct','needsCorrection','unassessed'].includes(w.grammar)||typeof w.suggested!=='boolean')return null
  if(w.outcome==='correct'&&(w.retrieval!=='recognized'||w.semantic==='inappropriate')||w.outcome==='partial'&&(w.retrieval!=='recognized'||w.semantic!=='inappropriate')||w.outcome==='needsPractice'&&w.retrieval!=='missing'&&w.semantic!=='inappropriate'||w.outcome==='notAttempted'&&(w.retrieval!=='unassessed'||w.semantic!=='unassessed'||w.grammar!=='unassessed')||w.suggested!==['partial','needsPractice'].includes(w.outcome))return null
  seen.add(w.wordId);words.push({wordId:w.wordId,direction:w.direction,outcome:w.outcome,retrieval:w.retrieval,semantic:w.semantic,grammar:w.grammar,suggested:w.suggested})
 }
 return {id:v.id,sourceQuizId:v.sourceQuizId,completedAt:v.completedAt,mode:v.mode,evaluator:'mock',epoch:v.epoch,words}
}
export function parseRequest(value:unknown):DurableReviewRequest|null{
 if(!value||typeof value!=='object')return null
 const v=value as DurableReviewRequest
 if(!uuid(v.id)||!uuid(v.sourceSessionId)||!Number.isSafeInteger(v.wordId)||v.wordId<0||!isDirection(v.direction)||!timestamp(v.requestedAt)||!epochValid(v.epoch)||v.source!=='aiPractice'||!['active','resolved','cancelled'].includes(v.status)||v.status==='resolved'&&!uuid(v.resolvedBy)||v.status!=='resolved'&&v.resolvedBy!==undefined)return null
 return {id:v.id,wordId:v.wordId,direction:v.direction,requestedAt:v.requestedAt,source:'aiPractice',sourceSessionId:v.sourceSessionId,epoch:v.epoch,status:v.status,...(v.resolvedBy?{resolvedBy:v.resolvedBy}:{})}
}
export function parseEvidenceState(evidence:unknown,requests:unknown,epoch:number,available:readonly number[]){
 const aiEvidence:Record<string,PracticeEvidence>={},reviewRequests:ReviewRequests={}
 for(const [id,raw] of Object.entries(evidence&&typeof evidence==='object'?evidence:{})){const value=parseEvidence(raw);if(value?.id===id&&value.epoch===epoch)aiEvidence[id]=value}
 const seen=new Set<string>()
 const records=Object.entries(requests&&typeof requests==='object'?requests:{}).sort(([a,x],[b,y])=>Number((x as DurableReviewRequest)?.status==='active')-Number((y as DurableReviewRequest)?.status==='active')||a.localeCompare(b))
 for(const [id,raw] of records){
  const value=parseRequest(raw),e=value&&aiEvidence[value.sourceSessionId]
  if(value?.id!==id||!e||value.epoch!==epoch||!e.words.some(w=>w.wordId===value.wordId&&w.direction===value.direction&&w.suggested))continue
  const identity=`${value.sourceSessionId}:${value.wordId}:${value.direction}`
  if(seen.has(identity))continue
  seen.add(identity)
  reviewRequests[id]=!available.includes(value.wordId)?{...value,status:'cancelled',resolvedBy:undefined}:value
 }
 return {aiEvidence,reviewRequests}
}
export const activeRequests=(requests:ReviewRequests,wordId:number,direction?:TestDirection)=>Object.values(requests).filter(r=>r.status==='active'&&r.wordId===wordId&&(!direction||r.direction===direction))
export function confirmReviewRequests(evidence:PracticeEvidence,selected:readonly number[],requests:ReviewRequests,catalog:readonly VocabularyWord[],now:number,id: (wordId:number)=>string=()=>crypto.randomUUID()):ReviewRequests{
 const next={...requests}
 for(const wordId of new Set(selected)){
  const word=evidence.words.find(w=>w.wordId===wordId)
  if(!word?.suggested||!catalog.some(w=>w.id===wordId))throw Error('Invalid or unavailable review suggestion.')
  if(Object.values(next).some(r=>r.sourceSessionId===evidence.id&&r.wordId===wordId&&r.direction===word.direction))continue
  const request:DurableReviewRequest={id:id(wordId),wordId,direction:word.direction,requestedAt:now,source:'aiPractice',sourceSessionId:evidence.id,epoch:evidence.epoch,status:'active'}
  next[request.id]=request
 }
 return next
}
export function resolveRequests(requests:ReviewRequests,ids:readonly string[],wordId:number,direction:TestDirection,eventId:string):ReviewRequests{
 const next={...requests}
 for(const id of ids){const r=next[id];if(!r||r.wordId!==wordId||r.direction!==direction||r.status==='cancelled')continue;next[id]={...r,status:'resolved',resolvedBy:r.resolvedBy&&r.resolvedBy<eventId?r.resolvedBy:eventId}}
 return next
}
export function invalidateRequests(requests:ReviewRequests,ids:readonly number[]):ReviewRequests{return Object.fromEntries(Object.entries(requests).map(([id,r])=>[id,ids.includes(r.wordId)?{...r,status:'cancelled',resolvedBy:undefined}:r]))}
export function mergeRequest(a:DurableReviewRequest|undefined,b:DurableReviewRequest):DurableReviewRequest{
 if(!a)return b
 if(a.id!==b.id||a.wordId!==b.wordId||a.direction!==b.direction||a.source!==b.source||a.sourceSessionId!==b.sourceSessionId||a.epoch!==b.epoch)return a // Never replace an immutable identity during optimistic replay.
 a={...a,requestedAt:Math.min(a.requestedAt,b.requestedAt)}
 if(a.status==='cancelled'||b.status==='cancelled')return {...a,status:'cancelled',resolvedBy:undefined}
 if(a.status==='resolved'||b.status==='resolved')return {...a,status:'resolved',resolvedBy:[a.resolvedBy,b.resolvedBy].filter((v):v is string=>!!v).sort()[0]}
 return a
}

// Stable across devices: target position belongs to immutable evidence, unlike local word IDs.
export async function reviewRequestIdentity(sessionId:string,index:number):Promise<string>{
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`kelime-review:${sessionId}:${index}`))).slice(0,16)
 bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128
 const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
