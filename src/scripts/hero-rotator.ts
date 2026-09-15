export function installHeroRotators(): void {
  let cleanup: (() => void)[] = []
  const stop = () => { cleanup.forEach(dispose => dispose()); cleanup = [] }
  const init = () => {
    stop()
    document.querySelectorAll<HTMLElement>('[data-hero-rotator]').forEach(rotator => {
      rotator.dataset.initialized = 'true'
      const slides = Array.from(rotator.querySelectorAll<HTMLImageElement>('[data-hero-slide]'))
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
      let active = 0
      let generation = 0
      let timer: number | undefined
      let busy = false
      const show = (index: number) => {
        active = index
        slides.forEach((slide, position) => {
          slide.dataset.active = String(position === index)
          slide.setAttribute('aria-hidden', String(position !== index))
        })
      }
      const cancel = () => { generation++; window.clearInterval(timer); timer = undefined }
      const rotate = async () => {
        if (busy) return
        busy = true
        const version = generation
        const next = (active + 1) % slides.length
        const image = slides[next]!
        if (!image.hasAttribute('src') && image.dataset.heroSrc) image.src = image.dataset.heroSrc
        try {
          await image.decode()
          if (version === generation && rotator.isConnected && !reduced.matches && !document.hidden) show(next)
        } catch {
          // Keep the currently decoded image visible; a later interval may retry.
          if (image.dataset.heroSrc) image.removeAttribute('src')
        } finally { busy = false }
      }
      const start = () => {
        cancel()
        if (reduced.matches) show(0)
        if (!reduced.matches && !document.hidden && slides.length > 1) timer = window.setInterval(() => { void rotate() }, 60_000)
      }
      show(0)
      document.addEventListener('visibilitychange', start)
      reduced.addEventListener('change', start)
      cleanup.push(() => { cancel(); delete rotator.dataset.initialized; document.removeEventListener('visibilitychange', start); reduced.removeEventListener('change', start) })
      start()
    })
  }
  document.addEventListener('astro:page-load', init)
  document.addEventListener('astro:before-swap', stop)
  window.addEventListener('pagehide', stop)
  window.addEventListener('pageshow', event => { if (event.persisted) init() })
  init()
}
