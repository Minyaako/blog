import { expect, test } from './fixtures'

test('site visits accumulate across pages while article reads stay independent', async ({ page, baseURL }) => {
  // Serve the local build under the production origin so the real origin guard
  // runs; all statistics requests are intercepted, never sent to production.
  await page.route('https://gsk.minyako.top/**', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: new URL(url.pathname + url.search, baseURL!).href })
    await route.fulfill({ response })
  })
  const postedKeys: string[] = []
  const counts = new Map<string, number>()
  await page.route('https://comments.minyako.top/api/article**', route => {
    const body = route.request().postDataJSON() as { path: string }
    postedKeys.push(body.path)
    const value = (counts.get(body.path) ?? 0) + 1
    counts.set(body.path, value)
    return route.fulfill({ json: { errno: 0, data: [{ time: value }] } })
  })
  await page.goto('https://gsk.minyako.top/')
  await expect(page.locator('[data-site-views-value]')).toHaveText('1 次')
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '归档', exact: true }).click()
  await expect(page).toHaveURL('https://gsk.minyako.top/archives/')
  await expect.poll(() => postedKeys.length).toBe(2)
  await expect(page.locator('[data-site-views]')).toHaveCount(0)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '关于', exact: true }).click()
  await expect(page.locator('[data-site-views-value]')).toHaveText('3 次')
  await page.evaluate(() => {
    history.replaceState(null, '', '#main-content')
    document.dispatchEvent(new Event('astro:page-load'))
  })
  expect(postedKeys).toEqual(Array(3).fill('__site_pageviews_v1__'))
  await page.goto('https://gsk.minyako.top/posts/astro-content-architecture/')
  await expect(page.locator('[data-article-views-value]')).toHaveText('1 次')
  await expect.poll(() => counts.get('__site_pageviews_v1__')).toBe(4)
  expect(postedKeys.filter(key => key !== '__site_pageviews_v1__')).toEqual(['engineering-astro-content-architecture'])
})
