/** Delegated listeners also cover appended moments and Astro page swaps. */
export function installInlineSpoilers(root: Document | HTMLElement = document): () => void {
  const pinned = new WeakSet<HTMLElement>()
  const hovered = new WeakSet<HTMLElement>()
  const find = (target: EventTarget | null) => target instanceof Element
    ? target.closest<HTMLElement>('button[data-inline-spoiler]') : null
  const render = (button: HTMLElement) => {
    const expanded = pinned.has(button) || hovered.has(button)
    button.setAttribute('aria-expanded', String(expanded))
    if (expanded) button.removeAttribute('aria-label')
    else button.setAttribute('aria-label', '显示隐藏文字')
    button.querySelector('[data-spoiler-content]')?.setAttribute('aria-hidden', String(!expanded))
  }
  const click = (event: Event) => {
    const button = find(event.target)
    if (!button) return
    if (pinned.has(button)) pinned.delete(button)
    else pinned.add(button)
    render(button)
  }
  const over = (event: Event) => {
    const pointer = event as PointerEvent
    const button = find(pointer.target)
    if (!button || pointer.pointerType !== 'mouse' || !window.matchMedia('(hover: hover)').matches) return
    hovered.add(button)
    render(button)
  }
  const out = (event: Event) => {
    const pointer = event as PointerEvent
    const button = find(pointer.target)
    if (!button || (pointer.relatedTarget instanceof Node && button.contains(pointer.relatedTarget))) return
    hovered.delete(button)
    render(button)
  }
  root.addEventListener('click', click)
  root.addEventListener('pointerover', over)
  root.addEventListener('pointerout', out)
  return () => {
    root.removeEventListener('click', click)
    root.removeEventListener('pointerover', over)
    root.removeEventListener('pointerout', out)
  }
}
