import {test,expect} from '@playwright/test'
test('injected provider failure returns to a still-completed quiz',async({page})=>{
 await page.goto('/tests/browser/aiPractice.html');await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.getByRole('textbox').fill('My answer');await page.getByRole('button',{name:'Send response'}).click();await expect(page.getByRole('alert')).toContainText('Your completed quiz is unchanged');await expect(page.getByText('Source quiz: completed')).toBeVisible();await page.getByRole('button',{name:'Return to quiz results'}).click();await expect(page.getByRole('heading',{name:'Completed quiz results'})).toBeVisible()
})
for(const scenario of ['evidence','request'])test(`${scenario} storage failure retains choices and retries without duplicate records`,async({page})=>{
 await page.goto('/tests/browser/aiPractice.html?scenario='+scenario)
 await page.getByLabel('Practice mode').selectOption('voiceAnswer');await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.getByRole('textbox').fill('wrong');await page.getByRole('button',{name:'Send response'}).click();await expect(page.getByRole('status')).toContainText('1 / 8');await page.getByRole('textbox').fill('wrong again');await page.getByRole('button',{name:'Send response'}).click();await page.getByRole('button',{name:'End Practice'}).click()
 if(scenario==='evidence'){
  await expect(page.getByRole('alert')).toContainText('have not been saved')
  await expect(page.getByRole('button',{name:'Add Selected to Review'})).toBeDisabled()
  await page.getByRole('checkbox').nth(0).uncheck()
  await page.getByRole('button',{name:'Retry saving outcomes'}).click()
 }
 await expect(page.getByRole('status')).toContainText('Practice outcomes saved.')
 if(scenario==='request')await page.getByRole('checkbox').nth(0).uncheck()
 await expect(page.getByRole('checkbox').nth(0)).not.toBeChecked()
 await page.getByRole('button',{name:'Add Selected to Review'}).click()
 if(scenario==='request'){
  await expect(page.getByRole('alert')).toContainText('Could not save on this device')
  await expect(page.getByRole('checkbox').nth(0)).not.toBeChecked();await expect(page.getByRole('checkbox').nth(1)).toBeChecked()
  await page.getByRole('button',{name:'Add Selected to Review'}).click()
 }
 await expect(page.getByRole('status')).toContainText('Selected words added to Review.')
 await page.getByRole('button',{name:'Add Selected to Review'}).dblclick()
 await expect(page.getByRole('status')).toContainText('Selected words added to Review.')
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!))
 expect(Object.keys(saved.aiEvidence)).toHaveLength(1);expect(Object.keys(saved.reviewRequests)).toHaveLength(1)
 await page.getByRole('button',{name:'Finish',exact:true}).click();await expect(page.getByRole('heading',{name:'Completed quiz results'})).toBeVisible()
})
test('leaving failed evidence save does not claim success or add review requests',async({page})=>{
 await page.goto('/tests/browser/aiPractice.html?scenario=evidence');await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.getByRole('button',{name:'End Practice'}).click()
 await expect(page.getByRole('alert')).toContainText('Leaving now may discard them.')
 await page.getByRole('button',{name:'Finish',exact:true}).click();await expect(page.getByRole('heading',{name:'Completed quiz results'})).toBeVisible()
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kelime-learning-state')!));expect(saved.aiEvidence).toEqual({});expect(saved.reviewRequests).toEqual({})
})
