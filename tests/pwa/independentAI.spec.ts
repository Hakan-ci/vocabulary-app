import {words} from '../../src/vocabulary'
import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
test('AI Practice is independent, manual selection is bounded, guest voice disabled, quiz works offline',async({page,context})=>{
 await page.goto('/')
 const nav=page.getByRole('navigation',{name:'Main navigation'})
 await nav.getByRole('button',{name:'AI Practice',exact:true}).click()
 await expect(page.getByRole('heading',{name:'AI Practice',exact:true})).toBeVisible()
 await expect(page.getByRole('option',{name:/Conversation — Voice/})).toHaveJSProperty('disabled',true)
 await page.getByLabel('Target selection').selectOption('manual')
 await page.getByLabel('Search vocabulary').fill(words[0].english)
 await page.getByRole('checkbox').first().check()
 await page.getByRole('button',{name:'Start practice',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('0 / 1')
 await page.getByRole('textbox').fill('I practice '+words[0].english+' in a sentence.');await page.getByRole('button',{name:'Send response'}).click()
 await page.getByRole('button',{name:'End Practice'}).click();await expect(page.getByRole('status')).toContainText('Practice outcomes saved')
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!))
 expect(saved.session).toBeNull();expect(Object.values(saved.aiEvidence)[0]).toMatchObject({provenance:'manual',sourceQuizId:null})
 await page.reload();await nav.getByRole('button',{name:'AI Practice',exact:true}).click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await expect(page.getByRole('status')).toContainText('0 / 8')
 await nav.getByRole('button',{name:'Daily Test',exact:true}).click();await context.setOffline(true)
 await page.getByRole('button',{name:/Start.*test/i}).first().click();await expect(page.getByRole('textbox')).toBeVisible();await context.setOffline(false)
})
test('AI Practice and Daily Test are direct mobile peers at 320 and 390 pixels',async({page})=>{
 await page.goto('/')
 for(const width of [320,390]){
  await page.setViewportSize({width,height:780})
  const nav=page.getByRole('navigation',{name:'Mobile navigation'})
  await expect(nav.getByRole('button')).toHaveCount(5)
  await expect(nav.getByRole('button',{name:'Daily Test',exact:true})).toBeVisible()
  await nav.getByRole('button',{name:'AI Practice',exact:true}).click()
  await page.getByLabel('Target selection').selectOption('manual')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).include('.ai-practice').analyze()).violations).toEqual([])
  await nav.getByRole('button',{name:'More',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'Progress',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click()
 }
})
