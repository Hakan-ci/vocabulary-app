import test from 'node:test'
import assert from 'node:assert/strict'
import {createHandler} from '../supabase/functions/ai-practice/handler.ts'
import {sweepVoice} from '../supabase/functions/ai-practice/voice.ts'
import {supervisor} from '../supabase/functions/ai-practice/supervisor.ts'
const id=()=>crypto.randomUUID(),owner=id(),origin='http://localhost:4188'
const target={wordId:1,english:'achieve',turkishMeanings:['başarmak'],englishAlternatives:[],direction:'turkishToEnglish',difficulty:{score:0,level:'New'},recent:{timesTested:0,timesKnown:0,timesMissed:0,consecutiveKnown:0}}
const input=()=>({action:'voiceCreate',sessionId:id(),requestId:id(),attemptId:id(),context:{mode:'conversation',targets:[target]},turns:[],sdp:'v=0\r\ns=offer'})
const http=body=>new Request(origin,{method:'POST',headers:{origin,authorization:'Bearer account'},body:JSON.stringify(body)})
function fixture(overrides={}){
 const paid=[],rpc=[],supervised=[]
 let closed=false
 const deps={enabled:true,voiceEnabled:true,allowedUsers:[owner],origins:[origin],apiKey:'SECRET',hashKey:'h'.repeat(32),authenticate:async()=>({id:owner,anonymous:false}),
 rpc:async(name,args)=>{rpc.push({name,args});if(name==='kelime_voice_available')return true;if(name==='kelime_voice_reserve')return 'reserved';if(name==='kelime_voice_state'){if(args.p_action==='closed')closed=true;return {providerId:'live_test',expiresAt:Date.now()+120000,closed}};return []},
 fetch:async(url,init)=>{paid.push({url,init});return url.endsWith('/hangup')?new Response(null,{status:200}):Response.json({session:{id:'live_test'},transport:{sdp:'v=0\r\ns=answer'}})},
 supervise:async(...args)=>{supervised.push(args);return {close(){}}},...overrides}
 return {deps,handler:createHandler(deps),paid,rpc,supervised}
}
test('voice authorizes and reserves before fixed server session; SDP only returned after supervision',async()=>{
 const f=fixture(),body=input();body.model='forged';body.context.targets[0]={...target,secret:'PRIVATE'}
 const response=await f.handler(http(body));assert.equal(response.status,200)
 assert.deepEqual(Object.keys(await response.json()).sort(),['expiresAt','sdp']);assert.equal(f.supervised.length,1)
 const config=JSON.parse(f.paid[0].init.body)
 assert.equal(config.session.model,'gpt-live-1');assert.equal(config.session.store,false);assert.equal(config.session.audio.output.voice,'marin');assert.deepEqual(config.session.delegation,{type:'client'})
 assert.deepEqual(config.session.client.data_channel.allowed_client_events,[])
 assert(!config.session.client.data_channel.allowed_server_events.some(e=>e.type==='session.started'||e.type==='session.updated'))
 const modelData=JSON.stringify(config.session);assert(!modelData.includes('PRIVATE'));assert(!modelData.includes(owner));assert(!modelData.includes(body.sessionId));assert(!modelData.includes(body.attemptId));assert(!modelData.includes('SECRET'))
 assert.equal(f.rpc[0].name,'kelime_voice_reserve');assert.doesNotMatch(JSON.stringify(f.rpc),/başarmak|s=offer|achieve/)
})
test('voice denial, malformed requests, exhausted reservations and duplicated delivery never dispatch',async()=>{
 for(const overrides of [{voiceEnabled:false},{supervise:undefined},{authenticate:async()=>({id:owner,anonymous:true})},{allowedUsers:[]},{rpc:async()=> 'duplicate'},{rpc:async()=>{throw Error('database secret')}}]){
  const f=fixture(overrides);assert.notEqual((await f.handler(http(input()))).status,200);assert.equal(f.paid.length,0)
 }
 for(const change of [b=>b.sdp='bad',b=>b.sdp='v=0'+'x'.repeat(65536),b=>b.context.mode='voiceAnswer',b=>b.context.targets=Array(9).fill(target),b=>b.turns=[{id:id(),role:'learner',text:'x'.repeat(2001),at:0}]]){const b=input();change(b);const f=fixture();assert.notEqual((await f.handler(http(b))).status,200);assert.equal(f.paid.length,0)}
})
test('sideband failure hangs up; lost creation remains uncertain without paid automatic retry',async()=>{
 const f=fixture({supervise:async()=>{throw Error('SECRET')}}),response=await f.handler(http(input()))
 assert.equal(response.status,400);assert.equal(f.paid.length,2);assert(f.paid[1].url.endsWith('/hangup'));assert.doesNotMatch(JSON.stringify(await response.json()),/SECRET/)
 const lost=fixture({fetch:async()=>{throw Error('lost')}});await lost.handler(http(input()));assert.equal(lost.rpc.at(-1).args.p_action,'uncertain')
})
test('closing is owner-bound, remains available when voice disabled; sweep reports healthy only after cleanup succeeds',async()=>{
 const f=fixture({voiceEnabled:false});assert.deepEqual(await (await f.handler(http({action:'voiceClose',attemptId:id()}))).json(),{closed:true});assert.equal(f.rpc[0].args.p_owner,owner)
 await sweepVoice(f.deps);assert.equal(f.rpc.at(-1).name,'kelime_voice_heartbeat')
})
test('supervision handles usage once, sanitizes client delegation and forces deadline hangup',async()=>{
 let socket,kept,settled=0,failed=0
 const factory=()=>socket={readyState:1,send(value){this.sent.push(JSON.parse(value))},sent:[],close(){this.readyState=3}}
 const supervise=supervisor(factory,task=>kept=task)
 const pending=supervise('live_test',Date.now()+1000,async seconds=>{assert.equal(seconds,4);settled++},async()=>failed++)
 socket.onopen();await pending
 socket.onmessage({data:JSON.stringify({type:'session.delegation.created',delegation:{target:'client',id:'d'},instructions:'LEAK'})})
 assert.equal(socket.sent.length,2);assert(!JSON.stringify(socket.sent).includes('LEAK'))
 socket.onmessage({data:JSON.stringify({type:'session.closed',usage:{seconds:4}})});await kept;socket.onclose();assert.equal(settled,1);assert.equal(failed,0)
 const timed=supervise('live_test',Date.now()+5,async()=>settled++,async()=>failed++);socket.onopen();await timed;await kept;assert.equal(failed,1)
})
