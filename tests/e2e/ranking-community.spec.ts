import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Fixtures = {
  author: { token: string; walineToken: string }
  admin: { token: string; walineToken: string }
  rankingId: string
  versionId: string
}
const origin = process.env.RANKING_E2E_ORIGIN || 'http://127.0.0.1:4321'
test.use({ baseURL: origin })
const seed = () => JSON.parse(readFileSync(resolve('.ranking-data/test-e2e.fixture.json'), 'utf8')) as Fixtures
async function login(context: BrowserContext, role: 'author' | 'admin') {
  const fixture = seed()[role]
  const site = new URL(origin)
  const secure = site.protocol === 'https:'
  const cookieOptions = { url: site.origin, httpOnly: true, sameSite: 'Lax' as const, secure }
  await context.addCookies([
    { name: secure ? '__Host-ranking_session' : 'ranking_session', value: fixture.token, ...cookieOptions },
    { name: secure ? '__Host-ranking_waline' : 'ranking_waline', value: fixture.walineToken, ...cookieOptions },
  ])
  const profile = role === 'admin'
    ? { objectId: 'test-admin', display_name: '测试管理员', type: 'administrator' }
    : { objectId: 'test-author', display_name: '测试作者', type: 'guest' }
  await context.addInitScript(({ siteOrigin, value }) => {
    if (location.origin !== siteOrigin) return
    try { localStorage.setItem('WALINE_USER', value) } catch { /* storage is optional for server auth */ }
  }, { siteOrigin: site.origin, value: JSON.stringify({ ...profile, token: fixture.walineToken, remember: true }) })
}
async function editorReady(page: Page) { await expect(page.locator('[data-draft-intent]')).toBeVisible() }
const items = (page: Page) => page.locator('[data-ranking-items] [data-item-id]')
const names = (page: Page) => page.locator('[data-item-field=name]')

test('public and historical content are server-readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage(), fixture = seed()
  const response = await page.goto(`${origin}/ranking/${fixture.rankingId}/?version=${fixture.versionId}`)
  expect(response?.status()).toBe(200)
  expect(response?.headers()['cache-control']).toContain('no-store')
  await expect(page.getByRole('heading', { name: '社区示例榜单' })).toBeVisible()
  await expect(page.getByText('第一项说明', { exact: true })).toBeVisible()
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', new RegExp(`\\?version=${fixture.versionId}$`))
  await page.getByText('版本历史', { exact: true }).click()
  await expect(page.getByRole('link', { name: '第 1 版', exact: true })).toBeVisible()
  await context.close()
})

test('keyboard sorting cancels only its gesture and return preserves a resumable draft', async ({ page }) => {
  await page.goto(`/ranking/${seed().rankingId}/`)
  await expect(page.locator('[data-ranking-account]')).toContainText('使用 Waline 登录')
  const handle = page.locator('[data-handle]').first()
  await handle.press('Space')
  await editorReady(page)
  await expect(page.locator('[data-grabbed]')).toHaveCount(1)
  await page.locator('[data-handle]').first().press('ArrowDown')
  await expect(names(page).nth(1)).toHaveValue('第一项')
  await page.keyboard.press('Escape')
  await expect(names(page).first()).toHaveValue('第一项')
  await page.getByLabel('榜单标题', { exact: true }).fill('我的本地排序')
  await page.keyboard.press('Escape')
  await editorReady(page)
  await page.getByRole('button', { name: '下移 第一项', exact: true }).click()
  await expect(names(page).first()).toHaveValue('第二项')
  await page.getByRole('button', { name: '返回原榜' }).click()
  await expect(items(page).first()).toContainText('第一项')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '创建我的榜单', exact: true }).click()
  await expect(names(page).first()).toHaveValue('第二项')
  await expect(page.getByLabel('榜单标题', { exact: true })).toHaveValue('我的本地排序')
})

test('local recovery uses revision conflicts instead of overwriting another tab', async ({ page, context }) => {
  await page.goto('/ranking/new/'); await editorReady(page)
  await page.getByLabel('榜单标题', { exact: true }).fill('第一标签草稿')
  await names(page).first().fill('保存的条目')
  await expect(page.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  const other = await context.newPage()
  other.on('dialog', dialog => dialog.accept())
  await other.goto('/ranking/new/'); await editorReady(other)
  await expect(other.getByLabel('榜单标题', { exact: true })).toHaveValue('第一标签草稿')
  await other.getByLabel('榜单标题', { exact: true }).fill('第二标签的新版本')
  await expect(other.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  await page.getByLabel('榜单标题', { exact: true }).fill('不能覆盖第二标签')
  await expect(page.locator('[data-save-status]')).toContainText('自动保存已暂停')
  await expect(page.getByLabel('榜单标题', { exact: true })).toHaveValue('不能覆盖第二标签')
  await expect(other.getByLabel('榜单标题', { exact: true })).toHaveValue('第二标签的新版本')
  await other.close()
})

test('unavailable storage retains editing and offers export', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('storage disabled') } }))
  await page.goto('/ranking/new/'); await editorReady(page)
  await page.getByLabel('榜单标题', { exact: true }).fill('无法存储时仍可编辑')
  await names(page).first().fill('本地条目')
  await expect(page.locator('[data-save-status]')).toContainText('无法自动保存')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载草稿' }).click()
  expect((await download).suggestedFilename()).toMatch(/^ranking-draft-.*\.json$/)
  await expect(page.getByLabel('榜单标题', { exact: true })).toHaveValue('无法存储时仍可编辑')
})

test('discard and recreate cannot let an old tab overwrite the replacement draft', async ({ page, context }) => {
  await page.goto('/ranking/new/'); await editorReady(page)
  await expect(page.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept())
  await other.goto('/ranking/new/'); await editorReady(other)
  await other.getByRole('button', { name: '丢弃草稿', exact: true }).click()
  await other.getByRole('button', { name: '创建我的榜单', exact: true }).click(); await editorReady(other)
  await expect(other.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  // Both incarnations are at revision 1; draftId must also participate in CAS.
  await page.getByLabel('榜单标题', { exact: true }).fill('旧标签不能覆盖新草稿')
  await expect(page.locator('[data-save-status]')).toContainText('自动保存已暂停')
  await expect(other.getByLabel('榜单标题', { exact: true })).toHaveValue('')
  await other.close()
})

test('session discovery failure still permits a recoverable anonymous export', async ({ page, context }) => {
  await page.route('**/api/ranking/auth/session/', route => route.abort('failed'))
  await page.goto('/ranking/new/'); await editorReady(page)
  await page.getByLabel('榜单标题', { exact: true }).fill('身份查询失败时的草稿')
  await names(page).first().fill('仍然可以恢复')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载草稿' }).click()
  const file = await (await downloaded).path()
  expect(file).toBeTruthy()
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept())
  await other.goto('/ranking/new/'); await editorReady(other)
  await other.locator('[data-import]').setInputFiles(file!)
  await expect(other.getByLabel('榜单标题', { exact: true })).toHaveValue('身份查询失败时的草稿')
  await expect(names(other).first()).toHaveValue('仍然可以恢复')
  await other.close()
})

test('restoring an old export starts a new local draft incarnation', async ({ page, context }) => {
  await page.goto('/ranking/new/'); await editorReady(page)
  await expect(page.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  await page.getByLabel('榜单标题', { exact: true }).fill('原文件草稿')
  await expect(page.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept())
  await other.goto('/ranking/new/'); await editorReady(other)
  const downloaded = other.waitForEvent('download')
  await other.getByRole('button', { name: '下载草稿' }).click()
  const file = await (await downloaded).path()
  await other.getByRole('button', { name: '丢弃草稿', exact: true }).click()
  await other.getByRole('button', { name: '创建我的榜单', exact: true }).click(); await editorReady(other)
  await expect(other.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  await other.locator('[data-import]').setInputFiles(file!)
  await expect(other.getByLabel('榜单标题', { exact: true })).toHaveValue('原文件草稿')
  await expect(other.locator('[data-save-status]')).toHaveText('已保存到此浏览器')
  await page.getByLabel('榜单标题', { exact: true }).fill('旧标签修改不能覆盖恢复后的草稿')
  await expect(page.locator('[data-save-status]')).toContainText('自动保存已暂停')
  await other.close()
})

test('pointer threshold, cancellation, settle cleanup and reduced motion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Mouse-only path; touch-specific path is separate')
  await page.goto(`/ranking/${seed().rankingId}/`)
  await expect(page.locator('[data-ranking-account]')).toContainText('使用 Waline 登录')
  const initial = await page.locator('[data-handle]').first().boundingBox()
  if (!initial) throw new Error('Missing handle')
  await page.mouse.move(initial.x + 15, initial.y + 15); await page.mouse.down(); await page.mouse.move(initial.x + 17, initial.y + 17); await page.mouse.up()
  await expect(page.locator('[data-draft-intent]')).not.toBeVisible()
  await page.getByRole('button', { name: '创建我的榜单', exact: true }).click(); await editorReady(page)
  await page.locator('[data-handle]').first().scrollIntoViewIfNeeded()
  const from = await page.locator('[data-handle]').first().boundingBox(), to = await items(page).nth(2).boundingBox()
  if (!from || !to) throw new Error('Missing rows')
  await page.mouse.move(from.x + 12, from.y + 12); await page.mouse.down(); await page.mouse.move(from.x + 12, from.y + 24)
  await expect(page.locator('.ranking-drag-ghost')).toHaveCount(1)
  await page.mouse.move(to.x + 60, to.y + to.height - 10, { steps: 5 })
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.locator('.ranking-drag-ghost')).toHaveCount(0)
  await expect(names(page).first()).toHaveValue('第一项')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('[data-handle]').first().scrollIntoViewIfNeeded()
  const nextFrom = await page.locator('[data-handle]').first().boundingBox()
  if (!nextFrom) throw new Error('Missing handle')
  expect(await page.locator('[data-handle]').first().evaluate(el => {
    const rect = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(rect.x + 12, rect.y + 12))
  }), 'The drag start must hit the handle rather than a floating overlay').toBe(true)
  await page.mouse.move(nextFrom.x + 12, nextFrom.y + 12); await page.mouse.down(); await page.mouse.move(nextFrom.x + 12, nextFrom.y + 24)
  await expect(page.locator('.ranking-drag-ghost')).toHaveCSS('scale', '1')
  await page.mouse.up()
  await expect(page.locator('.ranking-drag-ghost')).toHaveCount(0)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
  await page.screenshot({ path: testInfo.outputPath('ranking-editor-light.png'), fullPage: true })
})

test('small-screen editor keeps controls within viewport in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ranking/new/'); await editorReady(page)
  await page.getByLabel('榜单标题', { exact: true }).fill('小屏上的个人榜单')
  await names(page).first().fill('第一件值得推荐的事')
  await page.getByRole('button', { name: '＋ 添加条目', exact: true }).click()
  await names(page).nth(1).fill('另一件喜欢的事')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) }, theme)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`ranking-mobile-${theme}.png`), fullPage: true })
  }
})

test('touch body scrolls naturally while a 44px handle starts and cancels sorting', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch device path')
  await page.goto(`/ranking/${seed().rankingId}/`)
  await expect(page.locator('[data-ranking-account]')).toContainText('使用 Waline 登录')
  await items(page).first().scrollIntoViewIfNeeded()
  const body = await items(page).first().locator('.ranking-item-copy').boundingBox()
  if (!body) throw new Error('Missing row body')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: body.x + 25, y: body.y + 20 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: body.x + 25, y: body.y - 45 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('[data-draft-intent]')).not.toBeVisible()
  await expect(page.locator('.ranking-drag-ghost')).toHaveCount(0)
  await page.locator('[data-handle]').first().evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const handle = await page.locator('[data-handle]').first().boundingBox()
  if (!handle) throw new Error('Missing touch handle')
  expect(handle.width).toBeGreaterThanOrEqual(44); expect(handle.height).toBeGreaterThanOrEqual(44)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle.x + 20, y: handle.y + 20 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: handle.x + 20, y: handle.y + 32 }] })
  await editorReady(page)
  await expect(page.locator('.ranking-drag-ghost')).toHaveCount(1)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(page.locator('.ranking-drag-ghost')).toHaveCount(0)
  await expect(names(page).first()).toHaveValue('第一项')
  await cdp.detach()
})

test('unknown response retries original snapshot, then reject/edit/approve and visibility round trip', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One isolated account workflow to respect submission rate limits')
  const author = await browser.newContext({ baseURL: origin }), admin = await browser.newContext({ baseURL: origin })
  await login(author, 'author'); await login(admin, 'admin')
  const page = await author.newPage(), review = await admin.newPage()
  review.on('dialog', dialog => dialog.accept())
  await page.goto('/ranking/new/'); await editorReady(page)
  const title = `完整投稿 ${Date.now()}`
  await page.getByLabel('榜单标题', { exact: true }).fill(title)
  await names(page).first().fill('真正提交的第一项')
  let original: { id: string; rankingId: string } | undefined
  await page.route('**/api/ranking/submissions/', async route => {
    if (route.request().method() !== 'POST' || original) { await route.continue(); return }
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    original = (await response.json()).data
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '预览并提交' }).click()
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试确认上次投稿' })).toBeEnabled()
  await page.getByLabel('榜单标题', { exact: true }).fill(title + ' 后续修改')
  await page.getByRole('button', { name: '重试确认上次投稿' }).click()
  await expect(page.locator('[data-submission-result]')).toContainText('已提交审核')
  expect(original).toBeTruthy()
  await expect(page.getByLabel('榜单标题', { exact: true })).toHaveValue(title + ' 后续修改')
  await review.goto(`/ranking/submissions/${original!.id}/`)
  await expect(review.getByRole('heading', { level: 1 })).toHaveText(title)
  await review.getByLabel('退回原因', { exact: true }).fill('补充修改后再投')
  await review.getByRole('button', { name: '退回修改', exact: true }).click()
  await expect(review.getByText('处理原因：补充修改后再投')).toBeVisible()
  await page.goto(`/ranking/submissions/${original!.id}/`)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '继续修改', exact: true }).click(); await editorReady(page)
  await expect(page.getByLabel('榜单标题', { exact: true })).toHaveValue(title + ' 后续修改')
  await page.getByRole('button', { name: '预览并提交' }).click(); await page.getByRole('button', { name: '提交审核', exact: true }).click()
  const resultLink = page.locator('[data-submission-result] a')
  await expect(resultLink).toBeVisible()
  const href = (await resultLink.getAttribute('href'))!
  expect(href).not.toContain(original!.id)
  await review.goto(href)
  await review.getByRole('button', { name: '通过并发布' }).click()
  await expect(review.getByRole('link', { name: '查看已发布版本 →' })).toBeVisible()
  const publicContext = await browser.newContext({ javaScriptEnabled: false }), publicPage = await publicContext.newPage()
  const publicUrl = `${origin}/ranking/${original!.rankingId}/`
  expect((await publicPage.goto(publicUrl))?.status()).toBe(200)
  await expect(publicPage.getByRole('heading', { level: 1 })).toHaveText(title + ' 后续修改')
  await review.goto('/ranking/manage/')
  const managed = review.locator('.ranking-managed-entry').filter({ hasText: title })
  review.removeAllListeners('dialog'); review.on('dialog', dialog => dialog.accept('验收隐藏及恢复'))
  await managed.getByRole('button', { name: '下架', exact: true }).click()
  await expect(managed.getByRole('button', { name: '恢复', exact: true })).toBeVisible()
  expect((await publicPage.goto(publicUrl))?.status()).toBe(410)
  await expect(publicPage.locator('html')).not.toContainText(title)
  await managed.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(managed.getByRole('button', { name: '下架', exact: true })).toBeVisible()
  expect((await publicPage.goto(publicUrl))?.status()).toBe(200)
  await author.close(); await admin.close(); await publicContext.close()
})
