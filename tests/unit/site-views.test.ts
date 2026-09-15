import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { installSiteViews, SITE_VIEWS_KEY } from '../../src/scripts/site-views'
import { installArticleViews } from '../../src/scripts/article-views'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
}
const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()))
const markup = (badge = true, preview = false) => `<main data-site-views-page data-preview="${preview}">${badge ? '<span data-site-views-value></span>' : ''}</main>`

it('counts all visited pages with one shared key, including pages without a badge', async () => {
  const dom = new JSDOM(markup(), { url: 'https://gsk.minyako.top/' })
  const doc = dom.window.document
  let count = 100
  const record = vi.fn(async () => ++count)
  const deps = { record, timeoutMs: 8000 }
  cleanup.push(installSiteViews(doc, dom.window, deps), () => dom.window.close())
  installSiteViews(doc, dom.window, deps)
  doc.dispatchEvent(new dom.window.Event('astro:page-load'))
  await vi.waitFor(() => expect(doc.querySelector('[data-site-views-value]')!.textContent).toBe('101 次'))
  for (const badge of [false, true]) {
    doc.dispatchEvent(new dom.window.Event('astro:before-swap'))
    doc.body.innerHTML = markup(badge)
    doc.dispatchEvent(new dom.window.Event('astro:page-load'))
    doc.dispatchEvent(new dom.window.Event('astro:page-load'))
  }
  await vi.waitFor(() => expect(doc.querySelector('[data-site-views-value]')!.textContent).toBe('103 次'))
  expect(record).toHaveBeenCalledTimes(3)
  for (const call of record.mock.calls as unknown as [string, AbortSignal][]) expect(call[0]).toBe(SITE_VIEWS_KEY)
})

it('keeps the article counter separate from the site total on article visits', async () => {
  const dom = new JSDOM(`<main data-site-views-page data-preview="false"><div data-article-views data-page-key="journey-begin"><span data-article-views-value></span></div></main>`, { url: 'https://gsk.minyako.top/posts/journey-begin/' })
  const site = vi.fn(async () => 100)
  const article = vi.fn(async () => 12)
  cleanup.push(installSiteViews(dom.window.document, dom.window, { record: site, timeoutMs: 8000 }), installArticleViews(dom.window.document, dom.window, { record: article, timeoutMs: 8000 }), () => dom.window.close())
  await vi.waitFor(() => expect(dom.window.document.querySelector('[data-article-views-value]')!.textContent).toBe('12 次'))
  expect(site).toHaveBeenCalledWith(SITE_VIEWS_KEY, expect.any(AbortSignal))
  expect(article).toHaveBeenCalledWith('journey-begin', expect.any(AbortSignal))
})

it.each([
  ['http://127.0.0.1:4321', false], ['https://preview.gsk.minyako.top', false],
  ['https://gsk.minyako.top.evil.test', false], ['https://gsk.minyako.top', true],
] as const)('does not write site statistics in %s, preview=%s', (url, preview) => {
  const dom = new JSDOM(markup(true, preview), { url })
  const record = vi.fn(async () => 1)
  cleanup.push(installSiteViews(dom.window.document, dom.window, { record, timeoutMs: 8000 }), () => dom.window.close())
  expect(record).not.toHaveBeenCalled()
  expect(dom.window.document.querySelector('[data-site-views-value]')!.textContent).toBe('预览不计数')
})
