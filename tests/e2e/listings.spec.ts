import { expect, test } from './fixtures'

test('archive cards keep images clipped and show the visual novel cover', async ({ page }) => {
  await page.goto('/archives')

  const firstCard = page.locator('[data-post-card]').first()
  await expect(firstCard.getByRole('heading')).toBeVisible()
  await expect(firstCard.getByRole('link')).toHaveAttribute('href', /\/posts\//)

  const imageRegion = firstCard.locator('[data-card-image]')
  await expect(imageRegion).toBeVisible()
  expect(await imageRegion.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden')

  const gameCard = page.locator('[data-post-card]', { hasText: '视觉小说中的记忆与重访' })
  await expect(gameCard.locator('[data-card-image] img')).toHaveAttribute(
    'src',
    'https://pic.minyako.top/blog/posts/visual-novel-memory/cover-25ca0d1e0bb72d75603f7f42a50cfb48df6d4e9cd6bd055a7891ca40b89e274d.webp'
  )
  await expect(gameCard.locator('[data-card-image] img')).toHaveAttribute('width', '2559')
  await expect(gameCard.locator('[data-card-image] img')).toHaveAttribute('height', '1439')
})

test('all configured domain entrances resolve', async ({ page }) => {
  for (const domain of ['academic', 'engineering', 'life', 'games']) {
    const response = await page.goto(`/domains/${domain}`)
    expect(response?.status()).toBe(200)
  }
})

test('stable tag routes display labels and aliases', async ({ page }) => {
  await page.goto('/tags/visual-novel')
  await expect(page.getByRole('heading', { name: '#视觉小说' })).toBeVisible()
  await expect(page.getByText('别名：VN、Galgame')).toBeVisible()
  await expect(page.getByRole('link', { name: /视觉小说中的记忆与重访/ })).toBeVisible()
})

test('archive and tag pages keep decorative utility icons out of the heading outline', async ({ page }) => {
  for (const path of ['/archives', '/tags']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.locator('[data-page-heading-icon] svg')).toHaveAttribute('aria-hidden', 'true')
  }
})

test('archive filters use stable tag ids and registry labels', async ({ page }) => {
  await page.goto('/archives')
  await page.getByRole('button', { name: '视觉小说' }).click()
  await expect(page.locator('[data-post-card]:not([hidden])')).toHaveCount(1)
  await expect(page.locator('[data-post-card]:not([hidden])')).toContainText('视觉小说中的记忆与重访')
  await expect(page.getByText('筛选结果：1 篇文章')).toBeVisible()
})

test('archive filter updates semantics and survives missing View Transition support', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true })
  })
  await page.goto('/archives')
  const filter = page.getByRole('button', { name: '视觉小说' })
  const before = await filter.evaluate((button) => ({
    indicatorWidth: getComputedStyle(button, '::after').width,
    width: button.getBoundingClientRect().width,
  }))

  await filter.click()

  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-post-card]:not([hidden])')).toHaveCount(1)
  await expect(page.locator('[data-filter-status]')).toContainText('1')
  const after = await filter.evaluate((button) => ({
    indicatorWidth: getComputedStyle(button, '::after').width,
    width: button.getBoundingClientRect().width,
  }))
  expect(before.indicatorWidth).toBe(after.indicatorWidth)
  expect(after.indicatorWidth).not.toBe('auto')
  expect(Math.abs(after.width - before.width)).toBeLessThan(0.25)
})

test('archive reduced motion reveals cards and filters without transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/archives')
  const cards = page.locator('[data-post-card]')
  await expect(cards).toHaveCount(4)
  for (let index = 0; index < 4; index += 1) {
    await expect(cards.nth(index)).toBeVisible()
  }

  const filter = page.getByRole('button', { name: '视觉小说' })
  await expect(filter).toHaveCSS('transition-property', 'none')
  await expect(filter).toHaveCSS('transition-duration', '0s')
  await filter.click()

  expect(await page.evaluate(() => ({
    pressed: document.querySelector<HTMLButtonElement>('[data-tag-id="visual-novel"]')?.ariaPressed,
    status: document.querySelector('[data-filter-status]')?.textContent,
    visible: document.querySelectorAll('[data-post-card]:not([hidden])').length,
  }))).toEqual({
    pressed: 'true',
    status: '筛选结果：1 篇文章',
    visible: 1,
  })
})
