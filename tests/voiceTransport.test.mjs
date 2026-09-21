import test from 'node:test'
import assert from 'node:assert/strict'
import {browserVoiceConnector} from '../src/aiPractice/voiceTransport.ts'
function browser(){
 const names=['navigator','Audio','RTCPeerConnection'],original=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]))
 let stopped=0,closed=0,paused=0,peer
 const track={enabled:true,stop:()=>stopped++},stream={getTracks:()=>[track],getAudioTracks:()=>[track]}
 class Peer extends EventTarget{
  iceGatheringState='complete';connectionState='connected';localDescription=null;channel={close(){},onmessage:null}
  constructor(){super();peer=this}
  addTrack(){} createDataChannel(){return this.channel} async createOffer(){return {type:'offer',sdp:'v=0\r\ns=offer'}}
  async setLocalDescription(value){this.localDescription=value} async setRemoteDescription(value){this.remote=value}
  async getStats(){return new Map()}close(){closed++}
 }
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}})
 Object.defineProperty(globalThis,'Audio',{configurable:true,value:class {pause(){paused++}async play(){}}})
 Object.defineProperty(globalThis,'RTCPeerConnection',{configurable:true,value:Peer})
 return {track,stream,peer:()=>peer,counts:()=>({stopped,closed,paused}),restore(){for(const name of names){if(original[name])Object.defineProperty(globalThis,name,original[name]);else delete globalThis[name]}}}
}
test('WebRTC transport uses server SDP, scopes close to stable attempt, stops microphone and playback',async()=>{
 const b=browser(),calls=[],states=[],events=[],controller=new AbortController()
 try{
  const transport=async body=>{calls.push(body);return body.action==='voiceCreate'?{sdp:'v=0\r\ns=answer',expiresAt:Date.now()+120000}:{closed:true}}
  const connection=await browserVoiceConnector(transport,{mode:'conversation',targets:[]},crypto.randomUUID())(e=>events.push(e),controller.signal,[],s=>states.push(s))
  assert.deepEqual(states,['requesting','granted']);assert.equal(calls[0].action,'voiceCreate');assert.equal(b.peer().remote.type,'answer')
  connection.mute(true);assert.equal(b.track.enabled,false);connection.mute(false);assert.equal(b.track.enabled,true)
  b.peer().channel.onmessage({data:'not JSON'});b.peer().channel.onmessage({data:JSON.stringify({type:'session.input_transcript.delta',delta:'hello'})});assert.equal(events.length,1)
  assert.equal(await connection.close(),true);assert.equal(await connection.close(),true);connection.dispose()
  assert.equal(calls.length,2);assert.equal(calls[0].attemptId,calls[1].attemptId);assert(b.counts().stopped>=1);assert(b.counts().closed>=1);assert(b.counts().paused>=1)
 }finally{b.restore()}
})
test('permission denial, failed authorization and late microphone grant never leak capture',async()=>{
 const b=browser()
 try{
  let calls=0;const states=[]
  navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}
  await assert.rejects(()=>browserVoiceConnector(async()=>{calls++},{},crypto.randomUUID())(()=>{},new AbortController().signal,[],s=>states.push(s)))
  assert.equal(calls,0);assert.equal(states.at(-1),'denied')
  navigator.mediaDevices.getUserMedia=async()=>b.stream
  await assert.rejects(()=>browserVoiceConnector(async body=>{calls++;if(body.action==='voiceCreate')throw Error('backend');return {closed:false}},{},crypto.randomUUID())(()=>{},new AbortController().signal,[],()=>{}))
  assert.equal(calls,2);assert(b.counts().stopped>=1)
  let grant;const controller=new AbortController();navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>grant=resolve)
  const pending=browserVoiceConnector(async()=>{throw Error('must not dispatch')},{},crypto.randomUUID())(()=>{},controller.signal,[],()=>{});controller.abort();grant(b.stream);await assert.rejects(()=>pending);assert(b.counts().stopped>=2)
 }finally{b.restore()}
})
