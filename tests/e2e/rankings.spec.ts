import { expect, test } from './fixtures'

test('ranking index exposes both static experiment entries', async ({ page }) => {
  await page.goto('/ranking/')

  await expect(page.getByRole('heading', { level: 1, name: '榜单' })).toBeVisible()
  await expect(page.getByText('以下内容均为虚构示例，不代表真实评价。', { exact: true })).toBeVisible()
  await expect(page.locator('[data-ranking-entry]')).toHaveCount(2)
  await expect(page.locator('[data-ranking-entry] a')).toHaveCount(2)
})

test('ranking detail renders only the list selected by its static id', async ({ page }) => {
  await page.goto('/ranking/visual-novels/')

  await expect(page.locator('[data-ranking-list]')).toHaveCount(1)
  await expect(page.locator('[data-ranking-item]')).toHaveCount(3)
  await expect(page.locator('[data-ranking-item]').first()).toHaveAttribute('data-rank', '1')
  await expect(page.getByRole('link', { name: '← 返回榜单入口' })).toHaveAttribute('href', '/ranking/')
})

test('ranking notes use native disclosure semantics', async ({ page }) => {
  await page.goto('/ranking/restaurants/')

  const disclosure = page.locator('[data-ranking-item]').first().locator('details')
  await expect(disclosure).not.toHaveAttribute('open', '')
  await disclosure.locator('summary').click()
  await expect(disclosure).toHaveAttribute('open', '')
  await expect(disclosure.locator('.ranking-note')).toBeVisible()
})

test('unknown ranking ids are not generated', async ({ page }) => {
  const response = await page.goto('/ranking/not-a-ranking/')
  expect(response?.status()).toBe(404)
})
