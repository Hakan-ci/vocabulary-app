import {mergeRequest,resolveRequests} from '../aiPractice/learningEvidence.ts'
import type {DurableReviewRequest,ReviewRequests} from '../aiPractice/learningEvidence.ts'
import type {Cells,Operation,Json} from './models.ts'
import {json} from './models.ts'
import {recordAssessment,emptyWordHistory,parseWordHistory} from '../learningHistory.ts'
import {emptyBucket} from '../activity.ts'
import type {ActivityBucket} from '../activity.ts'
import type {TestSession} from '../dailyTestModel.ts'
// Optimistic event replay uses the latest acknowledged aggregate, never stale counter snapshots.
export function projectOperation(cells:Cells,op:Operation):Cells {
 const apply=()=>{const next={...cells};for(const c of op.changes){if(c.after===null)delete next[c.key];else next[c.key]=c.after}return next}
 if(['ai-complete','review-request'].includes(op.kind)){
  if((op.learningEpoch??0)!==Number(cells['learning/epoch']??0))return cells
  const next={...cells}
  for(const c of op.changes){
   if(c.after===null)continue
   if(c.key.startsWith('ai-evidence/')){if(!next[c.key])next[c.key]=c.after}
   if(c.key.startsWith('review-request/'))next[c.key]=json(mergeRequest(next[c.key] as unknown as DurableReviewRequest|undefined,c.after as unknown as DurableReviewRequest))
  }
  return next
 }
 if(op.kind!=='assess'){
  const next=apply()
  if(op.kind==='migration')for(const c of op.changes){
   if(c.key.startsWith('ai-evidence/')&&cells[c.key])next[c.key]=cells[c.key]
   if(c.key.startsWith('review-request/')&&c.after)next[c.key]=json(mergeRequest(cells[c.key] as unknown as DurableReviewRequest|undefined,c.after as unknown as DurableReviewRequest))
  }
  if(['reset-progress','clear-all'].includes(op.kind)){
   for(const key of Object.keys(next))if(key.startsWith('ai-evidence/')||key.startsWith('review-request/'))delete next[key]
  }else if(['delete','bulk-delete','clear-user','migration'].includes(op.kind)){
   for(const [key,value] of Object.entries(next))if(key.startsWith('review-request/')){
    const r=value as unknown as DurableReviewRequest,ref=String(r.wordId)
    if(next['deleted/'+ref]===true||next['hidden/'+ref]===true||op.kind==='clear-user'&&ref.startsWith('u:'))next[key]=json({...r,status:'cancelled',resolvedBy:undefined})
   }
  }
  return next
 }
 const change=op.changes.find(c=>c.key==='session/daily'||c.key==='session/review')
 if(!change)return apply()
 const source=change.key==='session/review'?'review':'daily'
 const practice=(value:Json)=>source==='review'?(value as unknown as {practice:TestSession})?.practice:value as unknown as TestSession
 const before=practice(change.before),after=practice(change.after)
 if(!before||!after||after.results.length!==before.results.length+1)return apply()
 const event=after.results.at(-1)!,id=String(event.wordId),stored=cells['session-record/'+after.syncId] as unknown as {practice:TestSession}|undefined
 if(stored?.practice.results[before.index])return cells // Already accepted or awaiting conflict review.
 const next=apply()
 // Request state is derived from observed IDs, never from stale client snapshots.
 for(const c of op.changes.filter(c=>c.key.startsWith('review-request/'))){if(c.key in cells)next[c.key]=cells[c.key];else delete next[c.key]}
 if(source==='review'){
  const requests=Object.fromEntries(Object.entries(cells).filter(([key])=>key.startsWith('review-request/')).map(([key,value])=>[key.slice(15),value])) as unknown as ReviewRequests
  const resolved=resolveRequests(requests,event.resolvedReviewRequestIds??[],event.wordId,event.direction,event.eventId!)
  for(const [rid,r] of Object.entries(resolved))next['review-request/'+rid]=json(r)
 }
 const key='progress/'+id,h=parseWordHistory(cells[key])??emptyWordHistory()
 next[key]=json(recordAssessment(h,event.known,event.answeredAt??op.at,event.direction))
 const activityKey='activity/'+(event.activityDate??'undated'),bucket=structuredClone(cells[activityKey]??emptyBucket()) as unknown as ActivityBucket
 const counts=bucket[source].directions[event.direction];counts.answered++;counts.correct+=Number(event.correct);counts.known+=Number(event.known);counts.missed+=Number(!event.known)
 if(after.phase==='completed'){bucket[source].completed++;if(source==='daily'){const score=after.results.filter(r=>r.correct).length;bucket[source].scoreSum+=score;bucket[source].bestScore=Math.max(bucket[source].bestScore??0,score)}}
 next[activityKey]=json(bucket)
 return next
}
