import { supervisor } from './supervisor.ts'
import { sweepVoice } from './voice.ts'
declare const EdgeRuntime:{waitUntil:(task:Promise<void>)=>void}
import { createHandler } from './handler.ts'
const env=(name:string)=>Deno.env.get(name)??''
const url=env('SUPABASE_URL'),serviceKey=env('AI_PRACTICE_SERVICE_ROLE_KEY')||env('SUPABASE_SERVICE_ROLE_KEY')
const split=(name:string)=>env(name).split(',').map(s=>s.trim()).filter(Boolean)
const deps={voiceEnabled:env('AI_PRACTICE_VOICE_ENABLED')==='true',supervise:supervisor(id=>new WebSocket(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`,{headers:{Authorization:`Bearer ${env('OPENAI_API_KEY')}`}}),task=>EdgeRuntime.waitUntil(task)),enabled:env('AI_PRACTICE_ENABLED')==='true',allowedUsers:split('AI_PRACTICE_ALLOWED_USER_IDS'),origins:split('AI_PRACTICE_ALLOWED_ORIGINS'),apiKey:env('OPENAI_API_KEY'),hashKey:env('AI_PRACTICE_HASH_KEY'),fetch,
  async authenticate(token:string,signal:AbortSignal){
    const response=await fetch(`${url}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`},signal})
    if(!response.ok)return null
    const user=await response.json()
    return typeof user.id==='string'?{id:user.id,anonymous:user.is_anonymous===true}:null
  },
  async rpc(name:string,args:Record<string,unknown>){
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)})
    if(!response.ok)throw Error('Operational reservation unavailable.')
    return response.json()
  },
}
const handler=createHandler(deps)
Deno.serve(async request => {
  if (new URL(request.url).pathname.endsWith('/cleanup')) {
    const secret = env('AI_PRACTICE_CLEANUP_SECRET')
    if (
      request.method !== 'POST' ||
      secret.length < 32 ||
      request.headers.get('Authorization') !== `Bearer ${serviceKey}` ||
      request.headers.get('x-cleanup-secret') !== secret
    ) return new Response(null, { status: 403 })

    try {
      await sweepVoice(deps)
    } catch (err) {
      console.error('Sweep voice hatası:', err)
    }
    return new Response(null, { status: 204 })
  }
  return handler(request)
})