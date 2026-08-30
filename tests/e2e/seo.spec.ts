import { expect, test } from '@playwright/test'

const productionOrigin = 'https://gsk.minyako.top'

test('publishes a direct sitemap containing only final indexable URLs', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('xml')

  const xml = await response.text()
  const locations = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])

  expect(locations.length).toBeGreaterThan(10)
  expect(locations.some((location) => location.startsWith(`${productionOrigin}/posts/`))).toBe(true)
  expect(locations).toContain(`${productionOrigin}/domains/engineering/devlogs/`)
  expect(locations).not.toContain(`${productionOrigin}/search/`)
  expect(locations).not.toContain(`${productionOrigin}/domains/engineering/tools/`)
  expect(locations).not.toContain(`${productionOrigin}/tags/hide-cover/`)
  expect(locations.every((location) => new URL(location).pathname.endsWith('/'))).toBe(true)
})

test('advertises the direct sitemap in robots.txt', async ({ request }) => {
  const response = await request.get('/robots.txt')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/plain')
  expect(await response.text()).toBe(
    `User-agent: *\nAllow: /\nSitemap: ${productionOrigin}/sitemap.xml\n`,
  )
})

test('uses final canonical URLs and noindexes non-content listings', async ({ page, request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text()
  const articleUrl = [...sitemap.matchAll(/<loc>(https:\/\/gsk\.minyako\.top\/posts\/.*?\/)<\/loc>/g)][0]?.[1]
  expect(articleUrl).toBeDefined()

  await page.goto(new URL(articleUrl!).pathname)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    articleUrl!,
  )
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)

  await page.goto('/domains/engineering/tools/')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, noarchive')

  await page.goto('/tags/hide-cover/')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, noarchive')

  await page.goto('/search/')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, noarchive')
})

test('links internally to final document URLs without redirects', async ({ page, request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text()
  const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])
  const nonCanonicalLinks = new Set<string>()

  for (const location of locations) {
    const response = await page.goto(new URL(location).pathname)
    expect(response?.status(), location).toBe(200)
    expect(new URL(response!.url()).pathname, location).toBe(new URL(location).pathname)
    await expect(page.locator('link[rel="canonical"]'), location).toHaveAttribute('href', location)
    await expect(page.locator('meta[name="robots"][content*="noindex"]'), location).toHaveCount(0)
    for (const href of await page.locator('a[href^="/"]').evaluateAll((anchors) => (
      anchors.map((anchor) => anchor.getAttribute('href') ?? '')
    ))) {
      const path = href.split('#')[0].split('?')[0]
      const lastSegment = path.split('/').filter(Boolean).at(-1) ?? ''
      if (path !== '/' && !path.endsWith('/') && !lastSegment.includes('.')) {
        nonCanonicalLinks.add(path)
      }
    }
  }

  expect([...nonCanonicalLinks].sort()).toEqual([])
})
