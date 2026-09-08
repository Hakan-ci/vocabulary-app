import {test,expect} from '@playwright/test'
test('mobile Daily Test and Review typing only save small device drafts',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 await page.addInitScript(()=>{
  const original=Storage.prototype.setItem
  ;(window as any).__writes=[]
  Storage.prototype.setItem=function(key,value){(window as any).__writes.push({key,bytes:value.length});return original.call(this,key,value)}
 })
 await page.goto('/')
 const nav=async(name:RegExp)=>page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name}).click()
 await nav(/Daily Test/);await page.getByRole('button',{name:/Start test/}).click()
 for(const source of ['daily','review']){
  const input=page.locator('#test-answer');await expect(input).toBeFocused()
  const before=await page.evaluate(()=>{(window as any).__writes=[];return localStorage.getItem('kelime-learning-state')})
  const element=await input.elementHandle()
  await input.pressSequentially('abcdefghijklmnopqrstuvwxyz1234',{delay:1})
  for(let i=0;i<30;i++)await input.press('Backspace')
  await expect(input).toHaveValue('');await expect(input).toBeFocused()
  expect(await element!.evaluate(node=>node===document.querySelector('#test-answer'))).toBe(true)
  await input.pressSequentially('latest answer',{delay:1})
  await expect.poll(()=>page.evaluate(()=>(window as any).__writes.length)).toBeGreaterThan(0)
  const saved=await page.evaluate(()=>({writes:(window as any).__writes,learning:localStorage.getItem('kelime-learning-state')}))
  expect(saved.learning).toBe(before);expect(saved.writes.every((entry:any)=>entry.key.startsWith('kelime-draft:')&&entry.bytes<=30)).toBe(true)
  await input.fill('submitted immediately');await input.press('Enter')
  await expect(page.getByText('submitted immediately',{exact:true})).toBeVisible()
  if(source==='daily'){
   await page.getByRole('button',{name:'I didn’t know this',exact:true}).click()
   await expect(input).toHaveValue('')
   await nav(/Review/);await page.getByRole('button',{name:'Start Review',exact:true}).click()
  }
 }
})
