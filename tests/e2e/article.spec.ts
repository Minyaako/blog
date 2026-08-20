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

test('comment section keeps the permanent article id and optional guest fields', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  const comments = page.locator('[data-comment-slot]')

  await expect(comments).toHaveAttribute('data-page-key', 'engineering-astro-content-architecture')
  await comments.scrollIntoViewIfNeeded()
  await expect(comments.getByText('可匿名评论，也可登录同步昵称与头像；邮箱选填且不会公开。')).toBeVisible()
  await expect(comments.locator('input[name="nick"]')).toBeVisible()
  await expect(comments.locator('input[name="mail"]')).toBeVisible()
  await expect(comments.locator('input[name="link"]')).toHaveCount(0)
  await expect(comments.getByRole('button', { name: /登录/ })).toBeVisible()
  await expect(comments.getByRole('button', { name: /上传图片/ })).toHaveCount(0)
})

test('comment composer exposes a readable editable surface, emoji, and initial avatars', async ({ page }) => {
  const emojiRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/comments/emoji/tw-emoji/')) emojiRequests.push(request.url())
  })
  await page.goto('/posts/astro-content-architecture')
  const comments = page.locator('[data-comment-slot]')
  await comments.scrollIntoViewIfNeeded()
  const editor = comments.locator('.wl-editor')
  await expect(editor).toBeVisible()

  const metrics = await editor.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      fontSize: Number.parseFloat(style.fontSize),
      paddingLeft: Number.parseFloat(style.paddingLeft)
    }
  })
  expect(metrics.fontSize).toBeGreaterThanOrEqual(17)
  expect(metrics.paddingLeft).toBeGreaterThanOrEqual(12)
  expect(metrics.borderWidth).not.toBe('0px')
  expect(metrics.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')

  await editor.click({ position: { x: 8, y: 24 } })
  await editor.fill('left-edge-input')
  await expect(editor).toHaveValue('left-edge-input')
  await comments.getByRole('button', { name: '表情' }).click()
  const emojiPopup = comments.locator('.wl-emoji-popup')
  await expect(emojiPopup.locator('img').first()).toBeVisible()
  await expect.poll(() => emojiRequests.some((url) => url.endsWith('/comments/emoji/tw-emoji/info.json'))).toBe(true)
  await expect(emojiPopup.locator('img').first()).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:4321\/comments\/emoji\/tw-emoji\//)
  const popupLayout = await emojiPopup.evaluate((popup) => {
    const panel = popup.closest('.wl-panel')
    if (!panel) throw new Error('Emoji popup panel was not found')
    const popupRect = popup.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    return {
      extendsBeyondPanel: popupRect.bottom > panelRect.bottom,
      panelOverflowY: getComputedStyle(panel).overflowY
    }
  })
  expect(popupLayout).toEqual({
    extendsBeyondPanel: true,
    panelOverflowY: 'visible'
  })

  const mount = comments.locator('[data-comment-mount]')
  await mount.evaluate((element) => {
    const fixture = document.createElement('div')
    fixture.dataset.avatarFixture = ''
    fixture.className = 'wl-card-item'
    fixture.innerHTML = `
      <div class="wl-user"><img class="wl-user-avatar" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" alt="avatar"></div>
      <div class="wl-card"><span class="wl-nick">匿名猫</span></div>`
    element.append(fixture)
  })
  const avatarUser = mount.locator('[data-avatar-fixture] .wl-user')
  const avatarImage = avatarUser.locator('img')
  await expect(avatarUser).toHaveAttribute('data-avatar-initial', '匿')
  await avatarImage.evaluate((image) => image.setAttribute('src', '/comments/emoji/tw-emoji/1f603.png'))
  await expect(avatarUser).not.toHaveAttribute('data-avatar-initial')
  await expect(avatarImage).not.toHaveAttribute('hidden')
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
