const resetTimers = new WeakMap<HTMLButtonElement, number>()

function updateCopyState(button: HTMLButtonElement, state: 'idle' | 'success' | 'error'): void {
  const label = button.querySelector<HTMLElement>('[data-copy-label]')
  const copy = state === 'idle'
  const message = copy ? '复制' : state === 'success' ? '已复制' : '复制失败'

  button.dataset.copyState = state
  button.setAttribute('aria-label', message === '复制' ? '复制代码' : message)
  button.title = message === '复制' ? '复制代码' : message
  if (label) label.textContent = message
}

export function initCodePanels(root: Document = document): void {
  if (root.documentElement.dataset.codePanelsInitialized === 'true') return
  root.documentElement.dataset.codePanelsInitialized = 'true'

  root.addEventListener('click', async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest<HTMLButtonElement>('[data-copy-code]')
    const codeElement = button?.closest('[data-code-panel]')?.querySelector('pre code')
    if (!button || !codeElement) return

    const lines = Array.from(codeElement.querySelectorAll(':scope > .line'))
    const code = lines.length > 0
      ? lines.map((line) => line.textContent ?? '').join('\n')
      : codeElement.textContent ?? ''

    const previousTimer = resetTimers.get(button)
    if (previousTimer) window.clearTimeout(previousTimer)

    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ''))
      updateCopyState(button, 'success')
    } catch {
      updateCopyState(button, 'error')
    }

    resetTimers.set(button, window.setTimeout(() => updateCopyState(button, 'idle'), 1800))
  })
}
