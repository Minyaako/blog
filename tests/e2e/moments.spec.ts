import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

const injectIntoMomentItems = (html: string, fragment: string) => html.replace(
  /(<div[^>]*data-moment-page-items[^>]*>)/,
  `$1${fragment}`
)

const injectedWarningMomentId = '20260823-143502-bbbbbbbb'

test('production moments are collection-backed and rankings stay static', () => {
  expect(existsSync('src/lib/moment-fixtures.ts')).toBe(false)
  expect(readFileSync('src/content.config.ts', 'utf8')).not.toMatch(/rankings\s*=/)
  expect(readFileSync('src/lib/ranking-fixtures.ts', 'utf8')).toContain('export const rankings')
})

test('fixture-backed moments survive the real Astro build and render on stream, homepage, and matching tag pages', async ({ page }) => {
  await page.goto('/moments')
  await expect(page.locator('[data-moment-card]')).toHaveCount(1)
  await expect(page.getByText('雨停以后，窗外的颜色变得很慢。')).toBeVisible()

  const momentRadius = await page.locator('[data-moment-card]').first()
    .evaluate((node) => getComputedStyle(node).borderRadius)
  expect(Number.parseFloat(momentRadius)).toBeGreaterThan(0)

  await page.goto('/')
  await expect(page.locator('[data-latest-moments]')).toHaveCount(1)
  await expect(page.locator('[data-moment-preview]')).toHaveCount(1)
  await expect(page.getByRole('link', { name: '一则没有标题的动态' })).toBeVisible()

  await page.goto('/tags/life-notes')
  await expect(page.getByRole('region', { name: '相关动态' })).toBeVisible()
  await expect(page.locator('[data-moment-card]')).toHaveCount(1)
  await expect(page.getByText('尚无公开动态使用此标签。')).toHaveCount(0)
})

test('unknown moment ids are not generated', async ({ page }) => {
  const response = await page.goto('/moments/not-present')
  expect(response?.status()).toBe(404)
})

test('content warning progressively enhances a route-injected moment', async ({ page }) => {
  await page.route('**/moments', async (route) => {
    const response = await route.fetch()
    const body = injectIntoMomentItems(await response.text(), `
      <article class="moment-card" data-moment-card data-moment-id="${injectedWarningMomentId}">
        <div class="moment-warning" data-moment-warning>
          <p><strong>内容提示：</strong>需要确认后查看。</p>
          <button type="button" data-warning-accept>显示这条动态</button>
        </div>
        <div data-moment-protected-content><p>注入的受保护正文</p></div>
      </article>
    `)

    await route.fulfill({ response, body })
  })

  await page.goto('/moments')

  const card = page.locator(`[data-moment-id="${injectedWarningMomentId}"]`)
  const protectedContent = card.locator('[data-moment-protected-content]')
  await expect(card.locator('[data-moment-warning]')).toBeVisible()
  await expect(protectedContent).toBeHidden()
  await card.getByRole('button', { name: '显示这条动态' }).click()
  await expect(protectedContent).toBeVisible()
  await expect(protectedContent).toBeFocused()
  await page.reload()
  await expect(page.locator(`[data-moment-id="${injectedWarningMomentId}"] [data-moment-protected-content]`)).toBeVisible()
})

test('content warning remains readable without JavaScript and exposes no dead action', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  await context.route('**/moments', async (route) => {
    const response = await route.fetch()
    const body = injectIntoMomentItems(await response.text(), `
      <article class="moment-card" data-moment-card data-moment-id="${injectedWarningMomentId}">
        <div class="moment-warning" data-moment-warning>
          <p><strong>内容提示：</strong>需要确认后查看。</p>
          <button type="button" data-warning-accept>显示这条动态</button>
        </div>
        <div data-moment-protected-content><p>注入的受保护正文</p></div>
      </article>
    `)

    await route.fulfill({ response, body })
  })
  const page = await context.newPage()
  await page.goto('/moments')

  const card = page.locator(`[data-moment-id="${injectedWarningMomentId}"]`)
  await expect(card.locator('[data-moment-warning]')).toBeVisible()
  await expect(card.locator('[data-moment-protected-content]')).toBeVisible()
  await expect(card.getByRole('button', { name: '显示这条动态' })).toBeHidden()
  await context.close()
})

test('moment stream appends an intercepted next page once and records restorable history', async ({ page }) => {
  await page.route('**/moments', async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      '</main>',
      '<a data-next-page href="/moments/page/2">加载下一页</a></main>'
    )
    await route.fulfill({ response, body })
  })
  await page.route('**/moments/page/2', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<div data-moment-page-items><h2 data-month-key="2026-07">2026年7月</h2><article data-moment-card data-moment-id="20260731-120000-aaaaaaaa"><p>从下一页追加的动态</p></article></div>'
  }))

  await page.goto('/moments')

  await expect(page.locator('[data-moment-id="20260731-120000-aaaaaaaa"]')).toHaveCount(1)
  await expect(page.locator('[data-next-page]')).toHaveCount(0)
  expect(await page.evaluate(() => history.state?.momentStream?.pages)).toEqual(['/moments/page/2'])
})

test('moment pages honor reduced-motion navigation fallback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/moments')

  expect(await page.evaluate(() => document.documentElement.dataset.motionNavigation)).toBe('instant')
})
