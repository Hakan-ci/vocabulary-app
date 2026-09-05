import {test,expect,chromium} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
async function ready(page:import('@playwright/test').Page){await page.goto('/');await expect(page.getByRole('heading',{name:/Your vocabulary/})).toBeVisible();await page.evaluate(async()=>{await navigator.serviceWorker.ready});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller)}
async function nav(page:import('@playwright/test').Page,name:RegExp){await page.getByRole('navigation',{name:page.viewportSize()!.width<768?'Mobile navigation':'Main navigation'}).getByRole('button',{name}).click()}
async function mockSpeech(page:import('@playwright/test').Page){await page.addInitScript(()=>{
  class Utterance {text:string;lang='';rate=1;voice:any=null;onstart:(()=>void)|null=null;onend:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(text:string){this.text=text}}
  const voices=[{lang:'en-GB',default:true,name:'English'},{lang:'en-US',default:false,name:'US English'}]
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true})
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>voices,addEventListener:()=>{},removeEventListener:()=>{},cancel:()=>{(window as any).__speechCancels=((window as any).__speechCancels??0)+1},speak:(utterance:Utterance)=>{((window as any).__spoken??=[]).push({text:utterance.text,lang:utterance.lang,rate:utterance.rate,voice:utterance.voice?.lang});utterance.onstart?.()}},configurable:true})
})}
test('manifest, icons and unopened lazy screens work after offline reload',async({page,context})=>{
 await ready(page)
 const manifest=await page.evaluate(async()=>await(await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json());expect(manifest.name).toBe('Kelime');expect(manifest.display).toBe('standalone');expect(manifest.icons).toHaveLength(3)
 for(const icon of manifest.icons){const response=await page.request.get('/'+icon.src);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/png')}
 await context.setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:/Your vocabulary/})).toBeVisible()
 for(const name of [/Progress/,/Review/,/Account/,/Daily Test/]){await nav(page,name);await expect(page.getByText('Loading your learning space…')).toHaveCount(0)}
 await page.getByRole('button',{name:'Start test →'}).click();await expect(page.getByLabel('Turkish meaning',{exact:true})).toBeFocused();await page.getByLabel('Turkish meaning',{exact:true}).fill('saved offline draft')
 await page.reload();await nav(page,/Daily Test/);await page.getByRole('button',{name:'Continue your test'}).click();await expect(page.getByLabel('Turkish meaning',{exact:true})).toHaveValue('saved offline draft');await page.getByLabel('Turkish meaning',{exact:true}).press('Enter');await expect(page.getByText('Incorrect answer',{exact:true})).toBeVisible()
 await page.reload();await nav(page,/Daily Test/);await page.getByRole('button',{name:'Continue your test'}).click();await expect(page.getByText('Incorrect answer',{exact:true})).toBeVisible();await page.getByRole('button',{name:'I knew this',exact:true}).click();await expect(page.getByLabel('Question progress')).toHaveText('2 / 10')
 await nav(page,/Vocabulary/);await page.getByRole('button',{name:'Bulk Add',exact:true}).click();await expect(page.getByRole('textbox',{name:/Paste/})).toBeVisible()
 const cached=await page.evaluate(async()=>{const urls=[];for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys())urls.push(request.url);return urls});expect(cached.some(u=>/supabase\.co|auth\/v1|rest\/v1/.test(u))).toBe(false)
})
test('mobile layouts, drawer keyboard behavior and accessibility',async({page})=>{
 await ready(page)
 for(const width of [375,390,430,768,1024]){
  await page.setViewportSize({width,height:844});await nav(page,/Vocabulary/)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  if(width<768){await page.getByRole('button',{name:'More',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:'Close',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'More',exact:true})).toBeFocused()}
  await nav(page,/Daily Test/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
 await page.setViewportSize({width:390,height:844});const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations).toEqual([])
 for(const name of [/Vocabulary/,/Progress/,/Review/]){await nav(page,name);const check=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(check.violations.map(v=>({id:v.id,targets:v.nodes.slice(0,12).map(n=>n.target)}))).toEqual([])}
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Account',exact:true}).click();expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id)).toEqual([])
 await nav(page,/Vocabulary/);await page.screenshot({path:'test-results/mobile-390.png',fullPage:false});await page.setViewportSize({width:1024,height:900});await page.screenshot({path:'test-results/desktop-1024.png',fullPage:false})
 await page.setViewportSize({width:700,height:375});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('restart confirmation preserves assessed history without awarding completion',async({page})=>{
 await ready(page);await nav(page,/Daily Test/);await page.getByRole('button',{name:'Start test →'}).click();await page.getByLabel('Turkish meaning',{exact:true}).fill('wrong');await page.getByLabel('Turkish meaning',{exact:true}).press('Enter');await page.getByRole('button',{name:'I knew this',exact:true}).click();await page.reload();await nav(page,/Daily Test/)
 await page.getByRole('button',{name:'Start a new test'}).click();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Continue your test'})).toBeVisible();await page.getByRole('button',{name:'Start a new test'}).click();await page.getByRole('button',{name:'Archive and start again'}).click();await expect(page.getByLabel('Question progress')).toHaveText('1 / 10')
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!));expect(Object.values(state.sessions).filter((s:any)=>s.archivedAt)).toHaveLength(1);expect(Object.values(state.history).reduce((n:number,h:any)=>n+h.timesTested,0)).toBe(1)
})
test('update is explicit and deferred while editing',async({page})=>{
 await ready(page);const path='dist/sw.js',original=await readFile(path,'utf8')
 try{await writeFile(path,original+'\n// Update test '+Date.now());await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration())!.update()});await expect(page.getByRole('complementary',{name:'Application update'})).toBeVisible();await page.getByRole('button',{name:'Add Word',exact:true}).click();await expect(page.getByRole('button',{name:'Save and update'})).toBeDisabled();await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('button',{name:'Save and update'})).toBeEnabled();await page.getByRole('button',{name:'Later',exact:true}).click();await expect(page.getByRole('complementary',{name:'Application update'})).toHaveCount(0)}finally{await writeFile(path,original)}
})
test('installed app data survives a browser process restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kelime-pwa-'));let context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,baseURL:'http://127.0.0.1:4187'})
 try{let page=await context.newPage();await ready(page);await page.evaluate(()=>localStorage.setItem('kelime-favorites','[4]'));await context.close();context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,baseURL:'http://127.0.0.1:4187',offline:true});page=await context.newPage();await page.goto('/');await expect(page.getByRole('heading',{name:/Your vocabulary/})).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-favorites')!))).toEqual([4])}finally{await context.close();await rm(dir,{recursive:true,force:true})}
})

test('full Daily Test and Review retain separate typed accuracy and self-assessment',async({page})=>{
 await ready(page);await nav(page,/Daily Test/);await page.getByRole('button',{name:'Start test →'}).click()
 for(let i=0;i<10;i++){
  const answer=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('kelime-learning-state')!).session;return s.questions[s.index].snapshot.acceptedAnswers[0]})
  await page.getByLabel('Turkish meaning',{exact:true}).fill(answer);await page.getByLabel('Turkish meaning',{exact:true}).press('Enter');await expect(page.getByText('Correct answer',{exact:true})).toBeVisible();await page.getByRole('button',{name:'I didn’t know this',exact:true}).click()
 }
 await expect(page.getByText('10 / 10',{exact:true})).toBeVisible();await nav(page,/Review/);await page.getByRole('button',{name:'Start Review',exact:true}).click()
 for(let i=0;i<10;i++){await expect(page.getByLabel('Question progress')).toHaveText(`${i+1} / 10`);await page.getByLabel('Turkish meaning',{exact:true}).fill('wrong');await page.getByLabel('Turkish meaning',{exact:true}).press('Enter');await page.getByRole('button',{name:'I knew this',exact:true}).click()}
 await expect(page.getByRole('region',{name:'Review summary'})).toBeVisible();const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!));expect(state.session.results.every((r:any)=>r.correct&&!r.known)).toBe(true);expect(state.reviewSession.practice.results.every((r:any)=>!r.correct&&r.known)).toBe(true)
 await nav(page,/Progress/);await expect(page.getByRole('heading',{name:'See how far you’ve come.'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('another tab accepting an update never reloads an active test',async({page,context})=>{
 await ready(page);await nav(page,/Daily Test/);await page.getByRole('button',{name:'Start test →'}).click();await page.getByLabel('Turkish meaning',{exact:true}).fill('keep this draft')
 await page.evaluate(()=>{(window as any).kelimeUpdateSentinel=true})
 const other=await context.newPage();await ready(other);const path='dist/sw.js',original=await readFile(path,'utf8')
 try{await writeFile(path,original+'\n// Cross-tab update '+Date.now());await other.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration())!.update()});await expect(other.getByRole('button',{name:'Save and update'})).toBeVisible();await expect(page.getByRole('button',{name:'Save and update'})).toBeVisible();await other.getByRole('button',{name:'Save and update'}).click();await other.waitForEvent('load');expect(await page.evaluate(()=>(window as any).kelimeUpdateSentinel)).toBe(true);await expect(page.getByLabel('Turkish meaning',{exact:true})).toHaveValue('keep this draft')}finally{await writeFile(path,original)}
})

test('filtered multi-selection, Undo, hiding, and Account restoration work offline',async({page})=>{
 await ready(page);const search=page.getByLabel('Search vocabulary')
 await search.fill('hello');await page.getByRole('button',{name:'Select',exact:true}).click();await page.getByRole('button',{name:'Select all results'}).click();await expect(page.getByText('1 selected',{exact:true})).toBeVisible()
 await search.fill('house');await expect(page.getByText('1 outside current results',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Select all results'}).click();await expect(page.getByText('5 selected',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Delete Selected'}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await dialog.getByRole('button',{name:'Remove words'}).click();await expect(page.getByRole('status').filter({hasText:'Words removed'})).toBeVisible();await page.getByRole('button',{name:'Undo',exact:true}).click()
 await search.fill('hello');await expect(page.getByRole('heading',{name:'Hello',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Select',exact:true}).click();await page.getByRole('button',{name:'Select all results'}).click();await page.getByRole('button',{name:'Delete Selected'}).click();await page.getByRole('dialog').getByRole('button',{name:'Remove words'}).click();await page.waitForTimeout(10_300)
 await nav(page,/Account/);await page.getByText('Hidden built-in words (1)').click();await expect(page.getByText(/Hello · Merhaba/)).toBeVisible();await page.getByRole('button',{name:'Restore',exact:true}).click();await nav(page,/Vocabulary/);await search.fill('hello');await expect(page.getByRole('heading',{name:'Hello',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.setViewportSize({width:390,height:844});await search.fill('house');await page.getByRole('button',{name:'Select',exact:true}).click();await page.getByRole('button',{name:'Select all results'}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Cancel',exact:true}).click()
})

test('pronunciation works in vocabulary and editing without leaking reverse answers',async({page})=>{
 await mockSpeech(page);await ready(page)
 await page.getByRole('button',{name:'Pronounce Hello'}).click();expect((await page.evaluate(()=>(window as any).__spoken)).at(-1)).toEqual({text:'Hello',lang:'en-US',rate:1,voice:'en-US'})
 await page.getByRole('button',{name:'Add Word',exact:true}).click();await page.getByLabel('English',{exact:true}).fill('give up');await page.getByRole('button',{name:'Pronounce current English word'}).click();expect((await page.evaluate(()=>(window as any).__spoken)).at(-1).text).toBe('give up')
 await page.getByRole('button',{name:'Close',exact:true}).click();await nav(page,/Daily Test/);await page.getByLabel('Test direction').selectOption('turkishToEnglish');await page.evaluate(()=>(window as any).__spoken=[]);await page.getByRole('button',{name:'Start test →'}).click()
 await expect(page.getByRole('button',{name:/Pronounce/})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(0)
 const answer=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('kelime-learning-state')!).session;return s.questions[s.index].snapshot.acceptedAnswers[0]})
 await page.getByLabel('English meaning',{exact:true}).fill(answer);await page.getByLabel('English meaning',{exact:true}).press('Enter')
 await expect(page.getByRole('button',{name:/Pronounce correct answer/})).toBeVisible();expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(1)
 await nav(page,/Vocabulary/);await nav(page,/Daily Test/);await page.getByRole('button',{name:'Continue your test'}).click();expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(1)
 await nav(page,/Account/);await page.getByLabel('Automatic pronunciation').uncheck();expect((await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!).autoPronunciation))).toBe(false)
 await nav(page,/Vocabulary/);await page.getByRole('button',{name:'Pronounce Hello'}).click();expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(2)
})

test('forward prompts play once and unsupported browsers show one settings note',async({page})=>{
 await mockSpeech(page);await ready(page);await nav(page,/Daily Test/);await page.evaluate(()=>(window as any).__spoken=[]);await page.getByRole('button',{name:'Start test →'}).click()
 await expect(page.getByRole('button',{name:/^Pronounce /})).toBeVisible();expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(1)
 await nav(page,/Vocabulary/);await nav(page,/Daily Test/);await page.getByRole('button',{name:'Continue your test'}).click();expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(1)

 const unsupported=await page.context().newPage();await unsupported.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined,configurable:true})});await ready(unsupported)
 await expect(unsupported.getByRole('button',{name:/Pronounce Hello/})).toHaveCount(0);await nav(unsupported,/Account/);await expect(unsupported.getByText('Pronunciation is not available on this device.')).toHaveCount(1);await unsupported.close()
})
