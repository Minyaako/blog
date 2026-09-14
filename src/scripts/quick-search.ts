type PagefindConstructor = new (options: Record<string, unknown>) => unknown
let installed = false
let assets: Promise<void> | undefined

function loadSearchAssets(): Promise<void> {
  if (!document.querySelector('link[href="/pagefind/pagefind-ui.css"]')) {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = '/pagefind/pagefind-ui.css'
      css.setAttribute('data-astro-transition-persist', 'quick-search-css')
      document.head.append(css)
  }
  if (assets) return assets
  assets = new Promise<void>((resolve, reject) => {
    if (typeof (window as unknown as { PagefindUI?: PagefindConstructor }).PagefindUI === 'function') { resolve(); return }
    const script = document.createElement('script')
    script.src = '/pagefind/pagefind-ui.js'
    script.onload = () => resolve()
    script.onerror = () => { script.remove(); assets = undefined; reject(new Error('Search assets unavailable')) }
    document.head.append(script)
  })
  return assets
}

export function initQuickSearch(): void {
  if (installed) return
  installed = true
  let returnFocus: HTMLElement | null = null
  let scrollOverflow = ''
  let active: HTMLDialogElement | null = null
  function close() {
    if (!active) return
    const dialog = active
    active = null
    dialog.close()
    document.documentElement.style.overflow = scrollOverflow
    if (returnFocus?.isConnected) returnFocus.focus()
  }
  async function open() {
    const dialog = document.querySelector<HTMLDialogElement>('[data-search-dialog]')
    if (!dialog || dialog.open || document.querySelector('dialog[open]')) return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    scrollOverflow = document.documentElement.style.overflow
    active = dialog
    dialog.showModal()
    document.documentElement.style.overflow = 'hidden'
    const status = dialog.querySelector<HTMLElement>('[data-search-status]')!
    const archive = dialog.querySelector<HTMLAnchorElement>('[data-search-archives]')!
    try {
      await loadSearchAssets()
      if (!dialog.isConnected || !dialog.open) return
      const mount = dialog.querySelector<HTMLElement>('#quick-search-results')!
      if (!mount.dataset.ready) {
        const PagefindUI = (window as unknown as { PagefindUI: PagefindConstructor }).PagefindUI
        new PagefindUI({ element: '#quick-search-results', showSubResults: true, translations: { placeholder: '搜索文章、标签与合集', zero_results: '没有找到 [SEARCH_TERM] 的结果' } })
        mount.dataset.ready = 'true'
      }
      status.hidden = true
      archive.hidden = true
      const input = dialog.querySelector<HTMLInputElement>('.pagefind-ui__search-input')
      input?.setAttribute('role', 'searchbox')
      input?.focus()
    } catch {
      status.hidden = false
      archive.hidden = false
      status.textContent = '搜索暂时无法加载，请稍后重试，或前往归档浏览。'
    }
  }
  // Capture before Astro's delegated link router can start navigation.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-quick-search]') && !(event as MouseEvent).ctrlKey && !(event as MouseEvent).metaKey && !(event as MouseEvent).shiftKey && !(event as MouseEvent).altKey) {
      event.preventDefault()
      void open()
    } else if (event.target.closest('[data-search-close]')) close()
    else if (event.target === active && active) {
      const bounds = active.getBoundingClientRect()
      const click = event as MouseEvent
      if (click.clientX < bounds.left || click.clientX > bounds.right || click.clientY < bounds.top || click.clientY > bounds.bottom) close()
    }
  }, true)
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k' && !event.isComposing) {
      event.preventDefault()
      if (!event.repeat) void open()
    }
  })
  document.addEventListener('cancel', event => {
    if (event.target !== active) return
    event.preventDefault()
    close()
  }, true)
  document.addEventListener('astro:before-swap', close)
}
