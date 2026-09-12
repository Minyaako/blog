import { expect, test } from '@playwright/test'

test.use({ launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] } })

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

async function disableDocumentViewTransitions(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Document.prototype, 'startViewTransition')
  })
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
    micro: 220, enter: 0, page: 160, stagger: 0,
    ease: [0.2, 0.8, 0.2, 1], scope: 'page-content',
  })
})

test('native page snapshots crossfade without movement or a color veil', async ({ page }) => {
  await page.goto('/')

  const styles = await page.locator('html').evaluate((root) => {
    const read = (pseudo: string) => {
      const computed = getComputedStyle(root, pseudo)
      return {
        animationName: computed.animationName,
        animationDuration: computed.animationDuration,
        animationTimingFunction: computed.animationTimingFunction,
        mixBlendMode: computed.mixBlendMode,
        opacity: computed.opacity,
        transform: computed.transform,
      }
    }
    return {
      old: read('::view-transition-old(page-content)'),
      next: read('::view-transition-new(page-content)'),
      isolation: getComputedStyle(root, '::view-transition-image-pair(page-content)').isolation,
    }
  })

  expect(styles.old).toMatchObject({
    animationName: 'motion-page-out',
    animationTimingFunction: 'linear',
    mixBlendMode: 'plus-lighter',
    opacity: '1',
    transform: 'none',
  })
  expect(durationInMilliseconds(styles.old.animationDuration)).toBe(160)
  expect(styles.next).toMatchObject({
    animationName: 'motion-page-in',
    animationTimingFunction: 'linear',
    mixBlendMode: 'plus-lighter',
    opacity: '1',
    transform: 'none',
  })
  expect(durationInMilliseconds(styles.next.animationDuration)).toBe(160)
  expect(styles.isolation).toBe('isolate')
})

test('fallback navigation swaps immediately without a page exit or color veil', async ({ page }) => {
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  const root = page.locator('html')
  const main = page.locator('.page-main')
  await expect(root).toHaveAttribute('data-motion-navigation', 'fallback')
  await expect(main).toHaveCSS('animation-name', 'none')

  const navigation = page.waitForURL(/\/domains\/academic\/?$/)
  const departure = await page.evaluate(() => new Promise<{
    pageState: string | undefined
    targetDomain: string | undefined
    pageAnimation: string
    pagePointerEvents: string
  }>((resolve) => {
    document.addEventListener('click', () => {
      const root = document.documentElement
      const pageStyles = getComputedStyle(document.querySelector('.page-main')!)
      resolve({
        pageState: root.dataset.motionPageState,
        targetDomain: root.dataset.motionTargetDomain,
        pageAnimation: pageStyles.animationName,
        pagePointerEvents: pageStyles.pointerEvents,
      })
    }, { once: true })

    document.querySelector<HTMLElement>('.domain-card[data-domain="academic"]')!.click()
  }))
  expect(departure).toEqual({
    pageState: undefined,
    targetDomain: undefined,
    pageAnimation: 'none',
    pagePointerEvents: 'auto',
  })
  await navigation

  await expect(page.locator('html')).toHaveAttribute('data-motion-domain', 'academic')
  await expect(page.locator('.page-main')).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.locator('body').evaluate((body) => ({
    animation: getComputedStyle(body, '::before').animationName,
    content: getComputedStyle(body, '::before').content,
  }))).toEqual({ animation: 'none', content: 'none' })
})

test('slow fallback navigation keeps the old page visible and interactive', async ({ page }) => {
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  let releaseRequest!: () => void
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve })
  await page.route('**/domains/academic/**', async (route) => {
    await requestGate
    await route.continue()
  })

  const main = page.locator('.page-main')
  const request = page.waitForRequest((candidate) => (
    new URL(candidate.url()).pathname === '/domains/academic/'
  ))
  const navigation = page.waitForURL(/\/domains\/academic\/?$/)
  await page.locator('.domain-card[data-domain="academic"]').click({ noWaitAfter: true })
  await request

  await expect(main).toBeVisible()
  await expect(main).toHaveCSS('opacity', '1')
  await expect(main).toHaveCSS('pointer-events', 'auto')

  const themeToggle = page.getByRole('button', { name: '切换主题' })
  await themeToggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  releaseRequest()
  await navigation
  await expect(page.locator('.domain-page')).toBeVisible()
})

test('fallback back navigation restores a page that remains interactive', async ({ page }) => {
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  const forward = page.waitForURL(/\/domains\/academic\/?$/)
  await page.locator('.domain-card[data-domain="academic"]').click({ noWaitAfter: true })
  await forward
  await expect(page.getByRole('heading', { name: '学术' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.domain-card[data-domain="academic"]')).toBeVisible()
  await page.getByRole('button', { name: '切换主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('reduced-motion navigation stays instantaneous without fallback state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await disableDocumentViewTransitions(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-motion-navigation', 'instant')
  await expect(page.locator('.page-main')).toHaveCSS('animation-name', 'none')
  const navigation = page.waitForURL(/\/archives\/?$/)
  await page.getByRole('link', { name: '归档', exact: true }).click({ noWaitAfter: true })
  await navigation

  await expect(page.locator('html')).toHaveAttribute('data-motion-navigation', 'instant')
  await expect(page.locator('.page-main')).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.locator('body').evaluate((body) => ({
    animation: getComputedStyle(body, '::before').animationName,
    content: getComputedStyle(body, '::before').content,
  }))).toEqual({ animation: 'none', content: 'none' })
})

test('homepage modules are readable before scrolling and keep stable motion metadata', async ({ page }) => {
  await page.goto('/')
  const modules = page.locator('[data-motion-reveal]')
  const moduleCount = await modules.count()
  expect(moduleCount).toBeGreaterThan(0)

  const motionState = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    states: Array.from(document.querySelectorAll<HTMLElement>('[data-motion-reveal]')).map((element) => {
      const styles = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return {
        state: element.getAttribute('data-motion-state'),
        initialized: element.getAttribute('data-motion-initialized'),
        opacity: styles.opacity,
        transform: styles.transform,
        order: styles.getPropertyValue('--motion-order').trim(),
        top: bounds.top,
      }
    }),
  }))
  const states = motionState.states

  expect(states.some(({ top }) => top > motionState.viewportHeight)).toBe(true)
  expect(states.every(({ state, initialized, opacity, transform }) => (
    state === 'visible' && initialized === 'true' && opacity === '1' && transform === 'none'
  ))).toBe(true)
  expect(states.map(({ order }) => order)).toEqual(states.map((_, index) => String(index)))
})

test('article motion is limited to the header', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture/')
  const header = page.locator('.article-header[data-motion-reveal]')
  await expect(header).toHaveAttribute('data-motion-state', 'visible')
  await expect(page.locator('.prose[data-motion-reveal]')).toHaveCount(0)
})

test('table of contents tracks the current article section', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture/')
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

test('toc link activation keeps the native hash target current', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/posts/astro-content-architecture/')
  const toc = page.locator('[data-toc]')
  const marker = toc.locator('[data-toc-marker]')
  const target = toc.locator('[data-toc-link]').nth(1)
  await target.scrollIntoViewIfNeeded()
  const targetHref = await target.getAttribute('href')
  expect(targetHref).toMatch(/^#.+/)
  const targetMarkerY = await target.evaluate((link) => `${(link as HTMLElement).offsetTop}px`)

  await target.click()

  await expect.poll(() => decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(decodeURIComponent(targetHref!.slice(1)))
  await expect(target).toHaveAttribute('aria-current', 'location')
  await expect(toc.locator('[data-toc-link][aria-current="location"]')).toHaveCount(1)
  await expect(marker).toBeVisible()
  await expect(toc).toHaveCSS('--toc-marker-y', targetMarkerY)
})

test('table of contents honors a direct section link on initialization', async ({ page }) => {
  await page.goto('/posts/astro-content-architecture/')
  const targetHref = await page.locator('[data-toc-link]').nth(1).getAttribute('href')
  expect(targetHref).toMatch(/^#.+/)

  await page.goto(`/posts/astro-content-architecture/${targetHref}`)
  await expect(page.locator('[data-toc-link]').nth(1)).toHaveAttribute('aria-current', 'location')
})

test('archive cards are visible before scrolling and expose stable motion order', async ({ page }) => {
  await page.goto('/archives/')
  const card = page.locator('[data-post-card]').last()
  await expect(card).toHaveAttribute('data-motion-state', 'visible')
  await expect(card).toHaveAttribute('data-motion-initialized', 'true')
  await expect(card).toHaveCSS('opacity', '1')
  await expect(card).toHaveCSS('transform', 'none')
  await expect(card).toHaveCSS('--motion-order', '0')
})

test('reduced motion keeps reveal content visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const modules = page.locator('[data-motion-reveal]')
  expect(await modules.count()).toBeGreaterThan(0)
  await expect(page.locator('[data-motion-reveal]:not([data-motion-state="visible"])')).toHaveCount(0)
})

test('reduced motion removes the toc marker transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/posts/astro-content-architecture/')
  await expect(page.locator('[data-toc-marker]')).toHaveCSS('transition-property', 'none')
})

test('theme icon states crossfade without changing button geometry', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: '切换主题' })
  await button.hover()
  await expect(button).toHaveCSS('translate', '0px -2px')
  const before = await button.boundingBox()

  await button.click()

  await expect(page.locator('[data-theme-icon="dark"]')).toHaveAttribute('data-active', 'true')
  await expect(page.locator('[data-theme-icon="light"]')).toHaveAttribute('data-active', 'false')
  expect(await button.boundingBox()).toEqual(before)
})

test('dark theme is inherited at swap time and the new page keeps theme controls interactive', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '切换主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const themeSamples = page.evaluate(() => new Promise<Array<{
    phase: 'before-swap' | 'page-load'
    current: string | undefined
    incoming?: string | undefined
  }>>((resolve) => {
    const samples: Array<{
      phase: 'before-swap' | 'page-load'
      current: string | undefined
      incoming?: string | undefined
    }> = []
    document.addEventListener('astro:before-swap', (event) => {
      const incoming = (event as Event & { newDocument?: Document }).newDocument?.documentElement
      samples.push({
        phase: 'before-swap',
        current: document.documentElement.dataset.theme,
        incoming: incoming?.dataset.theme,
      })
    }, { once: true })
    document.addEventListener('astro:page-load', () => {
      samples.push({ phase: 'page-load', current: document.documentElement.dataset.theme })
      resolve(samples)
    }, { once: true })
  }))

  const navigation = page.waitForURL(/\/domains\/academic\/?$/)
  await page.locator('.domain-card[data-domain="academic"]').click({ noWaitAfter: true })
  await navigation
  const samples = await themeSamples

  expect(samples).toEqual(expect.arrayContaining([
    { phase: 'before-swap', current: 'dark', incoming: 'dark' },
    { phase: 'page-load', current: 'dark' },
  ]))

  const toggle = page.getByRole('button', { name: '切换主题' })
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('[data-theme-icon="dark"]')).toHaveAttribute('data-active', 'false')
  await expect(page.locator('[data-theme-icon="light"]')).toHaveAttribute('data-active', 'true')
})
