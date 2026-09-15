import { SITE } from '../config/site'
import { recordArticleView } from '../lib/article-views'

interface ViewDependencies {
  record(pageKey: string, signal: AbortSignal): Promise<number>
  timeoutMs: number
}

interface CounterOptions {
  marker: string
  output: string
  pageKey?: string
  requireOutput?: boolean
}

export function createViewCounterInstaller(options: CounterOptions) {
  const installed = new WeakMap<Document, () => void>()

  return function installViews(
    doc: Document = document,
    win: Window = window,
    dependencies: ViewDependencies = { record: recordArticleView, timeoutMs: 8000 },
  ): () => void {
    const existing = installed.get(doc)
    if (existing) return existing
    const visited = new WeakSet<HTMLElement>()
    let stopCurrent: (() => void) | undefined

    const start = () => {
      const element = doc.querySelector<HTMLElement>(options.marker)
      if (!element || visited.has(element)) return
      stopCurrent?.()
      visited.add(element)
      const output = element.querySelector<HTMLElement>(options.output)
      if (!output && options.requireOutput) return
      // An exact production-origin allowlist also protects local/LAN and staging builds
      // accidentally started without PUBLIC_BLOG_PREVIEW.
      if (element.dataset.preview === 'true' || win.location.origin !== SITE.origin) {
        element.dataset.state = 'disabled'
        if (output) output.textContent = '预览不计数'
        return
      }
      const pageKey = options.pageKey ?? element.dataset.pageKey
      if (!pageKey) {
        element.dataset.state = 'error'
        if (output) output.textContent = '暂不可用'
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
      if (output) output.textContent = '统计中…'
      // Do not retry an uncertain POST: it may already have incremented on the server.
      void dependencies.record(pageKey, controller.signal).then((count) => {
        if (disposed || !element.isConnected) return
        element.dataset.state = 'ready'
        if (output) output.textContent = `${count.toLocaleString('zh-CN')} 次`
      }).catch(() => {
        if (disposed || !element.isConnected) return
        element.dataset.state = 'error'
        if (output) output.textContent = '暂不可用'
      }).finally(() => win.clearTimeout(timer))
    }
    const stop = () => { stopCurrent?.(); stopCurrent = undefined }
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      const element = doc.querySelector<HTMLElement>(options.marker)
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

}
