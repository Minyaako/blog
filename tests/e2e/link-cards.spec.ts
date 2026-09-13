import { expect, test } from './fixtures'

const cards = [
  {
    provider: 'github',
    platform: 'GitHub',
    url: 'https://github.com/astro-build/astro',
    title: 'Astro：内容驱动网站构建工具',
    author: 'Astro Team',
    stats: [
      { label: 'Stars 48,000', value: '48,000' },
      { label: 'Forks 3,900', value: '3,900' }
    ]
  },
  {
    provider: 'youtube',
    platform: 'YouTube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: '示例视频：Web 性能优化入门',
    author: '性能实验室',
    stats: [
      { label: '播放 1,200,000', value: '1,200,000' },
      { label: '点赞 42,000', value: '42,000' }
    ]
  },
  {
    provider: 'bilibili',
    platform: '哔哩哔哩',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
    title: '示例视频：从零认识 Astro',
    author: '前端实验室',
    stats: [
      { label: '播放 860,000', value: '860,000' },
      { label: '点赞 31,000', value: '31,000' }
    ]
  },
  {
    provider: 'zhihu',
    platform: '知乎',
    url: 'https://zhuanlan.zhihu.com/p/123456',
    title: '手动补充的知乎文章',
    author: '自定义作者',
    stats: [] as readonly { label: string; value: string }[]
  }
] as const

test('article renders supported link cards from deterministic metadata without embeds or card fetches', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/posts/astro-content-architecture/')

  const renderedCards = page.locator('[data-link-card]')
  await expect(renderedCards).toHaveCount(cards.length)

  for (const expected of cards) {
    const card = page.locator(`[data-link-card="${expected.provider}"]`)
    await expect(card).toHaveAttribute('href', expected.url)
    await expect(card).toHaveAttribute('target', '_blank')
    await expect(card).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(card).toHaveAttribute('aria-label', new RegExp(`${expected.title}.*新窗口打开`))
    await expect(card.locator('.link-card__platform')).toHaveText(expected.platform)
    await expect(card.locator('.link-card__title')).toHaveText(expected.title)
    await expect(card.locator('.link-card__author')).toHaveText(expected.author)
    expect(await card.locator('.link-card__stat').evaluateAll((elements) => elements.map((element) => ({
      text: element.textContent,
      ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      hiddenIcons: element.querySelectorAll('svg[aria-hidden="true"]').length
    })))).toEqual(expected.stats.map(({ label, value }) => ({
      text: value,
      ariaLabel: label,
      title: label,
      hiddenIcons: 1
    })))
  }

  const github = page.locator('[data-link-card="github"]')
  await expect(github).toHaveAttribute('data-has-cover', 'false')
  await expect(github.locator('.link-card__brand')).toHaveCount(1)
  await expect(github.locator('svg[data-link-card-icon="github"]')).toHaveCount(1)
  await expect(github.locator('img')).toHaveCount(0)
  for (const card of cards) {
    await expect(page.locator(`[data-link-card="${card.provider}"] .link-card__brand svg`)).toHaveAttribute('data-link-card-icon', card.provider)
  }
  const custom = page.locator('[data-link-card="zhihu"]')
  await expect(custom.locator('img')).toHaveAttribute('src', '/images/posts/life-cover.svg')
  await expect(custom.locator('.link-card__description')).toHaveText('即使平台限制抓取，也可以在正文里补充卡片资料。')
  await expect(page.locator('.prose')).not.toContainText('[title=')

  const image = page.locator('[data-link-card="youtube"] .link-card__media img')
  await expect(image).toHaveAttribute('src', '/images/posts/engineering-cover.svg')
  await expect(image).toHaveAttribute('loading', 'lazy')
  await expect(image).toHaveAttribute('decoding', 'async')
  await expect(page.locator('[data-link-card] iframe')).toHaveCount(0)
  expect(requests.filter((url) => /(?:github\.com|youtube\.com|youtu\.be|bilibili\.com|zhihu\.com)/u.test(url))).toEqual([])

  const firstCard = renderedCards.first()
  await firstCard.focus()
  await expect(firstCard).toBeFocused()
  await expect(firstCard).toHaveAttribute('aria-label', /新窗口打开/)
  await expect(page.getByRole('link', { name: 'Astro 源码仓库', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/astro-build/astro'
  )
  await expect(page.getByText('https://example.com/not-a-supported-card', { exact: true })).toBeVisible()
})

test('link cards stay within the article viewport on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/posts/astro-content-architecture/')

  const layout = await page.locator('[data-link-card]').evaluateAll((elements) => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    cards: elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return { left: bounds.left, right: bounds.right }
    })
  }))

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport)
  for (const card of layout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(-0.5)
    expect(card.right).toBeLessThanOrEqual(layout.viewport + 0.5)
  }
})
