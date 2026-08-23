import { globSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { expect, test } from './fixtures'

function latestPublishedTitle() {
  const posts = [
    ...globSync('src/content/posts/**/*.md'),
    ...globSync('src/content/posts/**/*.mdx')
  ].map((path) => {
    const source = readFileSync(path, 'utf8')
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    if (!frontmatter) throw new Error(`Missing frontmatter: ${path}`)
    return parse(frontmatter) as { title: string; publishedAt: string; draft?: boolean }
  }).filter((post) => post.draft !== true)

  return posts.sort((left, right) => (
    Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
  ))[0]?.title
}

test('homepage presents identity, four domains, and recent writing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('img', { name: '首页横幅：伏案小憩的少女' })).toBeVisible()
  await expect(page.getByRole('img', { name: '首页横幅：伏案小憩的少女' })).toHaveAttribute(
    'src',
    /^https:\/\/pic\.minyako\.top\/blog\//
  )
  await expect(page.getByRole('img', { name: 'Minyako 头像' })).toHaveAttribute(
    'src',
    /^https:\/\/pic\.minyako\.top\/blog\//
  )
  await expect(page.getByText('@minyako')).toBeVisible()

  for (const label of ['学术', '技术', '生活', '游戏']) {
    await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }

  await expect(page.getByRole('heading', { name: '最新长文' })).toBeVisible()
})

test('homepage leads with the newest published long read', async ({ page }) => {
  await page.goto('/')

  const latest = page.locator('.latest .lead-post h3 a')
  await expect(latest).toHaveText(latestPublishedTitle() ?? '')
})

test('homepage renders one decorative vector icon per domain', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-domain-icon]')).toHaveCount(4)
  for (const domain of ['academic', 'engineering', 'life', 'games']) {
    await expect(page.locator(`[data-domain-icon="${domain}"]`)).toHaveAttribute('aria-hidden', 'true')
  }
})

test('homepage crossfades to the second image after one minute', async ({ page }) => {
  await page.goto('/')

  const slides = page.locator('[data-hero-slide]')
  await expect(slides).toHaveCount(2)
  await expect(slides.nth(0)).toHaveAttribute('data-active', 'true')
  await expect(slides.nth(1)).toHaveAttribute('data-active', 'false')

  await page.clock.fastForward(60_000)

  await expect(slides.nth(0)).toHaveAttribute('data-active', 'false')
  await expect(slides.nth(1)).toHaveAttribute('data-active', 'true')
})

test('homepage keeps the first image when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const slides = page.locator('[data-hero-slide]')
  await expect(slides).toHaveCount(2)
  await page.clock.fastForward(120_000)

  await expect(slides.nth(0)).toHaveAttribute('data-active', 'true')
  await expect(slides.nth(1)).toHaveAttribute('data-active', 'false')
})

test('homepage does not overflow horizontally', async ({ page }) => {
  await page.goto('/')
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
})

test('mobile identity and primary navigation fit the initial viewport', async ({ page }) => {
  await page.goto('/')
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  if (viewportWidth > 500) return

  const geometry = await page.evaluate(() => {
    const navigation = document.querySelector('.primary-nav')
    const lastNavigationItem = document.querySelector('.nav-list li:last-child')?.getBoundingClientRect()
    const id = document.querySelector('.name-row span')?.getBoundingClientRect()
    return {
      navigationScrollWidth: navigation?.scrollWidth ?? Number.POSITIVE_INFINITY,
      navigationClientWidth: navigation?.clientWidth ?? 0,
      lastNavigationItemRight: lastNavigationItem?.right ?? Number.POSITIVE_INFINITY,
      idRight: id?.right ?? Number.POSITIVE_INFINITY,
      viewportRight: document.documentElement.clientWidth
    }
  })

  expect(geometry.navigationScrollWidth).toBeLessThanOrEqual(geometry.navigationClientWidth)
  expect(geometry.lastNavigationItemRight).toBeLessThanOrEqual(geometry.viewportRight)
  expect(geometry.idRight).toBeLessThanOrEqual(geometry.viewportRight)
})
