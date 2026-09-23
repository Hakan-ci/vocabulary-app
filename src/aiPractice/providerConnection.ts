import { practiceResponseError } from './providerError.ts'
import { configuration, supabase } from '../data/supabaseClient.ts'
import type { PracticeTransport } from './openAIProvider.ts'

export async function approvedPracticeTransport(signal:AbortSignal):Promise<PracticeTransport|null>{
  if(import.meta.env.VITE_AI_PRACTICE_PROVIDER!=='openai'||!supabase||!configuration)return null
  const client=supabase,config=configuration
  const {data}=await client.auth.getSession()
  const owner=data.session?.user.id
  if(!owner||data.session?.user.is_anonymous)return null
  const transport:PracticeTransport=async(body,requestSignal)=>{
    const {data:current}=await client.auth.getSession()
    if(!current.session||current.session.user.id!==owner)throw Error('Practice account changed.')
    const response=await fetch(`${config.url}/functions/v1/ai-practice`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${current.session.access_token}`,apikey:config.key},body:JSON.stringify(body),signal:requestSignal})
    if(!response.ok)throw practiceResponseError(await response.json().catch(()=>null))
    return response.json()
  }
  try{const result=await transport({action:'availability'},signal) as {available?:boolean};return result.available===true?transport:null}catch{return null}
}
