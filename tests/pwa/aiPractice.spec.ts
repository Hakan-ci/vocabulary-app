import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {emptyLearningState} from '../../src/learningState'
import {words} from '../../src/vocabulary'
import {createSession,submitAnswer} from '../../src/dailyTestModel'
import {assessLearningState} from '../../src/learningState'
function completed(){let state=emptyLearningState(words,Date.now());state.session=createSession(state.history,Date.now(),()=>.3,'turkishToEnglish',[],words);while(state.session!.phase!=='completed'){state={...state,session:submitAnswer({...state.session!,draft:'wrong'})};state=assessLearningState(state,true,Date.now(),words)}return state}
async function setup(page:import('@playwright/test').Page){
 const state=completed()
 await page.addInitScript(value=>{
  if(!localStorage.getItem('ai-test-seeded')){localStorage.setItem('kelime-learning-state',JSON.stringify(value));localStorage.setItem('ai-test-seeded','yes')}
  const original=Storage.prototype.setItem;(window as any).__practiceWrites=[]
  Storage.prototype.setItem=function(key,value){(window as any).__practiceWrites.push(key);return original.call(this,key,value)}
 },state)
 await page.goto('/');await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Daily Test/}).click()
 await expect(page.getByRole('heading',{name:'A little more confident.'})).toBeVisible()
 return state
}
test('optional entry preserves completion actions and cancellation or navigation preserves quiz',async({page})=>{
 await setup(page)
 await expect(page.getByRole('button',{name:'Start another test'})).toBeVisible();await expect(page.getByRole('button',{name:'View Learned'})).toBeVisible()
 await page.getByRole('button',{name:'View Learned'}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Daily Test/}).click()
 const before=await page.evaluate(()=>localStorage.getItem('kelime-learning-state'))
 await page.getByRole('button',{name:'Practice with AI',exact:true}).click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByRole('heading',{name:'A little more confident.'})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('kelime-learning-state'))).toBe(before)
 await page.getByRole('button',{name:'Practice with AI',exact:true}).click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Vocabulary/}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Daily Test/}).click();await expect(page.getByRole('button',{name:'Practice with AI',exact:true})).toBeVisible()
})
for(const mode of ['conversation','useTheWord','voiceAnswer'])test(`${mode}: typed practice writes only compact evidence and confirmed review requests`,async({page})=>{
 await setup(page)
 const before=await page.evaluate(()=>{(window as any).__practiceWrites=[];return localStorage.getItem('kelime-learning-state')})
 await page.getByRole('button',{name:'Practice with AI',exact:true}).click();await page.getByLabel('Practice mode').selectOption(mode);await page.getByRole('button',{name:'Start practice',exact:true}).click()
 const input=page.getByRole('textbox');await expect(input).toBeFocused()
 if(mode==='voiceAnswer')await expect(page.getByLabel('Target vocabulary')).toContainText('Target 1 · Not revealed')
 await input.fill('I have no example.');await input.press('Tab');await page.keyboard.press('Enter');await expect(page.getByRole('status')).toContainText('1 / 8')
 expect(await page.evaluate(()=>(window as any).__practiceWrites)).toEqual([])
 await page.getByRole('button',{name:'End Practice'}).click();await expect(page.getByRole('heading',{name:'AI Practice Complete'})).toBeFocused()
 await expect(page.getByRole('status')).toContainText('Practice outcomes saved.')
 await page.getByRole('button',{name:'Add Selected to Review'}).click();await expect(page.getByRole('status')).toContainText('Selected words added to Review.')
 await page.getByRole('button',{name:'Add Selected to Review'}).click();await expect(page.getByRole('status')).toContainText('Selected words added to Review.')
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!))
 expect(after.history).toEqual(JSON.parse(before!).history);expect(after.session).toEqual(JSON.parse(before!).session)
 expect(Object.keys(after.aiEvidence)).toHaveLength(1);expect(Object.keys(after.reviewRequests)).toHaveLength(1)
 expect(JSON.stringify(after.aiEvidence)).not.toMatch(/I have no example|explanation|corrections|turns/)
 expect(await page.evaluate(()=>(window as any).__practiceWrites)).toEqual(['kelime-local-recovery','kelime-learning-state','kelime-local-recovery','kelime-local-recovery','kelime-learning-state','kelime-local-recovery'])
 await page.setViewportSize({width:320,height:760});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect((await page.getByRole('checkbox').boundingBox())!.width).toBeLessThanOrEqual(24)
 expect((await new AxeBuilder({page}).include('.ai-practice').analyze()).violations).toEqual([])
 await page.screenshot({path:test.info().outputPath('feedback-mobile.png'),fullPage:true})
 await page.getByRole('button',{name:'Finish',exact:true}).click();await expect(page.getByRole('heading',{name:'A little more confident.'})).toBeVisible()
 await page.reload();await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:/Review/}).click()
 await expect(page.getByText('Suggested by AI Practice',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Start Review',exact:true}).click();await expect(page.getByLabel('Question progress')).toHaveText('1 / 1')
 await page.getByRole('textbox').fill('wrong');await page.getByRole('button',{name:'Submit answer →'}).click();await page.getByRole('button',{name:'I knew this',exact:true}).click()
 await expect(page.getByRole('heading',{name:'A little stronger, word by word.'})).toBeVisible()
 const resolved=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('kelime-learning-state')!).reviewRequests) as {status:string}[])
 expect(resolved).toHaveLength(1);expect(resolved[0].status).toBe('resolved')
})
test('refresh discards practice but retains completed quiz',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Practice with AI',exact:true}).click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.reload();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Daily Test/}).click();await expect(page.getByRole('heading',{name:'A little more confident.'})).toBeVisible()
})
