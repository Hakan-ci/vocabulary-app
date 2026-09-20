import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AIPractice} from '../../src/aiPractice/AIPractice'
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
export function Fixture(){const [open,setOpen]=useState(true);return <main><p>Source quiz: {state.session!.phase}</p>{open?<AIPractice persistence={persistence} quiz={state.session!} history={state.history} catalog={words} providerFactory={()=>new MockPracticeProvider(scenario==='provider'?{failAt:'respond'}:{})} onExit={()=>setOpen(false)}/>:<h1>Completed quiz results</h1>}</main>}
createRoot(document.getElementById('root')!).render(<Fixture/> )
