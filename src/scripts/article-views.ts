import { SITE } from '../config/site'
import { recordArticleView } from '../lib/article-views'

interface ViewDependencies {
  record(pageKey: string, signal: AbortSignal): Promise<number>
  timeoutMs: number
}

const installed = new WeakMap<Document, () => void>()

export function installArticleViews(
  doc: Document = document,
  win: Window = window,
  dependencies: ViewDependencies = { record: recordArticleView, timeoutMs: 8000 },
): () => void {
  const existing = installed.get(doc)
  if (existing) return existing
  const visited = new WeakSet<HTMLElement>()
  let stopCurrent: (() => void) | undefined

  const start = () => {
    const element = doc.querySelector<HTMLElement>('[data-article-views]')
    if (!element || visited.has(element)) return
    stopCurrent?.()
    visited.add(element)
    const output = element.querySelector<HTMLElement>('[data-article-views-value]')
    if (!output) return
    // An exact production-origin allowlist also protects local/LAN and staging builds
    // accidentally started without PUBLIC_BLOG_PREVIEW.
    if (element.dataset.preview === 'true' || win.location.origin !== SITE.origin) {
      element.dataset.state = 'disabled'
      output.textContent = '预览不计数'
      return
    }
    const pageKey = element.dataset.pageKey
    if (!pageKey) {
      element.dataset.state = 'error'
      output.textContent = '暂不可用'
      return
    }

    const controller = new AbortController()
    let disposed = false
    const timer = win.setTimeout(() => controller.abort(), dependencies.timeoutMs)
    stopCurrent = () => {
      disposed = true
      win.clearTimeout(timer)
      controller.abort()
    }
    element.dataset.state = 'loading'
    output.textContent = '统计中…'
    // Do not retry an uncertain POST: it may already have incremented on the server.
    void dependencies.record(pageKey, controller.signal).then((count) => {
      if (disposed || !element.isConnected) return
      element.dataset.state = 'ready'
      output.textContent = `${count.toLocaleString('zh-CN')} 次`
    }).catch(() => {
      if (disposed || !element.isConnected) return
      element.dataset.state = 'error'
      output.textContent = '暂不可用'
    }).finally(() => win.clearTimeout(timer))
  }
  const stop = () => { stopCurrent?.(); stopCurrent = undefined }
  const restore = (event: PageTransitionEvent) => {
    if (!event.persisted) return
    const element = doc.querySelector<HTMLElement>('[data-article-views]')
    if (element) visited.delete(element)
    start()
  }
  const dispose = () => {
    stop()
    doc.removeEventListener('astro:page-load', start)
    doc.removeEventListener('astro:before-swap', stop)
    win.removeEventListener('pagehide', stop)
    win.removeEventListener('pageshow', restore)
    installed.delete(doc)
  }
  installed.set(doc, dispose)
  doc.addEventListener('astro:page-load', start)
  doc.addEventListener('astro:before-swap', stop)
  win.addEventListener('pagehide', stop)
  win.addEventListener('pageshow', restore)
  start()
  return dispose
}
