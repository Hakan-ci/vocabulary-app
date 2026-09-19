import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AIPractice} from '../../src/aiPractice/AIPractice'
import {MockPracticeProvider} from '../../src/aiPractice/mockProvider'
import {emptyLearningState,assessLearningState} from '../../src/learningState'
import {createSession,submitAnswer} from '../../src/dailyTestModel'
import {words} from '../../src/vocabulary'
import '../../src/index.css'
import '../../src/App.css'
let state=emptyLearningState(words)
state.session=createSession(state.history,Date.now(),()=>.3,'turkishToEnglish',[],words)
while(state.session!.phase!=='completed'){state={...state,session:submitAnswer({...state.session!,draft:'wrong'})};state=assessLearningState(state,false,Date.now(),words)}
export function Fixture(){const [open,setOpen]=useState(true);return <main><p>Source quiz: {state.session!.phase}</p>{open?<AIPractice quiz={state.session!} history={state.history} catalog={words} providerFactory={()=>new MockPracticeProvider({failAt:'respond'})} onExit={()=>setOpen(false)}/>:<h1>Completed quiz results</h1>}</main>}
createRoot(document.getElementById('root')!).render(<Fixture/> )
