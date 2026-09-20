import { extractResponse, modelBody, MODEL, parseRequest, reservationMicros, usage, validateResult } from './contract.ts'
export type BackendDependencies={
  enabled:boolean;allowedUsers:readonly string[];origins:readonly string[];apiKey:string;hashKey:string
  authenticate:(token:string,signal:AbortSignal)=>Promise<{id:string;anonymous:boolean}|null>
  rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>
  fetch:typeof fetch;now?:()=>number;deadline?:()=>AbortSignal
}
async function boundedJSON(request:Request,signal:AbortSignal){
  if(Number(request.headers.get('content-length'))>131072||!request.body)throw Error('invalid_request')
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0
  const abort=()=>{void reader.cancel()}
  signal.addEventListener('abort',abort,{once:true})
  try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>131072)throw Error('invalid_request');chunks.push(value)}}finally{signal.removeEventListener('abort',abort);await reader.cancel()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}
async function fingerprint(value:unknown,secret:string){
  const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('')
}
export function createHandler(deps:BackendDependencies){return async(request:Request)=>{
  const origin=request.headers.get('origin'),allowed=!!origin&&deps.origins.includes(origin)
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowed?{'Access-Control-Allow-Origin':origin!,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})}
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers})
  if(!allowed)return reply(403,{error:'unavailable'})
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST')return reply(405,{error:'unavailable'})
  const signal=AbortSignal.any([request.signal,deps.deadline?.()??AbortSignal.timeout(30000)])
  let reservation:{owner:string;attempt:string}|null=null,reported:ReturnType<typeof usage>=null
  const started=(deps.now??Date.now)();let category='unavailable'
  try{
    if(!deps.enabled||!deps.apiKey||deps.hashKey.length<32)return reply(503,{error:'unavailable'})
    const bearer=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if(!bearer)return reply(401,{error:'authentication_required'})
    const user=await deps.authenticate(bearer,signal)
    if(!user||user.anonymous)return reply(401,{error:'authentication_required'})
    if(!deps.allowedUsers.includes(user.id))return reply(403,{error:'unavailable'})
    category='invalid_request';const raw=await boundedJSON(request,signal)
    if(raw&&typeof raw==='object'&&(raw as {action?:unknown}).action==='availability')return reply(200,{available:true})
    category='invalid_request';const input=parseRequest(raw),body=modelBody(input)
    const payloadHash=await fingerprint({action:input.action,context:input.context,turns:input.turns},deps.hashKey)
    category='limit';const result=await deps.rpc('kelime_ai_reserve',{p_owner:user.id,p_session:input.sessionId,p_request:input.requestId,p_attempt:input.attemptId,p_fingerprint:payloadHash,p_model:MODEL,p_cost:reservationMicros(body)})
    if(result!=='reserved')return reply(429,{error:'limit_or_duplicate'})
    reservation={owner:user.id,attempt:input.attemptId}
    category='provider_unavailable'
    signal.throwIfAborted()
    const response=await deps.fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${deps.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal})
    if(!response.ok)throw Error('provider_unavailable')
    const envelope=await response.json();reported=usage(envelope)
    category='invalid_output';const output=validateResult(extractResponse(envelope),input)
    signal.throwIfAborted()
    category='success'
    return reply(200,output)
  }catch{return reply(category==='invalid_request'?400:502,{error:signal.aborted?'timeout':category})}
  finally{
    if(reservation){try{await deps.rpc('kelime_ai_settle',{p_owner:reservation.owner,p_attempt:reservation.attempt,p_status:signal.aborted?'timeout':category,p_latency:Math.max(0,(deps.now??Date.now)()-started),p_input:reported?.input??null,p_output:reported?.output??null})}catch{/* Reservation remains charged and expires without logging content. */}}
  }
}}
