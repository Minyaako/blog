import { expect, test } from '@playwright/test'

test('technical article renders metadata, toc, code, and math', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Astro')
  await expect(page.getByRole('navigation', { name: '文章目录' })).toBeVisible()
  await expect(page.locator('pre code').first()).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.locator('[data-page-key]')).toHaveAttribute('data-page-key', 'engineering-astro-content-architecture')
})

test('existing public articles use their mapped WebP headers', async ({ page }) => {
  const articles = [
    ['/posts/embodied-ai-reading', '/images/posts/academic-cover.webp'],
    ['/posts/astro-content-architecture', '/images/posts/engineering-cover.webp'],
    ['/posts/july-field-notes', '/images/posts/life-cover.webp']
  ] as const

  for (const [path, cover] of articles) {
    await page.goto(path)
    await expect(page.locator('.cover img')).toHaveAttribute('src', cover)
  }
})
