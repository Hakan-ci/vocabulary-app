import {test,expect} from '@playwright/test'
test('injected provider failure returns to a still-completed quiz',async({page})=>{
 await page.goto('/tests/browser/aiPractice.html');await page.getByRole('button',{name:'Start practice',exact:true}).click();await page.getByRole('textbox').fill('My answer');await page.getByRole('button',{name:'Send response'}).click();await expect(page.getByRole('alert')).toContainText('Your completed quiz is unchanged');await expect(page.getByText('Source quiz: completed')).toBeVisible();await page.getByRole('button',{name:'Return to quiz results'}).click();await expect(page.getByRole('heading',{name:'Completed quiz results'})).toBeVisible()
})
