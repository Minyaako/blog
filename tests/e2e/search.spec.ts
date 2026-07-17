import { expect, test } from '@playwright/test'

test('search matches tag label, stable id, and aliases', async ({ page }) => {
  await page.goto('/search')
  const input = page.getByRole('searchbox')
  await expect(input).toHaveAttribute('placeholder', '搜索文章、标签与合集')

  for (const term of ['Astro', 'astro', 'Astro.js']) {
    await input.fill(term)
    await expect(page.getByRole('link', { name: /Astro 内容架构/ })).toBeVisible()
  }
})
