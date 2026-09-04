import { encodeData,reference } from './codec.ts'
import type { AppData, Cells, IdentityMap, Json } from './models.ts'
import { equal,json } from './models.ts'
import { bucketCounts } from '../activity.ts'
import { englishKey, compatibleSpeech } from '../wordFields.ts'
export type MigrationConflict = {key:string;label:string;device:Json;account:Json}
export type MigrationPreview = {cells:Cells;conflicts:MigrationConflict[];additions:number;historicalAnswers:number}
export type MigrationLinks = Record<number,string|'new'>
export function meaningfulLocal(data:AppData) {return !!(Object.keys(data.learning.activity.days).length||bucketCounts(data.learning.activity.undated).answered||data.vocabulary.entries.length||Object.keys(data.vocabulary.overrides).length||data.vocabulary.deletedIds.length||data.favorites.length||Object.values(data.learning.history).some(h=>h.timesTested||h.learned)||data.learning.session||data.learning.reviewSession||data.learning.dailyGoal!==10||data.learning.preferredMode!=='englishToTurkish')}
export function duplicateCandidates(data:AppData,account:Cells) {
  return data.vocabulary.entries.map(word=>({word,candidates:Object.entries(account).filter(([key,v])=>key.startsWith('word/u:')&&v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.english==='string'&&englishKey(v.english)===englishKey(word.english)&&compatibleSpeech(word,v as unknown as typeof word)).map(([key,v])=>({ref:key.slice(5),word:v as unknown as typeof word}))})).filter(item=>item.candidates.length)
}
export function prepareMigration(data:AppData,account:Cells,map:IdentityMap,links:MigrationLinks,choices:Record<string,'device'|'account'>={}):MigrationPreview {
  // Guest numeric IDs have their own map, never the account's numeric namespace.
  encodeData(data,map)
  map=structuredClone(map)
  const targets=Object.values(links).filter(v=>v!=='new')
  if(new Set(targets).size!==targets.length)throw Error('Link each account word only once; retain other entries separately.')
  for(const [id,target] of Object.entries(links))if(target!=='new'){if(!account[`word/${target}`]||!target.startsWith('u:'))throw Error('The selected account word is no longer available.');map.localToCloud[Number(id)]=target.slice(2)}
  const local=encodeData(data,map),cells={...account},conflicts:MigrationConflict[]=[]
  let additions=0
  // Unmapped device deletion markers must never delete unrelated account vocabulary.
  for(const id of data.vocabulary.deletedIds){const ref=reference(id,map);if(!account[`word/${ref}`]&&!account[`deleted/${ref}`])delete local[`deleted/${ref}`]}
  for(const [key,device] of Object.entries(local)) {
    const remote=account[key]
    if(remote===undefined){cells[key]=device;additions++;continue}
    if(equal(device,remote))continue
    if(key==='activity/start'){const a=device as {startedAt:number},b=remote as {startedAt:number};cells[key]=a.startedAt<b.startedAt?device:remote;continue}
    const choice=choices[key]
    if(!choice)conflicts.push({key,label:key,device:json(device),account:json(remote)})
    else if(choice==='device')cells[key]=device
  }
  return {cells,conflicts,additions,historicalAnswers:(data.learning.session?.results.length??0)+(data.learning.reviewSession?.practice.results.length??0)}
}
