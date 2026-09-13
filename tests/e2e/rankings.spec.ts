import { expect, test } from '@playwright/test'
test.use({ baseURL: process.env.RANKING_E2E_ORIGIN || 'http://127.0.0.1:4321' })

test('community directory replaces static experiments', async ({ page }) => {
  await page.goto('/ranking/')
  await expect(page.getByRole('heading', { level: 1, name: '你的顺序，你的理由。' })).toBeVisible()
  await expect(page.getByRole('link', { name: '创建我的榜单' })).toHaveAttribute('href', '/ranking/new/')
  await expect(page.getByRole('navigation', { name: '按分类筛选' })).toBeVisible()
})

test('old experiment links explicitly return gone', async ({ page }) => {
  for (const slug of ['visual-novels', 'restaurants']) {
    const response = await page.goto(`/ranking/${slug}/`)
    expect(response?.status()).toBe(410)
    await expect(page.getByRole('heading', { level: 1, name: '示例已结束' })).toBeVisible()
  }
})

test('unknown ranking is not public', async ({ page }) => {
  expect((await page.goto('/ranking/not-a-ranking/'))?.status()).toBe(404)
})
