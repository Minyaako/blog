import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/', '/archives/', '/moments/', '/moments/20260824-005615-de5f1a7f/', '/posts/astro-content-architecture/', '/posts/embodied-ai-reading/', '/about/', '/404.html']) {
  test(`has no serious accessibility violations: ${path}`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  })
}
