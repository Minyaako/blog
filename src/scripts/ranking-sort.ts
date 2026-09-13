/** Pointer and keyboard gestures only; persistence belongs to the editor at commit. */
export function rankingSort(list: HTMLElement, options: {
  begin: (itemId: string) => Promise<boolean>
  order: () => string[]
  move: (itemId: string, index: number) => void
  restore: (ids: string[]) => void
  commit: () => void
  announce: (message: string) => void
  signal: AbortSignal
}) {
  const { signal } = options
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  type Gesture = { id: string; before: string[]; pointer?: number; x: number; y: number; startX: number; startY: number; offset: number; active: boolean; opening: boolean }
  let gesture: Gesture | null = null, ghost: HTMLElement | null = null, frame = 0, settle = 0
  const rowFor = (id: string) => Array.from(list.querySelectorAll<HTMLElement>('[data-item-id]')).find(row => row.dataset.itemId === id)
  const cancelFrame = () => { cancelAnimationFrame(frame); frame = 0 }
  const clearGhost = () => { window.clearTimeout(settle); ghost?.remove(); ghost = null; list.querySelectorAll('[data-dragging],[data-grabbed]').forEach(row => { row.removeAttribute('data-dragging'); row.removeAttribute('data-grabbed') }) }
  const announce = (id: string) => { const ids = options.order(); options.announce(`已移至第 ${ids.indexOf(id) + 1} 名，共 ${ids.length} 项。`) }
  const finish = (commit: boolean) => {
    const current = gesture
    gesture = null; cancelFrame()
    if (!current?.active) { clearGhost(); return }
    if (!commit) { options.restore(current.before); options.announce('已取消本次排序，其他编辑仍保留。') }
    else { options.commit(); announce(current.id) }
    const row = rowFor(current.id)
    row?.removeAttribute('data-grabbed')
    if (commit && ghost && row && !reduced.matches) {
      const target = row.getBoundingClientRect()
      ghost.style.transition = 'top 190ms var(--ease-out), left 190ms var(--ease-out), scale 190ms var(--ease-out)'
      ghost.style.top = `${target.top}px`; ghost.style.left = `${target.left}px`; ghost.style.scale = '1'
      settle = window.setTimeout(clearGhost, 195)
    } else clearGhost()
    if (current.pointer === undefined) row?.querySelector<HTMLButtonElement>('[data-handle]')?.focus({ preventScroll: true })
  }
  const move = (id: string, index: number) => {
    const before = new Map(Array.from(list.children).map(child => [child, child.getBoundingClientRect().top]))
    options.move(id, index)
    if (!reduced.matches) for (const child of Array.from(list.children)) {
      const delta = (before.get(child) ?? child.getBoundingClientRect().top) - child.getBoundingClientRect().top
      if (delta && (child as HTMLElement).dataset.itemId !== id) child.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 210, easing: 'cubic-bezier(.2,.8,.2,1)' })
    }
  }
  const tick = () => {
    frame = 0
    if (!gesture?.active || gesture.pointer === undefined || !ghost) return
    const row = rowFor(gesture.id)
    if (!row) { finish(false); return }
    ghost.style.top = `${gesture.y - gesture.offset}px`
    const edge = 70, height = window.innerHeight
    const speed = gesture.y < edge ? -Math.ceil((edge - gesture.y) / 5) : gesture.y > height - edge ? Math.ceil((gesture.y - height + edge) / 5) : 0
    if (speed) window.scrollBy({ top: speed, behavior: 'instant' })
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-item-id]')).filter(other => other !== row)
    const next = rows.findIndex(other => { const rect = other.getBoundingClientRect(); return gesture!.y < rect.top + rect.height / 2 })
    const index = next < 0 ? rows.length : next
    if (options.order().indexOf(gesture.id) !== index) move(gesture.id, index)
    frame = requestAnimationFrame(tick)
  }
  list.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-item-id]')
    if (!row) return
    const handle = target.closest('[data-handle]')
    if (event.pointerType !== 'mouse' && !handle) return
    if (!handle && target.closest('button,a,input,textarea,select,label,summary')) return
    clearGhost()
    gesture = { id: row.dataset.itemId!, before: [], pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, offset: event.clientY - row.getBoundingClientRect().top, active: false, opening: false }
    if (handle) event.preventDefault()
  }, { signal })
  window.addEventListener('pointermove', async event => {
    const current = gesture
    if (!current || current.pointer !== event.pointerId) return
    current.x = event.clientX; current.y = event.clientY
    if (current.active) { event.preventDefault(); return }
    if (current.opening || Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return
    current.opening = true
    const accepted = await options.begin(current.id)
    if (gesture !== current) return
    if (!accepted || !options.order().includes(current.id)) { finish(false); return }
    current.before = options.order().slice(); current.active = true
    const row = rowFor(current.id)!
    const rect = row.getBoundingClientRect()
    // Keep the pointer within the now-expanded editable row when entering from read mode.
    current.offset = Math.min(current.offset, rect.height - 10)
    ghost = row.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-item-id'); ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true
    ghost.classList.add('ranking-drag-ghost'); ghost.style.width = `${rect.width}px`; ghost.style.left = `${rect.left}px`
    list.closest('.ranking-app')!.append(ghost); row.dataset.dragging = ''; options.announce('已抓取条目，松开放下，Escape 取消。')
    frame = requestAnimationFrame(tick)
  }, { signal, passive: false })
  window.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) finish(true) }, { signal })
  window.addEventListener('pointercancel', event => { if (gesture?.pointer === event.pointerId) finish(false) }, { signal })
  window.addEventListener('lostpointercapture', event => { if (gesture?.pointer === event.pointerId) finish(false) }, { signal })
  list.addEventListener('keydown', async event => {
    const target = event.target as HTMLElement
    if (!target.closest('[data-handle]')) return
    const row = target.closest<HTMLElement>('[data-item-id]')
    if (!row) return
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (gesture?.active) { finish(true); return }
      if (gesture) return
      const id = row.dataset.itemId!
      const current: Gesture = { id, before: [], x: 0, y: 0, startX: 0, startY: 0, offset: 0, active: false, opening: true }
      gesture = current
      if (!await options.begin(id) || gesture !== current || !options.order().includes(id)) { if (gesture === current) finish(false); return }
      current.before = options.order().slice(); current.active = true; current.opening = false
      const fresh = rowFor(id)!
      fresh.dataset.grabbed = ''; fresh.querySelector<HTMLButtonElement>('[data-handle]')?.focus({ preventScroll: true })
      options.announce('已抓取条目。方向键移动，Home 或 End 到首尾，空格放下，Escape 取消。')
    } else if (gesture?.active && gesture.pointer === undefined && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const ids = options.order(), index = ids.indexOf(gesture.id)
      move(gesture.id, event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1))))
      rowFor(gesture.id)?.querySelector<HTMLButtonElement>('[data-handle]')?.focus({ preventScroll: true }); announce(gesture.id)
    }
  }, { signal })
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(false) } }, { signal })
  window.addEventListener('blur', () => finish(false), { signal })
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(false) }, { signal })
  signal.addEventListener('abort', () => { finish(false); clearGhost() }, { once: true })
  return { cancel: () => finish(false), isActive: () => !!gesture }
}
