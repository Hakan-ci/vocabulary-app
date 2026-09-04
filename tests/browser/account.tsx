// Development fixture only. No real auth, account or guest keys are accessed.
import {createRoot} from 'react-dom/client'
import {ApplicationView} from '../../src/App'
import {Application,connectApplication} from '../../src/data/application'
import {applyChanges} from '../../src/data/syncService'
import {equal} from '../../src/data/models'
import type {CloudTransport,Operation,CloudSnapshot} from '../../src/data/models'
import {decodeData,emptyIdentities} from '../../src/data/codec'
import {saveLocal,vocabularyRepository} from '../../src/data/localRepository'
import {parseVocabulary} from '../../src/vocabularyImport'
import '../../src/index.css'
if(!import.meta.env.DEV)throw Error('Development fixture only')
const storage={getItem:(key:string)=>localStorage.getItem('kelime-fixture:'+key),setItem:(key:string,value:string)=>localStorage.setItem('kelime-fixture:'+key,value)}
if(!storage.getItem('seeded')) {const data=vocabularyRepository.import(decodeData({},emptyIdentities()),parseVocabulary('commute - işe gidip gelmek - verb - Work')).data;data.favorites=[0];saveLocal(storage,data);storage.setItem('seeded','true')}
let offline=false
const state=():CloudSnapshot=>JSON.parse(storage.getItem('server')??'{"revision":0,"cells":{}}')
const transport:CloudTransport={async pull(){if(offline)throw Error('Simulated network failure');return state()},async push(op:Operation){if(offline)throw Error('Simulated network failure');const snapshot=state(),receipts:string[]=JSON.parse(storage.getItem('receipts')??'[]');if(receipts.includes(op.id))return {conflict:false,snapshot};if(op.changes.some(c=>!equal(snapshot.cells[c.key]??null,c.before)))return {conflict:true,snapshot};const next={revision:snapshot.revision+1,cells:applyChanges(snapshot.cells,op.changes)};storage.setItem('server',JSON.stringify(next));storage.setItem('receipts',JSON.stringify([...receipts,op.id]));return {conflict:false,snapshot:next}}}
const user={id:'10000000-0000-4000-8000-000000000001',email:'learner@example.test'}
const auth={async current(){return storage.getItem('signed-in')==='true'?user:null},subscribe(){return()=>{}},async signIn(){storage.setItem('signed-in','true');await app.setUser(user)},async signUp(){return 'Check your email to confirm your account, then sign in.'},async signOut(){storage.setItem('signed-in','false');await app.setUser(null)}}
const app=new Application(storage,{project:'mock-project',transport,auth});connectApplication(app)
createRoot(document.getElementById('root')!).render(<><div style={{padding:8,background:'#fff3cd',display:'flex',gap:10,flexWrap:'wrap'}}><strong>Isolated test fixture</strong><button onClick={()=>{offline=true;app.sync?.setOnline(false)}}>Simulate offline</button><button onClick={()=>{offline=false;app.sync?.setOnline(true)}}>Simulate online</button></div><ApplicationView app={app}/></>)
