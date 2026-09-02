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

async function suppressFallbackTimeout(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 420) return 0
      return nativeSetTimeout(handler, timeout, ...args)
    }) as typeof window.setTimeout
  })
}

async function delayFallbackTimeout(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 420) return nativeSetTimeout(handler, 60_000, ...args)
      return nativeSetTimeout(handler, timeout, ...args)
    }) as typeof window.setTimeout
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
    micro: 220, enter: 420, page: 520, stagger: 90,
    ease: [0.2, 0.8, 0.2, 1], scope: 'page-content',
  })
})

test('fallback navigation gives domain changes a visible exit and colored arrival', async ({ page }) => {
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  const root = page.locator('html')
  const main = page.locator('.page-main')
  await expect(root).toHaveAttribute('data-motion-navigation', 'fallback')
  await expect(main).toHaveCSS('animation-name', 'motion-fallback-page-in')

  const navigation = page.waitForURL(/\/domains\/academic\/?$/)
  const departure = await page.evaluate(() => new Promise<{
    pageState: string | undefined
    targetDomain: string | undefined
    pageAnimation: string
  }>((resolve) => {
    document.addEventListener('click', () => {
      const root = document.documentElement
      resolve({
        pageState: root.dataset.motionPageState,
        targetDomain: root.dataset.motionTargetDomain,
        pageAnimation: getComputedStyle(document.querySelector('.page-main')!).animationName,
      })
    }, { once: true })

    document.querySelector<HTMLElement>('.domain-card[data-domain="academic"]')!.click()
  }))
  expect(departure).toEqual({
    pageState: 'exiting',
    targetDomain: 'academic',
    pageAnimation: 'motion-fallback-page-out',
  })
  await navigation

  await expect(page.locator('html')).toHaveAttribute('data-motion-domain', 'academic')
  await expect(page.locator('.page-main')).toHaveCSS('animation-name', 'motion-fallback-page-in')
  await expect.poll(() => page.locator('body').evaluate((body) => getComputedStyle(body, '::before').animationName))
    .toBe('motion-domain-arrive')
})

test('fallback handoff keeps page content visible on both sides of navigation', async ({ page }) => {
  await delayFallbackTimeout(page)
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  const main = page.locator('.page-main')
  const entryOpacity = await main.evaluate((element) => {
    const animation = element.getAnimations().find((candidate) => (
      candidate instanceof CSSAnimation && candidate.animationName === 'motion-fallback-page-in'
    ))
    const firstFrame = (animation?.effect as KeyframeEffect | null)?.getKeyframes()[0]
    return Number(firstFrame?.opacity)
  })

  const exitOpacity = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.domain-card[data-domain="academic"]')!.click()
    const main = document.querySelector<HTMLElement>('.page-main')!
    const animation = main.getAnimations().find((candidate) => (
      candidate instanceof CSSAnimation && candidate.animationName === 'motion-fallback-page-out'
    ))
    animation?.pause()
    const frames = (animation?.effect as KeyframeEffect | null)?.getKeyframes() ?? []
    return Number(frames.at(-1)?.opacity)
  })

  expect(entryOpacity).toBeGreaterThanOrEqual(0.55)
  expect(exitOpacity).toBeGreaterThanOrEqual(0.55)
})

test('persisted pageshow clears fallback motion state and restores an interactive page', async ({ page }) => {
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  await page.evaluate(() => {
    const root = document.documentElement
    root.dataset.motionPageState = 'exiting'
    root.dataset.motionTargetDomain = 'academic'
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })

  const root = page.locator('html')
  const main = page.locator('.page-main')
  expect(await root.evaluate((element) => element.getAttribute('data-motion-page-state'))).toBeNull()
  expect(await root.evaluate((element) => element.getAttribute('data-motion-target-domain'))).toBeNull()
  await expect(main).toBeVisible()
  await expect(main).toHaveCSS('opacity', '1')
  await expect(main).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await expect(main).toHaveCSS('pointer-events', 'auto')
  await page.locator('.domain-card[data-domain="academic"]').click({ trial: true })
})

test('runtime reduced motion keeps a loaded fallback page instantaneous', async ({ page }) => {
  await disableDocumentViewTransitions(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-motion-navigation', 'fallback')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches
  )).toBe(true)

  const outcome = await page.evaluate(() => new Promise<{
    defaultPrevented: boolean
    mode: string | undefined
    pageState: string | undefined
    targetDomain: string | undefined
    pageAnimation: string
    veilAnimation: string
  }>((resolve) => {
    const link = document.createElement('a')
    link.href = '/archives/'
    link.textContent = 'Runtime reduced-motion navigation'
    document.body.append(link)

    document.addEventListener('click', (event) => {
      const root = document.documentElement
      const result = {
        defaultPrevented: event.defaultPrevented,
        mode: root.dataset.motionNavigation,
        pageState: root.dataset.motionPageState,
        targetDomain: root.dataset.motionTargetDomain,
        pageAnimation: getComputedStyle(document.querySelector('.page-main')!).animationName,
        veilAnimation: getComputedStyle(document.body, '::before').animationName,
      }
      event.preventDefault()
      link.remove()
      resolve(result)
    }, { once: true })

    link.click()
  }))

  expect(outcome).toEqual({
    defaultPrevented: false,
    mode: 'instant',
    pageState: undefined,
    targetDomain: undefined,
    pageAnimation: 'none',
    veilAnimation: 'none',
  })
})

test('enabling reduced motion during fallback exit completes navigation immediately', async ({ page }) => {
  await suppressFallbackTimeout(page)
  await disableDocumentViewTransitions(page)
  await page.goto('/')
  await page.addStyleTag({ content: `
    html[data-motion-navigation='fallback'][data-motion-page-state='exiting'] .page-main {
      animation-duration: 60s !important;
    }
  ` })

  const root = page.locator('html')
  const navigationRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/archives/'
  ), { timeout: 5_000 })
  const navigation = page.waitForURL(/\/archives\/?$/)
  await page.locator('a[href="/archives/"]').first().click({ noWaitAfter: true })
  await expect(root).toHaveAttribute('data-motion-page-state', 'exiting')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await Promise.all([navigationRequest, navigation])
})

test('fallback departure keeps the first target during repeated activation', async ({ page }) => {
  await suppressFallbackTimeout(page)
  await disableDocumentViewTransitions(page)
  await page.goto('/')
  await page.addStyleTag({ content: `
    html[data-motion-navigation='fallback'][data-motion-page-state='exiting'] .page-main {
      animation-duration: 60s !important;
    }
  ` })

  const state = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.domain-card[data-domain="academic"]')!.click()
    document.querySelector<HTMLElement>('.domain-card[data-domain="games"]')!.click()
    const root = document.documentElement
    return {
      pageState: root.dataset.motionPageState,
      targetDomain: root.dataset.motionTargetDomain,
    }
  })

  expect(state).toEqual({ pageState: 'exiting', targetDomain: 'academic' })
})

test('native domain arrival uses the current domain color', async ({ page }) => {
  await page.goto('/domains/academic/')
  await expect(page.locator('html')).toHaveAttribute('data-motion-navigation', 'native')

  const academicArrival = await page.locator('body').evaluate((body) => {
    const styles = getComputedStyle(body, '::before')
    return { animation: styles.animationName, background: styles.backgroundColor }
  })
  expect(academicArrival).toEqual({
    animation: 'motion-domain-arrive',
    background: 'rgb(67, 107, 91)',
  })
})

test('native domain clicks mark colored departure without interception', async ({ page }) => {
  await page.goto('/domains/academic/')
  await expect(page.locator('html')).toHaveAttribute('data-motion-navigation', 'native')

  const departure = await page.evaluate(() => new Promise<{
    defaultPrevented: boolean
    pageState: string | undefined
    targetDomain: string | undefined
    pageAnimation: string
    pagePointerEvents: string
    veilAnimation: string
    veilBackground: string
    veilTransformOriginX: number
    viewportWidth: number
  }>((resolve) => {
    const link = document.createElement('a')
    link.href = '/domains/games/'
    link.dataset.domain = 'games'
    link.textContent = 'Games domain'
    document.body.append(link)

    document.addEventListener('click', (event) => {
      const root = document.documentElement
      const pageStyles = getComputedStyle(document.querySelector('.page-main')!)
      const veilStyles = getComputedStyle(document.body, '::before')
      const result = {
        defaultPrevented: event.defaultPrevented,
        pageState: root.dataset.motionPageState,
        targetDomain: root.dataset.motionTargetDomain,
        pageAnimation: pageStyles.animationName,
        pagePointerEvents: pageStyles.pointerEvents,
        veilAnimation: veilStyles.animationName,
        veilBackground: veilStyles.backgroundColor,
        veilTransformOriginX: Number.parseFloat(veilStyles.transformOrigin),
        viewportWidth: window.innerWidth,
      }
      event.preventDefault()
      root.removeAttribute('data-motion-page-state')
      root.removeAttribute('data-motion-target-domain')
      link.remove()
      resolve(result)
    }, { once: true })

    link.click()
  }))

  expect(departure).toMatchObject({
    defaultPrevented: false,
    pageState: 'exiting',
    targetDomain: 'games',
    pageAnimation: 'none',
    pagePointerEvents: 'auto',
    veilAnimation: 'motion-domain-depart',
    veilBackground: 'rgb(151, 80, 95)',
  })
  expect(departure.veilTransformOriginX).toBe(departure.viewportWidth)

  await page.goto('/')
  const navigation = page.waitForURL(/\/domains\/games\/?$/)
  await page.locator('.domain-card[data-domain="games"]').click({ noWaitAfter: true })
  await navigation
  await expect(page.locator('html')).toHaveAttribute('data-motion-domain', 'games')
  await expect.poll(() => page.locator('body').evaluate(
    (body) => getComputedStyle(body, '::before').animationName
  )).toBe('motion-domain-arrive')
})

test('reduced motion keeps fallback navigation instantaneous', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await disableDocumentViewTransitions(page)
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-motion-navigation', 'instant')
  await expect(page.locator('.page-main')).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.locator('body').evaluate(
    (body) => getComputedStyle(body, '::before').animationName
  )).toBe('none')
})

test('homepage reveals the A2 modules once in order', async ({ page }) => {
  await page.goto('/')
  const modules = page.locator('[data-motion-reveal]')
  const moduleCount = await modules.count()
  expect(moduleCount).toBeGreaterThan(0)

  for (let index = 0; index < moduleCount; index += 1) {
    const module = modules.nth(index)
    await module.scrollIntoViewIfNeeded()
    await expect(module).toHaveAttribute('data-motion-state', 'visible')
    await expect(module).toHaveAttribute('data-motion-initialized', 'true')
    await expect(module).toHaveCSS('--motion-order', String(index))
  }
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

test('archive cards reveal once and expose stable motion order', async ({ page }) => {
  await page.goto('/archives/')
  const card = page.locator('[data-post-card]').last()
  await card.scrollIntoViewIfNeeded()
  await expect(card).toHaveAttribute('data-motion-state', 'visible')
  await expect(card).toHaveAttribute('data-motion-initialized', 'true')
  await expect(card).toHaveCSS('--motion-order', '0')
})

test('reduced motion keeps A2 content visible', async ({ page }) => {
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
