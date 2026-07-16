import { expect, test } from '@playwright/test'

test('search discovers the engineering example post', async ({ page }) => {
  await page.goto('/search')
  const input = page.getByRole('searchbox')
  await expect(input).toHaveAttribute('placeholder', '搜索文章、标签与合集')
  await input.fill('内容架构')
  await expect(page.getByRole('link', { name: /Astro 内容架构/ })).toBeVisible()
})
