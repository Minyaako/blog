import { test as base } from '@playwright/test'

export const test = base.extend<{ stableEnvironment: void }>({
  stableEnvironment: [async ({ page }, use) => {
    await page.clock.install({ time: new Date('2026-07-12T00:00:00+08:00') })
    await page.route('**/api/comments/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
    await page.addInitScript(() => {
      const style = document.createElement('style')
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
      document.documentElement.append(style)
    })
    await use()
  }, { auto: true }]
})

export { expect } from '@playwright/test'
