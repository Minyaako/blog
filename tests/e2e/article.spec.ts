import { expect, test } from './fixtures'

test('technical article renders metadata, toc, code, and math', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Astro')
  const toc = page.getByRole('navigation', { name: '文章目录' })
  await expect(toc).toBeVisible()
  await expect(toc).toHaveAttribute('data-toc', '')
  await expect(toc.locator('[data-toc-marker]')).toHaveAttribute('aria-hidden', 'true')
  await expect(toc.locator('[data-toc-link][aria-current="location"]')).toHaveCount(1)
  await expect(toc.locator('[data-toc-link]').first()).toHaveAttribute('href', /^#.+/)
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

test('comment section keeps the permanent article id and guest-only fields', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  const comments = page.locator('[data-comment-slot]')

  await expect(comments).toHaveAttribute('data-page-key', 'engineering-astro-content-architecture')
  await comments.scrollIntoViewIfNeeded()
  await expect(comments.getByText('昵称必填；邮箱选填且不会公开。首版不发送邮件。')).toBeVisible()
  await expect(comments.locator('input[name="nick"]')).toBeVisible()
  await expect(comments.locator('input[name="mail"]')).toBeVisible()
  await expect(comments.locator('input[name="link"]')).toHaveCount(0)
  await expect(comments.locator('.wl-avatar img')).toHaveCount(0)
  await expect(comments.getByRole('button', { name: /登录|上传图片/ })).toHaveCount(0)
})

test('comment outage leaves the article readable and offers retry', async ({ page }) => {
  await page.unroute('https://comments.minyako.top/**')
  await page.route('https://comments.minyako.top/**', (route) => route.abort('failed'))
  await page.goto('/posts/astro-content-architecture')
  await page.locator('[data-comment-slot]').scrollIntoViewIfNeeded()

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Astro')
  await expect(page.locator('[data-comment-status]')).toContainText('评论暂时不可用')
  await expect(page.locator('[data-comment-retry]')).toBeVisible()
})

test('deep replies keep only one visual indentation level', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  const mount = page.locator('[data-comment-mount]')
  await mount.scrollIntoViewIfNeeded()
  await expect(mount.locator('input[name="nick"]')).toBeVisible()
  const margins = await mount.evaluate((element) => {
    element.innerHTML = `
      <div class="wl-card-item" data-depth="root">
        <div class="wl-card">
          <div class="wl-card-item" data-depth="reply">
            <div class="wl-card">
              <div class="wl-card-item" data-depth="deep-reply"><div class="wl-card"></div></div>
            </div>
          </div>
        </div>
      </div>`
    const reply = element.querySelector<HTMLElement>('[data-depth="reply"]')
    const deepReply = element.querySelector<HTMLElement>('[data-depth="deep-reply"]')
    if (!reply || !deepReply) throw new Error('Reply fixture was not inserted')
    return {
      reply: getComputedStyle(reply).marginInlineStart,
      deepReply: getComputedStyle(deepReply).marginInlineStart
    }
  })

  expect(margins.reply).not.toBe('0px')
  expect(margins.deepReply).toBe('0px')
})
