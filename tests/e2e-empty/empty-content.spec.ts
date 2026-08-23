import { expect, test } from '@playwright/test'

test('an empty blog keeps its public navigation and explicit empty states', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '最新长文' })).toBeVisible()
  await expect(page.getByText('第一篇长文正在准备中。')).toBeVisible()
  await expect(page.locator('[data-post-card]')).toHaveCount(0)

  await page.goto('/archives')
  await expect(page.getByRole('heading', { name: '文章归档' })).toBeVisible()
  await expect(page.locator('[data-filter-status]')).toHaveText('显示全部 0 篇文章')
  await expect(page.locator('[data-post-card]')).toHaveCount(0)

  await page.goto('/tags/visual-novel')
  await expect(page.getByText('尚无公开文章使用此标签。')).toBeVisible()

  await page.goto('/domains/engineering')
  await expect(page.getByRole('heading', { name: '技术' })).toBeVisible()
  await expect(page.locator('[data-post-card]')).toHaveCount(0)
})
