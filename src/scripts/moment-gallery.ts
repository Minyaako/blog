export function nextGalleryIndex(current: number, direction: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(length - 1, Math.max(0, current + Math.sign(direction)))
}

export function shouldConsumeGalleryWheel(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY'>,
  current: number,
  length: number
): boolean {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (dominantDelta === 0) return false
  const candidate = current + Math.sign(dominantDelta)
  return candidate >= 0 && candidate < length
}

export function initMomentGalleries(root: ParentNode = document): () => void {
  const cleanups: Array<() => void> = []

  root.querySelectorAll<HTMLElement>('[data-moment-gallery]').forEach((gallery) => {
    if (gallery.dataset.galleryInitialized === 'true') return
    gallery.dataset.galleryInitialized = 'true'
    gallery.dataset.galleryEnhanced = 'true'
    gallery.dataset.galleryView = 'stage'

    const stage = gallery.querySelector<HTMLButtonElement>('[data-gallery-stage]')
    const stageImage = stage?.querySelector<HTMLImageElement>('img')
    const thumbs = Array.from(gallery.querySelectorAll<HTMLButtonElement>('[data-gallery-thumb]'))
    const sourceImages = Array.from(gallery.querySelectorAll<HTMLImageElement>('[data-gallery-grid] img'))
    const viewButtons = Array.from(gallery.querySelectorAll<HTMLButtonElement>('[data-gallery-view]'))
    const dialog = gallery.querySelector<HTMLDialogElement>('[data-gallery-lightbox]')
    const dialogImage = dialog?.querySelector<HTMLImageElement>('img')
    const closeButton = dialog?.querySelector<HTMLButtonElement>('[data-gallery-close]')
    if (!stage || !stageImage || sourceImages.length === 0) return

    let current = 0
    let pointerStartX: number | undefined
    let wheelLocked = false
    let wheelTimer: number | undefined
    const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = []
    const on = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, listener, options)
      listeners.push([target, type, listener, options])
    }

    const select = (index: number) => {
      current = Math.min(sourceImages.length - 1, Math.max(0, index))
      const source = sourceImages[current]
      stageImage.src = source.src
      stageImage.alt = source.alt
      stageImage.width = source.width
      stageImage.height = source.height
      stageImage.style.opacity = '0.55'
      stageImage.style.scale = '0.995'
      requestAnimationFrame(() => {
        stageImage.style.opacity = '1'
        stageImage.style.scale = '1'
      })
      thumbs.forEach((thumb, index) => index === current
        ? thumb.setAttribute('aria-current', 'true')
        : thumb.removeAttribute('aria-current'))
      gallery.dataset.galleryIndex = String(current)
    }

    thumbs.forEach((thumb, index) => on(thumb, 'click', () => select(index)))
    on(gallery, 'keydown', ((event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      select(nextGalleryIndex(current, event.key === 'ArrowRight' ? 1 : -1, sourceImages.length))
    }) as EventListener)
    on(gallery, 'pointerdown', ((event: PointerEvent) => { pointerStartX = event.clientX }) as EventListener)
    on(gallery, 'pointerup', ((event: PointerEvent) => {
      if (pointerStartX === undefined) return
      const delta = pointerStartX - event.clientX
      pointerStartX = undefined
      if (Math.abs(delta) < 36) return
      select(nextGalleryIndex(current, Math.sign(delta), sourceImages.length))
    }) as EventListener)
    on(gallery, 'wheel', ((event: WheelEvent) => {
      if (wheelLocked || !shouldConsumeGalleryWheel(event, current, sourceImages.length)) return
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      select(nextGalleryIndex(current, Math.sign(delta), sourceImages.length))
      wheelLocked = true
      if (wheelTimer) window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => { wheelLocked = false }, 180)
    }) as EventListener, { passive: false })

    viewButtons.forEach((button) => on(button, 'click', () => {
      const view = button.dataset.galleryView === 'grid' ? 'grid' : 'stage'
      gallery.dataset.galleryView = view
      viewButtons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)))
    }))
    on(stage, 'click', () => {
      if (!dialog || !dialogImage) return
      const source = sourceImages[current]
      dialogImage.src = source.src
      dialogImage.alt = source.alt
      dialogImage.width = source.width
      dialogImage.height = source.height
      dialog.showModal()
      closeButton?.focus()
    })
    if (dialog) {
      on(closeButton ?? dialog, 'click', () => dialog.close())
      on(dialog, 'close', () => stage.focus())
    }

    select(0)
    cleanups.push(() => {
      listeners.forEach(([target, type, listener, options]) => target.removeEventListener(type, listener, options))
      if (wheelTimer) window.clearTimeout(wheelTimer)
      delete gallery.dataset.galleryInitialized
    })
  })

  return () => cleanups.forEach((cleanup) => cleanup())
}
