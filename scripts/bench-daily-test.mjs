// CPU benchmark of the Daily Test data path (start / submit / assess / final assess).
// Drives the real Application exactly as App.tsx does, in Node, with in-memory storage
// and a fake durable store that performs the same JSON serialization as IndexedDB's save.
// Usage: node scripts/bench-daily-test.mjs [--json out.json]
import {performance} from 'node:perf_hooks'
import {writeFile} from 'node:fs/promises'
import {Application} from '../src/data/application.ts'
import {memoryStorage,saveLocal,vocabularyRepository} from '../src/data/localRepository.ts'
import {encodeData,decodeData,emptyIdentities} from '../src/data/codec.ts'
import {parseCache} from '../src/data/syncService.ts'
import {parseVocabulary} from '../src/vocabularyImport.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {assessLearningState} from '../src/learningState.ts'
import {combinedCatalog} from '../src/userVocabulary.ts'
Object.defineProperty(navigator,'onLine',{value:false,configurable:true})

// Deterministic PRNG so every run (before/after) uses identical data and question picks.
function prng(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}}
const T0=1700000000000

function seed(words,archived){
  const random=prng(42)
  let data=decodeData({},emptyIdentities(),T0)
  if(words)data=vocabularyRepository.import(data,parseVocabulary(Array.from({length:words},(_,i)=>`word${i} - anlam${i} - noun - Bench`).join('\n'))).data
  const catalog=combinedCatalog(data.vocabulary)
  let learning=data.learning,now=T0
  const sessions={}
  for(let t=0;t<archived;t++){
    learning={...learning,session:createSession(learning.history,now,random,'mixed',[],catalog)}
    for(let q=0;q<10;q++){
      learning={...learning,session:submitAnswer({...learning.session,draft:'wrong'})}
      learning=assessLearningState(learning,random()<.6,now+=60_000,catalog)
    }
    sessions[learning.session.syncId]={source:'daily',practice:learning.session,archivedAt:now}
    learning={...learning,session:null}
    now+=DAY/2
  }
  return {...data,learning:{...learning,sessions}}
}
const DAY=86_400_000

const fakeStore=()=>({async load(key,legacy){return parseCache(legacy.getItem(key))},async save(_key,value){if(typeof value!=='string')JSON.stringify(value)}})

async function makeApp(data,mode){
  if(mode==='guest'){const storage=memoryStorage();saveLocal(storage,data);return new Application(storage)}
  const cells=encodeData(data,emptyIdentities())
  const transport={async pull(){return {revision:1,cells:structuredClone(cells)}},async push(){throw Error('offline')}}
  const app=new Application(memoryStorage(),{project:'bench',transport,store:fakeStore()})
  app.online=true;await app.setUser({id:'bench-user'});app.chooseAccount();await app.sync.flush?.();app.sync.setOnline(false)
  return app
}

// Mirrors App.tsx startTest / submit / assess.
async function timed(app,fn){
  const t=performance.now();fn();const sync=performance.now()-t
  await app.sync?.whenDurable();return {sync,settled:performance.now()-t}
}
async function runTest(app,random){
  const words=combinedCatalog(app.current.vocabulary),out={start:[],submit:[],next:[],results:[]}
  let now=Date.now()
  out.start.push(await timed(app,()=>{const c=app.current.learning;app.saveLearning({...c,session:createSession(c.history,now,random,c.preferredMode,c.session?.questions.map(q=>q.wordId)??[],words)})}))
  for(let i=0;i<10;i++){
    out.submit.push(await timed(app,()=>{const c=app.current.learning;app.saveLearning({...c,session:submitAnswer({...c.session,draft:'wrong'})})}))
    out[i===9?'results':'next'].push(await timed(app,()=>{const c=app.current.learning;app.saveLearning(assessLearningState(c,random()<.5,now+=1000,words))}))
  }
  app.archivePractice('daily');await app.sync?.whenDurable()
  return out
}
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]}
const p95=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*.95))]}

// --scenarios "words:archived,..."  --reps N  --modes guest,account
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:fallback}
const scenarios=arg('--scenarios','0:0,0:50,0:200,1000:50,3000:200').split(',').map(s=>s.split(':').map(Number))
const reps=Number(arg('--reps','5')),modes=arg('--modes','guest,account').split(',')
const rows=[]
for(const mode of modes)for(const [words,archived] of scenarios){
  const data=seed(words,archived),app=await makeApp(data,mode),random=prng(7)
  await runTest(app,random) // warm-up (JIT)
  const all={start:[],submit:[],next:[],results:[]}
  for(let r=0;r<reps;r++){const o=await runTest(app,random);for(const k in o)all[k].push(...o[k])}
  const row={mode,catalog:combinedCatalog(app.current.vocabulary).length,archived,stateKB:Math.round(JSON.stringify(app.current.learning).length/1024)}
  for(const k in all){row[k+'_med']=+median(all[k].map(x=>x.sync)).toFixed(1);row[k+'_p95']=+p95(all[k].map(x=>x.sync)).toFixed(1)}
  rows.push(row);app.sync?.dispose();console.log(JSON.stringify(row))
}
console.table(rows)
const out=process.argv.indexOf('--json');if(out>0)await writeFile(process.argv[out+1],JSON.stringify(rows,null,2))
process.exit(0)
