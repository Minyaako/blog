import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/', '/archives', '/moments', '/moments/20260823-143501-a7c31e4f', '/posts/astro-content-architecture', '/posts/embodied-ai-reading', '/about', '/404']) {
  test(`has no serious accessibility violations: ${path}`, async ({ page }) => {
    const response = await page.goto(path)
    if (path === '/moments/20260823-143501-a7c31e4f') {
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-moment-card]')).toHaveCount(1)
    }
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  })
}
