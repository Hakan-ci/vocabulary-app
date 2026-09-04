import type {Cells,Operation,Json} from './models.ts'
import {json} from './models.ts'
import {recordAssessment,emptyWordHistory,parseWordHistory} from '../learningHistory.ts'
import {emptyBucket} from '../activity.ts'
import type {ActivityBucket} from '../activity.ts'
import type {TestSession} from '../dailyTestModel.ts'
// Optimistic event replay uses the latest acknowledged aggregate, never stale counter snapshots.
export function projectOperation(cells:Cells,op:Operation):Cells {
 const apply=()=>{const next={...cells};for(const c of op.changes){if(c.after===null)delete next[c.key];else next[c.key]=c.after}return next}
 if(op.kind!=='assess')return apply()
 const change=op.changes.find(c=>c.key==='session/daily'||c.key==='session/review')
 if(!change)return apply()
 const source=change.key==='session/review'?'review':'daily'
 const practice=(value:Json)=>source==='review'?(value as unknown as {practice:TestSession})?.practice:value as unknown as TestSession
 const before=practice(change.before),after=practice(change.after)
 if(!before||!after||after.results.length!==before.results.length+1)return apply()
 const event=after.results.at(-1)!,id=String(event.wordId),stored=cells['session-record/'+after.syncId] as unknown as {practice:TestSession}|undefined
 if(stored?.practice.results[before.index])return cells // Already accepted or awaiting conflict review.
 const next=apply(),key='progress/'+id,h=parseWordHistory(cells[key])??emptyWordHistory()
 next[key]=json(recordAssessment(h,event.known,event.answeredAt??op.at,event.direction))
 const activityKey='activity/'+(event.activityDate??'undated'),bucket=structuredClone(cells[activityKey]??emptyBucket()) as unknown as ActivityBucket
 const counts=bucket[source].directions[event.direction];counts.answered++;counts.correct+=Number(event.correct);counts.known+=Number(event.known);counts.missed+=Number(!event.known)
 if(after.phase==='completed'){bucket[source].completed++;if(source==='daily'){const score=after.results.filter(r=>r.correct).length;bucket[source].scoreSum+=score;bucket[source].bestScore=Math.max(bucket[source].bestScore??0,score)}}
 next[activityKey]=json(bucket)
 return next
}
