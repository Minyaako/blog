import { expect, test } from '@playwright/test'

function durationInMilliseconds(value: string) {
  const match = /^([+-]?(?:\d+|\d*\.\d+))(ms|s)$/.exec(value)
  if (!match) throw new Error(`Expected a duration, received ${value}`)

  return Number.parseFloat(match[1]) * (match[2] === 's' ? 1_000 : 1)
}

function cubicBezierValues(value: string) {
  const match = /^cubic-bezier\((.+)\)$/.exec(value)
  if (!match) throw new Error(`Expected cubic-bezier timing, received ${value}`)

  return match[1].split(',').map((parameter) => Number.parseFloat(parameter.trim()))
}

test('motion foundation exposes computed timing semantics and page scope', async ({ page }) => {
  await page.goto('/')
  const values = await page.locator('html').evaluate((root) => {
    const styles = getComputedStyle(root)
    return {
      micro: styles.getPropertyValue('--duration-micro').trim(),
      enter: styles.getPropertyValue('--duration-enter').trim(),
      page: styles.getPropertyValue('--duration-page').trim(),
      stagger: styles.getPropertyValue('--stagger-step').trim(),
      ease: styles.getPropertyValue('--ease-standard').trim(),
      scope: getComputedStyle(document.querySelector('.page-main')!).viewTransitionName,
    }
  })

  expect({
    micro: durationInMilliseconds(values.micro),
    enter: durationInMilliseconds(values.enter),
    page: durationInMilliseconds(values.page),
    stagger: durationInMilliseconds(values.stagger),
    ease: cubicBezierValues(values.ease),
    scope: values.scope,
  }).toEqual({
    micro: 200, enter: 260, page: 320, stagger: 55,
    ease: [0.2, 0.8, 0.2, 1], scope: 'page-content',
  })
})

test('homepage reveals the A2 modules once in order', async ({ page }) => {
  await page.goto('/')
  const modules = page.locator('[data-motion-reveal]')
  await expect(modules).toHaveCount(3)

  for (let index = 0; index < 3; index += 1) {
    const module = modules.nth(index)
    await module.scrollIntoViewIfNeeded()
    await expect(module).toHaveAttribute('data-motion-state', 'visible')
    await expect(module).toHaveAttribute('data-motion-initialized', 'true')
    await expect(module).toHaveCSS('--motion-order', String(index))
  }
})

test('article motion is limited to the header', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  const header = page.locator('.article-header[data-motion-reveal]')
  await expect(header).toHaveAttribute('data-motion-state', 'visible')
  await expect(page.locator('.prose[data-motion-reveal]')).toHaveCount(0)
})

test('table of contents tracks the current article section', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture')
  const headings = page.locator('.prose h2[id]')
  expect(await headings.count()).toBeGreaterThan(1)

  const marker = page.locator('[data-toc-marker]')
  const initialMarkerPosition = await marker.evaluate((element) => getComputedStyle(element).transform)

  const secondHeading = headings.nth(1)
  await secondHeading.evaluate((heading) => {
    window.scrollTo({ top: (heading as HTMLElement).offsetTop - window.innerHeight * 0.2 })
  })
  const id = await secondHeading.getAttribute('id')
  await expect(page.locator(`[data-toc-link][href="#${id}"]`)).toHaveAttribute('aria-current', 'location')
  await expect(marker).toBeVisible()
  await expect.poll(() => marker.evaluate((element) => getComputedStyle(element).transform)).not.toBe(initialMarkerPosition)
})

test('table of contents honors a direct section link on initialization', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture#%E4%B8%80%E4%B8%AA%E5%85%AC%E5%BC%8F')
  await expect(page.locator('[data-toc-link][href="#一个公式"]')).toHaveAttribute('aria-current', 'location')
})

test('archive cards reveal once and expose stable motion order', async ({ page }) => {
  await page.goto('/archives')
  const card = page.locator('[data-post-card]').last()
  await card.scrollIntoViewIfNeeded()
  await expect(card).toHaveAttribute('data-motion-state', 'visible')
  await expect(card).toHaveAttribute('data-motion-initialized', 'true')
  await expect(card).toHaveCSS('--motion-order', '3')
})

test('reduced motion keeps A2 content visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('[data-motion-reveal][data-motion-state="visible"]')).toHaveCount(3)
})

test('reduced motion removes the toc marker transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/posts/astro-content-architecture')
  await expect(page.locator('[data-toc-marker]')).toHaveCSS('transition-property', 'none')
})
