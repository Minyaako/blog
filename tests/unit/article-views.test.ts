import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { recordArticleView } from '../../src/lib/article-views'
import { installArticleViews } from '../../src/scripts/article-views'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const markup = (pageKey = 'permanent-article-id', preview = false) => `<div data-article-views data-page-key="${pageKey}" data-preview="${preview}"><span data-article-views-value>统计中…</span></div>`
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach((dispose) => dispose()); vi.useRealTimers() })

function fixture(origin = 'https://gsk.minyako.top', preview = false, record = vi.fn(async (_key: string, _signal: AbortSignal) => 42)) {
  const dom = new JSDOM(markup('permanent-article-id', preview), { url: `${origin}/posts/a/?ref=test#section` })
  const doc = dom.window.document
  const win = dom.window as unknown as Window
  const deps = { record, timeoutMs: 8000 }
  cleanup.push(installArticleViews(doc, win, deps), () => dom.window.close())
  return { dom, doc, win, deps, record, text: () => doc.querySelector('[data-article-views-value]')!.textContent }
}

describe('Waline persistent article counter', () => {
  it('increments the permanent page key through the actual Waline API contract without credentials', async () => {
    const request = vi.fn(async () => response({ errno: 0, data: [{ time: 1250 }] }))
    const signal = new AbortController().signal
    expect(await recordArticleView('post-stable-id', signal, request)).toBe(1250)
    expect(request).toHaveBeenCalledWith('https://comments.minyako.top/api/article?lang=zh-CN', {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'post-stable-id', type: 'time', action: 'inc' }), signal,
    })
  })
  it.each([
    { errno: 1, data: [{ time: 12 }] }, { errno: 0, data: [] }, { errno: 0, data: [{ time: '12' }] },
    { errno: 0, data: [{ time: -1 }] }, { errno: 0, data: [{ time: 1.5 }] }, { errno: 0, data: [null] },
  ])('rejects malformed or failed results instead of fabricating zero: %j', async (body) => {
    await expect(recordArticleView('id', new AbortController().signal, vi.fn(async () => response(body)))).rejects.toThrow()
  })
  it('surfaces HTTP errors even if the body looks valid', async () => {
    await expect(recordArticleView('id', new AbortController().signal, vi.fn(async () => response({ errno: 0, data: [{ time: 5 }] }, 503)))).rejects.toThrow()
  })
})

describe('article-view navigation lifecycle', () => {
  it('counts once on initial mount despite duplicate installation and page-load events, using id rather than route/hash', async () => {
    const f = fixture()
    installArticleViews(f.doc, f.win, f.deps)
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    await vi.waitFor(() => expect(f.text()).toBe('42 次'))
    expect(f.record).toHaveBeenCalledOnce()
    expect(f.record.mock.calls[0]![0]).toBe('permanent-article-id')
  })
  it('counts each new article visit, including returning to the same page key', async () => {
    const f = fixture()
    for (const key of ['second-id', 'permanent-article-id']) {
      f.doc.dispatchEvent(new f.dom.window.Event('astro:before-swap'))
      f.doc.body.innerHTML = markup(key)
      f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
      f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    }
    await vi.waitFor(() => expect(f.text()).toBe('42 次'))
    expect(f.record.mock.calls.map((args) => args[0])).toEqual(['permanent-article-id', 'second-id', 'permanent-article-id'])
  })
  it.each(['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321', 'http://192.168.1.2:4321', 'https://preview.gsk.minyako.top', 'https://gsk.minyako.top.evil.test'])('does not call production statistics from %s', (origin) => {
    const f = fixture(origin)
    expect(f.record).not.toHaveBeenCalled()
    expect(f.text()).toBe('预览不计数')
  })
  it('never calls production statistics in PUBLIC_BLOG_PREVIEW even on the production origin', () => {
    const f = fixture('https://gsk.minyako.top', true)
    expect(f.record).not.toHaveBeenCalled()
    expect(f.text()).toBe('预览不计数')
  })
  it('shows failure without retrying an uncertain increment', async () => {
    const f = fixture(undefined, false, vi.fn(async () => { throw new Error('offline') }))
    await vi.waitFor(() => expect(f.text()).toBe('暂不可用'))
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    expect(f.record).toHaveBeenCalledOnce()
  })
  it('aborts old work and ignores stale results after navigation', async () => {
    let finish!: (count: number) => void
    const record = vi.fn((_key: string, _signal: AbortSignal) => new Promise<number>((resolve) => { finish = resolve }))
    const f = fixture(undefined, false, record)
    const old = f.doc.querySelector('[data-article-views-value]')!
    f.doc.dispatchEvent(new f.dom.window.Event('astro:before-swap'))
    expect(record.mock.calls[0]![1].aborted).toBe(true)
    f.doc.body.innerHTML = '<main>Other page</main>'
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    finish(999)
    await Promise.resolve()
    expect(old.textContent).not.toBe('999 次')
    expect(record).toHaveBeenCalledOnce()
  })
  it('times out and exposes the unavailable state', async () => {
    vi.useFakeTimers()
    const f = fixture(undefined, false, vi.fn((_key: string, signal: AbortSignal) => new Promise<number>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    await vi.advanceTimersByTimeAsync(8001)
    expect(f.record.mock.calls[0]![1].aborted).toBe(true)
    expect(f.text()).toBe('暂不可用')
    expect(f.record).toHaveBeenCalledOnce()
  })
  it('counts a back-forward cache restoration once and cleans up pagehide requests', async () => {
    const f = fixture()
    await vi.waitFor(() => expect(f.text()).toBe('42 次'))
    f.win.dispatchEvent(new f.dom.window.Event('pagehide'))
    expect(f.record.mock.calls[0]![1].aborted).toBe(true)
    f.win.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow', { persisted: true }))
    f.doc.dispatchEvent(new f.dom.window.Event('astro:page-load'))
    await vi.waitFor(() => expect(f.text()).toBe('42 次'))
    expect(f.record).toHaveBeenCalledTimes(2)
  })
})
