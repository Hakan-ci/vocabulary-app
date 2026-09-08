// Reproducible, isolated before/after probe. Never reads real account storage or .env files.
import {execFileSync} from 'node:child_process'
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
const workspace=resolve('.'),temporary=await mkdtemp(resolve('.input-profile-'))
if(!temporary.startsWith(workspace+ '\\')&&!temporary.startsWith(workspace+'/'))throw Error('Unexpected temporary path')
const files=execFileSync('git',['ls-files','src','public','tests/browser','index.html','vite.config.ts','package.json'],{encoding:'utf8'}).trim().split('\n')
// Include new source modules in the working-tree variant.
const extras=execFileSync('git',['ls-files','--others','--exclude-standard','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const results=[]
 for(const variant of ['before','after']){
  const root=resolve(temporary,variant)
  for(const file of variant==='before'?files:[...files,...extras]){
   const target=resolve(root,file);await mkdir(dirname(target),{recursive:true})
   let bytes=variant==='before'?execFileSync('git',['show',`HEAD:${file}`],{maxBuffer:10_000_000}):await readFile(file)
   if(file==='src/App.tsx')bytes=Buffer.from(bytes.toString().replace('  const { stop: stopPronunciation }',"  ;(window as any).__workspaceRenders=((window as any).__workspaceRenders??0)+1\n  const { stop: stopPronunciation }"))
   if(file==='tests/browser/account.tsx')bytes=Buffer.from("import {StrictMode} from 'react'\n"+bytes.toString().replace('connectApplication(app)','connectApplication(app);(window as any).__app=app').replace('.render(<>','.render(<StrictMode><>').replace('</>)','</></StrictMode>)'))
   await writeFile(target,bytes)
  }
  const server=await createServer({root,configFile:resolve(root,'vite.config.ts'),server:{host:'127.0.0.1',port:variant==='before'?4191:4192,strictPort:true}})
  await server.listen()
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}})
   await page.addInitScript(()=>{
    const original=Storage.prototype.setItem;(window).__storageWrites=[]
    Storage.prototype.setItem=function(key,value){window.__storageWrites.push({key,bytes:value.length});return original.call(this,key,value)}
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}lang='';rate=1}
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],addEventListener(){},removeEventListener(){},cancel(){window.__activeSpeech=false},speak(){window.__speaks=(window.__speaks??0)+1;window.__activeSpeech=true}},configurable:true})
   })
   await page.goto(`http://127.0.0.1:${variant==='before'?4191:4192}/tests/browser/account.html`)
   await page.waitForFunction(()=>!!window.__app)
   await page.evaluate(async()=>{const app=window.__app;await app.setUser({id:'10000000-0000-4000-8000-000000000001'});app.chooseAccount();await app.sync.flush();app.sync.setOnline(false)})
   await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:/Daily Test/}).click()
   await page.getByRole('button',{name:/Start test/}).click()
   await page.locator('#test-answer').waitFor()
   await page.waitForFunction(()=>window.__speaks>0)
   await page.evaluate(()=>{
    window.__startupSpeech={count:window.__speaks,active:window.__activeSpeech};window.__workspaceRenders=0;window.__storageWrites=[];window.__speaks=0;window.__enqueues=0;window.__pushes=0;window.__accountWrites=0;window.__accountBytes=0
    const sync=window.__app.sync,enqueue=sync.enqueue.bind(sync),push=sync.transport.push.bind(sync.transport)
    sync.enqueue=(...args)=>{window.__enqueues++;return enqueue(...args)};sync.transport.push=(...args)=>{window.__pushes++;return push(...args)}
    const save=sync.durable.save.bind(sync.durable);sync.durable.save=(key,value)=>{window.__accountWrites++;window.__accountBytes+=JSON.stringify(value).length;return save(key,value)}
    window.__history=JSON.stringify(window.__app.current.learning.history)
    window.__input=document.querySelector('#test-answer')
   })
   const input=page.locator('#test-answer'),start=performance.now()
   await input.pressSequentially('abcdefghijklmnopqrstuvwxyz1234',{delay:1})
   for(let i=0;i<30;i++)await input.press('Backspace')
   const elapsed=performance.now()-start
   await page.waitForTimeout(450)
   const metrics=await page.evaluate(()=>({workspaceRenders:window.__workspaceRenders,enqueues:window.__enqueues,pushes:window.__pushes,speech:window.__speaks,startupSpeech:window.__startupSpeech,accountWrites:window.__accountWrites,accountBytes:window.__accountBytes,storageWrites:window.__storageWrites.length,storageBytes:window.__storageWrites.reduce((n,w)=>n+w.bytes,0),historyUnchanged:window.__history===JSON.stringify(window.__app.current.learning.history),stableInput:window.__input===document.querySelector('#test-answer'),value:document.querySelector('#test-answer').value}))
   if(variant==='after'&&(metrics.workspaceRenders||metrics.enqueues||metrics.pushes||metrics.speech||metrics.accountWrites||!metrics.historyUnchanged||!metrics.stableInput||metrics.startupSpeech.count!==1||!metrics.startupSpeech.active))throw Error('Input isolation regression: '+JSON.stringify(metrics))
   results.push({variant,scenario:'signed-in offline: 30 typed + 30 deleted',...metrics,automationElapsedMs:Math.round(elapsed)})
   if(variant==='after'){
    await page.evaluate(async()=>{window.__app.sync.offline=false;await window.__app.sync.flush()})
    for(const source of ['daily','review']){
     await page.waitForFunction(()=>!window.__app.sync.syncing&&window.__app.sync.cache.queue.length===0)
     await page.evaluate(()=>{window.__workspaceRenders=0;window.__enqueues=0;window.__pushes=0;window.__accountWrites=0;window.__speaks=0;window.__history=JSON.stringify(window.__app.current.learning.history)})
     await input.pressSequentially('abcdefghijklmnopqrstuvwxyz1234',{delay:1})
     for(let i=0;i<30;i++)await input.press('Backspace')
     const online=await page.evaluate(()=>({workspaceRenders:window.__workspaceRenders,enqueues:window.__enqueues,pushes:window.__pushes,accountWrites:window.__accountWrites,speech:window.__speaks,historyUnchanged:window.__history===JSON.stringify(window.__app.current.learning.history)}))
     if(online.workspaceRenders||online.enqueues||online.pushes||online.accountWrites||online.speech||!online.historyUnchanged)throw Error('Online input regression: '+JSON.stringify(online))
     results.push({variant,scenario:`signed-in online ${source}: 30 typed + 30 deleted`,...online})
     if(source==='daily'){
      await input.fill('wrong');await input.press('Enter');await page.getByRole('button',{name:'I didn’t know this',exact:true}).click()
      await page.waitForFunction(()=>!window.__app.sync.syncing&&window.__app.sync.cache.queue.length===0)
      await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:/Review/}).click()
      await page.getByRole('button',{name:'Start Review',exact:true}).click();await input.waitFor()
      await page.waitForTimeout(30)
     }
    }
   }
   await page.close()
  }finally{await server.close()}
 }
 await mkdir('test-results',{recursive:true});await writeFile('test-results/input-profile.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
}finally{
 await browser.close()
 // mkdtemp creates a verified child of this workspace; no user data is stored here.
 await rm(temporary,{recursive:true,force:true})
}
