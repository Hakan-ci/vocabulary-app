import type {VoiceConnector} from '../../src/aiPractice/voiceSession'
import {StrictMode,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AIPractice} from '../../src/aiPractice/AIPractice'
import type {ProviderRequest} from '../../src/aiPractice/provider'
import type {PracticeTransport} from '../../src/aiPractice/openAIProvider'
import {MockPracticeProvider} from '../../src/aiPractice/mockProvider'
import {emptyLearningState,assessLearningState} from '../../src/learningState'
import {createSession,submitAnswer} from '../../src/dailyTestModel'
import {Application} from '../../src/data/application'
import {words} from '../../src/vocabulary'
import '../../src/index.css'
import '../../src/App.css'
let state=emptyLearningState(words)
state.session=createSession(state.history,Date.now(),()=>.3,'turkishToEnglish',[],words)
while(state.session!.phase!=='completed'){state={...state,session:submitAnswer({...state.session!,draft:'wrong'})};state=assessLearningState(state,true,Date.now(),words)}
// Isolated development fixture: production has no query-based failure controls.
const scenario=new URLSearchParams(location.search).get('scenario')??'provider'
let fail=false,attempt=0
const app=new Application({getItem:key=>localStorage.getItem(key),setItem(key,value){if(fail)throw Error('Injected disk failure');localStorage.setItem(key,value)}})
app.saveLearning(state)
const commands=app.aiPracticeCommands()
const persistence={
 complete:async(session:Parameters<typeof commands.complete>[0])=>{if(scenario==='evidence'&&attempt++===0)fail=true;try{return await commands.complete(session)}finally{fail=false}},
 request:async(id:string,selected:readonly number[])=>{if(scenario==='request'&&attempt++===0)fail=true;try{return await commands.request(id,selected)}finally{fail=false}},
}
const calls:({action:string;requestId:string;attemptId:string;learnerIds:string[]})[]=[]
Object.assign(window,{practiceCalls:calls})
let providerFailed=false
const mock=new MockPracticeProvider()
const transport:PracticeTransport=async(body,signal)=>{
 if((body as {action:string}).action==='voiceAvailability')return {available:scenario.startsWith('voice')}
 const r=body as ProviderRequest&{action:'prepare'|'respond'|'finish';attemptId:string}
 calls.push({action:r.action,requestId:r.requestId,attemptId:r.attemptId,learnerIds:r.turns.filter(t=>t.role==='learner').map(t=>t.id)})
 if((scenario==='real-retry'&&r.action==='respond'||scenario==='voice-retry'&&r.action==='finish')&&!providerFailed){providerFailed=true;throw Error('Injected unavailable response')}
 if(scenario==='real-invalid'&&r.action==='finish')return {words:[],corrections:[],strengths:[]}
 if(scenario==='real-cancel'&&r.action==='respond')await new Promise(resolve=>setTimeout(resolve,1000))
 return mock[r.action](r,signal)
}
const loadTransport=async()=>scenario.startsWith('real')||scenario.startsWith('voice')?transport:null
const voiceStats={starts:0,closes:0,disposals:0}
Object.assign(window,{voiceStats})
const voiceConnector:VoiceConnector=async(emit,_signal,_history,microphone)=>{
 voiceStats.starts++;microphone('requesting')
 if(scenario==='voice-denied'){microphone('denied');throw Error('Denied')}
 microphone('granted')
 const timer=setTimeout(()=>{
  emit({type:'session.input_transcript.delta',event_id:'learner'+voiceStats.starts,delta:'I practice '+words[0].english+' in a sentence.',start_ms:0,end_ms:100})
  emit({type:'session.input_transcript.delta',event_id:'misheard'+voiceStats.starts,delta:'Misheard private sentence.',start_ms:2000,end_ms:2100})
  emit({type:'session.output_transcript.delta',event_id:'tutor'+voiceStats.starts,delta:'Tell me more.',start_ms:500,end_ms:600})
  emit({type:'activity',learner:true,tutor:true})
 },50)
 return {close:async()=>{voiceStats.closes++;return true},dispose:()=>{clearTimeout(timer);voiceStats.disposals++},mute:()=>{}}
}
export function Fixture(){const [open,setOpen]=useState(true);return <main><p>Source quiz: {state.session!.phase}</p>{open?<AIPractice persistence={persistence} quiz={scenario.startsWith('voice')?undefined:state.session!} learning={state} voiceConnector={voiceConnector} history={state.history} catalog={words} loadTransport={loadTransport} providerFactory={scenario.startsWith('real')||scenario.startsWith('voice')?undefined:()=>new MockPracticeProvider(scenario==='provider'?{failAt:'respond'}:{})} onExit={()=>setOpen(false)}/>:<h1>Completed quiz results</h1>}</main>}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>)
