import { expect, test } from '@playwright/test'

test('homepage presents identity, four domains, and recent writing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('img', { name: '首页横幅：伏案小憩的少女' })).toBeVisible()
  await expect(page.getByText('@minyako')).toBeVisible()

  for (const label of ['学术', '技术', '生活', '游戏']) {
    await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }

  await expect(page.getByRole('heading', { name: '最新长文' })).toBeVisible()
})

test('homepage crossfades to the second image after one minute', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-12T00:00:00+08:00') })
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
  await page.clock.install({ time: new Date('2026-07-12T00:00:00+08:00') })
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
