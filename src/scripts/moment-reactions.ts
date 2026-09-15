import { SITE } from '../config/site'
import { getMomentReactions, MOMENT_REACTIONS, MomentReactionController, reactionStorageKey, updateMomentReaction, type ReactionDependencies } from '../lib/moment-reactions'

const installed = new WeakMap<Document, () => void>()

export function installMomentReactions(doc: Document = document, win: Window = window, dependencies?: ReactionDependencies): () => void {
  const existing = installed.get(doc)
  if (existing) return existing
  let storage: Storage | undefined
  try { storage = win.localStorage } catch { /* The controller exposes a read-only fallback. */ }
  const deps: ReactionDependencies = dependencies ?? {
    storage: storage ?? { getItem() { throw new Error('Storage unavailable') }, setItem() { throw new Error('Storage unavailable') } },
    read: getMomentReactions, update: updateMomentReaction
  }
  const controllers = new Map<string, MomentReactionController>()
  let mounted = new WeakSet<HTMLElement>()
  let disposePage: (() => void)[] = []
  let observer: MutationObserver | undefined
  let pageController = new AbortController()
  const refresh = (controller: MomentReactionController) => {
    const signal = AbortSignal.any([pageController.signal, AbortSignal.timeout(8000)])
    void controller.load(signal)
  }
  const mount = (root: ParentNode) => {
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-moment-reactions]'))
    if ('nodeType' in root && root.nodeType === 1 && (root as Element).matches('[data-moment-reactions]')) elements.unshift(root as HTMLElement)
    elements.forEach(element => {
      if (mounted.has(element)) return
      mounted.add(element)
      const status = element.querySelector<HTMLElement>('[data-reaction-status]')!
      const retry = element.querySelector<HTMLButtonElement>('[data-reaction-retry]')!
      const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-reaction-index]'))
      if (element.dataset.preview === 'true' || win.location.origin !== SITE.origin) {
        element.dataset.reactionState = 'disabled'
        status.textContent = '预览中不读取或发送回应。'
        return
      }
      const id = element.dataset.reactionId ?? ''
      if (!/^\d{8}-\d{6}-[a-f0-9]{8}$/u.test(id)) return
      let controller = controllers.get(id)
      if (!controller) { controller = new MomentReactionController(id, deps); controllers.set(id, controller) }
      const model = controller
      const render = () => {
        const state = model.state
        element.dataset.reactionState = state.phase
        element.setAttribute('aria-busy', String(state.phase === 'loading' || state.phase === 'saving'))
        status.textContent = state.message
        retry.hidden = !['error', 'uncertain'].includes(state.phase)
        buttons.forEach((button, index) => {
          button.disabled = state.phase !== 'ready'
          const count = state.counts?.[index]
          const countText = typeof count === 'number' ? count.toLocaleString('zh-CN') : '—'
          button.querySelector('[data-reaction-count]')!.textContent = countText
          button.setAttribute('aria-pressed', String(state.selected === index))
          button.setAttribute('aria-label', `${MOMENT_REACTIONS[index]!.label}${count !== undefined ? `，${countText} 次回应` : '，数量未读取'}${state.selected === index ? '，已选择，再次点击取消' : ''}`)
        })
      }
      disposePage.push(model.subscribe(render))
      const click = async (event: Event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-reaction-index]')
        if (!button || !element.contains(button)) return
        const index = Number(button.dataset.reactionIndex)
        const choose = () => model.choose(index)
        try {
          if (win.navigator.locks) {
            await win.navigator.locks.request(reactionStorageKey(id), { ifAvailable: true }, async lock => {
              if (lock) await choose()
              else status.textContent = '另一页正在保存回应，请稍后再试。'
            })
          } else await choose()
        } catch { status.textContent = '暂时无法开始回应，请稍后再试。' }
        if (model.state.phase === 'ready' && model.state.selected === index && element.isConnected) {
          button.dataset.pop = ''
        }
      }
      const animationEnd = (event: Event) => (event.target as Element).closest<HTMLElement>('[data-pop]')?.removeAttribute('data-pop')
      const reload = () => refresh(model)
      const sync = (event: StorageEvent) => { if (event.key === reactionStorageKey(id) && model.state.phase !== 'saving') refresh(model) }
      element.addEventListener('click', click)
      element.addEventListener('animationend', animationEnd)
      retry.addEventListener('click', reload)
      win.addEventListener('storage', sync)
      disposePage.push(() => {
        element.removeEventListener('click', click); element.removeEventListener('animationend', animationEnd)
        retry.removeEventListener('click', reload); win.removeEventListener('storage', sync)
      })
      const View = doc.defaultView
      if (View && 'IntersectionObserver' in View) {
        const nearby = new View.IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) { nearby.disconnect(); refresh(model) }
        }, { rootMargin: '200px' })
        nearby.observe(element)
        disposePage.push(() => nearby.disconnect())
      } else refresh(model)
    })
  }
  const start = () => {
    mount(doc)
    observer?.disconnect()
    const stream = doc.querySelector('[data-moment-page-items]')
    if (stream) {
      observer = new doc.defaultView!.MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1) mount(node as Element)
      })))
      observer.observe(stream, { childList: true, subtree: true })
    }
  }
  const stop = () => {
    pageController.abort(); pageController = new AbortController()
    observer?.disconnect(); observer = undefined
    disposePage.forEach(dispose => dispose()); disposePage = []
    mounted = new WeakSet()
  }
  const restore = (event: PageTransitionEvent) => { if (event.persisted) { stop(); start() } }
  const dispose = () => {
    stop()
    doc.removeEventListener('astro:page-load', start); doc.removeEventListener('astro:before-swap', stop)
    win.removeEventListener('pagehide', stop); win.removeEventListener('pageshow', restore)
    installed.delete(doc)
  }
  installed.set(doc, dispose)
  doc.addEventListener('astro:page-load', start); doc.addEventListener('astro:before-swap', stop)
  win.addEventListener('pagehide', stop); win.addEventListener('pageshow', restore)
  start()
  return dispose
}
