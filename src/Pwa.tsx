import {createContext,useContext,useEffect,useState,useRef} from 'react'
import type {ReactNode} from 'react'
import {useRegisterSW} from 'virtual:pwa-register/react'
interface InstallEvent extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
const Context=createContext({install:async()=>{},installed:false,available:false,instructions:'',update:async()=>{},waiting:false,dismiss:()=>{}})
export function PwaProvider({children}:{children:ReactNode}) {
 const [prompt,setPrompt]=useState<InstallEvent|null>(null),[installed,setInstalled]=useState(()=>matchMedia('(display-mode: standalone)').matches||!!(navigator as Navigator&{standalone?:boolean}).standalone),[instructions,setInstructions]=useState('')
 const requested=useRef(false),activated=useRef(false)
 const {needRefresh:[waiting,setWaiting],updateServiceWorker}=useRegisterSW({immediate:true,onNeedReload:()=>{activated.current=true;if(requested.current)location.reload();else setWaiting(true)}})
 useEffect(()=>{
  const before=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent)}
  const done=()=>{setInstalled(true);setPrompt(null);setInstructions('')}
  window.addEventListener('beforeinstallprompt',before);window.addEventListener('appinstalled',done)
  return()=>{window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',done)}
 },[])
 const install=async()=>{if(prompt){await prompt.prompt();await prompt.userChoice;setPrompt(null)}else setInstructions(/iPad|iPhone|iPod/.test(navigator.userAgent)?'In Safari, open Share, then Add to Home Screen.':'Open your browser menu and choose Install app or Add to Home Screen, if available.')}
 return <Context.Provider value={{install,installed,available:!!prompt,instructions,waiting,dismiss:()=>setWaiting(false),update:async()=>{requested.current=true;if(activated.current)location.reload();else await updateServiceWorker(true)}}}>{children}</Context.Provider>
}
export function InstallButton(){const pwa=useContext(Context);return pwa.installed?null:<div className="install-control"><button className="secondary-button" onClick={()=>void pwa.install()}>Install Kelime</button>{pwa.instructions&&<p role="status">{pwa.instructions}</p>}</div>}
export function UpdateNotice({blocked,save}:{blocked:boolean;save:()=>Promise<boolean>}) {
 const pwa=useContext(Context),[error,setError]=useState('')
 if(!pwa.waiting)return null
 return <aside className="pwa-notice" aria-label="Application update"><span>A new version of Kelime is ready.</span><button disabled={blocked} className="secondary-button" onClick={async()=>{try{if(await save())await pwa.update();else setError('Your changes could not be saved. Keep this window open and try again.')}catch{setError('The update could not finish. Your current window remains available. Try again when online.')}}}>Save and update</button><button className="secondary-button" onClick={pwa.dismiss}>Later</button>{blocked&&<small>Close the editor and resolve storage errors before updating.</small>}{error&&<p role="alert">{error}</p>}</aside>
}
