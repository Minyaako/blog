import { expect, test } from '@playwright/test'

test('search matches tag label, stable id, and aliases', async ({ page }) => {
  await page.goto('/search/')
  const input = page.getByRole('searchbox')
  await expect(input).toHaveAttribute('placeholder', '搜索文章、标签与合集')

  for (const term of ['Astro', 'astro', 'Astro.js']) {
    await input.fill(term)
    await expect(page.getByRole('link', { name: /Astro 内容架构/ })).toBeVisible()
  }
})

test('search initializes after client-side navigation', async ({ page }) => {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: '主导航' })

  for (let visit = 0; visit < 2; visit += 1) {
    await navigation.getByRole('link', { name: '搜索', exact: true }).click()
    await expect(page).toHaveURL(/\/search\/$/)
    await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', '搜索文章、标签与合集')
    await expect(page.locator('#search-fallback')).toBeHidden()
    await expect(page.getByRole('searchbox')).toHaveCount(1)
    await page.getByRole('searchbox').fill('Astro')
    await expect(page.getByRole('link', { name: /Astro 内容架构/ })).toBeVisible()

    if (visit === 0) {
      await navigation.getByRole('link', { name: '首页', exact: true }).click()
      await expect(page).toHaveURL(/\/$/)
    }
  }
})
