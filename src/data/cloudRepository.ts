import { supabase } from './supabaseClient.ts'
import type { CloudSnapshot, CloudTransport } from './models.ts'
import { json,newId } from './models.ts'
function snapshot(value:unknown,owner:string):CloudSnapshot {
  const result=value as CloudSnapshot & {ownerId:string}
  if(result?.ownerId!==owner)throw Object.assign(Error('Account changed during synchronization. The original account actions are retained.'),{code:'42501'})
  if(!Number.isSafeInteger(result.revision)||result.revision<0||!result.cells||typeof result.cells!=='object'||Array.isArray(result.cells))throw Object.assign(Error('The account returned an invalid sync response. No local actions were discarded.'),{code:'KS422'})
  if(!Number.isSafeInteger(result.cells['learning/epoch'])||Number(result.cells['learning/epoch'])<0)throw Object.assign(Error('The account returned invalid reset metadata. Local actions are preserved.'),{code:'KS422'})
  return {revision:result.revision,cells:result.cells}
}
function reconciliation(value:unknown,owner:string,ids:string[]){const result=value as {accepted:string[];snapshot:unknown};if(!Array.isArray(result?.accepted)||result.accepted.some(id=>typeof id!=='string'||!ids.includes(id)))throw Object.assign(Error('Invalid receipt response. Local actions are preserved.'),{code:'KS422'});return {accepted:result.accepted,snapshot:snapshot(result.snapshot,owner)}}
export function cloudRepository(owner:string):CloudTransport {return {
  async pull(){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.rpc('kelime_snapshot_v5',{}).abortSignal(AbortSignal.timeout(15000));if(error)throw error;return snapshot(data,owner)},
  async reconcile(ids){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.rpc('kelime_reconcile_v5',{p_ids:ids}).abortSignal(AbortSignal.timeout(15000));if(error)throw error;return reconciliation(data,owner,ids)},
  async compactDrafts(operations){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.rpc('kelime_compact_drafts_v5',{p_operations:json(operations.map(op=>({...((op.wirePayload??op) as object),accountId:owner}))),p_batch:newId()}).abortSignal(AbortSignal.timeout(15000));if(error)throw error;return reconciliation(data,owner,operations.map(op=>op.id))},
  async push(operation){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.rpc('kelime_apply_v5',{p_operation:json({...((operation.wirePayload??operation) as object),accountId:owner})}).abortSignal(AbortSignal.timeout(15000));if(error){if(error.code==='KS409')return {conflict:true,message:error.message,snapshot:await this.pull()};throw error}const result=data as unknown as {conflict:boolean;snapshot:unknown;message?:string};if(typeof result?.conflict!=='boolean')throw Object.assign(Error('Invalid operation response. Local actions are preserved.'),{code:'KS422'});return {...result,snapshot:snapshot(result.snapshot,owner)}},
}}
