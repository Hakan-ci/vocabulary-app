import type {TestSession} from './dailyTestModel'
export function pruneDrafts(scope:string,sessions:readonly {source:'daily'|'review';practice:TestSession;archivedAt?:number}[],storage:Storage=localStorage){
  const prefix=`kelime-draft:${scope}:`
  const active=new Set(sessions.filter(s=>!s.archivedAt&&s.practice.phase==='answering').map(s=>`${prefix}${s.source}:${s.practice.syncId??'legacy'}:${s.practice.index}`))
  try{for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith(prefix)&&!active.has(key))storage.removeItem(key)}}catch{/* Primary learning state remains authoritative if storage is unavailable. */}
}
