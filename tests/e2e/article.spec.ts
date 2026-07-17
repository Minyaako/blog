import { expect, test } from './fixtures'

test('technical article renders metadata, toc, code, and math', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Astro')
  await expect(page.getByRole('navigation', { name: '文章目录' })).toBeVisible()
  await expect(page.locator('pre code').first()).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.locator('[data-page-key]')).toHaveAttribute('data-page-key', 'engineering-astro-content-architecture')
  await expect(page.getByRole('link', { name: '#Astro' })).toHaveAttribute('href', '/tags/astro')
})

test('existing public articles use their mapped WebP headers', async ({ page }) => {
  const articles = [
    ['/posts/embodied-ai-reading', 'https://pic.minyako.top/blog/posts/embodied-ai-reading/cover-f03e8a61960275abdd4255138e3e8a5fd471251cefb47024dba6313b04ae5fe2.webp'],
    ['/posts/astro-content-architecture', 'https://pic.minyako.top/blog/posts/astro-content-architecture/cover-619fe237155b1700a886e06d1da193f81f9c7041c38f101422562cf59547eadc.webp'],
    ['/posts/july-field-notes', 'https://pic.minyako.top/blog/posts/july-field-notes/cover-ff5fbec3339faa8a135d735b170515fd0f10313428c29eeb81121ac0205b57ae.webp']
  ] as const

  for (const [path, cover] of articles) {
    await page.goto(path)
    await expect(page.locator('.cover img')).toHaveAttribute('src', cover)
  }
})
