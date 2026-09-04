import { supabase } from './supabaseClient.ts'
import type { CloudSnapshot, CloudTransport } from './models.ts'
import { json } from './models.ts'
function snapshot(value:unknown,owner:string):CloudSnapshot {
  const result=value as CloudSnapshot & {ownerId:string}
  if(result?.ownerId!==owner)throw Error('Account changed during synchronization. The original account actions are retained.')
  if(!Number.isSafeInteger(result.revision)||!result.cells||typeof result.cells!=='object')throw Error('The account returned an invalid sync response. No local actions were discarded.')
  return {revision:result.revision,cells:result.cells}
}
export function cloudRepository(owner:string):CloudTransport {return {
  async pull(){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.rpc('kelime_snapshot',{});if(error)throw error;return snapshot(data,owner)},
  async push(operation){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.rpc('kelime_apply',{p_operation:json({...operation,accountId:owner})});if(error)throw error;const result=data as unknown as {conflict:boolean;snapshot:unknown;message?:string};return {...result,snapshot:snapshot(result.snapshot,owner)}},
}}
