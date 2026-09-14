import { expect, test } from '@playwright/test'

const snapshot = {
  generatedAt: '2026-09-14T08:00:00.000Z',
  failed: 0,
  articles: [
    { title: '朋友的新文章', url: 'https://axi404.top/blog/recent-story', friend: "Axi's Blog", date: '2026-09-14T00:00:00.000Z' },
    { title: '一篇稍早的记录', url: 'https://axi404.top/blog/earlier-story', friend: "Axi's Blog", date: '2026-09-13T00:00:00.000Z' }
  ]
}

const friendInfo = [
  '名称：Minyako的幻想乡',
  '简介：真希望能悠闲度日',
  '地址：https://gsk.minyako.top',
  '头像：https://gsk.minyako.top/favicon.svg'
].join('\n')

test.beforeEach(async ({ page }) => {
  // The real feed is fetched at build time. Browser tests use a same-origin
  // snapshot and a tiny avatar fixture, with no requests to the friend's site.
  await page.route('https://axi404.top/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><circle cx="26" cy="26" r="26" fill="#d49aaf"/></svg>'
  }))
  await page.route('**/friends/feeds.json', route => route.fulfill({ json: snapshot }))
})

test('friends and snapshot articles survive client navigation without duplicate entries', async ({ page }) => {
  const crossOriginFeedRequests: string[] = []
  page.on('request', request => {
    if (request.url().startsWith('https://axi404.top/') && ['fetch', 'xhr'].includes(request.resourceType())) {
      crossOriginFeedRequests.push(request.url())
    }
  })
  await page.goto('/friends/')
  const friend = page.locator('.friend-card', { hasText: "Axi's Blog" })
  await expect(friend).toBeVisible()
  await expect(friend).toHaveAttribute('href', 'https://axi404.top/')
  await expect(friend).toContainText('一只可爱小猫')
  await expect(page.locator('#exchange')).toContainText('Minyako的幻想乡')
  await expect(page.locator('#exchange')).toContainText('真希望能悠闲度日')
  await expect(page.locator('[data-feed-list] > li')).toHaveCount(2)
  await expect(page.locator('[data-feed-list] a')).toHaveText(snapshot.articles.map(article => article.title))
  await expect(page.locator('[data-feed-list] a').first()).toHaveAttribute('href', snapshot.articles[0]!.url)
  await expect(page.locator('[data-feed-status]')).toContainText('最近 2 篇文章')
  await expect(page.locator('[data-feed-status]')).toContainText('更新于')

  await page.evaluate(() => {
    (window as Window & { __friendsNavigationToken?: string }).__friendsNavigationToken = 'same-document'
  })
  for (let visit = 0; visit < 2; visit += 1) {
    await page.getByRole('link', { name: 'Minyako 首页', exact: true }).click()
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/)
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '朋友们', exact: true }).click()
    await expect(page).toHaveURL(/\/friends\/$/)
    await expect(page.locator('[data-feed-list] > li')).toHaveCount(2)
    await expect(page.locator('[data-feed-list] a')).toHaveText(snapshot.articles.map(article => article.title))
  }
  expect(await page.evaluate(() => (window as Window & { __friendsNavigationToken?: string }).__friendsNavigationToken)).toBe('same-document')
  expect(crossOriginFeedRequests).toEqual([])
})

test('an unavailable source keeps its failure visible while other articles remain readable', async ({ page }) => {
  await page.route('**/friends/feeds.json', route => route.fulfill({ json: { ...snapshot, failed: 1 } }))
  await page.goto('/friends/')
  await expect(page.locator('[data-feed-list] > li')).toHaveCount(2)
  await expect(page.locator('[data-feed-status]')).toContainText('1 个订阅源暂时未能读取，下次更新时会再试。')
})

test('a failed snapshot shows a useful fallback and preserves the friend link', async ({ page }) => {
  await page.route('**/friends/feeds.json', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/friends/')
  await expect(page.locator('[data-feed-status]')).toHaveText('朋友圈暂时未能加载，可以先从上方友链去朋友家坐坐。')
  await expect(page.locator('[data-feed-list] > li')).toHaveCount(0)
  await expect(page.locator('.friend-card', { hasText: "Axi's Blog" })).toBeVisible()
})

for (const copyFails of [false, true]) {
  test(`friend information ${copyFails ? 'can be copied manually when clipboard access fails' : 'is copied through the clipboard API'}`, async ({ page }) => {
    await page.addInitScript(({ fails }) => {
      const state = window as Window & { __copiedFriendInfo?: string[] }
      state.__copiedFriendInfo = []
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            state.__copiedFriendInfo!.push(text)
            if (fails) throw new DOMException('Clipboard permission denied', 'NotAllowedError')
          }
        }
      })
    }, { fails: copyFails })
    await page.goto('/friends/')
    await page.getByRole('button', { name: '复制本站友链信息', exact: true }).click()
    const fallback = page.getByRole('textbox', { name: '本站友链信息，可手动复制' })
    if (copyFails) {
      await expect(page.locator('[data-copy-status]')).toHaveText('自动复制未能完成，请复制下方选中的信息。')
      await expect(fallback).toBeVisible()
      await expect(fallback).toHaveValue(friendInfo)
      await expect(fallback).toBeFocused()
      await expect(fallback).toHaveAttribute('readonly', '')
      expect(await fallback.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(friendInfo)
    } else {
      await expect(page.locator('[data-copy-status]')).toHaveText('已复制，可以发给朋友啦。')
      await expect(fallback).toBeHidden()
    }
    expect(await page.evaluate(() => (window as Window & { __copiedFriendInfo?: string[] }).__copiedFriendInfo)).toEqual([friendInfo])
  })
}
