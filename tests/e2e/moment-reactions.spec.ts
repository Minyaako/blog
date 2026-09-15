import { expect, test, type Page } from '@playwright/test'

const productionOrigin = 'https://gsk.minyako.top'
const localOrigin = process.env.RANKING_E2E_ORIGIN || 'http://127.0.0.1:4321'
const initialCounts = [7, 2, 0, 1, 0, 0]
type Mutation = { path: string; type: string; action: 'inc' | 'desc' }

async function isolatedProduction(page: Page, defaultCounts: readonly number[] = initialCounts) {
  // Serve the local build under the production origin so that the production-only
  // guard is exercised. Every counter request is intercepted before it can leave.
  await page.route(`${productionOrigin}/**`, async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${localOrigin}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
  await page.route('https://pic.minyako.top/**', route => route.abort())
  const counts = new Map<string, number[]>()
  const mutations: Mutation[] = []
  const reads: string[] = []
  const options = { failRead: false, loseWriteResponse: false }
  await page.route('https://comments.minyako.top/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/article') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Isolated comments</title>' })
      return
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Mutation
      if (body.type === 'time') {
        await route.fulfill({ json: { errno: 0, data: [{ time: 123 }] } })
        return
      }
      mutations.push(body)
      const index = Number(body.type.replace('reaction', ''))
      const current = counts.get(body.path) ?? [...defaultCounts]
      current[index] = Math.max(0, current[index]! + (body.action === 'desc' ? -1 : 1))
      counts.set(body.path, current)
      if (options.loseWriteResponse) await route.abort('failed')
      else await route.fulfill({ json: { errno: 0, data: [{ [body.type]: current[index] }] } })
      return
    }
    const id = url.searchParams.get('path')!
    reads.push(id)
    if (options.failRead) {
      await route.fulfill({ status: 503, body: 'Unavailable' })
      return
    }
    const current = counts.get(id) ?? [...defaultCounts]
    await route.fulfill({ json: { errno: 0, data: [Object.fromEntries(current.map((count, index) => [`reaction${index}`, count]))] } })
  })
  return { counts, mutations, reads, options }
}

test('timeline reactions use confirmed counts and support switching, cancellation and detail navigation', async ({ page }) => {
  const service = await isolatedProduction(page)
  await page.goto(`${productionOrigin}/moments/`)
  const card = page.locator('[data-moment-card]').first()
  const id = await card.getAttribute('data-moment-id')
  await expect(card).toHaveAttribute('data-timeline', 'true')
  await expect(card.locator('time')).toHaveAttribute('datetime', /T/)
  const reactions = card.locator('[data-moment-reactions]')
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'ready')
  await expect(reactions.getByRole('button', { name: '赞，7 次回应', exact: true })).toBeVisible()
  await expect(reactions.locator('[data-reaction-index]:visible')).toHaveCount(3)
  await expect(reactions.locator('[data-reaction-index="2"]')).toBeHidden()
  await expect(reactions.locator('[data-reaction-toggle]')).toBeVisible()
  await expect(reactions.locator('[data-reaction-picker]')).toBeHidden()
  expect(service.mutations).toEqual([])

  await reactions.getByRole('button', { name: '赞，7 次回应', exact: true }).click()
  await expect(reactions.locator('[data-reaction-index="0"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(reactions.locator('[data-reaction-index="0"]')).toContainText('8')
  await reactions.locator('[data-reaction-index="1"]').click()
  await expect(reactions.locator('[data-reaction-index="0"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(reactions.locator('[data-reaction-index="1"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(reactions.locator('[data-reaction-index="1"]')).toContainText('3')
  expect(service.mutations.map(value => [value.path, value.type, value.action])).toEqual([
    [id, 'reaction0', 'inc'], [id, 'reaction0', 'desc'], [id, 'reaction1', 'inc']
  ])
  await reactions.screenshot({ path: `output/playwright/moment-reactions-${test.info().project.name}.png`, animations: 'disabled' })

  await card.getByRole('link', { name: '永久链接', exact: true }).click()
  await expect(page).toHaveURL(`${productionOrigin}/moments/${id}/`)
  const detail = page.locator('[data-moment-reactions]')
  await detail.scrollIntoViewIfNeeded()
  await expect(detail).toHaveAttribute('data-reaction-state', 'ready')
  await expect(detail.locator('[data-reaction-index="1"]')).toHaveAttribute('aria-pressed', 'true')
  await detail.locator('[data-reaction-index="1"]').click()
  await expect(detail.locator('[data-reaction-index="1"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(detail.locator('[data-reaction-index="1"]')).toContainText('2')
  expect(service.mutations).toHaveLength(4)
  expect(service.mutations[3]).toEqual({ path: id, type: 'reaction1', action: 'desc' })
})

test('zero reactions show only the picker toggle and a confirmed choice appears until its count returns to zero', async ({ page }) => {
  const service = await isolatedProduction(page, [0, 0, 0, 0, 0, 0])
  await page.goto(`${productionOrigin}/moments/`)
  const reactions = page.locator('[data-moment-reactions]').first()
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'ready')
  await expect(reactions.locator('[data-reaction-index]:visible')).toHaveCount(0)
  const toggle = reactions.locator('[data-reaction-toggle]')
  const picker = reactions.locator('[data-reaction-picker]')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(picker).toBeHidden()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(picker).toBeVisible()
  await expect(picker.locator('[data-reaction-choice]')).toHaveCount(6)
  await expect(picker.locator('[data-reaction-count]')).toHaveCount(0)
  await picker.locator('[data-reaction-choice="2"]').click()
  const chosen = reactions.locator('[data-reaction-index="2"]')
  await expect(chosen).toBeVisible()
  await expect(chosen).toHaveAttribute('aria-pressed', 'true')
  await expect(chosen.locator('[data-reaction-count]')).toHaveText('1')
  await expect(reactions.locator('[data-reaction-index]:visible')).toHaveCount(1)
  await expect(picker).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await chosen.click()
  await expect(chosen).toBeHidden()
  await expect(reactions.locator('[data-reaction-index]:visible')).toHaveCount(0)
  await expect(toggle).toBeVisible()
  await expect(toggle).toBeFocused()
  expect(service.mutations.map(value => [value.type, value.action])).toEqual([
    ['reaction2', 'inc'], ['reaction2', 'desc']
  ])
})

test('Escape and outside clicks dismiss the picker without changing a reaction', async ({ page }) => {
  const service = await isolatedProduction(page)
  await page.goto(`${productionOrigin}/moments/`)
  const card = page.locator('[data-moment-card]').first()
  const reactions = card.locator('[data-moment-reactions]')
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'ready')
  const toggle = reactions.locator('[data-reaction-toggle]')
  const picker = reactions.locator('[data-reaction-picker]')
  await toggle.click()
  await picker.locator('[data-reaction-choice="0"]').focus()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await toggle.click()
  await expect(picker).toBeVisible()
  await card.locator('.moment-meta').click()
  await expect(picker).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(service.mutations).toEqual([])
})

test('a lost mutation response never triggers a duplicate vote after refresh', async ({ page }) => {
  const service = await isolatedProduction(page)
  service.options.loseWriteResponse = true
  await page.goto(`${productionOrigin}/moments/`)
  const reactions = page.locator('[data-moment-reactions]').first()
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'ready')
  await reactions.locator('[data-reaction-index="0"]').click()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'uncertain')
  await expect(reactions.getByRole('status')).toContainText('结果未确认')
  await expect(reactions.locator('[data-reaction-index="0"]')).toBeDisabled()
  expect(service.mutations).toHaveLength(1)
  await page.reload()
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'uncertain')
  // The simulated server accepted the first write. A fresh read shows eight;
  // the browser still cannot claim which anonymous request produced that count.
  await expect(reactions.locator('[data-reaction-index="0"]')).toContainText('8')
  await reactions.getByRole('button', { name: '刷新数量', exact: true }).click()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'uncertain')
  expect(service.mutations).toHaveLength(1)
})

test('failed count reads show unavailable values and recover through a read-only retry', async ({ page }) => {
  const service = await isolatedProduction(page)
  service.options.failRead = true
  await page.goto(`${productionOrigin}/moments/`)
  const reactions = page.locator('[data-moment-reactions]').first()
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'error')
  await expect(reactions.locator('[data-reaction-count]').first()).toHaveText('—')
  await expect(reactions.locator('[data-reaction-index="0"]')).toBeDisabled()
  await expect(reactions.locator('[data-reaction-index]:visible')).toHaveCount(0)
  await reactions.locator('[data-reaction-toggle]').click()
  await expect(reactions.locator('[data-reaction-picker]')).toBeVisible()
  await expect(reactions.locator('[data-reaction-choice="0"]')).toBeDisabled()
  await page.keyboard.press('Escape')
  service.options.failRead = false
  await reactions.getByRole('button', { name: '刷新数量', exact: true }).click()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'ready')
  await expect(reactions.locator('[data-reaction-count]').first()).toHaveText('7')
  expect(service.mutations).toEqual([])
})

test('local previews leave production reaction counters untouched', async ({ page }) => {
  const requests: string[] = []
  await page.route('https://comments.minyako.top/**', async route => {
    requests.push(route.request().url())
    await route.abort()
  })
  await page.route('https://pic.minyako.top/**', route => route.abort())
  await page.goto('/moments/')
  const reactions = page.locator('[data-moment-reactions]').first()
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'disabled')
  await expect(reactions.locator('[data-reaction-index="0"]')).toBeDisabled()
  await reactions.locator('[data-reaction-toggle]').click()
  await expect(reactions.locator('[data-reaction-picker]')).toBeVisible()
  await expect(reactions.locator('[data-reaction-choice="0"]')).toBeDisabled()
  expect(requests.filter(url => url.includes('reaction'))).toEqual([])
})

test('reaction picker retains touch targets, uses a compact 3 by 2 grid and honors reduced motion', async ({ page }) => {
  await isolatedProduction(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${productionOrigin}/moments/`)
  const reactions = page.locator('[data-moment-reactions]').first()
  await reactions.scrollIntoViewIfNeeded()
  await expect(reactions).toHaveAttribute('data-reaction-state', 'ready')
  const toggle = reactions.locator('[data-reaction-toggle]')
  await toggle.click()
  const picker = reactions.locator('[data-reaction-picker]')
  await expect(picker).toBeVisible()
  const button = picker.locator('[data-reaction-choice="0"]')
  await button.focus()
  await expect(button.locator('.reaction-emoji')).toHaveCSS('animation-name', 'none')
  const dimensions = await button.boundingBox()
  expect(dimensions!.height).toBeGreaterThanOrEqual(44)
  expect(dimensions!.width).toBeGreaterThanOrEqual(44)
  const toggleDimensions = await toggle.boundingBox()
  expect(toggleDimensions!.height).toBeGreaterThanOrEqual(44)
  expect(toggleDimensions!.width).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await picker.screenshot({ path: `output/playwright/moment-reaction-picker-${test.info().project.name}.png`, animations: 'disabled' })
  await page.setViewportSize({ width: 320, height: 760 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const compact = await picker.locator('[data-reaction-choice]').evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect()
    return { top: bounds.top, width: bounds.width, height: bounds.height }
  }))
  expect(compact).toHaveLength(6)
  expect(compact.every(bounds => bounds.width >= 44 && bounds.height >= 44)).toBe(true)
  expect(compact[0]!.top).toBe(compact[2]!.top)
  expect(compact[3]!.top).toBeGreaterThan(compact[0]!.top)
  expect(compact[3]!.top).toBe(compact[5]!.top)
  await picker.screenshot({ path: `output/playwright/moment-reaction-picker-narrow-${test.info().project.name}.png`, animations: 'disabled' })
})

test('an appended page retains the timeline, removes a repeated month heading and initializes new reactions', async ({ page }) => {
  const service = await isolatedProduction(page)
  let month = ''
  let existingId = ''
  let originalCount = 0
  const addedId = '20260821-120000-aaaaaaaa'
  await page.route(`${productionOrigin}/moments/`, async route => {
    const response = await route.fetch({ url: `${localOrigin}/moments/` })
    let body = await response.text()
    month = /data-month-key="(\d{4}-\d{2})"/u.exec(body)?.[1] ?? ''
    existingId = /data-moment-id="([^"]+)"/u.exec(body)?.[1] ?? ''
    originalCount = body.match(/<article\b[^>]*\bdata-moment-card\b/gu)?.length ?? 0
    body = body.replace('</main>', '<a data-next-page href="/moments/page/2/">加载下一页</a></main>')
    await route.fulfill({ response, body })
  })
  await page.route(`${productionOrigin}/moments/page/2/`, route => route.fulfill({
    contentType: 'text/html',
    body: `<div data-moment-page-items><h2 data-month-key="${month}">同一个月</h2><article data-moment-card data-moment-id="${existingId}">不应重复追加</article><article data-moment-card data-moment-id="${addedId}" data-timeline="true"><p>同月更早的一条动态</p><div data-moment-reactions data-reaction-id="${addedId}" data-preview="false">${initialCounts.map((_, index) => `<button data-reaction-index="${index}" disabled hidden><span data-reaction-count>—</span></button>`).join('')}<button data-reaction-toggle aria-label="添加回应" aria-expanded="false" aria-controls="appended-reaction-picker">+</button><div id="appended-reaction-picker" data-reaction-picker hidden>${['👍', '❤️', '😆', '😮', '🤔', '🎉'].map((emoji, index) => `<button data-reaction-choice="${index}" disabled><span class="reaction-emoji">${emoji}</span></button>`).join('')}</div><span data-reaction-status></span><button data-reaction-retry hidden>刷新数量</button></div></article></div>`
  }))
  await page.goto(`${productionOrigin}/moments/`)
  expect(month).toMatch(/^\d{4}-\d{2}$/)
  const next = page.locator('[data-next-page]')
  if (await next.count()) await next.scrollIntoViewIfNeeded()
  const added = page.locator(`[data-moment-id="${addedId}"]`)
  await expect(added).toHaveCount(1)
  await expect(page.locator('[data-moment-card]')).toHaveCount(originalCount + 1)
  await expect(page.locator(`[data-month-key="${month}"]`)).toHaveCount(1)
  await expect(page.locator(`[data-moment-id="${existingId}"]`)).toHaveCount(1)
  await expect(page.getByText('不应重复追加')).toHaveCount(0)
  await added.scrollIntoViewIfNeeded()
  await expect(added.locator('[data-moment-reactions]')).toHaveAttribute('data-reaction-state', 'ready')
  await expect(added.locator('[data-reaction-index]:visible')).toHaveCount(3)
  await added.locator('[data-reaction-toggle]').click()
  await expect(added.locator('[data-reaction-picker]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(added.locator('[data-reaction-picker]')).toBeHidden()
  expect(service.reads).toContain(addedId)
  expect(service.mutations).toEqual([])
  expect(await page.locator('[data-moment-page-items]').evaluate(element => getComputedStyle(element, '::before').content)).not.toBe('none')
})
