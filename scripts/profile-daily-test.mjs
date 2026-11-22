// In-browser Daily Test latency probe: before (HEAD) vs after (working tree).
// Serves isolated temporary copies of both trees with Vite, seeds identical data into the
// mock-account fixture (tests/browser/account.*), and measures, inside the page, the time
// from each click/submit until the next screen has rendered and a frame has been painted.
// Never touches real account storage or .env files.
//
// Usage: node scripts/profile-daily-test.mjs [--variants before,after] [--scenarios guest:0:50,account:1000:50]
//                                           [--reps 2] [--cpu 4]
import {execFileSync} from 'node:child_process'
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:fallback}
const variants=arg('--variants','before,after').split(',')
const scenarios=arg('--scenarios','guest:0:50,account:0:50,account:1000:50').split(',').map(s=>{const [mode,words,archived]=s.split(':');return {mode,words:Number(words),archived:Number(archived)}})
const reps=Number(arg('--reps','2')),cpu=Number(arg('--cpu','4')),cpuProfile=process.argv.includes('--cpu-profile')

// Aggregates a CDP CPU profile by function: self time and inclusive time (top entries).
function printProfile(p,label){
 const byId=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map(),time=new Map()
 for(const n of p.nodes)for(const c of n.children??[])parent.set(c,n.id)
 p.samples.forEach((s,i)=>time.set(s,(time.get(s)??0)+(p.timeDeltas[i]??0)))
 const name=n=>`${n.callFrame.functionName||'(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber+1}`
 const self=new Map(),total=new Map()
 for(const [id,t] of time){const n=byId.get(id);self.set(name(n),(self.get(name(n))??0)+t);const seen=new Set();for(let c=id;c!==undefined;c=parent.get(c)){const k=name(byId.get(c));if(!seen.has(k)){seen.add(k);total.set(k,(total.get(k)??0)+t)}}}
 const all=[...time.values()].reduce((a,b)=>a+b,0),fmt=([k,t])=>`${(t/1000).toFixed(0).padStart(7)} ms ${(100*t/all).toFixed(1).padStart(5)}%  ${k}`
 console.log(`== CPU profile ${label}: ${(all/1000).toFixed(0)} ms sampled`)
 console.log('-- self');for(const e of [...self].sort((a,b)=>b[1]-a[1]).slice(0,15))console.log(fmt(e))
 console.log('-- inclusive');for(const e of [...total].filter(([k])=>!/^\((root|program|idle|anon)\) /.test(k)).sort((a,b)=>b[1]-a[1]).slice(0,30))console.log(fmt(e))
}
const workspace=resolve('.'),temporary=await mkdtemp(resolve('.daily-profile-'))
if(!temporary.startsWith(workspace+'/')&&!temporary.startsWith(workspace+'\\'))throw Error('Unexpected temporary path')
const files=execFileSync('git',['ls-files','src','public','tests/browser','index.html','vite.config.ts','package.json'],{encoding:'utf8'}).trim().split('\n')
const extras=execFileSync('git',['ls-files','--others','--exclude-standard','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chromium',headless:true})
const results=[]
try{
 for(const [v,variant] of variants.entries()){
  const root=resolve(temporary,variant)
  for(const file of variant==='before'?files:[...files,...extras]){
   const target=resolve(root,file);await mkdir(dirname(target),{recursive:true})
   let bytes=variant==='before'?execFileSync('git',['show',`HEAD:${file}`],{maxBuffer:50_000_000}):await readFile(file)
   // Only the temporary copies are instrumented: expose the fixture's Application.
   if(file==='tests/browser/account.tsx')bytes=Buffer.from(bytes.toString().replace('connectApplication(app)','connectApplication(app);(window as any).__app=app'))
   await writeFile(target,bytes)
  }
  const port=4291+v
  const server=await createServer({root,configFile:resolve(root,'vite.config.ts'),logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true}})
  await server.listen()
  try{
   for(const scenario of scenarios){
    const context=await browser.newContext({viewport:{width:390,height:844}})
    const page=await context.newPage()
    // Silence speech so timings exclude it (prompt playback is deferred and async in the app).
    await page.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],addEventListener(){},removeEventListener(){},cancel(){},speak(){}},configurable:true})})
    const url=`http://127.0.0.1:${port}/tests/browser/account.html`
    await page.goto(url);await page.waitForFunction(()=>!!window.__app)
    // Seed identical, deterministic data with the tree's own modules (unthrottled).
    await page.evaluate(async({mode,words,archived})=>{
     const [{decodeData,encodeData,emptyIdentities},{saveLocal,vocabularyRepository},{parseVocabulary},{createSession,submitAnswer},{assessLearningState},{combinedCatalog}]=await Promise.all(['/src/data/codec.ts','/src/data/localRepository.ts','/src/vocabularyImport.ts','/src/dailyTestModel.ts','/src/learningState.ts','/src/userVocabulary.ts'].map(m=>import(m)))
     let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}
     let data=decodeData({},emptyIdentities(),1700000000000)
     if(words)data=vocabularyRepository.import(data,parseVocabulary(Array.from({length:words},(_,i)=>`word${i} - anlam${i} - noun - Bench`).join('\n'))).data
     const catalog=combinedCatalog(data.vocabulary);let learning=data.learning,now=1700000000000;const sessions={}
     for(let t=0;t<archived;t++){
      learning={...learning,session:createSession(learning.history,now,random,'mixed',[],catalog)}
      for(let q=0;q<10;q++){learning={...learning,session:submitAnswer({...learning.session,draft:'wrong'})};learning=assessLearningState(learning,random()<.6,now+=60000,catalog)}
      sessions[learning.session.syncId]={source:'daily',practice:learning.session,archivedAt:now};learning={...learning,session:null};now+=43200000
     }
     data={...data,learning:{...learning,sessions}}
     for(const key of Object.keys(localStorage))localStorage.removeItem(key)
     await new Promise(r=>{const q=indexedDB.deleteDatabase('kelime-accounts');q.onsuccess=q.onerror=q.onblocked=()=>r()})
     const storage={getItem:k=>localStorage.getItem('kelime-fixture:'+k),setItem:(k,v)=>localStorage.setItem('kelime-fixture:'+k,v)}
     storage.setItem('seeded','true')
     if(mode==='guest')saveLocal(storage,data)
     else storage.setItem('server',JSON.stringify({revision:1,cells:encodeData(data,emptyIdentities())}))
    },scenario)
    await page.reload();await page.waitForFunction(()=>!!window.__app)
    if(scenario.mode==='account')await page.evaluate(async()=>{const app=window.__app;await app.setUser({id:'10000000-0000-4000-8000-000000000001'});app.chooseAccount();await app.sync.flush();app.sync.setOnline(false)})
    await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:/Daily Test/}).click()
    await page.getByRole('button',{name:/Start test/}).waitFor()
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu})
    if(cpuProfile){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start')}
    // In-page: run one interaction, wait until the next screen exists, then until a frame is painted.
    const samples=await page.evaluate(async runs=>{
     const frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)))
     const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim().startsWith(text))
     async function measure(act,ready){const t=performance.now();act();while(!ready())await new Promise(r=>requestAnimationFrame(r));await frame();return performance.now()-t}
     const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
     const out={start:[],submit:[],next:[],results:[]}
     for(let run=0;run<=runs;run++){ // run 0 is a warm-up and is discarded
      const keep=run>0,startButton=button('Start test')??button('Start another test')
      const s=await measure(()=>startButton.click(),()=>document.querySelector('#test-answer'));if(keep)out.start.push(s)
      for(let q=0;q<10;q++){
       const input=document.querySelector('#test-answer');setter.call(input,'wrong');input.dispatchEvent(new Event('input',{bubbles:true}))
       await frame()
       const sub=await measure(()=>input.form.requestSubmit(),()=>button('I didn’t know this'));if(keep)out.submit.push(sub)
       const last=q===9,sample=await measure(()=>button('I didn’t know this').click(),()=>last?button('Start another test'):document.querySelector('#test-answer'))
       if(keep)out[last?'results':'next'].push(sample)
      }
     }
     return out
    },reps)
    if(cpuProfile){const {profile}=await cdp.send('Profiler.stop');printProfile(profile,variant+' '+JSON.stringify(scenario))}
    const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]}
    const row={variant,...scenario,cpuThrottle:cpu}
    for(const [k,list] of Object.entries(samples)){row[k+'_med']=Math.round(median(list));row[k+'_max']=Math.round(Math.max(...list))}
    console.log(JSON.stringify(row));results.push(row)
    await context.close()
   }
  }finally{await server.close()}
 }
 await mkdir('test-results',{recursive:true});await writeFile('test-results/daily-test-profile.json',JSON.stringify(results,null,2))
}finally{
 await browser.close()
 await rm(temporary,{recursive:true,force:true}) // verified child of the workspace
}
