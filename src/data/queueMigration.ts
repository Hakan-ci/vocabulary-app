import type {Operation,SyncCache} from './models.ts'
import {equal} from './models.ts'
const kinds=['vocabulary','delete','bulk-delete','restore','clear-user','reset-progress','clear-all','favorite','learned','preferences','start','draft','submit','assess','migration','archive','ai-complete','review-request']
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export function migrateQueue(value:SyncCache):SyncCache {
  const quarantine=[...(value.quarantine??[])],queue:Operation[]=[],seen=new Map<string,Operation>()
  for(const raw of value.queue) {
    const op=raw as Operation
    if(!op||!uuid(op.id)||!kinds.includes(op.kind)||!Number.isFinite(op.at)||!Array.isArray(op.changes)||!['pending','processing','failed','conflict'].includes(op.status)||op.changes.some(c=>!c||typeof c!=='object'||typeof c.key!=='string'||!('before'in c)||!('after'in c))||op.notBefore!==undefined&&(!Number.isFinite(op.notBefore)||op.notBefore<op.at)||op.retryCount!==undefined&&(!Number.isSafeInteger(op.retryCount)||op.retryCount<0)||op.nextRetryAt!==undefined&&(!Number.isFinite(op.nextRetryAt)||op.nextRetryAt<0)||op.attempted!==undefined&&typeof op.attempted!=='boolean') {quarantine.push({value:raw,reason:'Malformed operation; original preserved.'});continue}
    if(['ai-complete','review-request'].includes(op.kind)&&(op.protocol!==5||op.learningEpoch===undefined)){quarantine.push({value:raw,reason:'AI command is missing protocol 5 or its captured epoch; original preserved.'});continue}
    if(op.learningEpoch!==undefined&&(!Number.isSafeInteger(op.learningEpoch)||op.learningEpoch<0)){quarantine.push({value:raw,reason:'Invalid learning epoch; original preserved.'});continue}
    if(op.wirePayload){const payload=op.wirePayload as Record<string,unknown>;if(payload.id!==op.id||payload.kind!==op.kind||payload.at!==op.at||payload.learningEpoch!==op.learningEpoch||!equal(payload.changes,op.changes)){quarantine.push({value:raw,reason:'Frozen payload does not match operation identity.'});continue}}
    const previous=seen.get(op.id)
    if(previous){if(!equal(previous,op)){quarantine.push({value:raw,reason:'Same operation ID has different payloads.'});const retained=queue.find(p=>p.id===op.id)!;retained.status='conflict';retained.errorCategory='conflict';retained.message='Ambiguous operation ID; original copies retained.'}continue}
    seen.set(op.id,op)
    const next={...op,protocol:op.protocol??2,attempted:op.attempted??true,retryCount:op.retryCount??0} as Operation
    if(next.status==='processing')next.status='pending'
    if(next.status==='conflict'&&next.message==='This action depends on an unresolved action.') {next.status='pending';next.blockedBy='legacy-dependency';delete next.message}
    if(next.status==='conflict'&&/^(Invalid |Unknown built-in ID|Duplicate record changes|Automatic pronunciation must be a boolean|Directional counters do not match)/.test(next.message??'')){next.status='failed';next.errorCategory='permanent'}
    queue.push(next)
  }
  const compacted:Operation[]=[]
  for(const op of queue){if(op.attempted===false&&op.status==='pending'&&!op.notBefore&&op.expectedRevision===undefined&&coalesceTail(compacted,op))continue;compacted.push(op)}
  return {...value,version:6,queue:compacted,...(quarantine.length?{quarantine}:{})}
}
// Only explicitly unsent state operations may be rewritten. Events and commands are barriers.
export function coalesceTail(queue:Operation[],op:Operation):string|undefined {
  const stateKinds=['favorite','preferences','learned','vocabulary','draft']
  if(!stateKinds.includes(op.kind))return undefined
  for(let index=queue.length-1;index>=0;index--){
    const last=queue[index]
    if(last.attempted!==false||last.status!=='pending'||last.notBefore||last.expectedRevision!==undefined||!stateKinds.includes(last.kind))break
    const overlaps=last.changes.some(c=>op.changes.some(p=>p.key===c.key))
    if(last.kind===op.kind&&equal(last.changes.map(c=>c.key).sort(),op.changes.map(c=>c.key).sort())&&op.changes.every(c=>equal(last.changes.find(p=>p.key===c.key)!.after,c.before))){
      last.changes=op.changes.map(c=>({...c,before:last.changes.find(p=>p.key===c.key)!.before}))
      return last.id
    }
    if(overlaps||last.kind==='draft'||op.kind==='draft')break
  }
  return undefined
}
