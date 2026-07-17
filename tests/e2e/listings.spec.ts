import { expect, test } from '@playwright/test'

test('archive cards keep images clipped and show the visual novel cover', async ({ page }) => {
  await page.goto('/archives')

  const firstCard = page.locator('[data-post-card]').first()
  await expect(firstCard.getByRole('heading')).toBeVisible()
  await expect(firstCard.getByRole('link')).toHaveAttribute('href', /\/posts\//)

  const imageRegion = firstCard.locator('[data-card-image]')
  await expect(imageRegion).toBeVisible()
  expect(await imageRegion.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden')

  const gameCard = page.locator('[data-post-card]', { hasText: '视觉小说中的记忆与重访' })
  await expect(gameCard.locator('[data-card-image] img')).toHaveAttribute(
    'src',
    '/images/posts/games-cover.webp'
  )
})

test('all configured domain entrances resolve', async ({ page }) => {
  for (const domain of ['academic', 'engineering', 'life', 'games']) {
    const response = await page.goto(`/domains/${domain}`)
    expect(response?.status()).toBe(200)
  }
})

test('stable tag routes display labels and aliases', async ({ page }) => {
  await page.goto('/tags/visual-novel')
  await expect(page.getByRole('heading', { name: '#视觉小说' })).toBeVisible()
  await expect(page.getByText('别名：VN、Galgame')).toBeVisible()
  await expect(page.getByRole('link', { name: /视觉小说中的记忆与重访/ })).toBeVisible()
})

test('archive filters use stable tag ids and registry labels', async ({ page }) => {
  await page.goto('/archives')
  await page.getByRole('button', { name: '视觉小说' }).click()
  await expect(page.locator('[data-post-card]:not([hidden])')).toHaveCount(1)
  await expect(page.locator('[data-post-card]:not([hidden])')).toContainText('视觉小说中的记忆与重访')
  await expect(page.getByText('筛选结果：1 篇文章')).toBeVisible()
})
