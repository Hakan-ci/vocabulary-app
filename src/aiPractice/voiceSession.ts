import type { PracticeTurn } from './practiceModel.ts'

export type VoiceStatus='connecting'|'listening'|'learner speaking'|'tutor thinking'|'tutor speaking'|'interrupted'|'reconnecting'|'ending'|'ended'|'error'
export type MicrophoneState='not requested'|'requesting'|'granted'|'denied'|'unavailable'|'device error'
export type VoiceEvent={type:string;event_id?:string;delta?:string;start_ms?:number;end_ms?:number;learner?:boolean;tutor?:boolean}
export type VoiceConnection={close:()=>Promise<boolean>;dispose:()=>void;mute:(value:boolean)=>void}
export type VoiceConnector=(emit:(event:VoiceEvent)=>void,signal:AbortSignal,history:PracticeTurn[],microphone:(state:MicrophoneState)=>void)=>Promise<VoiceConnection>
type Fragment={id:string;role:'learner'|'tutor';text:string;start:number;end:number;generation:number}
export class VoiceSession {
 private state:{status:VoiceStatus;microphone:MicrophoneState;turns:PracticeTurn[];error:string|null;confirmed:boolean;muted:boolean}={status:'connecting',microphone:'not requested',turns:[],error:null,confirmed:false,muted:false}
 private listeners=new Set<()=>void>();private abort=new AbortController();private connection:VoiceConnection|null=null;private fragments:Fragment[]=[];private seen=new Set<string>();private generation=0;private disposed=false;private busy=false
 private connect:VoiceConnector;private id:()=>string;private now:()=>number
 constructor(connect:VoiceConnector,id:()=>string=()=>crypto.randomUUID(),now:()=>number=Date.now){this.connect=connect;this.id=id;this.now=now}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 getSnapshot=()=>this.state
 private publish(patch:Partial<typeof this.state>){if(this.disposed)return;this.state={...this.state,...patch};this.listeners.forEach(f=>f())}
 private turns(){
  const result:PracticeTurn[]=[]
  for(const role of ['learner','tutor'] as const){let previous:Fragment|undefined
   for(const f of this.fragments.filter(f=>f.role===role).sort((a,b)=>a.generation-b.generation||a.start-b.start||a.end-b.end||a.id.localeCompare(b.id))){
    const last=result.at(-1)
    if(previous&&previous.generation===f.generation&&f.start-previous.end<1000&&last&&last.text.length+f.text.length<=(role==='learner'?2000:1500))last.text+=f.text
    else result.push({id:f.id,role,text:f.text,at:f.generation*1000000+f.start})
    previous=f
   }
  }
  return result.sort((a,b)=>a.at-b.at||a.role.localeCompare(b.role))
 }
 private receive=(generation:number,event:VoiceEvent)=>{
  if(this.disposed||generation!==this.generation||['ended','error'].includes(this.state.status))return
  if(event.event_id!==undefined&&(typeof event.event_id!=='string'||event.event_id.length>200))return
  if(event.event_id){if(this.seen.has(event.event_id))return;this.seen.add(event.event_id)}
  if(this.seen.size>4096){void this.end();return}
  if(event.type==='session.input_transcript.delta'||event.type==='session.output_transcript.delta'){
   if(typeof event.delta!=='string'||event.delta.length>(event.type==='session.input_transcript.delta'?2000:1500)||typeof event.start_ms!=='number'||typeof event.end_ms!=='number'||!Number.isFinite(event.start_ms)||!Number.isFinite(event.end_ms)||event.start_ms<0||event.end_ms<event.start_ms||event.end_ms>240000){this.publish({error:'An invalid transcript segment was excluded.'});return}
   if(!event.delta)return
   this.fragments.push({id:this.id(),role:event.type==='session.input_transcript.delta'?'learner':'tutor',text:event.delta,start:event.start_ms,end:event.end_ms,generation})
   const turns=this.turns()
   if(turns.filter(t=>t.role==='learner').length>16||turns.length>33){this.fragments.pop();void this.end();return}
   this.publish({turns})
  }else if(event.type==='activity'&&this.state.status!=='ending')this.publish({status:event.learner?(event.tutor?'interrupted':'learner speaking'):event.tutor?'tutor speaking':this.state.status==='learner speaking'?'tutor thinking':'listening'})
  else if(event.type==='session.started')this.publish({status:'listening'})
  else if(event.type==='session.closed')void this.end()
  else if(event.type==='error')void this.fail()
 }
 async start(){
  if(this.busy||this.connection||this.disposed)return
  this.busy=true;const generation=++this.generation;this.abort=new AbortController()
  this.publish({status:generation>1?'reconnecting':'connecting',error:null,confirmed:false})
  try{const connection=await this.connect(e=>this.receive(generation,e),this.abort.signal,this.state.turns,s=>this.publish({microphone:s}));if(this.disposed||generation!==this.generation||this.abort.signal.aborted){connection.dispose();void connection.close().catch(()=>false);return}this.connection=connection;this.publish({status:'listening'})}
  catch{if(!this.disposed&&!this.abort.signal.aborted)this.publish({status:'error',error:'Voice connection unavailable. Your learning data is unchanged.'})}
  finally{this.busy=false}
 }
 mute(value:boolean){this.connection?.mute(value);this.publish({muted:value})}
 async end(){
  if(this.disposed||this.state.status==='ending'||this.state.status==='ended')return
  this.publish({status:'ending'});const connection=this.connection;this.connection=null
  const confirmed=connection?await connection.close().catch(()=>false):false
  connection?.dispose();this.abort.abort()
  this.publish({status:'ended',confirmed,turns:this.turns(),...(confirmed?{}:{error:'Server closure is not yet confirmed. Reconnection is unavailable; you can review the captured text.'})})
 }
 private async fail(){await this.end();this.publish({status:'error',error:'Voice connection interrupted. Review captured text or retry after closure is confirmed.'})}
 async reconnect(){if(!this.state.confirmed||!['ended','error'].includes(this.state.status))return;await this.start()}
 finalized(excluded:ReadonlySet<string>){return this.state.turns.filter(t=>t.role==='learner'&&!excluded.has(t.id)&&t.text.trim()).map(t=>({...t,at:this.now()}))}
 dispose(){if(this.disposed)return;this.disposed=true;this.generation++;this.abort.abort();const connection=this.connection;this.connection=null;if(connection){connection.dispose();void connection.close().catch(()=>false)}this.fragments=[];this.seen.clear();this.listeners.clear()}
}
