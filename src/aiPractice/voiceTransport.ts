import type { PracticeTransport } from './openAIProvider.ts'
import type { PracticeContext } from './contextBuilder.ts'
import type { VoiceConnector, VoiceEvent } from './voiceSession.ts'

/** SDP and media exist only in memory. Authentication is supplied by the existing transport. */
export function browserVoiceConnector(transport:PracticeTransport,context:PracticeContext,sessionId:string):VoiceConnector{return async(emit,signal,history,microphone)=>{
 let stream:MediaStream|undefined,peer:RTCPeerConnection|undefined,channel:RTCDataChannel|undefined,timer:ReturnType<typeof setInterval>|undefined
 const audio=new Audio();audio.autoplay=true
 const attemptId=crypto.randomUUID();let created=false,closing:Promise<boolean>|null=null
 const dispose=()=>{if(timer)clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());channel?.close();peer?.close();audio.pause();audio.srcObject=null;signal.removeEventListener('abort',dispose)}
 const close=()=>closing??=(async()=>{stream?.getTracks().forEach(t=>t.stop());audio.pause();if(!created)return false;try{const result=await transport({action:'voiceClose',attemptId},AbortSignal.timeout(10000)) as {closed?:boolean};return result.closed===true}catch{return false}})()
 signal.addEventListener('abort',dispose,{once:true})
 try{
  if(!navigator.mediaDevices?.getUserMedia||typeof RTCPeerConnection==='undefined'){microphone('unavailable');throw Error('unavailable')}
  microphone('requesting')
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})}catch(e){microphone(e instanceof DOMException&&e.name==='NotAllowedError'?'denied':'device error');throw e}
  signal.throwIfAborted();microphone('granted')
  peer=new RTCPeerConnection();const pc=peer
  stream.getTracks().forEach(track=>pc.addTrack(track,stream!))
  pc.ontrack=e=>{audio.srcObject=e.streams[0]??new MediaStream([e.track]);void audio.play().catch(()=>emit({type:'error'}))}
  pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState))emit({type:'error'})}
  channel=pc.createDataChannel('oai-events');channel.onmessage=e=>{if(typeof e.data!=='string'||e.data.length>16000)return;try{const event=JSON.parse(e.data) as VoiceEvent;if(event&&typeof event.type==='string')emit(event)}catch{/* Ignore malformed untrusted frames. */}}
  await pc.setLocalDescription(await pc.createOffer())
  // Wait for ICE candidates before sending the SDP; no candidate exchange endpoint is needed.
  if(pc.iceGatheringState!=='complete')await new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',check);signal.removeEventListener('abort',aborted)};const check=()=>{if(pc.iceGatheringState==='complete'){done();resolve()}};const aborted=()=>{done();reject(Error('cancelled'))};const timeout=setTimeout(()=>{done();reject(Error('ICE timeout'))},10000);pc.addEventListener('icegatheringstatechange',check);signal.addEventListener('abort',aborted,{once:true})})
  signal.throwIfAborted()
  // Mark dispatched before awaiting: an uncertain response still needs a close request.
  created=true
  const result=await transport({action:'voiceCreate',sessionId,requestId:attemptId,attemptId,context,turns:history,sdp:pc.localDescription!.sdp},AbortSignal.any([signal,AbortSignal.timeout(35000)])) as {sdp?:string;expiresAt?:number}
  signal.throwIfAborted()
  if(typeof result.sdp!=='string'||result.sdp.length>65536||!Number.isFinite(result.expiresAt))throw Error('Invalid authorization')
  await pc.setRemoteDescription({type:'answer',sdp:result.sdp})
  if(pc.connectionState!=='connected')await new Promise<void>((resolve,reject)=>{
   const done=()=>{clearTimeout(timeout);pc.removeEventListener('connectionstatechange',check);signal.removeEventListener('abort',cancel)}
   const check=()=>{if(pc.connectionState==='connected'){done();resolve()}else if(['failed','closed','disconnected'].includes(pc.connectionState)){done();reject(Error('Connection failed'))}}
   const cancel=()=>{done();reject(Error('cancelled'))}
   const timeout=setTimeout(()=>{done();reject(Error('Connection timeout'))},10000)
   pc.addEventListener('connectionstatechange',check);signal.addEventListener('abort',cancel,{once:true});check()
  })
  const expires=result.expiresAt!
  timer=setInterval(()=>{if(Date.now()>=expires){emit({type:'session.closed'});return}void pc.getStats().then(stats=>{let learner=false,tutor=false;stats.forEach(s=>{if(s.type==='media-source'&&s.kind==='audio')learner ||= s.audioLevel>0.025;if(s.type==='inbound-rtp'&&s.kind==='audio')tutor ||= s.audioLevel>0.025});emit({type:'activity',learner,tutor})}).catch(()=>{})},250)
  return {close,dispose,mute(value){stream?.getAudioTracks().forEach(t=>{t.enabled=!value})}}
 }catch(e){dispose();if(created)await close();throw e}
}}
