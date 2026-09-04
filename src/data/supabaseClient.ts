import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'
export function clientConfiguration(env: Record<string,string|undefined>) {
  const url=env.VITE_SUPABASE_URL?.trim(),key=env.VITE_SUPABASE_ANON_KEY?.trim()
  if(!url||!key)return null
  try {const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))return null}catch{return null}
  if(key.startsWith('sb_secret_'))return null
  try {if(key.split('.').length===3&&JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role')return null}catch{ /* Supabase reports invalid public keys during authentication. */ }
  return {url,key}
}
export const configuration=clientConfiguration(import.meta.env ?? {})
export const supabase=configuration?createClient<Database>(configuration.url,configuration.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:`kelime-auth:${configuration.url}`}}):null
