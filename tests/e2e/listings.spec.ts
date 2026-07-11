import { expect, test } from '@playwright/test'

test('archive cards keep semantic text and atmospheric image regions', async ({ page }) => {
  await page.goto('/archives')
  const card = page.locator('[data-post-card]').first()
  await expect(card.getByRole('heading')).toBeVisible()
  await expect(card.locator('[data-card-image]')).toBeVisible()
  await expect(card.getByRole('link')).toHaveAttribute('href', /\/posts\//)
})

test('all configured domain entrances resolve', async ({ page }) => {
  for (const domain of ['academic', 'engineering', 'life', 'games']) {
    const response = await page.goto(`/domains/${domain}`)
    expect(response?.status()).toBe(200)
  }
})
