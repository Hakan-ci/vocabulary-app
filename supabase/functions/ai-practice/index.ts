import { createHandler } from './handler.ts'
const env=(name:string)=>Deno.env.get(name)??''
const url=env('SUPABASE_URL'),serviceKey=env('SUPABASE_SERVICE_ROLE_KEY')
const split=(name:string)=>env(name).split(',').map(s=>s.trim()).filter(Boolean)
Deno.serve(createHandler({enabled:env('AI_PRACTICE_ENABLED')==='true',allowedUsers:split('AI_PRACTICE_ALLOWED_USER_IDS'),origins:split('AI_PRACTICE_ALLOWED_ORIGINS'),apiKey:env('OPENAI_API_KEY'),hashKey:env('AI_PRACTICE_HASH_KEY'),fetch,
  async authenticate(token,signal){
    const response=await fetch(`${url}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`},signal})
    if(!response.ok)return null
    const user=await response.json()
    return typeof user.id==='string'?{id:user.id,anonymous:user.is_anonymous===true}:null
  },
  async rpc(name,args){
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)})
    if(!response.ok)throw Error('Operational reservation unavailable.')
    return response.json()
  },
}))
