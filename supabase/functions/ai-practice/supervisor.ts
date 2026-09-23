import type { ControlSocket } from './sidebandSocket.ts'
/** Trusted sideband: no raw event or conversation logging. Socket factory is injected. */
export function supervisor(createSocket:(id:string)=>ControlSocket,keepAlive:(task:Promise<void>)=>void,now:()=>number=Date.now){
 return async(providerId:string,deadline:number,onClosed:(seconds:number|null)=>Promise<void>,onFailure:()=>Promise<void>)=>{
  const socket=createSocket(providerId);let finished=false,resolveDone:()=>void=()=>{}
  const done=new Promise<void>(resolve=>{resolveDone=resolve});keepAlive(done)
  const finish=async(confirmed:boolean,seconds:number|null=null)=>{if(finished)return;finished=true;clearTimeout(expiry);clearTimeout(openTimeout);try{if(confirmed)await onClosed(seconds);else await onFailure()}catch{/* Keep the reservation; scheduled cleanup retries control operations. */}finally{socket.close();resolveDone()}}
  const expiry=setTimeout(()=>{if(socket.readyState===1)socket.send(JSON.stringify({type:'session.close',event_id:crypto.randomUUID()}));void finish(false)},Math.max(0,deadline-now()))
  let openTimeout:ReturnType<typeof setTimeout>
  await new Promise<void>((resolve,reject)=>{
   openTimeout=setTimeout(()=>{void finish(false);reject(Error('Supervision unavailable'))},10000)
   socket.onopen=()=>{clearTimeout(openTimeout);socket.send(JSON.stringify({type:'session.instructions.append',event_id:crypto.randomUUID(),delegation_id:null,content:'Greet the learner now in English and ask one short question inviting use of selected vocabulary. Then pause and listen.'}));resolve()}
   socket.onerror=()=>{void finish(false);reject(Error('Supervision unavailable'))}
   socket.onclose=()=>{if(!finished)void finish(false);reject(Error('Supervision unavailable'))}
   socket.onmessage=event=>{
    if(typeof event.data!=='string'||event.data.length>32000)return
    try{
     const e=JSON.parse(event.data)
     if(e.type==='session.closed'){const seconds=e.usage?.seconds;void finish(true,typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0&&seconds<=86400?seconds:null)}
     else if(e.type==='session.delegation.created'&&e.delegation?.target==='client'&&typeof e.delegation.id==='string'&&e.delegation.id.length<=200){socket.send(JSON.stringify({type:'session.thinking.append',event_id:crypto.randomUUID(),delegation_id:e.delegation.id,content:'No external actions or grading are available. Continue the English vocabulary conversation.'}))}
     else if(e.type==='error')void finish(false)
    }catch{/* Malformed events cannot change application state. */}
   }
  })
  if(finished)throw Error('Supervision unavailable')
  return {close(){void finish(false)}}
 }
}
